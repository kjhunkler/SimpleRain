/* ============ 2048 — swipe to merge the numbers ============ */
(function () {
    "use strict";

    const SIZE = 4;

    const TILE_COLORS = {
        2: "#39395f", 4: "#4a4a7a", 8: "#ff8c42", 16: "#ff7043",
        32: "#ff5d7d", 64: "#ff4d8d", 128: "#ffd166", 256: "#ffc14d",
        512: "#5ef58a", 1024: "#39d0ff", 2048: "#8e5bd6"
    };

    function create(host) {
        const canvas = host.canvas;
        const ctx = canvas.getContext("2d");

        let W, H, board, cell, gap, ox, oy;
        let grid, ghosts, score, over, started;
        let rafId, lastTs;
        let touchStartX = 0, touchStartY = 0, touchMoved = false;

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = canvas.clientWidth;
            H = canvas.clientHeight;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            board = Math.min(W - 28, H - 120, 420);
            gap = Math.max(8, board * 0.025);
            cell = (board - gap * (SIZE + 1)) / SIZE;
            ox = (W - board) / 2;
            oy = (H - board) / 2;
        }

        function reset() {
            grid = [];
            for (let r = 0; r < SIZE; r++) grid.push([null, null, null, null]);
            ghosts = [];
            score = 0;
            over = false;
            started = false;
            lastTs = 0;
            spawnTile();
            spawnTile();
            host.setScore(0);
        }

        function spawnTile() {
            const empty = [];
            for (let r = 0; r < SIZE; r++)
                for (let c = 0; c < SIZE; c++)
                    if (!grid[r][c]) empty.push({ c, r });
            if (empty.length === 0) return;
            const spot = empty[Math.floor(Math.random() * empty.length)];
            grid[spot.r][spot.c] = {
                v: Math.random() < 0.9 ? 2 : 4,
                c: spot.c, r: spot.r,
                px: spot.c, py: spot.r,
                pop: 1, merged: false
            };
        }

        function snapAnimations() {
            for (let r = 0; r < SIZE; r++)
                for (let c = 0; c < SIZE; c++)
                    if (grid[r][c]) { grid[r][c].px = c; grid[r][c].py = r; }
            ghosts = [];
        }

        function inBounds(c, r) {
            return c >= 0 && c < SIZE && r >= 0 && r < SIZE;
        }

        function move(dx, dy) {
            if (over) return;
            snapAnimations();

            let moved = false;
            let mergedAny = false;

            const cs = dx === 1 ? [3, 2, 1, 0] : [0, 1, 2, 3];
            const rs = dy === 1 ? [3, 2, 1, 0] : [0, 1, 2, 3];

            for (const r of rs) {
                for (const c of cs) {
                    const tile = grid[r][c];
                    if (!tile) continue;

                    let nc = c, nr = r;
                    while (inBounds(nc + dx, nr + dy) && !grid[nr + dy][nc + dx]) {
                        nc += dx;
                        nr += dy;
                    }

                    const tc = nc + dx, tr = nr + dy;
                    if (inBounds(tc, tr) && grid[tr][tc].v === tile.v && !grid[tr][tc].merged) {
                        // Merge into the neighbor.
                        grid[r][c] = null;
                        const target = grid[tr][tc];
                        target.v *= 2;
                        target.merged = true;
                        target.pop = 1;
                        ghosts.push({ v: tile.v, px: tile.px, py: tile.py, tc: tc, tr: tr });
                        score += target.v;
                        moved = true;
                        mergedAny = true;
                    } else if (nc !== c || nr !== r) {
                        grid[r][c] = null;
                        tile.c = nc;
                        tile.r = nr;
                        grid[nr][nc] = tile;
                        moved = true;
                    }
                }
            }

            for (let r = 0; r < SIZE; r++)
                for (let c = 0; c < SIZE; c++)
                    if (grid[r][c]) grid[r][c].merged = false;

            if (!moved) return;

            started = true;
            host.setScore(score);
            host.vibrate(mergedAny ? 12 : 6);
            SGSound.play(mergedAny ? "match" : "flip");
            spawnTile();

            if (!anyMoves()) {
                over = true;
                host.vibrate([70, 40, 90]);
                setTimeout(() => host.gameOver(score), 500);
            }
        }

        function anyMoves() {
            for (let r = 0; r < SIZE; r++) {
                for (let c = 0; c < SIZE; c++) {
                    const t = grid[r][c];
                    if (!t) return true;
                    if (c < SIZE - 1 && grid[r][c + 1] && grid[r][c + 1].v === t.v) return true;
                    if (r < SIZE - 1 && grid[r + 1][c] && grid[r + 1][c].v === t.v) return true;
                }
            }
            return false;
        }

        function cellPx(c) { return ox + gap + c * (cell + gap); }
        function cellPy(r) { return oy + gap + r * (cell + gap); }

        function update(dt) {
            const speed = Math.min(dt * 16, 1);
            for (let r = 0; r < SIZE; r++) {
                for (let c = 0; c < SIZE; c++) {
                    const t = grid[r][c];
                    if (!t) continue;
                    t.px += (c - t.px) * speed;
                    t.py += (r - t.py) * speed;
                    if (t.pop > 0) t.pop = Math.max(0, t.pop - dt * 3.5);
                }
            }
            for (let i = ghosts.length - 1; i >= 0; i--) {
                const g = ghosts[i];
                g.px += (g.tc - g.px) * speed;
                g.py += (g.tr - g.py) * speed;
                if (Math.abs(g.px - g.tc) < 0.06 && Math.abs(g.py - g.tr) < 0.06) ghosts.splice(i, 1);
            }
        }

        function roundRect(x, y, w, h, r) {
            r = Math.min(r, w / 2, h / 2);
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.arcTo(x + w, y, x + w, y + h, r);
            ctx.arcTo(x + w, y + h, x, y + h, r);
            ctx.arcTo(x, y + h, x, y, r);
            ctx.arcTo(x, y, x + w, y, r);
            ctx.fill();
        }

        function drawTile(px, py, v, pop) {
            const scale = 1 + (pop > 0 ? Math.sin(pop * Math.PI) * 0.12 : 0);
            const s = cell * scale;
            const x = cellPx(px) + (cell - s) / 2;
            const y = cellPy(py) + (cell - s) / 2;

            ctx.fillStyle = TILE_COLORS[v] || "#ffd166";
            roundRect(x, y, s, s, 10);

            ctx.fillStyle = v >= 8 ? "#12121f" : "#f2f3ff";
            const digits = String(v).length;
            const fs = Math.floor(s * (digits <= 2 ? 0.42 : digits === 3 ? 0.34 : 0.27));
            ctx.font = "800 " + fs + "px system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(v, x + s / 2, y + s / 2 + fs * 0.06);
        }

        function draw() {
            const grad = ctx.createLinearGradient(0, 0, 0, H);
            grad.addColorStop(0, "#1b1b30");
            grad.addColorStop(1, "#221a36");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, H);

            // Board
            ctx.fillStyle = "#15152a";
            roundRect(ox, oy, board, board, 14);

            // Empty slots
            ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
            for (let r = 0; r < SIZE; r++)
                for (let c = 0; c < SIZE; c++)
                    roundRect(cellPx(c), cellPy(r), cell, cell, 10);

            for (const g of ghosts) drawTile(g.px, g.py, g.v, 0);

            for (let r = 0; r < SIZE; r++)
                for (let c = 0; c < SIZE; c++)
                    if (grid[r][c]) drawTile(grid[r][c].px, grid[r][c].py, grid[r][c].v, grid[r][c].pop);

            ctx.textBaseline = "alphabetic";

            if (!started) {
                ctx.fillStyle = "rgba(242, 243, 255, 0.85)";
                ctx.font = "700 17px system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("Swipe to slide the tiles", W / 2, oy - 34);
                ctx.font = "500 14px system-ui, sans-serif";
                ctx.fillStyle = "rgba(154, 160, 195, 0.9)";
                ctx.fillText("Matching numbers merge!", W / 2, oy - 12);
            }
        }

        function loop(ts) {
            rafId = requestAnimationFrame(loop);
            if (!lastTs) lastTs = ts;
            const dt = Math.min((ts - lastTs) / 1000, 0.05);
            lastTs = ts;
            update(dt);
            draw();
        }

        function onTouchStart(e) {
            const t = e.changedTouches[0];
            touchStartX = t.clientX;
            touchStartY = t.clientY;
            touchMoved = false;
        }

        function onTouchMove(e) {
            e.preventDefault();
            if (touchMoved) return;
            const t = e.changedTouches[0];
            const dx = t.clientX - touchStartX;
            const dy = t.clientY - touchStartY;
            if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
            touchMoved = true;
            if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 1 : -1, 0);
            else move(0, dy > 0 ? 1 : -1);
        }

        function onKey(e) {
            const map = {
                ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
                w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0]
            };
            const d = map[e.key];
            if (d) { e.preventDefault(); move(d[0], d[1]); }
        }

        return {
            start() {
                resize();
                reset();
                window.addEventListener("resize", resize);
                canvas.addEventListener("touchstart", onTouchStart, { passive: true });
                canvas.addEventListener("touchmove", onTouchMove, { passive: false });
                window.addEventListener("keydown", onKey);
                rafId = requestAnimationFrame(loop);
            },
            restart() {
                reset();
            },
            destroy() {
                cancelAnimationFrame(rafId);
                window.removeEventListener("resize", resize);
                canvas.removeEventListener("touchstart", onTouchStart);
                canvas.removeEventListener("touchmove", onTouchMove);
                window.removeEventListener("keydown", onKey);
            }
        };
    }

    window.SGGames = window.SGGames || {};
    window.SGGames.tiles = {
        id: "tiles",
        name: "2048",
        emoji: "\u{1F522}",
        tag: "Swipe to merge. Reach 2048!",
        scoreLabel: "points",
        create: create
    };
})();
