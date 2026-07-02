/* SimpleChess.
 * Phase 3: detailed vector piece sets with snappy pickup/placement on the
 * pond-styled camera board. Rules, seats, and turn order arrive in later phases.
 */
(function () {
  "use strict";

  const GAME_ID = "simple-chess";
  const SNAPSHOT_HEARTBEAT_MS = 2500;
  const MAX_RIPPLES = 28;
  const FILES = "abcdefgh";
  const START_ROWS = ["rnbqkbnr", "pppppppp", "", "", "", "", "PPPPPPPP", "RNBQKBNR"];
  const PIECE_NAMES = { k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" };
  const LIGHT_SQUARE = "#dce6c4";
  const DARK_SQUARE = "#356b78";
  const FRAME_WOOD = "#4a3a2c";
  const FRAME_EDGE = "#6b573f";
  const LABEL_COLOR = "#e8dfc8";
  const MIN_ZOOM = 0.55;
  const MAX_ZOOM = 3.2;
  const SPRITE_UNIT_W = 100;
  const SPRITE_UNIT_H = 122;
  const SPRITE_SCALE = 2.6;

  function now() { return performance.now(); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function seeded(seed, i) {
    const x = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function startingBoard() {
    const board = new Array(64).fill("");
    for (let row = 0; row < 8; row++) {
      const rowStr = START_ROWS[row];
      for (let col = 0; col < rowStr.length; col++) board[row * 8 + col] = rowStr[col];
    }
    return board;
  }

  function isWhitePiece(letter) { return letter === letter.toUpperCase(); }
  function squareName(idx) { return FILES[idx % 8] + String(8 - Math.floor(idx / 8)); }

  // ---- piece sprites ------------------------------------------------------
  // Pieces are drawn once per letter into an offscreen canvas (100x122 unit
  // box, base line at y=112) and scaled onto the board every frame.

  const spriteCache = new Map();

  function pieceSprite(letter) {
    let sprite = spriteCache.get(letter);
    if (!sprite) {
      sprite = renderPieceSprite(letter);
      spriteCache.set(letter, sprite);
    }
    return sprite;
  }

  function renderPieceSprite(letter) {
    const cv = document.createElement("canvas");
    cv.width = Math.round(SPRITE_UNIT_W * SPRITE_SCALE);
    cv.height = Math.round(SPRITE_UNIT_H * SPRITE_SCALE);
    const c = cv.getContext("2d");
    c.scale(SPRITE_SCALE, SPRITE_SCALE);
    c.lineJoin = "round";
    c.lineCap = "round";
    drawPieceArt(c, letter.toLowerCase(), isWhitePiece(letter));
    return cv;
  }

  function piecePalette(white) {
    return white
      ? { top: "#faf4e2", bottom: "#d6c9a2", line: "#41372a", detail: "rgba(65, 55, 42, 0.55)", rim: "rgba(255, 252, 240, 0.85)" }
      : { top: "#41586d", bottom: "#131e28", line: "#0a1118", detail: "rgba(185, 214, 234, 0.42)", rim: "rgba(185, 214, 234, 0.55)" };
  }

  function shapeDone(c, pal, y0, y1) {
    const g = c.createLinearGradient(32, y0, 72, y1);
    g.addColorStop(0, pal.top);
    g.addColorStop(1, pal.bottom);
    c.fillStyle = g;
    c.fill();
    c.lineWidth = 3.4;
    c.strokeStyle = pal.line;
    c.stroke();
  }

  function drawGloss(c, pal, x, y, r) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, pal.rim);
    g.addColorStop(1, "rgba(255, 255, 255, 0)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  }

  function drawBase(c, pal) {
    c.beginPath();
    c.moveTo(20, 100);
    c.quadraticCurveTo(50, 92, 80, 100);
    c.quadraticCurveTo(85, 106, 80, 111);
    c.quadraticCurveTo(50, 117, 20, 111);
    c.quadraticCurveTo(15, 106, 20, 100);
    shapeDone(c, pal, 92, 117);
  }

  function drawPawnArt(c, pal) {
    drawBase(c, pal);
    c.beginPath();
    c.moveTo(36, 100);
    c.quadraticCurveTo(40, 72, 43, 58);
    c.lineTo(57, 58);
    c.quadraticCurveTo(60, 72, 64, 100);
    c.closePath();
    shapeDone(c, pal, 58, 100);
    c.beginPath();
    c.ellipse(50, 57, 13, 5, 0, 0, Math.PI * 2);
    shapeDone(c, pal, 52, 62);
    c.beginPath();
    c.arc(50, 40, 14, 0, Math.PI * 2);
    shapeDone(c, pal, 26, 54);
    drawGloss(c, pal, 45, 34, 6);
  }

  function drawRookArt(c, pal) {
    drawBase(c, pal);
    c.beginPath();
    c.moveTo(35, 100);
    c.lineTo(38, 54);
    c.lineTo(62, 54);
    c.lineTo(65, 100);
    c.closePath();
    shapeDone(c, pal, 54, 100);
    c.beginPath();
    c.moveTo(31, 54);
    c.lineTo(31, 26);
    c.lineTo(41, 26);
    c.lineTo(41, 34);
    c.lineTo(46, 34);
    c.lineTo(46, 26);
    c.lineTo(54, 26);
    c.lineTo(54, 34);
    c.lineTo(59, 34);
    c.lineTo(59, 26);
    c.lineTo(69, 26);
    c.lineTo(69, 54);
    c.closePath();
    shapeDone(c, pal, 26, 54);
    c.strokeStyle = pal.detail;
    c.lineWidth = 2.6;
    c.beginPath();
    c.moveTo(50, 64);
    c.lineTo(50, 78);
    c.stroke();
    drawGloss(c, pal, 43, 32, 6);
  }

  function drawKnightArt(c, pal) {
    drawBase(c, pal);
    c.beginPath();
    c.moveTo(33, 100);
    c.quadraticCurveTo(30, 78, 36, 58);
    c.quadraticCurveTo(28, 56, 21, 48);
    c.quadraticCurveTo(17, 43, 19, 38);
    c.quadraticCurveTo(26, 33, 35, 30);
    c.lineTo(40, 17);
    c.lineTo(46, 27);
    c.lineTo(54, 16);
    c.lineTo(57, 28);
    c.quadraticCurveTo(68, 38, 69, 56);
    c.quadraticCurveTo(70, 78, 67, 100);
    c.closePath();
    shapeDone(c, pal, 16, 100);
    c.fillStyle = pal.line;
    c.beginPath();
    c.arc(33, 40, 2.3, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.arc(23, 42, 1.6, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = pal.detail;
    c.lineWidth = 2.6;
    c.beginPath();
    c.moveTo(58, 34);
    c.quadraticCurveTo(63, 48, 61, 62);
    c.moveTo(61, 44);
    c.quadraticCurveTo(65, 58, 63, 74);
    c.stroke();
    drawGloss(c, pal, 42, 34, 7);
  }

  function drawBishopArt(c, pal) {
    drawBase(c, pal);
    c.beginPath();
    c.moveTo(37, 100);
    c.quadraticCurveTo(42, 76, 44, 62);
    c.lineTo(56, 62);
    c.quadraticCurveTo(58, 76, 63, 100);
    c.closePath();
    shapeDone(c, pal, 62, 100);
    c.beginPath();
    c.ellipse(50, 61, 12, 4.6, 0, 0, Math.PI * 2);
    shapeDone(c, pal, 56, 66);
    c.beginPath();
    c.moveTo(50, 20);
    c.quadraticCurveTo(64, 32, 62, 46);
    c.quadraticCurveTo(60, 56, 50, 58);
    c.quadraticCurveTo(40, 56, 38, 46);
    c.quadraticCurveTo(36, 32, 50, 20);
    shapeDone(c, pal, 20, 58);
    c.strokeStyle = pal.detail;
    c.lineWidth = 2.6;
    c.beginPath();
    c.moveTo(53, 28);
    c.lineTo(44, 44);
    c.stroke();
    c.beginPath();
    c.arc(50, 14, 4.4, 0, Math.PI * 2);
    shapeDone(c, pal, 10, 19);
    drawGloss(c, pal, 45, 32, 6);
  }

  function drawQueenArt(c, pal) {
    drawBase(c, pal);
    c.beginPath();
    c.moveTo(33, 100);
    c.quadraticCurveTo(40, 76, 43, 58);
    c.lineTo(57, 58);
    c.quadraticCurveTo(60, 76, 67, 100);
    c.closePath();
    shapeDone(c, pal, 58, 100);
    c.beginPath();
    c.ellipse(50, 57, 13, 4.8, 0, 0, Math.PI * 2);
    shapeDone(c, pal, 52, 62);
    c.beginPath();
    c.moveTo(36, 54);
    c.lineTo(30, 24);
    c.lineTo(41, 38);
    c.lineTo(50, 18);
    c.lineTo(59, 38);
    c.lineTo(70, 24);
    c.lineTo(64, 54);
    c.closePath();
    shapeDone(c, pal, 18, 54);
    for (const [px, py] of [[30, 24], [50, 18], [70, 24]]) {
      c.beginPath();
      c.arc(px, py, 3.2, 0, Math.PI * 2);
      shapeDone(c, pal, py - 3, py + 3);
    }
    drawGloss(c, pal, 44, 36, 7);
  }

  function drawKingArt(c, pal) {
    drawBase(c, pal);
    c.beginPath();
    c.moveTo(33, 100);
    c.quadraticCurveTo(40, 76, 43, 56);
    c.lineTo(57, 56);
    c.quadraticCurveTo(60, 76, 67, 100);
    c.closePath();
    shapeDone(c, pal, 56, 100);
    c.beginPath();
    c.ellipse(50, 55, 13, 4.8, 0, 0, Math.PI * 2);
    shapeDone(c, pal, 50, 60);
    c.beginPath();
    c.moveTo(37, 52);
    c.quadraticCurveTo(34, 38, 38, 30);
    c.lineTo(62, 30);
    c.quadraticCurveTo(66, 38, 63, 52);
    c.closePath();
    shapeDone(c, pal, 30, 52);
    c.strokeStyle = pal.line;
    c.lineWidth = 5.4;
    c.beginPath();
    c.moveTo(50, 8);
    c.lineTo(50, 26);
    c.moveTo(43, 15);
    c.lineTo(57, 15);
    c.stroke();
    c.strokeStyle = pal.top;
    c.lineWidth = 2.4;
    c.beginPath();
    c.moveTo(50, 8);
    c.lineTo(50, 26);
    c.moveTo(43, 15);
    c.lineTo(57, 15);
    c.stroke();
    drawGloss(c, pal, 44, 36, 7);
  }

  function drawPieceArt(c, type, white) {
    const pal = piecePalette(white);
    if (type === "p") drawPawnArt(c, pal);
    else if (type === "r") drawRookArt(c, pal);
    else if (type === "n") drawKnightArt(c, pal);
    else if (type === "b") drawBishopArt(c, pal);
    else if (type === "q") drawQueenArt(c, pal);
    else drawKingArt(c, pal);
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
    let drag = null;
    let dropAnim = null;
    let glides = [];
    let sinks = [];
    let audioCtx = null;
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
        board: startingBoard(),
        message: "The pond settles into sixty-four squares.",
      };
    }

    function resetHostState() {
      const rev = (state.rev || 0) + 1;
      state = defaultState();
      state.rev = rev;
    }

    function makeSnapshot() {
      return { ...state, board: state.board.slice(), full: true };
    }

    function applySnapshot(snapshot) {
      if (!snapshot || snapshot.game !== GAME_ID) return;
      const before = Array.isArray(state.board) && state.board.length === 64 ? state.board.slice() : null;
      state = { ...defaultState(), ...snapshot };
      if (!Array.isArray(state.board) || state.board.length !== 64) state.board = startingBoard();
      state.board = state.board.map((cell) => (typeof cell === "string" && /^[prnbqk]$/i.test(cell) ? cell : ""));
      if (before) spawnMoveAnimations(before, state.board);
    }

    function spawnMoveAnimations(before, after) {
      if (drag || dropAnim) return;
      const vacated = [];
      const appeared = [];
      for (let i = 0; i < 64; i++) {
        if (before[i] === after[i]) continue;
        if (before[i] && !after[i]) vacated.push(i);
        if (after[i] && before[i] !== after[i]) appeared.push(i);
      }
      if (!appeared.length) return;
      if (appeared.length > 6) { glides = []; sinks = []; return; }
      let moved = false;
      for (const to of appeared) {
        const letter = after[to];
        const fromPos = vacated.findIndex((idx) => before[idx] === letter);
        if (fromPos < 0) continue;
        const from = vacated.splice(fromPos, 1)[0];
        glides.push({ letter, from, to, start: now(), dur: 200 });
        if (before[to]) sinks.push({ letter: before[to], idx: to, start: now(), dur: 260 });
        moved = true;
        if (glides.length >= 6) break;
      }
      if (moved) playSound(sinks.length ? "capture" : "place", 0.55);
    }

    function handleAction(id, input) {
      if (!isHost() || !input || typeof input !== "object") return;
      if (input.type === "reset") resetHostState();
      else if (input.type === "move") {
        const from = input.from | 0;
        const to = input.to | 0;
        const letter = state.board[from];
        const captured = state.board[to];
        applyMove(from, to);
        if (id !== host.myId && letter && state.board[to] === letter) {
          glides.push({ letter, from, to, start: now(), dur: 200 });
          if (captured) sinks.push({ letter: captured, idx: to, start: now(), dur: 260 });
          playSound(captured ? "capture" : "place", 0.55);
        }
      }
      host.broadcastState(makeSnapshot());
    }

    function applyMove(from, to) {
      if (from < 0 || from > 63 || to < 0 || to > 63 || from === to) return;
      const letter = state.board[from];
      if (!letter) return;
      const captured = state.board[to];
      state.board[to] = letter;
      state.board[from] = "";
      state.rev = (state.rev || 0) + 1;
      const color = isWhitePiece(letter) ? "White" : "Black";
      state.message = captured
        ? `${color} ${PIECE_NAMES[letter.toLowerCase()]} takes on ${squareName(to)}.`
        : `${color} ${PIECE_NAMES[letter.toLowerCase()]} glides to ${squareName(to)}.`;
    }

    function sendMove(from, to) {
      if (isHost()) {
        handleAction(host.myId, { type: "move", from, to });
      } else {
        applyMove(from, to);
        host.sendInput({ type: "move", from, to });
      }
    }

    function playSound(kind, gainMul = 1) {
      try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
        const t = audioCtx.currentTime;
        const tones = {
          pickup: [[520, 0.09, 0.020], [700, 0.12, 0.012]],
          place: [[330, 0.10, 0.026], [440, 0.16, 0.018]],
          capture: [[220, 0.16, 0.030], [160, 0.22, 0.024], [440, 0.10, 0.012]],
          reset: [[260, 0.18, 0.020], [390, 0.24, 0.018]],
        };
        for (const [freq, dur, vol] of tones[kind] || tones.place) {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, t);
          osc.frequency.exponentialRampToValueAtTime(freq * 0.82, t + dur);
          gain.gain.setValueAtTime(vol * gainMul, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(t);
          osc.stop(t + dur);
        }
      } catch {}
    }

    function easeOutCubic(t) { return 1 - Math.pow(1 - clamp(t, 0, 1), 3); }

    function squareIndexAt(bx, by) {
      const col = Math.floor(bx);
      const row = Math.floor(by);
      if (col < 0 || col > 7 || row < 0 || row > 7) return -1;
      return row * 8 + col;
    }

    function squareCenter(idx) {
      return { x: (idx % 8) + 0.5, y: Math.floor(idx / 8) + 0.5 };
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
      if (drag) { e.preventDefault(); return; }
      const p = pointerPoint(e);
      const pointerId = e.pointerId ?? "mouse";
      e.preventDefault();
      const b = screenToBoard(p.x, p.y);
      const idx = squareIndexAt(b.x, b.y);
      const letter = idx >= 0 ? state.board[idx] : "";
      if (letter && !activePointers.size && !dropAnim) {
        if (e.pointerId !== undefined) canvas.setPointerCapture?.(e.pointerId);
        const touch = (e.pointerType || (e.touches ? "touch" : "mouse")) === "touch";
        drag = { pointerId, letter, from: idx, bx: b.x, by: b.y, start: now(), lift: touch ? 0.52 : 0.14 };
        addRipple(b.x, b.y);
        playSound("pickup");
        lastTapAt = 0;
        return;
      }
      activePointers.set(pointerId, { x: p.x, y: p.y });
      if (e.pointerId !== undefined) canvas.setPointerCapture?.(e.pointerId);
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
      if (drag && pointerId === drag.pointerId) {
        e.preventDefault();
        const p = pointerPoint(e);
        const b = screenToBoard(p.x, p.y);
        drag.bx = b.x;
        drag.by = b.y;
        return;
      }
      if (!activePointers.has(pointerId)) return;
      activePointers.set(pointerId, pointerPoint(e));
      updateBoardGesture();
      if (boardGesture) e.preventDefault();
    }

    function onPointerUp(e) {
      const pointerId = e.pointerId ?? "mouse";
      if (drag && pointerId === drag.pointerId) {
        e.preventDefault();
        finishDrag(true);
        if (e.pointerId !== undefined && canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
        return;
      }
      activePointers.delete(pointerId);
      if (e.pointerId !== undefined && canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (!activePointers.size) boardGesture = null;
      else startBoardGesture();
    }

    function onLostPointerCapture(e) {
      const pointerId = e.pointerId ?? "mouse";
      if (drag && pointerId === drag.pointerId) { finishDrag(false); return; }
      activePointers.delete(pointerId);
      if (!activePointers.size) boardGesture = null;
    }

    function dragLift(ts) {
      if (!drag) return 0;
      return drag.lift * easeOutCubic((ts - drag.start) / 130);
    }

    function finishDrag(commit) {
      if (!drag) return;
      const held = drag;
      drag = null;
      const lift = held.lift * easeOutCubic((now() - held.start) / 130);
      const dropX = held.bx;
      const dropY = held.by - lift;
      const target = commit ? squareIndexAt(dropX, dropY) : -1;
      const canMove = target >= 0 && target !== held.from && !!state.board[held.from];
      const to = canMove ? target : held.from;
      const captured = canMove ? state.board[to] : "";
      dropAnim = { letter: held.letter, to, x0: dropX, y0: dropY, start: now(), dur: 150, captured: !!captured };
      if (canMove) {
        if (captured) sinks.push({ letter: captured, idx: to, start: now(), dur: 260 });
        sendMove(held.from, to);
      }
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
      else if (e.key === "Escape" && drag) { e.preventDefault(); finishDrag(false); }
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

    function drawSquareGlow(idx, style, width) {
      const s = cellPx();
      const col = idx % 8;
      const row = Math.floor(idx / 8);
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.strokeRect((col - 4) * s + width / 2, (row - 4) * s + width / 2, s - width, s - width);
    }

    function drawHighlights(ts) {
      if (!drag) return;
      const lift = dragLift(ts);
      const idx = squareIndexAt(drag.bx, drag.by - lift);
      drawSquareGlow(drag.from, "rgba(180, 226, 244, 0.5)", Math.max(1.6, cellPx() * 0.045));
      if (idx >= 0 && idx !== drag.from) {
        const pulse = 0.62 + Math.sin(ts * 0.012) * 0.18;
        drawSquareGlow(idx, `rgba(140, 232, 188, ${pulse.toFixed(3)})`, Math.max(2, cellPx() * 0.07));
      }
    }

    function drawPieceShadow(bx, by, s, scale, lift) {
      const px = (bx - 4) * s;
      const py = (by - 4) * s;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-view.rot);
      ctx.beginPath();
      ctx.ellipse(0, s * 0.34, s * 0.30 * scale * (1 + lift * 0.4), s * 0.10 * scale, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(6, 16, 22, ${(0.26 / (1 + lift * 1.6)).toFixed(3)})`;
      ctx.fill();
      ctx.restore();
    }

    function drawPieceSprite(letter, bx, by, scale = 1, alpha = 1) {
      const s = cellPx();
      const sprite = pieceSprite(letter);
      const dw = s * 1.04 * scale;
      const dh = dw * (SPRITE_UNIT_H / SPRITE_UNIT_W);
      const px = (bx - 4) * s;
      const py = (by - 4) * s;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-view.rot);
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, -dw / 2, s * 0.36 - dh * (112 / SPRITE_UNIT_H), dw, dh);
      ctx.restore();
    }

    function drawSinks(ts) {
      const keep = [];
      for (const sink of sinks) {
        const t = (ts - sink.start) / sink.dur;
        if (t >= 1) continue;
        keep.push(sink);
        const c = squareCenter(sink.idx);
        const ease = easeOutCubic(t);
        drawPieceSprite(sink.letter, c.x, c.y + ease * 0.22, 1 - ease * 0.34, 1 - ease);
      }
      sinks = keep;
    }

    function drawPieces(ts) {
      const s = cellPx();
      const skip = new Set();
      if (drag) skip.add(drag.from);
      if (dropAnim) skip.add(dropAnim.to);
      for (const g of glides) skip.add(g.to);
      for (let idx = 0; idx < 64; idx++) {
        const letter = state.board[idx];
        if (!letter || skip.has(idx)) continue;
        const c = squareCenter(idx);
        drawPieceShadow(c.x, c.y, s, 1, 0);
        drawPieceSprite(letter, c.x, c.y);
      }
    }

    function drawGlides(ts) {
      const s = cellPx();
      const keep = [];
      for (const g of glides) {
        const t = (ts - g.start) / g.dur;
        const from = squareCenter(g.from);
        const to = squareCenter(g.to);
        if (t >= 1) {
          addRipple(to.x, to.y, true);
          drawPieceShadow(to.x, to.y, s, 1, 0);
          drawPieceSprite(g.letter, to.x, to.y);
          continue;
        }
        keep.push(g);
        const ease = easeOutCubic(t);
        const bx = from.x + (to.x - from.x) * ease;
        const by = from.y + (to.y - from.y) * ease;
        const hop = Math.sin(Math.PI * ease) * 0.16;
        drawPieceShadow(bx, by, s, 1, hop);
        drawPieceSprite(g.letter, bx, by - hop, 1 + hop * 0.4);
      }
      glides = keep;
    }

    function drawDropAnim(ts) {
      if (!dropAnim) return;
      const s = cellPx();
      const t = (ts - dropAnim.start) / dropAnim.dur;
      const to = squareCenter(dropAnim.to);
      if (t >= 1) {
        addRipple(to.x, to.y);
        playSound(dropAnim.captured ? "capture" : "place");
        const letter = dropAnim.letter;
        dropAnim = null;
        drawPieceShadow(to.x, to.y, s, 1, 0);
        drawPieceSprite(letter, to.x, to.y);
        return;
      }
      const ease = easeOutCubic(t);
      const bx = dropAnim.x0 + (to.x - dropAnim.x0) * ease;
      const by = dropAnim.y0 + (to.y - dropAnim.y0) * ease;
      const scale = 1.12 - ease * 0.12;
      drawPieceShadow(bx, by, s, scale, 1 - ease);
      drawPieceSprite(dropAnim.letter, bx, by, scale);
    }

    function drawDragPiece(ts) {
      if (!drag) return;
      const s = cellPx();
      const lift = dragLift(ts);
      const wob = Math.sin(ts * 0.006) * 0.012;
      drawPieceShadow(drag.bx, drag.by, s, 1.12, lift + 0.2);
      drawPieceSprite(drag.letter, drag.bx + wob, drag.by - lift, 1.14);
    }

    function drawBanner() {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#eaf6ff";
      ctx.font = "700 16px system-ui, sans-serif";
      ctx.fillText(state.message || "", W / 2, H - 64);
      ctx.fillStyle = "rgba(199, 222, 234, 0.62)";
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.fillText("Drag a piece to move it · drag the water to pan · pinch or scroll to zoom", W / 2, H - 42);
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
        drawHighlights(ts);
        drawSinks(ts);
        drawPieces(ts);
        drawGlides(ts);
        drawDropAnim(ts);
        drawDragPiece(ts);
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
