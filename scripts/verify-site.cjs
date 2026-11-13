/* Run with: node scripts/verify-site.cjs <path-to-jsdom-package> */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require(process.argv[2] || "jsdom");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "css/style.css"), "utf8");
const data = JSON.parse(fs.readFileSync(path.join(root, "data/chart-data.json"), "utf8"));
const originalExplanations = JSON.parse(fs.readFileSync(path.join(root, "data/yibo-explanations.json"), "utf8"));
const questions = fs.readFileSync(path.join(root, "PROJECT_PLAN.md"), "utf8").split(/\r?\n/)
  .filter(line => /^[1-5]\. (How|Which)/.test(line)).slice(-5).map(line => line.slice(3));

async function loadPage(width, missingMap = false) {
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost:8000/", pretendToBeVisual: true });
  const { window } = dom;
  const style = window.document.createElement("style");
  style.textContent = css;
  window.document.head.append(style);
  let currentWidth = width;
  Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { get() { return currentWidth; } });
  const errors = [];
  window.console.error = (...args) => errors.push(args.map(String).join(" "));
  window.addEventListener("error", event => errors.push(String(event.error)));
  window.fetch = async url => {
    if (missingMap && String(url).includes("geojson")) throw new Error("Map intentionally unavailable in test");
    const file = path.join(root, String(url));
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
  window.eval(fs.readFileSync(path.join(root, "assets/vendor/d3.v7.min.js"), "utf8"));
  window.eval(fs.readFileSync(path.join(root, "js/main.js"), "utf8"));
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

async function verifyWidth(width) {
  const page = await loadPage(width);
  const { window, document } = page;
  assert.deepEqual(page.errors, [], "All charts must render without errors");
  assert.equal(document.querySelectorAll(".chart-host svg").length, 9);
  assert.equal(document.querySelectorAll(".error-message").length, 0);
  questions.forEach((question, i) => assert.equal(document.getElementById("heading-q" + (i + 1)).textContent, question));
  Object.entries(originalExplanations).forEach(([source, block]) => {
    const element = [...document.querySelectorAll(".chart-explanation")].find(e => e.dataset.explanationSource === source);
    assert.equal(element.outerHTML, block, "Yibo explanation changed: " + source);
  });
  const counts = { q1: 11, q2: 9, q3: 7, q4: 22, q5: 5, e1: 55, e2: 28, e3a: 10, e3b: 14 };
  Object.entries(counts).forEach(([key, expected]) => {
    const chart = document.getElementById("chart-" + key);
    assert.equal(chart.querySelectorAll(".mark").length, expected, key + " interactive marks");
    chart.querySelectorAll(".mark").forEach(mark => {
      assert.equal(mark.getAttribute("role"), "button");
      assert.equal(mark.getAttribute("tabindex"), "0");
      assert.ok(!/NaN|undefined/.test(mark.outerHTML), key + " mark must have valid geometry");
    });
    assert.equal(document.querySelectorAll("#table-" + key + " tbody tr").length, data[key].length);
    assert.match(document.getElementById("readout-" + key).textContent, /Arithmetic mean|arithmetic mean|Each mean/);
  });
  if (process.argv[3]) {
    const output = path.resolve(process.argv[3]);
    fs.mkdirSync(output, { recursive: true });
    Object.keys(counts).forEach(key => {
      const svg = document.querySelector("#chart-" + key + " svg").cloneNode(true);
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const dimensions = svg.getAttribute("viewBox").split(" ").map(Number);
      svg.setAttribute("width", width);
      svg.setAttribute("height", Math.round(dimensions[3] / dimensions[2] * width));
      const svgStyle = document.createElementNS("http://www.w3.org/2000/svg", "style");
      svgStyle.textContent = css;
      svg.prepend(svgStyle);
      fs.writeFileSync(path.join(output, width + "-" + key + ".svg"), svg.outerHTML);
    });
  }
  const q1 = document.querySelector("#chart-q1 .mark[aria-label^='2019:']");
  click(window, q1);
  assert.equal(q1.getAttribute("aria-pressed"), "true");
  assert.ok(q1.classList.contains("is-selected"));
  assert.equal(window.getComputedStyle(q1).fill, "var(--orange)");
  assert.match(document.getElementById("readout-q1").textContent, /39,866.*above.*37,353\.1/);
  assert.equal(document.querySelectorAll("#chart-q1 .is-selected").length, 1);
  click(window, q1);
  assert.equal(q1.getAttribute("aria-pressed"), "false", "Clicking again must clear selection");
  q1.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(q1.getAttribute("aria-pressed"), "true", "Keyboard Enter selects a bar");
  document.querySelector('[data-reset="q1"]').click();
  assert.equal(q1.getAttribute("aria-pressed"), "false");
  assert.match(document.getElementById("readout-q1").textContent, /37,353\.1/);

  const map = document.getElementById("chart-q2");
  assert.equal(map.querySelectorAll("path.map-state").length, 8, "Q2 must draw eight geographic regions");
  assert.equal(map.querySelectorAll("svg rect:not(.map-water)").length, 0, "Q2 must not contain bars");
  assert.equal(map.querySelectorAll(".map-region-list button").length, 8);
  const vic = map.querySelector(".map-state[aria-label^='Victoria:']");
  click(window, vic);
  assert.match(document.getElementById("readout-q2").textContent, /Victoria.*11,130.*4,879\.4/);
  const actButton = [...map.querySelectorAll(".map-region-list button")].find(e => e.textContent.startsWith("ACT"));
  actButton.click();
  assert.equal(map.querySelectorAll(".is-selected").length, 2, "ACT boundary and enlarged callout highlight together");
  assert.match(document.getElementById("readout-q2").textContent, /Australian Capital Territory.*740.*below/);
  document.querySelector('[data-reset="q2"]').click();
  assert.equal(map.querySelectorAll(".is-selected").length, 0);
  assert.equal(actButton.getAttribute("aria-pressed"), "false");

  const age = document.querySelector("#chart-q3 .mark[aria-label^='40-64:']");
  age.dispatchEvent(new window.KeyboardEvent("keydown", { key: " ", bubbles: true }));
  assert.match(document.getElementById("readout-q3").textContent, /13,026.*5,643\.6/);
  const male = document.querySelector("#chart-q4 .mark[aria-label^='2021 · Male:']");
  const female = document.querySelector("#chart-q4 .mark[aria-label^='2021 · Female:']");
  click(window, male);
  const maleReadout = document.getElementById("readout-q4").textContent;
  click(window, female);
  const femaleReadout = document.getElementById("readout-q4").textContent;
  assert.match(maleReadout, /25,788/);
  assert.match(femaleReadout, /13,716/);
  assert.notEqual(maleReadout, femaleReadout, "Q4 must compare each sex with its own average");
  const road = document.querySelector("#chart-q5 .mark[aria-label^='Vehicle occupants:']");
  click(window, road);
  assert.match(document.getElementById("readout-q5").textContent, /19,524.*7,901\.0/);
  const heat = document.querySelector("#chart-e2 .mark[aria-label^='40-64 \/ Pedal cyclist:']");
  assert.equal(document.getElementById("e2").closest("details"), null, "The restored heatmap must be visible outside collapsed further analysis");
  const originalFill = heat.getAttribute("fill");
  assert.equal(originalFill, "rgb(184, 63, 75)", "The largest increase must use the restored red scale endpoint");
  assert.equal(heat.getAttribute("rx"), null, "The original heatmap uses joined square cells");
  assert.equal(document.querySelector("#chart-e2 .heatmap-title").textContent.replace(/Ageand/, "Age and"),
    "Change in Hospitalisations by Age and Road User, 2011–2021");
  click(window, heat);
  assert.ok(heat.classList.contains("is-selected"), "Clicking the restored heatmap must highlight the cell");
  assert.match(document.getElementById("readout-e2").textContent, /1,376/);
  document.querySelector('[data-reset="e2"]').click();
  assert.equal(heat.classList.contains("is-selected"), false);
  assert.equal(heat.getAttribute("fill"), originalFill, "Reset must restore the cell's original heatmap colour");
  click(window, heat);
  const point = document.querySelector("#chart-e1 .mark[aria-label^='2021 · Cyclists:']");
  click(window, point);
  assert.match(document.getElementById("readout-e1").textContent, /20\.7%.*percentage points/);
  document.querySelector('[data-download="q1"]').click();
  assert.equal(page.downloadName(), "q1-hospitalisation-data.csv");
  assert.ok(page.downloaded().size > 150, "CSV must include the actual values");
  const csv = await new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(page.downloaded());
  });
  assert.match(csv, /"2019","39866"/, "CSV must preserve the selected year's unformatted source count");
  assert.equal(csv.trim().split(/\r?\n/).length, 12, "CSV must include all 11 years and a header");
  await page.resize(width === 330 ? 740 : 330);
  assert.equal(document.querySelectorAll(".chart-host svg").length, 9, "Resizing must not duplicate SVGs");
  assert.match(document.getElementById("readout-q5").textContent, /19,524/, "Selection survives resizing");
  assert.equal(document.querySelectorAll("#chart-q5 .is-selected").length, 1);
  document.querySelector(".supplementary").open = true;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.match(document.getElementById("readout-e2").textContent, /1,376/, "Expanding deeper analysis preserves selection");
  assert.deepEqual(page.errors, []);
  page.dom.window.close();
  console.log("PASS at chart width " + width + ": all nine charts, map/ACT, averages, click, keyboard, reset, CSV, resize, exact explanations and headings.");
}

(async () => {
  assert.equal(questions.length, 5);
  assert.equal(data.q1.reduce((sum, row) => sum + row.value, 0) / 11, 37353.09090909091);
  assert.equal(data.q2.reduce((sum, row) => sum + row.value, 0), 39035);
  await verifyWidth(740);
  await verifyWidth(330);
  const degraded = await loadPage(740, true);
  assert.equal(degraded.document.querySelectorAll(".chart-host svg").length, 8);
  assert.match(degraded.document.querySelector("#chart-q2 .error-message").textContent, /map could not load/);
  assert.equal(degraded.document.querySelectorAll("#table-q2 tbody tr").length, 8);
  degraded.dom.window.close();
  console.log("PASS graceful map-load failure: other charts and state data remain usable.");
})().catch(error => { console.error(error); process.exitCode = 1; });
