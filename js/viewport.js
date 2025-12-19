(() => {
  "use strict";

  const root = document.documentElement;
  const app = document.getElementById("app");

  const baseW = Number(app?.dataset?.width || 1280);
  const baseH = Number(app?.dataset?.height || 720);

  function getViewportSize() {
    const vv = window.visualViewport;
    if (vv) return { w: vv.width, h: vv.height };
    return { w: window.innerWidth, h: window.innerHeight };
  }

  function updateViewportVars(w, h) {
    // useful for mobile 100vh quirks
    root.style.setProperty("--vvw", `${Math.round(w)}px`);
    root.style.setProperty("--vvh", `${Math.round(h)}px`);
    root.style.setProperty("--vh", `${Math.round(h * 0.01)}px`);
    root.dataset.orientation = (w >= h) ? "landscape" : "portrait";
    try {
      root.dataset.mobile = (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) ? "1" : "0";
    } catch (_) {
      root.dataset.mobile = "0";
    }
  }

  function applyScale() {
    const { w, h } = getViewportSize();
    updateViewportVars(w, h);
    const scale = Math.min(w / baseW, h / baseH, 1);
    root.style.setProperty("--scale", String(scale));
  }

  // 初回
  applyScale();

  // 追従
  window.addEventListener("resize", applyScale, { passive: true });
  window.addEventListener("orientationchange", applyScale, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", applyScale, { passive: true });
    window.visualViewport.addEventListener("scroll", applyScale, { passive: true });
  }
})();
