"use strict";

// D3 charts: data loading, rendering, selection, tables, downloads, and resizing.
(() => {
  const controllers = new Map();
  const motionNames = { q2: "q2-map", q3: "q3-bubbles", q5: "q5-heatmap" };
  const palette = ["#287c78", "#6076b5", "#8b6941", "#ad6b7c", "#87978a", "#79679c", "#a17335", "#687a86"];
  const mapLabelLocations = {
    WA: [121.2, -25.8], NT: [133.4, -19.8], SA: [135.8, -30.2], QLD: [144, -22.8],
    NSW: [146.1, -32.3], VIC: [144.3, -37.2], TAS: [146.7, -42.3]
  };
  const count = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat("en-AU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const signed = value => (value > 0 ? "+" : value < 0 ? "−" : "") + count.format(Math.abs(value));
  let datasets;
  let filterData;

  // Data loading and value formatting.
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

  // Chart state and accessible selection.
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
    state.describeLines = (row, series) => {
      if (row[series] === null) return [row.label + ": not published for this selection."];
      const label = config.label ? config.label(row) : row.label;
      const unit = config.percent ? "" : config.type === "heatmap" ? " change in hospitalisations" : " hospitalisations";
      const lines = [label + (series === "value" ? "" : " · " + series) + ": " +
        (config.percent ? format(row[series], true) : count.format(row[series])) + unit + ".",
        comparison(row[series], state.averages[series], config.percent) + ".",
        "Average: " + format(state.averages[series], config.percent) + unit + "."];
      if (config.type === "age-bubble") {
        lines.splice(1, 0, count.format(row.bedDays) + " reported bed days.",
          format(row.daysPerHospitalisation) + " reported bed days per hospitalisation.");
      }
      return lines;
    };
    state.describe = (row, series) => state.describeLines(row, series).join(" ");
    state.select = (row, series) => {
      const selection = { label: row.label, series };
      state.selected = state.selected && state.selected.label === selection.label &&
        state.selected.series === series ? state.filterSelection || null : selection;
      updateSelection(state);
    };
    controllers.set(key, state);
    document.querySelector('[data-reset="' + key + '"]')?.addEventListener("click", () => {
      state.selected = state.filterSelection || null;
      updateSelection(state);
    });
    document.querySelector('[data-download="' + key + '"]').addEventListener("click", () => downloadCSV(state));
    if (key === "q5") state.trendPanel = document.getElementById("q5-trend-detail");
    renderTable(state);
    state.defaultReadout();
    return state;
  }

  function updateSelection(state) {
    if (state.unavailable) {
      state.defaultReadout();
      return;
    }
    const host = d3.select(state.host);
    const isSelected = ({ row, series }) => row.label === state.selected?.label && series === state.selected?.series;
    host.selectAll(".mark").classed("is-selected", isSelected).attr("aria-pressed", mark => String(isSelected(mark)));
    host.selectAll(".map-region-list button")
      .attr("aria-pressed", d => String(Boolean(state.selected && d.label === state.selected.label)));
    if (state.config.type === "map") state.host.classList.toggle("has-map-selection", Boolean(state.selected));
    if (state.config.type === "heatmap") {
      const cell = state.rows.find(row => row.label === state.selected?.label);
      host.selectAll(".heatmap-age-axis .tick").classed("is-cell-axis", age => age === cell?.age);
      host.selectAll(".heatmap-road-axis .tick").classed("is-cell-axis", road => road === cell?.road);
      if (state.annualDifferences) {
        drawHeatmapTrend(state, cell || d3.greatest(state.rows, row => Math.abs(row.value)));
        if (cell) {
          showHeatmapCounts(state, cell);
          return;
        }
      }
    }
    if (!state.selected) {
      state.defaultReadout();
      return;
    }
    const row = state.rows.find(d => d.label === state.selected.label);
    state.readout.classList.add("has-selection");
    if (row[state.selected.series] === null) {
      state.readout.textContent = row.label + ": this count is not published for the current selection.";
      return;
    }
    state.readout.replaceChildren();
    const label = document.createElement("span");
    label.className = "readout-label";
    label.textContent = "Selected · " + (state.config.label ? state.config.label(row) : row.label) +
      (state.selected.series === "value" ? "" : " · " + state.selected.series);
    const value = document.createElement("strong");
    value.textContent = state.config.percent ? format(row[state.selected.series], true) : count.format(row[state.selected.series]);
    const suffix = state.config.percent ? "" : state.config.type === "heatmap" ? " change in hospitalisations" : " hospitalisations";
    state.readout.append(label, value, document.createTextNode(suffix + " · " +
      comparison(row[state.selected.series], state.averages[state.selected.series], state.config.percent) +
      " (" + format(state.averages[state.selected.series], state.config.percent) + ")."));
    if (state.config.type === "age-bubble") {
      const bedDays = document.createElement("div");
      bedDays.textContent = count.format(row.bedDays) + " reported bed days · " +
        format(row.daysPerHospitalisation) + " days per hospitalisation.";
      state.readout.append(bedDays);
    }
  }

  // Shared SVG, tooltip, legend, and average helpers.
  function isDesktopQuestion(state) {
    return window.innerWidth >= 900 && state.host.closest(".is-focused-question");
  }

  function focusedChartHeight(state, normal, minimum) {
    if (!isDesktopQuestion(state) || state.fitHeight == null) return normal;
    return Math.max(minimum, Math.min(normal, state.fitHeight));
  }

  function stopChartMotion(state) {
    const name = motionNames[state.key];
    if (name) d3.select(state.host).interrupt(name).selectAll("*").interrupt(name);
  }

  function makeSvg(state, height) {
    stopChartMotion(state);
    state.host.replaceChildren();
    const width = Math.max(290, state.host.clientWidth || 740);
    state.width = width;
    const svg = d3.select(state.host).append("svg")
      .attr("viewBox", "0 0 " + width + " " + height)
      .attr("role", "group")
      .attr("aria-label", document.getElementById("heading-" + state.key).textContent);
    state.tooltip = d3.select(state.host).append("div").attr("class", "chart-tooltip").attr("aria-hidden", "true");
    return { svg, width, height };
  }

  function bindMarks(state, marks) {
    const tooltip = state.tooltip;
    function describe(event, item) {
      // Native SVG titles would create a second tooltip over this custom one.
      d3.selectAll(".chart-tooltip").style("display", "none");
      tooltip.style("display", "block").selectAll("div")
        .data(state.describeLines(item.row, item.series)).join("div").text(line => line);
      const box = tooltip.node().getBoundingClientRect();
      const hostBox = state.host.getBoundingClientRect();
      let point;
      if (event.type.startsWith("pointer")) {
        point = d3.pointer(event, state.host);
      } else {
        const markBox = event.currentTarget.getBoundingClientRect();
        point = [markBox.left - hostBox.left + markBox.width / 2, markBox.top - hostBox.top];
      }
      const left = Math.max(4, Math.min(point[0] + 12, state.width - box.width - 4));
      const top = point[1] >= box.height + 12 ? point[1] - box.height - 12 : point[1] + 16;
      tooltip.style("left", left + "px").style("top", top + "px");
    }
    marks.classed("mark", true)
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
        if (event.key === "Escape") {
          tooltip.style("display", "none");
          return;
        }
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        state.select(item.row, item.series);
        tooltip.style("display", "none");
      });
  }

  function addLegend(state, entries, line = false) {
    const legend = d3.select(state.host).append("div").attr("class", "chart-legend");
    entries.forEach((entry, index) => {
      const span = legend.append("span");
      const swatch = span.append("i")
        .attr("class", line ? "legend-swatch line-legend-swatch" : "legend-swatch");
      if (line) {
        swatch.style("border-top-color", palette[index]);
      } else {
        swatch.style("background", palette[index]);
      }
      span.append("span").text(entry);
    });
  }

  function drawAnnualAverage(svg, average, y, left, right) {
    svg.append("line").attr("class", "average-line")
      .attr("x1", left).attr("x2", right).attr("y1", y(average)).attr("y2", y(average));
    svg.append("text").attr("class", "average-label")
      .attr("x", right).attr("y", y(average) - 7).attr("text-anchor", "end")
      .text("Average " + format(average));
  }

  // Chart renderers.
  // Each touching bar covers one year and shows that year's supplied total.
  function drawYearlyHistogram(state) {
    const compact = (state.host.clientWidth || 740) < 480;
    const { svg, width, height } = makeSvg(state, focusedChartHeight(state, compact ? 330 : 410, 260));
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
    drawAnnualAverage(svg, state.averages.value, y, margin.left, width - margin.right);
  }

  function drawHorizontal(state) {
    const compact = (state.host.clientWidth || 740) < 480;
    const grouped = state.series.length > 1;
    const top = grouped ? 58 : 35;
    const rowHeight = grouped ? 52 : 47;
    const { svg, width, height } = makeSvg(state, top + state.rows.length * rowHeight + 48);
    const left = compact ? 116 : 145;
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
  }

  function drawLollipop(state) {
    const compact = (state.host.clientWidth || 740) < 480;
    const rows = [...state.rows].sort((a, b) => b.value - a.value);
    const margin = { top: 42, right: compact ? 34 : 52, bottom: 48, left: compact ? 92 : 132 };
    const rowHeight = compact ? 41 : 46;
    const height = margin.top + rows.length * rowHeight + margin.bottom;
    const { svg, width } = makeSvg(state, height);
    const max = d3.max(rows, row => row.value) || 0;
    const x = d3.scaleLinear().domain([0, Math.max(1, max * 1.16)]).nice()
      .range([margin.left, width - margin.right]);
    const y = d3.scaleBand().domain(rows.map(row => row.label))
      .range([margin.top, height - margin.bottom]).padding(0.42);

    svg.append("g").attr("class", "grid").attr("transform", "translate(0," + (height - margin.bottom) + ")")
      .call(d3.axisBottom(x).ticks(compact ? 4 : 6).tickSize(-(height - margin.top - margin.bottom))
        .tickFormat(d3.format("~s")));
    svg.append("g").attr("class", "axis").attr("transform", "translate(" + margin.left + ",0)")
      .call(d3.axisLeft(y).tickSize(0).tickPadding(9));
    svg.append("text").attr("class", "axis-title").attr("x", margin.left).attr("y", 15)
      .text("Hospitalisations");

    const average = state.averages.value || 0;
    svg.append("line").attr("class", "average-line lollipop-average")
      .attr("x1", x(average)).attr("x2", x(average))
      .attr("y1", margin.top - 5).attr("y2", height - margin.bottom);
    svg.append("text").attr("class", "average-label")
      .attr("x", Math.min(width - margin.right, x(average) + 5)).attr("y", margin.top - 12)
      .attr("text-anchor", x(average) > width - margin.right - 90 ? "end" : "start")
      .text("Average · " + count.format(average));

    svg.append("g").selectAll("line").data(rows).join("line")
      .attr("class", "lollipop-stem")
      .attr("x1", x(0)).attr("x2", row => x(row.value))
      .attr("y1", row => y(row.label) + y.bandwidth() / 2)
      .attr("y2", row => y(row.label) + y.bandwidth() / 2);
    const marks = svg.append("g").selectAll("circle").data(rows.map(row => ({ row, series: "value" }))).join("circle")
      .attr("class", "lollipop-point")
      .attr("cx", item => x(item.row.value))
      .attr("cy", item => y(item.row.label) + y.bandwidth() / 2)
      .attr("r", compact ? 6.5 : 7.5).attr("fill", palette[0])
      .attr("stroke", "white").attr("stroke-width", 2);
    bindMarks(state, marks);
    svg.append("g").selectAll("text").data(rows).join("text").attr("class", "value-label")
      .attr("x", row => x(row.value) > width - margin.right - 42 ? x(row.value) - 11 : x(row.value) + 11)
      .attr("y", row => y(row.label) + y.bandwidth() / 2 + 4)
      .attr("text-anchor", row => x(row.value) > width - margin.right - 42 ? "end" : "start")
      .text(row => count.format(row.value));
  }

  function drawAgeBubbles(state, animate) {
    const previous = d3.select(state.host).select(".age-bubble-chart");
    const hostWidth = state.host.clientWidth || 740;
    const compact = hostWidth < 480;
    const height = focusedChartHeight(state, compact ? 380 : 426, 270);
    const viewBox = "0 0 " + Math.max(290, hostWidth) + " " + height;
    const shouldAnimate = animate && !previous.empty() && previous.attr("viewBox") === viewBox &&
      !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let svg;
    if (shouldAnimate) {
      // Keep the rendered positions and opacity when a second tap interrupts the first transition.
      svg = previous;
      stopChartMotion(state);
      state.tooltip.style("display", "none");
    } else {
      svg = makeSvg(state, height).svg.classed("age-bubble-chart", true);
      svg.append("g").attr("class", "bubble-size-legend").attr("aria-hidden", "true");
      svg.append("g").attr("class", "grid bubble-y-axis");
      svg.append("g").attr("class", "axis bubble-x-axis");
      svg.append("text").attr("class", "axis-title bubble-y-title").text("Reported bed days per hospitalisation");
      svg.append("text").attr("class", "axis-title bubble-x-title").attr("text-anchor", "middle").text("Number of hospitalisations");
      svg.append("line").attr("class", "average-line");
      svg.append("text").attr("class", "average-label");
      svg.append("g").attr("class", "bubble-marks");
      svg.append("g").attr("class", "bubble-labels").attr("aria-hidden", "true");
      d3.select(state.host).append("p").attr("class", "chart-note");
    }
    svg.classed("is-bubble-transition", shouldAnimate);
    const motion = shouldAnimate ? svg.transition(motionNames[state.key]).duration(400).ease(d3.easeCubicInOut) : null;
    const duringMotion = selection => motion ? selection.transition(motion) : selection;
    const width = state.width;
    const left = 47, right = width - 16, top = 93, bottom = height - 48;
    const maxCases = d3.max(state.rows, row => row.value);
    const maxDays = d3.max(state.rows, row => row.daysPerHospitalisation);
    const maxBedDays = d3.max(state.rows, row => row.bedDays);
    const x = d3.scaleLinear().domain([0, maxCases * 1.2]).nice().range([left, right]);
    const y = d3.scaleLinear().domain([0, maxDays * 1.13]).nice().range([bottom, top]);
    const size = d3.scaleSqrt().domain([0, maxBedDays]).range([0, compact ? 13 : 26]);
    const radius = row => Math.max(4, size(row.bedDays));
    const compactLabels = { "Vehicle occupants": "Vehicle", Motorcyclists: "Motorcycle", Cyclists: "Cyclist",
      Pedestrians: "Pedestrian", "Other or unknown": "Other" };
    const bubbleLabel = row => {
      const name = state.ageGroup ? (compact ? compactLabels[row.label] : row.label) : row.label.replace("-", "–");
      return name + " · " + format(row.daysPerHospitalisation) + " d";
    };
    const lowerLabels = new Set(["0-7", "8-16", "17-25", "Motorcyclists", "Other or unknown"]);

    const legend = svg.select(".bubble-size-legend");
    legend.selectAll(".bubble-size-title").data([null]).join("text")
      .attr("class", "axis-title bubble-size-title").attr("y", 12).text("Bubble size · reported bed days");
    const reference = d3.ticks(0, maxBedDays, 4).at(-1) || maxBedDays;
    const examples = legend.selectAll("g").data([Math.round(reference / 4), reference]).join("g")
      .attr("transform", (_, i) => "translate(" + (26 + 108 * i) + ",41)");
    examples.selectAll("circle").data(value => [value]).join("circle")
      .attr("r", size).attr("fill", "none").attr("stroke", "#53676d");
    examples.selectAll("text").data(value => [value]).join("text").attr("class", "axis-title").attr("x", value => size(value) + 5)
      .attr("dominant-baseline", "middle").text(value => count.format(value));

    const yAxis = svg.select(".bubble-y-axis").attr("transform", "translate(" + left + ",0)");
    const xAxis = svg.select(".bubble-x-axis").attr("transform", "translate(0," + bottom + ")");
    // D3's tick transitions use the browser's native SVG transform list.
    const canAnimateTicks = motion && xAxis.node().transform?.baseVal;
    (canAnimateTicks ? yAxis.transition(motion) : yAxis)
      .call(d3.axisLeft(y).ticks(6).tickSize(left - right));
    (canAnimateTicks ? xAxis.transition(motion) : xAxis)
      .call(d3.axisBottom(x).ticks(compact ? 3 : 6).tickFormat(d3.format("~s")));
    svg.select(".bubble-y-title").attr("x", left).attr("y", top - 13);
    svg.select(".bubble-x-title").attr("x", (left + right) / 2).attr("y", height - 7);

    const averageX = x(state.averages.value);
    duringMotion(svg.select(".average-line")).attr("x1", averageX).attr("x2", averageX)
      .attr("y1", top).attr("y2", bottom);
    const averageLabel = svg.select(".average-label").text("Average · " + count.format(state.averages.value));
    duringMotion(averageLabel).attr("x", averageX + 5).attr("y", bottom - 8);

    const bubbles = svg.select(".bubble-marks").selectAll("circle")
      .data(state.rows.map(row => ({ row, series: "value" })), ({ row }) => row.label);
    duringMotion(bubbles.exit().classed("mark bubble-point is-selected", false).attr("aria-hidden", "true")
      .attr("tabindex", null).attr("pointer-events", "none")).attr("opacity", 0).remove();
    const marks = bubbles.enter().append("circle")
      .attr("cx", ({ row }) => x(row.value)).attr("cy", ({ row }) => y(row.daysPerHospitalisation))
      .attr("r", ({ row }) => radius(row)).attr("opacity", motion ? 0 : 1)
      .attr("stroke", "white").attr("stroke-width", 1.5).attr("fill-opacity", .82)
      .merge(bubbles).classed("bubble-point", true).attr("aria-hidden", null).attr("pointer-events", null)
      .attr("fill", ({ row }) => palette[row.colorIndex]);
    bindMarks(state, marks);
    duringMotion(marks).attr("cx", ({ row }) => x(row.value)).attr("cy", ({ row }) => y(row.daysPerHospitalisation))
      .attr("r", ({ row }) => radius(row)).attr("opacity", 1);

    const labels = svg.select(".bubble-labels").selectAll("text").data(state.rows, row => row.label);
    duringMotion(labels.exit()).attr("opacity", 0).remove();
    const newLabels = labels.enter().append("text")
      .attr("class", "value-label bubble-label")
      .attr("text-anchor", "middle").attr("dominant-baseline", "middle").attr("opacity", motion ? 0 : 1);
    const text = newLabels.merge(labels)
      .style("fill", row => d3.color(palette[row.colorIndex]).darker(.65).formatHex())
      .text(bubbleLabel);
    const points = state.rows.map(row => ({ x: x(row.value), y: y(row.daysPerHospitalisation), radius: radius(row) }));
    const boxAt = (x, y, halfWidth, halfHeight) => ({ left: x - halfWidth, right: x + halfWidth, top: y - halfHeight, bottom: y + halfHeight });
    const avoid = points.map(point => boxAt(point.x, point.y, point.radius + 2, point.radius + 2));
    const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
      Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const positions = new Map();
    // Keep the longer labels with their bubbles, including in a narrow viewport.
    text.each(function (row, index) {
      const point = points[index];
      const bounds = this.getBBox?.();
      const halfWidth = (bounds?.width || this.textContent.length * 5.8) / 2 + 2;
      const halfHeight = (bounds?.height || 12) / 2 + 1;
      const baselineOffset = bounds?.height ? bounds.y + bounds.height / 2 - Number(this.getAttribute("y")) : 0;
      const gap = point.radius + halfHeight + 3;
      const side = point.radius + halfWidth + 4;
      const first = lowerLabels.has(row.label) ? gap : -gap;
      const candidates = [[0, first], [0, -first], [side, 0], [-side, 0],
        [halfWidth, first], [-halfWidth, first], [halfWidth, -first], [-halfWidth, -first],
        [0, first * 1.6], [0, -first * 1.6]];
      let best;
      let bestOverlap = Infinity;
      let bestDistance = Infinity;
      const minX = left + halfWidth, maxX = width - halfWidth - 3;
      const minY = top + halfHeight, maxY = bottom - halfHeight - 2;
      function check(x, y) {
        const labelX = Math.max(minX, Math.min(maxX, x));
        const labelY = Math.max(minY, Math.min(maxY, y));
        const box = boxAt(labelX, labelY, halfWidth, halfHeight);
        const area = avoid.reduce((sum, obstacle) => sum + overlap(box, obstacle), 0);
        const distance = (labelX - point.x) ** 2 + (labelY - point.y) ** 2;
        if (area < bestOverlap || (area === bestOverlap && distance < bestDistance)) {
          best = { x: labelX, y: labelY - baselineOffset, box };
          bestOverlap = area;
          bestDistance = distance;
        }
        return area === 0;
      }
      for (const [dx, dy] of candidates) {
        if (check(point.x + dx, point.y + dy)) break;
      }
      if (bestOverlap > 0) {
        // If the nearby spots are crowded, try the edges of labels and bubbles already on the plot.
        const optionsX = [point.x, minX, maxX, ...avoid.flatMap(box => [box.left - halfWidth - 1, box.right + halfWidth + 1])];
        const optionsY = [point.y, minY, maxY, ...avoid.flatMap(box => [box.top - halfHeight - 1, box.bottom + halfHeight + 1])];
        for (const x of optionsX) for (const y of optionsY) check(x, y);
      }
      positions.set(row.label, best);
      avoid.push(best.box);
    });
    const labelX = row => positions.get(row.label).x;
    const labelY = row => positions.get(row.label).y;
    newLabels.attr("x", labelX).attr("y", labelY);
    duringMotion(text).attr("x", labelX).attr("y", labelY).attr("opacity", 1);
    const hasUnknownAge = state.rows.some(row => row.label === "Unknown");
    d3.select(state.host).select(".chart-note")
      .text("Select a bubble for exact values." + (hasUnknownAge ? " The unknown-age category uses a minimum marker size." : ""));
  }

  function drawLines(state) {
    const compact = (state.host.clientWidth || 740) < 480;
    const { svg, width, height } = makeSvg(state, compact ? 350 : 420);
    const margin = { top: 35, left: 48, right: 18, bottom: 42 };
    const x = d3.scalePoint().domain(state.rows.map(row => row.label)).range([margin.left, width - margin.right]);
    const max = d3.max(state.rows, row => d3.max(state.series, series => row[series]));
    const y = d3.scaleLinear().domain([0, state.config.percent ? Math.min(100, Math.max(60, max * 1.05)) : Math.max(1, max * 1.15)]).nice()
      .range([height - margin.bottom, margin.top]);

    svg.append("g").attr("class", "grid").attr("transform", "translate(" + margin.left + ",0)")
      .call(d3.axisLeft(y).ticks(6).tickSize(-(width - margin.left - margin.right))
        .tickFormat(state.config.percent ? value => value + "%" : d3.format("~s")));
    svg.append("g").attr("class", "axis").attr("transform", "translate(0," + (height - margin.bottom) + ")")
      .call(d3.axisBottom(x).tickSize(0).tickPadding(12).tickFormat((label, i) =>
        compact && i % 2 ? "" : label));
    svg.append("text").attr("class", "axis-title").attr("x", margin.left).attr("y", 14)
      .text(state.config.percent ? "Share of hospitalisations (%)" : "Hospitalisations");

    state.series.forEach((series, i) => {
      svg.append("path").datum(state.rows).attr("class", "series-line")
        .attr("fill", "none").attr("stroke", palette[i]).attr("stroke-width", 2.4)
        .attr("stroke-linecap", "round").attr("stroke-linejoin", "round")
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
    addLegend(state, state.series, true);
  }

  function drawMirroredBars(state) {
    const compact = (state.host.clientWidth || 740) < 480;
    const top = 55, bottomSpace = 48, rowHeight = compact ? 42 : 47;
    const height = focusedChartHeight(state, top + state.rows.length * rowHeight + bottomSpace, 280);
    const { svg, width } = makeSvg(state, height);
    const center = width / 2;
    const labelHalf = compact ? 38 : 58;
    const leftEdge = compact ? 10 : 22;
    const rightEdge = width - leftEdge;
    const leftZero = center - labelHalf - 9;
    const rightZero = center + labelHalf + 9;
    const max = d3.max(state.rows, row => d3.max(state.series, series => row[series] || 0)) || 0;
    const domainMax = Math.max(1, max * 1.12);
    const leftScale = d3.scaleLinear().domain([0, domainMax]).range([leftZero, leftEdge]);
    const rightScale = d3.scaleLinear().domain([0, domainMax]).range([rightZero, rightEdge]);
    const y = d3.scaleBand().domain(state.rows.map(row => row.label))
      .range([top, height - bottomSpace]).padding(0.22);
    const sub = d3.scaleBand().domain(state.series).range([0, y.bandwidth()]).padding(0.16);

    svg.append("text").attr("class", "mirror-side-title")
      .attr("x", (leftEdge + leftZero) / 2).attr("y", 20).attr("text-anchor", "middle")
      .text(state.series.includes("Male") ? "MALE" : "");
    svg.append("text").attr("class", "mirror-side-title")
      .attr("x", (rightZero + rightEdge) / 2).attr("y", 20).attr("text-anchor", "middle")
      .text(state.series.find(series => series !== "Male")?.toUpperCase() || "");

    const ticks = d3.ticks(0, domainMax, compact ? 2 : 4);
    [leftScale, rightScale].forEach(scale => {
      svg.append("g").selectAll("line").data(ticks).join("line")
        .attr("class", "mirror-grid-line").attr("x1", tick => scale(tick)).attr("x2", tick => scale(tick))
        .attr("y1", top - 3).attr("y2", height - bottomSpace);
    });
    svg.append("g").attr("class", "axis mirror-axis").attr("transform", "translate(0," + (height - bottomSpace) + ")")
      .call(d3.axisBottom(leftScale).tickValues(ticks).tickFormat(d3.format("~s")).tickSize(0).tickPadding(8));
    svg.append("g").attr("class", "axis mirror-axis").attr("transform", "translate(0," + (height - bottomSpace) + ")")
      .call(d3.axisBottom(rightScale).tickValues(ticks).tickFormat(d3.format("~s")).tickSize(0).tickPadding(8));
    svg.append("line").attr("class", "mirror-center-line")
      .attr("x1", center).attr("x2", center).attr("y1", top - 4).attr("y2", height - bottomSpace);
    svg.append("g").selectAll("text").data(state.rows).join("text").attr("class", "mirror-age-label")
      .attr("x", center).attr("y", row => y(row.label) + y.bandwidth() / 2 + 3.5)
      .attr("text-anchor", "middle").text(row => row.label);

    const items = state.rows.flatMap(row => state.series.map(series => ({ row, series })));
    const marks = svg.append("g").selectAll("rect").data(items).join("rect")
      .attr("class", "mirror-bar")
      .attr("x", item => item.series === "Male" ?
        leftScale(item.row[item.series] || 0) : rightZero)
      .attr("y", item => y(item.row.label) + sub(item.series))
      .attr("width", item => item.series === "Male" ?
        leftScale(0) - leftScale(item.row[item.series] || 0) :
        rightScale(item.row[item.series] || 0) - rightZero)
      .attr("height", sub.bandwidth()).attr("rx", 2)
      .attr("fill", item => palette[state.series.indexOf(item.series)]);
    bindMarks(state, marks);

    state.series.forEach(series => {
      const average = state.averages[series] || 0;
      const scale = series === "Male" ? leftScale : rightScale;
      svg.append("line").attr("class", "mirror-average-line")
        .attr("x1", scale(average)).attr("x2", scale(average))
        .attr("y1", top - 4).attr("y2", height - bottomSpace);
      svg.append("text").attr("class", "mirror-average-label")
        .attr("x", scale(average) + (series === "Male" ? -4 : 4)).attr("y", top - 9)
        .attr("text-anchor", series === "Male" ? "end" : "start")
        .text("Avg " + count.format(average));
    });
    if (!compact) {
      svg.append("g").selectAll("text").data(items).join("text").attr("class", "value-label")
        .attr("x", item => item.series === "Male" ?
          Math.max(leftEdge + 2, leftScale(item.row[item.series] || 0) - 5) :
          Math.min(rightEdge - 2, rightScale(item.row[item.series] || 0) + 5))
        .attr("y", item => y(item.row.label) + sub(item.series) + sub.bandwidth() / 2 + 4)
        .attr("text-anchor", item => item.series === "Male" ? "end" : "start")
        .text(item => count.format(item.row[item.series] || 0));
    }
  }

  function drawHeatmap(state, animate) {
    const host = d3.select(state.host);
    const width = Math.max(290, state.host.clientWidth || 740);
    const compact = width < 535;
    const height = focusedChartHeight(state, compact ? 450 : 540, 280);
    const previous = host.select(".original-heatmap");
    const shouldAnimate = animate && !previous.empty() && previous.attr("viewBox") === "0 0 " + width + " " + height &&
      !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    state.host.closest(".chart-frame").querySelector(".average-key").textContent = "Average shown below";
    const ages = [...new Set(state.rows.map(row => row.age))];
    const roads = [...new Set(state.rows.map(row => row.road))];
    const left = 60, top = compact ? 60 : 48, bottom = height - (compact ? 95 : 60);
    const right = width - (compact ? 8 : 100);
    const x = d3.scaleBand().domain(roads).range([left, right]);
    const y = d3.scaleBand().domain(ages).range([top, bottom]);
    const limit = state.config.colorLimit || Math.max(1, d3.max(state.rows, row => Math.abs(row.value)));
    const color = d3.scaleLinear().domain([-limit, 0, limit]).range(["#176563", "#f4f5ef", "#b84c19"]).clamp(true);
    let svg;
    if (shouldAnimate) {
      svg = previous;
      stopChartMotion(state);
      state.tooltip.style("display", "none");
    } else {
      svg = makeSvg(state, height).svg.classed("original-heatmap", true);
      svg.append("g").attr("class", "heatmap-cells");
      svg.append("g").attr("class", "heatmap-values").attr("aria-hidden", "true");
      svg.append("g").attr("class", "axis heatmap-age-axis").attr("transform", "translate(" + left + ",0)")
        .call(d3.axisLeft(y).tickSize(0).tickPadding(8));
      const shortRoads = { "Vehicle occupants": "Vehicle", Motorcyclists: "Motorbike", Cyclists: "Cyclist",
        Pedestrians: "Pedestrian", "Other or unknown": "Other" };
      svg.append("g").attr("class", "axis heatmap-road-axis").attr("transform", "translate(0," + bottom + ")")
        .call(d3.axisBottom(x).tickSize(0).tickPadding(12).tickFormat(road => compact ? shortRoads[road] || road : road))
        .selectAll(".tick text").style("font-size", compact ? "9px" : null);
      svg.append("text").attr("class", "heatmap-title heatmap-period").attr("x", left).attr("y", 20);
      svg.append("text").attr("class", "axis-title").attr("text-anchor", "middle")
        .attr("x", (left + right) / 2).attr("y", bottom + 36).text("Road user");
      svg.append("text").attr("class", "axis-title").attr("text-anchor", "middle")
        .attr("transform", "translate(13," + ((top + bottom) / 2) + ") rotate(-90)").text("Age group");
      const gradient = svg.append("defs").append("linearGradient").attr("id", "heatmap-color-scale")
        .attr("x1", "0%").attr("y1", compact ? "0%" : "100%")
        .attr("x2", compact ? "100%" : "0%").attr("y2", "0%");
      gradient.selectAll("stop").data([-limit, 0, limit]).join("stop")
        .attr("offset", (_, i) => (i * 50) + "%").attr("stop-color", color);
      const legend = svg.append("g").attr("class", "heatmap-legend");
      if (compact) {
        const legendX = left + 38, legendWidth = right - left - 76, legendY = height - 28;
        legend.append("rect").attr("x", legendX).attr("y", legendY).attr("width", legendWidth).attr("height", 9)
          .attr("fill", "url(#heatmap-color-scale)");
        legend.selectAll("text").data([-limit, 0, limit]).join("text").attr("class", "heatmap-legend-label")
          .attr("x", (_, i) => [legendX - 5, legendX + legendWidth / 2, legendX + legendWidth + 5][i])
          .attr("y", (_, i) => i === 1 ? legendY + 22 : legendY + 8)
          .attr("text-anchor", (_, i) => ["end", "middle", "start"][i]).text(signed);
      } else {
        const legendX = width - 32, legendY = (top + bottom - 120) / 2;
        legend.append("rect").attr("x", legendX).attr("y", legendY).attr("width", 12).attr("height", 120)
          .attr("fill", "url(#heatmap-color-scale)");
        legend.selectAll("text").data([limit, 0, -limit]).join("text").attr("class", "heatmap-legend-label")
          .attr("x", legendX - 5).attr("y", (_, i) => legendY + i * 60 + 4).attr("text-anchor", "end").text(signed);
      }
    }

    svg.classed("is-heatmap-transition", shouldAnimate);
    const motion = shouldAnimate ? host.transition(motionNames[state.key]).duration(350).ease(d3.easeCubicInOut) : null;
    const marks = svg.select(".heatmap-cells").selectAll("rect")
      .data(state.rows.map(row => ({ row, series: "value" })), ({ row }) => row.label).join("rect")
      .attr("class", "heatmap-cell").attr("x", ({ row }) => x(row.road)).attr("y", ({ row }) => y(row.age))
      .attr("width", x.bandwidth()).attr("height", y.bandwidth());
    bindMarks(state, marks);
    (motion ? marks.transition(motion) : marks).attr("fill", ({ row }) => color(row.value));
    const labels = svg.select(".heatmap-values").selectAll("text").data(state.rows, row => row.label).join("text")
      .attr("class", "value-label heatmap-value").attr("text-anchor", "middle")
      .attr("x", row => x(row.road) + x.bandwidth() / 2).attr("y", row => y(row.age) + y.bandwidth() / 2 + 4);
    const numberColor = row => d3.lab(color(row.value)).l < 59 ? "white" : "#173642";
    (motion ? labels.transition(motion) : labels).style("fill", numberColor);
    fadeChartLabels(labels, motion, row => signed(row.value));
    svg.select(".heatmap-period").text("Change in hospitalisations · " + (state.comparisonEnd || "2021") + " − 2011");
  }

  function heatmapAgeLabel(age) {
    return age === "Unknown" ? "Unknown age" : "Ages " + age.replace("-", "–");
  }

  function showHeatmapCounts(state, cell) {
    state.readout.classList.add("has-selection");
    state.readout.replaceChildren();
    const readout = d3.select(state.readout);
    readout.append("span").attr("class", "readout-label").text(heatmapAgeLabel(cell.age) + " · " + cell.road);
    const totals = readout.append("dl").attr("class", "q5-cell-counts");
    const items = [["2011 baseline", count.format(cell.baseline)],
      [state.comparisonEnd + " count", count.format(cell.current)], ["Change", signed(cell.value)]];
    const fields = totals.selectAll("div").data(items).join("div");
    fields.append("dt").text(([label]) => label);
    fields.append("dd").text(([, value]) => value);
    readout.append("div").text("Average change across cells " + format(state.averages.value));
  }

  function drawHeatmapTrend(state, cell) {
    const trend = [...state.annualDifferences].map(([year, rows]) => ({
      year, value: rows.find(row => row.label === cell.label).value
    }));
    const selected = trend.find(point => point.year === state.comparisonEnd);
    const ageLabel = heatmapAgeLabel(cell.age);
    const scope = ageLabel + " · " + cell.road;
    d3.select("#q5-trend-context").text(scope + " · " + selected.year + " change " + signed(selected.value));
    d3.select("#q5-comparison-context").text(ageLabel + " · " + selected.year + " compared with 2011");
    d3.select("#q5-comparison-year").text(selected.year);

    const rows = d3.select("#q5-comparison-rows").selectAll("tr")
      .data(state.rows.filter(row => row.age === cell.age), row => row.road).join(enter => {
        const tr = enter.append("tr");
        tr.append("th").attr("scope", "row");
        tr.selectAll("td").data([0, 1, 2]).join("td");
        return tr;
      }).classed("is-active", row => row.road === cell.road);
    rows.select("th").text(row => row.road);
    rows.selectAll("td").data(row => [count.format(row.baseline), count.format(row.current), signed(row.value)]).text(value => value);

    const host = document.getElementById("q5-trend");
    const width = host.clientWidth || 560;
    const height = 195;
    const margin = { top: 10, right: 17, bottom: 24, left: 47 };
    const years = trend.map(point => point.year);
    const [min, max] = d3.extent(trend, point => point.value);
    const padding = Math.max(1, (max - min) * 0.12);
    const x = d3.scalePoint(years, [margin.left, width - margin.right]);
    const y = d3.scaleLinear([min - padding, max + padding], [height - margin.bottom, margin.top]).nice(4);

    const svg = d3.select(host).selectAll("svg").data([trend]).join("svg")
      .attr("viewBox", "0 0 " + width + " " + height).attr("role", "img")
      .attr("aria-label", scope + ", hospitalisation change from 2011. " +
        trend.map(point => point.year + " " + signed(point.value)).join(", "));
    svg.selectAll(".q5-trend-y").data([null]).join("g").attr("class", "axis q5-trend-y")
      .attr("transform", "translate(" + margin.left + ",0)")
      .call(d3.axisLeft(y).ticks(4).tickFormat(signed).tickSize(-(width - margin.left - margin.right)))
      .selectAll(".tick line").filter(value => value === 0).remove();
    svg.selectAll(".q5-trend-x").data([null]).join("g").attr("class", "axis q5-trend-x")
      .attr("transform", "translate(0," + (height - margin.bottom) + ")")
      .call(d3.axisBottom(x).tickValues(width < 470 ? years.filter((year, index) => index % 2 === 0) : years));
    svg.selectAll(".q5-trend-zero").data([0]).join("line").attr("class", "q5-trend-zero")
      .attr("x1", margin.left).attr("x2", width - margin.right).attr("y1", y(0)).attr("y2", y(0));
    svg.selectAll(".q5-trend-guide").data([selected]).join("line").attr("class", "q5-trend-guide")
      .attr("x1", point => x(point.year)).attr("x2", point => x(point.year))
      .attr("y1", margin.top).attr("y2", height - margin.bottom);
    svg.selectAll(".q5-trend-line").data([trend]).join("path").attr("class", "q5-trend-line")
      .attr("d", d3.line().x(point => x(point.year)).y(point => y(point.value)));
    svg.selectAll(".q5-trend-point").data(trend, point => point.year).join("circle")
      .attr("class", "q5-trend-point").classed("is-active", point => point === selected)
      .attr("cx", point => x(point.year)).attr("cy", point => y(point.value)).attr("r", point => point === selected ? 5 : 3)
      .selectAll("title").data(point => [point]).join("title").text(point => point.year + " · " + signed(point.value));
  }

  function drawIntroMap(geometry) {
    const host = document.getElementById("hero-map");
    const projection = d3.geoMercator().fitExtent([[8, 4], [280, 164]], geometry);
    const svg = d3.select(host).append("svg").attr("viewBox", "0 0 288 172");
    svg.append("g").selectAll("path").data(geometry.features).join("path").attr("d", d3.geoPath(projection));
    svg.append("g").selectAll("text").data(Object.entries(mapLabelLocations)).join("text")
      .attr("x", ([, coordinates]) => projection(coordinates)[0])
      .attr("y", ([, coordinates]) => projection(coordinates)[1])
      .attr("text-anchor", "middle").attr("dominant-baseline", "middle").text(([code]) => code);
  }

  function drawMap(state, animate) {
    const host = d3.select(state.host);
    const hostWidth = state.host.clientWidth || 740;
    const compact = hostWidth < 480;
    const height = focusedChartHeight(state, 535, 245);
    const canvasWidth = isDesktopQuestion(state) ? Math.max(290, hostWidth) : 740;
    const calloutX = canvasWidth - 66;
    const viewBox = "0 0 " + canvasWidth + " " + height;
    const previous = host.select(".jurisdiction-map");
    const shouldAnimate = animate && !previous.empty() && previous.attr("viewBox") === viewBox &&
      state.width === Math.max(290, hostWidth) && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const values = new Map(state.rows.map(row => [row.label, row]));
    const byCode = new Map(state.rows.map(row => [row.code, row]));
    const extent = d3.extent(state.rows, row => row.value);
    const domain = state.config.colorDomain || (extent[0] === undefined ? [0, 1] : extent);
    const scale = d3.scaleLinear().domain(domain).range(["#dcf0e4", "#176563"]).clamp(true);
    const color = value => value === null ? "#d9dfdc" : scale(value);
    const features = state.geo.features.map(feature => ({ row: values.get(feature.properties.STATE_NAME), series: "value", feature }));
    const act = features.find(item => item.row.code === "ACT");
    let svg;
    if (shouldAnimate) {
      svg = previous;
      stopChartMotion(state);
      state.tooltip.style("display", "none");
    } else {
      svg = makeSvg(state, height).svg.attr("class", "jurisdiction-map").attr("viewBox", viewBox);
      state.host.closest(".chart-frame").querySelector(".average-key").textContent = "Average shown below";
      svg.append("rect").attr("class", "map-water").attr("width", canvasWidth).attr("height", height).attr("rx", 8);
      const projection = d3.geoMercator().fitExtent([[25, 17], [canvasWidth - 102, height - 25]], state.geo);
      const path = d3.geoPath(projection);
      svg.append("g").selectAll("path").data(features).join("path")
        .attr("class", "map-state").attr("d", item => path(item.feature));
      Object.entries(mapLabelLocations).forEach(([code, coordinates]) => {
        const [x, y] = projection(coordinates);
        const label = svg.append("text").attr("class", "map-label").attr("aria-hidden", "true")
          .attr("text-anchor", "middle").attr("x", x).attr("y", y).style("font-size", compact ? "22px" : "12px");
        label.append("tspan").text(code);
        if (!compact) label.append("tspan").attr("class", "map-value").attr("data-code", code).attr("x", x).attr("dy", 15);
      });
      const actPoint = projection([149.12, -35.31]);
      svg.append("path").attr("class", "map-callout")
        .attr("d", "M" + actPoint[0] + "," + actPoint[1] + "L" + (calloutX - 34) + "," + (actPoint[1] - 10) + "L" + (calloutX - 16) + "," + (actPoint[1] - 10));
      svg.append("circle").attr("class", "map-act-target").attr("cx", calloutX).attr("cy", actPoint[1] - 10).attr("r", 17);
      svg.append("text").attr("class", "map-label").attr("aria-hidden", "true").attr("x", calloutX).attr("y", actPoint[1] + 24)
        .attr("text-anchor", "middle").style("font-size", compact ? "22px" : "12px").text("ACT");
      svg.append("text").attr("class", "map-label map-value").attr("aria-hidden", "true").attr("data-code", "ACT")
        .attr("x", calloutX).attr("y", actPoint[1] + 39).attr("text-anchor", "middle").style("font-size", compact ? "20px" : "10px");
      const legend = host.append("div").attr("class", "map-legend");
      legend.append("span").attr("class", "map-legend-min");
      legend.append("span").attr("class", "map-gradient");
      legend.append("span").attr("class", "map-legend-max");
      host.append("div").attr("class", "map-region-list").attr("aria-label", "Select a state or territory");
      host.append("p").attr("class", "chart-note");
    }

    svg.classed("is-map-transition", shouldAnimate);
    const motion = shouldAnimate ? host.transition(motionNames[state.key]).duration(400).ease(d3.easeCubicInOut) : null;
    svg.selectAll(".map-state").data(features, item => item.row.code);
    svg.select(".map-act-target").datum(act);
    const marks = svg.selectAll(".map-state, .map-act-target")
      .attr("stroke-dasharray", item => item.row.value === null ? "4 3" : null);
    bindMarks(state, marks);
    (motion ? marks.transition(motion) : marks).attr("fill", item => color(item.row.value));

    const mapNumbers = svg.selectAll(".map-value[data-code]").datum(function () { return byCode.get(this.dataset.code); });
    const mapCount = row => row.value === null ? "Not published" : count.format(row.value);
    fadeChartLabels(mapNumbers, motion, mapCount);
    host.select(".map-legend-min").text(extent[0] === undefined ? "No published counts" : count.format(domain[0]));
    host.select(".map-legend-max").text(extent[1] === undefined ? "" : count.format(domain[1]) + " hospitalisations");
    const buttons = host.select(".map-region-list").selectAll("button").data(state.rows, row => row.code).join("button")
      .attr("type", "button").attr("aria-label", row => state.describe(row, "value"))
      .on("click", (event, row) => state.select(row, "value"));
    buttons.selectAll(".map-region-code").data(row => [row]).join("span").attr("class", "map-region-code")
      .text(row => row.code + " · ");
    const buttonNumbers = buttons.selectAll(".map-region-number").data(row => [row]).join("span").attr("class", "map-region-number");
    fadeChartLabels(buttonNumbers, motion, mapCount);
    host.select(".chart-note")
      .text((compact ? "Use the region buttons to select small areas. " : "") +
        "Darker shading means a higher count; grey means not published. ACT is enlarged in the callout. " +
        (state.config.colorDomain ? "The colour scale stays the same across individual years." : "Counts are not risk rates."));
  }

  function fadeChartLabels(numbers, motion, number) {
    if (!motion) {
      numbers.text(number).style("opacity", null);
      return;
    }
    // Swap the exact value halfway through the fade. Rapid changes start from the currently visible value.
    numbers.transition(motion).tween("label-fade", function (row) {
      const next = number(row);
      const from = Number(this.style.opacity || 1);
      const same = this.textContent === next;
      return t => {
        if (!same && t >= .5 && this.textContent !== next) this.textContent = next;
        if (t === 1) this.style.removeProperty("opacity");
        else if (same) this.style.opacity = from + (1 - from) * t;
        else this.style.opacity = t < .5 ? from * (1 - 2 * t) : 2 * t - 1;
      };
    });
  }

  // Tables and CSV downloads.
  function renderTable(state) {
    document.getElementById("table-" + state.key).replaceChildren();
    const bubble = state.config.type === "age-bubble";
    const headers = bubble ? [state.config.tableLabel, "Hospitalisations", "Reported bed days", "Reported bed days per hospitalisation"] :
      state.series[0] === "value" ? [state.config.tableLabel || "Category", state.config.type === "heatmap" ? "Change" : "Hospitalisations"] :
      [state.config.tableLabel || "Category", ...state.series.map(series => series + (state.config.percent ? " (%)" : ""))];
    const table = d3.select("#table-" + state.key).append("table");
    table.append("caption").text(document.getElementById("heading-" + state.key).textContent +
      (state.ageGroup ? " · " + state.scope : state.period ? " · " + state.period : ""));
    table.append("thead").append("tr").selectAll("th").data(headers).join("th").attr("scope", "col").text(d => d);
    const rows = table.append("tbody").selectAll("tr").data(state.rows).join("tr");
    rows.append("th").attr("scope", "row").text(row => state.config.label ? state.config.label(row) : row.label);
    rows.each(function(row) {
      const values = bubble ? [count.format(row.value), count.format(row.bedDays), format(row.daysPerHospitalisation)] :
        state.series.map(series => row[series] === null ? "Not published" : countOrPercent(row[series]));
      d3.select(this).selectAll("td").data(values).join("td").text(value => value);
    });
    state.csvHeaders = headers;

    function countOrPercent(value) {
      return state.config.percent ? format(value, true) : count.format(value);
    }
  }

  function downloadCSV(state) {
    if (state.unavailable) return;
    const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
    const rows = [[...state.csvHeaders], ...state.rows.map(row => [
      state.config.label ? state.config.label(row) : row.label, ...state.series.map(series => row[series])
    ])];
    if (state.config.type === "age-bubble") {
      state.rows.forEach((row, index) => rows[index + 1].push(row.bedDays, row.daysPerHospitalisation));
    }
    if (state.yearFilter) {
      // Keep the established CSV columns for consumers of older downloads.
      rows[0].unshift("Period", state.key === "q1" ? "Highlighted year" : "Year filter", "Road-user filter", "Sex filter", "Age filter");
      rows.slice(1).forEach(row => row.unshift(state.period, state.yearFilter, "all", "all", "all"));
    } else if (state.period) {
      rows[0] = ["Period", ...rows[0]];
      rows.slice(1).forEach(row => row.unshift(state.period));
    }
    if (state.ageGroup) {
      rows[0].splice(1, 0, "Age group");
      rows.slice(1).forEach(row => row.splice(1, 0, state.ageGroup));
    }
    const csv = rows.map(row => row.map(value => quote(value === null ? "Not published" : value)).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = state.key + (state.period ? "-" + state.period.replace("–", "-") : "") +
      (state.ageGroup ? "-ages-" + state.ageGroup.replace("+", "-plus") : "") + "-hospitalisation-data.csv";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Filtered updates and page initialization.
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
    const keepSelection = config.type === "map" || config.type === "heatmap";
    const animate = state.config.type === config.type &&
      (keepSelection ? state.period !== options.period : config.type === "age-bubble" &&
        (state.ageGroup !== options.ageGroup || state.period !== options.period));
    const previousSelection = keepSelection && state.selected && rows.some(row => row.label === state.selected.label) ? state.selected : null;
    Object.assign(state.config, config);
    state.rows = rows;
    state.series = options.series || config.series || ["value"];
    state.period = options.period;
    state.scope = options.scope;
    state.yearFilter = options.yearFilter;
    state.ageGroup = options.ageGroup;
    state.unavailable = options.unavailable || null;
    state.comparisonEnd = options.comparisonEnd;
    state.annualDifferences = options.annualDifferences;
    if (state.trendPanel) state.trendPanel.hidden = !state.annualDifferences || Boolean(state.unavailable);
    state.filterSelection = options.filterSelection || null;
    state.selected = previousSelection || state.filterSelection;
    state.averages = Object.fromEntries(state.series.map(series => [series, d3.mean(rows, row => row[series])]));
    const download = document.querySelector('[data-download="' + key + '"]');
    download.disabled = Boolean(state.unavailable);
    renderTable(state);
    redraw(state, animate);
  }

  function redraw(state, animate = false) {
    if (state.unavailable) {
      stopChartMotion(state);
      state.host.replaceChildren();
      const message = document.createElement("p");
      message.className = "empty-message";
      message.textContent = state.unavailable;
      state.host.append(message);
      state.width = state.host.clientWidth;
      updateSelection(state);
      return;
    }
    if (state.config.type === "map") {
      if (state.geo) drawMap(state, animate);
    } else if (state.config.type === "yearly-histogram") drawYearlyHistogram(state);
    else if (state.config.type === "lines") drawLines(state);
    else if (state.config.type === "lollipop") drawLollipop(state);
    else if (state.config.type === "age-bubble") drawAgeBubbles(state, animate);
    else if (state.config.type === "mirrored") drawMirroredBars(state);
    else if (state.config.type === "heatmap") drawHeatmap(state, animate);
    else if (state.config.type === "horizontal") drawHorizontal(state);
    updateSelection(state);
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
    try {
      filterData = await loadJSON("data/global-data.json");
      if (!window.RoadInsightFilters) throw new Error("Research data aggregation is unavailable");
    } catch (error) {
      filterData = null;
      document.querySelector("#q3 .explanation-context").textContent = "The chart and explanation use the 2021 reference counts.";
      document.querySelector("#q4 .explanation-context").textContent = "The explanation summarises the combined 2011–2021 counts.";
      document.querySelectorAll(".chart-filter-scope").forEach(scope => { scope.textContent = "Original reference data · Source: BITRE"; });
      console.error("Filter data unavailable", error);
    }
    const configs = {
      q1: { type: "yearly-histogram", averageTitle: "Average per year · 2011–2021", averageNote: "Arithmetic mean across all 11 years.", tableLabel: "Year" },
      q2: { type: "map", averageTitle: "Average per jurisdiction · 2021", averageNote: "Arithmetic mean across the eight states and territories.", tableLabel: "State / territory" },
      q3: { type: "lollipop", averageTitle: "Average per age group · 2021", averageNote: "Arithmetic mean across the displayed age groups; age bands have unequal widths.", tableLabel: "Age group" },
      q4: { type: "mirrored", series: ["Male", "Female"], averageTitle: "Average per age group · 2021", averageNote: "Separate averages for male and female counts across the displayed age groups.", tableLabel: "Age group" },
      q5: { type: "heatmap", averageTitle: "Average change per age × road-user cell", averageNote: "Arithmetic mean across the displayed age and road-user differences.", label: row => row.age + " / " + row.road, tableLabel: "Age / road-user group" },
      e1: { type: "lines", percent: true, series: ["Vehicle occupants", "Motorcyclists", "Cyclists", "Pedestrians", "Other or unknown"], averageTitle: "Average annual share · 2011–2021", averageNote: "A separate arithmetic mean across 11 years for each road-user series.", tableLabel: "Year" },
      e3a: { type: "horizontal", percent: true, series: ["Hospitalisations", "Bed days"], averageTitle: "Average share per road-user group · 2016–2021", averageNote: "Each mean uses the five displayed groups.", tableLabel: "Road-user group" },
      e3b: { type: "horizontal", percent: true, series: ["Hospitalisations", "Bed days"], averageTitle: "Average share per age group · 2016–2021", averageNote: "Each mean uses the seven displayed age groups.", tableLabel: "Age group" }
    };
    Object.entries(configs).forEach(([key, config]) => {
      try {
        const initialRows = key === "q5" ? datasets.e2 : datasets[key];
        const state = createChart(key, initialRows, config);
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
      drawIntroMap(map.geo);
    } catch (error) {
      document.getElementById("hero-map").hidden = true;
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
  function resizeQuestion(id) {
    const chart = controllers.get(id);
    if (!chart) return;
    chart.fitHeight = null;
    redraw(chart);
    if (!isDesktopQuestion(chart)) return;

    const svg = chart.host.querySelector("svg");
    if (!svg) return;
    const frame = chart.host.closest(".chart-frame");
    const layout = frame.parentElement;
    const data = layout.querySelector(".data-disclosure");
    const dataHeight = data?.querySelector("details[open]") ? 48 : data?.offsetHeight || 0;
    const gap = parseFloat(getComputedStyle(layout).rowGap) || 0;
    const plotHeight = svg.getBoundingClientRect().height;
    // Include the data controls when they are in the same grid as the chart.
    const frameBottom = frame.getBoundingClientRect().bottom + window.scrollY;
    const spaceAroundPlot = frameBottom - plotHeight + (data ? gap + dataHeight : 0) + 18;
    const available = Math.floor(window.innerHeight - spaceAroundPlot);
    if (available < plotHeight) {
      chart.fitHeight = available;
      redraw(chart);
    }
  }

  window.RoadInsightCharts = { init: initCharts, resizeQuestion };
})();
