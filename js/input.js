/* =========================================================
   input.js
   - 入力統一のためのユーティリティ & 将来の一括バインド用ヘルパ
   - 現状 engine.js / ui.js が入力を直接バインドしているため、
     ここでは「自動でイベントを貼らない」設計（重複発火防止）
   - bundler無し（scriptタグ直読み）前提：window.RP にぶら下げる
   ========================================================= */

(() => {
  "use strict";

  const RP = (window.RP = window.RP || {});
  if (!RP.CONST) throw new Error("RP.CONST not found. Load constants.js first.");

  const { INPUT: INPUT_CONST } = RP.CONST;

  // ---------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------
  function isTextEntryTarget(target) {
    if (!target) return false;

    // Shadow DOM 対応（composedPathがあれば優先）
    const el = Array.isArray(target) ? target[0] : target;

    if (!(el instanceof HTMLElement)) return false;

    const tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;

    // contenteditable
    if (el.isContentEditable) return true;

    return false;
  }

  function normalizeKey(key) {
    // ブラウザ差異の軽い吸収
    // Space は " " で来ることが多い
    if (key === " ") return "Space";
    if (key === "Spacebar") return "Space";
    if (key === "Esc") return "Escape";
    if (key === "Return") return "Enter";
    return key;
  }

  function buildKeySet(keys) {
    const set = new Set();
    for (const k of keys || []) set.add(normalizeKey(k));
    return set;
  }

  const KEYSETS = Object.freeze({
    advance: buildKeySet(INPUT_CONST?.keys?.advance || ["Enter", "Space"]),
    menu: buildKeySet(INPUT_CONST?.keys?.menu || ["Escape"]),
  });

  function isAdvanceKey(ev) {
    return KEYSETS.advance.has(normalizeKey(ev.key));
  }

  function isMenuKey(ev) {
    return KEYSETS.menu.has(normalizeKey(ev.key));
  }

  // 連打や二重イベント（touch→click等）対策の軽いガード
  function makeDebounceGate(ms = 80) {
    let last = 0;
    return () => {
      const t = performance.now();
      if (t - last < ms) return false;
      last = t;
      return true;
    };
  }

  // ---------------------------------------------------------
  // Tiny event bus (optional use)
  // ---------------------------------------------------------
  const _listeners = new Map();
  function on(type, fn) {
    if (!_listeners.has(type)) _listeners.set(type, new Set());
    _listeners.get(type).add(fn);
    return () => _listeners.get(type)?.delete(fn);
  }
  function emit(type, payload) {
    const set = _listeners.get(type);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload); } catch (e) { console.error(e); }
    }
  }

  // ---------------------------------------------------------
  // Optional binder (call manually from engine.js later if you refactor)
  // ---------------------------------------------------------
  // bind({
  //   advanceEl: HTMLElement | null (nullならdocument全体)
  //   onAdvance: () => void
  //   onMenuToggle: () => void
  //   stopPropagation: boolean
  // })
  function bind(opts = {}) {
    const {
      advanceEl = null,
      onAdvance = () => emit("advance"),
      onMenuToggle = () => emit("menuToggle"),
      stopPropagation = false,
    } = opts;

    const allow = makeDebounceGate(90);

    const keyHandler = (ev) => {
      if (isTextEntryTarget(ev.target)) return;

      if (isAdvanceKey(ev)) {
        // Space はスクロール抑止
        ev.preventDefault();
        if (stopPropagation) ev.stopPropagation();
        if (ev.repeat) return;
        if (!allow()) return;
        onAdvance();
      } else if (isMenuKey(ev)) {
        if (stopPropagation) ev.stopPropagation();
        if (ev.repeat) return;
        if (!allow()) return;
        onMenuToggle();
      }
    };

    // モバイルは click より pointerup が安定することが多い
    const ptrHandler = (ev) => {
      if (stopPropagation) ev.stopPropagation();
      if (!allow()) return;
      onAdvance();
    };

    const el = advanceEl || document;
    window.addEventListener("keydown", keyHandler, { passive: false });

    // pointerup を優先しつつ click もフォールバック（環境差吸収）
    el.addEventListener("pointerup", ptrHandler);
    el.addEventListener("click", ptrHandler);

    return () => {
      window.removeEventListener("keydown", keyHandler);
      el.removeEventListener("pointerup", ptrHandler);
      el.removeEventListener("click", ptrHandler);
    };
  }

  // ---------------------------------------------------------
  // Public export
  // ---------------------------------------------------------
  RP.Input = Object.freeze({
    // utils
    normalizeKey,
    isTextEntryTarget,
    isAdvanceKey,
    isMenuKey,

    // bus
    on,
    emit,

    // optional binder
    bind,
  });
})();
