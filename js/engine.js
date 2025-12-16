/* =========================================================
   engine.js
   - 司令塔：画面遷移・ADV進行
   - 章選択に「デモ：アカウ vs コト」を追加
   - data/scenario/*.json を fetch してシナリオをロード（失敗時は内蔵デモへフォールバック）
   ========================================================= */

(() => {
  "use strict";

  const RP = (window.RP = window.RP || {});
  if (!RP.CONST) throw new Error("RP.CONST not found. Load constants.js first.");
  if (!RP.State) throw new Error("RP.State not found. Load state.js first.");
  if (!RP.UI) throw new Error("RP.UI not found. Load ui.js first.");

  const { SCREENS, LAYERS } = RP.CONST;

  // ---------------------------------------------------------
  // Chapter list (章選択)
  // ---------------------------------------------------------
  const CHAPTERS = Object.freeze([
    { choiceId: "ep5", chapterId: "chapter5", title: "EP5（第五章 PART1）" },
  ]);

  // ---------------------------------------------------------
  // Scenario JSON paths (GitHub Pages / ローカルサーバで動作)
  // ※ file:// 直開きだと fetch が失敗する環境があるため、その場合はフォールバックします。
  // ---------------------------------------------------------
  const SCENARIO_PATHS = Object.freeze({
    demo_akau_vs_koto: "./data/scenario/demo_akau_vs_koto.json",
    chapter5: "./data/scenario/chapter5_part1.json",
  });

  // ---------------------------------------------------------
  // Minimal built-in demo scripts (fallback)
  // ---------------------------------------------------------
  const DEMO = Object.freeze({
    demo_akau_vs_koto: [
      {
        type: "line",
        bg: "礼拝所.jpg",
        self: { name: "アカウ", file: "アカウ.png", visible: true },
        enemy: { name: "コト", file: "コト.png", visible: true },
        speech: { side: "self", name: "アカウ", text: "……静かな礼拝所。だけど、あなたの視線だけはうるさい。" },
      },
      {
        type: "line",
        speech: { side: "enemy", name: "コト", text: "嫉妬？いいえ、確認よ。あなたが彼の隣に立つ“理由”があるのかどうか。" },
      },
      {
        type: "line",
        speech: { side: "self", name: "アカウ", text: "理由ならある。わたしが守ると決めた人だから。" },
      },
      {
        type: "line",
        speech: { side: "enemy", name: "コト", text: "なら、奪ってみなさい。——ここで。" },
      },
      {
        type: "line",
        speech: { side: "self", name: "System", text: "（ぷよぷよ風バトル開始）" },
      },
      { type: "battle", enemyName: "コト" },
      {
        type: "line",
        speech: { side: "self", name: "アカウ", text: "はぁ……決着はついた。これ以上、彼に近づくな。" },
      },
      {
        type: "line",
        speech: { side: "enemy", name: "コト", text: "……かわいいのね。あなたの愛。" },
      },
      { type: "end" },
    ],

    chapter5: [
      {
        type: "line",
        bg: null,
        self: { name: "アカウ", file: "アカウ.png", visible: true },
        enemy: { name: "タネイ", file: "タネイ.png", visible: false },
        speech: { side: "self", name: "アカウ", text: "（ここに第五章のシナリオが入ります）" },
      },
      {
        type: "line",
        enemy: { name: "コト", file: "コト.png", visible: true },
        speech: { side: "enemy", name: "コト", text: "（選択肢やイベント、演出を後で差し込めます）" },
      },
      { type: "battle" },
      { type: "line", speech: { side: "self", name: "アカウ", text: "（戦闘結果を受けて、ここからADVへ戻る）" } },
      { type: "end" },
    ],

    chapter6: [
      { type: "line", self: { name: "アカウ", file: "アカウ.png", visible: true }, speech: { side: "self", name: "アカウ", text: "（ここに第六章のシナリオが入ります）" } },
      { type: "battle" },
      { type: "end" },
    ],

    chapter7: [
      { type: "line", self: { name: "アカウ", file: "アカウ.png", visible: true }, speech: { side: "self", name: "アカウ", text: "（ここに第七章のシナリオが入ります）" } },
      { type: "end" },
    ],
  });

  // chapterId -> nodes[]
  const scenarioCache = new Map();
  const scenarioIdMapCache = new Map();

  function buildIdMap(nodes = []) {
    const m = new Map();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n && typeof n.id === "string" && n.id) m.set(n.id, i);
    }
    return m;
  }

  function getNodeIndexById(chapterId, nodeId) {
    if (!chapterId || !nodeId) return null;
    const m = scenarioIdMapCache.get(chapterId);
    if (!m) return null;
    return m.has(nodeId) ? m.get(nodeId) : null;
  }

  function renderNodeAtIndex(s, script, index, depth = 0) {
    // 防御：無限gotoを防ぐ
    if (depth > 8) {
      s.view.speech.visible = true;
      s.view.speech.side = "self";
      s.view.speech.name = "System";
      s.view.speech.text = "シナリオ遷移がループしました（goto）。";
      setState(s);
      return;
    }

    const node = script[index];
    if (!node || !node.type) {
      setState(s);
      return;
    }

    // index は「現在位置」として保存（次クリックで index+1 が読まれる）
    s.pointer.step = index;

    if (node.type === "line") {
      applyNodeToState(s, node);
      setState(s);
      return;
    }

    if (node.type === "battle") {
      setState(s);
      startBattle(node);
      return;
    }

    if (node.type === "end") {
      gotoTitle(false);
      return;
    }

    if (node.type === "goto") {
      const targetId = node.target || node.to || node.idRef || null;
      const ti = getNodeIndexById(s.chapterId, targetId);
      if (ti === null) {
        s.view.speech.visible = true;
        s.view.speech.side = "self";
        s.view.speech.name = "System";
        s.view.speech.text = `goto先が見つかりません: ${String(targetId)}`;
        setState(s);
        return;
      }
      return renderNodeAtIndex(s, script, ti, depth + 1);
    }

    // unknown type -> ignore
    setState(s);
  }

  let warnedFetchForFileScheme = false;

  async function loadScenarioNodes(chapterId) {
    if (scenarioCache.has(chapterId)) return scenarioCache.get(chapterId);

    const path = SCENARIO_PATHS[chapterId];
    if (path) {
      try {
        const res = await fetch(encodeURI(path), { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const json = await res.json();
        const nodes = Array.isArray(json) ? json : (Array.isArray(json?.nodes) ? json.nodes : null);
        if (!Array.isArray(nodes)) throw new Error("Scenario JSON must be an array or {nodes:[...]}");
        scenarioCache.set(chapterId, nodes);
        scenarioIdMapCache.set(chapterId, buildIdMap(nodes));
        return nodes;
      } catch (e) {
        // file:// 直開きだと失敗する環境が多いので、一度だけ案内する
        if (location.protocol === "file:" && !warnedFetchForFileScheme) {
          warnedFetchForFileScheme = true;
          RP.UI.showModal({
            title: "シナリオ読み込みについて",
            message:
              "ローカルで file:// 直開きしている場合、JSON読み込み(fetch)が失敗することがあります。\n\n" +
              "開発中はローカルサーバで開くのがおすすめです。\n" +
              "例：\n" +
              "  • VSCode: Live Server\n" +
              "  • Python:  python -m http.server 8000\n" +
              "    → http://localhost:8000/ を開く\n\n" +
              "今回は内蔵デモに切り替えて続行します。",
            okText: "OK",
          });
        } else {
          console.warn("[engine] failed to fetch scenario:", e);
        }

        if (DEMO[chapterId]) {
          scenarioCache.set(chapterId, DEMO[chapterId]);
          scenarioIdMapCache.set(chapterId, buildIdMap(DEMO[chapterId]));
          return DEMO[chapterId];
        }
      }
    }

    // fallback
    if (DEMO[chapterId]) {
      scenarioCache.set(chapterId, DEMO[chapterId]);
      scenarioIdMapCache.set(chapterId, buildIdMap(DEMO[chapterId]));
      return DEMO[chapterId];
    }

    return null;
  }

  // ---------------------------------------------------------
  // Engine internal runtime flags (not saved)
  // ---------------------------------------------------------
  const runtime = {
    mode: "idle", // idle | chapterSelect | loadingScenario | adv | battle
    lastBattleBranch: null, // { onWin?: string, onLose?: string }
  };

  // ---------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------
  function getState() {
    return RP.UI.getState();
  }

  function setState(next) {
    RP.UI.setState(next);
  }

  function deepClone(state) {
    return RP.State.deepClone(state);
  }

  function isOverlayBlockingInput() {
    const menu = document.getElementById(LAYERS.menu);
    const modal = document.getElementById(LAYERS.modal);
    const menuOpen = menu && !menu.classList.contains("is-hidden");
    const modalOpen = modal && !modal.classList.contains("is-hidden");
    return !!(menuOpen || modalOpen);
  }

  function isChoiceOpen(state) {
    return !!state?.view?.choice?.visible;
  }

  function getChapterTitle(chapterId) {
    return CHAPTERS.find((c) => c.chapterId === chapterId)?.title ?? chapterId;
  }

  function currentScript(state) {
    const chapterId = state.chapterId;
    if (!chapterId) return null;
    return scenarioCache.get(chapterId) ?? null;
  }

  function clearChoice(state) {
    state.view.choice.visible = false;
    state.view.choice.options = [];
  }

  function showChapterSelect() {
    const s = RP.State.createDefaultState();
    s.screen = SCREENS.ADV;

    // 章選択：中央に大きく
    s.view.choice.visible = true;
    s.view.choice.options = CHAPTERS.map((c) => ({ id: c.choiceId, text: c.title }));

    // 初期：吹き出しは出さない（選択肢に集中）
    s.view.speech.visible = false;
    s.view.speech.name = "";
    s.view.speech.text = "";

    // 立ち絵は任意：何も出さなくてもOK
    s.view.characters.self.visible = false;
    s.view.characters.enemy.visible = false;

    runtime.mode = "chapterSelect";
    setState(s);
  }

  function applyNodeToState(state, node) {
    clearChoice(state);

    // background
    if (Object.prototype.hasOwnProperty.call(node, "bg")) {
      state.view.background.main = node.bg; // null OK
    }

    // characters
    if (node.self) {
      state.view.characters.self.visible = !!node.self.visible;
      state.view.characters.self.name = node.self.name ?? state.view.characters.self.name ?? "";
      state.view.characters.self.file = node.self.file ?? state.view.characters.self.file ?? null;
    }
    if (node.enemy) {
      state.view.characters.enemy.visible = !!node.enemy.visible;
      state.view.characters.enemy.name = node.enemy.name ?? state.view.characters.enemy.name ?? "";
      state.view.characters.enemy.file = node.enemy.file ?? state.view.characters.enemy.file ?? null;
    }

    // speech
    if (node.speech) {
      state.view.speech.visible = true;
      state.view.speech.side = node.speech.side || "self";
      state.view.speech.name = node.speech.name ?? "";
      state.view.speech.text = node.speech.text ?? "";
    } else {
      state.view.speech.visible = false;
      state.view.speech.name = "";
      state.view.speech.text = "";
    }
  }

  function gotoTitle(confirm = false) {
    if (confirm) {
      RP.UI.showModal({
        title: "確認",
        message: "タイトルへ戻りますか？",
        okText: "戻る",
        cancelText: "キャンセル",
        onOk: () => gotoTitle(false),
      });
      return;
    }

    const s = deepClone(getState());
    s.screen = SCREENS.TITLE;
    runtime.mode = "idle";
    setState(s);
  }

  function startChapter(chapterId) {
    // "読み込み中" を出して入力を止める
    const s = deepClone(getState());
    s.screen = SCREENS.ADV;
    s.chapterId = chapterId;
    s.pointer.sceneId = chapterId;
    s.pointer.step = 0;
    clearChoice(s);

    s.view.speech.visible = true;
    s.view.speech.side = "self";
    s.view.speech.name = "System";
    s.view.speech.text = "読み込み中…";

    runtime.mode = "loadingScenario";
    setState(s);

    // 非同期ロード
    loadScenarioNodes(chapterId)
      .then((nodes) => {
        const s2 = deepClone(getState());
        const script = nodes;
        if (!script || script.length === 0) {
          s2.view.speech.visible = true;
          s2.view.speech.side = "self";
          s2.view.speech.name = "System";
          s2.view.speech.text = `${getChapterTitle(chapterId)} のデータが見つかりません`;
          runtime.mode = "adv";
          setState(s2);
          return;
        }

        // 初期ノード表示
        s2.pointer.step = 0;
        runtime.mode = "adv";

        const node = script[0];
        if (node?.type === "line") {
          applyNodeToState(s2, node);
          setState(s2);
          return;
        }

        setState(s2);
        advance();
      })
      .catch((e) => {
        console.error(e);
        const s2 = deepClone(getState());
        s2.view.speech.visible = true;
        s2.view.speech.side = "self";
        s2.view.speech.name = "System";
        s2.view.speech.text = `読み込みに失敗しました：${String(e?.message ?? e)}`;
        runtime.mode = "adv";
        setState(s2);
      });
  }

  function advance() {
    const s0 = getState();

    if (isOverlayBlockingInput()) return;
    if (runtime.mode === "chapterSelect") return;
    if (runtime.mode === "loadingScenario") return;
    if (s0.screen !== SCREENS.ADV) return;
    if (isChoiceOpen(s0)) return;

    const s = deepClone(s0);

    // 未ロードの場合は章選択へ（または読み込みを促す）
    if (s.chapterId && !scenarioCache.has(s.chapterId)) {
      startChapter(s.chapterId);
      return;
    }

    const script = currentScript(s);
    if (!script) {
      showChapterSelect();
      return;
    }

    const nextIndex = (Number.isInteger(s.pointer.step) ? s.pointer.step : 0) + 1;

    if (nextIndex >= script.length) {
      s.view.speech.visible = true;
      s.view.speech.side = "self";
      s.view.speech.name = "System";
      s.view.speech.text = "（この章のデモはここまで。タイトルへ戻ります）";
      s.pointer.step = script.length;
      setState(s);
      return;
    }

    renderNodeAtIndex(s, script, nextIndex);
    return;
  }

  function startBattle(node = null) {
    const s = deepClone(getState());
    s.screen = SCREENS.BATTLE;
    runtime.mode = "battle";

    // remember branching (optional)
    runtime.lastBattleBranch = node ? { onWin: node.onWin || null, onLose: node.onLose || null } : null;

    // reset battle state
    s.battle.active = true;
    s.battle.score = 0;
    s.battle.chain = 0;
    s.battle.timeLeft = null;

    s.battle.result.visible = false;
    s.battle.result.outcome = null;
    s.battle.result.detail = "";

    // 任意：敵名などを state に保存したい場合（battle.js が参照できる）
    if (node && typeof node.enemyName === "string") {
      s.battle.enemyName = node.enemyName;
    }

    setState(s);

    // battle.js が RP.Battle.start を提供しているなら呼ぶ（提供していないなら何もしない）
    try {
      if (RP.Battle && typeof RP.Battle.start === "function") {
        RP.Battle.start();
      }
    } catch (e) {
      console.warn("[engine] RP.Battle.start failed:", e);
    }
  }

  function showBattleResult(outcome, detail) {
    const s = deepClone(getState());
    if (s.screen !== SCREENS.BATTLE) return;

    s.battle.result.visible = true;
    s.battle.result.outcome = outcome ?? "RESULT";
    s.battle.result.detail = detail ?? "";

    setState(s);
  }

  function finishBattleAndReturn() {
    const s0 = getState();
    if (s0.screen !== SCREENS.BATTLE) return;

    const outcome = s0.battle?.result?.outcome || null;
    const branch = runtime.lastBattleBranch;
    runtime.lastBattleBranch = null;

    const s = deepClone(s0);
    s.screen = SCREENS.ADV;
    runtime.mode = "adv";

    // battle result reset
    s.battle.result.visible = false;
    s.battle.result.outcome = null;
    s.battle.result.detail = "";

    const script = currentScript(s);

    // branch if scenario asked so
    if (branch && script && (outcome === "WIN" || outcome === "LOSE")) {
      const targetId = outcome === "WIN" ? branch.onWin : branch.onLose;
      const ti = targetId ? getNodeIndexById(s.chapterId, targetId) : null;
      if (ti !== null) {
        renderNodeAtIndex(s, script, ti);
        return;
      }
    }

    setState(s);

    // 戻ったら次のノードへ
    advance();
  }

  // ---------------------------------------------------------
  // Event wiring with UI
  // ---------------------------------------------------------
  function wireUiEvents() {
    RP.UI.on("newGame", () => startNewGame());

    RP.UI.on("choice", ({ id }) => {
      if (runtime.mode === "chapterSelect") {
        const c = CHAPTERS.find((x) => x.choiceId === id);
        if (!c) return;
        startChapter(c.chapterId);
        return;
      }

      // future: normal choices (branching)
      const s = deepClone(getState());
      s.view.choice.visible = false;
      s.view.choice.options = [];
      setState(s);
      advance();
    });

    RP.UI.on("battleContinue", () => finishBattleAndReturn());

    RP.UI.on("stateLoaded", () => {
      const s = getState();
      if (s.screen === SCREENS.TITLE) runtime.mode = "idle";
      else if (s.screen === SCREENS.BATTLE) runtime.mode = "battle";
      else if (s.screen === SCREENS.ADV) runtime.mode = s.chapterId ? "adv" : "chapterSelect";

      // ロードした章のシナリオは裏でプリロード（失敗してもフォールバックする）
      if (s.screen === SCREENS.ADV && s.chapterId) {
        loadScenarioNodes(s.chapterId).catch(() => {});
      }
    });

    RP.UI.on("backToTitle", () => {
      runtime.mode = "idle";
    });
  }

  // ---------------------------------------------------------
  // Input (minimal until input.js arrives)
  // ---------------------------------------------------------
  function wireAdvanceInput() {
    const hotspot = document.getElementById(RP.CONST.DOM.adv.advanceHotspot);
    if (hotspot) {
      hotspot.addEventListener("click", () => advance());
    }

    window.addEventListener("keydown", (ev) => {
      const tag = (ev.target && ev.target.tagName) ? ev.target.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea") return;

      if (isOverlayBlockingInput()) return;

      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        advance();
      }
    });
  }

  // ---------------------------------------------------------
  // Public API
  // ---------------------------------------------------------
  function startNewGame() {
    showChapterSelect();
  }

  function init() {
    wireUiEvents();
    wireAdvanceInput();

    const s = getState();
    if (s.screen === SCREENS.TITLE) runtime.mode = "idle";
    else if (s.screen === SCREENS.BATTLE) runtime.mode = "battle";
    else if (s.screen === SCREENS.ADV) runtime.mode = s.chapterId ? "adv" : "chapterSelect";
  }

  RP.Engine = Object.freeze({
    init,
    startNewGame,
    advance,
    startBattle,
    showBattleResult,
    finishBattleAndReturn,
    gotoTitle,
  });

  document.addEventListener("DOMContentLoaded", () => {
    try { init(); } catch (e) { console.error(e); }
  });
})();
