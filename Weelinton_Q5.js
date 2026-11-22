"use strict";

(() => {
  const d3 = window.d3;
  const filter = document.querySelector("#q5-year-filter");
  const roadChart = document.querySelector("#q5-road-chart");
  const remotenessChart = document.querySelector("#q5-remoteness-chart");
  const roadLegend = document.querySelector("#q5-road-legend");
  const remotenessLegend = document.querySelector("#q5-remoteness-legend");
  if (!filter || !roadChart || !remotenessChart || !roadLegend || !remotenessLegend) return;

  if (!d3) {
    roadChart.textContent = "The D3 chart library could not be loaded. Check your internet connection and reload the page.";
    remotenessChart.textContent = "The D3 chart library could not be loaded. Check your internet connection and reload the page.";
    return;
  }

  const roadCategories = [
    { key: "car", label: "Car occupants", color: "#3c78a8" },
    { key: "motorcycle", label: "Motorcyclists", color: "#e38b45" },
    { key: "cyclist", label: "Pedal cyclists", color: "#44a276" },
    { key: "pedestrian", label: "Pedestrians", color: "#9d7bb5" },
    { key: "other", label: "Other", color: "#aab4bf" }
  ];
  const remotenessCategories = [
    { key: "majorCities", label: "Major cities", color: "#3c78a8" },
    { key: "regional", label: "Regional", color: "#e38b45" },
    { key: "remote", label: "Remote", color: "#44a276" }
  ];

  // Rows follow the published table order; null values are categories marked n.p.
  const roadRows = {
    firstNations: [
      [2011, 617, 187, 121, 180, null, null, null, 1150],
      [2012, 758, 218, 152, 219, null, null, null, 1396],
      [2013, 755, 267, 173, 166, null, null, null, 1402],
      [2014, 759, 254, 177, 196, 15, null, null, 1439],
      [2015, 883, 273, 177, 206, 15, null, null, 1594],
      [2016, 928, 296, 190, 190, 14, null, null, 1657],
      [2017, 938, 319, 201, 209, 15, null, null, 1717],
      [2018, 1113, 333, 199, 209, 20, null, null, 1924],
      [2019, 996, 353, 240, 211, null, 11, null, 1833],
      [2020, 1208, 545, 230, 223, 10, 19, 10, 2290],
      [2021, 1158, 520, 207, 235, null, 28, null, 2214]
    ],
    nonIndigenous: [
      [2011, 15597, 7185, 5174, 2522, null, null, null, 31441],
      [2012, 15250, 7348, 5379, 2390, null, null, null, 31347],
      [2013, 15439, 7617, 5985, 2409, null, null, null, 32310],
      [2014, 15363, 7919, 6354, 2316, 449, null, null, 32859],
      [2015, 16692, 7855, 6435, 2378, 479, null, null, 34539],
      [2016, 17872, 8111, 6613, 2514, 452, null, null, 36419],
      [2017, 17901, 8318, 6782, 2465, 500, null, null, 36520],
      [2018, 18337, 8200, 6676, 2412, 524, null, null, 36942],
      [2019, 18006, 8463, 6984, 2461, null, 244, null, 36671],
      [2020, 15843, 8038, 8012, 1857, 476, 275, 160, 35186],
      [2021, 17098, 8259, 7861, 2072, null, 312, null, 36450]
    ]
  };
  const remotenessRows = {
    firstNations: [
      [2011, 368, 455, 330], [2012, 429, 545, 426], [2013, 446, 540, 420],
      [2014, 486, 565, 392], [2015, 508, 613, 461], [2016, 551, 648, 454],
      [2017, 617, 704, 393], [2018, 642, 797, 466], [2019, 708, 669, 447],
      [2020, 810, 946, 504], [2021, 795, 885, 503]
    ],
    nonIndigenous: [
      [2011, 20985, 9717, 789], [2012, 20858, 9536, 802], [2013, 22224, 9218, 765],
      [2014, 22572, 9358, 737], [2015, 23597, 9684, 694], [2016, 25390, 9846, 678],
      [2017, 25288, 10163, 653], [2018, 25236, 10278, 720], [2019, 25502, 10232, 638],
      [2020, 23823, 9936, 660], [2021, 25254, 10332, 600]
    ]
  };

  const years = d3.range(2011, 2022);
  const populations = [
    { key: "firstNations", label: "First Nations" },
    { key: "nonIndigenous", label: "Non-Indigenous" }
  ];
  const aggregateValue = "2011-2021";
  const periodLabel = () => selectedYear === aggregateValue ? "2011–2021" : String(selectedYear);
  const filterOptions = [
    { value: aggregateValue, label: "2011–2021" },
    ...years.map((year) => ({ value: year, label: String(year) }))
  ];
  const formatCount = d3.format(",.0f");
  let selectedYear = 2021;
  let resizeFrame = 0;

  function addLegend(element, items) {
    d3.select(element).selectAll(".q5-legend-item")
      .data(items)
      .join("span")
      .attr("class", "q5-legend-item")
      .each(function (item) {
        const entry = d3.select(this);
        entry.selectAll("*").remove();
        entry.append("span")
          .attr("class", "q5-legend-swatch")
          .style("background-color", item.color)
          .attr("aria-hidden", "true");
        entry.append("span").text(item.label);
      });
  }

  const yearButtons = d3.select(filter)
    .selectAll("button")
    .data(filterOptions)
    .join("button")
    .attr("class", "q5-year-button")
    .attr("type", "button")
    .attr("aria-pressed", (option) => String(option.value === selectedYear))
    .text((option) => option.label)
    .on("click", (_event, option) => {
      selectedYear = option.value;
      yearButtons.attr("aria-pressed", (value) => String(value.value === selectedYear));
      render();
    });

  function getRoadComposition(populationKey) {
    const rows = roadRows[populationKey].filter((item) => selectedYear === aggregateValue || item[0] === selectedYear);
    const total = d3.sum(rows, (row) => row[8]);
    const car = d3.sum(rows, (row) => row[1] ?? 0);
    const motorcycle = d3.sum(rows, (row) => row[2] ?? 0);
    const cyclist = d3.sum(rows, (row) => row[3] ?? 0);
    const pedestrian = d3.sum(rows, (row) => row[4] ?? 0);
    const other = total - car - motorcycle - cyclist - pedestrian;
    return {
      year: periodLabel(),
      population: populations.find((population) => population.key === populationKey).label,
      total,
      car,
      motorcycle,
      cyclist,
      pedestrian,
      other
    };
  }

  function getRemotenessComposition(populationKey) {
    const rows = remotenessRows[populationKey].filter((item) => selectedYear === aggregateValue || item[0] === selectedYear);
    const majorCities = d3.sum(rows, (row) => row[1]);
    const regional = d3.sum(rows, (row) => row[2]);
    const remote = d3.sum(rows, (row) => row[3]);
    return {
      year: periodLabel(),
      population: populations.find((population) => population.key === populationKey).label,
      majorCities,
      regional,
      remote,
      knownTotal: majorCities + regional + remote
    };
  }

  function chartCanvas(element) {
    const width = Math.max(280, Math.floor(element.clientWidth));
    const height = Math.max(145, Math.floor(element.clientHeight));
    const svg = d3.select(element).selectAll("svg")
      .data([null])
      .join("svg")
      .attr("viewBox", `0 0 ${width} ${height}`);
    svg.selectAll("*").remove();
    return { svg, width, height };
  }

  function drawRoadUserComposition() {
    const { svg, width, height } = chartCanvas(roadChart);
    const margin = { top: 28, right: 12, bottom: 56, left: 42 };
    const plotWidth = width - margin.left - margin.right;
    const values = populations.map((population) => getRoadComposition(population.key));
    const x = d3.scaleBand()
      .domain(values.map((item) => item.population))
      .range([margin.left, width - margin.right])
      .padding(.48);
    const y = d3.scaleLinear()
      .domain([0, 100])
      .range([height - margin.bottom, margin.top]);
    const stack = d3.stack().keys(roadCategories.map((category) => category.key));
    const series = stack(values.map((item) => ({
      ...item,
      raw: item,
      ...Object.fromEntries(roadCategories.map((category) => [
        category.key,
        item[category.key] / item.total * 100
      ]))
    })));
    const color = d3.scaleOrdinal()
      .domain(roadCategories.map((category) => category.key))
      .range(roadCategories.map((category) => category.color));

    svg.append("g").attr("class", "grid")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).tickValues([0, 20, 40, 60, 80, 100])
        .tickSize(-plotWidth).tickFormat(""));
    svg.selectAll(".grid .domain").remove();
    svg.append("g").attr("class", "axis")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).tickValues([0, 20, 40, 60, 80, 100]).tickFormat((value) => `${value}%`));
    const xAxis = svg.append("g").attr("class", "axis")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).tickSizeOuter(0));
    xAxis.selectAll(".tick text")
      .each(function (populationName) {
        const population = values.find((item) => item.population === populationName);
        const label = d3.select(this).text(null);
        label
          .append("tspan")
          .attr("x", 0)
          .text(populationName);
        label
          .append("tspan")
          .attr("x", 0)
          .attr("dy", "1.2em")
          .text(`n=${formatCount(population.total)}`);
      });
    svg.append("text").attr("class", "q5-axis-title")
      .attr("x", margin.left-40).attr("y", 12).text("Composition (%)");

    const groups = svg.append("g").selectAll("g")
      .data(series)
      .join("g")
      .attr("fill", (seriesItem) => color(seriesItem.key));
    groups.selectAll("rect")
      .data((seriesItem) => seriesItem.map((segment) => ({
        ...segment,
        key: seriesItem.key,
        category: roadCategories.find((category) => category.key === seriesItem.key)
      })))
      .join("rect")
      .attr("class", "q5-stack-segment")
      .attr("x", (segment) => x(segment.data.population))
      .attr("y", (segment) => y(segment[1]))
      .attr("width", x.bandwidth())
      .attr("height", (segment) => Math.max(0, y(segment[0]) - y(segment[1])))
      .attr("tabindex", 0)
      .attr("role", "img")
      .attr("aria-label", (segment) => {
        const count = segment.data.raw[segment.key];
        const share = segment[1] - segment[0];
        const categoryLabel = segment.key === "other"
          ? "Other, including the n.p. and Other/Unknown residual"
          : segment.category.label;
        return `${periodLabel()}, ${segment.data.population}, ${categoryLabel}: ${formatCount(count)} hospitalisations, ${share.toFixed(1)}%`;
      })
      .append("title")
      .text((segment) => {
        const count = segment.data.raw[segment.key];
        const share = segment[1] - segment[0];
        const categoryLabel = segment.key === "other"
          ? "Other (remaining categories, n.p., and Other/Unknown)"
          : segment.category.label;
        return `${periodLabel()} · ${segment.data.population} · ${categoryLabel}: ${formatCount(count)} hospitalisations (${share.toFixed(1)}%)`;
      });
    groups.selectAll(".q5-segment-label")
      .data((seriesItem) => seriesItem.map((segment) => ({
        ...segment,
        category: roadCategories.find((category) => category.key === seriesItem.key)
      })))
      .join("text")
      .attr("class", "q5-segment-label")
      .attr("x", (segment) => x(segment.data.population) + x.bandwidth() / 2)
      .attr("y", (segment) => y((segment[0] + segment[1]) / 2) + 3)
      .text((segment) => segment[1] - segment[0] >= 9 ? `${(segment[1] - segment[0]).toFixed(0)}%` : "");

  }

  function drawRemotenessSlope() {
    const { svg, width, height } = chartCanvas(remotenessChart);
    const margin = { top: 28, right: 28, bottom: 70, left: 42 };
    const plotWidth = width - margin.left - margin.right;
    const values = populations.map((population) => getRemotenessComposition(population.key));
    const x = d3.scalePoint()
      .domain(populations.map((population) => population.label))
      .range([margin.left + 12, width - margin.right - 12]);
    const y = d3.scaleLinear()
      .domain([0, 100])
      .range([height - margin.bottom, margin.top]);
    const lines = remotenessCategories.map((category) => ({
      ...category,
      points: values.map((value) => ({
        population: value.population,
        count: value[category.key],
        total: value.knownTotal,
        share: value[category.key] / value.knownTotal * 100
      }))
    }));

    svg.append("g").attr("class", "grid")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).tickValues([0, 20, 40, 60, 80, 100])
        .tickSize(-plotWidth).tickFormat(""));
    svg.selectAll(".grid .domain").remove();
    svg.append("g").attr("class", "axis")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).tickValues([0, 20, 40, 60, 80, 100]).tickFormat((value) => `${value}%`));
    svg.append("text").attr("class", "q5-axis-title")
      .attr("x", margin.left-40).attr("y", 12).text("Composition (%)");
    const xAxis = svg.append("g").attr("class", "axis")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).tickSize(0).tickPadding(14));
    xAxis.selectAll(".tick text")
      .each(function (populationName) {
        const population = values.find((item) => item.population === populationName);
        const label = d3.select(this).text(null);
        label
          .append("tspan")
          .attr("x", 0)
          .text(populationName);
        label
          .append("tspan")
          .attr("x", 0)
          .attr("dy", "1.2em")
          .text(`n=${formatCount(population.knownTotal)}`);
      });

    const line = d3.line()
      .x((point) => x(point.population))
      .y((point) => y(point.share));
    const series = svg.append("g").selectAll(".q5-slope-series")
      .data(lines)
      .join("g")
      .attr("class", "q5-slope-series");
    series.append("path")
      .attr("class", "q5-slope-line")
      .attr("stroke", (category) => category.color)
      .attr("d", (category) => line(category.points))
      .attr("aria-label", (category) => {
        const [first, second] = category.points;
        return `${category.label}: ${first.population} ${first.share.toFixed(1)}%, ${second.population} ${second.share.toFixed(1)}%`;
      })
      .append("title")
      .text((category) => {
        const [first, second] = category.points;
        return `${category.label}: ${first.population} ${first.share.toFixed(1)}%, ${second.population} ${second.share.toFixed(1)}%`;
      });
    series.selectAll("circle")
      .data((category) => category.points.map((point) => ({ ...point, category })))
      .join("circle")
      .attr("class", "q5-slope-point")
      .attr("cx", (point) => x(point.population))
      .attr("cy", (point) => y(point.share))
      .attr("r", 5)
      .attr("fill", (point) => point.category.color)
      .attr("tabindex", 0)
      .attr("aria-label", (point) => `${periodLabel()}, ${point.population}, ${point.category.label}: ${formatCount(point.count)}} known-area cases (${point.share.toFixed(1)}%)`)
      .append("title")
      .text((point) => `${point.population} · ${point.category.label}: ${point.share.toFixed(1)}% (${formatCount(point.count)}) known remoteness cases`);
  }

  function render() {
    addLegend(roadLegend, roadCategories);
    addLegend(remotenessLegend, remotenessCategories);
    drawRoadUserComposition();
    drawRemotenessSlope();
  }

  render();
  const resizeObserver = new ResizeObserver(() => {
    window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(render);
  });
  resizeObserver.observe(roadChart);
  resizeObserver.observe(remotenessChart);
})();