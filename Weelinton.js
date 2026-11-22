"use strict";

const navMenu = document.querySelector("#nav-menu");
const navToggle = document.querySelector("#nav-toggle");
const sections = [...document.querySelectorAll("main .section")];
let wheelLocked = false;
let unlockTimer;
let targetSection = 0;

function setMenuOpen(isOpen) {
  navMenu.classList.toggle("show-menu", isOpen);
  navToggle.setAttribute("aria-expanded", String(isOpen));
  navToggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
}

navToggle?.addEventListener("click", () => {
  setMenuOpen(!navMenu.classList.contains("show-menu"));
});

document.querySelector("#nav-close")?.addEventListener("click", () => {
  setMenuOpen(false);
});

document.querySelectorAll(".nav__link").forEach((link) => {
  link.addEventListener("click", () => setMenuOpen(false));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setMenuOpen(false);
});

function currentSectionIndex() {
  return sections.reduce((closest, section, index) => {
    const distance = Math.abs(section.getBoundingClientRect().top);
    const closestDistance = Math.abs(sections[closest].getBoundingClientRect().top);
    return distance < closestDistance ? index : closest;
  }, 0);
}

targetSection = currentSectionIndex();

window.addEventListener("wheel", (event) => {
  if (event.deltaY === 0 || !sections.length) return;
  event.preventDefault();

  if (wheelLocked) return;

  wheelLocked = true;
  targetSection = Math.max(
    0,
    Math.min(sections.length - 1, targetSection + Math.sign(event.deltaY))
  );
  window.scrollTo({ top: sections[targetSection].offsetTop, behavior: "smooth" });
  unlockTimer = window.setTimeout(() => { wheelLocked = false; }, 1000);
}, { passive: false });

window.addEventListener("scrollend", () => {
  targetSection = currentSectionIndex();
}, { passive: true });

const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;

    document.querySelectorAll(".nav__link").forEach((link) => {
      const active = link.getAttribute("href") === `#${entry.target.id}`;
      link.classList.toggle("is-active", active);

      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  });
}, { rootMargin: "-45% 0px -45% 0px" });

sections.forEach((section) => sectionObserver.observe(section));