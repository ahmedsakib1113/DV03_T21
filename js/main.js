"use strict";

// Page startup, chart analysis order, and question navigation.
(() => {
  const questions = [...document.querySelectorAll(".research-content > .question-section")];
  const navigation = [...document.querySelectorAll(".question-nav a")];
  const workspace = document.getElementById("research-workspace");
  let activeQuestion;

  function markCurrent(id) {
    navigation.forEach(link => {
      if (link.hash === "#" + id) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
  }

  function showLocation(moveFocus = false) {
    const previous = activeQuestion;
    const hash = window.location.hash;
    activeQuestion = questions.find(section => "#" + section.id === hash);
    document.documentElement.toggleAttribute("data-question-view", Boolean(activeQuestion));
    workspace.hidden = !activeQuestion;
    questions.forEach(section => section.classList.toggle("is-focused-question", section === activeQuestion));
    markCurrent(activeQuestion?.id ?? (hash === "#sources" ? "sources" : null));

    if (activeQuestion) {
      if (activeQuestion !== previous) window.RoadInsightCharts.resizeQuestion(activeQuestion.id);
      if (moveFocus) {
        const heading = activeQuestion.querySelector("h2");
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
        window.scrollTo({ top: 0, behavior: "instant" });
      }
    } else if (previous) {
      const target = document.getElementById(hash.slice(1)) || document.getElementById("research-questions");
      target.scrollIntoView({ behavior: "instant" });
    }
  }

  async function init() {
    document.querySelectorAll(".question-nav a, .question-list a, .hero-map-link, .question-pager a").forEach(link => {
      if (!questions.some(section => "#" + section.id === link.hash)) return;
      link.addEventListener("click", event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (window.location.hash !== link.hash) window.history.pushState(null, "", link.hash);
        showLocation(true);
      });
    });
    window.addEventListener("hashchange", () => showLocation(true));
    let resizeFrame;
    window.addEventListener("resize", () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (activeQuestion) window.RoadInsightCharts.resizeQuestion(activeQuestion.id);
      });
    });
    showLocation();
    const chartsReady = await window.RoadInsightCharts.init();
    if (!chartsReady) return;
    if (activeQuestion) window.RoadInsightCharts.resizeQuestion(activeQuestion.id);

    document.documentElement.dataset.chartsReady = "true";
  }

  init();
})();
