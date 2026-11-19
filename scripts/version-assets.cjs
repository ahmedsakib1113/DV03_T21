/* Run after changing site assets: node scripts/version-assets.cjs */
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const assets = [
  "css/style.css", "assets/vendor/d3.v7.min.js", "js/global-filters.js", "js/d3-charts.js", "js/main.js",
  "data/chart-data.json", "data/global-data.json", "data/australian-states.geojson"
];

function assetVersion() {
  const hash = createHash("sha256");
  assets.forEach(file => hash.update(file + "\n" + fs.readFileSync(path.join(root, file), "utf8").replaceAll("\r\n", "\n") + "\n"));
  return hash.digest("hex").slice(0, 12);
}

if (require.main === module) {
  const version = assetVersion();
  const file = path.join(root, "index.html");
  let html = fs.readFileSync(file, "utf8");
  html = html.replace(/<html\b[^>]*>/, tag => tag.replace(/\sdata-asset-version="[^"]*"/, "").replace(/>$/, ' data-asset-version="' + version + '">'));
  assets.filter(file => /\.(css|js)$/.test(file)).forEach(asset => {
    const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    html = html.replace(new RegExp('((?:src|href)=")' + escaped + '(?:\\?[^"\\s]*)?"', "g"), '$1' + asset + '?v=' + version + '"');
  });
  fs.writeFileSync(file, html);
  console.log("Versioned styles, scripts, and chart data: " + version);
}

module.exports = { assetVersion };
