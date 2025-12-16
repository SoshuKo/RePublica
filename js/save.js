/* =========================================================
   save.js
   - セーブ/ロード（localStorage スロット）
   - セーブJSONの export/import（ファイルダウンロード＆読み込み）
   - bundler無し（scriptタグ直読み）前提：window.RP にぶら下げる
   - UI/Engineが未実装でも壊れない（自動でDOMイベントは貼らない）
   ========================================================= */

(() => {
  "use strict";

  const RP = (window.RP = window.RP || {});
  if (!RP.CONST) throw new Error("RP.CONST not found. Load constants.js first.");
  if (!RP.VERSION) throw new Error("RP.VERSION not found. Load version.js first.");
  if (!RP.State) throw new Error("RP.State not found. Load state.js first.");

  const { DEFAULTS } = RP.CONST;

  // ---------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------
  function nowIso() {
    return new Date().toISOString();
  }

  function isPlainObject(x) {
    return !!x && typeof x === "object" && Object.getPrototypeOf(x) === Object.prototype;
  }

  function safeJsonParse(text) {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  function stringifyPretty(obj) {
    return JSON.stringify(obj, null, 2);
  }

  function makeFilename(prefix = "republica_save") {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp =
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
      `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `${prefix}_${stamp}.json`;
  }

  function downloadTextFile(filename, text, mime = "application/json") {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();

    // cleanup
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.readAsText(file, "utf-8");
    });
  }

  function storageKeyForSlot(slotIndex) {
    const prefix = DEFAULTS.save.storageKeyPrefix;
    return `${prefix}${slotIndex}`;
  }

  // localStorage は環境により例外（Safari private等）を投げるのでガード
  function lsGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      throw new Error(`localStorage unavailable (get): ${String(e?.message || e)}`);
    }
  }

  function lsSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      throw new Error(`localStorage unavailable (set): ${String(e?.message || e)}`);
    }
  }

  function lsRemove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (e) {
      throw new Error(`localStorage unavailable (remove): ${String(e?.message || e)}`);
    }
  }

  // ---------------------------------------------------------
  // Save schema
  // ---------------------------------------------------------
  // この形式でエクスポートする：
  // {
  //   schema: "republica.save",
  //   saveVersion: <int>,
  //   meta: { appVersion, exportedAt, chapterId, sceneId, step },
  //   state: { ... }  // RP.State の形
  // }
  function makeSaveObject(state, extraMeta = {}) {
    const safeState = RP.State.normalizeState(state);

    const meta = {
      appVersion: RP.VERSION.APP_VERSION,
      exportedAt: nowIso(),
      chapterId: safeState.chapterId ?? null,
      sceneId: safeState.pointer?.sceneId ?? null,
      step: safeState.pointer?.step ?? 0,
      ...extraMeta,
    };

    return {
      schema: "republica.save",
      saveVersion: RP.VERSION.SAVE_VERSION,
      meta,
      state: safeState,
    };
  }

  function extractStateFromSaveObject(obj) {
    // 互換のため複数候補を見る
    if (isPlainObject(obj?.state)) return obj.state;
    if (isPlainObject(obj?.payload?.state)) return obj.payload.state;
    // 「stateだけ」JSONで渡された場合
    if (isPlainObject(obj) && obj.screen && obj.view) return obj;
    return null;
  }

  // ---------------------------------------------------------
  // Serialize / Parse / Migrate
  // ---------------------------------------------------------
  function serialize(state, extraMeta = {}) {
    const saveObj = makeSaveObject(state, extraMeta);
    return stringifyPretty(saveObj);
  }

  function parse(jsonText) {
    const parsed = safeJsonParse(jsonText);
    if (!parsed.ok) {
      throw new Error("Invalid JSON file");
    }

    let obj = parsed.value;

    // saveVersion 移行（version.jsの枠組み）
    // ※ migrateSaveObject は saveObj 全体を扱う
    obj = RP.VERSION.migrateSaveObject(obj);

    const extractedState = extractStateFromSaveObject(obj);
    if (!extractedState) {
      throw new Error("Invalid save: missing state");
    }

    const normalized = RP.State.normalizeState(extractedState);

    // 形が壊れていないか軽く検査（厳密にしたいなら UI 側でエラー表示）
    const v = RP.State.validateState(normalized);
    if (!v.ok) {
      throw new Error(`Invalid state in save: ${v.errors.join(", ")}`);
    }

    return {
      saveObject: obj,
      state: normalized,
    };
  }

  // ---------------------------------------------------------
  // Export / Import (file)
  // ---------------------------------------------------------
  function exportToFile(state, options = {}) {
    const {
      filenamePrefix = "republica_save",
      extraMeta = {},
    } = options;

    const text = serialize(state, extraMeta);
    const filename = makeFilename(filenamePrefix);
    downloadTextFile(filename, text, "application/json");
  }

  async function importFromFile(file) {
    if (!file) throw new Error("No file provided");
    const text = await readFileAsText(file);
    return parse(text).state;
  }

  // ---------------------------------------------------------
  // Slots (localStorage)
  // ---------------------------------------------------------
  function saveToSlot(state, slotIndex) {
    const slots = DEFAULTS.save.slots;
    if (!Number.isInteger(slotIndex) || slotIndex < 1 || slotIndex > slots) {
      throw new Error(`slotIndex must be 1..${slots}`);
    }

    const key = storageKeyForSlot(slotIndex);
    const text = serialize(state, { savedToSlot: slotIndex, savedAt: nowIso() });
    lsSet(key, text);
  }

  function loadFromSlot(slotIndex) {
    const slots = DEFAULTS.save.slots;
    if (!Number.isInteger(slotIndex) || slotIndex < 1 || slotIndex > slots) {
      throw new Error(`slotIndex must be 1..${slots}`);
    }

    const key = storageKeyForSlot(slotIndex);
    const text = lsGet(key);
    if (!text) return null;

    return parse(text).state;
  }

  function clearSlot(slotIndex) {
    const slots = DEFAULTS.save.slots;
    if (!Number.isInteger(slotIndex) || slotIndex < 1 || slotIndex > slots) {
      throw new Error(`slotIndex must be 1..${slots}`);
    }
    lsRemove(storageKeyForSlot(slotIndex));
  }

  function slotExists(slotIndex) {
    const key = storageKeyForSlot(slotIndex);
    return !!lsGet(key);
  }

  // ---------------------------------------------------------
  // Settings (optional)
  // ---------------------------------------------------------
  function saveSettings(settings) {
    const key = DEFAULTS.save.settingsKey;
    const safe = {
      bgmVolume: Number.isFinite(settings?.bgmVolume) ? settings.bgmVolume : DEFAULTS.settings.bgmVolume,
      seVolume: Number.isFinite(settings?.seVolume) ? settings.seVolume : DEFAULTS.settings.seVolume,
      textSpeed: Number.isFinite(settings?.textSpeed) ? settings.textSpeed : DEFAULTS.settings.textSpeed,
      savedAt: nowIso(),
      appVersion: RP.VERSION.APP_VERSION,
    };
    lsSet(key, stringifyPretty(safe));
  }

  function loadSettings() {
    const key = DEFAULTS.save.settingsKey;
    const text = lsGet(key);
    if (!text) return null;

    const parsed = safeJsonParse(text);
    if (!parsed.ok) return null;

    const obj = parsed.value;
    if (!isPlainObject(obj)) return null;

    return {
      bgmVolume: Number.isFinite(obj.bgmVolume) ? obj.bgmVolume : DEFAULTS.settings.bgmVolume,
      seVolume: Number.isFinite(obj.seVolume) ? obj.seVolume : DEFAULTS.settings.seVolume,
      textSpeed: Number.isFinite(obj.textSpeed) ? obj.textSpeed : DEFAULTS.settings.textSpeed,
    };
  }

  // ---------------------------------------------------------
  // UI wiring helper (optional)
  // ---------------------------------------------------------
  // ui.js から呼ぶ用：
  // RP.Save.wireDom({
  //   getState: () => currentState,
  //   setState: (s) => { currentState = s; render(); },
  //   onError: (msg) => showModal(msg),
  // })
  function wireDom(opts) {
    const {
      getState,
      setState,
      onError = (msg) => console.error(msg),
      onInfo = (msg) => console.log(msg),
      ids = null, // 省略時は RP.CONST.DOM を使う
    } = opts || {};

    if (typeof getState !== "function") throw new Error("wireDom requires getState()");
    if (typeof setState !== "function") throw new Error("wireDom requires setState(state)");

    const DOM = ids || RP.CONST.DOM;

    const byId = (id) => document.getElementById(id);

    // Export
    const btnExport = byId(DOM.menu.exportJson);
    if (btnExport) {
      btnExport.addEventListener("click", () => {
        try {
          exportToFile(getState(), { filenamePrefix: "republica_save" });
          onInfo("Exported save JSON");
        } catch (e) {
          onError(e.message || String(e));
        }
      });
    }

    // Import buttons -> file input
    const btnImport = byId(DOM.menu.importJson);
    const inputImport = byId(DOM.menu.importFile);
    if (btnImport && inputImport) {
      btnImport.addEventListener("click", () => inputImport.click());
      inputImport.addEventListener("change", async () => {
        const file = inputImport.files?.[0];
        inputImport.value = ""; // 同じファイルを連続で選べるように
        if (!file) return;
        try {
          const nextState = await importFromFile(file);
          setState(nextState);
          onInfo("Imported save JSON");
        } catch (e) {
          onError(e.message || String(e));
        }
      });
    }

    // Title import (continue)
    const btnContinue = byId(DOM.title.continueJson);
    const inputTitleImport = byId(DOM.title.importFile);
    if (btnContinue && inputTitleImport) {
      btnContinue.addEventListener("click", () => inputTitleImport.click());
      inputTitleImport.addEventListener("change", async () => {
        const file = inputTitleImport.files?.[0];
        inputTitleImport.value = "";
        if (!file) return;
        try {
          const nextState = await importFromFile(file);
          setState(nextState);
          onInfo("Imported save JSON (title)");
        } catch (e) {
          onError(e.message || String(e));
        }
      });
    }

    // Slots save/load
    const map = [
      { save: DOM.menu.save1, load: DOM.menu.load1, idx: 1 },
      { save: DOM.menu.save2, load: DOM.menu.load2, idx: 2 },
      { save: DOM.menu.save3, load: DOM.menu.load3, idx: 3 },
    ];

    for (const { save, load, idx } of map) {
      const sBtn = byId(save);
      const lBtn = byId(load);

      if (sBtn) {
        sBtn.addEventListener("click", () => {
          try {
            saveToSlot(getState(), idx);
            onInfo(`Saved to slot ${idx}`);
          } catch (e) {
            onError(e.message || String(e));
          }
        });
      }

      if (lBtn) {
        lBtn.addEventListener("click", () => {
          try {
            const loaded = loadFromSlot(idx);
            if (!loaded) {
              onError(`Slot ${idx} is empty`);
              return;
            }
            setState(loaded);
            onInfo(`Loaded from slot ${idx}`);
          } catch (e) {
            onError(e.message || String(e));
          }
        });
      }
    }
  }

  // ---------------------------------------------------------
  // Public export
  // ---------------------------------------------------------
  RP.Save = Object.freeze({
    // core
    makeSaveObject,
    serialize,
    parse,

    // export/import
    exportToFile,
    importFromFile,

    // slots
    saveToSlot,
    loadFromSlot,
    clearSlot,
    slotExists,

    // settings (optional)
    saveSettings,
    loadSettings,

    // ui helper
    wireDom,
  });
})();
