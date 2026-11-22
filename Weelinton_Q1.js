"use strict";

(() => {
  const d3 = window.d3;
  const filter = document.querySelector("#q1-year-filter");
  const container = document.querySelector("#q1-chart");

  if (!filter || !container) return;

  if (!d3) {
    container.textContent = "The chart library could not be loaded. Check your internet connection and reload the page.";
    return;
  }

  const data = [
    { year: 2011, count: 34033 },
    { year: 2012, count: 34024 },
    { year: 2013, count: 35001 },
    { year: 2014, count: 35515 },
    { year: 2015, count: 37082 },
    { year: 2016, count: 38963 },
    { year: 2017, count: 39339 },
    { year: 2018, count: 39590 },
    { year: 2019, count: 39866 },
    { year: 2020, count: 37966 },
    { year: 2021, count: 39505 }
  ];
  const average = d3.mean(data, (d) => d.count);
  const formatCount = d3.format(",.0f");
  let selectedYear = null;
  let resizeFrame = 0;

  const tooltip = d3.select(container)
    .append("div")
    .attr("class", "q1-tooltip")
    .attr("role", "tooltip")
    .attr("aria-live", "polite")
    .property("hidden", true);

  const buttons = d3.select(filter)
    .selectAll("button")
    .data([{ year: null, label: "2011-2021" }, ...data.map((d) => ({ year: d.year, label: String(d.year) }))])
    .join("button")
    .attr("class", "q1-year-button")
    .attr("type", "button")
    .attr("aria-pressed", (d) => String(d.year === selectedYear))
    .text((d) => d.label)
    .on("click", (_event, d) => {
      selectedYear = d.year;
      buttons.attr("aria-pressed", (year) => String(year.year === selectedYear));
      render();
    });

  function tooltipText(d) {
    const difference = d.count - average;
    const relation = difference >= 0 ? "above" : "below";
    return `<strong>${d.year}</strong><br>${formatCount(d.count)} hospitalisations<br>${formatCount(Math.abs(difference))} ${relation} the average`;
  }

  function showTooltip(d, event, x, y) {
    const bounds = container.getBoundingClientRect();
    const point = event && Number.isFinite(event.clientX)
      ? [event.clientX - bounds.left, event.clientY - bounds.top]
      : [x, y];
    tooltip
      .html(tooltipText(d))
      .style("left", `${Math.max(100, Math.min(bounds.width - 100, point[0]))}px`)
      .style("top", `${Math.max(70, point[1])}px`)
      .property("hidden", false);
  }

  function hideTooltip() {
    tooltip.property("hidden", true);
  }

  function render() {
    const width = Math.max(300, Math.floor(container.clientWidth));
    const height = Math.max(240, Math.floor(container.clientHeight));
    const margin = { top: 28, right: 34, bottom: 56, left: 76 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const svg = d3.select(container)
      .selectAll("svg")
      .data([null])
      .join("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img")
      .attr("aria-label", "Annual Australian road traffic injury hospitalisations from 2011 to 2021. Bars show counts, a line connects yearly counts, and a dashed line marks the period average.");

    svg.selectAll("*").remove();

    const x = d3.scaleBand()
      .domain(data.map((d) => d.year))
      .range([margin.left, width - margin.right])
    const y = d3.scaleLinear()
      .domain([0, 44000])
      .range([height - margin.bottom, margin.top]);
    const averageY = y(average);

    svg.append("g")
      .attr("class", "grid")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickSize(-plotWidth).tickFormat(""));
    svg.selectAll(".grid .domain").remove();
    svg.append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(d3.scalePoint().domain(data.map((d) => d.year)).range([x.bandwidth() / 2 + margin.left, width - margin.right - x.bandwidth() / 2]))
        .tickFormat(d3.format("d")).tickSizeOuter(0));
    svg.append("text")
      .attr("class", "q1-axis-title")
      .attr("x", margin.left + plotWidth / 2)
      .attr("y", height - 17)
      .attr("text-anchor", "middle")
      .text("Year");
    svg.append("g")
      .attr("class", "axis")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat(formatCount));

    svg.append("text")
      .attr("class", "q1-axis-title")
      .attr("x", -(margin.top + plotHeight / 2))
      .attr("y", 19)
      .attr("transform", "rotate(-90)")
      .attr("text-anchor", "middle")
      .text("Hospitalisations");

    svg.append("g")
      .selectAll("rect")
      .data(data)
      .join("rect")
      .attr("class", (d) => `q1-bar${selectedYear !== null && d.year !== selectedYear ? " is-muted" : ""}${d.year === selectedYear ? " is-highlighted" : ""}`)
      .attr("x", (d) => x(d.year))
      .attr("y", (d) => y(d.count))
      .attr("width", x.bandwidth())
      .attr("height", (d) => height - margin.bottom - y(d.count))
      .attr("tabindex", 0)
      .attr("role", "img")
      .attr("aria-label", (d) => `${d.year}: ${formatCount(d.count)} hospitalisations, ${formatCount(Math.abs(d.count - average))} ${d.count >= average ? "above" : "below"} the average`)
      .on("pointerenter pointermove", (event, d) => {
        showTooltip(d, event, x(d.year) + x.bandwidth() / 2, y(d.count));
      })
      .on("pointerleave", hideTooltip)
      .on("focus", (_event, d) => {
        showTooltip(d, null, x(d.year) + x.bandwidth() / 2, y(d.count));
      })
      .on("blur", hideTooltip);

    svg.append("line")
      .attr("class", "q1-average-line")
      .attr("x1", margin.left)
      .attr("x2", width - margin.right)
      .attr("y1", averageY)
      .attr("y2", averageY);
    svg.append("text")
      .attr("class", "q1-average-label")
      .attr("x", width - margin.right - 4)
      .attr("y", averageY - 19)
      .attr("text-anchor", "end")
      .text(`Average ${formatCount(average)}`);

    const peak = data.reduce((highest, d) => d.count > highest.count ? d : highest, data[0]);
    svg.selectAll(".q1-bar")
      .filter((d) => d.year === peak.year)
      .classed("is-peak", true);
    svg.append("path")
      .datum(data)
      .attr("class", "q1-value-line")
      .attr("d", d3.line()
        .x((d) => x(d.year) + x.bandwidth() / 2)
        .y((d) => y(d.count)));

    svg.append("g")
      .selectAll("circle")
      .data(data)
      .join("circle")
      .attr("class", "q1-point")
      .attr("cx", (d) => x(d.year) + x.bandwidth() / 2)
      .attr("cy", (d) => y(d.count))
      .attr("r", (d) => d.year === peak.year || d.year === selectedYear ? 4 : 4)
      .attr("fill", (d) => d.year === peak.year ? "#e87524" : null)
      .attr("tabindex", 0)
      .attr("aria-label", (d) => `${d.year}: ${formatCount(d.count)} hospitalisations`)
      .on("pointerenter pointermove", (event, d) => {
        showTooltip(d, event, x(d.year) + x.bandwidth() / 2, y(d.count));
      })
      .on("pointerleave", hideTooltip)
      .on("focus", (_event, d) => {
        showTooltip(d, null, x(d.year) + x.bandwidth() / 2, y(d.count));
      })
      .on("blur", hideTooltip);
  }

  render();
  const resizeObserver = new ResizeObserver(() => {
    window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(render);
  });
  resizeObserver.observe(container);
})();