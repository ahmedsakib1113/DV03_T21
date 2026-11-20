# Chart data and shared filters

`chart-data.json` contains the original Q1–Q5 and E1–E3 values from the supplied KNIME CSV exports. Rebuild it with `python scripts/build-chart-data.py`. It remains the reference for source reconciliation and the fallback if shared filter data cannot load.

`global-data.json` supplies the shared year, road-user/vehicle group, sex, and age filters. Rebuild it after the reference data with `python scripts/build-global-data.py`. The builder reads the supplied workbooks without modifying them:

- National: `Yibo data/Dataset/hospitalisation_injury_publication_sep2023.xlsx`, sheet `raw`, restricted to Cause of injury = Traffic. Counts use Hospitalisations (column M), and reported bed days use Bed days (column J), matching the existing exports. Joint cells retain year, age, sex, and detailed road user. Vehicle occupants combine car, heavy transport, pick-up/van, and bus occupants.
- States: `Yibo data/Dataset/state-and-territory-hospitalisation-injury-publication-2023.xlsx`, sheet `raw`. Separate tables supply total, road-user, sex, and age counts by year and jurisdiction. They are not joined to infer demographic intersections.

The builder verifies every annual national and male/female total, the 2021 age/road-user/jurisdiction counts, all 28 original E2 changes, and every E3 2016–2021 hospitalisation and bed-day share against `chart-data.json`. Suppressed `n.p.` state values become null. If any component of a yearly or grouped state value is suppressed, the aggregate remains null. Missing classifications are retained as separate categories; state residuals are calculated only when every required component is published.

The shared filters default to all years (2011–2021) and all groups. Q1 retains all 11 years for the road-user, sex, and age cohort, highlighting the chosen year instead of removing other years; its average and CSV use that full context. Other charts, including Q3's trend, restrict data to the selected year. Choosing one road-user group or sex can produce a 100% share within that selected cohort. Years with no matching cases have undefined shares, represented by nulls and omitted points. Zero-case selections show a message instead of invalid geometry; Q1 retains a nonzero full trend even when the highlighted year has zero cases.

Q2 can combine year with at most one of road-user group, sex, or age. Other combinations show an unavailable-data message and disable that chart's CSV download. Grey map regions and table/CSV labels identify unpublished values. Jurisdiction totals may differ from the national total because of unrecorded or migratory/offshore residence. Averages exclude unpublished jurisdictions.

Q4 compares male and female hospitalisations with mirrored bars by age group. Other / not recorded cases are disclosed separately in the explanation when both sexes are shown, without assigning them to either sex. Selecting a single sex shows that classification's counts.

E1 calculates road-user shares within the matching annual counts. Q5 displays the age-by-road-user changes originally exported as E2: selected year minus 2011, or 2021 minus 2011 for All years. Demographic filters apply to both comparison years. E3 charts use reported hospitalisation and bed-day shares for the shared period, including 2011–2015 when selected; their denominators are the matching totals for each metric. Bed days use the reported source field and are not silently redefined by subtracting other fields.

Averages are arithmetic means over the displayed years, groups, or published jurisdictions. Filtered CSVs include the comparison period and all active filter values. Age bands have unequal widths; counts and shares are not population- or exposure-adjusted risks.

Reference explanations are embedded in `index.html` and remain available if shared data cannot load. After loading, all eight explanation panels are calculated for the active filters. `scripts/verify-site.cjs` checks shared year propagation, joint filters, source totals, zero cases, map coverage/suppression, downloads, selection, keyboard input, resetting, resizing, and absence of personal names in visible website text.

`australian-states.geojson` supplies boundary geometry only, from the [Australian states collection](https://github.com/rowanhogan/australian-states/blob/master/states.geojson), retrieved 13 November 2026. Numeric counts come from the supplied workbook.
