# COS30045-Data-Visualization-Project
Group project for COS30045 Data Visualisation at Swinburne Sarawak.

The interactive website is available locally. A public shareable link has not been published yet.

Open `index.html` with VS Code **Live Server** to explore the website. Alternatively, run `python -m http.server 8000 --bind 127.0.0.1` from this folder and visit `http://127.0.0.1:8000`.

The page follows Q1–Q5 in `PROJECT_PLAN.md`. Q2 uses an Australian state and territory map. Click or tap chart marks to highlight them, reveal their values, and compare them with the labelled average. Enter and Space support keyboard selection. Each chart includes a reset button, values table, and CSV download. Yibo’s age-by-road-user heatmap (E2) appears directly below Q5 with its original yellow-to-red style and interactive cells. E1 and E3 remain available in the expandable section; all existing explanations are preserved verbatim.

The site uses a local copy of D3 7.9.0 (`assets/vendor/`), so chart rendering does not depend on a CDN. Chart values come directly from Yibo’s latest KNIME CSV exports. The underlying source workbooks remain unchanged under `Yibo data/Dataset/`. See `data/README.md` for data provenance and average definitions. Rebuild chart data with `python scripts/build-chart-data.py`.

To run the DOM interaction checks, provide an installed jsdom package: `node scripts/verify-site.cjs <path-to-jsdom-package>`. These checks cover rendering, map geometry, selection, averages, keyboard controls, reset, CSV download, resizing, question headings and explanation preservation. DOM tests do not replace a browser layout review.
