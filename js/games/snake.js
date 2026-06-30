/* ============ Snake — swipe to steer ============ */
(function () {
    "use strict";

    const COLS = 17;
    const ROWS = 24;

    function create(host) {
        const canvas = host.canvas;
        const ctx = canvas.getContext("2d");

        let cell, boardW, boardH, offX, offY;
        let snake, dir, nextDir, food, score, alive, started;
        let tickMs, lastTick, rafId;
        let touchStartX = 0, touchStartY = 0, touchMoved = false;
        const kids = !!host.kids;
        const START_TICK = kids ? 210 : 170;
        const MIN_TICK = kids ? 110 : 75;
        const RAMP = kids ? 2.5 : 4;

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = canvas.clientWidth * dpr;
            canvas.height = canvas.clientHeight * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            cell = Math.floor(Math.min(canvas.clientWidth / COLS, canvas.clientHeight / ROWS));
            boardW = cell * COLS;
            boardH = cell * ROWS;
            offX = Math.floor((canvas.clientWidth - boardW) / 2);
            offY = Math.floor((canvas.clientHeight - boardH) / 2);
        }

        function reset() {
            const cx = Math.floor(COLS / 2);
            const cy = Math.floor(ROWS / 2);
            snake = [{ x: cx, y: cy + 2 }, { x: cx, y: cy + 3 }, { x: cx, y: cy + 4 }];
            dir = { x: 0, y: -1 };
            nextDir = dir;
            score = 0;
            alive = true;
            started = false;
            tickMs = START_TICK;
            lastTick = 0;
            spawnFood();
            host.setScore(0);
        }

        function spawnFood() {
            let spot;
            do {
                spot = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
            } while (snake.some(s => s.x === spot.x && s.y === spot.y));
            food = spot;
        }

        function setDir(x, y) {
            if (!alive) return;
            // Disallow reversing into yourself.
            if (x === -dir.x && y === -dir.y) return;
            nextDir = { x: x, y: y };
            started = true;
        }

        function autoTurn() {
            // Perpendicular options to the current heading.
            const opts = dir.x !== 0 ? [{ x: 0, y: -1 }, { x: 0, y: 1 }]
                                     : [{ x: -1, y: 0 }, { x: 1, y: 0 }];
            const h = snake[0];
            // Prefer the turn that lands closest to the nearest fruit.
            opts.sort((a, b) => {
                const da = Math.abs(h.x + a.x - food.x) + Math.abs(h.y + a.y - food.y);
                const db = Math.abs(h.x + b.x - food.x) + Math.abs(h.y + b.y - food.y);
                return da - db;
            });
            let fallback = null;
            for (const d of opts) {
                const nx = h.x + d.x, ny = h.y + d.y;
                if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
                if (fallback === null) fallback = d;
                if (!snake.some(s => s.x === nx && s.y === ny)) return d;
            }
            return fallback || dir;
        }

        function step() {
            dir = nextDir;

            // Kids mode: steer away from a wall instead of crashing into it.
            if (kids) {
                const ahead = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
                if (ahead.x < 0 || ahead.x >= COLS || ahead.y < 0 || ahead.y >= ROWS) {
                    dir = autoTurn();
                    nextDir = dir;
                }
            }

            const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

            if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS ||
                snake.some(s => s.x === head.x && s.y === head.y)) {
                alive = false;
                host.vibrate([60, 40, 80]);
                SGSound.play("hit");
                host.gameOver(score);
                return;
            }

            snake.unshift(head);

            if (head.x === food.x && head.y === food.y) {
                score += 1;
                host.setScore(score);
                host.vibrate(15);
                SGSound.play("eat");
                tickMs = Math.max(MIN_TICK, START_TICK - score * RAMP);
                spawnFood();
            } else {
                snake.pop();
            }
        }

        function draw() {
            ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

            // Board background (checkered)
            for (let y = 0; y < ROWS; y++) {
                for (let x = 0; x < COLS; x++) {
                    ctx.fillStyle = (x + y) % 2 === 0 ? "#1b1b30" : "#1e1e36";
                    ctx.fillRect(offX + x * cell, offY + y * cell, cell, cell);
                }
            }

            // Food
            const fx = offX + food.x * cell + cell / 2;
            const fy = offY + food.y * cell + cell / 2;
            ctx.fillStyle = "#ff4d8d";
            ctx.beginPath();
            ctx.arc(fx, fy, cell * 0.38, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#7cc97c";
            ctx.fillRect(fx - cell * 0.06, fy - cell * 0.52, cell * 0.12, cell * 0.2);

            // Snake
            for (let i = snake.length - 1; i >= 0; i--) {
                const s = snake[i];
                const t = i / Math.max(snake.length - 1, 1);
                ctx.fillStyle = i === 0 ? "#5ef58a" : `rgba(57, 208, 130, ${1 - t * 0.55})`;
                const pad = cell * 0.08;
                roundRect(offX + s.x * cell + pad, offY + s.y * cell + pad, cell - pad * 2, cell - pad * 2, cell * 0.28);
            }

            // Eyes on head
            const h = snake[0];
            const hx = offX + h.x * cell + cell / 2;
            const hy = offY + h.y * cell + cell / 2;
            ctx.fillStyle = "#12121f";
            const ex = dir.x !== 0 ? dir.x * cell * 0.18 : 0;
            const ey = dir.y !== 0 ? dir.y * cell * 0.18 : 0;
            const px = dir.y !== 0 ? cell * 0.16 : 0;
            const py = dir.x !== 0 ? cell * 0.16 : 0;
            ctx.beginPath();
            ctx.arc(hx + ex + px, hy + ey + py, cell * 0.07, 0, Math.PI * 2);
            ctx.arc(hx + ex - px, hy + ey - py, cell * 0.07, 0, Math.PI * 2);
            ctx.fill();

            if (!started && alive) {
                ctx.fillStyle = "rgba(242, 243, 255, 0.85)";
                ctx.font = "700 17px system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("Swipe anywhere to move", canvas.clientWidth / 2, offY + boardH * 0.32);
            }
        }

        function roundRect(x, y, w, h, r) {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.arcTo(x + w, y, x + w, y + h, r);
            ctx.arcTo(x + w, y + h, x, y + h, r);
            ctx.arcTo(x, y + h, x, y, r);
            ctx.arcTo(x, y, x + w, y, r);
            ctx.fill();
        }

        function loop(ts) {
            rafId = requestAnimationFrame(loop);
            if (alive && started && ts - lastTick >= tickMs) {
                lastTick = ts;
                step();
            }
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
            if (Math.abs(dx) < 22 && Math.abs(dy) < 22) return;
            touchMoved = true;
            if (Math.abs(dx) > Math.abs(dy)) setDir(dx > 0 ? 1 : -1, 0);
            else setDir(0, dy > 0 ? 1 : -1);
        }

        function onKey(e) {
            const map = {
                ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
                w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0]
            };
            const d = map[e.key];
            if (d) { e.preventDefault(); setDir(d[0], d[1]); }
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
    window.SGGames.snake = {
        id: "snake",
        name: "Snake",
        emoji: "\u{1F40D}",
        tag: "Swipe to steer. Eat, grow, survive.",
        scoreLabel: "apples",
        create: create
    };
})();
