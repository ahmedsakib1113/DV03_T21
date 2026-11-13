# Data

Place verified source data and KNIME-exported CSV files here. Record file names, sheets, access dates, definitions, and processing steps in the Design Book. Do not add fabricated analysis results or personal participant information.

`chart-data.json` contains Q1–Q5 and E1–E3 values read directly from Yibo’s latest KNIME-exported CSVs under the matching `Yibo data/Q*` and `Yibo data/E*` folders. Rebuild it with `python scripts/build-chart-data.py` from the repository root. The JSON records each CSV filename and the conversion method; the original workbooks remain listed as underlying references. The builder verifies unique labels, year coverage, age and road-user totals, E1/E3 percentages against their exported counts, and every E2 change against 2021 minus 2011. Source CSV files are read without modification.

`australian-states.geojson` contains all eight state and territory boundaries from [Rowan Hogan’s Australian states collection](https://github.com/rowanhogan/australian-states/blob/master/states.geojson), retrieved 13 November 2026. It supplies geometry only; map counts come directly from `Yibo data/Q2/Q2_state_territory_hospitalisations_2021.csv`. State codes are mapped to their full names for the map.

`yibo-explanations.json` records the nine explanation blocks that were present before the interactive rebuild. It is a preservation baseline for `scripts/verify-site.cjs`; the page retains those blocks verbatim.

Averages use the displayed observations: 11 years (Q1); eight jurisdictions (Q2); seven known age groups (Q3); 11 years separately for males and females (Q4); five road-user groups including Other or unknown (Q5). Percentages use full precision until displayed. Counts and shares do not measure population or travel-exposure-adjusted risk.
