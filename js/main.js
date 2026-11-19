"use strict";

// Page startup and navigation. Chart code lives in d3-charts.js.
(() => {
  async function init() {
    const chartsReady = await window.RoadInsightCharts.init();
    if (!chartsReady) return;

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
