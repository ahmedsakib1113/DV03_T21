# COS30045-Data-Visualization-Project
Group project for COS30045 Data Visualisation at Swinburne Sarawak.

## [🌐 View the interactive website](https://ahmedsakib1113.github.io/DV03_T21/)

## Project structure

| Path | Purpose |
| --- | --- |
| `index.html` | Research questions, chart containers, and reference explanations |
| `css/style.css` | Page layout, chart styles, and responsive rules |
| `js/main.js` | Page startup, navigation, and chart analysis order |
| `js/global-filters.js` | Full-dataset aggregation and calculated explanations |
| `js/d3-charts.js` | D3 rendering, selection, tooltips, tables, and CSV downloads |
| `data/` | Processed chart values and Australian state boundaries; see [data notes](data/README.md) |
| `assets/vendor/` | Local D3 library and its licence |
| `scripts/` | Data builders, asset versioning, and site checks |
| `Yibo data/` | Original workbooks, CSV exports, chart images, and investigation materials |
| `PROJECT_PLAN.md` | Team plan and research questions |

## Run locally

Open `index.html` with VS Code Live Server, or run `python -m http.server 8000` from this folder and visit <http://localhost:8000>. The charts fetch JSON files, so use a local server.

## Maintain and verify

After changing styles, scripts, or chart data, refresh the asset version:

```powershell
node scripts/version-assets.cjs
```

Run the existing interaction and HTTP loading checks with Node.js and an installed `jsdom` package:

```powershell
node scripts/verify-site.cjs
node scripts/verify-loading.cjs
```

Both checks also accept the path to an existing `jsdom` package as their first argument. Data rebuilding commands and source definitions are documented in [data/README.md](data/README.md).

