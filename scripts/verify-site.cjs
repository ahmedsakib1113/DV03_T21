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
  const keys = ["q1", "q2", "q3", "q4", "q5", "e1", "e3a", "e3b"];
  const explanation = key => document.querySelector('[data-explanation-key="' + key + '"]').textContent;
  const marks = key => [...document.querySelectorAll("#chart-" + key + " .mark")];
  const values = key => marks(key).map(mark => mark.__data__.row.value);
  const total = key => values(key).reduce((sum, value) => sum + value, 0);
  const tableRows = key => [...document.querySelectorAll("#table-" + key + " tbody tr")];
  const validGeometry = () => {
    assert.deepEqual(page.errors, []);
    assert.doesNotMatch(document.querySelector("main").innerHTML, /NaN|undefined/);
    document.querySelectorAll(".chart-host .mark").forEach(mark => {
      assert.equal(mark.getAttribute("role"), "button");
      assert.equal(mark.getAttribute("tabindex"), "0");
      assert.ok(mark.getAttribute("aria-label"));
    });
  };
  assert.equal(document.documentElement.dataset.filtersReady, "true");
  assert.equal(document.querySelectorAll(".snapshot, .interaction-guide, #shared-filter-panel, .question-filter-toggle, .question-filter-summary, #filter-year, #filter-group, #filter-sex, #filter-age").length, 0, "Retired summaries and shared filter UI must be removed from every question");
  assert.equal(document.querySelectorAll(".chart-filter-scope").length, 8);
  assert.equal(document.querySelectorAll("body > .question-nav .nav-links > a[href^='#q']").length, 5);
  assert.equal(document.querySelectorAll(".research-content > .question-section").length, 5, "The workspace must contain exactly five primary questions");
  assert.equal(document.querySelectorAll(".research-content > .question-section > .question-layout > .explanation-panel").length, 5, "Every research chart has a full-width analysis section");
  assert.equal(document.querySelectorAll(".selection-insight > .chart-readout").length, 5, "Selected mark details must remain inside chart analysis");
  const questionKeys = keys.slice(0, 5);
  const yearPickers = [...document.querySelectorAll("[data-chart-year]")];
  questionKeys.forEach((key, index) => {
    const question = document.getElementById(key);
    const layout = question.querySelector(".question-layout");
    assert.deepEqual([...layout.children].map(child => child.classList.contains("chart-frame") ? "chart" :
      child.classList.contains("explanation-panel") ? "analysis" :
      child.classList.contains("data-disclosure") ? "data" : "unexpected"),
      key === "q5" ? ["chart", "analysis"] : ["chart", "analysis", "data"],
      key + " must show the chart and analysis before the data controls");
    assert.equal(layout.querySelector(".analysis-title").textContent, "Chart Analysis");
    assert.equal(layout.querySelector(".chart-explanation").children.length, 2, "Findings and context both remain available");
    const tools = question.querySelector(".question-tools");
    assert.equal(tools.querySelector(".download-data").textContent, "Download CSV");
    assert.equal(tools.querySelector("summary").textContent, "View chart data");
    assert.deepEqual([...tools.querySelectorAll(".question-pager a")].map(link => link.hash),
      ["#" + (questionKeys[index - 1] || "research-questions"), "#" + (questionKeys[index + 1] || "sources")]);
    assert.equal(yearPickers[index].disabled, false);
    assert.deepEqual([...yearPickers[index].options].map(option => option.value), ["all", ...globalData.years]);
  });
  assert.equal(document.getElementById("readout-q5").closest(".explanation-panel").querySelector('[data-explanation-key="q5"]').tagName, "DIV");
  assert.equal(document.getElementById("q3-year"), null, "Conflicting local year controls must be removed");
  assert.equal(document.getElementById("q4-year"), null);
  assert.equal(document.getElementById("q3-age"), null);
  assert.equal(document.querySelectorAll(".chart-host svg").length, 8, "The page renders one SVG for each of its eight charts");
  assert.equal(document.querySelectorAll("#chart-q3 .bubble-point").length, 8, "Q3 includes all eight age classifications");
  assert.equal(document.querySelectorAll("#chart-q4 .mirror-bar").length, 16, "Q4 compares male and female across eight age classifications when Unknown is present");
  const heatmapCellCount = globalData.ages.length * globalData.groups.length;
  assert.equal(document.querySelectorAll("#chart-q5 .heatmap-cell").length, heatmapCellCount, "Q5 includes the Unknown row in every year");
  assert.equal(document.querySelectorAll("#chart-q5 .pie-panel, #chart-q5 .pie-legend").length, 0);
  assert.equal(total("q1"), 410884);
  assert.equal(total("q3"), 410884, "Unknown age must be included in all-years totals");
  const topAgeBubble = marks("q3")[0];
  const topAgeRecords = globalData.records.filter(row => row.age === "40-64");
  const topAgeCases = topAgeRecords.reduce((total, row) => total + row.cases, 0);
  const topAgeBedDays = topAgeRecords.reduce((total, row) => total + row.beds, 0);
  assert.equal(topAgeBubble.__data__.row.value, topAgeCases);
  assert.equal(topAgeBubble.__data__.row.bedDays, topAgeBedDays);
  assert.equal(topAgeBubble.__data__.row.daysPerHospitalisation, topAgeBedDays / topAgeCases);
  assert.ok([...document.querySelectorAll("#chart-q3 .bubble-label")].some(label => label.textContent === "40–64 · 5.1 d"));
  click(window, topAgeBubble);
  assert.match(document.getElementById("readout-q3").textContent, /687,450 reported bed days/);
  click(window, topAgeBubble);
  const ageBubbleCSV = await downloadCSV(page, "q3");
  assert.match(ageBubbleCSV, /"Reported bed days","Reported bed days per hospitalisation"/);
  assert.ok(ageBubbleCSV.includes('"40-64","' + topAgeCases + '","' + topAgeBedDays + '"'));
  const ageButtons = [...document.querySelectorAll("#q3-age-buttons button")];
  assert.equal(ageButtons.length, 8);
  assert.equal(ageButtons[0].textContent, "All ages");
  assert.equal(ageButtons[0].getAttribute("aria-pressed"), "true");
  const nationalChart = document.querySelector("#chart-q1 svg");
  for (const button of ageButtons.slice(1)) {
    button.click();
    const age = button.dataset.age;
    const ageRecords = globalData.records.filter(row => row.age === age);
    assert.equal(button.getAttribute("aria-pressed"), "true");
    assert.equal(marks("q3").length, globalData.groups.length);
    assert.equal(total("q3"), ageRecords.reduce((sum, row) => sum + row.cases, 0));
    assert.match(document.querySelector("#table-q3 thead").textContent, /Road-user group/);
    assert.equal(document.querySelector("#chart-q1 svg"), nationalChart);
    if (age === "8-16") {
      assert.match(explanation("q3"), /cyclists.*10,940/i);
      const csv = await downloadCSV(page, "q3");
      assert.match(csv, /"Period","Age group","Road-user group"/);
      assert.match(csv, /"8-16","Cyclists","10940","20497"/);
    }
  }
  ageButtons[0].click();
  assert.equal(total("q3"), 410884);
  assert.equal(marks("q4").filter(mark => mark.__data__.series === "Male").reduce((sum, mark) => sum + mark.__data__.row.Male, 0), 266763);
  assert.equal(marks("q4").filter(mark => mark.__data__.series === "Female").reduce((sum, mark) => sum + mark.__data__.row.Female, 0), 144106);
  assert.match(explanation("q1"), /increased by 5,472 \(16\.1%\)/, "Q1 answers the overall trend");
  assert.match(explanation("q2"), /highest published count/);
  assert.match(explanation("q2"), /lowest/);
  assert.match(explanation("q3"), /% of the total/);
  assert.match(explanation("q4"), /64\.9%/);
  assert.match(explanation("q4"), /Other \/ not recorded: 15/);
  assert.match(explanation("q5"), /largest increase was 1,376/);
  assert.match(explanation("q5"), /largest decrease was 194/);
  assert.equal(total("q5"), 5472, "Q5 heatmap differences must reconcile to national 2021 minus 2011");
  assert.equal(tableRows("q5").length, heatmapCellCount);
  const cyclist4064 = marks("q5").find(mark => mark.__data__.row.age === "40-64" && mark.__data__.row.road === "Cyclists");
  const pedestrian1725 = marks("q5").find(mark => mark.__data__.row.age === "17-25" && mark.__data__.row.road === "Pedestrians");
  assert.equal(cyclist4064.__data__.row.value, 1376);
  assert.equal(pedestrian1725.__data__.row.value, -194);
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
  assert.equal(document.querySelectorAll(".chart-host svg title, .chart-host [title]").length, 0,
    "Native titles must not produce a second tooltip; SVGs and marks use ARIA labels");
  document.querySelectorAll(".chart-host svg").forEach(svg => assert.ok(svg.getAttribute("aria-label")));
  document.querySelectorAll("rect.mark").forEach(mark => {
    const style = window.getComputedStyle(mark);
    assert.equal(style.stroke, "rgb(23, 78, 76)", "Bars and heatmap cells must have visible outlines before interaction");
    assert.equal(style.strokeWidth, "1px");
  });
  const tooltip = document.querySelector("#chart-q1 .chart-tooltip");
  peak.dispatchEvent(new window.MouseEvent("pointerenter", { clientX: width - 5, clientY: 100 }));
  assert.equal(tooltip.style.display, "block");
  assert.deepEqual([...tooltip.children].map(line => line.textContent), [
    "2019: 39,866 hospitalisations.",
    "2,512.9 hospitalisations above the average.",
    "Average: 37,353.1 hospitalisations."
  ]);
  peak.dispatchEvent(new window.MouseEvent("pointermove", { clientX: 120, clientY: 110 }));
  assert.equal(tooltip.children.length, 3, "Pointer movement must replace tooltip lines, not duplicate them");
  const otherMark = marks("q3")[0];
  otherMark.dispatchEvent(new window.FocusEvent("focus"));
  assert.equal(document.querySelectorAll('.chart-tooltip[style*="display: block"]').length, 1,
    "Only one tooltip may remain visible across pointer and keyboard interactions");
  otherMark.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(document.querySelectorAll('.chart-tooltip[style*="display: block"]').length, 0);
  peak.dispatchEvent(new window.FocusEvent("focus"));
  assert.equal(tooltip.style.display, "block");
  peak.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(tooltip.style.display, "none");
  assert.equal(peak.getAttribute("aria-pressed"), "true");
  assert.match(document.getElementById("readout-q1").textContent, /39,866/);
  click(window, peak);
  assert.equal(peak.getAttribute("aria-pressed"), "false");
  validGeometry();

  for (const row of data.q1) {
    const bar = document.querySelector("#chart-q1 .year-bin[aria-label^='" + row.label + ":']");
    click(window, bar);
    assert.equal(bar.getAttribute("aria-pressed"), "true");
    assert.equal(bar.__data__.row.value, row.value);
    assert.equal(marks("q1").length, 11, "All yearly bars remain visible");
  }
  click(window, document.querySelector("#chart-q1 .is-selected"));
  assert.equal(document.querySelectorAll("#chart-q1 .is-selected").length, 0);
  const trendCSV = await downloadCSV(page, "q1");
  assert.equal(trendCSV.trim().split(/\r?\n/).length, 12);
  assert.match(trendCSV, /39866/);
  const femaleBar = marks("q4").find(mark => mark.__data__.row.label === "40-64" && mark.__data__.series === "Female");
  click(window, femaleBar);
  assert.equal(femaleBar.getAttribute("aria-pressed"), "true");
  click(window, femaleBar);
  assert.equal(femaleBar.getAttribute("aria-pressed"), "false");
  const act = [...document.querySelectorAll("#chart-q2 .map-region-list button")].find(button => button.textContent.startsWith("ACT"));
  act.click();
  assert.equal(document.querySelectorAll("#chart-q2 .is-selected").length, 2);
  act.click();
  assert.equal(document.getElementById("q3-view"), null);
  assert.equal(document.getElementById("q3-age-buttons").hidden, false);
  assert.equal(total("q3"), 410884);
  assert.equal(document.querySelectorAll("#chart-q3 .bubble-point").length, 8);
  click(window, cyclist4064);
  await page.resize(width === 330 ? 740 : 330);
  assert.equal(document.querySelectorAll("#chart-q5 .is-selected").length, 1);
  verifyYearBins();
  await page.resize(width);
  assert.equal(document.querySelectorAll(".chart-host svg").length, 8);
  assert.equal(document.querySelectorAll("#chart-q2 .map-state").length, 8);
  const seriesSums = { Hospitalisations: 0, "Bed days": 0 };
  marks("e3a").forEach(mark => { seriesSums[mark.__data__.series] += mark.__data__.row[mark.__data__.series]; });
  Object.values(seriesSums).forEach(value => assert.ok(Math.abs(value - 100) < 1e-8));
  const chooseYear = (picker, year) => {
    picker.value = year;
    picker.dispatchEvent(new window.Event("change", { bubbles: true }));
  };
  const supplementaryChart = document.querySelector("#chart-e1 svg");
  const victoria = marks("q2").find(mark => mark.__data__.row.code === "VIC");
  click(window, victoria);
  let annualLegend;
  const heatmapLegend = document.querySelector("#chart-q5 .heatmap-legend").textContent;
  const selectedHeatmapCell = document.querySelector("#chart-q5 .heatmap-cell.is-selected");
  const q5 = document.getElementById("q5");
  const trendPanel = q5.querySelector(":scope > #q5-trend-detail");
  const selectedPoint = () => document.querySelector("#q5-trend .q5-trend-point.is-active").__data__;
  const comparisonRow = () => [...document.querySelectorAll("#q5-comparison-rows .is-active > *")].map(cell => cell.textContent);
  const cyclingCount = year => globalData.records.filter(record =>
    record.year === year && record.age === "40-64" && record.group === "Cyclists"
  ).reduce((sum, record) => sum + record.cases, 0);
  assert.equal(trendPanel.hidden, false);
  assert.equal(q5.querySelector(".q5-trend-toggle"), null);
  assert.equal(trendPanel.previousElementSibling, q5.querySelector(".question-layout"));
  assert.equal(trendPanel.nextElementSibling, q5.querySelector(".question-tools"));
  assert.equal(trendPanel.nextElementSibling, q5.lastElementChild);
  assert.equal(document.querySelectorAll("#q5-trend .q5-trend-point").length, 11);
  assert.equal(document.querySelectorAll("#q5-comparison-rows tr").length, globalData.groups.length);
  for (const [index, row] of data.q1.entries()) {
    chooseYear(yearPickers[index % yearPickers.length], row.label);
    assert.ok(yearPickers.every(picker => picker.value === row.label));
    assert.equal(marks("q1").length, 11);
    assert.equal(document.querySelector("#chart-q1 .is-selected").__data__.row.label, row.label);
    assert.equal(total("q3"), row.value);
    assert.equal(total("q5"), row.value - data.q1[0].value);
    assert.equal(marks("q5").length, heatmapCellCount);
    assert.equal(document.querySelector("#chart-q5 .heatmap-legend").textContent, heatmapLegend);
    assert.equal(document.querySelector("#chart-q5 .heatmap-cell.is-selected"), selectedHeatmapCell);
    assert.deepEqual([...document.querySelectorAll("#chart-q5 .is-cell-axis")].map(tick => tick.__data__), ["40-64", "Cyclists"]);
    assert.equal(selectedPoint().year, row.label);
    assert.equal(selectedPoint().value, cyclingCount(row.label) - cyclingCount("2011"));
    assert.equal(document.getElementById("q5-comparison-year").textContent, row.label);
    assert.deepEqual(comparisonRow().slice(0, 3),
      ["Cyclists", cyclingCount("2011").toLocaleString("en-AU"), cyclingCount(row.label).toLocaleString("en-AU")]);
    if (row.label === "2011") assert.ok(values("q5").every(value => value === 0));
    const records = globalData.records.filter(record => record.year === row.label);
    const recordsBySex = sex => records.filter(record => record.sex === sex).reduce((sum, record) => sum + record.cases, 0);
    for (const sex of ["Male", "Female"]) {
      const chartTotal = marks("q4").filter(mark => mark.__data__.series === sex)
        .reduce((sum, mark) => sum + mark.__data__.row[sex], 0);
      assert.equal(chartTotal, recordsBySex(sex));
    }
    const actTotal = globalData.states.find(record => record.year === row.label && record.state === "ACT" && record.dimension === "total");
    const actMark = marks("q2").find(mark => mark.__data__.row.code === "ACT");
    assert.equal(actMark.__data__.row.value, actTotal.cases);
    const legend = document.querySelector("#chart-q2 .map-legend").textContent;
    annualLegend ??= legend;
    assert.equal(legend, annualLegend, "The map uses one colour scale for every year");
    const selectedState = document.querySelector("#chart-q2 .map-state.is-selected");
    assert.equal(selectedState.__data__.row.code, "VIC");
    assert.equal(document.querySelector("#chart-q2").classList.contains("has-map-selection"), true);
    const vicTotal = globalData.states.find(record => record.year === row.label && record.state === "VIC" && record.dimension === "total");
    assert.equal(document.querySelector("#readout-q2 strong").textContent, vicTotal.cases.toLocaleString("en-AU"));
    assert.equal(document.querySelector("#chart-e1 svg"), supplementaryChart);
  }
  click(window, document.querySelector("#chart-q5 .heatmap-cell[aria-pressed=false][aria-label^='17-25 / Pedestrians']"));
  assert.equal(selectedPoint().value, -194);
  assert.equal(comparisonRow()[0], "Pedestrians");
  assert.equal(comparisonRow().at(-1), "−194");
  assert.match(document.querySelector("#readout-q5").textContent, /Ages 17–25 · Pedestrians.*−194/);
  assert.equal(trendPanel.hidden, false);
  click(window, document.querySelector("#chart-q2 .map-state.is-selected"));
  assert.equal(document.querySelector("#chart-q2").classList.contains("has-map-selection"), false);
  ageButtons.find(button => button.dataset.age === "8-16").click();
  chooseYear(yearPickers[2], "2014");
  assert.equal(document.querySelector("#q3-age-buttons [aria-pressed=true]").dataset.age, "8-16");
  const cyclist = marks("q3").find(mark => mark.__data__.row.label === "Cyclists").__data__.row;
  const cyclistLabel = [...document.querySelectorAll("#chart-q3 .bubble-label")].find(label => label.__data__.label === "Cyclists");
  assert.ok(cyclistLabel.textContent.endsWith(" · " + cyclist.daysPerHospitalisation.toFixed(1) + " d"));
  assert.match(await downloadCSV(page, "q3"), /"2014","8-16","Cyclists"/);
  const csv2014 = await downloadCSV(page, "q2");
  assert.match(csv2014, /"2014","2014","all","all","all","Australian Capital Territory"/);
  assert.equal(await downloadCSV(page, "q2"), csv2014, "Repeated downloads retain exactly the same CSV headers and rows");
  document.querySelector(".supplementary").open = true;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(document.querySelectorAll(".chart-host svg").length, 8, "The page renders one SVG for each of its eight charts");
  validGeometry();
  page.dom.window.close();
  console.log("PASS at width " + width + ": question controls, chart navigation targets, all 11 selectable years, age groups, map counts, CSV, keyboard, and resize.");
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
  assert.equal(noFilters.document.getElementById("shared-filter-panel"), null);
  assert.equal(noFilters.document.querySelectorAll("#chart-q3 .mark").length, 7);
  assert.equal(noFilters.document.querySelectorAll("#chart-q4 .mark").length, 22);
  assert.equal(noFilters.document.querySelectorAll("#chart-q5 .heatmap-cell").length, 28, "The static Q5 fallback retains the original source-category heatmap.");
  assert.equal(noFilters.document.getElementById("q5-trend-detail").hidden, true);
  assert.ok(noFilters.document.querySelector("#q5 > .question-tools > .download-data:not([disabled])"));
  noFilters.dom.window.close();
  console.log("PASS map-load and shared-data failure: usable original charts and reference data remain available.");
})().catch(error => { console.error(error); process.exitCode = 1; });
