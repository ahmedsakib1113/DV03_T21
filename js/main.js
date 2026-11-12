"use strict";

// Export each KNIME chart as a PNG to the path in its image's data-src.
// The placeholder stays visible until the chart loads.
document.querySelectorAll("img[data-src]").forEach((chart) => {
  chart.addEventListener("load", () => {
    chart.nextElementSibling.hidden = true;
    chart.hidden = false;
  }, { once: true });
  chart.src = chart.dataset.src;
});
