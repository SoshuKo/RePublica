/* =========================================================
   battle.js
   - ぷよぷよ風（2個組落下 / 4つ以上で消える / 連鎖）
   - 単一盤面（対戦盤面は無し）
   - 1回消す（連鎖の各段）ごとに定量ダメージ + 連鎖ボーナス
   - ui.js の battle HUD (score/chain/time) を流用：
       score   = 総ダメージ
       chain   = 直近の連鎖数（発生時に更新）
       time    = 敵HP（ラベルはHTML依存だけど値は出る）
   - 音は未対応
   ========================================================= */

(() => {
  "use strict";

  const RP = (window.RP = window.RP || {});
  if (!RP.CONST) throw new Error("RP.CONST not found. Load constants.js first.");
  if (!RP.State) throw new Error("RP.State not found. Load state.js first.");
  if (!RP.UI) throw new Error("RP.UI not found. Load ui.js first.");

  const { DOM, LAYERS, SCREENS, DEFAULTS } = RP.CONST;

  // ---------------------------
  // Config (調整用)
  // ---------------------------
  const CFG = Object.freeze({
    COLS: 6,
    VISIBLE_ROWS: 12,
    HIDDEN_ROWS: 2, // 生成・落下のための隠し段

    COLORS: 4, // 色数（4で十分）

    // 落下速度
    GRAVITY_MS: 700,
    SOFT_DROP_MS: 50,
    LOCK_DELAY_MS: 0,

    // ダメージ：1回の「消し」（=連鎖段）ごとの定量
    SELF_HP: 100,
    ENEMY_HP: 100,
    DAMAGE_PER_CLEAR: 10,
    CHAIN_BONUS_PER_STEP: 5,     // 2連鎖なら +5、3連鎖なら +10 ...
    GROUP_BONUS_PER_EXTRA: 2,    // 同一段で複数グループ消えたら少し加算

    // スコア（見た目用）
    SCORE_PER_PUYO: 10,
    SCORE_CHAIN_MULT: 0.5, // 連鎖で加点

    // 回転の簡易壁キック（左右に1マスだけ試す）
    WALL_KICK: true,

    // タッチ操作判定
    SWIPE_THRESHOLD: 28,

    // ---------------------------
    // Character Skills
    // ---------------------------
    SKILL_GAUGE_MAX: 3,
    // 「狂暴の構え」：消した“色の種類”×この値を敵に与える
    SKILL_RAGE_DAMAGE_PER_COLOR: 10,

    // 「無垢の構え」（カレイ）
    SKILL_MUKU_DAMAGE_PER_BLOCK: 6,
    // 爆弾ブロック（盤面内部表現）
    BOMB_ID: 9,
    BOMB_RADIUS: 1,
  });

  // ---------------------------
  // Skill definitions
  // ---------------------------
  // - 「無心の構え」: 次ブロック表示（常時）
  // - 「狂暴の構え」: ゲージ3/3でボタン解放→最下段を削除し、色の種類に応じてダメージ
  // - 「中庸の構え・改」: 無心 + 狂暴
  const SKILL_DEF = Object.freeze({
    NONE: { key: "none", name: "", desc: "", showNext: false, hasButton: false },
    MUSHIN: { key: "mushin", name: "無心の構え", desc: "次に落ちてくるブロックが見える（常時）", showNext: true, hasButton: false },
    KYOUBOU: { key: "kyoubou", name: "狂暴の構え", desc: "ゲージ3/3で発動：最下段を削除し、色の種類に応じて敵にダメージ", showNext: false, hasButton: true },
    CHUUYOU: { key: "chuuyou", name: "中庸の構え・改", desc: "無心 + 狂暴（両方）", showNext: true, hasButton: true },

    // プレイアブル追加
    SHIN_CHUUYOU: { key: "shin_chuuyou", name: "真・中庸の構え", desc: "無心の構え + 狂暴の構え（両方）", showNext: true, hasButton: true },
    MUKU: { key: "muku", name: "無垢の構え", desc: "ゲージ3/3で発動：ボムブロックを落として着地と同時に爆発。破壊数に応じて敵にダメージ（条件無視）", showNext: false, hasButton: true },
  });

  function normalizeCharName(name) {
  return String(name || "").trim();
}

// キャラ名の揺れに強くする（例："アカウ_怒.png" / "アカウ（怒）" など）
function canonicalizeCharName(raw) {
  let s = normalizeCharName(raw);
  if (!s) return "";
  // 拡張子除去
  s = s.replace(/\.(png|webp|jpg|jpeg)$/i, "");
  // 表情や補足の区切りを落とす（"アカウ_怒" → "アカウ"）
  if (s.includes("_")) s = s.split("_")[0];
  // 括弧系の補足を落とす（"コト（二戦目）" → "コト"）
  s = s.replace(/[（(【\[].*?[）)】\]]/g, "");
  return s.trim();
}

function getPlayerNameFromBattleDom() {
  try {
    const id = (RP?.CONST?.DOM?.battle?.charSelfImg) ? RP.CONST.DOM.battle.charSelfImg : 'battleCharSelfImg';
    const img = document.getElementById(id);
    const src = img && img.getAttribute('src');
    if (!src) return '';
    const file = decodeURIComponent(String(src).split('/').pop() || '');
    return canonicalizeCharName(file);
  } catch (_) {
    return '';
  }
}

function getPlayerNameFromState() {
  const s = getState();

  // runtime cache (battle中にviewが消えるケース対策)
  const gName = canonicalizeCharName(game?.playerName);
  if (gName) return gName;

  // ADVの自キャラ名（新しいPARTを遊ぶときはまずこれが正）
  const vName = canonicalizeCharName(s?.view?.characters?.self?.name);
  if (vName) return vName;

  // 立ち絵ファイル名から推測（"アカウ_怒.png" など）
  const fName = canonicalizeCharName(s?.view?.characters?.self?.file);
  if (fName) return fName;

  // battle側に保存してある場合：battle画面中はこれを優先してよい
  const bName = canonicalizeCharName(s?.battle?.playerName);
  if (inBattleScreen() && bName) return bName;

  // Battle screen DOM image src fallback (stateが薄い場合の最終保険)
  const dName = getPlayerNameFromBattleDom();
  if (dName) return dName;

  // battle playerName fallback（battle外で古い値が残ることがあるので最後に回す）
  if (bName) return bName;

  // 最後の手段：発話者名（System等は弾く）
  const sp = canonicalizeCharName(s?.view?.speech?.name);
  if (sp && sp !== "System") return sp;

  return "";
}

function getPlayerSkillDef() {
  const n = getPlayerNameFromState();

  // 完全一致より “含む” を優先（揺れ対策）
  // Duo（アカウ＆タネイ）を最優先（"アカウ" に引っかかる前に拾う）
  if (n.includes("アカウ") && n.includes("タネイ")) return SKILL_DEF.SHIN_CHUUYOU;

  if (n.includes("カレイ")) return SKILL_DEF.MUKU;
  if (n.includes("アパラ") || n.includes("タネイ")) return SKILL_DEF.MUSHIN;
  if (n.includes("アカウ")) return SKILL_DEF.KYOUBOU;
  if (n.includes("サイ")) return SKILL_DEF.CHUUYOU;
  return SKILL_DEF.NONE;
}


  // Persist playerName into state.battle for later UI/Info lookups
  function persistPlayerNameToState(name) {
    const n = canonicalizeCharName(name);
    if (!n) return;
    try {
      const s0 = getState();
      if (!s0) return;
      const s = (typeof structuredClone === "function") ? structuredClone(s0) : JSON.parse(JSON.stringify(s0));
      if (!s.battle) s.battle = {};
      s.battle.playerName = n;
      setState(s);
    } catch (_) { /* ignore */ }
  }

  // Battle entry timing can be tricky: UI画像が差し替わる前に判定が走ることがあるので、少し遅延して再同期
  function scheduleSkillUiRefresh() {
    window.setTimeout(() => { if (inBattleScreen()) updateSkillUi(); }, 0);
    window.setTimeout(() => { if (inBattleScreen()) updateSkillUi(); }, 120);
    window.setTimeout(() => { if (inBattleScreen()) updateSkillUi(); }, 300);
  }

  // Skill UI can desync when the scenario swaps player/enemy without leaving the battle screen.
  // Keep it synced and also force-show the gauge/button when the player has "狂暴" (or "中庸").
  let _skillUiSig = "";
  let _skillUiLastMs = 0;
  function autoSkillUiSync(ts) {
    if (!inBattleScreen()) return;
    const def = getPlayerSkillDef();
    // If player skill is unknown, still show HUD (avoids 'disappearing' when name detection lags)
    if (def.key === "none") {
      def = { ...def, name: "スキル", desc: "（判定中）" };
    }

    const hud = document.getElementById(SKILL_DOM.hud);

    // If it is hidden even though the player has a skill, force refresh.
    if (hud && hud.classList.contains("is-hidden") && def.key !== "none") {
      _skillUiSig = "";
    }

    const name = getPlayerNameFromState();
    const nA = game.next ? game.next.a : "";
    const nB = game.next ? game.next.b : "";
    const sig = String(def.key) + "|" + String(name) + "|" + String(game.skillGauge || 0) + "|" + String(nA) + "," + String(nB);

    const need = (sig !== _skillUiSig) || (typeof ts === "number" && (ts - _skillUiLastMs) > 800);
    if (need) {
      updateSkillUi();
      _skillUiSig = sig;
      _skillUiLastMs = (typeof ts === "number") ? ts : 0;
    }
  }


  // ---------------------------
  // Enemy (EP5) behavior rules
  // ---------------------------
  const ENEMY_TYPE = Object.freeze({
    NONE: "none",
    NIA_KINABEI: "nia_kinabei",
    APARA: "enemy_apara",
    KOTO_1: "koto_1",
    SAI: "enemy_sai",
    KOTO_2: "koto_2",
    KOTO_3: "koto_3",
    SATELLA_1: "satella_1",
    AKANEI: "akanei",
    SATELLA_2: "satella_2",
    SATELLA_YUME: "satella_yume",
  });

  const ENEMY_PROFILE = Object.freeze({
    [ENEMY_TYPE.NONE]: {
      name: "",
      hint: "特になし。通常通り撃破して下さい。",
      mustClearWithinTurns: null,
      penaltyDamage: null,
      healPerTurn: 0,
      timeLimitSec: null,
      chainOnlyDamage: false,
      colorGate: false,
      hpMax: null,
    },
    [ENEMY_TYPE.NIA_KINABEI]: {
      name: "ニア・キナベイ",
      hint: "特になし。通常通り撃破して下さい。",
      mustClearWithinTurns: null,
      penaltyDamage: null,
      healPerTurn: 0,
      timeLimitSec: null,
      chainOnlyDamage: false,
      colorGate: false,
      hpMax: null,
    },
    [ENEMY_TYPE.APARA]: {
      name: "アパラ",
      hint: "5ターン以内にブロックを消し続けないと被弾します。",
      mustClearWithinTurns: 5,
      penaltyDamage: "light_to_heavy",
      healPerTurn: 0,
      timeLimitSec: null,
      chainOnlyDamage: false,
      colorGate: false,
      hpMax: null,
    },
    [ENEMY_TYPE.KOTO_1]: {
      name: "コト（初戦）",
      hint: "5ターン以内にブロックを消し続けないと被弾します。さらに毎ターンHPが回復します。",
      mustClearWithinTurns: 5,
      penaltyDamage: "light_to_heavy",
      healPerTurn: 2,
      timeLimitSec: null,
      chainOnlyDamage: false,
      colorGate: false,
      hpMax: null,
    },
    [ENEMY_TYPE.SAI]: {
      name: "サイ",
      hint: "5ターン以内にブロックを消し続けること。さらに60秒以内に倒さないと敗北です。",
      mustClearWithinTurns: 5,
      penaltyDamage: "light_to_heavy",
      healPerTurn: 0,
      timeLimitSec: 60,
      chainOnlyDamage: false,
      colorGate: false,
      hpMax: null,
    },
    [ENEMY_TYPE.KOTO_2]: {
      name: "コト（二戦目）",
      hint: "5ターン以内にブロックを消し続けないと被弾。さらに“連鎖”でしかダメージが入りません。毎ターンHPも回復します。",
      mustClearWithinTurns: 5,
      penaltyDamage: "light_to_heavy",
      healPerTurn: 2,
      timeLimitSec: null,
      chainOnlyDamage: true,
      colorGate: false,
      hpMax: null,
    },
    [ENEMY_TYPE.KOTO_3]: {
      name: "コト（三戦目）",
      hint: "コト（二戦目）と同じ。5ターン以内にブロックを消し続けないと被弾。さらに“連鎖”でしかダメージが入りません。毎ターンHPも回復します。",
      mustClearWithinTurns: 5,
      penaltyDamage: "light_to_heavy",
      healPerTurn: 2,
      timeLimitSec: null,
      chainOnlyDamage: true,
      colorGate: false,
      hpMax: null,
    },
    [ENEMY_TYPE.SATELLA_1]: {
      name: "サテラ（初戦）",
      hint: "毎ターン“指定色”のブロックを破壊しないと通常攻撃ダメージが入りません（必殺技ダメージは例外）。",
      mustClearWithinTurns: null,
      penaltyDamage: null,
      healPerTurn: 0,
      timeLimitSec: null,
      chainOnlyDamage: false,
      colorGate: true,
      hpMax: null,
    },
    [ENEMY_TYPE.AKANEI]: {
      name: "アカネイ",
      hint: "5ターン以内にブロックを消し続けないと被弾。さらに毎ターンHPが回復します。",
      mustClearWithinTurns: 5,
      penaltyDamage: "light_to_heavy",
      healPerTurn: 2,
      timeLimitSec: null,
      chainOnlyDamage: false,
      colorGate: false,
      hpMax: null,
    },
    [ENEMY_TYPE.SATELLA_2]: {
      name: "サテラ（二戦目）",
      hint: "5ターン以内にブロックを消し続けないと被弾。さらに毎ターン“指定色”を破壊しないと通常攻撃ダメージが入りません（必殺技ダメージは例外）。毎ターンHPも回復します。",
      mustClearWithinTurns: 5,
      penaltyDamage: "light_to_heavy",
      healPerTurn: 2,
      timeLimitSec: null,
      chainOnlyDamage: false,
      colorGate: true,
      hpMax: null,
    },
    [ENEMY_TYPE.SATELLA_YUME]: {
      name: "サテラ（夢の実現）",
      hint: "体力150。5ターン以内にブロックを消し続けないと被弾（重、低確率で激重）。さらに毎ターン“指定色”を破壊しないと通常攻撃ダメージが入りません（必殺技ダメージは例外）。毎ターンHPも回復します。",
      mustClearWithinTurns: 5,
      penaltyDamage: "heavy_rare_extreme",
      healPerTurn: 2,
      timeLimitSec: null,
      chainOnlyDamage: false,
      colorGate: true,
      hpMax: 150,
    },
  });

  function getEnemyNameFromState() {
    const s = getState();
    const n1 = normalizeCharName(s?.battle?.enemyName);
    const n2 = normalizeCharName(s?.view?.characters?.enemy?.name);
    return n1 || n2 || "";
  }

  function getEnemyTypeFromName(name) {
    const n = normalizeCharName(name);
    if (!n) return ENEMY_TYPE.NONE;

    if (n.includes("ニア・キナベイ")) return ENEMY_TYPE.NIA_KINABEI;
    if (n.includes("アパラ")) return ENEMY_TYPE.APARA;
    if (n.includes("アカネイ")) return ENEMY_TYPE.AKANEI;
    if (n.includes("サテラ")) {
      if (n.includes("夢") || n.includes("実現")) return ENEMY_TYPE.SATELLA_YUME;
      if (n.includes("二戦") || n.includes("2")) return ENEMY_TYPE.SATELLA_2;
      return ENEMY_TYPE.SATELLA_1;
    }
    if (n.includes("サイ")) return ENEMY_TYPE.SAI;

    if (n.includes("コト")) {
      if (n.includes("三戦") || n.includes("3")) return ENEMY_TYPE.KOTO_3;
      if (n.includes("二戦") || n.includes("2")) return ENEMY_TYPE.KOTO_2;
      if (n.includes("初戦") || n.includes("1")) return ENEMY_TYPE.KOTO_1;
      // 不明な場合は初戦扱い（安全側）
      return ENEMY_TYPE.KOTO_1;
    }

    return ENEMY_TYPE.NONE;
  }

  function getEnemyProfile() {
    const name = getEnemyNameFromState();
    const type = getEnemyTypeFromName(name);
    const base = ENEMY_PROFILE[type] || ENEMY_PROFILE[ENEMY_TYPE.NONE];
    return { ...base, rawName: name, type };
  }

  // 色（描画用）
  const COLOR_PALETTE = Object.freeze([
    null,
    "#ff5b5b", // 1 red
    "#4dd7ff", // 2 cyan
    "#ffd34d", // 3 yellow
    "#a7ff5b", // 4 green
    "#c58bff", // 5 purple (COLORS=5にした時用)
  ]);

  const COLOR_NAME_JA = Object.freeze({
    1: "赤",
    2: "青",
    3: "黄",
    4: "緑",
    5: "紫",
  });

  function pickEnemyGateColor() {
    // 1..COLORS
    return 1 + Math.floor(Math.random() * CFG.COLORS);
  }

  function updateEnemyOrderUi() {
    ensureSkillDom();
    const enemy = game.enemyProfile || getEnemyProfile();
    const panel = document.getElementById(ENEMY_UI_DOM.orderPanel);
    const chip = document.getElementById(ENEMY_UI_DOM.orderChip);
    const textEl = document.getElementById(ENEMY_UI_DOM.orderText);

    if (!enemy || !enemy.colorGate) {
      if (panel) panel.classList.add("is-hidden");
      return;
    }

    const c = game.enemyGateColor || pickEnemyGateColor();
    game.enemyGateColor = c;

    if (panel) panel.classList.remove("is-hidden");
    if (chip) {
      chip.style.background = (COLOR_PALETTE[c] || "rgba(255,255,255,0.10)");
    }
    if (textEl) {
      const nm = COLOR_NAME_JA[c] || String(c);
      textEl.textContent = `指定: ${nm}`;
    }
  }


  // ---------------------------
  // DOM
  // ---------------------------
  const canvas = document.getElementById(DOM.battle.canvas);
  const ctx = canvas ? canvas.getContext("2d") : null;

  // canvas内部解像度を揃える（HTML側に無い場合もある）
  if (canvas) {
    const size = DEFAULTS?.battle?.canvasInternalSize ?? 720;
    if (!canvas.width || !canvas.height) {
      canvas.width = size;
      canvas.height = size;
    } else {
      // 既に指定があるなら尊重（ただし片方欠けてたら揃える）
      if (!canvas.width) canvas.width = size;
      if (!canvas.height) canvas.height = size;
    }
  }

    // ---------------------------
  // Battle Side UI (portraits / HP bars / FX)
  // ---------------------------
  const elEnemySide = document.getElementById("battleEnemySide");
  const elSelfSide = document.getElementById("battleSelfSide");
  const elFloatLayer = document.getElementById((DOM.battle && DOM.battle.floatLayer) ? DOM.battle.floatLayer : "battleFloatLayer");

  function hitFx(side, amount, chain = 0) {
    const sideEl = side === "enemy" ? elEnemySide : elSelfSide;
    if (sideEl) {
      sideEl.classList.remove("is-hit");
      void sideEl.offsetWidth;
      sideEl.classList.add("is-hit");
      window.setTimeout(() => sideEl.classList.remove("is-hit"), 260);
    }

    if (elFloatLayer) {
      const d = document.createElement("div");
      d.className = "dmg-float";
      d.textContent = amount >= 0 ? `-${amount}` : String(amount);
      d.style.top = chain > 0 ? "14%" : "18%";
      d.style.left = side === "enemy" ? "18%" : "72%";
      elFloatLayer.appendChild(d);
      window.setTimeout(() => d.remove(), 900);
    }
  }

  // ---------------------------
  // Skill UI (DOM created on the fly)
  // ---------------------------
  const SKILL_DOM = Object.freeze({
    hud: "battleSkillHud",
    name: "battleSkillName",
    desc: "battleSkillDesc",
    gaugeFill: "battleSkillGaugeFill",
    gaugeText: "battleSkillGaugeText",
    button: "btnBattleSkill",
    nextPanel: "battleNextPanel",
    nextA: "battleNextA",
    nextB: "battleNextB",
  });

  const INFO_DOM = Object.freeze({
    timer: "battleEnemyTimer",
    infoBtn: "btnBattleInfo",
    modal: "battleInfoModal",
    modalTitle: "battleInfoTitle",
    body: "battleInfoBody",
    close: "btnBattleInfoClose",
  });

  const ENEMY_UI_DOM = Object.freeze({
    orderPanel: "battleEnemyOrderPanel",
    orderChip: "battleEnemyOrderChip",
    orderText: "battleEnemyOrderText",
  });

  // ---------------------------
  // Mobile virtual controls (optional)
  // ---------------------------
  const VCTRL_DOM = Object.freeze({
    pad: "battleVirtualPad",
    left: "btnVLeft",
    right: "btnVRight",
    rotate: "btnVRotate",
    soft: "btnVSoft",
    hard: "btnVHard",
  });

  function isProbablyMobile() {
    try {
      if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) return true;
    } catch (_) {}
    const w = Math.max(1, window.innerWidth || 0);
    const h = Math.max(1, window.innerHeight || 0);
    return Math.min(w, h) <= 900;
  }

  function injectVirtualControlsCssOnce() {
    if (document.getElementById("battleVirtualPadCss")) return;
    const st = document.createElement("style");
    st.id = "battleVirtualPadCss";
    st.textContent = `
      .battle-vpad{position:fixed;inset:0;z-index:9800;pointer-events:none;}
      .battle-vpad.is-hidden{display:none;}
      .battle-vpad .vcluster{position:absolute;bottom:calc(14px + env(safe-area-inset-bottom,0px));display:flex;gap:10px;align-items:flex-end;}
      .battle-vpad .vcluster.left{left:calc(14px + env(safe-area-inset-left,0px));}
      .battle-vpad .vcluster.right{right:calc(14px + env(safe-area-inset-right,0px));}
      .battle-vpad .vcol{display:flex;flex-direction:column;gap:10px;}
      .battle-vpad .vrow{display:flex;gap:10px;}
      .battle-vpad .vbtn{pointer-events:auto;width:58px;height:58px;border-radius:18px;border:1px solid rgba(255,255,255,.22);background:rgba(0,0,0,.36);color:rgba(255,255,255,.94);font:900 18px/1 system-ui,-apple-system,Segoe UI,Hiragino Sans,Noto Sans JP,sans-serif;display:flex;align-items:center;justify-content:center;user-select:none;-webkit-user-select:none;touch-action:none;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:0 12px 28px rgba(0,0,0,.30);}
      .battle-vpad .vbtn:active{transform:scale(.96)}
      @media (max-width: 740px){
        .battle-vpad .vbtn{width:54px;height:54px;border-radius:16px;font-size:17px;}
      }
      /* landscape: keep clusters slightly lower to avoid overlapping skill HUD */
      :root[data-orientation="landscape"] .battle-vpad .vcluster{bottom:calc(10px + env(safe-area-inset-bottom,0px));}
    `;
    document.head.appendChild(st);
  }

  function ensureVirtualControlsDom() {
    injectVirtualControlsCssOnce();
    let pad = document.getElementById(VCTRL_DOM.pad);
    if (!pad) {
      pad = document.createElement("div");
      pad.id = VCTRL_DOM.pad;
      pad.className = "battle-vpad is-hidden";
      pad.innerHTML = `
        <div class="vcluster left">
          <div class="vcol">
            <button id="${VCTRL_DOM.soft}" class="vbtn" type="button" aria-label="ソフトドロップ">↓</button>
            <div class="vrow">
              <button id="${VCTRL_DOM.left}" class="vbtn" type="button" aria-label="左">◀</button>
              <button id="${VCTRL_DOM.right}" class="vbtn" type="button" aria-label="右">▶</button>
            </div>
          </div>
        </div>
        <div class="vcluster right">
          <div class="vcol">
            <button id="${VCTRL_DOM.rotate}" class="vbtn" type="button" aria-label="回転">⟳</button>
            <button id="${VCTRL_DOM.hard}" class="vbtn" type="button" aria-label="ハードドロップ">⤓</button>
          </div>
        </div>
      `;
      document.body.appendChild(pad);

      const stop = (ev) => {
        try { ev.preventDefault(); } catch (_) {}
        try { ev.stopPropagation(); } catch (_) {}
      };

      const bLeft = document.getElementById(VCTRL_DOM.left);
      const bRight = document.getElementById(VCTRL_DOM.right);
      const bRot = document.getElementById(VCTRL_DOM.rotate);
      const bHard = document.getElementById(VCTRL_DOM.hard);
      const bSoft = document.getElementById(VCTRL_DOM.soft);

      const bindTap = (btn, fn) => {
        if (!btn) return;
        btn.addEventListener("pointerdown", (ev) => { stop(ev); fn(); });
      };

      bindTap(bLeft, () => {
        if (!canHandleBattleInput() || !game.piece) return;
        const now = performance.now();
        const minGap = 38;
        if (now - lastMoveTs < minGap) return;
        lastMoveTs = now;
        tryMove(-1, 0);
      });

      bindTap(bRight, () => {
        if (!canHandleBattleInput() || !game.piece) return;
        const now = performance.now();
        const minGap = 38;
        if (now - lastMoveTs < minGap) return;
        lastMoveTs = now;
        tryMove(+1, 0);
      });

      bindTap(bRot, () => {
        if (!canHandleBattleInput() || !game.piece) return;
        const now = performance.now();
        const minGap = 90;
        if (now - lastRotateTs < minGap) return;
        lastRotateTs = now;
        tryRotate(+1);
      });

      bindTap(bHard, () => {
        if (!canHandleBattleInput() || !game.piece) return;
        const now = performance.now();
        const minGap = 120;
        if (now - lastHardDropTs < minGap) return;
        lastHardDropTs = now;
        hardDrop();
      });

      // soft drop = hold
      if (bSoft) {
        const setSoft = (v) => { softDropHeld = !!v; };
        bSoft.addEventListener("pointerdown", (ev) => { stop(ev); if (!canHandleBattleInput()) return; setSoft(true); });
        window.addEventListener("pointerup", () => setSoft(false));
        bSoft.addEventListener("pointercancel", () => setSoft(false));
        bSoft.addEventListener("pointerleave", () => setSoft(false));
      }
    }
    return pad;
  }

  function updateVirtualControlsVisibility() {
    const pad = ensureVirtualControlsDom();
    if (!pad) return;
    const s = getState();
    const enabled = !!s?.settings?.virtualButtons;
    const show = enabled && isProbablyMobile() && inBattleScreen() && running && !battleResultVisible() && !isOverlayBlockingInput();
    pad.classList.toggle("is-hidden", !show);
  }

  function injectSkillCssOnce() {
    if (document.getElementById("battleSkillCss")) return;
    const st = document.createElement("style");
    st.id = "battleSkillCss";
    st.textContent = `
      #${DOM.root.viewport}, #${LAYERS.battle} { position: relative; }
      .battle-skill-hud {
        position: absolute;
        z-index: 520;
        left: 50%;
        bottom: calc(18px + env(safe-area-inset-bottom, 0px));
        transform: translateX(-50%);
        width: min(660px, calc(100% - 24px));
        padding: 10px 12px;
        border-radius: 14px;
        background: rgba(10, 12, 18, 0.78);
        border: 1px solid rgba(255,255,255,0.14);
        box-shadow: 0 12px 28px rgba(0,0,0,0.35);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        pointer-events: auto;
      }
      .battle-skill-hud.is-hidden { display: none; }
      .battle-skill-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
      .battle-skill-name { font: 800 16px/1.1 system-ui, -apple-system, Segoe UI, Hiragino Sans, Noto Sans JP, sans-serif; letter-spacing: 0.02em; color: rgba(255,255,255,0.92); }
      .battle-skill-desc { font: 600 12px/1.3 system-ui, -apple-system, Segoe UI, Hiragino Sans, Noto Sans JP, sans-serif; color: rgba(255,255,255,0.70); margin-top: 4px; }
      .battle-skill-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px; }
      .battle-skill-gauge {
        position: relative;
        flex: 1;
        height: 10px;
        border-radius: 999px;
        background: rgba(255,255,255,0.10);
        overflow: hidden;
        border: 1px solid rgba(255,255,255,0.10);
      }
      .battle-skill-gauge > .fill {
        height: 100%;
        width: 0%;
        background: linear-gradient(90deg, rgba(102,203,255,0.55), rgba(255,186,89,0.62), rgba(255,102,176,0.62));
        filter: saturate(1.2);
        transform-origin: left center;
      }
      .battle-skill-gauge-text {
        min-width: 46px;
        text-align: right;
        font: 800 12px/1 system-ui, -apple-system, Segoe UI, Hiragino Sans, Noto Sans JP, sans-serif;
        color: rgba(255,255,255,0.82);
      }
      .battle-skill-btn {
        pointer-events: auto;
        border: 1px solid rgba(255,255,255,0.22);
        background: rgba(255,255,255,0.08);
        color: rgba(255,255,255,0.90);
        border-radius: 12px;
        padding: 10px 12px;
        font: 900 13px/1 system-ui, -apple-system, Segoe UI, Hiragino Sans, Noto Sans JP, sans-serif;
        letter-spacing: 0.04em;
        cursor: pointer;
        user-select: none;
      }
      .battle-skill-btn[disabled] { opacity: 0.45; cursor: not-allowed; }
      .battle-skill-btn.is-ready {
        animation: battleSkillReady 1.15s ease-in-out infinite;
        border-color: rgba(255,255,255,0.38);
        box-shadow: 0 0 0 0 rgba(255,255,255,0.0);
      }
      @keyframes battleSkillReady {
        0%, 100% { transform: translateY(0); box-shadow: 0 0 0 0 rgba(255,255,255,0.0); }
        50% { transform: translateY(-1px); box-shadow: 0 10px 26px rgba(255,255,255,0.10); }
      }

      .battle-next-panel {
        position: absolute;
        z-index: 220;
        right: 14px;
        top: 14px;
        width: 92px;
        padding: 10px 10px 12px;
        border-radius: 16px;
        background: rgba(10, 12, 18, 0.78);
        border: 1px solid rgba(255,255,255,0.14);
        box-shadow: 0 12px 28px rgba(0,0,0,0.35);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
      }
      .battle-next-panel.is-hidden { display:none; }
      .battle-next-title { font: 900 11px/1 system-ui, -apple-system, Segoe UI, Hiragino Sans, Noto Sans JP, sans-serif; color: rgba(255,255,255,0.78); letter-spacing: 0.16em; }
      .battle-next-row { display:flex; align-items:center; justify-content: center; gap: 10px; margin-top: 10px; }
      .battle-next-cell {
        width: 26px; height: 26px;
        border-radius: 999px;
        border: 2px solid rgba(255,255,255,0.16);
        box-shadow: inset 0 0 0 2px rgba(0,0,0,0.20);
      }

      .battle-skill-flash {
        position: absolute;
        z-index: 228;
        left: 0; top: 0; right: 0; bottom: 0;
        pointer-events: none;
        background: radial-gradient(circle at 50% 55%, rgba(255,255,255,0.22), rgba(255,255,255,0.0) 60%);
        animation: battleSkillFlash 420ms ease-out both;
        mix-blend-mode: screen;
      }
      @keyframes battleSkillFlash {
        0% { opacity: 0; transform: scale(0.98); }
        20% { opacity: 1; }
        100% { opacity: 0; transform: scale(1.05); }
      }

      .skill-float {
        position: absolute;
        z-index: 229;
        left: 50%;
        top: 18%;
        transform: translateX(-50%);
        font: 900 22px/1 system-ui, -apple-system, Segoe UI, Hiragino Sans, Noto Sans JP, sans-serif;
        color: rgba(255,255,255,0.92);
        text-shadow: 0 10px 26px rgba(0,0,0,0.45);
        letter-spacing: 0.05em;
        pointer-events: none;
        animation: skillFloatIn 860ms ease-out both;
      }
      @keyframes skillFloatIn {
        0% { opacity: 0; transform: translateX(-50%) translateY(10px) scale(0.98); }
        18% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1.02); }
        100% { opacity: 0; transform: translateX(-50%) translateY(-18px) scale(1.04); }
      }

      

      /* Enemy order (SATELLA) */
      .battle-enemy-order {
        position: absolute;
        z-index: 221;
        left: 14px;
        top: 62px;
        width: 168px;
        padding: 10px 12px;
        border-radius: 16px;
        background: rgba(10, 12, 18, 0.78);
        border: 1px solid rgba(255,255,255,0.14);
        box-shadow: 0 12px 28px rgba(0,0,0,0.35);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        pointer-events: none;
      }
      .battle-enemy-order.is-hidden { display:none; }
      .battle-enemy-order-title {
        font: 900 11px/1 system-ui, -apple-system, Segoe UI, Hiragino Sans, Noto Sans JP, sans-serif;
        color: rgba(255,255,255,0.70);
        letter-spacing: 0.14em;
      }
      .battle-enemy-order-row { display:flex; align-items:center; gap:10px; margin-top: 10px; }
      .battle-enemy-order-chip {
        width: 26px; height: 26px;
        border-radius: 999px;
        border: 2px solid rgba(255,255,255,0.16);
        box-shadow: inset 0 0 0 2px rgba(0,0,0,0.20);
        background: rgba(255,255,255,0.10);
      }
      .battle-enemy-order-text {
        font: 900 13px/1.2 system-ui, -apple-system, Segoe UI, Hiragino Sans, Noto Sans JP, sans-serif;
        color: rgba(255,255,255,0.92);
      }

/* Enemy timer (SAI) */
      .battle-enemy-timer {
        position: absolute;
        z-index: 220;
        left: 50%;
        top: 14px;
        transform: translateX(-50%);
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(10, 12, 18, 0.78);
        border: 1px solid rgba(255,255,255,0.14);
        box-shadow: 0 12px 28px rgba(0,0,0,0.35);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        font: 900 13px/1 system-ui, -apple-system, Segoe UI, Hiragino Sans, Noto Sans JP, sans-serif;
        color: rgba(255,255,255,0.90);
        letter-spacing: 0.06em;
        pointer-events: none;
      }
      .battle-enemy-timer.is-hidden { display:none; }

      /* Info button */
      .battle-info-btn {
        position: absolute;
        z-index: 225;
        left: 14px;
        top: 14px;
        width: 40px;
        height: 40px;
        border-radius: 14px;
        border: 1px solid rgba(255,255,255,0.18);
        background: rgba(10, 12, 18, 0.66);
        color: rgba(255,255,255,0.92);
        font: 1000 16px/1 system-ui, -apple-system, Segoe UI, Hiragino Sans, Noto Sans JP, sans-serif;
        cursor: pointer;
        pointer-events: auto;
        box-shadow: 0 12px 28px rgba(0,0,0,0.30);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
      }
      .battle-info-btn:active { transform: translateY(1px); }
      .battle-info-btn.is-hidden { display: none; }

      /* Info modal */
      .battle-info-modal {
        position: absolute;
        z-index: 230;
        inset: 0;
        background: rgba(0,0,0,0.62);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 18px;
        pointer-events: auto;
      }
      .battle-info-modal.is-hidden { display:none; }
      .battle-info-card {
        width: min(680px, 100%);
        border-radius: 18px;
        background: rgba(10, 12, 18, 0.92);
        border: 1px solid rgba(255,255,255,0.16);
        box-shadow: 0 18px 48px rgba(0,0,0,0.50);
        padding: 14px 14px 12px;
        max-height: calc(100vh - 36px);
        overflow: auto;
      }
      .battle-info-title {
        font: 1000 16px/1.2 system-ui, -apple-system, Segoe UI, Hiragino Sans, Noto Sans JP, sans-serif;
        color: rgba(255,255,255,0.94);
        letter-spacing: 0.04em;
      }
      .battle-info-sub {
        margin-top: 10px;
        font: 900 12px/1 system-ui, -apple-system, Segoe UI, Hiragino Sans, Noto Sans JP, sans-serif;
        color: rgba(255,255,255,0.70);
        letter-spacing: 0.14em;
      }
      .battle-info-body {
        margin-top: 8px;
        font: 650 13px/1.45 system-ui, -apple-system, Segoe UI, Hiragino Sans, Noto Sans JP, sans-serif;
        color: rgba(255,255,255,0.86);
        white-space: pre-wrap;
      }
      .battle-info-actions {
        display:flex;
        justify-content:flex-end;
        margin-top: 12px;
      }
      .battle-info-close {
        border: 1px solid rgba(255,255,255,0.22);
        background: rgba(255,255,255,0.08);
        color: rgba(255,255,255,0.90);
        border-radius: 12px;
        padding: 10px 12px;
        font: 900 13px/1 system-ui, -apple-system, Segoe UI, Hiragino Sans, Noto Sans JP, sans-serif;
        cursor: pointer;
      }
    `;
    document.head.appendChild(st);
  }

  function ensureSkillDom() {
    injectSkillCssOnce();
    const host = document.getElementById(DOM.root.viewport) || document.getElementById(LAYERS.battle);
    if (!host) return;

    if (!document.getElementById(SKILL_DOM.hud)) {
      const hud = document.createElement("div");
      hud.id = SKILL_DOM.hud;
      hud.className = "battle-skill-hud is-hidden";
      hud.innerHTML = `
        <div class="battle-skill-top">
          <div id="${SKILL_DOM.name}" class="battle-skill-name"></div>
          <div id="${SKILL_DOM.desc}" class="battle-skill-desc"></div>
        </div>
        <div class="battle-skill-row">
          <div class="battle-skill-gauge">
            <div id="${SKILL_DOM.gaugeFill}" class="fill"></div>
          </div>
          <div id="${SKILL_DOM.gaugeText}" class="battle-skill-gauge-text">0/3</div>
          <button id="${SKILL_DOM.button}" class="battle-skill-btn" type="button" disabled>必殺</button>
        </div>
      `;
      host.appendChild(hud);
    }

    if (!document.getElementById(SKILL_DOM.nextPanel)) {
      const p = document.createElement("div");
      p.id = SKILL_DOM.nextPanel;
      p.className = "battle-next-panel is-hidden";
      p.innerHTML = `
        <div class="battle-next-title">NEXT</div>
        <div class="battle-next-row">
          <div id="${SKILL_DOM.nextA}" class="battle-next-cell"></div>
          <div id="${SKILL_DOM.nextB}" class="battle-next-cell"></div>
        </div>
      `;
      host.appendChild(p);
    }

    // Enemy order panel (SATELLA)
    if (!document.getElementById(ENEMY_UI_DOM.orderPanel)) {
      const o = document.createElement("div");
      o.id = ENEMY_UI_DOM.orderPanel;
      o.className = "battle-enemy-order is-hidden";
      o.innerHTML = `
        <div class="battle-enemy-order-title">ORDER</div>
        <div class="battle-enemy-order-row">
          <div id="${ENEMY_UI_DOM.orderChip}" class="battle-enemy-order-chip"></div>
          <div id="${ENEMY_UI_DOM.orderText}" class="battle-enemy-order-text"></div>
        </div>
      `;
      host.appendChild(o);
    }

    // Enemy timer + Info modal/button
    if (!document.getElementById(INFO_DOM.timer)) {
      const t = document.createElement("div");
      t.id = INFO_DOM.timer;
      t.className = "battle-enemy-timer is-hidden";
      t.textContent = "TIME 60";
      host.appendChild(t);
    }

    if (!document.getElementById(INFO_DOM.infoBtn)) {
      const b = document.createElement("button");
      b.id = INFO_DOM.infoBtn;
      b.className = "battle-info-btn is-hidden";
      b.type = "button";
      b.textContent = "i";
      host.appendChild(b);
    }

    if (!document.getElementById(INFO_DOM.modal)) {
      const m = document.createElement("div");
      m.id = INFO_DOM.modal;
      m.className = "battle-info-modal is-hidden";
      m.innerHTML = `
        <div class="battle-info-card" role="dialog" aria-modal="true">
          <div id="${INFO_DOM.modalTitle}" class="battle-info-title"></div>
          <div class="battle-info-sub">HINT</div>
          <div id="${INFO_DOM.body}" class="battle-info-body"></div>
          <div class="battle-info-actions">
            <button id="${INFO_DOM.close}" class="battle-info-close" type="button">閉じる</button>
          </div>
        </div>
      `;
      host.appendChild(m);
    }

    // Bind (once)
    const btn = document.getElementById(INFO_DOM.infoBtn);
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => {
        if (!inBattleScreen()) return;
        openInfoModal();
      });
    }

    const close = document.getElementById(INFO_DOM.close);
    if (close && !close.dataset.bound) {
      close.dataset.bound = "1";
      close.addEventListener("click", () => closeInfoModal());
    }

    const modal = document.getElementById(INFO_DOM.modal);
    if (modal && !modal.dataset.bound) {
      modal.dataset.bound = "1";
      // Click outside card closes
      modal.addEventListener("click", (ev) => {
        if (ev.target === modal) closeInfoModal();
      });
    }
  }

  function isInfoModalOpen() {
    const m = document.getElementById(INFO_DOM.modal);
    return !!(m && !m.classList.contains("is-hidden"));
  }

  function skillFxText(text) {
    const layer = document.getElementById(LAYERS.battle);
    if (!layer) return;
    const d = document.createElement("div");
    d.className = "skill-float";
    d.textContent = text;
    layer.appendChild(d);
    window.setTimeout(() => d.remove(), 950);
  }

  function skillFxFlash() {
    const layer = document.getElementById(LAYERS.battle);
    if (!layer) return;
    const f = document.createElement("div");
    f.className = "battle-skill-flash";
    layer.appendChild(f);
    window.setTimeout(() => f.remove(), 520);
  }


