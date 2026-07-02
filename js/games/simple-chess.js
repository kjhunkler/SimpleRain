/* SimpleChess.
 * Phase 2: pond-styled chess board with a pan/zoom/rotate camera that matches
 * the SimpleRain feel. Detailed pieces and interaction arrive in later phases.
 */
(function () {
  "use strict";

  const GAME_ID = "simple-chess";
  const SNAPSHOT_HEARTBEAT_MS = 2500;
  const MAX_RIPPLES = 28;
  const FILES = "abcdefgh";
  const GLYPHS = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
  const START_ROWS = ["rnbqkbnr", "pppppppp", "", "", "", "", "PPPPPPPP", "RNBQKBNR"];
  const LIGHT_SQUARE = "#dce6c4";
  const DARK_SQUARE = "#356b78";
  const FRAME_WOOD = "#4a3a2c";
  const FRAME_EDGE = "#6b573f";
  const LABEL_COLOR = "#e8dfc8";
  const MIN_ZOOM = 0.55;
  const MAX_ZOOM = 3.2;

  function now() { return performance.now(); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function seeded(seed, i) {
    const x = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function create(host, initialState) {
    const canvas = host.canvas;
    const ctx = canvas.getContext("2d");
    const isHost = () => !!host.isHost?.();

    let rafId = 0;
    let W = 0;
    let H = 0;
    let lastHeartbeatAt = 0;
    let lastTapAt = 0;
    let boardGesture = null;
    let ripples = [];
    let state = defaultState();
    const view = { zoom: 1, rot: 0, panX: 0, panY: 0 };
    const activePointers = new Map();
    const padSeed = Math.floor(Math.random() * 1_000_000_000);
    const pads = makePads();

    function defaultState() {
      return {
        game: GAME_ID,
        rev: 0,
        createdAt: Date.now(),
        rows: [...START_ROWS],
        message: "The pond settles into sixty-four squares.",
      };
    }

    function resetHostState() {
      const rev = (state.rev || 0) + 1;
      state = defaultState();
      state.rev = rev;
    }

    function makeSnapshot() {
      return { ...state, full: true };
    }

    function applySnapshot(snapshot) {
      if (!snapshot || snapshot.game !== GAME_ID) return;
      state = { ...defaultState(), ...snapshot };
      if (!Array.isArray(state.rows) || state.rows.length !== 8) state.rows = [...START_ROWS];
    }

    function handleAction(id, input) {
      if (!isHost() || !input || typeof input !== "object") return;
      if (input.type === "reset") resetHostState();
      host.broadcastState(makeSnapshot());
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      W = rect.width;
      H = rect.height;
      const w = Math.max(1, Math.round(W * dpr));
      const h = Math.max(1, Math.round(H * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // ---- camera ----------------------------------------------------------
    // Board space: 8x8 cells, x/y in [0, 8), board centre at (4, 4).

    function baseScale() {
      return Math.max(24, (Math.min(W, H) * 0.86) / 9.7);
    }

    function cellPx() { return baseScale() * view.zoom; }
    function centerX() { return W / 2 + view.panX; }
    function centerY() { return H / 2 + view.panY; }

    function boardToScreen(bx, by) {
      const s = cellPx();
      const gx = (bx - 4) * s;
      const gy = (by - 4) * s;
      const c = Math.cos(view.rot), n = Math.sin(view.rot);
      return { x: centerX() + gx * c - gy * n, y: centerY() + gx * n + gy * c };
    }

    function screenToBoard(px, py) {
      const s = cellPx();
      const dx = px - centerX();
      const dy = py - centerY();
      const c = Math.cos(-view.rot), n = Math.sin(-view.rot);
      return { x: (dx * c - dy * n) / s + 4, y: (dx * n + dy * c) / s + 4 };
    }

    function overFrame(b) {
      const pad = 0.62;
      return b.x >= -pad && b.x < 8 + pad && b.y >= -pad && b.y < 8 + pad;
    }

    function resetView() {
      view.zoom = 1;
      view.rot = 0;
      view.panX = 0;
      view.panY = 0;
    }

    // ---- gestures ---------------------------------------------------------

    function pointerPoint(e) {
      const r = canvas.getBoundingClientRect();
      const touch = e.touches?.[0] || e.changedTouches?.[0] || e;
      return { x: touch.clientX - r.left, y: touch.clientY - r.top };
    }

    function eventPoint(e) {
      if (e.offsetX !== undefined && e.offsetY !== undefined) return { x: e.offsetX, y: e.offsetY };
      return pointerPoint(e);
    }

    function gestureMetrics(points) {
      const a = points[0], b = points[1];
      return {
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        angle: Math.atan2(b.y - a.y, b.x - a.x),
      };
    }

    function startBoardGesture() {
      const points = [...activePointers.values()];
      if (!points.length) return;
      if (points.length >= 2) {
        const g = gestureMetrics(points);
        boardGesture = { mode: "pinch", start: g, zoom: view.zoom, rot: view.rot, panX: view.panX, panY: view.panY };
      } else {
        const p = points[0];
        boardGesture = { mode: "pan", x: p.x, y: p.y, panX: view.panX, panY: view.panY };
      }
    }

    function updateBoardGesture() {
      if (!boardGesture) return;
      const points = [...activePointers.values()];
      if (points.length >= 2) {
        if (boardGesture.mode !== "pinch") startBoardGesture();
        const g = gestureMetrics(points);
        view.zoom = clamp(boardGesture.zoom * (g.dist / boardGesture.start.dist), MIN_ZOOM, MAX_ZOOM);
        view.rot = boardGesture.rot + g.angle - boardGesture.start.angle;
        view.panX = boardGesture.panX + g.cx - boardGesture.start.cx;
        view.panY = boardGesture.panY + g.cy - boardGesture.start.cy;
      } else if (points.length === 1) {
        if (boardGesture.mode !== "pan") startBoardGesture();
        const p = points[0];
        view.panX = boardGesture.panX + p.x - boardGesture.x;
        view.panY = boardGesture.panY + p.y - boardGesture.y;
      }
    }

    function addRipple(bx, by, faint = false) {
      ripples.push({ x: bx, y: by, start: now(), faint });
      if (ripples.length > MAX_RIPPLES) ripples.shift();
    }

    function onPointerDown(e) {
      const p = pointerPoint(e);
      const pointerId = e.pointerId ?? "mouse";
      activePointers.set(pointerId, { x: p.x, y: p.y });
      e.preventDefault();
      if (e.pointerId !== undefined) canvas.setPointerCapture?.(e.pointerId);
      const b = screenToBoard(p.x, p.y);
      addRipple(b.x, b.y);
      if (activePointers.size === 1 && (!e.touches || e.touches.length <= 1)) {
        const t = now();
        if (!overFrame(b) && t - lastTapAt < 320) { resetView(); lastTapAt = 0; }
        else lastTapAt = overFrame(b) ? 0 : t;
      } else {
        lastTapAt = 0;
      }
      startBoardGesture();
    }

    function onPointerMove(e) {
      const pointerId = e.pointerId ?? "mouse";
      if (!activePointers.has(pointerId)) return;
      activePointers.set(pointerId, pointerPoint(e));
      updateBoardGesture();
      if (boardGesture) e.preventDefault();
    }

    function onPointerUp(e) {
      activePointers.delete(e.pointerId ?? "mouse");
      if (e.pointerId !== undefined && canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (!activePointers.size) boardGesture = null;
      else startBoardGesture();
    }

    function onLostPointerCapture(e) {
      activePointers.delete(e.pointerId ?? "mouse");
      if (!activePointers.size) boardGesture = null;
    }

    function onWheel(e) {
      e.preventDefault();
      const p = eventPoint(e);
      const oldZoom = view.zoom;
      const nextZoom = clamp(view.zoom * Math.exp(-e.deltaY * 0.0014), MIN_ZOOM, MAX_ZOOM);
      const k = nextZoom / oldZoom;
      view.panX = p.x - W / 2 - (p.x - W / 2 - view.panX) * k;
      view.panY = p.y - H / 2 - (p.y - H / 2 - view.panY) * k;
      view.zoom = nextZoom;
    }

    function onKeyDown(e) {
      const target = document.activeElement || e.target;
      if (target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      if (e.key === "q" || e.key === "Q") { e.preventDefault(); view.rot -= Math.PI / 12; }
      else if (e.key === "e" || e.key === "E") { e.preventDefault(); view.rot += Math.PI / 12; }
      else if (e.key === "0") { e.preventDefault(); resetView(); }
    }

    // ---- pond ambiance ----------------------------------------------------

    function makePads() {
      const list = [];
      for (let i = 0; i < 11; i++) {
        const angle = seeded(padSeed, i * 7 + 1) * Math.PI * 2;
        const dist = 5.4 + seeded(padSeed, i * 7 + 2) * 2.4;
        list.push({
          x: 4 + Math.cos(angle) * dist,
          y: 4 + Math.sin(angle) * dist,
          r: 0.26 + seeded(padSeed, i * 7 + 3) * 0.34,
          rot: seeded(padSeed, i * 7 + 4) * Math.PI * 2,
          spin: (seeded(padSeed, i * 7 + 5) - 0.5) * 0.00012,
          driftA: seeded(padSeed, i * 7 + 6) * Math.PI * 2,
          driftR: 0.05 + seeded(padSeed, i * 7 + 7) * 0.12,
          driftSpeed: 0.00004 + seeded(padSeed, i * 7 + 8) * 0.00005,
          shade: 0.82 + seeded(padSeed, i * 7 + 9) * 0.3,
        });
      }
      return list;
    }

    function spawnAmbientRipples() {
      if (Math.random() >= 0.03) return;
      const b = screenToBoard(Math.random() * W, Math.random() * H);
      if (!overFrame(b)) addRipple(b.x, b.y, true);
    }

    // ---- drawing ----------------------------------------------------------

    function withCamera(fn) {
      ctx.save();
      ctx.translate(centerX(), centerY());
      ctx.rotate(view.rot);
      fn();
      ctx.restore();
    }

    function drawBackground() {
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "#10283a");
      grad.addColorStop(0.45, "#173d4d");
      grad.addColorStop(1, "#0d202d");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }

    function drawVignette() {
      const r = Math.hypot(W, H) * 0.62;
      const grad = ctx.createRadialGradient(W / 2, H / 2, r * 0.45, W / 2, H / 2, r);
      grad.addColorStop(0, "rgba(4, 12, 18, 0)");
      grad.addColorStop(1, "rgba(4, 12, 18, 0.42)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }

    function drawRipples(ts) {
      const s = cellPx();
      const keep = [];
      for (const ripple of ripples) {
        const t = (ts - ripple.start) / 1400;
        if (t >= 1) continue;
        keep.push(ripple);
        const alpha = (1 - t) * (ripple.faint ? 0.14 : 0.38);
        ctx.strokeStyle = `rgba(180, 226, 244, ${alpha.toFixed(3)})`;
        ctx.lineWidth = Math.max(1, s * 0.028);
        const px = (ripple.x - 4) * s;
        const py = (ripple.y - 4) * s;
        for (let ring = 0; ring < 2; ring++) {
          const radius = (0.14 + t * 0.9) * s * (1 + ring * 0.55);
          ctx.beginPath();
          ctx.arc(px, py, radius, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ripples = keep;
    }

    function drawPads(ts) {
      const s = cellPx();
      for (const pad of pads) {
        const wob = pad.driftA + ts * pad.driftSpeed;
        const px = (pad.x + Math.cos(wob) * pad.driftR - 4) * s;
        const py = (pad.y + Math.sin(wob) * pad.driftR - 4) * s;
        const pr = pad.r * s;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(pad.rot + ts * pad.spin);
        ctx.fillStyle = `rgba(47, 105, 74, ${(0.62 * pad.shade).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, pr, 0.34, Math.PI * 2 - 0.34);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(196, 232, 190, 0.22)";
        ctx.lineWidth = Math.max(1, pr * 0.08);
        ctx.stroke();
        ctx.strokeStyle = "rgba(20, 54, 40, 0.35)";
        ctx.lineWidth = Math.max(0.8, pr * 0.05);
        for (let v = 0; v < 4; v++) {
          const va = 0.75 + v * 1.35;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(va) * pr * 0.82, Math.sin(va) * pr * 0.82);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    function drawRoundRect(x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    }

    function drawFrame() {
      const s = cellPx();
      const pad = s * 0.42;
      const o = -4 * s - pad;
      const size = 8 * s + pad * 2;
      ctx.fillStyle = "rgba(4, 12, 18, 0.34)";
      drawRoundRect(o + s * 0.08, o + s * 0.14, size, size, pad * 1.25);
      ctx.fill();
      const wood = ctx.createLinearGradient(o, o, o + size, o + size);
      wood.addColorStop(0, "#55432f");
      wood.addColorStop(0.5, FRAME_WOOD);
      wood.addColorStop(1, "#3c2f23");
      ctx.fillStyle = wood;
      drawRoundRect(o, o, size, size, pad * 1.25);
      ctx.fill();
      ctx.strokeStyle = FRAME_EDGE;
      ctx.lineWidth = Math.max(1.2, s * 0.05);
      ctx.stroke();
      const labelSize = Math.max(8, pad * 0.56);
      ctx.fillStyle = LABEL_COLOR;
      ctx.font = `700 ${labelSize}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let i = 0; i < 8; i++) {
        const c = (i - 3.5) * s;
        ctx.fillText(FILES[i], c, 4 * s + pad * 0.52);
        ctx.fillText(FILES[i], c, -4 * s - pad * 0.52);
        ctx.fillText(String(8 - i), -4 * s - pad * 0.52, c);
        ctx.fillText(String(8 - i), 4 * s + pad * 0.52, c);
      }
    }

    function drawSquares() {
      const s = cellPx();
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          ctx.fillStyle = (row + col) % 2 === 0 ? LIGHT_SQUARE : DARK_SQUARE;
          ctx.fillRect((col - 4) * s, (row - 4) * s, s + 0.5, s + 0.5);
        }
      }
      const sheen = ctx.createLinearGradient(-4 * s, -4 * s, 4 * s, 4 * s);
      sheen.addColorStop(0, "rgba(255, 255, 255, 0.06)");
      sheen.addColorStop(0.5, "rgba(255, 255, 255, 0)");
      sheen.addColorStop(1, "rgba(9, 26, 34, 0.18)");
      ctx.fillStyle = sheen;
      ctx.fillRect(-4 * s, -4 * s, 8 * s, 8 * s);
    }

    function drawPiece(glyph, isWhite, cx, cy, cell) {
      ctx.beginPath();
      ctx.ellipse(cx, cy + cell * 0.3, cell * 0.3, cell * 0.09, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(6, 16, 22, 0.24)";
      ctx.fill();
      ctx.font = `${Math.round(cell * 0.78)}px "Segoe UI Symbol", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(1.5, cell * 0.05);
      ctx.strokeStyle = isWhite ? "rgba(24, 36, 46, 0.72)" : "rgba(226, 240, 248, 0.5)";
      ctx.strokeText(glyph, cx, cy);
      ctx.fillStyle = isWhite ? "#f2ecd8" : "#1f2d38";
      ctx.fillText(glyph, cx, cy);
    }

    function drawPieces() {
      const s = cellPx();
      const rows = state.rows || START_ROWS;
      for (let row = 0; row < 8; row++) {
        const pieces = rows[row] || "";
        for (let col = 0; col < pieces.length; col++) {
          const letter = pieces[col];
          const glyph = GLYPHS[letter.toLowerCase()];
          if (!glyph) continue;
          drawPiece(glyph, letter === letter.toUpperCase(), (col - 3.5) * s, (row - 3.5) * s - s * 0.03, s);
        }
      }
    }

    function drawBanner() {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#eaf6ff";
      ctx.font = "700 16px system-ui, sans-serif";
      ctx.fillText(state.message || "", W / 2, H - 64);
      ctx.fillStyle = "rgba(199, 222, 234, 0.62)";
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.fillText("Drag to pan · pinch or scroll to zoom · double-tap the water to recentre", W / 2, H - 42);
    }

    function loop(ts) {
      rafId = requestAnimationFrame(loop);
      if (!W || !H) resize();
      drawBackground();
      spawnAmbientRipples();
      withCamera(() => {
        drawRipples(ts);
        drawPads(ts);
        drawFrame();
        drawSquares();
        drawPieces();
      });
      drawVignette();
      drawBanner();
      if (isHost() && ts - lastHeartbeatAt > SNAPSHOT_HEARTBEAT_MS) {
        lastHeartbeatAt = ts;
        host.broadcastState(makeSnapshot());
      }
    }

    return {
      start() {
        resize();
        if (initialState) applySnapshot(initialState);
        else if (isHost()) resetHostState();
        window.addEventListener("resize", resize);
        if (window.PointerEvent) {
          canvas.addEventListener("pointerdown", onPointerDown);
          canvas.addEventListener("pointermove", onPointerMove);
          canvas.addEventListener("pointerup", onPointerUp);
          canvas.addEventListener("pointercancel", onPointerUp);
          canvas.addEventListener("lostpointercapture", onLostPointerCapture);
          canvas.addEventListener("wheel", onWheel, { passive: false });
        } else {
          canvas.addEventListener("touchstart", onPointerDown, { passive: false });
          window.addEventListener("touchmove", onPointerMove, { passive: false });
          window.addEventListener("touchend", onPointerUp);
          window.addEventListener("touchcancel", onPointerUp);
          canvas.addEventListener("mousedown", onPointerDown);
          window.addEventListener("mousemove", onPointerMove);
          window.addEventListener("mouseup", onPointerUp);
          canvas.addEventListener("wheel", onWheel, { passive: false });
        }
        window.addEventListener("keydown", onKeyDown);
        rafId = requestAnimationFrame(loop);
      },
      destroy() {
        cancelAnimationFrame(rafId);
        window.removeEventListener("resize", resize);
        if (window.PointerEvent) {
          canvas.removeEventListener("pointerdown", onPointerDown);
          canvas.removeEventListener("pointermove", onPointerMove);
          canvas.removeEventListener("pointerup", onPointerUp);
          canvas.removeEventListener("pointercancel", onPointerUp);
          canvas.removeEventListener("lostpointercapture", onLostPointerCapture);
          canvas.removeEventListener("wheel", onWheel);
        } else {
          canvas.removeEventListener("touchstart", onPointerDown);
          window.removeEventListener("touchmove", onPointerMove);
          window.removeEventListener("touchend", onPointerUp);
          window.removeEventListener("touchcancel", onPointerUp);
          canvas.removeEventListener("mousedown", onPointerDown);
          window.removeEventListener("mousemove", onPointerMove);
          window.removeEventListener("mouseup", onPointerUp);
          canvas.removeEventListener("wheel", onWheel);
        }
        window.removeEventListener("keydown", onKeyDown);
      },
      onPeerInput(id, input) { handleAction(id, input); },
      onState(snapshot) { applySnapshot(snapshot); },
      getSnapshot() { return makeSnapshot(); },
      onPlayerList() { if (isHost()) host.broadcastState(makeSnapshot()); },
      restart() { if (isHost()) resetHostState(); },
    };
  }

  window.BP2PGames = window.BP2PGames || {};
  window.SimpleChessGame = {
    id: GAME_ID,
    name: "SimpleChess",
    emoji: "♞",
    musicTracks: [],
    create,
  };
  window.BP2PGames[GAME_ID] = window.SimpleChessGame;
})();
