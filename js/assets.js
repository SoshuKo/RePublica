/* =========================================================
   assets.js
   - 画像リソース管理（都度ロード + メモリキャッシュ）
   - 日本語ファイル名対応（encodeURI）
   - missing/読み込み失敗時はプレースホルダに差し替え可能
   - 音（BGM/SE）は未対応：将来 audio.js 側で拡張
   - bundler無し（scriptタグ直読み）前提：window.RP にぶら下げる
   ========================================================= */

(() => {
  "use strict";

  const RP = (window.RP = window.RP || {});
  if (!RP.CONST) throw new Error("RP.CONST not found. Load constants.js first.");

  const { ASSET_DIR, ASSET } = RP.CONST;

  // ---------------------------------------------------------
  // Internal caches
  // ---------------------------------------------------------
  // url(normalized) -> { status, img?, promise?, error? }
  const _imgCache = new Map();

  const _stats = {
    requested: 0,
    loaded: 0,
    failed: 0,
    cacheHit: 0,
  };

  // ---------------------------------------------------------
  // URL utilities
  // ---------------------------------------------------------
  function normalizeUrl(url) {
    if (!url) return null;
    const s = String(url);

    // keep these as-is
    if (
      s.startsWith("data:") ||
      s.startsWith("blob:") ||
      s.startsWith("http://") ||
      s.startsWith("https://")
    ) {
      return s;
    }

    // Prevent issues with Japanese filenames / spaces etc.
    // encodeURI does NOT double-encode existing %xx sequences.
    return encodeURI(s);
  }

  function hasImageExt(s) {
    return typeof s === "string" && /\.(png|webp|jpg|jpeg|gif)$/i.test(s);
  }

  // ---------------------------------------------------------
  // Placeholder (data URL)
  // ---------------------------------------------------------
  // A lightweight “missing asset” placeholder so the game doesn’t go blank.
  function makePlaceholderDataUrl(label = "missing") {
    const w = 512, h = 512;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");

    // background
    ctx.fillStyle = "#0d0f14";
    ctx.fillRect(0, 0, w, h);

    // pattern
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = "#77aaff";
    ctx.lineWidth = 8;
    for (let i = -w; i < w * 2; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + h, h);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // frame
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 6;
    ctx.strokeRect(16, 16, w - 32, h - 32);

    // text
    ctx.fillStyle = "rgba(255,255,255,0.86)";
    ctx.font = "700 34px system-ui, -apple-system, Segoe UI, Hiragino Sans, Noto Sans JP, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const t1 = "ASSET";
    const t2 = "NOT FOUND";
    const t3 = String(label).slice(0, 30);

    ctx.fillText(t1, w / 2, h / 2 - 50);
    ctx.fillText(t2, w / 2, h / 2);
    ctx.font = "600 20px system-ui, -apple-system, Segoe UI, Hiragino Sans, Noto Sans JP, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.fillText(t3, w / 2, h / 2 + 56);

    return canvas.toDataURL("image/png");
  }

  const PLACEHOLDER = Object.freeze({
    dataUrl: makePlaceholderDataUrl("asset"),
    forLabel: (label) => makePlaceholderDataUrl(label),
  });

  // ---------------------------------------------------------
  // Core image loader
  // ---------------------------------------------------------
  function loadImage(url, options = {}) {
    const normalized = normalizeUrl(url);
    if (!normalized) return Promise.reject(new Error("No URL"));

    const cached = _imgCache.get(normalized);
    if (cached) {
      _stats.cacheHit++;
      if (cached.status === "loaded" && cached.img) return Promise.resolve(cached.img);
      if (cached.status === "loading" && cached.promise) return cached.promise;
      // failed: try again only if options.retry === true
      if (cached.status === "failed" && !options.retry) {
        return Promise.reject(cached.error || new Error("Image failed previously"));
      }
    }

    _stats.requested++;

    const p = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";

      // If you ever need crossOrigin for CDN: options.crossOrigin = "anonymous"
      if (options.crossOrigin) img.crossOrigin = options.crossOrigin;

      img.onload = () => {
        _imgCache.set(normalized, { status: "loaded", img });
        _stats.loaded++;
        resolve(img);
      };
      img.onerror = () => {
        const err = new Error(`Failed to load image: ${normalized}`);
        _imgCache.set(normalized, { status: "failed", error: err });
        _stats.failed++;
        reject(err);
      };

      img.src = normalized;
    });

    _imgCache.set(normalized, { status: "loading", promise: p });
    return p;
  }

  // For callers that want "best effort" (never throws): returns {ok, img?, error?}
  async function tryLoadImage(url, options = {}) {
    try {
      const img = await loadImage(url, options);
      return { ok: true, img };
    } catch (error) {
      return { ok: false, error };
    }
  }

  // Preload a list (best effort). Returns summary.
  async function preloadImages(urls, { onProgress } = {}) {
    const list = Array.isArray(urls) ? urls.filter(Boolean) : [];
    const total = list.length;
    let done = 0;

    const results = await Promise.allSettled(
      list.map(async (u) => {
        const r = await tryLoadImage(u);
        done++;
        if (typeof onProgress === "function") {
          onProgress({ done, total, url: u, ok: r.ok });
        }
        return r;
      })
    );

    const ok = results.filter((x) => x.status === "fulfilled" && x.value.ok).length;
    const failed = total - ok;

    return { total, ok, failed };
  }

  // ---------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------
  // Sets an <img> element safely:
  // - if url is null => clears src
  // - if load fails => sets placeholder
  async function setImageElement(imgEl, url, { fallbackLabel } = {}) {
    if (!imgEl) return;

    const normalized = normalizeUrl(url);
    if (!normalized) {
      imgEl.removeAttribute("src");
      return;
    }

    // Set immediately (browser will start fetching). We also track with our loader.
    imgEl.src = normalized;

    const r = await tryLoadImage(normalized);
    if (!r.ok) {
      // fallback
      imgEl.src = PLACEHOLDER.forLabel(fallbackLabel || normalized);
    }
  }

  // Attach a one-time onerror fallback to any <img> (useful even without preloading)
  function attachImgFallback(imgEl, labelProvider) {
    if (!imgEl) return;
    const handler = () => {
      const label = typeof labelProvider === "function"
        ? labelProvider(imgEl)
        : (imgEl.getAttribute("src") || "asset");
      imgEl.src = PLACEHOLDER.forLabel(label);
      imgEl.removeEventListener("error", handler);
    };
    imgEl.addEventListener("error", handler, { once: true });
  }

  // ---------------------------------------------------------
  // Resolve helpers (名前 or ファイル名 -> URL)
  // ---------------------------------------------------------
  function resolveChar(input) {
    if (!input) return null;
    const s = String(input);
    // "アカウ.png" / "アカウ.webp" etc
    if (hasImageExt(s)) return ASSET.path(ASSET_DIR.char, s);
    // "アカウ" -> assets/char/アカウ.png
    return ASSET.charPng(s);
  }

  function resolveBg(input) {
    if (!input) return null;
    const s = String(input);
    // allow direct relative with folders
    if (s.includes("/")) return normalizeUrl(s);
    return ASSET.bgFile(s);
  }

  function resolveUi(input) {
    if (!input) return null;
    const s = String(input);
    if (s.includes("/")) return normalizeUrl(s);
    return ASSET.path(ASSET_DIR.ui, s);
  }

  // ---------------------------------------------------------
  // Optional: warm up essential assets (no-op by default)
  // ---------------------------------------------------------
  async function warmup() {
    // ここは「将来」必要になったら足す場所。
    // 例：UIロゴやボタン画像を使うなら preload する。
    return { total: 0, ok: 0, failed: 0 };
  }

  // ---------------------------------------------------------
  // Cache control
  // ---------------------------------------------------------
  function clearCache() {
    _imgCache.clear();
    _stats.requested = 0;
    _stats.loaded = 0;
    _stats.failed = 0;
    _stats.cacheHit = 0;
  }

  function getStats() {
    return { ..._stats, cachedCount: _imgCache.size };
  }

  // ---------------------------------------------------------
  // Public export
  // ---------------------------------------------------------
  RP.Assets = Object.freeze({
    // url
    normalizeUrl,

    // resolve
    resolveChar,
    resolveBg,
    resolveUi,

    // image
    loadImage,
    tryLoadImage,
    preloadImages,

    // dom
    setImageElement,
    attachImgFallback,

    // placeholder
    PLACEHOLDER,

    // misc
    warmup,
    clearCache,
    getStats,
  });
})();
