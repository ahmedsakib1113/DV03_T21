"use strict";

(() => {
  const controllers = new Map();
  const palette = ["#287c78", "#6076b5", "#8b6941", "#ad6b7c", "#87978a"];
  const count = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat("en-AU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  let datasets;

  function format(value, percent = false) {
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
      const label = config.label ? config.label(row) : row.label;
      return label + (series === "value" ? "" : " · " + series) + ": " +
        (config.percent ? format(row[series], true) : count.format(row[series])) + ". " +
        comparison(row[series], state.averages[series], config.percent) +
        " (" + format(state.averages[series], config.percent) + ").";
    };
    state.select = (row, series) => {
      const selection = { label: row.label, series };
      state.selected = state.selected && state.selected.label === selection.label &&
        state.selected.series === series ? null : selection;
      updateSelection(state);
    };
    controllers.set(key, state);
    document.querySelector('[data-reset="' + key + '"]').addEventListener("click", () => {
      state.selected = null;
      updateSelection(state);
    });
    document.querySelector('[data-download="' + key + '"]').addEventListener("click", () => downloadCSV(state));
    renderTable(state);
    state.defaultReadout();
    return state;
  }

  function updateSelection(state) {
    d3.select(state.host).selectAll(".mark")
      .classed("is-selected", d => Boolean(state.selected && d.row.label === state.selected.label && d.series === state.selected.series))
      .attr("aria-pressed", d => String(Boolean(state.selected && d.row.label === state.selected.label && d.series === state.selected.series)));
    d3.select(state.host).selectAll(".map-region-list button")
      .attr("aria-pressed", d => String(Boolean(state.selected && d.label === state.selected.label)));
    if (!state.selected) {
      state.defaultReadout();
      return;
    }
    const row = state.rows.find(d => d.label === state.selected.label);
    state.readout.classList.add("has-selection");
    state.readout.replaceChildren();
    const label = document.createElement("span");
    label.className = "readout-label";
    label.textContent = "Selected · " + (state.config.label ? state.config.label(row) : row.label) +
      (state.selected.series === "value" ? "" : " · " + state.selected.series);
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
    const y = d3.scaleLinear().domain([0, 60]).range([height - margin.bottom, margin.top]);
    svg.append("g").attr("class", "grid").attr("transform", "translate(" + margin.left + ",0)")
      .call(d3.axisLeft(y).ticks(6).tickSize(-(width - margin.left - margin.right)).tickFormat(value => value + "%"));
    svg.append("g").attr("class", "axis").attr("transform", "translate(0," + (height - margin.bottom) + ")")
      .call(d3.axisBottom(x).tickSize(0).tickPadding(12).tickFormat((label, i) => compact && i % 2 ? "" : label));
    svg.append("text").attr("class", "axis-title").attr("x", margin.left).attr("y", 14).text("Share of hospitalisations (%)");
    state.series.forEach((series, i) => {
      svg.append("path").datum(state.rows).attr("fill", "none").attr("stroke", palette[i]).attr("stroke-width", 2.4)
        .attr("d", d3.line().x(row => x(row.label)).y(row => y(row[series])));
      svg.append("line").attr("class", "average-line").attr("x1", margin.left).attr("x2", width - margin.right)
        .attr("y1", y(state.averages[series])).attr("y2", y(state.averages[series]))
        .style("stroke", palette[i]).style("opacity", .65);
    });
    const points = svg.append("g").selectAll("circle")
      .data(state.rows.flatMap(row => state.series.map(series => ({ row, series })))).join("circle")
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
    const color = d3.scaleLinear().domain([minimum, maximum]).range(["#f7f3aa", "#b83f4b"]).clamp(true);
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
    title.append("tspan").text(compact ? "Change in Hospitalisations by Age" : "Change in Hospitalisations by Age and Road User, 2011–2021");
    if (compact) title.append("tspan").attr("x", 0).attr("dy", 17).text("and Road User, 2011–2021");
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
      ["Change in", "hospitalisations", "(2021 − 2011)"].forEach((text, i) => {
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
    const color = d3.scaleLinear().domain(d3.extent(state.rows, row => row.value)).range(["#dcf0e4", "#176563"]);
    const features = state.geo.features.map(feature => ({ row: values.get(feature.properties.STATE_NAME), series: "value", feature }));
    const marks = svg.append("g").selectAll("path").data(features).join("path")
      .attr("class", "map-state").attr("d", item => path(item.feature)).attr("fill", item => color(item.row.value));
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
      if (!compact) label.append("tspan").attr("class", "map-value").attr("x", point[0]).attr("dy", 15).text(count.format(row.value));
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
      .attr("text-anchor", "middle").style("font-size", compact ? "20px" : "10px").text("740");
    const legend = d3.select(state.host).append("div").attr("class", "map-legend");
    legend.append("span").text("710");
    legend.append("span").attr("class", "map-gradient");
    legend.append("span").text("11,130 hospitalisations");
    const list = d3.select(state.host).append("div").attr("class", "map-region-list").attr("aria-label", "Select a state or territory");
    list.selectAll("button").data(state.rows).join("button").attr("type", "button").attr("aria-pressed", "false")
      .attr("aria-label", row => state.describe(row, "value")).text(row => row.code + " · " + count.format(row.value))
      .on("click", (event, row) => state.select(row, "value"));
    d3.select(state.host).append("p").attr("class", "chart-note")
      .text((compact ? "Use the region buttons to select small areas. " : "") +
        "Darker shading means a higher count. ACT is enlarged in the callout; the map shows counts, not risk rates.");
    updateSelection(state);
  }

  function renderTable(state) {
    const headers = state.series[0] === "value" ? [state.config.tableLabel || "Category", state.key === "e2" ? "Change" : "Hospitalisations"] :
      [state.config.tableLabel || "Category", ...state.series.map(series => series + (state.config.percent ? " (%)" : ""))];
    const table = d3.select("#table-" + state.key).append("table");
    table.append("caption").text(document.getElementById("heading-" + state.key).textContent);
    table.append("thead").append("tr").selectAll("th").data(headers).join("th").attr("scope", "col").text(d => d);
    const rows = table.append("tbody").selectAll("tr").data(state.rows).join("tr");
    rows.append("th").attr("scope", "row").text(row => state.config.label ? state.config.label(row) : row.label);
    rows.each(function(row) {
      d3.select(this).selectAll("td").data(state.series.map(series => row[series])).join("td")
        .text(value => state.config.percent ? format(value, true) : count.format(value));
    });
    state.csvHeaders = headers;
  }

  function downloadCSV(state) {
    const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
    const rows = [state.csvHeaders, ...state.rows.map(row => [
      state.config.label ? state.config.label(row) : row.label, ...state.series.map(series => row[series])
    ])];
    const csv = rows.map(row => row.map(quote).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = state.key + "-hospitalisation-data.csv";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function redraw(state) {
    if (state.config.type === "map") {
      if (state.geo) drawMap(state);
    } else if (state.config.type === "lines") drawLines(state);
    else if (state.config.type === "heatmap") drawHeatmap(state);
    else drawBars(state);
  }

  async function init() {
    if (!window.d3) {
      document.querySelectorAll(".chart-host").forEach(host => showError(host, "The chart library could not load. Refresh the page to try again."));
      return;
    }
    try {
      datasets = await d3.json("data/chart-data.json");
    } catch (error) {
      document.querySelectorAll(".chart-host").forEach(host => showError(host, "Chart values could not load. Open this page through VS Code Live Server, then refresh."));
      console.error("Unable to load chart values", error);
      return;
    }
    document.getElementById("annual-average").textContent = decimal.format(d3.mean(datasets.q1, row => row.value));
    const configs = {
      q1: { averageTitle: "Average per year · 2011–2021", averageNote: "Arithmetic mean across all 11 years.", tableLabel: "Year" },
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
    // Map loading is independent: an unavailable boundary file cannot stop the other charts.
    try {
      const map = controllers.get("q2");
      map.geo = await d3.json("data/australian-states.geojson");
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
    if (typeof IntersectionObserver !== "undefined") {
      const navObserver = new IntersectionObserver(entries => {
        const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (!visible) return;
        document.querySelectorAll(".question-nav a").forEach(link => {
          if (link.hash === "#" + visible.target.id) link.setAttribute("aria-current", "true");
          else link.removeAttribute("aria-current");
        });
      }, { rootMargin: "-10% 0px -65% 0px" });
      document.querySelectorAll("section[id^='q'], #e2").forEach(section => navObserver.observe(section));
    }
    document.documentElement.dataset.chartsReady = "true";
  }

  init();
})();
