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

  // ---------------------------------------------------------
  // Choice (chapter/branch) list scrolling
  // - Chapters/choices can grow; keep the panel usable by allowing scroll.
  // - Implemented with a small CSS injection so it works even if the base CSS
  //   is older or missing these rules.
  // ---------------------------------------------------------
  let _choiceScrollStyleInjected = false;

  function injectChoiceScrollStylesOnce() {
    if (_choiceScrollStyleInjected) return;
    _choiceScrollStyleInjected = true;

    const css = `
/* choice list scroll */
#${LAYERS.choice}{
  /* keep centered panel usable even with many options */
  max-height: calc(100vh - 72px);
}
#${LAYERS.choice} *{min-height:0;}
#${DOM_IDS.adv.choiceList}{
  /* allow scrolling when options overflow */
  max-height: min(560px, calc(100vh - 240px));
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding-right: 6px;
  touch-action: pan-y;
}
#${DOM_IDS.adv.choiceList}::-webkit-scrollbar{width:10px;}
#${DOM_IDS.adv.choiceList}::-webkit-scrollbar-track{background:rgba(255,255,255,.04);border-radius:999px;}
#${DOM_IDS.adv.choiceList}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.18);border-radius:999px;border:2px solid rgba(0,0,0,.20);}
`;

    const style = document.createElement("style");
    style.id = "choiceScrollStyle";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function ensureChoiceScrollable(choiceLayer, choiceList) {
    // CSS injection first
    injectChoiceScrollStylesOnce();
    // Inline fallback (if some CSS resets override ids)
    if (choiceList) {
      if (!choiceList.style.overflowY) choiceList.style.overflowY = "auto";
      if (!choiceList.style.maxHeight) choiceList.style.maxHeight = "min(560px, calc(100vh - 240px))";
      if (!choiceList.style.overscrollBehavior) choiceList.style.overscrollBehavior = "contain";
      if (!choiceList.style.webkitOverflowScrolling) choiceList.style.webkitOverflowScrolling = "touch";
      if (!choiceList.style.touchAction) choiceList.style.touchAction = "pan-y";
    }
    if (choiceLayer) {
      if (!choiceLayer.style.maxHeight) choiceLayer.style.maxHeight = "calc(100vh - 72px)";
    }
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

  // ▼ ここから貼り付け（復旧） ▼

  // キャラ名が「コト（初戦）」のように補足を含む場合でも
  // 実ファイル（例：コト.png）へ正しく解決するための正規化。
  function canonicalizeCharLabel(raw) {
    let s = String(raw || "").trim();
    if (!s) return "";
    // 括弧の補足を落とす（全角/半角）
    s = s.replace(/[（(【\[].*?[）)】\]]/g, "");
    // 表情などの区切り（"アカウ_怒" → "アカウ"）※拡張子付きは別分岐で処理
    if (s.includes("_")) s = s.split("_")[0];
    return s.trim();
  }

  function resolveCharSrc(fileOrName) {
    if (!fileOrName) return null;

    const raw = String(fileOrName).trim();
    if (!raw) return null;

    // "アカウ.png" のように明示ファイル指定ならそのまま
    if (endsWithImageExt(raw)) return ASSET.path(ASSET_DIR.char, raw);

    // "コト（初戦）" → "コト"
    const base = canonicalizeCharLabel(raw);
    if (!base) return null;
    return ASSET.charPng(base);
  }
  // ▲ ここまで貼り付け ▲

  // ---------------------------------------------------------
  // Duo character (アカウ＆タネイ) composite
  // ---------------------------------------------------------
  const _duoCompositeCache = new Map();
  const DUO_KEY_AKAU_TANEI = "duo:akau_tanei";

  function isAkauTaneiDuo(charObj) {
    const name = String((charObj && charObj.name) ? charObj.name : "");
    const file = String((charObj && charObj.file) ? charObj.file : "");
    const s = name + "|" + file;
    return s.includes("アカウ") && s.includes("タネイ");
  }

  function composeVerticalDuo(srcTop, srcBottom) {
    return new Promise((resolve, reject) => {
      const a = new Image();
      const b = new Image();

      let loaded = 0;
      const onLoad = () => {
        loaded += 1;
        if (loaded < 2) return;
        try {
          const w = Math.max(a.naturalWidth || a.width || 0, b.naturalWidth || b.width || 0);
          const h = (a.naturalHeight || a.height || 0) + (b.naturalHeight || b.height || 0);
          if (!w || !h) {
            resolve(null);
            return;
          }
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          const ctx = c.getContext("2d");
          if (!ctx) {
            resolve(null);
            return;
          }
          const ax = Math.floor((w - (a.naturalWidth || a.width || 0)) / 2);
          const bx = Math.floor((w - (b.naturalWidth || b.width || 0)) / 2);
          ctx.drawImage(a, ax, 0);
          ctx.drawImage(b, bx, (a.naturalHeight || a.height || 0));
          resolve(c.toDataURL("image/png"));
        } catch (e) {
          reject(e);
        }
      };
      const onErr = () => resolve(null);

      a.onload = onLoad;
      b.onload = onLoad;
      a.onerror = onErr;
      b.onerror = onErr;

      a.src = srcTop;
      b.src = srcBottom;
    });
  }

  function applyAkauTaneiDuo(imgEl) {
    if (!imgEl) return;

    imgEl.dataset.duoKey = DUO_KEY_AKAU_TANEI;

    const cached = _duoCompositeCache.get(DUO_KEY_AKAU_TANEI);
    if (cached && cached.src) {
      imgEl.src = cached.src;
      return;
    }

    // placeholder while composing
    imgEl.src = resolveCharSrc("アカウ");

    if (cached && cached.promise) {
      cached.promise.then((src) => {
        if (!src) return;
        if (imgEl.isConnected && imgEl.dataset.duoKey === DUO_KEY_AKAU_TANEI) imgEl.src = src;
      }).catch(() => {});
      return;
    }

    const entry = { src: null, promise: null };
    const top = resolveCharSrc("アカウ");
    const bottom = resolveCharSrc("タネイ");
    entry.promise = composeVerticalDuo(top, bottom).then((src) => {
      entry.src = src;
      return src;
    });
    _duoCompositeCache.set(DUO_KEY_AKAU_TANEI, entry);

    entry.promise.then((src) => {
      if (!src) return;
      if (imgEl.isConnected && imgEl.dataset.duoKey === DUO_KEY_AKAU_TANEI) imgEl.src = src;
    }).catch(() => {});
  }

  function applyCharImage(imgEl, charObj) {
    if (!imgEl) return;
    if (isAkauTaneiDuo(charObj)) {
      applyAkauTaneiDuo(imgEl);
      return;
    }
    delete imgEl.dataset.duoKey;
    safeSrcSet(imgEl, resolveCharSrc((charObj && (charObj.file || charObj.name)) || null));
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
  // Arena mode UI (キャラセレクト)
  // ---------------------------------------------------------
  const ARENA_CFG = Object.freeze({
    gridCols: 6,
    gridRows: 3, // 18 slots（将来拡張用の空き枠を残す）
  });

  const ARENA_PLAYABLES = Object.freeze([
    { id: "apara", name: "アパラ" },
    { id: "sai", name: "サイ" },
    { id: "akau", name: "アカウ" },
    { id: "karei", name: "カレイ" },
    { id: "tanei", name: "タネイ" },
    { id: "akau_tanei", name: "アカウ＆タネイ" },
  ]);

  const ARENA_ENEMIES = Object.freeze([
    { id: "nia_kinabei", name: "ニア・キナベイ" },
    { id: "enemy_apara", name: "アパラ" },
    { id: "koto_1", name: "コト（初戦）" },
    { id: "enemy_sai", name: "サイ" },
    { id: "koto_2", name: "コト（二戦目）" },
    { id: "satella_1", name: "サテラ（初戦）" },
    { id: "akanei", name: "アカネイ" },
    { id: "satella_2", name: "サテラ（二戦目）" },
    { id: "satella_yume", name: "サテラ（夢の実現）" },
  ]);

  const ARENA_SKILL_TEXT = Object.freeze({
    mushin: { name: "無心の構え", desc: "次に落ちてくるブロックが見える（常時）" },
    kyoubou: { name: "狂暴の構え", desc: "ゲージ3/3で発動：最下段を削除し、色の種類に応じて敵にダメージ" },
    chuuyou: { name: "中庸の構え・改", desc: "無心の構え + 狂暴の構え（両方）" },
    shin_chuuyou: { name: "真・中庸の構え", desc: "無心の構え + 狂暴の構え（両方）" },
    muku: { name: "無垢の構え", desc: "ゲージ3/3で発動：ボムブロックを落として着地と同時に爆発。破壊数に応じて敵にダメージ（条件無視）" },
    none: { name: "", desc: "" },
  });

  function arenaSkillForPlayer(name) {
    const n = String(name || "").trim();
    if (!n) return ARENA_SKILL_TEXT.none;
    if (n.includes("アカウ") && n.includes("タネイ")) return ARENA_SKILL_TEXT.shin_chuuyou;
    if (n.includes("カレイ")) return ARENA_SKILL_TEXT.muku;
    if (n.includes("サイ")) return ARENA_SKILL_TEXT.chuuyou;
    if (n.includes("アカウ")) return ARENA_SKILL_TEXT.kyoubou;
    if (n.includes("アパラ") || n.includes("タネイ")) return ARENA_SKILL_TEXT.mushin;
    return ARENA_SKILL_TEXT.none;
  }

  const ARENA_ENEMY_HINT = Object.freeze({
    "ニア・キナベイ": "（敵ギミックあり）",
    "アパラ": "（敵ギミックあり）",
    "コト（初戦）": "（条件あり）",
    "サイ": "（敵ギミックあり）",
    "コト（二戦目）": "（条件あり）",
    "サテラ（初戦）": "（条件あり）",
    "アカネイ": "（条件あり）",
    "サテラ（二戦目）": "（条件あり）",
    "サテラ（夢の実現）": "（高難度）",
  });

  let _arenaBuilt = false;
  let _arenaStyleInjected = false;

  function injectArenaStylesOnce() {
    if (_arenaStyleInjected) return;
    _arenaStyleInjected = true;

    const css = `
/* arena */
#${LAYERS.arena}{position:absolute;inset:0;z-index:50;display:flex;align-items:stretch;justify-content:center;overflow:hidden;pointer-events:auto;}
#${LAYERS.arena}.is-hidden{display:none !important;}
#${LAYERS.arena} .arena-bg{position:absolute;inset:-40px;background:radial-gradient(1200px 600px at 20% 30%, rgba(120,180,255,.25), transparent 60%),radial-gradient(900px 500px at 80% 60%, rgba(255,120,190,.18), transparent 60%),linear-gradient(180deg, rgba(10,12,18,1), rgba(18,20,30,1));}
#${LAYERS.arena} .arena-bg:after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(0deg, rgba(255,255,255,.04), rgba(255,255,255,.04) 1px, transparent 1px, transparent 4px);mix-blend-mode:overlay;opacity:.35;pointer-events:none;}
#${LAYERS.arena} .arena-wrap{position:relative;flex:1;display:flex;flex-direction:column;padding:24px 28px;gap:18px;}
#${LAYERS.arena} .arena-ui{position:relative;z-index:2;display:flex;flex-direction:column;gap:14px;height:100%;}
#${LAYERS.arena} .arena-top{display:flex;align-items:center;justify-content:space-between;gap:12px;}
#${LAYERS.arena} .arena-title{font-size:26px;letter-spacing:.12em;font-weight:900;opacity:.95;}
#${LAYERS.arena} .arena-actions{display:flex;gap:10px;}
#${LAYERS.arena} .arena-btn{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:inherit;border-radius:14px;padding:10px 14px;font-weight:800;cursor:pointer;transition:transform .12s ease, background .12s ease, border-color .12s ease;}
#${LAYERS.arena} .arena-btn:hover{transform:translateY(-1px);background:rgba(255,255,255,.09);border-color:rgba(255,255,255,.28);}
#${LAYERS.arena} .arena-main{display:grid;grid-template-columns:1fr 240px 1fr;gap:18px;flex:1;min-height:0;}
#${LAYERS.arena} .arena-side{display:flex;flex-direction:column;gap:12px;min-width:0;min-height:0;}
#${LAYERS.arena} .arena-panel{border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.20);border-radius:20px;box-shadow:0 12px 40px rgba(0,0,0,.35);overflow:hidden;}
#${LAYERS.arena} .arena-preview{display:grid;grid-template-columns:140px 1fr;gap:12px;padding:12px;align-items:center;}
#${LAYERS.arena} .arena-portrait{width:140px;height:180px;border-radius:16px;object-fit:contain;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);}
#${LAYERS.arena} .arena-portrait.is-mirrored{transform:scaleX(-1);}
#${LAYERS.arena} .arena-meta{display:flex;flex-direction:column;gap:6px;min-width:0;}
#${LAYERS.arena} .arena-name{font-size:18px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
#${LAYERS.arena} .arena-sub{font-size:12px;opacity:.85;line-height:1.35;}
#${LAYERS.arena} .arena-skill-name{font-weight:900;}
#${LAYERS.arena} .arena-grid{display:grid;grid-template-columns:repeat(${ARENA_CFG.gridCols}, 1fr);gap:10px;padding:12px;overflow:auto;min-height:0;}
#${LAYERS.arena} .arena-slot{position:relative;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);border-radius:16px;cursor:pointer;padding:8px;display:flex;flex-direction:column;gap:6px;transition:transform .12s ease, border-color .12s ease, background .12s ease;}
#${LAYERS.arena} .arena-slot:hover{transform:translateY(-1px);border-color:rgba(255,255,255,.28);background:rgba(255,255,255,.06);}
#${LAYERS.arena} .arena-slot.is-selected{border-color:rgba(120,200,255,.9);box-shadow:0 0 0 2px rgba(120,200,255,.25), 0 16px 36px rgba(0,0,0,.35);}
#${LAYERS.arena} .arena-slot:disabled{opacity:.35;cursor:not-allowed;}
#${LAYERS.arena} .arena-slot img{width:100%;height:66px;object-fit:contain;border-radius:12px;background:rgba(0,0,0,.15);}
#${LAYERS.arena} .arena-slot .label{font-size:11px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.92;}
#${LAYERS.arena} .arena-center{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;}
#${LAYERS.arena} .arena-vs{font-size:54px;font-weight:900;letter-spacing:.06em;opacity:.95;text-shadow:0 12px 40px rgba(0,0,0,.45);}
#${LAYERS.arena} .arena-fight{width:100%;font-size:18px;font-weight:900;letter-spacing:.08em;padding:12px 14px;border-radius:18px;border:1px solid rgba(255,255,255,.18);background:linear-gradient(135deg, rgba(255,90,90,.85), rgba(255,190,90,.70));color:rgba(10,10,14,1);cursor:pointer;transition:transform .12s ease, filter .12s ease;}
#${LAYERS.arena} .arena-fight:disabled{opacity:.4;cursor:not-allowed;filter:saturate(.3);}
#${LAYERS.arena} .arena-fight:not(:disabled):hover{transform:translateY(-1px);filter:brightness(1.05);}
#${LAYERS.arena} .arena-note{font-size:12px;opacity:.75;text-align:center;line-height:1.4;}
`;

    const style = document.createElement('style');
    style.id = 'arenaStyle';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function ensureTitleArenaButton() {
    let btn = document.getElementById(DOM_IDS.title.arena);
    if (btn) return btn;

    const ref = document.getElementById(DOM_IDS.title.newGame) || document.getElementById(DOM_IDS.title.continueJson) || document.getElementById(DOM_IDS.title.settings);
    if (!ref || !ref.parentElement) return null;

    btn = document.createElement('button');
    btn.id = DOM_IDS.title.arena;
    btn.type = 'button';
    btn.textContent = 'ARENA';

    // 既存ボタンと同じクラスで揃える（レイアウト/見た目/クリック領域を合わせる）
    btn.className = ref.className || '';
    if (!btn.className) btn.className = 'title-btn';

    ref.insertAdjacentElement('afterend', btn);
    return btn;
  }

  function ensureArenaDom() {
    if (_arenaBuilt) return;
    injectArenaStylesOnce();

    const root = document.getElementById(DOM_IDS.root.gameRoot) || document.getElementById(DOM_IDS.root.app) || document.body;
    if (!root) return;

    let layer = document.getElementById(LAYERS.arena);
    if (!layer) {
      layer = document.createElement('div');
      layer.id = LAYERS.arena;
      layer.className = 'is-hidden';
      layer.setAttribute('aria-hidden', 'true');

      layer.innerHTML = `
        <div class="arena-bg"></div>
        <div class="arena-wrap">
          <div class="arena-ui">
            <div class="arena-top">
              <div class="arena-title">ARENA</div>
              <div class="arena-actions">
                <button class="arena-btn" type="button" id="${DOM_IDS.arena.back}">タイトルへ</button>
              </div>
            </div>

            <div class="arena-main">
              <div class="arena-side">
                <div class="arena-panel">
                  <div class="arena-preview">
                    <img class="arena-portrait is-mirrored" id="${DOM_IDS.arena.enemyPreviewImg}" alt="enemy" />
                    <div class="arena-meta">
                      <div class="arena-name" id="${DOM_IDS.arena.enemyName}"></div>
                      <div class="arena-sub" id="${DOM_IDS.arena.enemyHint}"></div>
                    </div>
                  </div>
                </div>
                <div class="arena-panel" id="${DOM_IDS.arena.enemyGrid}"></div>
              </div>

              <div class="arena-center">
                <div class="arena-vs">VS</div>
                <button class="arena-fight" type="button" id="${DOM_IDS.arena.start}" disabled>FIGHT</button>
                <div class="arena-note">左で敵、右で自キャラを選択 → FIGHT</div>
              </div>

              <div class="arena-side">
                <div class="arena-panel">
                  <div class="arena-preview">
                    <img class="arena-portrait" id="${DOM_IDS.arena.playerPreviewImg}" alt="player" />
                    <div class="arena-meta">
                      <div class="arena-name" id="${DOM_IDS.arena.playerName}"></div>
                      <div class="arena-sub"><span class="arena-skill-name" id="${DOM_IDS.arena.playerSkillName}"></span></div>
                      <div class="arena-sub" id="${DOM_IDS.arena.playerSkillDesc}"></div>
                    </div>
                  </div>
                </div>
                <div class="arena-panel" id="${DOM_IDS.arena.playerGrid}"></div>
              </div>
            </div>
          </div>
        </div>
      `;
      root.appendChild(layer);
    }

    const buildGrid = (panelEl, list, side) => {
      if (!panelEl) return;
      panelEl.innerHTML = '';

      const grid = document.createElement('div');
      grid.className = 'arena-grid';
      panelEl.appendChild(grid);

      const total = ARENA_CFG.gridCols * ARENA_CFG.gridRows;
      for (let i = 0; i < total; i++) {
        const entry = list[i];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'arena-slot';
        btn.dataset.side = side;
        btn.dataset.index = String(i);

        if (!entry) {
          btn.disabled = true;
          btn.classList.add('is-empty');
          btn.innerHTML = '<div class="label">COMING</div>';
          grid.appendChild(btn);
          continue;
        }

        btn.dataset.name = entry.name;
        btn.innerHTML = `<img alt="${entry.name}"><div class="label">${entry.name}</div>`;
        const img = btn.querySelector('img');
        applyCharImage(img, { visible: true, name: entry.name, file: null });
        if (side === 'enemy') img.classList.add('is-mirrored');

        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const st = RP.State.deepClone(_state);
          st.arena = st.arena || { self: { name: '', file: null }, enemy: { name: '', file: null } };
          if (side === 'self') st.arena.self = { name: entry.name, file: null };
          else st.arena.enemy = { name: entry.name, file: null };
          normalizeAndSetState(st);
        });

        grid.appendChild(btn);
      }
    };

    buildGrid(document.getElementById(DOM_IDS.arena.playerGrid), ARENA_PLAYABLES, 'self');
    buildGrid(document.getElementById(DOM_IDS.arena.enemyGrid), ARENA_ENEMIES, 'enemy');

    const btnBack = document.getElementById(DOM_IDS.arena.back);
    if (btnBack && !btnBack.dataset.wired) {
      btnBack.dataset.wired = '1';
      btnBack.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        emit('arenaBackToTitle', {});
      });
    }

    const btnFight = document.getElementById(DOM_IDS.arena.start);
    if (btnFight && !btnFight.dataset.wired) {
      btnFight.dataset.wired = '1';
      btnFight.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const selfName = _state?.arena?.self?.name || '';
        const enemyName = _state?.arena?.enemy?.name || '';
        if (!selfName || !enemyName) return;
        emit('arenaStart', { selfName, enemyName });
      });
    }

    _arenaBuilt = true;
  }

  function renderArena(state) {
    ensureArenaDom();

    const selfName = state?.arena?.self?.name || '';
    const enemyName = state?.arena?.enemy?.name || '';

    const pImg = document.getElementById(DOM_IDS.arena.playerPreviewImg);
    const eImg = document.getElementById(DOM_IDS.arena.enemyPreviewImg);

    applyCharImage(pImg, { visible: true, name: selfName, file: state?.arena?.self?.file || null });
    applyCharImage(eImg, { visible: true, name: enemyName, file: state?.arena?.enemy?.file || null });

    setText(document.getElementById(DOM_IDS.arena.playerName), selfName || '（自キャラを選択）');
    setText(document.getElementById(DOM_IDS.arena.enemyName), enemyName || '（敵を選択）');

    const sk = arenaSkillForPlayer(selfName);
    setText(document.getElementById(DOM_IDS.arena.playerSkillName), sk.name);
    setText(document.getElementById(DOM_IDS.arena.playerSkillDesc), sk.desc);

    setText(document.getElementById(DOM_IDS.arena.enemyHint), ARENA_ENEMY_HINT[enemyName] || '');

    const btnFight = document.getElementById(DOM_IDS.arena.start);
    if (btnFight) btnFight.disabled = !(!!selfName && !!enemyName);

    const setSelected = (panelId, name) => {
      const panel = document.getElementById(panelId);
      if (!panel) return;
      const slots = panel.querySelectorAll('.arena-slot');
      slots.forEach((b) => {
        const on = b?.dataset?.name && b.dataset.name === name;
        b.classList.toggle('is-selected', !!on);
      });
    };

    setSelected(DOM_IDS.arena.playerGrid, selfName);
    setSelected(DOM_IDS.arena.enemyGrid, enemyName);
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
    const arenaLayer = $(LAYERS.arena);
    const menuLayer = $(LAYERS.menu);
    const modalLayer = $(LAYERS.modal);
    const overlayLayer = $(LAYERS.overlay);

    // show/hide base by state.screen
    const isTitle = state.screen === SCREENS.TITLE;
    const isAdv = state.screen === SCREENS.ADV;
    const isBattle = state.screen === SCREENS.BATTLE;
    const isArena = state.screen === SCREENS.ARENA;

    setHidden(titleLayer, !isTitle);
    setHidden(advLayer, !isAdv);
    setHidden(battleLayer, !isBattle);
    setHidden(arenaLayer, !isArena);

    // overlay layers (always exist but hidden)
    if (overlayLayer) setHidden(overlayLayer, false); // overlay container stays (fade opacity is controlled elsewhere)
    setHidden(menuLayer, !_overlay.menuOpen);
    setHidden(modalLayer, !_overlay.modalOpen);

    // -------------------------
    // Arena render
    // -------------------------
    if (isArena) {
      renderArena(state);
    }

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

      applyCharImage(selfImg, self);
      applyCharImage(enemyImg, enemy);

      // hide character image if not visible
      // (we hide by toggling the img itself to keep layout stable)
      setHidden(selfImg, !self.visible || !(self.file || self.name));
      setHidden(enemyImg, !enemy.visible || !(enemy.file || enemy.name));

// VN fixed dialogue window (single)
const vnUI = document.getElementById("vnUI");
const vnWindow = document.getElementById("vnWindow");
const vnNameplate = document.getElementById("vnNameplate");
const vnName = document.getElementById("vnName");
const vnText = document.getElementById("vnText");
const vnNext = document.getElementById("vnNext");

// 旧吹き出しは使わない（残ってても常に隠す）
const bubbleSelf = $(DOM_IDS.adv.bubbleSelf);
const bubbleEnemy = $(DOM_IDS.adv.bubbleEnemy);
setHidden(bubbleSelf, true);
setHidden(bubbleEnemy, true);

// speech 判定（← これを先に作る！）
const speech = state.view?.speech || {};
const showSpeech = !!speech.visible && !!speech.text;

// 「‣」は “進める状態” のときだけ表示（選択肢中は消す）
const choiceVisible = !!state.view?.choice?.visible;
setHidden(vnNext, !(showSpeech && !choiceVisible));

if (!showSpeech) {
  setHidden(vnUI, true);
  vnWindow?.classList.remove("is-narration");
} else {
  setHidden(vnUI, false);

  const fallbackName =
    (speech.side === "enemy") ? (enemy.name || "？？？") : (self.name || "？？？");

  const name =
    (speech.name && String(speech.name).trim()) ? String(speech.name).trim() : fallbackName;

  const isNarration = (name === "ナレーション");

  // ナレーションは視覚的に区別（CSS側で is-narration を使う）
  vnWindow?.classList.toggle("is-narration", isNarration);

  // ナレーションは名前プレートを出さない
  setHidden(vnNameplate, isNarration || !name);
  setText(vnName, isNarration ? "" : name);

  setText(vnText, speech.text || "");
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
          // Many chapters/choices -> enable scrolling inside the list.
          ensureChoiceScrollable(choiceLayer, choiceList);
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

      applyCharImage(selfImgB, self);
      applyCharImage(enemyImgB, enemy);

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


    // Arena (title button)
    ensureArenaDom();
    const btnArena = ensureTitleArenaButton();
    if (btnArena && !btnArena.dataset.wired) {
      btnArena.dataset.wired = '1';
      btnArena.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        emit('arenaOpen', {});
        // engineが無い場合のフォールバック
        if (!RP.Engine || typeof RP.Engine.openArena !== 'function') {
          const st = RP.State.deepClone(_state);
          st.screen = SCREENS.ARENA;
          normalizeAndSetState(st);
        }
      });
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
