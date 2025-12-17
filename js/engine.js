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
    { choiceId: "ep5", chapterId: "chapter5", title: "EP5（PART1）" },
    { choiceId: "ep5p2", chapterId: "chapter5_part2", title: "EP5（PART2）" },
    { choiceId: "ep5p3", chapterId: "chapter5_part3", title: "EP5（PART3）" },
    { choiceId: "ep5p4", chapterId: "chapter5_part4", title: "EP5（PART4）" },
    { choiceId: "ep5p5", chapterId: "chapter5_part5", title: "EP5（PART5）" },
  ]);

  // ---------------------------------------------------------
  // Scenario JSON paths (GitHub Pages / ローカルサーバで動作)
  // ※ file:// 直開きだと fetch が失敗する環境があるため、その場合はフォールバックします。
  // ---------------------------------------------------------
  const SCENARIO_PATHS = Object.freeze({
    demo_akau_vs_koto: "./data/scenario/demo_akau_vs_koto.json",
    chapter5: "./data/scenario/chapter5_part1.json",
    chapter5_part2: "./data/scenario/chapter5_part2.json",
    chapter5_part3: "./data/scenario/chapter5_part3.json",
    chapter5_part4: "./data/scenario/chapter5_part4.json",
    chapter5_part5: "./data/scenario/chapter5_part5.json",
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

  async function renderNodeAtIndex(s, script, index, depth = 0) {
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
    const prevBg = s.view.background.main;
    const nextBg = Object.prototype.hasOwnProperty.call(node, "bg") ? node.bg : prevBg;
    const needsFade = nextBg !== prevBg;

    if (needsFade) {
      await withFade(260, () => {
        applyNodeToState(s, node);
        setState(s);
      });
    } else {
      applyNodeToState(s, node);
      setState(s);
    }
    return;
  }

  if (node.type === "battle") {
    await withFade(220, () => startBattle(node));
    return;
  }

  if (node.type === "end") {
    await withFade(220, () => gotoTitle(false));
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

    await renderNodeAtIndex(s, script, ti, depth + 1);
    return;
  }



  if (node.type === "chapter") {
    const targetChapterId = node.chapterId || node.chapter || node.toChapter || node.to || null;
    const startId = node.start || node.startId || node.targetId || "start";

    if (!targetChapterId) {
      s.view.speech.visible = true;
      s.view.speech.side = "self";
      s.view.speech.name = "System";
      s.view.speech.text = "chapter遷移の chapterId が指定されていません。";
      setState(s);
      return;
    }

    runtime.mode = "loadingScenario";

    const nextScript = await loadScenarioNodes(targetChapterId);
    if (!nextScript || nextScript.length === 0) {
      s.view.speech.visible = true;
      s.view.speech.side = "self";
      s.view.speech.name = "System";
      s.view.speech.text = `${getChapterTitle(targetChapterId)} のデータが見つかりません`;
      runtime.mode = "adv";
      setState(s);
      return;
    }

    // stateを次章へ切替
    s.chapterId = targetChapterId;
    s.pointer.sceneId = targetChapterId;
    clearChoice(s);
    s.screen = SCREENS.ADV;

    let startIndex = 0;
    const ti = getNodeIndexById(targetChapterId, startId);
    if (ti !== null) startIndex = ti;

    // 章切替は常にフェード（先頭のlineで二重フェードしないよう bg を先に合わせる）
    const first = nextScript[startIndex];
    if (first && first.type === "line" && Object.prototype.hasOwnProperty.call(first, "bg")) {
      s.view.background.main = first.bg;
      s.view.background.front = null;
      s.view.background.frontVisible = false;
    }

    runtime.mode = "adv";
    await withFade(260, async () => {
      await renderNodeAtIndex(s, nextScript, startIndex);
    });
    return;
  }

  // unknown type
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
    transitioning: false, // 追加
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

    function resolveCharFileFromNode(charNode, prevCharState) {
    // 優先：明示file（手動指定したい人用）
    if (charNode && typeof charNode.file === "string" && charNode.file.trim()) {
      return charNode.file.trim(); // "アカウ_怒.png" みたいなのもOK
    }

    // 表情だけ指定したい時があるので、nameは「ノード」→なければ「前状態」
    const baseName =
      (charNode && typeof charNode.name === "string" && charNode.name.trim())
        ? charNode.name.trim()
        : (prevCharState?.name || "").trim();

    if (!baseName) {
      // 何も特定できないなら現状維持
      return prevCharState?.file ?? null;
    }

    const expr =
      (charNode && typeof charNode.expr === "string") ? charNode.expr.trim() : "";

    // 命名規則どおりに組み立て（拡張子はpng固定運用）
    // constants.js に charVariant を足した場合：
    return `${baseName}${expr ? "_" + expr : ""}.png`;

    // もし constants.js を触りたくないなら、代わりにこれでもOK：
    // return `${baseName}${expr ? "_" + expr : ""}.png`;
  }


  function applyNodeToState(state, node) {
    clearChoice(state);

    // background
    if (Object.prototype.hasOwnProperty.call(node, "bg")) {
      state.view.background.main = node.bg; // null OK
    }

    if (node.self) {
      const prev = state.view.characters.self;

      // visibleは「指定があれば」反映。省略時は維持（表情だけ変えるノードで便利）
      if (Object.prototype.hasOwnProperty.call(node.self, "visible")) {
        prev.visible = !!node.self.visible;
      }

      if (typeof node.self.name === "string") {
        prev.name = node.self.name;
      }

      // fileは expr / name から生成（明示fileがあればそれ優先）
      prev.file = resolveCharFileFromNode(node.self, prev);
    }

    if (node.enemy) {
      const prev = state.view.characters.enemy;

      if (Object.prototype.hasOwnProperty.call(node.enemy, "visible")) {
        prev.visible = !!node.enemy.visible;
      }

      if (typeof node.enemy.name === "string") {
        prev.name = node.enemy.name;
      }

      prev.file = resolveCharFileFromNode(node.enemy, prev);
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

        // 初期ノード表示（ここも renderNodeAtIndex に統一）
      s2.pointer.step = 0;
      runtime.mode = "adv";
      Promise.resolve(renderNodeAtIndex(s2, script, 0)).catch(console.error);
      return;

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
    if (runtime.transitioning) return;

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

    Promise.resolve(renderNodeAtIndex(s, script, nextIndex)).catch(console.error);

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

    async function withFade(ms, action) {
    if (!RP.Transitions) { action(); return; }
    runtime.transitioning = true;
    await RP.Transitions.fadeOut(ms);
    const r = action();
    if (r && typeof r.then === "function") await r;
    await RP.Transitions.fadeIn(ms);
    runtime.transitioning = false;
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
