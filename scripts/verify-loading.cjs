/* node scripts/verify-loading.cjs <jsdom-package-path> [published-url] */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { JSDOM, VirtualConsole } = require(process.argv[2] || "jsdom");
const { assetVersion } = require("./version-assets.cjs");
const root = path.resolve(__dirname, "..");
const version = assetVersion();

(async () => {
  let server, dom;
  const errors = [];
  try {
    let address = process.argv[3];
    if (!address) {
      server = http.createServer(async (request, response) => {
        const url = new URL(request.url, "http://localhost");
        const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        if (!/^(index\.html|css\/style\.css|js\/[\w-]+\.js|data\/[\w.-]+\.(json|geojson)|assets\/vendor\/d3\.v7\.min\.js)$/.test(file)) {
          response.writeHead(404).end();
          return;
        }
        try {
          if (file !== "index.html") assert.equal(url.searchParams.get("v"), version, "Unversioned resource request: " + file);
          const content = await fs.readFile(path.join(root, file));
          const type = file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "text/javascript" : file.endsWith(".html") ? "text/html" : "application/json";
          response.writeHead(200, { "Content-Type": type + "; charset=utf-8" }).end(content);
        } catch (error) {
          errors.push(String(error));
          response.writeHead(500).end();
        }
      });
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      address = "http://127.0.0.1:" + server.address().port + "/";
    }
    const pageURL = new URL(address);
    pageURL.searchParams.set("v", version);
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", error => errors.push(error.message));
    virtualConsole.on("error", (...args) => errors.push(args.map(String).join(" ")));
    // Use real stylesheet/script loading and defer order, rather than window.eval.
    dom = await JSDOM.fromURL(pageURL.href, {
      resources: "usable", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole,
      beforeParse(window) {
        window.fetch = (url, options) => {
          const target = new URL(url, window.location.href);
          assert.equal(target.searchParams.get("v"), version);
          return fetch(target, options);
        };
      }
    });
    const { window } = dom, document = window.document;
    for (let i = 0; i < 200 && document.documentElement.dataset.chartsReady !== "true"; i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.deepEqual(errors, []);
    assert.equal(document.documentElement.dataset.assetVersion, version, "Deployment must serve the expected release");
    assert.equal(document.documentElement.dataset.chartsReady, "true", "The real page loading flow must finish");
    assert.equal(document.querySelectorAll(".snapshot, .interaction-guide, #shared-filter-panel, .question-filter-toggle, .question-filter-summary").length, 0);
    assert.equal(document.getElementById("q3-view"), null);
    assert.equal(window.getComputedStyle(document.getElementById("q3-age-buttons")).display, "flex");
    assert.equal(document.querySelectorAll(".chart-host svg").length, 8, "The page renders one SVG for each of its eight charts");
    assert.equal(document.querySelectorAll("#chart-q3 .bubble-point").length, 8);
    const ages816 = document.querySelector('#q3-age-buttons [data-age="8-16"]');
    const previousBubble = document.querySelector("#chart-q3 .bubble-point");
    ages816.click();
    assert.equal(ages816.getAttribute("aria-pressed"), "true");
    assert.equal(document.querySelectorAll("#chart-q3 .bubble-point").length, 5);
    const firstBubble = document.querySelector("#chart-q3 .bubble-point");
    assert.equal(Number(firstBubble.getAttribute("opacity")), 0, "Road-user bubbles start transparent");
    assert.equal(previousBubble.getAttribute("aria-hidden"), "true", "Outgoing age bubbles are excluded from interaction");
    for (let i = 0; i < 20 && Number(firstBubble.getAttribute("opacity")) === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(Number(firstBubble.getAttribute("opacity")) > 0, "Road-user bubbles fade into view");
    document.querySelector('#q3-age-buttons [data-age="all"]').click();
    assert.equal(document.querySelectorAll("#chart-q4 .mirror-bar").length, 16);
    assert.equal(document.querySelectorAll("#chart-q5 .heatmap-cell").length, 40);
    assert.equal(document.querySelectorAll("#chart-q5 .pie-panel").length, 0);
    assert.equal(document.querySelectorAll("#chart-q3 .bubble-point").length, 8);
    assert.equal(document.querySelectorAll("#chart-q1 .year-bin").length, 11);
    assert.deepEqual(errors, []);
    console.log("PASS real HTTP loading: release " + version + ", matching styles/scripts/data, deferred startup, complete chart data and Q3 age buttons at " + address);
  } finally {
    dom?.window.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
