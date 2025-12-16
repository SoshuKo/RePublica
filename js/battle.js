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
  });

  // 色（描画用）
  const COLOR_PALETTE = Object.freeze([
    null,
    "#ff5b5b", // 1 red
    "#4dd7ff", // 2 cyan
    "#ffd34d", // 3 yellow
    "#a7ff5b", // 4 green
    "#c58bff", // 5 purple (COLORS=5にした時用)
  ]);

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

    chainLast: 0,     // 直近連鎖（HUD用）
    selfHp: CFG.SELF_HP,
    enemyHp: CFG.ENEMY_HP,
    totalDamage: 0,

    gameOver: false,
    victory: false,
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
    return !!(menuOpen || modalOpen);
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

    // resolve
    resolveChains();
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
        if (v === 0 || visited[y][x]) continue;

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

  function syncHudToState() {
    // score=総ダメージ, chain=直近連鎖, timeLeft=敵HP
    const s0 = getState();
    const s = RP.State.deepClone(s0);

    s.battle.active = true;
    s.battle.score = game.totalDamage;
    s.battle.chain = game.chainLast;
    s.battle.timeLeft = null;
    s.battle.hpSelfMax = CFG.SELF_HP;
    s.battle.hpEnemyMax = CFG.ENEMY_HP;
    s.battle.hpSelf = game.selfHp;
    s.battle.hpEnemy = game.enemyHp;

    RP.State.touchUpdatedAt(s);
    setState(s);
  }

  function showResult(isWin) {
    // リザルト表示（続けるボタンで engine.js が復帰処理）
    const s0 = getState();
    const s = RP.State.deepClone(s0);

    s.battle.active = false;
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

  function resolveChains() {
    if (game.inResolve) return;
    game.inResolve = true;

    // まず落下を安定させる
    applyGravityBoard();

    let chain = 0;

    while (true) {
      const groups = findGroupsToPop();
      if (groups.length === 0) break;

      chain++;
      const popped = popGroups(groups);
      applyGravityBoard();

      const damage = computeDamage(chain, groups.length);
      const scoreAdd = computeScore(popped, chain);

      game.chainLast = chain;
      game.totalDamage += damage;
      game.enemyHp = Math.max(0, game.enemyHp - damage);

      // ヒット演出（ぬるっと）
      hitFx("enemy", damage, chain);

      // HUD反映（チェーンごと）
      syncHudToState();

      // 敵HPチェック
      if (game.enemyHp <= 0) {
        game.victory = true;
        showResult(true);
        game.inResolve = false;
        return;
      }

      // 次の連鎖段へ
      void scoreAdd; // 将来スコア表示を増やすならここ
    }

    game.inResolve = false;
    spawnIfNeeded();
  }

  // ---------------------------
  // Rendering
  // ---------------------------
  function draw() {
    if (!ctx || !canvas) return;

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
    game.board = newEmptyBoard();
    game.piece = null;
    game.next = { a: randColor(), b: randColor() };

    game.chainLast = 0;
    game.selfHp = CFG.SELF_HP;
    game.enemyHp = CFG.ENEMY_HP;
    game.totalDamage = 0;

    game.gameOver = false;
    game.victory = false;
    game.inResolve = false;

    spawnIfNeeded();
    syncHudToState();
  }

  function ensureRunningIfBattle() {
    if (!ctx || !canvas) return;

    const s = getState();
    const shouldRun = s && s.screen === SCREENS.BATTLE && !s?.battle?.result?.visible;

    if (shouldRun && !running) {
      // entering battle
      resetBattleRuntime();
      running = true;
      lastTs = 0;
      fallAcc = 0;
    }

    if (!shouldRun && running) {
      // leaving battle or result open
      running = false;
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
