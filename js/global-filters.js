"use strict";

// Shared filter state and data aggregation. D3 drawing stays in d3-charts.js.
window.RoadInsightFilters = (() => {
  const sum = (rows, field = "cases") => rows.reduce((total, row) => total + row[field], 0);
  const count = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat("en-AU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const pct = value => decimal.format(value) + "%";

  function init({ data, base, update, explain }) {
    const controls = {};
    const state = { year: "all", group: "all", sex: "all", age: "all" };
    const definitions = {
      year: ["All years · 2011–2021", data.years],
      group: ["All road-user groups", data.groups],
      sex: ["All sex classifications", data.sexes],
      age: ["All age groups", data.ages]
    };
    Object.entries(definitions).forEach(([key, [label, values]]) => {
      const select = document.getElementById("filter-" + key);
      select.replaceChildren(new Option(label, "all"), ...values.map(value => new Option(value, value)));
      select.disabled = false;
      select.value = "all";
      controls[key] = select;
      select.addEventListener("change", () => {
        state[key] = select.value;
        apply();
      });
    });
    const view = document.getElementById("q3-view");
    view.disabled = false;
    view.addEventListener("change", apply);
    document.getElementById("reset-filters").disabled = false;
    document.getElementById("reset-filters").addEventListener("click", () => {
      Object.keys(state).forEach(key => { state[key] = "all"; controls[key].value = "all"; });
      view.value = "comparison";
      apply();
    });

    function matches(row, includeYear = true) {
      return (!includeYear || state.year === "all" || row.year === state.year) &&
        ["group", "sex", "age"].every(key => state[key] === "all" || row[key] === state[key]);
    }

    function grouped(rows, field, labels, metric = "cases") {
      return labels.map(label => ({ label, value: sum(rows.filter(row => row[field] === label), metric) }));
    }

    function apply() {
      const years = state.year === "all" ? data.years : [state.year];
      const period = state.year === "all" ? "2011–2021" : state.year;
      const records = data.records.filter(row => matches(row));
      const cohort = data.records.filter(row => matches(row, false));
      const groups = state.group === "all" ? data.groups : [state.group];
      const ages = state.age === "all" ? data.ages.filter(age => age !== "Unknown" || records.some(row => row.age === age && row.cases > 0)) : [state.age];
      const sexes = state.sex === "all" ? data.sexes.filter(sex => sex !== "Other / not recorded" || records.some(row => row.sex === sex && row.cases > 0)) : [state.sex];
      const total = sum(records), beds = sum(records, "beds");
      const selection = { ...state };
      const scope = period + " · " + (state.group === "all" ? "All road users" : state.group) + " · " +
        (state.sex === "all" ? "All sex classifications" : state.sex) + " · " + (state.age === "all" ? "All ages" : "Age " + state.age);
      const empty = total === 0 ? "No hospitalisations match these filters. Choose another selection or reset the filters." : null;
      const riskNote = "Counts and shares are not adjusted for population size or travel exposure and do not measure individual risk.";
      const status = document.getElementById("global-filter-status");
      status.textContent = scope + ". " + count.format(total) + " hospitalisations match. Q1 keeps the full trend and highlights the selected year; other questions filter to that year.";
      document.getElementById("filtered-total").textContent = count.format(total);
      document.getElementById("filtered-beds").textContent = count.format(beds);
      document.getElementById("annual-average").textContent = decimal.format(total / years.length);
      document.querySelectorAll(".snapshot .metric-label").forEach(label => { label.textContent = period; });

      function show(key, rows, config, options = {}) {
        const applied = { period, scope, filters: selection, unavailable: empty, ...options };
        update(key, rows, config, applied);
        const section = document.getElementById(key);
        const caption = section.querySelector(".chart-caption");
        const chartScope = options.scope || scope;
        caption.textContent = (options.caption || "Hospitalisations") + " · " + chartScope + " · Source: BITRE";
        section.querySelector(".chart-host").setAttribute("aria-label", caption.textContent);
        section.querySelector(".chart-filter-scope").textContent = options.unavailable || chartScope;
      }

      const annual = grouped(cohort, "year", data.years);
      const trendTotal = sum(cohort);
      const trendScope = "2011–2021" + scope.slice(period.length) + (state.year === "all" ? "" : " · Highlighted year: " + state.year);
      show("q1", annual, {
        type: "yearly-histogram", percent: false, averageTitle: "Average per year · 2011–2021",
        averageNote: "Arithmetic mean across all 11 years for the selected road-user, sex, and age filters.", tableLabel: "Year"
      }, { caption: "Annual hospitalisations · full trend", scope: trendScope, period: "2011–2021",
        filterSelection: state.year === "all" ? null : { label: state.year, series: "value" },
        unavailable: trendTotal === 0 ? "No hospitalisations match these road-user, sex, and age filters in any year." : null });
      const peak = annual.reduce((best, row) => row.value > best.value ? row : best, annual[0]);
      explain("q1", [trendTotal ? (state.year === "all" ? "Across 2011–2021, the selected group recorded " + count.format(trendTotal) + " hospitalisations." :
        "The highlighted " + state.year + " bar shows " + count.format(total) + " hospitalisations for the selected group. All 11 years remain visible for comparison.") +
        " The highest annual count was " + count.format(peak.value) + " in " + peak.label +
        ". The dashed line shows the average across all 11 years: " + decimal.format(trendTotal / data.years.length) + "." :
        "No hospitalisations match these demographic filters in any year.", riskNote]);

      const dimensions = ["group", "sex", "age"].filter(key => state[key] !== "all");
      const mapUnavailable = dimensions.length > 1 ?
        "The source does not provide joint state counts for these demographic filters. Choose at most one of road-user group, sex or age to view the map." : null;
      const mapDimension = dimensions[0] || "total";
      const mapLabel = dimensions.length ? state[mapDimension] : "all";
      const mapRows = base.q2.map(row => {
        const cells = data.states.filter(cell => years.includes(cell.year) && cell.state === row.code && cell.dimension === mapDimension && cell.label === mapLabel);
        return { label: row.label, code: row.code,
          value: cells.length !== years.length || cells.some(cell => cell.cases === null) ? null : sum(cells) };
      });
      const published = mapRows.filter(row => row.value !== null);
      show("q2", mapUnavailable ? [] : mapRows, {
        type: "map", percent: false, averageTitle: "Average per published jurisdiction · " + period,
        averageNote: "Arithmetic mean across " + published.length + " published jurisdiction totals. Suppressed counts are excluded.", tableLabel: "State / territory"
      }, { caption: "Hospitalisations by state and territory", unavailable: mapUnavailable });
      const highestState = published.reduce((best, row) => !best || row.value > best.value ? row : best, null);
      explain("q2", [mapUnavailable || (highestState ?
        "For " + scope + ", " + highestState.label + " has the highest published jurisdiction count at " + count.format(highestState.value) +
        ". Darker shading represents higher counts; grey regions are not published for the selected period." :
        "No jurisdiction counts are published for this selection."),
        "State totals exclude unrecorded or migratory/offshore residence and may differ from the national count. Source-suppressed values are never treated as zero. " + riskNote]);

      const ageTrend = view.value === "trend";
      const ageRows = ageTrend ? years.map(year => ({ label: year,
        ...Object.fromEntries(ages.map(age => [age, sum(records.filter(row => row.year === year && row.age === age))])) })) : grouped(records, "age", ages);
      show("q3", ageRows, {
        type: ageTrend ? "lines" : "bars", horizontal: true, percent: false,
        averageTitle: ageTrend ? "Average per selected year, by age" : "Average per displayed age group",
        averageNote: ageTrend ? "Each mean uses " + years.length + " selected annual counts." : "Arithmetic mean across the displayed age groups; age bands have unequal widths.",
        tableLabel: ageTrend ? "Year" : "Age group"
      }, { series: ageTrend ? ages : ["value"], caption: ageTrend ? "Age-group trend" : "Hospitalisations by age group" });
      const ageTotals = grouped(records, "age", ages);
      const topAge = ageTotals.reduce((best, row) => row.value > best.value ? row : best, ageTotals[0]);
      explain("q3", [total ? "For " + scope + ", " + (topAge.label === "Unknown" ? "people with unknown age" : "people aged " + topAge.label) +
        " recorded " + count.format(topAge.value) + " hospitalisations" + (ages.length > 1 ? ", the highest displayed age-group total" : "") +
        ". " + (ageTrend ? "The trend view follows only the years selected in the shared filter. Select all years for the full trend." :
        "The dashed line shows the average across the displayed age groups.") : empty,
        "Age bands have unequal widths. " + riskNote]);

      const sexRows = groups.map(label => ({ label, ...Object.fromEntries(sexes.map(sex => [sex,
        sum(records.filter(row => row.group === label && row.sex === sex))])) }));
      const sexTotals = Object.fromEntries(sexes.map(sex => [sex, sum(records.filter(row => row.sex === sex))]));
      const sexAverages = Object.fromEntries(sexes.map(sex => [sex, sexTotals[sex] / years.length]));
      show("q4", sexRows, {
        type: "sex-composition", percent: false, averageTitle: "Average per selected year, by sex · " + period,
        averageNote: "Each mean uses " + years.length + " selected annual counts.", tableLabel: "Road-user group"
      }, { series: sexes, sexTotals, averages: sexAverages, interactionRows: [{ label: "All selected road users", ...sexTotals }, ...sexRows],
        caption: "Sex shares and road-user composition" });
      explain("q4", [total ? "For " + scope + ", the recorded counts are " + sexes.map(sex => sex + ": " + count.format(sexTotals[sex]) +
        " (" + pct(sexTotals[sex] / total * 100) + ")").join("; ") +
        ". The stacked bar uses the total matching count. Each pie shows road-user composition within its own sex classification." : empty,
        "Other / not recorded includes classifications outside male and female, as supplied in the source. A zero-count classification has no pie. " + riskNote]);

      const roadRows = grouped(records, "group", groups);
      show("q5", roadRows, {
        type: "bars", horizontal: true, percent: false, averageTitle: "Average per displayed road-user group · " + period,
        averageNote: "Arithmetic mean across the displayed road-user groups.", tableLabel: "Road-user group"
      }, { caption: "Hospitalisations by road-user group" });
      explain("q5", [total ? "For " + scope + ", the road-user counts are " + roadRows.map(row => row.label + ": " + count.format(row.value) +
        " (" + pct(row.value / total * 100) + ")").join("; ") + ". The horizontal bars compare counts. Select a bar to compare it with the average across the displayed groups." : empty, riskNote]);

      const shares = years.map(year => {
        const rows = records.filter(row => row.year === year), denominator = sum(rows);
        return { label: year, ...Object.fromEntries(groups.map(group => [group,
          denominator ? sum(rows.filter(row => row.group === group)) / denominator * 100 : null])) };
      });
      show("e1", shares, {
        type: "lines", percent: true, averageTitle: "Average annual share within the selected group",
        averageNote: "Each mean uses selected years with a nonzero matching total. Years with no cases have no defined share.", tableLabel: "Year"
      }, { series: groups, caption: "Annual road-user shares within the filtered total" });
      explain("e1", ["For " + scope + ", each annual percentage uses the hospitalisations matching all shared filters in that year as its denominator. " +
        "Selecting one road-user group makes its share 100% in years with cases. Years with no matching cases have no defined percentage.", riskNote]);

      const endYear = state.year === "all" ? data.years[data.years.length - 1] : state.year;
      const before = cohort.filter(row => row.year === "2011"), after = cohort.filter(row => row.year === endYear);
      const comparisonAges = state.age === "all" ? data.ages.filter(age => age !== "Unknown" || [...before, ...after].some(row => row.age === age && row.cases > 0)) : ages;
      const differences = comparisonAges.flatMap(age => groups.map(road => ({ age, road, label: age + " / " + road,
        value: sum(after.filter(row => row.age === age && row.group === road)) - sum(before.filter(row => row.age === age && row.group === road)) })));
      show("e2", differences, {
        type: "heatmap", percent: false, averageTitle: "Average change per displayed age × road-user cell",
        averageNote: "Arithmetic mean across the displayed differences; baseline year is 2011.",
        label: row => row.age + " / " + row.road, tableLabel: "Age / road-user group"
      }, { series: ["value"], period: "2011–" + endYear, comparisonEnd: endYear,
        unavailable: sum(before) + sum(after) === 0 ? "No matching cases occur in either comparison year." : null,
        caption: "Change in hospitalisations · " + endYear + " minus 2011" });
      const largestChange = differences.reduce((best, row) => Math.abs(row.value) > Math.abs(best.value) ? row : best, differences[0]);
      explain("e2", ["For " + scope + ", " + (largestChange.value === 0 ? "all displayed cells have zero change" :
        "the largest absolute change is " + count.format(Math.abs(largestChange.value)) +
        (largestChange.value > 0 ? " additional" : " fewer") + " hospitalisations for " + largestChange.age + " / " + largestChange.road) +
        ". Each cell shows the matching " + endYear + " count minus the matching 2011 count for an age and road-user group. " +
        "The sex, age, and road-user filters apply to both years. Selecting all years compares 2021 with 2011; selecting 2011 gives zero change.", riskNote]);

      [["e3a", "group", groups, "Road-user group"], ["e3b", "age", ages, "Age group"]].forEach(([key, dimension, labels, tableLabel]) => {
        const rows = labels.map(label => ({ label,
          Hospitalisations: total ? sum(records.filter(row => row[dimension] === label)) / total * 100 : null,
          "Bed days": beds ? sum(records.filter(row => row[dimension] === label), "beds") / beds * 100 : null }));
        show(key, rows, {
          type: "bars", horizontal: true, percent: true, averageTitle: "Average share per displayed " + tableLabel.toLowerCase(),
          averageNote: "Each mean uses the displayed groups and the selected period.", tableLabel
        }, { series: ["Hospitalisations", "Bed days"], unavailable: total === 0 || beds === 0 ?
          "Hospitalisation and bed-day shares require nonzero matching totals." : null,
          caption: "Hospitalisation and reported bed-day shares" });
        const largestGap = rows.reduce((best, row) => Math.abs(row["Bed days"] - row.Hospitalisations) >
          Math.abs(best["Bed days"] - best.Hospitalisations) ? row : best, rows[0]);
        explain(key, [total > 0 && beds > 0 ? "For " + scope + ", " + largestGap.label + " shows the largest absolute difference between the displayed shares: " +
          pct(largestGap.Hospitalisations) + " of hospitalisations and " + pct(largestGap["Bed days"]) + " of reported bed days (" +
          decimal.format(Math.abs(largestGap["Bed days"] - largestGap.Hospitalisations)) + " percentage points)." :
          "Shares cannot be calculated because the matching hospitalisation or reported bed-day total is zero.",
          "Hospitalisation shares use the matching hospitalisation total; bed-day shares use the matching reported bed-day total for " +
          scope + ". Selecting one " + tableLabel.toLowerCase() + " gives it 100% of each nonzero total.",
          "Bed days describe hospital resource use. Length of stay also depends on treatment, other health conditions, and discharge arrangements, so these shares are not direct measures of injury severity."]);
      });
      document.documentElement.dataset.filterYear = state.year;
      document.documentElement.dataset.filtersReady = "true";
    }
    apply();
  }
  return { init };
})();
