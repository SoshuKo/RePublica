/* =========================================================
   state.js
   - ゲーム状態(State)の定義と初期化
   - ここを基準にUI/エンジン/セーブが動く（シナリオは後でOK）
   - bundler無し前提：window.RP にぶら下げる
   ========================================================= */

(() => {
  "use strict";

  const RP = (window.RP = window.RP || {});
  if (!RP.CONST) throw new Error("RP.CONST not found. Load constants.js first.");
  if (!RP.VERSION) throw new Error("RP.VERSION not found. Load version.js first.");

  const { SCREENS, DEFAULTS, CHARACTER } = RP.CONST;

  // ---------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------
  function nowIso() {
    return new Date().toISOString();
  }

  function isPlainObject(x) {
    return !!x && typeof x === "object" && Object.getPrototypeOf(x) === Object.prototype;
  }

  function deepClone(obj) {
    // structuredClone が使える環境ならそれ優先
    if (typeof structuredClone === "function") return structuredClone(obj);
    return JSON.parse(JSON.stringify(obj));
  }

  // ---------------------------------------------------------
  // State shape
  // ---------------------------------------------------------
  function createDefaultState() {
    return {
      // 画面状態（title/adv/battle/menu/modal）
      screen: SCREENS.TITLE,

      // 章選択を入れるならここに入る（未選択なら null）
      // 例："chapter5"
      chapterId: null,

      // ADV進行位置（シナリオを入れる段階になったら使う）
      // 例：sceneId="ep5_akau_1", step=42
      pointer: {
        sceneId: null,
        step: 0,
      },

      // 分岐フラグ（膨大シナリオ投入前でも空でOK）
      flags: {},

      // 表示（ADV）
      view: {
        background: {
          main: null,   // 例："hall_01.webp" など（実際は assets.js がsrcを作る）
          front: null,  // 前景が必要になったら
          frontVisible: false,
        },

        // 立ち絵（表情差分なし：1キャラ1枚）
        // file は "アカウ.png" / "コト.png" のようなファイル名 or キャラ名から組み立ててもOK
        characters: {
          self: {
            visible: false,
            name: "",
            file: null, // 例："アカウ.png"
          },
          enemy: {
            visible: false,
            name: "",
            file: null, // 例："コト.png"
            // ミラーはCSS側（.is-mirrored）で実現するので state に持たなくてOK
          },
        },

        // 吹き出し（名前欄必須）
        speech: {
          visible: false,
          // "self" | "enemy"
          side: CHARACTER.sides.SELF,
          name: "",
          text: "",
        },

        // 選択肢（中央に大きく）
        choice: {
          visible: false,
          // [{ id: "A", text: "……" }, ...]
          options: [],
        },
      },

      // 戦闘（盤面1つ）
      battle: {
        active: false,
        score: 0,
        chain: 0,
        // null か 秒数/ミリ秒など（方式は battle.js で決める）
        timeLeft: null,

        // 体力（制限時間は廃止。HPは battle.js が管理）
        hpSelfMax: 100,
        hpEnemyMax: 100,
        hpSelf: 100,
        hpEnemy: 100,

        // 結果（必要なら）
        result: {
          visible: false,
          // "win" | "lose" | "rankA" など（後で決める）
          outcome: null,
          detail: "",
        },
      },

      // 設定（BGM/SEは今は使わなくてもOK。保存互換のため形だけ残す）
      settings: {
        bgmVolume: DEFAULTS.settings.bgmVolume,
        seVolume: DEFAULTS.settings.seVolume,
        textSpeed: DEFAULTS.settings.textSpeed,
      },

      // メタ情報
      meta: {
        createdAt: nowIso(),
        updatedAt: nowIso(),
        appVersion: RP.VERSION.APP_VERSION,
      },
    };
  }

  // ---------------------------------------------------------
  // Validation / Normalization
  // ---------------------------------------------------------
  function validateState(state) {
    const errors = [];

    if (!isPlainObject(state)) {
      errors.push("state is not an object");
      return { ok: false, errors };
    }

    const screenOk = Object.values(SCREENS).includes(state.screen);
    if (!screenOk) errors.push(`invalid screen: ${String(state.screen)}`);

    if (!isPlainObject(state.pointer)) errors.push("pointer is missing or invalid");
    else {
      if (state.pointer.sceneId !== null && typeof state.pointer.sceneId !== "string") {
        errors.push("pointer.sceneId must be string or null");
      }
      if (!Number.isInteger(state.pointer.step) || state.pointer.step < 0) {
        errors.push("pointer.step must be integer >= 0");
      }
    }

    if (!isPlainObject(state.flags)) errors.push("flags must be an object");

    if (!isPlainObject(state.view)) errors.push("view is missing or invalid");
    else {
      const bg = state.view.background;
      if (!isPlainObject(bg)) errors.push("view.background is missing or invalid");

      const chars = state.view.characters;
      if (!isPlainObject(chars)) errors.push("view.characters is missing or invalid");
      else {
        for (const key of ["self", "enemy"]) {
          const c = chars[key];
          if (!isPlainObject(c)) {
            errors.push(`view.characters.${key} is missing or invalid`);
            continue;
          }
          if (typeof c.visible !== "boolean") errors.push(`${key}.visible must be boolean`);
          if (typeof c.name !== "string") errors.push(`${key}.name must be string`);
          if (c.file !== null && typeof c.file !== "string") errors.push(`${key}.file must be string or null`);
        }
      }

      const speech = state.view.speech;
      if (!isPlainObject(speech)) errors.push("view.speech is missing or invalid");
      else {
        if (typeof speech.visible !== "boolean") errors.push("speech.visible must be boolean");
        if (![CHARACTER.sides.SELF, CHARACTER.sides.ENEMY].includes(speech.side)) {
          errors.push("speech.side must be 'self' or 'enemy'");
        }
        if (typeof speech.name !== "string") errors.push("speech.name must be string");
        if (typeof speech.text !== "string") errors.push("speech.text must be string");
      }

      const choice = state.view.choice;
      if (!isPlainObject(choice)) errors.push("view.choice is missing or invalid");
      else {
        if (typeof choice.visible !== "boolean") errors.push("choice.visible must be boolean");
        if (!Array.isArray(choice.options)) errors.push("choice.options must be array");
      }
    }

    if (!isPlainObject(state.battle)) errors.push("battle is missing or invalid");
    else {
      if (typeof state.battle.active !== "boolean") errors.push("battle.active must be boolean");
      if (!Number.isFinite(state.battle.score)) errors.push("battle.score must be number");
      if (!Number.isFinite(state.battle.chain)) errors.push("battle.chain must be number");
      if (state.battle.timeLeft !== null && !Number.isFinite(state.battle.timeLeft)) {
        errors.push("battle.timeLeft must be number or null");
      }
      if (state.battle.hpSelfMax !== null && !Number.isFinite(state.battle.hpSelfMax)) errors.push("battle.hpSelfMax must be number");
      if (state.battle.hpEnemyMax !== null && !Number.isFinite(state.battle.hpEnemyMax)) errors.push("battle.hpEnemyMax must be number");
      if (state.battle.hpSelf !== null && !Number.isFinite(state.battle.hpSelf)) errors.push("battle.hpSelf must be number");
      if (state.battle.hpEnemy !== null && !Number.isFinite(state.battle.hpEnemy)) errors.push("battle.hpEnemy must be number");
      if (!isPlainObject(state.battle.result)) errors.push("battle.result is missing or invalid");
    }

    if (!isPlainObject(state.settings)) errors.push("settings is missing or invalid");
    else {
      for (const k of ["bgmVolume", "seVolume", "textSpeed"]) {
        if (!Number.isFinite(state.settings[k])) errors.push(`settings.${k} must be number`);
      }
    }

    return { ok: errors.length === 0, errors };
  }

  // 不足があっても最低限動く形に“整形”して返す（import時に便利）
  function normalizeState(input) {
    const base = createDefaultState();
    if (!isPlainObject(input)) return base;

    // shallow merge + nested safe merge
    const out = deepClone(base);

    // top-level
    if (Object.values(SCREENS).includes(input.screen)) out.screen = input.screen;
    if (typeof input.chapterId === "string" || input.chapterId === null) out.chapterId = input.chapterId;

    // pointer
    if (isPlainObject(input.pointer)) {
      if (typeof input.pointer.sceneId === "string" || input.pointer.sceneId === null) out.pointer.sceneId = input.pointer.sceneId;
      if (Number.isInteger(input.pointer.step) && input.pointer.step >= 0) out.pointer.step = input.pointer.step;
    }

    // flags
    if (isPlainObject(input.flags)) out.flags = deepClone(input.flags);

    // view
    if (isPlainObject(input.view)) {
      if (isPlainObject(input.view.background)) {
        const bg = input.view.background;
        if (typeof bg.main === "string" || bg.main === null) out.view.background.main = bg.main;
        if (typeof bg.front === "string" || bg.front === null) out.view.background.front = bg.front;
        if (typeof bg.frontVisible === "boolean") out.view.background.frontVisible = bg.frontVisible;
      }

      if (isPlainObject(input.view.characters)) {
        for (const key of ["self", "enemy"]) {
          const c = input.view.characters[key];
          if (!isPlainObject(c)) continue;
          if (typeof c.visible === "boolean") out.view.characters[key].visible = c.visible;
          if (typeof c.name === "string") out.view.characters[key].name = c.name;
          if (typeof c.file === "string" || c.file === null) out.view.characters[key].file = c.file;
        }
      }

      if (isPlainObject(input.view.speech)) {
        const s = input.view.speech;
        if (typeof s.visible === "boolean") out.view.speech.visible = s.visible;
        if ([CHARACTER.sides.SELF, CHARACTER.sides.ENEMY].includes(s.side)) out.view.speech.side = s.side;
        if (typeof s.name === "string") out.view.speech.name = s.name;
        if (typeof s.text === "string") out.view.speech.text = s.text;
      }

      if (isPlainObject(input.view.choice)) {
        const ch = input.view.choice;
        if (typeof ch.visible === "boolean") out.view.choice.visible = ch.visible;
        if (Array.isArray(ch.options)) out.view.choice.options = deepClone(ch.options);
      }
    }

    // battle
    if (isPlainObject(input.battle)) {
      if (typeof input.battle.active === "boolean") out.battle.active = input.battle.active;
      if (Number.isFinite(input.battle.score)) out.battle.score = input.battle.score;
      if (Number.isFinite(input.battle.chain)) out.battle.chain = input.battle.chain;
      if (input.battle.timeLeft === null || Number.isFinite(input.battle.timeLeft)) out.battle.timeLeft = input.battle.timeLeft;
      if (Number.isFinite(input.battle.hpSelfMax)) out.battle.hpSelfMax = input.battle.hpSelfMax;
      if (Number.isFinite(input.battle.hpEnemyMax)) out.battle.hpEnemyMax = input.battle.hpEnemyMax;
      if (Number.isFinite(input.battle.hpSelf)) out.battle.hpSelf = input.battle.hpSelf;
      if (Number.isFinite(input.battle.hpEnemy)) out.battle.hpEnemy = input.battle.hpEnemy;

      if (isPlainObject(input.battle.result)) {
        const r = input.battle.result;
        if (typeof r.visible === "boolean") out.battle.result.visible = r.visible;
        if (typeof r.outcome === "string" || r.outcome === null) out.battle.result.outcome = r.outcome;
        if (typeof r.detail === "string") out.battle.result.detail = r.detail;
      }
    }

    // settings
    if (isPlainObject(input.settings)) {
      for (const k of ["bgmVolume", "seVolume", "textSpeed"]) {
        if (Number.isFinite(input.settings[k])) out.settings[k] = input.settings[k];
      }
    }

    // meta
    out.meta.updatedAt = nowIso();
    out.meta.appVersion = RP.VERSION.APP_VERSION;

    return out;
  }

  function touchUpdatedAt(state) {
    if (isPlainObject(state.meta)) state.meta.updatedAt = nowIso();
  }

  // ---------------------------------------------------------
  // Public export
  // ---------------------------------------------------------
  RP.State = Object.freeze({
    createDefaultState,
    validateState,
    normalizeState,
    deepClone,
    touchUpdatedAt,
  });
})();
