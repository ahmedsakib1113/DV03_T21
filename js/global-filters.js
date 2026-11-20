"use strict";

// Aggregate the selected year for the question charts. D3 drawing stays in d3-charts.js.
window.RoadInsightFilters = (() => {
  const sum = (rows, field = "cases") => rows.reduce((total, row) => total + row[field], 0);
  const count = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat("en-AU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const pct = value => decimal.format(value) + "%";

  function init({ data, base, update, explain }) {
    const stateTotals = data.states.filter(row => row.dimension === "total" && row.label === "all");
    const annualStateMax = Math.max(1, ...stateTotals.map(row => row.cases ?? 0));
    const annualMapDomain = [0, Math.ceil(annualStateMax / 1000) * 1000];
    const comparisonAges = data.ages.filter(age => age !== "Unknown" || data.records.some(row => row.age === age && row.cases > 0));
    const comparisonTotals = new Map();
    data.records.forEach(row => {
      const key = [row.year, row.age, row.group].join("|");
      comparisonTotals.set(key, (comparisonTotals.get(key) || 0) + row.cases);
    });
    const annualDifferences = new Map(data.years.map(year => [
      year,
      comparisonAges.flatMap(age => data.groups.map(road => {
        const baseline = comparisonTotals.get(["2011", age, road].join("|")) || 0;
        const current = comparisonTotals.get([year, age, road].join("|")) || 0;
        return { age, road, label: age + " / " + road, baseline, current, value: current - baseline };
      }))
    ]));
    const largestDifference = Math.max(1, ...[...annualDifferences.values()].flatMap(rows => rows.map(row => Math.abs(row.value))));
    const heatmapColorLimit = Math.ceil(largestDifference / 100) * 100;
    const yearInputs = [...document.querySelectorAll("[data-chart-year]")];
    const ageButtons = document.getElementById("q3-age-buttons");
    const formatAge = age => age.replace("-", "–");
    let selectedYear = "all";
    let selectedAge = "all";
    let renderAgeView;

    yearInputs.forEach(select => {
      select.append(...data.years.map(year => new Option(year, year)));
      select.value = selectedYear;
      select.disabled = false;
      select.addEventListener("change", () => {
        selectedYear = select.value;
        yearInputs.forEach(input => { input.value = selectedYear; });
        apply();
      });
    });

    const ageChoices = ["all", ...data.ages.filter(age => age !== "Unknown")];
    ageButtons.replaceChildren(...ageChoices.map(age => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.age = age;
      button.textContent = age === "all" ? "All ages" : formatAge(age);
      button.setAttribute("aria-controls", "chart-q3");
      button.addEventListener("click", () => {
        if (selectedAge === age) return;
        selectedAge = age;
        renderAgeView();
      });
      return button;
    }));
    ageButtons.hidden = false;

    const annual = data.years.map(label => ({ label, value: sum(data.records.filter(row => row.year === label)) }));
    const trendTotal = sum(annual, "value");
    const groups = data.groups;
    const sexes = ["Male", "Female"];

    function apply(includeSupplementary = false) {
      const allYears = selectedYear === "all";
      const years = allYears ? data.years : [selectedYear];
      const period = allYears ? "2011–2021" : selectedYear;
      const records = allYears ? data.records : data.records.filter(row => row.year === selectedYear);
      const ages = data.ages.filter(age => age !== "Unknown" || records.some(row => row.age === age && row.cases > 0));
      const total = sum(records), beds = sum(records, "beds");
      const empty = total === 0 ? "No hospitalisations are recorded for this period." : null;
      const riskNote = "Counts and shares are not adjusted for population size or travel exposure and do not measure individual risk.";

      function show(key, rows, config, options) {
        const chartScope = options.scope || period;
        update(key, rows, config, { period, yearFilter: selectedYear, unavailable: empty, ...options, scope: chartScope });
        const section = document.getElementById(key);
        const caption = section.querySelector(".chart-caption");
        caption.textContent = options.caption + " · " + chartScope + " · Source: BITRE";
        section.querySelector(".chart-host").setAttribute("aria-label", caption.textContent);
        section.querySelector(".chart-filter-scope").textContent = options.unavailable || chartScope;
        const kicker = section.querySelector(".analysis-kicker");
        if (kicker) kicker.textContent = "Key finding · " + (key === "q1" ? "2011–2021" : chartScope);
      }

      const trendScope = "2011–2021" + (allYears ? "" : " · Highlighted year: " + selectedYear);
      show("q1", annual, {
        type: "yearly-histogram", percent: false, averageTitle: "Average per year · 2011–2021",
        averageNote: "Arithmetic mean across all 11 years.", tableLabel: "Year"
      }, { caption: "Annual hospitalisations · full trend", scope: trendScope, period: "2011–2021",
        filterSelection: allYears ? null : { label: selectedYear, series: "value" },
        unavailable: trendTotal === 0 ? "No hospitalisations are recorded in this period." : null });
      const peak = annual.reduce((best, row) => row.value > best.value ? row : best, annual[0]);
      const firstYear = annual[0], lastYear = annual[annual.length - 1];
      const netChange = lastYear.value - firstYear.value;
      const trendChange = netChange === 0 ? "were unchanged at the two endpoints" : firstYear.value ?
        (netChange > 0 ? "increased" : "decreased") + " by " + count.format(Math.abs(netChange)) +
          " (" + pct(Math.abs(netChange) / firstYear.value * 100) + ")" :
        "increased by " + count.format(netChange) + " (percentage change unavailable because 2011 had zero cases)";
      explain("q1", [trendTotal ?
        "Between 2011 and 2021, road traffic hospitalisations " + trendChange +
        ", from " + count.format(firstYear.value) + " to " + count.format(lastYear.value) +
        ". The highest annual count was " + count.format(peak.value) + " in " + peak.label + "." +
        (allYears ? "" : " Your highlighted year, " + selectedYear + ", recorded " + count.format(total) + " cases.") :
        "No hospitalisations are recorded in this period.",
        "The dashed line shows the annual average across all 11 years (" +
        decimal.format(trendTotal / data.years.length) + "). " + riskNote]);

      const mapRows = base.q2.map(row => {
        const cells = stateTotals.filter(cell => years.includes(cell.year) && cell.state === row.code);
        return { label: row.label, code: row.code,
          value: cells.length !== years.length || cells.some(cell => cell.cases === null) ? null : sum(cells) };
      });
      const published = mapRows.filter(row => row.value !== null);
      show("q2", mapRows, {
        type: "map", percent: false, averageTitle: "Average per published jurisdiction · " + period,
        colorDomain: allYears ? null : annualMapDomain,
        averageNote: "Arithmetic mean across " + published.length + " published jurisdiction totals. Suppressed counts are excluded.", tableLabel: "State / territory"
      }, { caption: "Hospitalisations by state and territory", unavailable: null });
      const highestState = published.reduce((best, row) => !best || row.value > best.value ? row : best, null);
      const lowestState = published.reduce((best, row) => !best || row.value < best.value ? row : best, null);
      explain("q2", [highestState ?
        "For " + period + ", " + highestState.label + " recorded the highest published count (" +
        count.format(highestState.value) + ")" +
        (published.length > 1 ? ", while " + lowestState.label + " recorded the lowest (" +
          count.format(lowestState.value) + "). The difference was " +
          count.format(highestState.value - lowestState.value) + " hospitalisations." : ".") :
        "No jurisdiction counts are published for this selection.",
        "Darker map shading indicates higher counts; grey regions have unpublished or suppressed data. " +
        "State totals exclude unrecorded or migratory/offshore residence and may differ from the national count. " +
        "Suppressed values are not zero. " + riskNote]);

      function bubbleTotals(labels, rows, field) {
        return labels.map((label, colorIndex) => {
          const matching = rows.filter(row => row[field] === label);
          const value = sum(matching);
          const bedDays = sum(matching, "beds");
          return { label, value, bedDays, daysPerHospitalisation: value ? bedDays / value : null, colorIndex };
        }).filter(row => row.value > 0).sort((a, b) => b.value - a.value);
      }

      const ageTotals = bubbleTotals(ages, records, "age");
      const topAge = ageTotals[0];
      const runnersUp = ageTotals.slice(1, 3).map(row => formatAge(row.label) + " (" + count.format(row.value) + ")").join(" and ");
      renderAgeView = () => {
        const ageGroup = selectedAge === "all" ? null : selectedAge;
        const ageScope = ageGroup ? period + " · Ages " + formatAge(ageGroup) : period;
        const tableLabel = ageGroup ? "Road-user group" : "Age group";
        const rows = ageGroup ? bubbleTotals(groups, records.filter(row => row.age === ageGroup), "group") : ageTotals;
        const caption = "Hospitalisations and reported bed days by " + tableLabel.toLowerCase();
        [...ageButtons.children].forEach(button => button.setAttribute("aria-pressed", String(button.dataset.age === selectedAge)));
        show("q3", rows, {
          type: "age-bubble", percent: false,
          averageTitle: "Average count per " + tableLabel.toLowerCase(),
          averageNote: "Each displayed group contributes one total.",
          tableLabel
        }, { caption, scope: ageScope, yearFilter: null, ageGroup,
          unavailable: rows.length ? null : "No hospitalisations are recorded for this age group in " + period + "." });
        const bubbleGuide = "Farther right means more hospitalisations. Higher bubbles have more reported bed days per hospitalisation. Bubble size shows total reported bed days.";
        if (!rows.length) {
          explain("q3", ["No hospitalisations are recorded for " + (ageGroup ? "ages " + formatAge(ageGroup) + " in " : "") + period + ".", bubbleGuide]);
          return;
        }
        if (ageGroup) {
          const leading = rows[0];
          const highestRatio = rows.reduce((highest, row) => row.daysPerHospitalisation > highest.daysPerHospitalisation ? row : highest, leading);
          explain("q3", ["Among ages " + formatAge(ageGroup) + ", " + leading.label.toLowerCase() + " accounted for the most hospitalisations (" +
            count.format(leading.value) + " of " + count.format(sum(rows, "value")) + "). " + highestRatio.label + " had the highest reported bed days per hospitalisation (" +
            decimal.format(highestRatio.daysPerHospitalisation) + ").", bubbleGuide]);
          return;
        }
        explain("q3", [total ? "People aged " + formatAge(topAge.label) + " recorded the most hospitalisations (" +
          count.format(topAge.value) + ", or " + pct(topAge.value / total * 100) + " of the total), followed by ages " + runnersUp + "." : empty,
          bubbleGuide + " The age bands have unequal widths, and counts do not measure age-specific risk."]);
      };

      renderAgeView();

      const sexTotals = Object.fromEntries(sexes.map(sex => [sex, sum(records.filter(row => row.sex === sex))]));
      const otherTotal = sum(records.filter(row => row.sex === "Other / not recorded"));
      const sexAgeRows = ages.map(age => ({
        label: age,
        ...Object.fromEntries(sexes.map(sex => [sex, sum(records.filter(row => row.age === age && row.sex === sex))]))
      }));
      const sexTotal = sexes.reduce((running, sex) => running + (sexTotals[sex] || 0), 0);
      const q4Unavailable = sexTotal === 0 ?
        "No male or female hospitalisations are recorded for " + period + "." : null;
      show("q4", sexAgeRows, {
        type: "mirrored", percent: false, averageTitle: "Average per age group · " + period,
        averageNote: "Separate averages for each displayed sex across the selected age groups.",
        tableLabel: "Age group"
      }, { series: sexes, caption: "Hospitalisations by age group and sex", unavailable: q4Unavailable });
      const maleTotal = sexTotals.Male || 0;
      const femaleTotal = sexTotals.Female || 0;
      const largestSexGap = sexAgeRows.reduce((best, row) => !best || Math.abs(row.Male - row.Female) >
        Math.abs(best.Male - best.Female) ? row : best, null);
      const sexDifference = Math.abs(maleTotal - femaleTotal);
      const sexLeader = maleTotal === femaleTotal ? "equal counts" : (maleTotal > femaleTotal ? "more among males" : "more among females");
      const sexSummary = "For " + period + ", males recorded " + count.format(maleTotal) + " and females recorded " +
          count.format(femaleTotal) + " hospitalisations. The difference was " +
          count.format(sexDifference) + " (" + sexLeader + "); males accounted for " +
          (sexTotal ? pct(maleTotal / sexTotal * 100) : "an unavailable share") +
          " of cases recorded as male or female." +
          (largestSexGap ? " The largest male–female gap was in the " + largestSexGap.label +
            " age group (" + count.format(Math.abs(largestSexGap.Male - largestSexGap.Female)) + " cases)." : "");
      const otherNote = otherTotal > 0 ?
        " Other / not recorded: " + count.format(otherTotal) +
        " cases are excluded from the male/female comparison." : "";
      explain("q4", [q4Unavailable || sexSummary + otherNote,
        "The mirrored bars place male counts on the left and female counts on the right for each age group. " +
        "Counts are not adjusted for population size or travel exposure; age bands have unequal widths. " + riskNote]);

      const endYear = allYears ? data.years.at(-1) : selectedYear;
      const differences = annualDifferences.get(endYear);
      const comparisonScope = "2011–" + endYear;
      show("q5", differences, {
        type: "heatmap", percent: false, averageTitle: "Average change per displayed age × road-user cell",
        colorLimit: heatmapColorLimit,
        averageNote: "Arithmetic mean across the displayed differences; baseline year is 2011.",
        label: row => row.age + " / " + row.road, tableLabel: "Age / road-user group"
      }, { period: comparisonScope, comparisonEnd: endYear, scope: comparisonScope, annualDifferences,
        caption: "Change in hospitalisations · " + endYear + " minus 2011" });
      const largestRise = differences.reduce((best, row) =>
        row.value > 0 && (!best || row.value > best.value) ? row : best, null);
      const largestFall = differences.reduce((best, row) =>
        row.value < 0 && (!best || row.value < best.value) ? row : best, null);
      const changeSummary = largestRise || largestFall ?
        (largestRise ? "The largest increase was " + count.format(largestRise.value) +
          " hospitalisations for " + largestRise.age + " / " + largestRise.road + ". " :
          "No displayed group increased. ") +
        (largestFall ? "The largest decrease was " + count.format(Math.abs(largestFall.value)) +
          " for " + largestFall.age + " / " + largestFall.road + "." :
          "No displayed group decreased.") :
        "All displayed age and road-user groups had zero change.";
      explain("q5", [differences.length ?
        "For " + comparisonScope + ", " + changeSummary :
        "No age and road-user comparisons are available for this selection.",
        "Each cell is the matching " + endYear + " count minus its 2011 count. Both years include all demographic groups; " +
        "selecting 2011 gives zero change. Teal shows decreases, orange shows increases, and neutral cells show no change. " + riskNote]);

      if (!includeSupplementary) return;

      const shares = years.map(year => {
        const rows = records.filter(row => row.year === year), denominator = sum(rows);
        return { label: year, ...Object.fromEntries(groups.map(group => [group,
          denominator ? sum(rows.filter(row => row.group === group)) / denominator * 100 : null])) };
      });
      show("e1", shares, {
        type: "lines", percent: true, averageTitle: "Average annual share within the selected group",
        averageNote: "Each mean uses selected years with a nonzero matching total. Years with no cases have no defined share.", tableLabel: "Year"
      }, { series: groups, caption: "Annual road-user shares of the national total" });
      explain("e1", ["For " + period + ", each annual percentage uses the national hospitalisation total in that year as its denominator. " +
        "Years with no hospitalisations have no defined percentage.", riskNote]);

      [["e3a", "group", groups, "Road-user group"], ["e3b", "age", ages, "Age group"]].forEach(([key, dimension, labels, tableLabel]) => {
        const rows = labels.map(label => ({ label,
          Hospitalisations: total ? sum(records.filter(row => row[dimension] === label)) / total * 100 : null,
          "Bed days": beds ? sum(records.filter(row => row[dimension] === label), "beds") / beds * 100 : null }));
        show(key, rows, {
          type: "horizontal", percent: true, averageTitle: "Average share per displayed " + tableLabel.toLowerCase(),
          averageNote: "Each mean uses the displayed groups and the selected period.", tableLabel
        }, { series: ["Hospitalisations", "Bed days"], unavailable: total === 0 || beds === 0 ?
          "Hospitalisation and bed-day shares require nonzero matching totals." : null,
          caption: "Hospitalisation and reported bed-day shares" });
        const largestGap = rows.reduce((best, row) => Math.abs(row["Bed days"] - row.Hospitalisations) >
          Math.abs(best["Bed days"] - best.Hospitalisations) ? row : best, rows[0]);
        explain(key, [total > 0 && beds > 0 ? "For " + period + ", " + largestGap.label + " shows the largest absolute difference between the displayed shares: " +
          pct(largestGap.Hospitalisations) + " of hospitalisations and " + pct(largestGap["Bed days"]) + " of reported bed days (" +
          decimal.format(Math.abs(largestGap["Bed days"] - largestGap.Hospitalisations)) + " percentage points)." :
          "Shares cannot be calculated because the matching hospitalisation or reported bed-day total is zero.",
          "Hospitalisation shares use the matching hospitalisation total; bed-day shares use the matching reported bed-day total for " +
          period + ".",
          "Bed days describe hospital resource use. Length of stay also depends on treatment, other health conditions, and discharge arrangements, so these shares are not direct measures of injury severity."]);
      });
      document.documentElement.dataset.filtersReady = "true";
    }
    apply(true);
  }
  return { init };
})();
