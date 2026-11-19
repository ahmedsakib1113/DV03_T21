"use strict";

// D3 charts: data loading, rendering, selection, tables, downloads, and resizing.
(() => {
  const controllers = new Map();
  const palette = ["#287c78", "#6076b5", "#8b6941", "#ad6b7c", "#87978a", "#79679c", "#a17335", "#687a86"];
  const roadIcons = ["🚗", "🏍️", "🚲", "🚶", "?"];
  const count = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat("en-AU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  let datasets;
  let filterData;

  function loadJSON(file) {
    const version = document.documentElement.dataset.assetVersion;
    return d3.json(file + (version ? "?v=" + encodeURIComponent(version) : ""));
  }

  function format(value, percent = false) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "Not available";
    return decimal.format(value) + (percent ? "%" : "");
  }

  function comparison(value, average, percent = false) {
    const difference = value - average;
    if (Math.abs(difference) < 0.000001) return "equal to the average";
    return decimal.format(Math.abs(difference)) + (percent ? " percentage points " : " hospitalisations ") +
      (difference > 0 ? "above" : "below") + " the average";
  }

  function showError(host, message) {
    host.replaceChildren();
    const note = document.createElement("p");
    note.className = "error-message";
    note.textContent = message;
    host.append(note);
  }

  function createChart(key, rows, config) {
    const host = document.getElementById("chart-" + key);
    const readout = document.getElementById("readout-" + key);
    const state = { key, rows, config, host, readout, selected: null, width: 0 };
    state.series = config.series || ["value"];
    state.averages = Object.fromEntries(state.series.map(series => [series, d3.mean(rows, row => row[series])]));
    state.defaultReadout = () => {
      readout.classList.remove("has-selection");
      readout.replaceChildren();
      if (state.unavailable) {
        readout.textContent = state.unavailable;
        return;
      }
      const label = document.createElement("span");
      label.className = "readout-label";
      label.textContent = config.averageTitle;
      readout.append(label);
      const text = state.series.map(series => (series === "value" ? "" : series + ": ") +
        format(state.averages[series], config.percent)).join(" · ");
      const strong = document.createElement("strong");
      strong.textContent = text;
      readout.append(strong, document.createTextNode(". " + config.averageNote));
    };
    state.describe = (row, series) => {
      if (row[series] === null) return row.label + ": not published for this selection.";
      if (state.config.type === "sex-composition") {
        const isTotal = row.label === "All selected road users";
        const denominator = isTotal ? d3.sum(Object.values(state.sexTotals)) : state.sexTotals[series];
        return row.label + " · " + series + ": " + count.format(row[series]) + " hospitalisations. " +
          (denominator ? format(row[series] / denominator * 100, true) : "No defined share") + " of " +
          (isTotal ? "matching cases" : series.toLowerCase() + " cases") +
          " · " + state.period + ".";
      }
      const label = config.label ? config.label(row) : row.label;
      return label + (series === "value" ? "" : " · " + series) + ": " +
        (config.percent ? format(row[series], true) : count.format(row[series])) + ". " +
        comparison(row[series], state.averages[series], config.percent) +
        " (" + format(state.averages[series], config.percent) + ").";
    };
    state.select = (row, series) => {
      const selection = { label: row.label, series };
      state.selected = state.selected && state.selected.label === selection.label &&
        state.selected.series === series ? state.filterSelection || null : selection;
      updateSelection(state);
    };
    controllers.set(key, state);
    document.querySelector('[data-reset="' + key + '"]').addEventListener("click", () => {
      state.selected = state.filterSelection || null;
      updateSelection(state);
    });
    document.querySelector('[data-download="' + key + '"]').addEventListener("click", () => downloadCSV(state));
    renderTable(state);
    state.defaultReadout();
    return state;
  }

  function updateSelection(state) {
    if (state.unavailable) {
      state.defaultReadout();
      return;
    }
    d3.select(state.host).selectAll(".mark")
      .classed("is-selected", d => Boolean(state.selected && d.row.label === state.selected.label && d.series === state.selected.series))
      .attr("aria-pressed", d => String(Boolean(state.selected && d.row.label === state.selected.label && d.series === state.selected.series)));
    d3.select(state.host).selectAll(".map-region-list button")
      .attr("aria-pressed", d => String(Boolean(state.selected && d.label === state.selected.label)));
    d3.select(state.host).selectAll(".pie-legend button")
      .attr("aria-pressed", d => String(Boolean(state.selected && d.row.label === state.selected.label && d.series === state.selected.series)));
    if (!state.selected) {
      state.defaultReadout();
      return;
    }
    const row = (state.interactionRows || state.rows).find(d => d.label === state.selected.label);
    if (row[state.selected.series] === null) {
      state.readout.textContent = row.label + ": this count is not published for the current selection.";
      return;
    }
    state.readout.classList.add("has-selection");
    state.readout.replaceChildren();
    const label = document.createElement("span");
    label.className = "readout-label";
    label.textContent = "Selected · " + (state.config.label ? state.config.label(row) : row.label) +
      (state.selected.series === "value" ? "" : " · " + state.selected.series);
    if (state.config.type === "sex-composition") {
      state.readout.append(label, document.createTextNode(state.describe(row, state.selected.series)));
      return;
    }
    const value = document.createElement("strong");
    value.textContent = state.config.percent ? format(row[state.selected.series], true) : count.format(row[state.selected.series]);
    const suffix = state.config.percent ? "" : state.key === "e2" ? " change in hospitalisations" : " hospitalisations";
    state.readout.append(label, value, document.createTextNode(suffix + " · " +
      comparison(row[state.selected.series], state.averages[state.selected.series], state.config.percent) +
      " (" + format(state.averages[state.selected.series], state.config.percent) + ")."));
  }

  function makeSvg(state, height) {
    state.host.replaceChildren();
    const width = Math.max(290, state.host.clientWidth || 740);
    state.width = width;
    const svg = d3.select(state.host).append("svg")
      .attr("viewBox", "0 0 " + width + " " + height)
      .attr("role", "group")
      .attr("aria-labelledby", "svg-title-" + state.key);
    svg.append("title").attr("id", "svg-title-" + state.key)
      .text(document.getElementById("heading-" + state.key).textContent);
    state.tooltip = d3.select(state.host).append("div").attr("class", "chart-tooltip").attr("aria-hidden", "true");
    return { svg, width, height };
  }

  function bindMarks(state, marks) {
    const tooltip = state.tooltip;
    function describe(event, item) {
      tooltip.style("display", "block").text(state.describe(item.row, item.series));
      if (event.type.startsWith("pointer")) {
        const point = d3.pointer(event, state.host);
        const left = Math.max(4, Math.min(point[0] + 12, state.width - 250));
        tooltip.style("left", left + "px").style("top", Math.max(0, point[1] - 55) + "px");
      } else {
        tooltip.style("left", "15px").style("top", "10px");
      }
    }
    marks.attr("class", function () { return (this.getAttribute("class") || "") + " mark"; })
      .attr("tabindex", 0).attr("role", "button").attr("aria-pressed", "false")
      .attr("aria-label", item => state.describe(item.row, item.series) + " Select to highlight.")
      .on("pointerenter", describe).on("pointermove", describe)
      .on("pointerleave", () => tooltip.style("display", "none"))
      .on("focus", describe).on("blur", () => tooltip.style("display", "none"))
      .on("click", (event, item) => {
        state.select(item.row, item.series);
        tooltip.style("display", "none");
      })
      .on("keydown", (event, item) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        state.select(item.row, item.series);
        tooltip.style("display", "none");
      });
    marks.append("title").text(item => state.describe(item.row, item.series));
  }

  function addLegend(state, entries) {
    const legend = d3.select(state.host).append("div").attr("class", "chart-legend");
    entries.forEach((entry, index) => {
      const span = legend.append("span");
      span.append("i").attr("class", "legend-swatch").style("background", palette[index]);
      span.append("span").text(entry);
    });
  }

  function averageY(svg, state, y, left, right, series, labelY) {
    const average = state.averages[series];
    svg.append("line").attr("class", "average-line")
      .attr("x1", left).attr("x2", right).attr("y1", y(average)).attr("y2", y(average));
    svg.append("text").attr("class", "average-label")
      .attr("x", right).attr("y", labelY === undefined ? y(average) - 7 : labelY).attr("text-anchor", "end")
      .text((series === "value" ? "Average " : series + " avg ") + format(average, state.config.percent));
  }

  // Each touching bar covers one year and shows that year's supplied total.
  function drawYearlyHistogram(state) {
    const compact = (state.host.clientWidth || 740) < 480;
    const { svg, width, height } = makeSvg(state, compact ? 330 : 410);
    const margin = { top: 35, right: 16, bottom: 58, left: compact ? 48 : 58 };
    const baseline = height - margin.bottom;
    const years = state.rows.map(row => Number(row.label));
    const x = d3.scaleLinear().domain([d3.min(years), d3.max(years) + 1])
      .range([margin.left, width - margin.right]);
    const y = d3.scaleLinear().domain([0, d3.max(state.rows, row => row.value) * 1.14])
      .nice().range([baseline, margin.top]);
    svg.append("g").attr("class", "grid").attr("transform", "translate(" + margin.left + ",0)")
      .call(d3.axisLeft(y).ticks(5).tickSize(-(width - margin.left - margin.right)).tickFormat(d3.format("~s")))
      .call(g => g.select(".domain").remove());
    const highlightedYear = state.filterSelection ? Number(state.filterSelection.label) : null;
    const tickYears = years.filter((year, i) => !compact || year === highlightedYear ||
      ((i % 2 === 0 || i === years.length - 1) && (highlightedYear === null || Math.abs(year - highlightedYear) > 1)));
    svg.append("g").attr("class", "axis").attr("transform", "translate(0," + baseline + ")")
      .call(d3.axisBottom(x).tickValues(tickYears.map(year => year + 0.5))
        .tickFormat(value => String(Math.floor(value))).tickSize(0).tickPadding(12));
    svg.selectAll(".axis .tick text").classed("highlighted-year-label", value => Math.floor(value) === highlightedYear);
    svg.append("text").attr("class", "axis-title").attr("x", margin.left).attr("y", 13)
      .text("Hospitalisations");
    svg.append("text").attr("class", "axis-title").attr("x", (margin.left + width - margin.right) / 2)
      .attr("y", height - 8).attr("text-anchor", "middle").text("Year");
    const marks = svg.append("g").selectAll("rect").data(state.rows.map(row => ({ row, series: "value" })))
      .join("rect").attr("class", "year-bin")
      .attr("x", item => x(Number(item.row.label)))
      .attr("width", item => x(Number(item.row.label) + 1) - x(Number(item.row.label)))
      .attr("y", item => y(item.row.value)).attr("height", item => baseline - y(item.row.value))
      .attr("fill", palette[0]);
    bindMarks(state, marks);
    const peak = state.rows.find(row => row.value === d3.max(state.rows, d => d.value));
    marks.classed("peak-year", item => item.row === peak && highlightedYear === null);
    const highlighted = state.rows.find(row => Number(row.label) === highlightedYear);
    if (highlighted && highlighted.value === 0) {
      svg.append("line").attr("class", "zero-year-highlight").attr("x1", x(highlightedYear))
        .attr("x2", x(highlightedYear + 1)).attr("y1", baseline).attr("y2", baseline);
    }
    svg.append("text").attr("class", "peak-label").attr("text-anchor", "middle")
      .attr("x", x(Number(peak.label) + 0.5)).attr("y", y(peak.value) - 12)
      .text("Peak · " + peak.label);
    averageY(svg, state, y, margin.left, width - margin.right, "value");
    updateSelection(state);
  }

  function drawBars(state) {
    const compact = (state.host.clientWidth || 740) < 480;
    if (state.config.horizontal || (compact && state.series.length > 1)) {
      drawHorizontal(state);
      return;
    }
    const { svg, width, height } = makeSvg(state, compact ? 330 : 410);
    const margin = { top: 35, right: 16, bottom: 42, left: compact ? 48 : 58 };
    const baseline = height - margin.bottom;
    const x = d3.scaleBand().domain(state.rows.map(row => row.label))
      .range([margin.left, width - margin.right]).padding(state.series.length > 1 ? 0.25 : 0.26);
    const sub = d3.scaleBand().domain(state.series).range([0, x.bandwidth()]).padding(0.12);
    const max = d3.max(state.rows, row => d3.max(state.series, s => row[s]));
    const y = d3.scaleLinear().domain([0, max * 1.14]).nice().range([baseline, margin.top]);
    svg.append("g").attr("class", "grid").attr("transform", "translate(" + margin.left + ",0)")
      .call(d3.axisLeft(y).ticks(5).tickSize(-(width - margin.left - margin.right)).tickFormat(d3.format("~s")))
      .call(g => g.select(".domain").remove());
    svg.append("g").attr("class", "axis").attr("transform", "translate(0," + baseline + ")")
      .call(d3.axisBottom(x).tickSize(0).tickPadding(12)
        .tickFormat((label, i) => compact && state.rows.length > 9 && i % 2 && i !== state.rows.length - 1 ? "" : label));
    svg.append("text").attr("class", "axis-title").attr("x", margin.left).attr("y", 13).text("Hospitalisations");
    const items = state.rows.flatMap(row => state.series.map(series => ({ row, series })));
    const marks = svg.append("g").selectAll("rect").data(items).join("rect")
      .attr("x", d => x(d.row.label) + sub(d.series)).attr("y", d => y(d.row[d.series]))
      .attr("width", sub.bandwidth()).attr("height", d => baseline - y(d.row[d.series]))
      .attr("rx", 3).attr("fill", d => palette[state.series.indexOf(d.series)]);
    bindMarks(state, marks);
    state.series.forEach(s => averageY(svg, state, y, margin.left, width - margin.right, s));
    if (state.series.length === 1 && state.rows.length <= 8) {
      svg.append("g").selectAll("text").data(state.rows).join("text").attr("class", "value-label")
        .attr("x", row => x(row.label) + x.bandwidth() / 2).attr("y", row => y(row.value) - 8)
        .attr("text-anchor", "middle").text(row => count.format(row.value));
    }
    if (state.series.length > 1) addLegend(state, state.series);
    updateSelection(state);
  }

  function drawHorizontal(state) {
    const compact = (state.host.clientWidth || 740) < 480;
    const grouped = state.series.length > 1;
    const top = grouped ? 58 : 35;
    const rowHeight = grouped ? 52 : 47;
    const { svg, width, height } = makeSvg(state, top + state.rows.length * rowHeight + 48);
    const left = state.key === "q4" ? 47 : compact ? 116 : 145;
    const right = width - 35;
    const y = d3.scaleBand().domain(state.rows.map(r => r.label)).range([top, height - 40]).padding(0.22);
    const sub = d3.scaleBand().domain(state.series).range([0, y.bandwidth()]).padding(0.12);
    const max = d3.max(state.rows, row => d3.max(state.series, series => row[series]));
    const x = d3.scaleLinear().domain([0, max * 1.18]).nice().range([left, right]);
    svg.append("g").attr("class", "grid").attr("transform", "translate(0," + (height - 40) + ")")
      .call(d3.axisBottom(x).ticks(compact ? 3 : 5).tickSize(-(height - 40 - top))
        .tickFormat(state.config.percent ? value => value + "%" : d3.format("~s")));
    svg.append("g").attr("class", "axis").attr("transform", "translate(" + left + ",0)")
      .call(d3.axisLeft(y).tickSize(0).tickPadding(9));
    svg.append("text").attr("class", "axis-title").attr("x", left).attr("y", 13)
      .text(state.config.percent ? "Share of total (%)" : "Hospitalisations");
    const items = state.rows.flatMap(row => state.series.map(series => ({ row, series })));
    const marks = svg.append("g").selectAll("rect").data(items).join("rect")
      .attr("x", left).attr("y", item => y(item.row.label) + sub(item.series))
      .attr("height", sub.bandwidth()).attr("width", item => x(item.row[item.series]) - left)
      .attr("rx", 2).attr("fill", item => palette[state.series.indexOf(item.series)]);
    bindMarks(state, marks);
    svg.append("g").selectAll("text").data(items).join("text").attr("class", "value-label")
      .attr("x", item => x(item.row[item.series]) + 5)
      .attr("y", item => y(item.row.label) + sub(item.series) + sub.bandwidth() / 2 + 4)
      .text(item => state.config.percent ? decimal.format(item.row[item.series]) : count.format(item.row[item.series]));
    state.series.forEach((series, i) => {
      const average = state.averages[series];
      svg.append("line").attr("class", "average-line").attr("x1", x(average)).attr("x2", x(average))
        .attr("y1", top).attr("y2", height - 40);
      svg.append("text").attr("class", "average-label").attr("x", left).attr("y", 29 + i * 15)
        .text((series === "value" ? "Average " : series + " avg ") + format(average, state.config.percent));
    });
    if (grouped) addLegend(state, state.series);
    updateSelection(state);
  }

  function drawLines(state) {
    const compact = (state.host.clientWidth || 740) < 480;
    const { svg, width, height } = makeSvg(state, compact ? 350 : 420);
    const margin = { top: 35, left: 43, right: 18, bottom: 38 };
    const x = d3.scalePoint().domain(state.rows.map(row => row.label)).range([margin.left, width - margin.right]);
    const max = d3.max(state.rows, row => d3.max(state.series, series => row[series]));
    const y = d3.scaleLinear().domain([0, state.config.percent ? Math.min(100, Math.max(60, max * 1.05)) : Math.max(1, max * 1.15)]).nice()
      .range([height - margin.bottom, margin.top]);
    svg.append("g").attr("class", "grid").attr("transform", "translate(" + margin.left + ",0)")
      .call(d3.axisLeft(y).ticks(6).tickSize(-(width - margin.left - margin.right))
        .tickFormat(state.config.percent ? value => value + "%" : d3.format("~s")));
    svg.append("g").attr("class", "axis").attr("transform", "translate(0," + (height - margin.bottom) + ")")
      .call(d3.axisBottom(x).tickSize(0).tickPadding(12).tickFormat((label, i) => compact && i % 2 ? "" : label));
    svg.append("text").attr("class", "axis-title").attr("x", margin.left).attr("y", 14)
      .text(state.config.percent ? "Share of hospitalisations (%)" : "Hospitalisations");
    state.series.forEach((series, i) => {
      svg.append("path").datum(state.rows).attr("fill", "none").attr("stroke", palette[i]).attr("stroke-width", 2.4)
        .attr("d", d3.line().defined(row => row[series] !== null).x(row => x(row.label)).y(row => y(row[series])));
      svg.append("line").attr("class", "average-line").attr("x1", margin.left).attr("x2", width - margin.right)
        .attr("y1", y(state.averages[series])).attr("y2", y(state.averages[series]))
        .style("stroke", palette[i]).style("opacity", .65);
    });
    const points = svg.append("g").selectAll("circle")
      .data(state.rows.flatMap(row => state.series.filter(series => row[series] !== null).map(series => ({ row, series })))).join("circle")
      .attr("class", "chart-point").attr("cx", item => x(item.row.label)).attr("cy", item => y(item.row[item.series]))
      .attr("r", compact ? 4.5 : 5).attr("fill", item => palette[state.series.indexOf(item.series)])
      .attr("stroke", "white").attr("stroke-width", 1);
    bindMarks(state, points);
    addLegend(state, state.series);
    updateSelection(state);
  }

  function drawHeatmap(state) {
    const compact = (state.host.clientWidth || 740) < 480;
    state.host.closest(".chart-frame").querySelector(".average-key").textContent = "Average shown below";
    const { svg, width, height } = makeSvg(state, compact ? 450 : 540);
    svg.classed("original-heatmap", true);
    const ages = [...new Set(state.rows.map(row => row.age))];
    const roads = [...new Set(state.rows.map(row => row.road))];
    const left = 52, top = compact ? 60 : 48, bottom = height - (compact ? 95 : 60);
    const right = width - (compact ? 8 : 100);
    const x = d3.scaleBand().domain(roads).range([left, right]);
    const y = d3.scaleBand().domain(ages).range([top, bottom]);
    const [minimum, maximum] = d3.extent(state.rows, row => row.value);
    const color = minimum === maximum ? () => "#f7f3aa" : d3.scaleLinear().domain([minimum, maximum]).range(["#f7f3aa", "#b83f4b"]).clamp(true);
    const marks = svg.append("g").selectAll("rect").data(state.rows.map(row => ({ row, series: "value" }))).join("rect")
      .attr("class", "heatmap-cell")
      .attr("x", item => x(item.row.road)).attr("y", item => y(item.row.age))
      .attr("width", x.bandwidth()).attr("height", y.bandwidth())
      .attr("fill", item => color(item.row.value));
    bindMarks(state, marks);
    svg.append("g").selectAll("text").data(state.rows).join("text").attr("class", "value-label")
      .attr("x", row => x(row.road) + x.bandwidth() / 2).attr("y", row => y(row.age) + y.bandwidth() / 2 + 4)
      .attr("text-anchor", "middle").style("fill", row => row.value === maximum ? "white" : "#514c40")
      .text(row => String(row.value));
    svg.append("g").attr("class", "axis").attr("transform", "translate(" + left + ",0)")
      .call(d3.axisLeft(y).tickSize(0).tickPadding(8));
    const roadAxis = svg.append("g").attr("class", "axis").attr("transform", "translate(0," + bottom + ")")
      .call(d3.axisBottom(x).tickSize(0).tickPadding(12));
    if (compact) {
      roadAxis.selectAll(".tick text").style("font-size", "9px").each(function(road) {
        const text = d3.select(this).text("");
        const words = road.split(" ");
        words.forEach((word, i) => text.append("tspan").attr("x", 0).attr("dy", i ? "1.1em" : 0).text(word));
      });
    }
    const title = svg.append("text").attr("class", "heatmap-title").attr("x", 0).attr("y", 16);
    const comparisonPeriod = "2011–" + (state.comparisonEnd || "2021");
    title.append("tspan").text(compact ? "Change in Hospitalisations by Age" : "Change in Hospitalisations by Age and Road User, " + comparisonPeriod);
    if (compact) title.append("tspan").attr("x", 0).attr("dy", 17).text("and Road User, " + comparisonPeriod);
    svg.append("text").attr("class", "axis-title").attr("text-anchor", "middle")
      .attr("x", (left + right) / 2).attr("y", bottom + 44).text("Road user");
    svg.append("text").attr("class", "axis-title").attr("text-anchor", "middle")
      .attr("transform", "translate(13," + ((top + bottom) / 2) + ") rotate(-90)").text("Age Group");
    const gradient = svg.append("defs").append("linearGradient").attr("id", "heatmap-color-scale")
      .attr("x1", "0%").attr("y1", compact ? "0%" : "100%")
      .attr("x2", compact ? "100%" : "0%").attr("y2", "0%");
    gradient.append("stop").attr("offset", "0%").attr("stop-color", color(minimum));
    gradient.append("stop").attr("offset", "100%").attr("stop-color", color(maximum));
    if (compact) {
      const legendY = height - 20;
      svg.append("rect").attr("x", left + 35).attr("y", legendY).attr("width", right - left - 80).attr("height", 9)
        .attr("fill", "url(#heatmap-color-scale)");
      svg.append("text").attr("class", "heatmap-legend-label").attr("x", left + 29).attr("y", legendY + 8)
        .attr("text-anchor", "end").text(minimum);
      svg.append("text").attr("class", "heatmap-legend-label").attr("x", right - 39).attr("y", legendY + 8).text(maximum);
    } else {
      const legendX = width - 32, legendY = top + (bottom - top) / 2 - 60;
      const legendTitle = svg.append("text").attr("class", "heatmap-legend-label").attr("x", right + 8).attr("y", legendY - 30);
      ["Change in", "hospitalisations", "(" + (state.comparisonEnd || "2021") + " − 2011)"].forEach((text, i) => {
        legendTitle.append("tspan").attr("x", right + 8).attr("dy", i ? 13 : 0).text(text);
      });
      svg.append("rect").attr("x", legendX).attr("y", legendY + 12).attr("width", 12).attr("height", 120)
        .attr("fill", "url(#heatmap-color-scale)");
      svg.append("text").attr("class", "heatmap-legend-label").attr("x", legendX - 5).attr("y", legendY + 18)
        .attr("text-anchor", "end").text(maximum);
      svg.append("text").attr("class", "heatmap-legend-label").attr("x", legendX - 5).attr("y", legendY + 133)
        .attr("text-anchor", "end").text(minimum);
    }
    updateSelection(state);
  }

  function drawMap(state) {
    const compact = (state.host.clientWidth || 740) < 480;
    // A fixed geographic canvas keeps the small southeastern states and ACT callout in view.
    const { svg } = makeSvg(state, 535);
    svg.attr("viewBox", "0 0 740 535");
    state.host.closest(".chart-frame").querySelector(".average-key").textContent = "Average shown below";
    svg.append("rect").attr("class", "map-water").attr("width", 740).attr("height", 535).attr("rx", 8);
    const projection = d3.geoMercator().fitExtent([[25, 17], [638, 510]], state.geo);
    const path = d3.geoPath(projection);
    const values = new Map(state.rows.map(row => [row.label, row]));
    const extent = d3.extent(state.rows, row => row.value);
    const scale = d3.scaleLinear().domain(extent[0] === undefined ? [0, 1] : extent).range(["#dcf0e4", "#176563"]);
    const color = value => value === null ? "#d9dfdc" : scale(value);
    const features = state.geo.features.map(feature => ({ row: values.get(feature.properties.STATE_NAME), series: "value", feature }));
    const marks = svg.append("g").selectAll("path").data(features).join("path")
      .attr("class", "map-state").attr("d", item => path(item.feature)).attr("fill", item => color(item.row.value))
      .attr("stroke-dasharray", item => item.row.value === null ? "4 3" : null);
    bindMarks(state, marks);
    const labelLocations = {
      "WA": [121.2, -25.8], "NT": [133.4, -19.8], "SA": [135.8, -30.2], "QLD": [144.0, -22.8],
      "NSW": [146.1, -32.3], "VIC": [144.3, -37.2], "TAS": [146.7, -42.3]
    };
    Object.entries(labelLocations).forEach(([code, coordinates]) => {
      const row = state.rows.find(d => d.code === code);
      const point = projection(coordinates);
      const label = svg.append("text").attr("class", "map-label").attr("text-anchor", "middle")
        .attr("x", point[0]).attr("y", point[1]).style("font-size", compact ? "22px" : "12px");
      label.append("tspan").text(code);
      if (!compact) label.append("tspan").attr("class", "map-value").attr("x", point[0]).attr("dy", 15)
        .text(row.value === null ? "Not published" : count.format(row.value));
    });
    const act = features.find(item => item.row.code === "ACT");
    const actPoint = projection([149.12, -35.31]);
    svg.append("path").attr("class", "map-callout")
      .attr("d", "M" + actPoint[0] + "," + actPoint[1] + "L640," + (actPoint[1] - 10) + "L658," + (actPoint[1] - 10));
    const actTarget = svg.append("circle").datum(act).attr("cx", 674).attr("cy", actPoint[1] - 10)
      .attr("r", 17).attr("fill", color(act.row.value));
    bindMarks(state, actTarget);
    svg.append("text").attr("class", "map-label").attr("x", 674).attr("y", actPoint[1] + 24)
      .attr("text-anchor", "middle").style("font-size", compact ? "22px" : "12px").text("ACT");
    svg.append("text").attr("class", "map-label map-value").attr("x", 674).attr("y", actPoint[1] + 39)
      .attr("text-anchor", "middle").style("font-size", compact ? "20px" : "10px")
      .text(act.row.value === null ? "Not published" : count.format(act.row.value));
    const legend = d3.select(state.host).append("div").attr("class", "map-legend");
    legend.append("span").text(extent[0] === undefined ? "No published counts" : count.format(extent[0]));
    legend.append("span").attr("class", "map-gradient");
    legend.append("span").text(extent[1] === undefined ? "" : count.format(extent[1]) + " hospitalisations");
    const list = d3.select(state.host).append("div").attr("class", "map-region-list").attr("aria-label", "Select a state or territory");
    list.selectAll("button").data(state.rows).join("button").attr("type", "button").attr("aria-pressed", "false")
      .attr("aria-label", row => state.describe(row, "value")).text(row => row.code + " · " + (row.value === null ? "Not published" : count.format(row.value)))
      .on("click", (event, row) => state.select(row, "value"));
    d3.select(state.host).append("p").attr("class", "chart-note")
      .text((compact ? "Use the region buttons to select small areas. " : "") +
        "Darker shading means a higher count; grey means not published. ACT is enlarged in the callout. Counts are not risk rates.");
    updateSelection(state);
  }

  function renderTable(state) {
    document.getElementById("table-" + state.key).replaceChildren();
    const headers = state.series[0] === "value" ? [state.config.tableLabel || "Category", state.key === "e2" ? "Change" : "Hospitalisations"] :
      [state.config.tableLabel || "Category", ...state.series.map(series => series + (state.config.percent ? " (%)" : ""))];
    const table = d3.select("#table-" + state.key).append("table");
    table.append("caption").text(document.getElementById("heading-" + state.key).textContent +
      (state.period ? " · " + state.period : ""));
    table.append("thead").append("tr").selectAll("th").data(headers).join("th").attr("scope", "col").text(d => d);
    const rows = table.append("tbody").selectAll("tr").data(state.rows).join("tr");
    rows.append("th").attr("scope", "row").text(row => state.config.label ? state.config.label(row) : row.label);
    rows.each(function(row) {
      d3.select(this).selectAll("td").data(state.series.map(series => row[series])).join("td")
        .text(value => value === null ? "Not published" : state.config.percent ? format(value, true) : count.format(value));
    });
    state.csvHeaders = headers;
  }

  function downloadCSV(state) {
    if (state.unavailable) return;
    const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
    const rows = [state.csvHeaders, ...state.rows.map(row => [
      state.config.label ? state.config.label(row) : row.label, ...state.series.map(series => row[series])
    ])];
    if (state.filters) {
      rows[0].unshift("Period", state.key === "q1" ? "Highlighted year" : "Year filter", "Road-user filter", "Sex filter", "Age filter");
      rows.slice(1).forEach(row => row.unshift(state.period, state.filters.year, state.filters.group, state.filters.sex, state.filters.age));
    }
    const csv = rows.map(row => row.map(value => quote(value === null ? "Not published" : value)).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = state.key + (state.period ? "-" + state.period.replace("–", "-") : "") + "-hospitalisation-data.csv";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function appendPie(state, container, rows, series, title, id) {
    const panel = container.append("div").attr("class", "pie-panel");
    panel.append("h4").text(title);
    const total = d3.sum(rows, row => row[series]);
    const svg = panel.append("svg").attr("viewBox", "0 0 280 245")
      .attr("role", "group").attr("aria-labelledby", id);
    svg.append("title").attr("id", id).text(title + " · " + (state.period || "2021"));
    const pie = d3.pie().sort(null).value(row => row[series])(rows);
    const arc = d3.arc().innerRadius(0).outerRadius(99);
    const marks = svg.append("g").attr("transform", "translate(140,120)")
      .selectAll("path").data(pie.map(slice => ({ row: slice.data, series, slice }))).join("path")
      .attr("class", "pie-slice").attr("d", item => arc(item.slice))
      .attr("fill", item => palette[datasets.q5.findIndex(row => row.label === item.row.label)]).attr("stroke", "white").attr("stroke-width", 1.5);
    bindMarks(state, marks);
    const labelArc = d3.arc().innerRadius(65).outerRadius(65);
    svg.append("g").attr("transform", "translate(140,120)").selectAll("text")
      .data(pie.filter(slice => slice.data[series] / total >= 0.06)).join("text")
      .attr("class", "pie-percentage").attr("text-anchor", "middle").attr("dy", "0.35em")
      .attr("transform", slice => "translate(" + labelArc.centroid(slice) + ")")
      .text(slice => format(slice.data[series] / total * 100, true));
    const legend = panel.append("div").attr("class", "pie-legend");
    const buttons = legend.selectAll("button").data(rows.map(row => ({ row, series }))).join("button")
      .attr("type", "button").attr("aria-pressed", "false")
      .attr("aria-label", item => state.describe(item.row, series) + " Select to highlight.")
      .on("click", (event, item) => state.select(item.row, series));
    buttons.append("i").attr("class", "legend-swatch").style("background", item => palette[datasets.q5.findIndex(row => row.label === item.row.label)]);
    buttons.append("span").attr("aria-hidden", "true").attr("class", "road-icon").text(item => roadIcons[datasets.q5.findIndex(row => row.label === item.row.label)]);
    buttons.append("span").text(item => item.row.label);
    buttons.append("strong").text(item => format(item.row[series] / total * 100, true));
  }

  function drawSexComposition(state) {
    const { svg, width } = makeSvg(state, 145);
    const left = 8, right = width - 8;
    const total = d3.sum(state.series, series => state.sexTotals[series]);
    let offset = left;
    const totals = state.interactionRows[0];
    const items = state.series.map(series => {
      const item = { row: totals, series, left: offset, width: (right - left) * totals[series] / total };
      offset += item.width;
      return item;
    });
    svg.append("text").attr("class", "axis-title").attr("x", left).attr("y", 16)
      .text("Share by sex classification · " + state.period);
    const marks = svg.append("g").selectAll("rect").data(items).join("rect")
      .attr("class", "sex-share").attr("x", item => item.left).attr("y", 35)
      .attr("width", item => item.width).attr("height", 58)
      .attr("fill", item => palette[filterData.sexes.indexOf(item.series)]);
    bindMarks(state, marks);
    svg.append("g").selectAll("text").data(items.filter(item => item.width > 75)).join("text")
      .attr("class", "sex-share-label").attr("x", item => item.left + item.width / 2)
      .attr("y", 69).attr("text-anchor", "middle")
      .text(item => item.series + " " + format(totals[item.series] / total * 100, true));
    const legend = d3.select(state.host).append("div").attr("class", "sex-total-legend");
    legend.selectAll("span").data(items).join("span")
      .text(item => item.series + ": " + count.format(totals[item.series]) + " (" + format(totals[item.series] / total * 100, true) + ")");
    const pies = d3.select(state.host).append("div").attr("class", "sex-pies");
    state.series.filter(series => totals[series] > 0).forEach(series =>
      appendPie(state, pies, state.rows, series, series + " road-user composition", "pie-q4-" + series.replaceAll(/[^a-z0-9]/gi, "-")));
    state.host.closest(".chart-frame").querySelector(".average-key").textContent = "Annual averages below";
    updateSelection(state);
  }

  function writeExplanation(key, paragraphs) {
    const block = document.querySelector('[data-explanation-key="' + key + '"]');
    block.replaceChildren(...paragraphs.map(text => {
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      return paragraph;
    }));
  }

  function updateChart(key, rows, config, options) {
    const state = controllers.get(key);
    Object.assign(state.config, config);
    state.rows = rows;
    state.series = options.series || config.series || ["value"];
    state.period = options.period;
    state.scope = options.scope;
    state.filters = options.filters;
    state.unavailable = options.unavailable || null;
    state.interactionRows = options.interactionRows;
    state.sexTotals = options.sexTotals;
    state.comparisonEnd = options.comparisonEnd;
    state.filterSelection = options.filterSelection || null;
    state.selected = state.filterSelection;
    state.averages = options.averages || Object.fromEntries(state.series.map(series => [series, d3.mean(rows, row => row[series])]));
    const download = document.querySelector('[data-download="' + key + '"]');
    download.disabled = Boolean(state.unavailable);
    renderTable(state);
    redraw(state);
    updateSelection(state);
  }

  function redraw(state) {
    if (state.unavailable) {
      state.host.replaceChildren();
      const message = document.createElement("p");
      message.className = "empty-message";
      message.textContent = state.unavailable;
      state.host.append(message);
      state.width = state.host.clientWidth;
      return;
    }
    if (state.config.type === "map") {
      if (state.geo) drawMap(state);
    } else if (state.config.type === "yearly-histogram") drawYearlyHistogram(state);
    else if (state.config.type === "lines") drawLines(state);
    else if (state.config.type === "heatmap") drawHeatmap(state);
    else if (state.config.type === "sex-composition") drawSexComposition(state);
    else drawBars(state);
  }

  async function initCharts() {
    if (!window.d3) {
      document.querySelectorAll(".chart-host").forEach(host => showError(host, "The chart library could not load. Refresh the page to try again."));
      return false;
    }
    try {
      datasets = await loadJSON("data/chart-data.json");
    } catch (error) {
      document.querySelectorAll(".chart-host").forEach(host => showError(host, "Chart values could not load. Open this page through VS Code Live Server, then refresh."));
      console.error("Unable to load chart values", error);
      return false;
    }
    document.getElementById("annual-average").textContent = decimal.format(d3.mean(datasets.q1, row => row.value));
    try {
      filterData = await loadJSON("data/global-data.json");
      if (!window.RoadInsightFilters) throw new Error("Shared filter controls are unavailable");
    } catch (error) {
      filterData = null;
      document.querySelector("#q3 .explanation-context").textContent = "The chart and explanation use the 2021 reference counts.";
      document.querySelector("#q4 .explanation-context").textContent = "The explanation summarises the combined 2011–2021 counts.";
      document.getElementById("global-filter-status").textContent = "Shared filters could not load. Showing original reference charts; refresh to try again.";
      console.error("Filter data unavailable", error);
    }
    const configs = {
      q1: { type: "yearly-histogram", averageTitle: "Average per year · 2011–2021", averageNote: "Arithmetic mean across all 11 years.", tableLabel: "Year" },
      q2: { type: "map", averageTitle: "Average per jurisdiction · 2021", averageNote: "Arithmetic mean across the eight states and territories.", tableLabel: "State / territory" },
      q3: { averageTitle: "Average per age group · 2021", averageNote: "Arithmetic mean across seven age groups; age bands have unequal widths.", tableLabel: "Age group" },
      q4: { series: ["Male", "Female"], averageTitle: "Average per year, by sex · 2011–2021", averageNote: "Each mean uses 11 annual values.", tableLabel: "Year" },
      q5: { horizontal: true, averageTitle: "Average per road-user group · 2021", averageNote: "Arithmetic mean across all five groups, including Other or unknown.", tableLabel: "Road-user group" },
      e1: { type: "lines", percent: true, series: ["Vehicle occupants", "Motorcyclists", "Cyclists", "Pedestrians", "Other or unknown"], averageTitle: "Average annual share · 2011–2021", averageNote: "A separate arithmetic mean across 11 years for each road-user series.", tableLabel: "Year" },
      e2: { type: "heatmap", averageTitle: "Average change per displayed age × road-user cell", averageNote: "Arithmetic mean across the 28 displayed changes.", label: row => row.age + " / " + row.road, tableLabel: "Age / road user" },
      e3a: { horizontal: true, percent: true, series: ["Hospitalisations", "Bed days"], averageTitle: "Average share per road-user group · 2016–2021", averageNote: "Each mean uses the five displayed groups.", tableLabel: "Road-user group" },
      e3b: { horizontal: true, percent: true, series: ["Hospitalisations", "Bed days"], averageTitle: "Average share per age group · 2016–2021", averageNote: "Each mean uses the seven displayed age groups.", tableLabel: "Age group" }
    };
    Object.entries(configs).forEach(([key, config]) => {
      try {
        const state = createChart(key, datasets[key], config);
        redraw(state);
      } catch (error) {
        showError(document.getElementById("chart-" + key), "This chart could not render. Its values are available in the table below.");
        console.error("Chart render failed: " + key, error);
      }
    });
    if (filterData) {
      window.RoadInsightFilters.init({ data: filterData, base: datasets, update: updateChart, explain: writeExplanation });
    }
    // Map loading is independent: an unavailable boundary file cannot stop the other charts.
    try {
      const map = controllers.get("q2");
      map.geo = await loadJSON("data/australian-states.geojson");
      redraw(map);
    } catch (error) {
      showError(document.getElementById("chart-q2"), "The Australian map could not load. Refresh to try again; jurisdiction values remain in the table below.");
      console.error("Map load failed", error);
    }
    if (typeof ResizeObserver !== "undefined") {
      let frame;
      const pending = new Set();
      const observer = new ResizeObserver(entries => {
        entries.forEach(entry => {
          const state = controllers.get(entry.target.dataset.chart);
          if (state && entry.contentRect.width > 0 && Math.abs(entry.contentRect.width - state.width) > 1) pending.add(state);
        });
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          pending.forEach(state => redraw(state));
          pending.clear();
        });
      });
      controllers.forEach(state => observer.observe(state.host));
    }
    document.querySelector(".supplementary").addEventListener("toggle", event => {
      if (event.target.open) controllers.forEach(state => { if (state.key.startsWith("e")) redraw(state); });
    });
    return true;
  }

  // Called by main.js after the deferred scripts have loaded.
  window.RoadInsightCharts = { init: initCharts };
})();