function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


function buildInfoHtml() {
  const enemy = game.enemyProfile || getEnemyProfile();
  const s = getState();

  const pName = getPlayerNameFromState() || "不明";
  const eName = (enemy?.rawName || enemy?.name || "敵");
  const hint = enemy?.hint || "通常通り撃破して下さい。";

  const dbg = [
    `battle.playerName=${normalizeCharName(s?.battle?.playerName)}`,
    `view.self.name=${normalizeCharName(s?.view?.characters?.self?.name)}`,
    `view.self.file=${normalizeCharName(s?.view?.characters?.self?.file)}`,
    `view.speech.name=${normalizeCharName(s?.view?.speech?.name)}`,
  ].join("\n");

  const debugHtml = (pName === "不明")
    ? `<details class="battle-info-debug"><summary>識別できなかったのでdebug表示</summary><pre>${escapeHtml(dbg)}</pre></details>`
    : "";

  return `
    <div class="battle-info-sec">
      <div class="battle-info-h">操作キャラ</div>
      <div class="battle-info-t">${escapeHtml(pName)}</div>
    </div>

    <div class="battle-info-sec">
      <div class="battle-info-h">HINT</div>
      <div class="battle-info-t"><b>${escapeHtml(eName)}</b>
${escapeHtml(hint)}</div>
    </div>

    ${debugHtml}
  `;
}

