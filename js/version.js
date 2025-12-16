/* =========================================================
   version.js
   - セーブ互換のためのバージョン管理
   - 将来セーブ形式が変わっても「読み込み→移行」できる土台
   - bundler無し（scriptタグ直読み）前提：window.RP にぶら下げる
   ========================================================= */

(() => {
  "use strict";

  const RP = (window.RP = window.RP || {});

  // ---------------------------------------------------------
  // App / Save versions
  // ---------------------------------------------------------
  // アプリ側（表示用）：厳密に使わなくてもOK
  const APP_VERSION = "0.1.0";

  // セーブデータ形式のバージョン（ここが最重要）
  // 形式を破壊する変更（キー名変更・構造変更）をしたら +1
  const SAVE_VERSION = 1;

  // ---------------------------------------------------------
  // Migration framework
  // ---------------------------------------------------------
  // migrateSaveObject(saveObj) は「読み込んだセーブ」を最新形式へ変換して返す
  // まだ SAVE_VERSION=1 なので実質 no-op だけど、先に枠だけ用意しておく
  function migrateSaveObject(saveObj) {
    // セーブっぽくない入力は弾く（save.js側でもチェックする想定）
    if (!saveObj || typeof saveObj !== "object") {
      throw new Error("Invalid save: not an object");
    }

    // 旧形式は saveVersion が無い可能性があるので 0 扱い
    let v = Number.isInteger(saveObj.saveVersion) ? saveObj.saveVersion : 0;

    // 未来のバージョンのセーブを読み込もうとした場合
    if (v > SAVE_VERSION) {
      throw new Error(
        `Save is newer than this game (saveVersion=${v}, supported=${SAVE_VERSION})`
      );
    }

    // v -> v+1 -> ... -> SAVE_VERSION と段階的に移行
    while (v < SAVE_VERSION) {
      const step = MIGRATIONS[v];
      if (typeof step !== "function") {
        throw new Error(`Missing migration step for version ${v} -> ${v + 1}`);
      }
      saveObj = step(saveObj);
      v = Number.isInteger(saveObj.saveVersion) ? saveObj.saveVersion : (v + 1);
    }

    return saveObj;
  }

  // ---------------------------------------------------------
  // Migration steps
  // ---------------------------------------------------------
  // key: 「現在の saveVersion」
  // value: 「次の saveVersion へ上げる関数」
  const MIGRATIONS = Object.freeze({
    // 0 -> 1: 初期形式へ整形（今後、saveVersion無しの古いデータ対策用）
    0: (s) => {
      const out = { ...s };

      // 最低限必須：saveVersion を付与
      out.saveVersion = 1;

      // 任意のメタ（あとで便利）
      if (!out.meta || typeof out.meta !== "object") out.meta = {};
      if (typeof out.meta.appVersion !== "string") out.meta.appVersion = APP_VERSION;
      if (typeof out.meta.createdAt !== "string") out.meta.createdAt = new Date().toISOString();

      return out;
    },
  });

  // ---------------------------------------------------------
  // Public export
  // ---------------------------------------------------------
  RP.VERSION = Object.freeze({
    APP_VERSION,
    SAVE_VERSION,
    migrateSaveObject,
  });
})();
