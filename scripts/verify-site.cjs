/* Run with: node scripts/verify-site.cjs <path-to-jsdom-package> */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require(process.argv[2] || "jsdom");
const { assetVersion } = require("./version-assets.cjs");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "css/style.css"), "utf8");
const data = JSON.parse(fs.readFileSync(path.join(root, "data/chart-data.json"), "utf8"));
const globalData = JSON.parse(fs.readFileSync(path.join(root, "data/global-data.json"), "utf8"));
const questions = fs.readFileSync(path.join(root, "PROJECT_PLAN.md"), "utf8").split(/\r?\n/)
  .filter(line => /^[1-5]\. (How|Which)/.test(line)).slice(-5).map(line => line.slice(3));

async function loadPage(width, missingMap = false, missingFilters = false) {
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost:8000/", pretendToBeVisual: true });
  const { window } = dom;
  const version = window.document.documentElement.dataset.assetVersion;
  assert.equal(version, assetVersion(), "Run node scripts/version-assets.cjs after changing site assets");
  window.document.querySelectorAll('script[src], link[rel="stylesheet"]').forEach(element => {
    const url = new URL(element.getAttribute("src") || element.getAttribute("href"), window.location.href);
    assert.equal(url.searchParams.get("v"), version, "Styles and scripts must share the release version");
  });
  const style = window.document.createElement("style");
  style.textContent = css;
  window.document.head.append(style);
  let currentWidth = width;
  Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { get() { return currentWidth; } });
  const errors = [];
  window.console.error = (...args) => errors.push(args.map(String).join(" "));
  window.addEventListener("error", event => errors.push(String(event.error)));
  window.fetch = async url => {
    assert.equal(new URL(String(url), window.location.href).searchParams.get("v"), version,
      "Chart data and map requests must use the same release version");
    if (missingMap && String(url).includes("geojson")) throw new Error("Map intentionally unavailable in test");
    if (missingFilters && String(url).includes("global-data")) throw new Error("Filters intentionally unavailable in test");
    const file = path.join(root, String(url).split("?")[0]);
    return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(file, "utf8")) };
  };
  const observers = [];
  window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
    observe(target) { this.targets.push(target); }
  };
  let downloaded;
  let downloadName;
  window.URL.createObjectURL = blob => { downloaded = blob; return "blob:test-csv"; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { downloadName = this.download; };
  // Use the page's actual script order so file splits are checked too.
  window.document.querySelectorAll("script[src]").forEach(script => {
    window.eval(fs.readFileSync(path.join(root, script.getAttribute("src").split("?")[0]), "utf8"));
  });
  for (let i = 0; i < 50 && window.document.documentElement.dataset.chartsReady !== "true"; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(window.document.documentElement.dataset.chartsReady, "true", "Chart initialization must complete");
  return {
    dom, window, document: window.document, errors,
    downloaded: () => downloaded, downloadName: () => downloadName,
    resize: async newWidth => {
      currentWidth = newWidth;
      observers.forEach(observer => observer.callback(observer.targets.map(target => ({ target, contentRect: { width: newWidth } }))));
      await new Promise(resolve => setTimeout(resolve, 40));
    }
  };
}

function click(window, mark) {
  mark.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}

function change(window, document, id, value) {
  const select = document.getElementById(id);
  select.value = value;
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
}

async function downloadCSV(page, key) {
  page.document.querySelector('[data-download="' + key + '"]').click();
  return new Promise((resolve, reject) => {
    const reader = new page.window.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(page.downloaded());
  });
}

async function verifyWidth(width) {
  const page = await loadPage(width);
  const { window, document } = page;
  const keys = ["q1", "q2", "q3", "q4", "q5", "e1", "e2", "e3a", "e3b"];
  const explanation = key => document.querySelector('[data-explanation-key="' + key + '"]').textContent;
  const marks = key => [...document.querySelectorAll("#chart-" + key + " .mark")];
  const values = key => marks(key).map(mark => mark.__data__.row.value);
  const total = key => values(key).reduce((sum, value) => sum + value, 0);
  const tableRows = key => [...document.querySelectorAll("#table-" + key + " tbody tr")];
  const reset = () => document.getElementById("reset-filters").click();
  const filter = (key, value) => change(window, document, "filter-" + key, value);
  const validGeometry = () => {
    assert.deepEqual(page.errors, []);
    assert.doesNotMatch(document.querySelector("main").innerHTML, /NaN|undefined/);
    document.querySelectorAll(".chart-host .mark").forEach(mark => {
      assert.equal(mark.getAttribute("role"), "button");
      assert.equal(mark.getAttribute("tabindex"), "0");
      assert.ok(mark.getAttribute("aria-label"));
    });
  };
  const coherentLabels = year => keys.forEach(key => {
    assert.match(document.querySelector("#" + key + " .chart-caption").textContent, new RegExp(year));
    assert.equal(document.querySelectorAll("#table-" + key + " table").length, 1, "Tables must be replaced, not duplicated");
  });
  assert.equal(document.documentElement.dataset.filtersReady, "true");
  ["year", "group", "sex", "age"].forEach(key => {
    assert.equal(document.getElementById("filter-" + key).value, "all");
    assert.equal(document.getElementById("filter-" + key).disabled, false);
  });
  assert.equal(document.querySelectorAll(".chart-filter-scope").length, 9);
  assert.equal(document.getElementById("q3-year"), null, "Conflicting local year controls must be removed");
  assert.equal(document.getElementById("q4-year"), null);
  assert.equal(document.getElementById("q3-age"), null);
  assert.equal(document.querySelectorAll(".chart-host svg").length, 13);
  assert.equal(total("q1"), 410884);
  assert.equal(total("q3"), 410884, "Unknown age must be included in all-years totals");
  assert.equal(document.getElementById("filtered-total").textContent, "410,884");
  assert.equal(document.getElementById("annual-average").textContent, "37,353.1");
  assert.match(explanation("q4"), /Other \/ not recorded: 15/);
  assert.equal(total("e2"), 5472, "Age-by-road-user differences must reconcile to national 2021 minus 2011");
  questions.forEach((question, i) => assert.equal(document.getElementById("heading-q" + (i + 1)).textContent, question));
  assert.doesNotMatch(document.body.textContent, /yibo|rowan hogan/i);
  assert.doesNotMatch(document.querySelector('meta[name="description"]').content, /yibo/i);
  assert.ok([...document.querySelectorAll(".explanation-panel > .eyebrow")].every(p => p.textContent === "CHART ANALYSIS"));
  function verifyYearBins() {
    const bars = [...document.querySelectorAll("#chart-q1 .year-bin")];
    bars.forEach((bar, i) => {
      assert.ok(Number(bar.getAttribute("width")) > 0);
      if (i) {
        const previous = bars[i - 1];
        assert.ok(Math.abs(Number(bar.getAttribute("x")) - Number(previous.getAttribute("x")) - Number(previous.getAttribute("width"))) < 1e-6);
      }
    });
  }
  verifyYearBins();
  const peak = document.querySelector("#chart-q1 .peak-year");
  assert.match(peak.getAttribute("aria-label"), /^2019:/);
  peak.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(peak.getAttribute("aria-pressed"), "true");
  assert.match(document.getElementById("readout-q1").textContent, /39,866/);
  document.querySelector('[data-reset="q1"]').click();
  assert.equal(peak.getAttribute("aria-pressed"), "false");
  validGeometry();

  for (const row of data.q1) {
    filter("year", row.label);
    assert.equal(total("q1"), row.value, "The shared year must update the national count");
    assert.equal(total("q3"), row.value, "The shared year must update the age chart");
    assert.equal(total("q5") / 2, row.value, "Bars and pie must both use the shared year's road-user counts");
    assert.equal(tableRows("q1").length, 1);
    coherentLabels(row.label);
  }
  filter("year", "2021");
  assert.equal(document.getElementById("filtered-total").textContent, "39,505");
  assert.equal(total("q2") - 740, 39035, "The map includes the ACT callout as a second selectable mark");
  assert.equal(document.querySelectorAll("#chart-q2 path.map-state").length, 8);
  assert.match(explanation("q4"), /Other \/ not recorded: 1/);
  const act = [...document.querySelectorAll("#chart-q2 .map-region-list button")].find(button => button.textContent.startsWith("ACT"));
  act.click();
  assert.equal(document.querySelectorAll("#chart-q2 .is-selected").length, 2);
  assert.match(document.getElementById("readout-q2").textContent, /740/);
  document.querySelector('[data-reset="q2"]').click();
  const road = document.querySelector("#chart-q5 .mark[aria-label^='Vehicle occupants:']");
  click(window, road);
  assert.equal(document.querySelectorAll("#chart-q5 .is-selected").length, 2);
  await page.resize(width === 330 ? 740 : 330);
  assert.equal(document.querySelectorAll("#chart-q5 .is-selected").length, 2);
  verifyYearBins();
  const svgCount = document.querySelectorAll(".chart-host svg").length;
  await page.resize(width);
  assert.equal(document.querySelectorAll(".chart-host svg").length, svgCount, "Resizing must not duplicate charts");

  filter("group", "Motorcyclists");
  assert.equal(total("q1"), 8883);
  assert.equal(total("q3"), 8883);
  assert.equal(total("q5") / 2, 8883);
  assert.equal(tableRows("q5").length, 1);
  assert.ok(marks("e1").every(mark => mark.__data__.row[mark.__data__.series] === 100));
  assert.equal(document.querySelector("#chart-q5 .road-icon").textContent, "🏍️", "A filtered category keeps its matching icon");
  filter("sex", "Female");
  assert.equal(total("q1"), 992, "Joint road-user and sex filters must use real intersected counts");
  assert.equal(total("q3"), 992);
  assert.match(explanation("q4"), /Female: 992 \(100\.0%\)/);
  assert.equal(document.querySelectorAll("#chart-q4 .pie-panel").length, 1);
  assert.match(document.querySelector("#chart-q2 .empty-message").textContent, /does not provide joint state counts/);
  assert.equal(document.querySelectorAll("#chart-q2 .mark").length, 0, "Unsupported joint filters must clear stale map values");
  assert.equal(document.querySelector('[data-download="q2"]').disabled, true);
  const jointExpected = globalData.records.filter(row => row.year === "2021" && row.group === "Motorcyclists" && row.sex === "Female" && row.age === "40-64")
    .reduce((sum, row) => sum + row.cases, 0);
  filter("age", "40-64");
  assert.equal(total("q1"), jointExpected);
  assert.equal(total("q3"), jointExpected);
  assert.equal(tableRows("q3").length, 1);
  const csv = await downloadCSV(page, "q3");
  assert.match(csv, /"Year filter","Road-user filter","Sex filter","Age filter"/);
  assert.match(csv, /"2021","2021","Motorcyclists","Female","40-64","40-64"/);
  assert.ok(csv.includes('"' + jointExpected + '"'));
  assert.equal(page.downloadName(), "q3-2021-hospitalisation-data.csv");
  validGeometry();

  reset();
  filter("sex", "Female");
  change(window, document, "q3-view", "trend");
  assert.equal(tableRows("q3").length, 11);
  filter("year", "2019");
  assert.equal(tableRows("q3").length, 1, "The global year must also apply to trend view");
  assert.equal(total("q1"), 14499);
  assert.equal(document.getElementById("filter-year").disabled, false);
  assert.match(explanation("q3"), /2019/);
  validGeometry();

  reset();
  filter("year", "2011");
  filter("age", "0-7");
  assert.match(document.querySelector("#chart-q2 .map-state[aria-label^='Australian Capital Territory:']").getAttribute("aria-label"), /not published/);
  const suppressed = document.querySelector("#chart-q2 .map-state[aria-label^='Australian Capital Territory:']");
  assert.equal(suppressed.getAttribute("fill"), "#d9dfdc");
  click(window, suppressed);
  assert.match(document.getElementById("readout-q2").textContent, /not published/);
  const mapCSV = await downloadCSV(page, "q2");
  assert.match(mapCSV, /"Australian Capital Territory","Not published"/);
  assert.equal(total("e2"), 0, "The baseline year compared with itself has zero changes");
  validGeometry();

  reset();
  filter("year", "2011");
  filter("age", "Unknown");
  filter("sex", "Female");
  assert.equal(document.getElementById("filtered-total").textContent, "0");
  assert.match(document.querySelector("#chart-q1 .empty-message").textContent, /No hospitalisations match/);
  assert.match(document.querySelector("#chart-e3a .empty-message").textContent, /nonzero/);
  assert.equal(document.querySelector('[data-download="q1"]').disabled, true);
  validGeometry();

  reset();
  filter("age", "Unknown");
  assert.equal(total("q1"), 1);
  assert.equal(marks("e1").length, 5, "Undefined shares in zero-case years must not be plotted as zero");
  assert.equal(marks("e1")[0].__data__.row.label, "2014");
  validGeometry();
  reset();
  assert.equal(total("q1"), 410884);
  assert.equal(document.querySelectorAll(".chart-host svg").length, 13);
  assert.equal(document.querySelectorAll("#chart-q2 .map-state").length, 8, "Reset restores the map after unsupported filters");
  const seriesSums = { Hospitalisations: 0, "Bed days": 0 };
  marks("e3a").forEach(mark => { seriesSums[mark.__data__.series] += mark.__data__.row[mark.__data__.series]; });
  Object.values(seriesSums).forEach(value => assert.ok(Math.abs(value - 100) < 1e-8));
  document.querySelector(".supplementary").open = true;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(document.querySelectorAll(".chart-host svg").length, 13);
  validGeometry();
  page.dom.window.close();
  console.log("PASS at width " + width + ": all nine questions, every year, joint filters, map coverage and suppression, trend, CSV context, keyboard, reset, resize, no personal names, and zero-case recovery.");
}

(async () => {
  await verifyWidth(740);
  await verifyWidth(330);
  const degraded = await loadPage(740, true);
  assert.match(degraded.document.querySelector("#chart-q2 .error-message").textContent, /map could not load/);
  assert.equal(degraded.document.querySelectorAll("#table-q2 tbody tr").length, 8);
  assert.equal(degraded.document.querySelectorAll("#chart-q1 .mark").length, 11);
  degraded.dom.window.close();
  const noFilters = await loadPage(740, false, true);
  assert.equal(noFilters.document.getElementById("filter-year").disabled, true);
  assert.match(noFilters.document.getElementById("global-filter-status").textContent, /Shared filters could not load/);
  assert.equal(noFilters.document.querySelectorAll("#chart-q3 .mark").length, 7);
  assert.equal(noFilters.document.querySelectorAll("#chart-q4 .mark").length, 22);
  noFilters.dom.window.close();
  console.log("PASS map-load and shared-data failure: usable original charts and reference data remain available.");
})().catch(error => { console.error(error); process.exitCode = 1; });
