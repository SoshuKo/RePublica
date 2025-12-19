/* =========================================================
   constants.js
   - プロジェクト全体で共通に使う「定数」と「ID/パスの約束」を集約
   - bundler無し（scriptタグ直読み）前提：window.RP にぶら下げる
   ========================================================= */

(() => {
  "use strict";

  // 既存があれば再利用（他ファイルと衝突しないための名前空間）
  const RP = (window.RP = window.RP || {});

  // ---------------------------------------------------------
  // App / Stage
  // ---------------------------------------------------------
  const APP = Object.freeze({
    title: "Re: Publica",
    stage: Object.freeze({
      width: 1280,
      height: 720,
      aspect: "16:9",
    }),
  });

  // ---------------------------------------------------------
  // Layer / Screen IDs
  // ---------------------------------------------------------
  const LAYERS = Object.freeze({
    overlay: "overlayLayer",
    title: "titleLayer",
    adv: "advLayer",
    battle: "battleLayer",
    arena: "arenaLayer",
    menu: "menuLayer",
    modal: "modalLayer",
    debug: "debugPanel",

    // sub layers
    choice: "choiceLayer",
    battleResult: "battleResult",
  });

  // ゲーム内の画面状態（state.screen などで使う想定）
  const SCREENS = Object.freeze({
    TITLE: "title",
    ADV: "adv",
    BATTLE: "battle",
    ARENA: "arena",
    MENU: "menu",
    MODAL: "modal",
  });

  // ---------------------------------------------------------
  // DOM Element IDs (buttons, inputs, key nodes)
  // ---------------------------------------------------------
  const DOM = Object.freeze({
    root: Object.freeze({
      app: "app",
      gameRoot: "gameRoot",
      viewport: "gameViewport",
    }),

    title: Object.freeze({
      newGame: "btnNewGame",
      continueJson: "btnContinue",
      arena: "btnArena",
      importFile: "importFileInput",
      settings: "btnSettingsFromTitle",
      credits: "btnCredits",
    }),


    arena: Object.freeze({
      back: "btnArenaBackToTitle",
      start: "btnArenaStart",

      playerGrid: "arenaPlayerGrid",
      enemyGrid: "arenaEnemyGrid",

      playerPreviewImg: "arenaPlayerPreviewImg",
      enemyPreviewImg: "arenaEnemyPreviewImg",

      playerName: "arenaPlayerName",
      enemyName: "arenaEnemyName",

      playerSkillName: "arenaPlayerSkillName",
      playerSkillDesc: "arenaPlayerSkillDesc",
      enemyHint: "arenaEnemyHint",
    }),

    adv: Object.freeze({
      bgMain: "bgMain",
      bgFront: "bgFront",
      // characters
      charSelfImg: "charSelfImg",
      charEnemyImg: "charEnemyImg",
      bubbleSelf: "bubbleSelf",
      bubbleEnemy: "bubbleEnemy",
      nameSelf: "nameSelf",
      nameEnemy: "nameEnemy",
      textSelf: "textSelf",
      textEnemy: "textEnemy",
      // choices
      choiceList: "choiceList",
      advanceHotspot: "advanceHotspot",
    }),

    battle: Object.freeze({
      canvas: "battleCanvas",
      score: "battleScore",
      time: "battleTime",
      chain: "battleChain",

      // battle side UI
      charSelfImg: "battleCharSelfImg",
      charEnemyImg: "battleCharEnemyImg",
      hpSelfFill: "battleHpSelfFill",
      hpEnemyFill: "battleHpEnemyFill",
      hpSelfText: "battleHpSelfText",
      hpEnemyText: "battleHpEnemyText",
      floatLayer: "battleFloatLayer",

      resultTitle: "battleResultTitle",
      resultDetail: "battleResultDetail",
      resultContinue: "btnBattleContinue",
    }),

    menu: Object.freeze({
      close: "btnCloseMenu",
      backToTitle: "btnBackToTitle",

      save1: "btnSaveSlot1",
      save2: "btnSaveSlot2",
      save3: "btnSaveSlot3",

      load1: "btnLoadSlot1",
      load2: "btnLoadSlot2",
      load3: "btnLoadSlot3",

      exportJson: "btnExportJson",
      importJson: "btnImportJson",
      importFile: "importFileInputMenu",

      optBgmVol: "optBgmVolume",
      optSeVol: "optSeVolume",
      optTextSpeed: "optTextSpeed",

      // Mobile (virtual buttons)
      optVirtualButtons: "optVirtualButtons",
    }),

    modal: Object.freeze({
      title: "modalTitle",
      message: "modalMessage",
      ok: "modalOk",
      cancel: "modalCancel",
    }),

    overlay: Object.freeze({
      fade: "screenFade",
    }),
  });

  // ---------------------------------------------------------
  // Input bindings (統一したい操作を先に定義)
  // ---------------------------------------------------------
  const INPUT = Object.freeze({
    // キーボード
    keys: Object.freeze({
      advance: ["Enter", " "],       // 次へ（Enter/Space）
      menu: ["Escape"],             // メニュー
      // 使うなら後で追加：skip / auto / backlog etc
      // skip: ["Control"],
      // auto: ["a", "A"],
      // log: ["l", "L"],
    }),

    // クリック/タップ
    pointer: Object.freeze({
      advanceTargetId: DOM.adv.advanceHotspot, // 画面全体クリック領域
    }),
  });

  // ---------------------------------------------------------
  // Assets (パスの約束)
  // ---------------------------------------------------------
  const ASSET_DIR = Object.freeze({
    root: "./assets",
    bg: "./assets/bg",
    char: "./assets/char",
    ui: "./assets/ui",
    battle: "./assets/battle",
    bgm: "./assets/bgm",
    se: "./assets/se",
    data: "./data",
  });

  // 日本語ファイル名を含むURLでも安全に扱えるようにするためのヘルパ（constants側に置いてOK）
  // 例：ASSET.path(ASSET_DIR.char, "アカウ.png")
  const ASSET = Object.freeze({
    // dir + filename -> エンコード済みURL（GitHub Pagesでも安定しやすい）
    path(dir, filename) {
      // filename に "/" が含まれていてもOK
      return encodeURI(`${dir}/${filename}`);
    },

    // キャラ：表情差分なし＝1キャラ1枚想定
    // name は「アカウ」「コト」等の“下の名前日本語”を想定
    charPng(name) {
      return encodeURI(`${ASSET_DIR.char}/${name}.png`);
    },

    // 例：ASSET.charVariant("アカウ", "怒") -> ./assets/char/アカウ_怒.png
    //     ASSET.charVariant("アカウ", "")   -> ./assets/char/アカウ.png
    charVariant(name, expr) {
      const e = (expr && String(expr).trim()) ? `_${String(expr).trim()}` : "";
      return encodeURI(`${ASSET_DIR.char}/${name}${e}.png`);
    },

    // 背景：拡張子は運用で統一推奨（png/jpg/webp）
    bgFile(filename) {
      return encodeURI(`${ASSET_DIR.bg}/${filename}`);
    },
  });

  // ---------------------------------------------------------
  // Character display rules
  // ---------------------------------------------------------
  const CHARACTER = Object.freeze({
    sides: Object.freeze({
      SELF: "self",
      ENEMY: "enemy",
    }),

    // 素材は全部「左向き」前提：相手側は画像だけ左右反転（CSSで対応済み）
    render: Object.freeze({
      selfMirrored: false,
      enemyMirrored: true,
    }),

    // 立ち絵スロット（今回は左右2人のみ運用）
    slots: Object.freeze({
      self: Object.freeze({
        imgId: DOM.adv.charSelfImg,
        bubbleId: DOM.adv.bubbleSelf,
        nameId: DOM.adv.nameSelf,
        textId: DOM.adv.textSelf,
      }),
      enemy: Object.freeze({
        imgId: DOM.adv.charEnemyImg,
        bubbleId: DOM.adv.bubbleEnemy,
        nameId: DOM.adv.nameEnemy,
        textId: DOM.adv.textEnemy,
      }),
    }),
  });

  // ---------------------------------------------------------
  // Defaults (設定の初期値)
  // ---------------------------------------------------------
  const DEFAULTS = Object.freeze({
    settings: Object.freeze({
      // 0.0 - 1.0（UIスライダーは 0-100 を想定）
      bgmVolume: 0.7,
      seVolume: 0.8,
      textSpeed: 0.5,

      // モバイル用：戦闘時の仮想ボタンを表示するか
      virtualButtons: false,
    }),

    save: Object.freeze({
      slots: 3,
      // localStorageを使う場合のキーの接頭辞（save.jsで利用）
      storageKeyPrefix: "republica_save_",
      settingsKey: "republica_settings",
    }),

    battle: Object.freeze({
      // 盤面は1つ（対戦風ではない）
      boardCount: 1,
      // canvas内部解像度（HTML側の width/height と一致）
      canvasInternalSize: 720,
    }),
  });

  // ---------------------------------------------------------
  // Public export (freeze to prevent accidental mutation)
  // ---------------------------------------------------------
  RP.CONST = Object.freeze({
    APP,
    LAYERS,
    SCREENS,
    DOM,
    INPUT,
    ASSET_DIR,
    ASSET,
    CHARACTER,
    DEFAULTS,
  });
})();