function openInfoModal() {
  ensureSkillDom();
  const m = document.getElementById(INFO_DOM.modal);
  const t = document.getElementById(INFO_DOM.modalTitle);
  const b = document.getElementById(INFO_DOM.body);
  if (!m || !t || !b) return;

  const pName = getPlayerNameFromState() || "プレイヤー";
  const eName = (game.enemyProfile?.rawName || getEnemyProfile()?.rawName || "") || "敵";
  t.textContent = `HINT: ${eName}`;

  // use HTML so we can show structured sections
  b.innerHTML = buildInfoHtml();

  m.classList.remove("is-hidden");
}

function closeInfoModal() {
  const m = document.getElementById(INFO_DOM.modal);
  if (m) m.classList.add("is-hidden");
}

// ---------------------------
  // Runtime
  // ---------------------------
  let running = false;
  let lastTs = 0;
  let fallAcc = 0;

  // 入力
  let softDropHeld = false;
  let lastMoveTs = 0;
  let lastRotateTs = 0;
  let lastHardDropTs = 0;

  // タッチ
  let touchStart = null;

  // 内部ゲーム状態（battle screen中のみ）
  const game = {
    cols: CFG.COLS,
    rowsTotal: CFG.HIDDEN_ROWS + CFG.VISIBLE_ROWS,

    board: null,      // [rowsTotal][cols] int (0 empty / 1..COLORS)
    piece: null,      // {x,y,ori,a,b}
    next: null,       // {a,b}

    // Skills
    skillGauge: 0,    // 0..CFG.SKILL_GAUGE_MAX

    // Enemy behavior (EP5)
    enemyProfile: null,
    turn: 0,
    turnsSinceClear: 0,
    battleStartMs: 0,
    timeLimitSec: null,

    chainLast: 0,     // 直近連鎖（HUD用）
    selfHp: CFG.SELF_HP,
    enemyHp: CFG.ENEMY_HP,
    enemyHpMax: CFG.ENEMY_HP,
    enemyGateColor: null,
    totalDamage: 0,

    gameOver: false,
    victory: false,
    encounterSig: "",
    inResolve: false,
  };

  // ---------------------------
  // Helpers
  // ---------------------------
  function getState() {
    return RP.UI.getState();
  }

  function setState(next) {
    RP.UI.setState(next);
  }

  function isOverlayBlockingInput() {
    const menu = document.getElementById(LAYERS.menu);
    const modal = document.getElementById(LAYERS.modal);
    const menuOpen = menu && !menu.classList.contains("is-hidden");
    const modalOpen = modal && !modal.classList.contains("is-hidden");
    const info = document.getElementById(INFO_DOM.modal);
    const infoOpen = info && !info.classList.contains("is-hidden");
    return !!(menuOpen || modalOpen || infoOpen);
  }

  function inBattleScreen() {
    const s = getState();
    return s && s.screen === SCREENS.BATTLE;
  }

  function battleResultVisible() {
    const s = getState();
    return !!s?.battle?.result?.visible;
  }

  function randColor() {
    // 1..COLORS
    return 1 + Math.floor(Math.random() * CFG.COLORS);
  }

  function newEmptyBoard() {
    const rows = game.rowsTotal;
    const cols = game.cols;
    const b = new Array(rows);
    for (let r = 0; r < rows; r++) {
      b[r] = new Array(cols).fill(0);
    }
    return b;
  }

  function cellAt(x, y) {
    if (y < 0 || y >= game.rowsTotal) return -1;
    if (x < 0 || x >= game.cols) return -1;
    return game.board[y][x];
  }

  function setCell(x, y, v) {
    if (y < 0 || y >= game.rowsTotal) return;
    if (x < 0 || x >= game.cols) return;
    game.board[y][x] = v;
  }

  function pieceCells(p) {
    // ori: 0=up (b above a), 1=right, 2=down, 3=left
    const ax = p.x;
    const ay = p.y;
    let bx = ax, by = ay;
    if (p.ori === 0) { by = ay - 1; }
    else if (p.ori === 1) { bx = ax + 1; }
    else if (p.ori === 2) { by = ay + 1; }
    else if (p.ori === 3) { bx = ax - 1; }
    return [
      { x: ax, y: ay, c: p.a },
      { x: bx, y: by, c: p.b },
    ];
  }

  function canPlace(p) {
    const cells = pieceCells(p);
    for (const c of cells) {
      // 上に隠し段があるので y<0 は許可しない（簡略）
      if (c.y < 0) return false;
      if (c.x < 0 || c.x >= game.cols) return false;
      if (c.y >= game.rowsTotal) return false;
      if (game.board[c.y][c.x] !== 0) return false;
    }
    return true;
  }

  function tryMove(dx, dy) {
    if (!game.piece) return false;
    const p2 = { ...game.piece, x: game.piece.x + dx, y: game.piece.y + dy };
    if (!canPlace(p2)) return false;
    game.piece = p2;
    return true;
  }

  function tryRotate(dir = +1) {
    if (!game.piece) return false;
    const ori2 = (game.piece.ori + (dir > 0 ? 1 : 3)) % 4;
    const p2 = { ...game.piece, ori: ori2 };
    if (canPlace(p2)) {
      game.piece = p2;
      return true;
    }
    if (!CFG.WALL_KICK) return false;

    // simple kick: try shift left/right by 1
    const kicks = [{ x: -1, y: 0 }, { x: +1, y: 0 }];
    for (const k of kicks) {
      const p3 = { ...p2, x: p2.x + k.x, y: p2.y + k.y };
      if (canPlace(p3)) {
        game.piece = p3;
        return true;
      }
    }
    return false;
  }

  function hardDrop() {
    if (!game.piece) return;
    while (tryMove(0, +1)) { /* fall */ }
    lockPiece();
  }

  function spawnIfNeeded() {
    if (game.piece) return;

    // next を使う
    if (!game.next) {
      game.next = { a: randColor(), b: randColor() };
    }
    const a = game.next.a;
    const b = game.next.b;

    // 次を先に作る
    game.next = { a: randColor(), b: randColor() };

    const spawnX = Math.floor(game.cols / 2) - 1; // 6なら2
    const spawnY = 1; // hidden rows内
    const p = { x: spawnX, y: spawnY, ori: 0, a, b };

    if (!canPlace(p)) {
      // game over
      game.gameOver = true;
      showResult(false);
      return;
    }

    game.piece = p;
  }

  function lockPiece() {
    if (!game.piece) return;

    // place cells
    for (const c of pieceCells(game.piece)) {
      setCell(c.x, c.y, c.c);
    }
    game.piece = null;

    // turn start (enemy behaviors evaluate per locked piece)
    game.turn = (game.turn || 0) + 1;
    const turnCtx = { hadClear: false, chainCount: 0 };

    // resolve
    resolveChains({ isTurn: true, turnCtx });
  }

  function applyGravityBoard() {
    // ぷよぷよの重力：列ごとに下へ詰める
    const cols = game.cols;
    const rows = game.rowsTotal;

    let moved = false;

    for (let x = 0; x < cols; x++) {
      let writeY = rows - 1;
      for (let y = rows - 1; y >= 0; y--) {
        const v = game.board[y][x];
        if (v !== 0) {
          if (y !== writeY) {
            game.board[writeY][x] = v;
            game.board[y][x] = 0;
            moved = true;
          }
          writeY--;
        }
      }
      // fill above writeY already 0
    }

    return moved;
  }

  function findGroupsToPop() {
    const rows = game.rowsTotal;
    const cols = game.cols;

    const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));
    const toPop = [];

    const dirs = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const v = game.board[y][x];
        if (v === 0 || visited[y][x] || v === CFG.BOMB_ID) continue;

        // BFS
        const q = [{ x, y }];
        visited[y][x] = true;
        const group = [{ x, y }];

        while (q.length) {
          const cur = q.pop();
          for (const d of dirs) {
            const nx = cur.x + d.dx;
            const ny = cur.y + d.dy;
            if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
            if (visited[ny][nx]) continue;
            if (game.board[ny][nx] !== v) continue;
            visited[ny][nx] = true;
            q.push({ x: nx, y: ny });
            group.push({ x: nx, y: ny });
          }
        }

        if (group.length >= 4) {
          toPop.push({ color: v, cells: group });
        }
      }
    }

    return toPop;
  }

  function popGroups(groups) {
    let poppedCells = 0;
    for (const g of groups) {
      for (const c of g.cells) {
        if (game.board[c.y][c.x] !== 0) {
          game.board[c.y][c.x] = 0;
          poppedCells++;
        }
      }
    }
    return poppedCells;
  }

  function computeDamage(chainIndex, groupCount) {
    const base = CFG.DAMAGE_PER_CLEAR;
    const chainBonus = CFG.CHAIN_BONUS_PER_STEP * Math.max(0, chainIndex - 1);
    const groupBonus = CFG.GROUP_BONUS_PER_EXTRA * Math.max(0, groupCount - 1);
    return base + chainBonus + groupBonus;
  }

  function computeScore(poppedCells, chainIndex) {
    const base = poppedCells * CFG.SCORE_PER_PUYO;
    const mult = 1 + CFG.SCORE_CHAIN_MULT * Math.max(0, chainIndex - 1);
    return Math.floor(base * mult);
  }

  // ---------------------------
  // Enemy behavior helpers
  // ---------------------------
  function randPenaltyDamage(type) {
    const t = String(type || "light_to_heavy");

    if (t === "heavy") {
      const table = [14, 18, 22, 26];
      return table[Math.floor(Math.random() * table.length)];
    }

    if (t === "heavy_rare_extreme") {
      // 重メイン、低確率で激重
      const r = Math.random();
      if (r < 0.10) {
        const extreme = [36, 42, 50];
        return extreme[Math.floor(Math.random() * extreme.length)];
      }
      const heavy = [18, 22, 26, 30];
      return heavy[Math.floor(Math.random() * heavy.length)];
    }

    // default: light_to_heavy
    const table = [6, 10, 14, 18];
    return table[Math.floor(Math.random() * table.length)];
  }

  function dealSelfDamage(amount, reasonText = "") {
    const dmg = Math.max(0, Math.floor(amount || 0));
    if (dmg <= 0) return;

    game.selfHp = Math.max(0, game.selfHp - dmg);
    hitFx("self", dmg, 0);

    if (reasonText) {
      skillFxText(reasonText);
      skillFxFlash();
    }

    syncHudToState();

    if (game.selfHp <= 0) {
      game.gameOver = true;
      showResult(false);
    }
  }

  function healEnemy(amount) {
    const v = Math.max(0, Math.floor(amount || 0));
    if (v <= 0) return;
    game.enemyHp = Math.min(game.enemyHpMax || CFG.ENEMY_HP, game.enemyHp + v);
    syncHudToState();
  }

  function onPlayerTurnResolved(turnCtx) {
    const enemy = game.enemyProfile || getEnemyProfile();
    if (!enemy) return;

    // (1) turn-based healing
    if (enemy.healPerTurn && enemy.healPerTurn > 0) {
      healEnemy(enemy.healPerTurn);
    }

    // (2) "must clear within N turns" penalty
    if (enemy.mustClearWithinTurns) {
      if (turnCtx?.hadClear) game.turnsSinceClear = 0;
      else game.turnsSinceClear = (game.turnsSinceClear || 0) + 1;

      if (game.turnsSinceClear >= enemy.mustClearWithinTurns) {
        game.turnsSinceClear = 0;
        const dmg = randPenaltyDamage(enemy.penaltyDamage);
        dealSelfDamage(dmg, "敵の攻撃！");
      }
    }

    // (3) Color gate changes every turn (SATELLA)
    if (enemy.colorGate && !game.gameOver && !game.victory) {
      game.enemyGateColor = pickEnemyGateColor();
      updateEnemyOrderUi();
    }
  }

  function updateEnemyTimer(nowMs) {
    const enemy = game.enemyProfile;
    const el = document.getElementById(INFO_DOM.timer);

    if (!enemy || !enemy.timeLimitSec) {
      if (el) el.classList.add("is-hidden");
      return;
    }

    const limitMs = enemy.timeLimitSec * 1000;
    const elapsed = Math.max(0, (nowMs || performance.now()) - (game.battleStartMs || 0));
    const remainMs = Math.max(0, limitMs - elapsed);
    const remainSec = Math.ceil(remainMs / 1000);

    if (el) {
      el.classList.remove("is-hidden");
      el.textContent = `TIME ${remainSec}`;
    }

    if (remainMs <= 0 && !game.gameOver && !game.victory) {
      // time out = lose
      game.gameOver = true;
      showResult(false);
    }
  }

  // ---------------------------
  // Skill runtime / UI sync
  // ---------------------------
  function setHiddenById(id, hidden) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("is-hidden", !!hidden);
    if (id === INFO_DOM.infoBtn) el.style.display = hidden ? "none" : "";
  }

  function hideBattleOverlays() {
    // battle以外に漏れないようにまとめて隠す
    const ids = [SKILL_DOM.hud, SKILL_DOM.nextPanel, ENEMY_UI_DOM.orderPanel, INFO_DOM.timer, INFO_DOM.modal, INFO_DOM.infoBtn];
    for (const id of ids) setHiddenById(id, true);
  }

  function paintNextCell(el, colorId) {
    if (!el) return;
    const col = COLOR_PALETTE[colorId] || "rgba(255,255,255,0.08)";
    el.style.background = col;
  }

  function updateSkillUi() {
    if (!inBattleScreen()) { hideBattleOverlays(); return; }
    ensureSkillDom();
    // infoボタンは戦闘中のみ表示
    setHiddenById(INFO_DOM.infoBtn, false);

    let def = getPlayerSkillDef();

    // battle突入直後は selfImg のsrc更新前で判定が外れることがある → DOMから再取得して再判定
    if (def.key === "none" && inBattleScreen()) {
      const dn = getPlayerNameFromBattleDom();
      if (dn) {
        game.playerName = dn;
        persistPlayerNameToState(dn);
        def = getPlayerSkillDef();
      }
    }

    // If player skill is unknown, still show HUD (avoids 'disappearing' when name detection lags)
    if (def.key === "none") {
      def = { ...def, name: "スキル", desc: "（判定中）" };
    }

    const hud = document.getElementById(SKILL_DOM.hud);
    const elName = document.getElementById(SKILL_DOM.name);
    const elDesc = document.getElementById(SKILL_DOM.desc);
    const elFill = document.getElementById(SKILL_DOM.gaugeFill);
    const elText = document.getElementById(SKILL_DOM.gaugeText);
    const btn = document.getElementById(SKILL_DOM.button);

    const nextPanel = document.getElementById(SKILL_DOM.nextPanel);
    const nextA = document.getElementById(SKILL_DOM.nextA);
    const nextB = document.getElementById(SKILL_DOM.nextB);

    if (hud) hud.classList.remove("is-hidden");
    if (elName) elName.textContent = def.name || "";
    if (elDesc) elDesc.textContent = def.desc || "";

    // NEXT preview
    if (nextPanel) nextPanel.classList.toggle("is-hidden", !def.showNext);
    if (def.showNext && game.next) {
      paintNextCell(nextA, game.next.a);
      paintNextCell(nextB, game.next.b);
    }

    // Gauge / button
    if (btn) {
      btn.style.display = def.hasButton ? "" : "none";
      btn.textContent = (def.key === "kyoubou" || def.key === "chuuyou" || def.key === "shin_chuuyou") ? "狂暴の構え" : (def.key === "muku" ? "無垢の構え" : "必殺");
    }

    const max = CFG.SKILL_GAUGE_MAX;
    const g = Math.max(0, Math.min(max, game.skillGauge || 0));
    const ratio = max > 0 ? (g / max) : 0;

    if (elFill) {
      elFill.style.width = def.hasButton ? `${Math.floor(ratio * 100)}%` : "100%";
      elFill.style.opacity = def.hasButton ? "1" : "0.35";
    }
    if (elText) elText.textContent = def.hasButton ? `連鎖ゲージ ${g}/${max}` : (def.showNext ? "常時" : "--");

    if (btn) {
      const ready = def.hasButton && g >= max;
      btn.disabled = !ready;
      btn.classList.toggle("is-ready", !!ready);
    }

    // bind (once)
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => {
        if (!canHandleBattleInput()) return;
        activateSkill();
      });
    }
  }

  function applyDirectSkillDamage(amount, chainForFx = 0) {
    const dmg = Math.max(0, Math.floor(amount || 0));
    if (dmg <= 0) return false;

    game.chainLast = chainForFx || game.chainLast;
    game.totalDamage += dmg;
    game.enemyHp = Math.max(0, game.enemyHp - dmg);

    hitFx("enemy", dmg, chainForFx || 0);
    syncHudToState();

    if (game.enemyHp <= 0) {
      game.victory = true;
      showResult(true);
      return true;
    }
    return false;
  }

  function castKyoubouRowDelete() {
    // remove bottom row
    const y = game.rowsTotal - 1;
    const removed = [];
    for (let x = 0; x < game.cols; x++) {
      const v = game.board?.[y]?.[x] ?? 0;
      if (v !== 0) removed.push(v);
      if (game.board?.[y]) game.board[y][x] = 0;
    }

    const uniq = new Set(removed);
    const kinds = uniq.size;
    const dmg = kinds * CFG.SKILL_RAGE_DAMAGE_PER_COLOR;

    // 【修正点】ここで先に重力を適用し、盤面を落としておく
    applyGravityBoard();

    if (applyDirectSkillDamage(dmg, 0)) return;

    // resolve any new matches created by the row delete, but don't refill gauge from it
    applyGravityBoard();
    syncHudToState();
    updateSkillUi();

    resolveChains({ fromSkill: true });
  }

  function explodeBombAt(cx, cy) {
    const r = (Number.isFinite(CFG.BOMB_RADIUS) ? CFG.BOMB_RADIUS : 1);
    let destroyed = 0;

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= game.cols) continue;
        if (y < 0 || y >= game.rowsTotal) continue;
        const v = game.board?.[y]?.[x] ?? 0;
        if (v === 0) continue;

        // bomb itself and any blocks are destroyed
        if (v !== CFG.BOMB_ID) destroyed += 1;
        if (game.board?.[y]) game.board[y][x] = 0;
      }
    }

    // damage (bypass enemy gimmicks)
    const dmg = destroyed * CFG.SKILL_MUKU_DAMAGE_PER_BLOCK;
    if (dmg > 0) {
      applyGravityBoard();
      if (applyDirectSkillDamage(dmg, 0)) return true;
    }

    return false;
  }

  function castMukuBomb() {
    // pick target column: current piece x if exists, otherwise center
    const col = game.piece ? Math.max(0, Math.min(game.cols - 1, game.piece.x)) : Math.floor(game.cols / 2);

    // find landing row
    let y = game.rowsTotal - 1;
    while (y >= 0 && (game.board?.[y]?.[col] ?? 0) !== 0) y--;

    if (y < 0) {
      // column full: no-op (avoid crash)
      skillFxText("ボムを落とせない！");
      return;
    }

    // drop bomb and explode immediately on landing
    game.board[y][col] = CFG.BOMB_ID;

    // FX
    skillFxText("BOOM!");

    // explode
    if (explodeBombAt(col, y)) return;

    // settle then resolve chains caused by the explosion (skill context)
    applyGravityBoard();
    syncHudToState();
    updateSkillUi();

    resolveChains({ fromSkill: true });
  }

  function activateSkill() {
    const def = getPlayerSkillDef();
    if (!def.hasButton) return;
    const max = CFG.SKILL_GAUGE_MAX;
    if ((game.skillGauge || 0) < max) return;
    if (game.inResolve) return;
    if (game.gameOver || game.victory) return;

    // consume gauge
    game.skillGauge = 0;
    updateSkillUi();

    // FX
    skillFxFlash();
    skillFxText(def.name);

    if (def.key === "muku") {
      castMukuBomb();
      return;
    }

    // default: kyoubou-style row delete (kyoubou / chuuyou / shin_chuuyou)
    castKyoubouRowDelete();
  }


  function syncHudToState() {
    // score=総ダメージ, chain=直近連鎖, timeLeft=敵HP
    const s0 = getState();
    const s = RP.State.deepClone(s0);

    s.battle.active = true;
    s.battle.score = game.totalDamage;
    s.battle.chain = game.chainLast;
    s.battle.timeLeft = null;
    s.battle.hpSelfMax = CFG.SELF_HP;
    s.battle.hpEnemyMax = (game.enemyHpMax || CFG.ENEMY_HP);
    s.battle.hpSelf = game.selfHp;
    s.battle.hpEnemy = game.enemyHp;

    RP.State.touchUpdatedAt(s);
    setState(s);

    // skill UI is DOM-based; keep it in sync whenever HUD updates
    updateSkillUi();
  }

  function showResult(isWin) {
    // リザルト表示（続けるボタンで engine.js が復帰処理）
    const s0 = getState();
    const s = RP.State.deepClone(s0);

    s.battle.active = false;

    // Clear cached playerName so next PART does not inherit previous skill
    s.battle.playerName = "";
    game.playerName = "";
    s.battle.result.visible = true;
    s.battle.result.outcome = isWin ? "WIN" : "LOSE";
    s.battle.result.detail = isWin
      ? `撃破！ 総ダメージ ${game.totalDamage} / 自HP ${Math.max(0, game.selfHp)}`
      : `敗北… 総ダメージ ${game.totalDamage}`;

    RP.State.touchUpdatedAt(s);
    setState(s);

    // HUDも合わせる
    syncHudToState();

    running = false;
  }

  function resolveChains(opts = {}) {
    const { fromSkill = false, isTurn = false, turnCtx = null } = opts;
    const enemy = game.enemyProfile || getEnemyProfile();

    if (game.inResolve) return;
    game.inResolve = true;

    // まず落下を安定させる
    applyGravityBoard();

    let chain = 0;
    // KOTO（二戦目）: 1段消し（=1連鎖相当）だけではダメージが入らない
    // -> 2段目以降が成立した時点で、1段目分もまとめて通す
    const deferredDamages = [];

    // SATELLA: 指定色を消したターンしか通常攻撃ダメージが通らない（必殺ダメージは例外）
    const gateColor = (enemy && enemy.colorGate) ? (game.enemyGateColor || null) : null;
    let gateSatisfied = (!gateColor) || !!fromSkill;

    function applyEnemyDamage(amount, chainForFx) {
      const dmg = Math.max(0, Math.floor(amount || 0));
      if (dmg <= 0) return;

      game.chainLast = chainForFx || game.chainLast;
      game.totalDamage += dmg;
      game.enemyHp = Math.max(0, game.enemyHp - dmg);

      hitFx("enemy", dmg, chainForFx || 0);
      syncHudToState();

      if (game.enemyHp <= 0) {
        game.victory = true;
        showResult(true);
        game.inResolve = false;
        return true;
      }
      return false;
    }

    while (true) {
      const groups = findGroupsToPop();
      if (groups.length === 0) break;

      chain++;

      if (turnCtx) {
        turnCtx.hadClear = true;
        turnCtx.chainCount = chain;
      }

      // color gate check (SATELLA)
      if (!gateSatisfied && gateColor) {
        for (const g of groups) {
          if (g && g.color === gateColor) {
            gateSatisfied = true;
            break;
          }
        }
      }

      // 連鎖ごとにゲージ加算（スキル発動による消しでは加算しない）
      if (!fromSkill) {
        game.skillGauge = Math.min(CFG.SKILL_GAUGE_MAX, (game.skillGauge || 0) + 1);
      }

      const popped = popGroups(groups);
      applyGravityBoard();

      const chainEffective = (chain === 1 && groups.length >= 2) ? 2 : chain;

      // 仕様: 1回の消去で2グループ以上消えたら、それも「連鎖」とみなす
      if (turnCtx) {
        turnCtx.chainCount = Math.max(turnCtx.chainCount || 0, chainEffective);
      }

      const damage = computeDamage(chainEffective, groups.length);
      const scoreAdd = computeScore(popped, chainEffective);

      // ダメージ処理
      // - chainOnlyDamage（コト二戦目/三戦目）: “連鎖”でしかダメージが入らない
      // - colorGate（サテラ）: 指定色を消したターンしか通常攻撃ダメージが通らない（必殺ダメージは例外）
      const chainUnlocked = !(enemy && enemy.chainOnlyDamage)
        ? true
        : ((chain >= 2) || (chain === 1 && groups.length >= 2));

      const gateUnlocked = (!gateColor) ? true : gateSatisfied;
      const unlocked = chainUnlocked && gateUnlocked;

      if (!unlocked) {
        // 条件未達：ダメージを保留（成立したらまとめて通す）
        deferredDamages.push({ dmg: damage, chainForFx: chainEffective });
      } else {
        // 解放: 保留分（あれば）もまとめて通す
        while (deferredDamages.length) {
          const d = deferredDamages.shift();
          if (applyEnemyDamage(d.dmg, d.chainForFx)) return;
        }
        if (applyEnemyDamage(damage, chainEffective)) return;
      }

      void scoreAdd; // 将来スコア表示を増やすならここ
    }

    // 条件未達で終わった場合：ダメージ無し（保留分を破棄）
    if (deferredDamages.length) {
      deferredDamages.length = 0;
      // HUDのチェーン表示だけ更新
      game.chainLast = Math.max(game.chainLast || 0, chain);
      syncHudToState();

      // SATELLA: 指定色を消していないターンは通常攻撃が無効
      if (isTurn && !fromSkill && gateColor && !gateSatisfied) {
        skillFxText("指定色を消さないとダメージが通らない！");
      }
    }

    game.inResolve = false;
    spawnIfNeeded();
    updateSkillUi(); // next更新もここで同期

    // ターン終端の敵挙動
    if (isTurn && !fromSkill && !game.gameOver && !game.victory) {
      onPlayerTurnResolved(turnCtx || { hadClear: chain > 0, chainCount: chain });
    }
  }

  // ---------------------------
  // Rendering
  // ---------------------------
  function draw() {
    if (!ctx || !canvas) return;

      // 戦闘画面以外では描画しない（タイトル/ADV中に board が null で落ちるのを防ぐ）
  const s = getState();
  if (!s || s.screen !== SCREENS.BATTLE) return;

  // 初期化前は何もしない
  if (!game.board) return;


    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // background
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(0, 0, W, H);

    // board geometry (fit height)
    const cell = Math.floor(H / CFG.VISIBLE_ROWS);
    const boardW = cell * CFG.COLS;
    const boardH = cell * CFG.VISIBLE_ROWS;

    const ox = Math.floor((W - boardW) / 2);
    const oy = Math.floor((H - boardH) / 2);

    // frame
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 4;
    ctx.strokeRect(ox - 6, oy - 6, boardW + 12, boardH + 12);

    // grid (subtle)
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= CFG.COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(ox + x * cell, oy);
      ctx.lineTo(ox + x * cell, oy + boardH);
      ctx.stroke();
    }
    for (let y = 0; y <= CFG.VISIBLE_ROWS; y++) {
      ctx.beginPath();
      ctx.moveTo(ox, oy + y * cell);
      ctx.lineTo(ox + boardW, oy + y * cell);
      ctx.stroke();
    }

    // draw settled puyos (visible rows only)
    for (let y = CFG.HIDDEN_ROWS; y < game.rowsTotal; y++) {
      for (let x = 0; x < game.cols; x++) {
        const v = game.board[y][x];
        if (v === 0) continue;
        const vy = y - CFG.HIDDEN_ROWS;

        drawPuyo(ox + x * cell, oy + vy * cell, cell, v);
      }
    }

    // draw current piece
    if (game.piece) {
      for (const c of pieceCells(game.piece)) {
        if (c.y < CFG.HIDDEN_ROWS) continue; // hidden rows not drawn
        const vy = c.y - CFG.HIDDEN_ROWS;
        drawPuyo(ox + c.x * cell, oy + vy * cell, cell, c.c);
      }
    }

    // game over overlay (if needed)
    if (game.gameOver && !battleResultVisible()) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "800 48px system-ui, -apple-system, Segoe UI, Hiragino Sans, Noto Sans JP, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("GAME OVER", W / 2, H / 2);
    }
  }

  function drawPuyo(px, py, cell, colorId) {
    // bomb (カレイ技能)
    if (colorId === CFG.BOMB_ID) {
      const r = Math.floor(cell * 0.44);
      const cx = px + Math.floor(cell / 2);
      const cy = py + Math.floor(cell / 2);

      // body
      ctx.beginPath();
      ctx.fillStyle = "rgba(20,20,20,0.92)";
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      // rim
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = Math.max(2, Math.floor(cell * 0.06));
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      // fuse
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255,180,60,0.9)";
      ctx.lineWidth = Math.max(2, Math.floor(cell * 0.05));
      ctx.moveTo(cx + r * 0.15, cy - r * 0.75);
      ctx.lineTo(cx + r * 0.55, cy - r * 1.05);
      ctx.stroke();

      // cross mark
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = Math.max(2, Math.floor(cell * 0.08));
      ctx.moveTo(cx - r * 0.45, cy - r * 0.45);
      ctx.lineTo(cx + r * 0.45, cy + r * 0.45);
      ctx.moveTo(cx + r * 0.45, cy - r * 0.45);
      ctx.lineTo(cx - r * 0.45, cy + r * 0.45);
      ctx.stroke();

      return;
    }
    const r = Math.floor(cell * 0.44);
    const cx = px + Math.floor(cell / 2);
    const cy = py + Math.floor(cell / 2);

    const col = COLOR_PALETTE[colorId] || "#ffffff";

    // body
    ctx.beginPath();
    ctx.fillStyle = col;
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // shadow edge
    ctx.beginPath();
    ctx.strokeStyle = "rgba(0,0,0,0.28)";
    ctx.lineWidth = Math.max(2, Math.floor(cell * 0.06));
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // highlight
    ctx.beginPath();
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---------------------------
  // Update loop
  // ---------------------------
  function resetBattleRuntime() {
    // enemy profile determined from scenario (battle enemyName) or view
    game.enemyProfile = getEnemyProfile();

// capture playable character name once (for skill UI / info)
    game.playerName = "";
    game.playerName = getPlayerNameFromState();
    persistPlayerNameToState(game.playerName);
    game.turn = 0;
    game.turnsSinceClear = 0;
    game.battleStartMs = performance.now();
    game.timeLimitSec = game.enemyProfile?.timeLimitSec || null;

    game.board = newEmptyBoard();
    game.piece = null;
    game.next = { a: randColor(), b: randColor() };

    game.chainLast = 0;
    game.selfHp = CFG.SELF_HP;
    game.enemyHpMax = (game.enemyProfile?.hpMax || CFG.ENEMY_HP);
    game.enemyHp = game.enemyHpMax;

    game.enemyGateColor = (game.enemyProfile?.colorGate) ? pickEnemyGateColor() : null;
    game.totalDamage = 0;

    game.skillGauge = 0;

    game.gameOver = false;
    game.victory = false;
    game.inResolve = false;

    spawnIfNeeded();
    syncHudToState();
    updateSkillUi();
    updateEnemyOrderUi();
    scheduleSkillUiRefresh();
  }

  function ensureRunningIfBattle() {
    if (!ctx || !canvas) return;

    const s = getState();
    const shouldRun = s && s.screen === SCREENS.BATTLE && !s?.battle?.result?.visible;

    if (shouldRun) {
      const sig = String(getEnemyNameFromState() || "") + "|" + String(getPlayerNameFromState() || "");

      if (!running) {
        // entering battle
        game.encounterSig = sig;
        resetBattleRuntime();
        running = true;
        lastTs = 0;
        fallAcc = 0;
      } else {
        // If scenario swaps encounters without leaving the battle screen, refresh runtime/UI
        if (sig && game.encounterSig && sig !== game.encounterSig) {
          game.encounterSig = sig;
          resetBattleRuntime();
        } else if (sig && !game.encounterSig) {
          game.encounterSig = sig;
        }
      }
    }

    if (!shouldRun && running) {
      // leaving battle or result open
      running = false;
      game.encounterSig = "";
      hideBattleOverlays();
      closeInfoModal();
    }

    if (!shouldRun && !running) {
      // 念のため常に漏れを塞ぐ
      hideBattleOverlays();
    }
  }


  function update(dt) {
    if (!running) return;
    if (isOverlayBlockingInput()) return;
    if (battleResultVisible()) return;
    if (game.gameOver || game.victory) return;
    if (game.inResolve) return;

    spawnIfNeeded();
    if (!game.piece) return;

    const interval = softDropHeld ? CFG.SOFT_DROP_MS : CFG.GRAVITY_MS;
    fallAcc += dt;

    while (fallAcc >= interval) {
      fallAcc -= interval;

      const moved = tryMove(0, +1);
      if (!moved) {
        // landed
        if (CFG.LOCK_DELAY_MS <= 0) {
          lockPiece();
          return;
        }
      }
    }
  }

  function loop(ts) {
    try {
      ensureRunningIfBattle();
      // virtual controls visibility can change by settings/screen
      updateVirtualControlsVisibility();
      if (!inBattleScreen()) { hideBattleOverlays(); closeInfoModal(); }
      // If playerName wasn't captured at battle entry, retry from DOM a few times.
      if (running && inBattleScreen() && !game.playerName) {
        const dn = getPlayerNameFromBattleDom();
        if (dn) {
          game.playerName = dn;
          persistPlayerNameToState(dn);
          updateSkillUi();
        }
      }

      // enemy time-limit (SAI)
      if (running && inBattleScreen() && !battleResultVisible()) {
        updateEnemyTimer(ts);
      }

      // keep skill UI synced even if state/portraits update mid-battle
      if (running && inBattleScreen() && !battleResultVisible()) {
        autoSkillUiSync(ts);
      }

      if (!lastTs) lastTs = ts;
      const dt = Math.min(50, ts - lastTs);
      lastTs = ts;

      update(dt);
      draw();
    } catch (e) {
      console.error(e);
      running = false;
    }

    requestAnimationFrame(loop);
  }

  // ---------------------------
  // Input bindings (battle only)
  // ---------------------------
  function canHandleBattleInput() {
    if (!inBattleScreen()) return false;
    if (!running) return false;
    if (battleResultVisible()) return false;
    if (isOverlayBlockingInput()) return false;
    if (game.gameOver || game.victory) return false;
    return true;
  }

  function onKeyDown(ev) {
    if (!canHandleBattleInput()) return;

    const key = ev.key;

    // prevent scroll
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(key)) {
      ev.preventDefault();
    }

    const now = performance.now();

    if (key === "ArrowDown") {
      softDropHeld = true;
      return;
    }

    if (!game.piece) return;

    // throttle a bit for repeat stability
    if (key === "ArrowLeft" || key === "ArrowRight") {
      const minGap = 38;
      if (now - lastMoveTs < minGap) return;
      lastMoveTs = now;
      tryMove(key === "ArrowLeft" ? -1 : +1, 0);
      return;
    }

    if (key === "ArrowUp") {
      const minGap = 90;
      if (now - lastRotateTs < minGap) return;
      lastRotateTs = now;
      tryRotate(+1);
      return;
    }

    if (key === " ") {
      const minGap = 120;
      if (now - lastHardDropTs < minGap) return;
      lastHardDropTs = now;
      hardDrop();
      return;
    }
  }

  function onKeyUp(ev) {
    if (ev.key === "ArrowDown") {
      softDropHeld = false;
    }
  }

  function onPointerDown(ev) {
    if (!canvas) return;
    if (!canHandleBattleInput()) return;

    const rect = canvas.getBoundingClientRect();
    touchStart = {
      x: ev.clientX,
      y: ev.clientY,
      t: performance.now(),
      cx: ev.clientX - rect.left,
      cy: ev.clientY - rect.top,
      w: rect.width,
      h: rect.height,
    };
  }

  function onPointerUp(ev) {
    if (!touchStart) return;
    if (!canHandleBattleInput()) { touchStart = null; return; }

    const dx = ev.clientX - touchStart.x;
    const dy = ev.clientY - touchStart.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    // swipe
    if (adx > CFG.SWIPE_THRESHOLD || ady > CFG.SWIPE_THRESHOLD) {
      if (adx > ady) {
        // horizontal = move
        tryMove(dx < 0 ? -1 : +1, 0);
      } else {
        // vertical
        if (dy > 0) {
          // down = hard drop
          hardDrop();
        } else {
          // up = rotate
          tryRotate(+1);
        }
      }
      touchStart = null;
      return;
    }

    // tap = rotate, but tap left/right edges -> move
    const xNorm = touchStart.cx / Math.max(1, touchStart.w);
    if (xNorm < 0.33) tryMove(-1, 0);
    else if (xNorm > 0.66) tryMove(+1, 0);
    else tryRotate(+1);

    touchStart = null;
  }

  // ---------------------------
  // Public API (optional)
  // ---------------------------
  function debugWin() {
    if (!inBattleScreen()) return;
    game.enemyHp = 0;
    syncHudToState();
    showResult(true);
  }

  function debugLose() {
    if (!inBattleScreen()) return;
    game.gameOver = true;
    showResult(false);
  }

  function start() {
    if (!inBattleScreen()) return;
    resetBattleRuntime();
    syncHudToState();
  }

  RP.Battle = Object.freeze({
    start,
    debugWin,
    debugLose,
  });

  // ---------------------------
  // Init
  // ---------------------------
  function init() {
    if (!canvas || !ctx) {
      console.warn("[battle.js] battleCanvas not found");
      return;
    }

    // skill panels are DOM-based; create them even if HTML doesn't include them
    ensureSkillDom();
    ensureVirtualControlsDom();
    updateSkillUi();
    updateVirtualControlsVisibility();

    // react quickly when settings change
    try {
      if (RP.UI && typeof RP.UI.on === "function") {
        RP.UI.on("settingsChanged", () => updateVirtualControlsVisibility());
        RP.UI.on("stateLoaded", () => updateVirtualControlsVisibility());
      }
    } catch (_) {}

    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);

    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);

    requestAnimationFrame(loop);
  }

  document.addEventListener("DOMContentLoaded", () => {
    try { init(); } catch (e) { console.error(e); }
  });
})();
