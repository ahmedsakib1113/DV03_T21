# COS30045-Data-Visualization-Project
Group project for COS30045 Data Visualisation at Swinburne Sarawak.

## [🌐 View the interactive website](https://ahmedsakib1113.github.io/DV03_T21/)

Click the link to explore the Australia map, interactive charts, and the chart analysis directly in your browser. No download is needed.

JavaScript files:

- `js/d3-charts.js`: D3 chart rendering, data loading, tooltips, selection, tables, CSV downloads, and resizing.
- `js/global-filters.js`: shared filter state, joint data aggregation, and filtered chart explanations.
- `js/main.js`: page startup and navigation highlighting.
- `assets/vendor/d3.v7.min.js`: the D3 library used by the chart code.

The filter bar at the top applies year, road-user/vehicle group, sex, and age to all nine questions, including the figures at the top, explanations, tables, and CSV downloads. It defaults to all years (2011–2021) and all groups. Reset restores this selection. Q3 retains a comparison/trend display control; its trend also follows the shared year selection.

Q2 supports year plus at most one demographic filter because the source has no joint state-level demographic table. Unsupported combinations show a message, and suppressed state counts remain labelled as not published. E2 compares the selected year with 2011; all years compares 2021 with 2011.

To refresh the chart inputs, run `python scripts/build-chart-data.py`, then `python scripts/build-global-data.py`. The latter validates the workbook records against the existing CSV charts. See `data/README.md` for sources and denominator definitions.
