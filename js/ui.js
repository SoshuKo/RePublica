/* =========================================================
   ui.js
   - DOMとStateを結び、画面表示を管理する（タイトル/ADV/戦闘/メニュー/モーダル）
   - engine.js が未実装でも “ガワだけ動く” ようにしてある
   - Save.wireDom もここから呼べる（ただしDOMへの自動バインドは最小限）
   ========================================================= */

(() => {
  "use strict";

  const RP = (window.RP = window.RP || {});
  if (!RP.CONST) throw new Error("RP.CONST not found. Load constants.js first.");
  if (!RP.State) throw new Error("RP.State not found. Load state.js first.");

  const { DOM: DOM_IDS, LAYERS, SCREENS, ASSET, ASSET_DIR, DEFAULTS } = RP.CONST;

  // ---------------------------------------------------------
  // Internal state store (engineがない間はUIが保持)
  // engine.js が後で来たら RP.UI.setState を使って上書きできる
  // ---------------------------------------------------------
  let _state = RP.State.createDefaultState();

  // UI overlays are NOT saved (menu/modal open etc.)
  const _overlay = {
    menuOpen: false,
    modalOpen: false,
    baseScreenBeforeMenu: null,
  };

  // ---------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------
  const $ = (id) => document.getElementById(id);

  function setHidden(el, hidden) {
    if (!el) return;
    el.classList.toggle("is-hidden", !!hidden);
    el.setAttribute("aria-hidden", hidden ? "true" : "false");
  }

  function setText(el, text) {
    if (!el) return;
    el.textContent = text ?? "";
  }


  // ADV speaking highlight helper (classes live on #charSelf/#charEnemy containers)
  function setSpeakClass(slotEl, { speaking = false, dimmed = false } = {}) {
    if (!slotEl) return;
    slotEl.classList.toggle("is-speaking", !!speaking);
    slotEl.classList.toggle("is-dimmed", !!dimmed);
  }

  function safeSrcSet(imgEl, src) {
    if (!imgEl) return;
    if (!src) {
      imgEl.removeAttribute("src");
      return;
    }
    imgEl.src = src;
  }

  function endsWithImageExt(name) {
    return typeof name === "string" && /\.(png|webp|jpg|jpeg)$/i.test(name);
  }

  function resolveCharSrc(fileOrName) {
    if (!fileOrName) return null;
    // "アカウ.png" or "アカウ"
    if (endsWithImageExt(fileOrName)) return ASSET.path(ASSET_DIR.char, fileOrName);
    return ASSET.charPng(fileOrName);
  }

  function resolveBgSrc(filename) {
    if (!filename) return null;
    // allow "hall.webp" or "bg/hall.webp" (rare). If includes "/" treat as raw relative.
    if (filename.includes("/")) return encodeURI(filename);
    return ASSET.bgFile(filename);
  }

  function normalizeAndSetState(next) {
    _state = RP.State.normalizeState(next);
    render(_state);
  }

  // ---------------------------------------------------------
  // Modal (simple)
  // ---------------------------------------------------------
  function showModal({ title = "確認", message = "", okText = "OK", cancelText = "キャンセル", onOk, onCancel } = {}) {
    const modalLayer = $(LAYERS.modal);
    const t = $(DOM_IDS.modal.title);
    const m = $(DOM_IDS.modal.message);
    const ok = $(DOM_IDS.modal.ok);
    const cancel = $(DOM_IDS.modal.cancel);

    if (!modalLayer || !ok || !cancel) return;

    setText(t, title);
    setText(m, message);
    ok.textContent = okText;
    cancel.textContent = cancelText;

    // remove old listeners by cloning
    const ok2 = ok.cloneNode(true);
    const cancel2 = cancel.cloneNode(true);
    ok.parentNode.replaceChild(ok2, ok);
    cancel.parentNode.replaceChild(cancel2, cancel);

    ok2.addEventListener("click", () => {
      closeModal();
      if (typeof onOk === "function") onOk();
    });
    cancel2.addEventListener("click", () => {
      closeModal();
      if (typeof onCancel === "function") onCancel();
    });

    _overlay.modalOpen = true;
    setHidden(modalLayer, false);
  }

  function closeModal() {
    const modalLayer = $(LAYERS.modal);
    _overlay.modalOpen = false;
    setHidden(modalLayer, true);
  }

  function showError(err) {
    const msg = err?.message ? String(err.message) : String(err);
    showModal({ title: "エラー", message: msg, okText: "OK", cancelText: "閉じる" });
  }

  // ---------------------------------------------------------
  // Menu overlay (not part of saved state)
  // ---------------------------------------------------------
  function openMenu() {
    const menuLayer = $(LAYERS.menu);
    if (!menuLayer) return;
    if (_overlay.menuOpen) return;

    _overlay.menuOpen = true;
    _overlay.baseScreenBeforeMenu = _state.screen;

    setHidden(menuLayer, false);

    // reflect current settings into sliders
    const s = _state.settings || {};
    const bgm = $(DOM_IDS.menu.optBgmVol);
    const se = $(DOM_IDS.menu.optSeVol);
    const ts = $(DOM_IDS.menu.optTextSpeed);
    if (bgm) bgm.value = String(Math.round((s.bgmVolume ?? DEFAULTS.settings.bgmVolume) * 100));
    if (se) se.value = String(Math.round((s.seVolume ?? DEFAULTS.settings.seVolume) * 100));
    if (ts) ts.value = String(Math.round((s.textSpeed ?? DEFAULTS.settings.textSpeed) * 100));
  }

  function closeMenu() {
    const menuLayer = $(LAYERS.menu);
    if (!menuLayer) return;

    _overlay.menuOpen = false;
    _overlay.baseScreenBeforeMenu = null;

    setHidden(menuLayer, true);
  }

  // ---------------------------------------------------------
  // Chapter selection (uses ADV choice overlay for now)
  // - If RP.CONST.CHAPTERS exists, use it. Otherwise fallback.
  // ---------------------------------------------------------
  function getChapters() {
    // Optional future extension: RP.CONST.CHAPTERS = [{id, title, sceneId}, ...]
    const list = RP.CONST.CHAPTERS;
    if (Array.isArray(list) && list.length) return list;

    // fallback
    return [
      { id: "chapter5", title: "第五章", sceneId: null },
      { id: "chapter6", title: "第六章", sceneId: null },
      { id: "chapter7", title: "第七章", sceneId: null },
    ];
  }

  function startNewGameFlow() {
    // reset state
    const s = RP.State.createDefaultState();
    s.screen = SCREENS.ADV;

    // show chapter choices in the big centered choice panel
    const chapters = getChapters();
    s.view.choice.visible = true;
    s.view.choice.options = chapters.map((c) => ({ id: c.id, text: c.title }));

    // optional: clear speech until chapter chosen
    s.view.speech.visible = false;
    s.view.speech.name = "";
    s.view.speech.text = "";

    normalizeAndSetState(s);
  }

  function applyChapterSelection(chapterId) {
    const chapters = getChapters();
    const c = chapters.find((x) => x.id === chapterId);

    // hide choices
    const s = RP.State.deepClone(_state);
    s.chapterId = chapterId;
    s.view.choice.visible = false;
    s.view.choice.options = [];

    // set a minimal pointer (real scenario later)
    if (c && c.sceneId) {
      s.pointer.sceneId = c.sceneId;
      s.pointer.step = 0;
    } else {
      s.pointer.sceneId = chapterId; // placeholder
      s.pointer.step = 0;
    }

    // show a placeholder speech (engineができたら消す/置き換える想定)
    s.view.speech.visible = true;
    s.view.speech.side = "self";
    s.view.speech.name = "System";
    s.view.speech.text = `${c?.title ?? chapterId} を開始します（シナリオは後で接続）`;

    normalizeAndSetState(s);
  }

  // ---------------------------------------------------------
  // Render
  // ---------------------------------------------------------
  function render(state) {
    // base layers
    const titleLayer = $(LAYERS.title);
    const advLayer = $(LAYERS.adv);
    const battleLayer = $(LAYERS.battle);
    const menuLayer = $(LAYERS.menu);
    const modalLayer = $(LAYERS.modal);
    const overlayLayer = $(LAYERS.overlay);

    // show/hide base by state.screen
    const isTitle = state.screen === SCREENS.TITLE;
    const isAdv = state.screen === SCREENS.ADV;
    const isBattle = state.screen === SCREENS.BATTLE;

    setHidden(titleLayer, !isTitle);
    setHidden(advLayer, !isAdv);
    setHidden(battleLayer, !isBattle);

    // overlay layers (always exist but hidden)
    if (overlayLayer) setHidden(overlayLayer, false); // overlay container stays (fade opacity is controlled elsewhere)
    setHidden(menuLayer, !_overlay.menuOpen);
    setHidden(modalLayer, !_overlay.modalOpen);

    // -------------------------
    // ADV render
    // -------------------------
    if (isAdv) {
      // backgrounds
      const bgMain = $(DOM_IDS.adv.bgMain);
      const bgFront = $(DOM_IDS.adv.bgFront);

      const bg = state.view?.background || {};
      const mainSrc = resolveBgSrc(bg.main);
      const frontSrc = resolveBgSrc(bg.front);

      safeSrcSet(bgMain, mainSrc);
      safeSrcSet(bgFront, frontSrc);
      setHidden(bgFront, !(bg.frontVisible && !!frontSrc));

      // characters
      const selfImg = $(DOM_IDS.adv.charSelfImg);
      const enemyImg = $(DOM_IDS.adv.charEnemyImg);

      const selfSlot = document.getElementById("charSelf");
      const enemySlot = document.getElementById("charEnemy");

      const chars = state.view?.characters || {};
      const self = chars.self || {};
      const enemy = chars.enemy || {};

      const selfSrc = resolveCharSrc(self.file || self.name);
      const enemySrc = resolveCharSrc(enemy.file || enemy.name);

      safeSrcSet(selfImg, selfSrc);
      safeSrcSet(enemyImg, enemySrc);

      // hide character image if not visible
      // (we hide by toggling the img itself to keep layout stable)
      setHidden(selfImg, !self.visible || !selfSrc);
      setHidden(enemyImg, !enemy.visible || !enemySrc);

// VN fixed dialogue window (single)
const vnUI = document.getElementById("vnUI");
const vnNameplate = document.getElementById("vnNameplate");
const vnName = document.getElementById("vnName");
const vnText = document.getElementById("vnText");

// 旧吹き出しは使わない（残ってても常に隠す）
const bubbleSelf = $(DOM_IDS.adv.bubbleSelf);
const bubbleEnemy = $(DOM_IDS.adv.bubbleEnemy);
setHidden(bubbleSelf, true);
setHidden(bubbleEnemy, true);

const speech = state.view?.speech || {};
const showSpeech = !!speech.visible && !!speech.text;

if (!showSpeech) {
  setHidden(vnUI, true);
} else {
  setHidden(vnUI, false);

  const fallbackName =
    (speech.side === "enemy") ? (enemy.name || "？？？") : (self.name || "？？？");

  const name =
    (speech.name && String(speech.name).trim()) ? String(speech.name).trim() : fallbackName;

  // 名前が不要な行（地の文にしたい等）があるなら、speech.name を "" にしておけば非表示になる
  setHidden(vnNameplate, !name);
  setText(vnName, name || "");
  setText(vnText, speech.text || "");
}


      // Always use ONE dialogue window at the bottom (bubbleSelf).
      // bubbleEnemy is kept for compatibility but hidden.
      if (!showSpeech) {
        setHidden(bubbleSelf, true);
        setHidden(bubbleEnemy, true);
      } else {
        setHidden(bubbleEnemy, true);
        setHidden(bubbleSelf, false);

        // Speaker name: prefer explicit speech.name, otherwise fallback by side
        const fallbackName = (speech.side === "enemy") ? (enemy.name || "？？？") : (self.name || "？？？");
        setText($(DOM_IDS.adv.nameSelf), (speech.name && String(speech.name).trim()) ? speech.name : fallbackName);
        setText($(DOM_IDS.adv.textSelf), speech.text || "");
      }

      // speaking highlight (dim the non-speaking side)
      if (!showSpeech) {
        setSpeakClass(selfSlot, { speaking: false, dimmed: false });
        setSpeakClass(enemySlot, { speaking: false, dimmed: false });
      } else if (speech.side === "enemy") {
        setSpeakClass(enemySlot, { speaking: true, dimmed: false });
        setSpeakClass(selfSlot, { speaking: false, dimmed: true });
      } else {
        setSpeakClass(selfSlot, { speaking: true, dimmed: false });
        setSpeakClass(enemySlot, { speaking: false, dimmed: true });
      }

      // choices
      const choiceLayer = $(LAYERS.choice);
      const choiceList = $(DOM_IDS.adv.choiceList);
      const choice = state.view?.choice || {};

      if (choiceLayer && choiceList) {
        const showChoices = !!choice.visible && Array.isArray(choice.options) && choice.options.length > 0;
        setHidden(choiceLayer, !showChoices);

        if (showChoices) {
          // clear list
          choiceList.innerHTML = "";
          for (const opt of choice.options) {
            const btn = document.createElement("button");
            btn.className = "choice-btn";
            btn.type = "button";
            btn.textContent = opt.text ?? String(opt.id);
            btn.addEventListener("click", () => {
              // if chapter selection flow: apply directly when no real engine yet
              if (!_state.chapterId && typeof opt.id === "string" && opt.id.startsWith("chapter")) {
                applyChapterSelection(opt.id);
                return;
              }
              // otherwise: bubble up
              emit("choice", { id: opt.id });
            });
            choiceList.appendChild(btn);
          }
        }
      }
    }

    // -------------------------
    // Battle render (single board)
    // -------------------------
    if (isBattle) {
      setText($(DOM_IDS.battle.score), String(state.battle?.score ?? 0));
      setText($(DOM_IDS.battle.chain), String(state.battle?.chain ?? 0));
      // timeLeft は旧仕様（表示しなくてもOK）
      setText($(DOM_IDS.battle.time), state.battle?.timeLeft == null ? "--" : String(state.battle.timeLeft));

      // portraits (battle sides) = 戦闘開始時点のADV表示キャラと同じ
      const chars = state.view?.characters || {};
      const self = chars.self || {};
      const enemy = chars.enemy || {};

      const selfImgB = $(DOM_IDS.battle.charSelfImg);
      const enemyImgB = $(DOM_IDS.battle.charEnemyImg);

      safeSrcSet(selfImgB, resolveCharSrc(self.file || self.name));
      safeSrcSet(enemyImgB, resolveCharSrc(enemy.file || enemy.name));

      setHidden(selfImgB, !self.visible);
      setHidden(enemyImgB, !enemy.visible);

      // HP bars
      const hpSelf = Number.isFinite(state.battle?.hpSelf) ? state.battle.hpSelf : 100;
      const hpSelfMax = Number.isFinite(state.battle?.hpSelfMax) ? state.battle.hpSelfMax : 100;
      const hpEnemy = Number.isFinite(state.battle?.hpEnemy) ? state.battle.hpEnemy : 100;
      const hpEnemyMax = Number.isFinite(state.battle?.hpEnemyMax) ? state.battle.hpEnemyMax : 100;

      const clamp01 = (v) => Math.max(0, Math.min(1, v));
      const setHp = (fillEl, textEl, v, max) => {
        if (fillEl) fillEl.style.width = `${clamp01(max > 0 ? v / max : 0) * 100}%`;
        if (textEl) textEl.textContent = `${Math.max(0, Math.floor(v))} / ${Math.max(1, Math.floor(max))}`;
      };

      setHp($(DOM_IDS.battle.hpSelfFill), $(DOM_IDS.battle.hpSelfText), hpSelf, hpSelfMax);
      setHp($(DOM_IDS.battle.hpEnemyFill), $(DOM_IDS.battle.hpEnemyText), hpEnemy, hpEnemyMax);

      // result overlay
      const br = $(LAYERS.battleResult);
      const r = state.battle?.result || {};
      setHidden(br, !r.visible);
      if (r.visible) {
        setText($(DOM_IDS.battle.resultTitle), String(r.outcome ?? "RESULT"));
        setText($(DOM_IDS.battle.resultDetail), String(r.detail ?? ""));
      }
    }

    // debug (optional)
    const dbg = $(LAYERS.debug);
    if (dbg && !dbg.classList.contains("is-hidden")) {
      const scene = document.getElementById("dbgScene");
      const step = document.getElementById("dbgStep");
      if (scene) scene.textContent = state.pointer?.sceneId ?? "-";
      if (step) step.textContent = String(state.pointer?.step ?? 0);
    }
  }

  // ---------------------------------------------------------
  // Event system (engine.js が後で拾える)
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
  // DOM wiring (minimal)
  // ---------------------------------------------------------
  function wireDom() {
    // Title
    const btnNew = $(DOM_IDS.title.newGame);
    const btnCredits = $(DOM_IDS.title.credits);
    const btnSettings = $(DOM_IDS.title.settings);

    if (btnNew) {
      btnNew.addEventListener("click", () => {
        emit("newGame", {});
        // no engine yet -> run built-in flow
        if (!RP.Engine || typeof RP.Engine.startNewGame !== "function") {
          startNewGameFlow();
        }
      });
    }

    if (btnCredits) {
      btnCredits.addEventListener("click", () => {
        showModal({
          title: "クレジット",
          message: "（ここにクレジットを後で記載）",
          okText: "OK",
          cancelText: "閉じる",
        });
      });
    }

    if (btnSettings) {
      btnSettings.addEventListener("click", () => openMenu());
    }

    // Menu buttons
    const btnCloseMenu = $(DOM_IDS.menu.close);
    const btnBackToTitle = $(DOM_IDS.menu.backToTitle);

    if (btnCloseMenu) btnCloseMenu.addEventListener("click", () => closeMenu());

    if (btnBackToTitle) {
      btnBackToTitle.addEventListener("click", () => {
        showModal({
          title: "確認",
          message: "タイトルへ戻りますか？",
          okText: "戻る",
          cancelText: "キャンセル",
          onOk: () => {
            closeMenu();
            const s = RP.State.deepClone(_state);
            s.screen = SCREENS.TITLE;
            // 章選択などは維持してもいいが、ここではリセットしない
            normalizeAndSetState(s);
            emit("backToTitle", {});
          },
        });
      });
    }

    // Settings sliders -> state
    const bgm = $(DOM_IDS.menu.optBgmVol);
    const se = $(DOM_IDS.menu.optSeVol);
    const ts = $(DOM_IDS.menu.optTextSpeed);

    const onSettingsChange = () => {
      const s = RP.State.deepClone(_state);
      if (bgm) s.settings.bgmVolume = Number(bgm.value) / 100;
      if (se) s.settings.seVolume = Number(se.value) / 100;
      if (ts) s.settings.textSpeed = Number(ts.value) / 100;
      normalizeAndSetState(s);

      // persist settings (optional)
      if (RP.Save && typeof RP.Save.saveSettings === "function") {
        try { RP.Save.saveSettings(s.settings); } catch (e) { /* ignore */ }
      }
      emit("settingsChanged", { settings: s.settings });
    };

    if (bgm) bgm.addEventListener("input", onSettingsChange);
    if (se) se.addEventListener("input", onSettingsChange);
    if (ts) ts.addEventListener("input", onSettingsChange);

    // Battle continue
    const btnBattleContinue = $(DOM_IDS.battle.resultContinue);
    if (btnBattleContinue) {
      btnBattleContinue.addEventListener("click", () => emit("battleContinue", {}));
    }

    // ESC -> menu (minimal input; input.jsが来たら置き換え可能)
    window.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        if (_overlay.modalOpen) {
          closeModal();
          return;
        }
        if (_overlay.menuOpen) closeMenu();
        else openMenu();
      }
    });

    // Save wiring (optional)
    if (RP.Save && typeof RP.Save.wireDom === "function") {
      RP.Save.wireDom({
        getState: () => _state,
        setState: (s) => {
          // ロード直後にメニューが開いたままだと邪魔なので閉じる
          closeMenu();
          closeModal();
          normalizeAndSetState(s);
          emit("stateLoaded", {});
        },
        onError: (msg) => showError(msg),
        onInfo: (msg) => console.log(msg),
      });
    }
  }

  // ---------------------------------------------------------
  // Public API
  // ---------------------------------------------------------
  function init() {
    // load settings if exist
    if (RP.Save && typeof RP.Save.loadSettings === "function") {
      try {
        const loaded = RP.Save.loadSettings();
        if (loaded) {
          const s = RP.State.deepClone(_state);
          s.settings = { ...s.settings, ...loaded };
          _state = RP.State.normalizeState(s);
        }
      } catch (e) { /* ignore */ }
    }

    wireDom();
    render(_state);
  }

  RP.UI = Object.freeze({
    init,

    // state access
    getState: () => _state,
    setState: (s) => normalizeAndSetState(s),

    // overlays
    openMenu,
    closeMenu,
    showModal,
    closeModal,
    showError,

    // render
    render: (s) => render(RP.State.normalizeState(s)),

    // events
    on,
    emit,
  });

  // auto-init
  document.addEventListener("DOMContentLoaded", () => {
    try { init(); } catch (e) { console.error(e); }
  });
})();
