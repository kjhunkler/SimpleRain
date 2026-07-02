/* SimpleChess.
 * Phase 1 scaffold: pond-styled placeholder board, host-owned state stub, and the
 * standard app-shell game contract. Camera, pieces, and rules arrive in later phases.
 */
(function () {
  "use strict";

  const GAME_ID = "simple-chess";
  const SNAPSHOT_HEARTBEAT_MS = 2500;
  const MAX_RIPPLES = 24;
  const FILES = "abcdefgh";
  const GLYPHS = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
  const START_ROWS = ["rnbqkbnr", "pppppppp", "", "", "", "", "PPPPPPPP", "RNBQKBNR"];
  const LIGHT_SQUARE = "#dce6c4";
  const DARK_SQUARE = "#356b78";
  const FRAME_WOOD = "#4a3a2c";
  const FRAME_EDGE = "#6b573f";
  const LABEL_COLOR = "#e8dfc8";

  function now() { return performance.now(); }

  function create(host, initialState) {
    const canvas = host.canvas;
    const ctx = canvas.getContext("2d");
    const isHost = () => !!host.isHost?.();

    let rafId = 0;
    let W = 0;
    let H = 0;
    let lastHeartbeatAt = 0;
    let ripples = [];
    let state = defaultState();

    function defaultState() {
      return {
        game: GAME_ID,
        rev: 0,
        createdAt: Date.now(),
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

    function boardRect() {
      const size = Math.min(W, H) * 0.74;
      return { size, x: (W - size) / 2, y: (H - size) / 2 - H * 0.03 };
    }

    function pointFromEvent(e) {
      const touch = e.touches?.[0] || e.changedTouches?.[0];
      if (touch) {
        const r = canvas.getBoundingClientRect();
        return { x: touch.clientX - r.left, y: touch.clientY - r.top };
      }
      if (e.offsetX !== undefined && e.offsetY !== undefined) return { x: e.offsetX, y: e.offsetY };
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function onPointerDown(e) {
      const p = pointFromEvent(e);
      ripples.push({ x: p.x, y: p.y, start: now() });
      if (ripples.length > MAX_RIPPLES) ripples.shift();
    }

    function drawBackground(ts) {
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "#10283a");
      grad.addColorStop(0.45, "#173d4d");
      grad.addColorStop(1, "#0d202d");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      if (Math.random() < 0.028) {
        ripples.push({ x: Math.random() * W, y: Math.random() * H, start: ts, faint: true });
        if (ripples.length > MAX_RIPPLES) ripples.shift();
      }
    }

    function drawRipples(ts) {
      const keep = [];
      for (const ripple of ripples) {
        const t = (ts - ripple.start) / 1400;
        if (t >= 1) continue;
        keep.push(ripple);
        const alpha = (1 - t) * (ripple.faint ? 0.16 : 0.4);
        ctx.strokeStyle = `rgba(180, 226, 244, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 1.6;
        for (let ring = 0; ring < 2; ring++) {
          const radius = (10 + t * 64) * (1 + ring * 0.55);
          ctx.beginPath();
          ctx.ellipse(ripple.x, ripple.y, radius, radius * 0.62, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ripples = keep;
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

    function drawFrame(board) {
      const pad = board.size * 0.045;
      const x = board.x - pad;
      const y = board.y - pad;
      const size = board.size + pad * 2;
      ctx.fillStyle = FRAME_WOOD;
      drawRoundRect(x, y, size, size, pad * 1.2);
      ctx.fill();
      ctx.strokeStyle = FRAME_EDGE;
      ctx.lineWidth = 2;
      ctx.stroke();
      const labelSize = Math.max(9, pad * 0.62);
      ctx.fillStyle = LABEL_COLOR;
      ctx.font = `700 ${labelSize}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const cell = board.size / 8;
      for (let i = 0; i < 8; i++) {
        ctx.fillText(FILES[i], board.x + cell * (i + 0.5), board.y + board.size + pad * 0.52);
        ctx.fillText(String(8 - i), board.x - pad * 0.52, board.y + cell * (i + 0.5));
      }
    }

    function drawSquares(board) {
      const cell = board.size / 8;
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          ctx.fillStyle = (row + col) % 2 === 0 ? LIGHT_SQUARE : DARK_SQUARE;
          ctx.fillRect(board.x + col * cell, board.y + row * cell, cell + 0.5, cell + 0.5);
        }
      }
      const sheen = ctx.createLinearGradient(board.x, board.y, board.x + board.size, board.y + board.size);
      sheen.addColorStop(0, "rgba(255, 255, 255, 0.05)");
      sheen.addColorStop(0.5, "rgba(255, 255, 255, 0)");
      sheen.addColorStop(1, "rgba(9, 26, 34, 0.16)");
      ctx.fillStyle = sheen;
      ctx.fillRect(board.x, board.y, board.size, board.size);
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

    function drawPieces(board) {
      const cell = board.size / 8;
      for (let row = 0; row < 8; row++) {
        const pieces = START_ROWS[row];
        for (let col = 0; col < pieces.length; col++) {
          const letter = pieces[col];
          const glyph = GLYPHS[letter.toLowerCase()];
          if (!glyph) continue;
          const cx = board.x + cell * (col + 0.5);
          const cy = board.y + cell * (row + 0.5) - cell * 0.03;
          drawPiece(glyph, letter === letter.toUpperCase(), cx, cy, cell);
        }
      }
    }

    function drawBanner(board) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#eaf6ff";
      ctx.font = "700 16px system-ui, sans-serif";
      ctx.fillText(state.message || "", W / 2, board.y + board.size + Math.min(H * 0.07, 52));
      ctx.fillStyle = "rgba(199, 222, 234, 0.62)";
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.fillText("SimpleChess · Phase 1 scaffold — pieces awaken soon", W / 2, board.y + board.size + Math.min(H * 0.07, 52) + 20);
    }

    function loop(ts) {
      rafId = requestAnimationFrame(loop);
      if (!W || !H) resize();
      drawBackground(ts);
      drawRipples(ts);
      const board = boardRect();
      drawFrame(board);
      drawSquares(board);
      drawPieces(board);
      drawBanner(board);
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
        } else {
          canvas.addEventListener("touchstart", onPointerDown, { passive: true });
          canvas.addEventListener("mousedown", onPointerDown);
        }
        rafId = requestAnimationFrame(loop);
      },
      destroy() {
        cancelAnimationFrame(rafId);
        window.removeEventListener("resize", resize);
        if (window.PointerEvent) {
          canvas.removeEventListener("pointerdown", onPointerDown);
        } else {
          canvas.removeEventListener("touchstart", onPointerDown);
          canvas.removeEventListener("mousedown", onPointerDown);
        }
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
