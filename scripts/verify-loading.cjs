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
    assert.equal(document.getElementById("filter-year").disabled, false);
    assert.equal(window.getComputedStyle(document.querySelector(".global-filters")).paddingTop, "24px", "Shared filter styling must load");
    assert.equal(window.getComputedStyle(document.querySelector(".chart-filters")).display, "flex");
    assert.equal(document.querySelectorAll(".chart-host svg").length, 13);
    for (const [key, value, expected] of [["year", "2021", "39,505"], ["sex", "Female", "13,716"], ["group", "Motorcyclists", "992"]]) {
      const control = document.getElementById("filter-" + key);
      control.value = value;
      control.dispatchEvent(new window.Event("change", { bubbles: true }));
      assert.equal(document.getElementById("filtered-total").textContent, expected);
      assert.equal(document.querySelectorAll("#chart-q1 .year-bin").length, 11);
      const selectedYear = document.querySelector("#chart-q1 .year-bin.is-selected");
      assert.equal(selectedYear.__data__.row.label, "2021");
      assert.equal(selectedYear.__data__.row.value, Number(expected.replaceAll(",", "")));
    }
    document.getElementById("reset-filters").click();
    assert.equal(document.getElementById("filtered-total").textContent, "410,884");
    assert.deepEqual(errors, []);
    console.log("PASS real HTTP loading: release " + version + ", matching styles/scripts/data, deferred startup, enabled filters, year/sex/vehicle changes and reset at " + address);
  } finally {
    dom?.window.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
