(() => {
  "use strict";
  const RP = (window.RP = window.RP || {});
  if (!RP.CONST) throw new Error("RP.CONST not found. Load constants.js first.");

  const fadeId = RP.CONST.DOM?.overlay?.fade || "screenFade";

  function getFadeEl() {
    return document.getElementById(fadeId);
  }

  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function fadeTo(alpha, ms = 250) {
    const el = getFadeEl();
    if (!el) return;
    el.style.pointerEvents = alpha > 0 ? "auto" : "none";
    el.style.transition = `opacity ${ms}ms linear`;
    el.style.opacity = String(alpha);
    await wait(ms);
  }

  RP.Transitions = Object.freeze({
    fadeIn: (ms = 250) => fadeTo(0, ms),
    fadeOut: (ms = 250) => fadeTo(1, ms),
    fadeTo,
  });
})();
