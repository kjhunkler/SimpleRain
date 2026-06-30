/* ============ Mole Whack — tap the moles before they hide ============ */
(function () {
    "use strict";

    const COLS = 3;
    const ROWS = 4;

    function create(host) {
        const canvas = host.canvas;
        const ctx = canvas.getContext("2d");

        let W, H, cellW, cellH, gridX, gridY, holeR;
        let holes, score, misses, alive, started, elapsed;
        let popTimer, rafId, lastTs;
        const kids = !!host.kids;
        const MAX_MISSES = kids ? 5 : 3;
        const UP_BASE = kids ? 1.6 : 1.15;
        const UP_MIN = kids ? 0.7 : 0.45;
        const INTERVAL_BASE = kids ? 1.15 : 0.95;
        const INTERVAL_MIN = kids ? 0.45 : 0.32;

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = canvas.clientWidth;
            H = canvas.clientHeight;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            cellW = Math.min(W / COLS, 150);
            cellH = Math.min((H - 90) / ROWS, 160);
            gridX = (W - cellW * COLS) / 2;
            gridY = (H - cellH * ROWS) / 2 + 18;
            holeR = Math.min(cellW, cellH) * 0.33;
        }

        function reset() {
            holes = [];
            for (let r = 0; r < ROWS; r++) {
                for (let c = 0; c < COLS; c++) {
                    holes.push({
                        col: c, row: r,
                        state: "empty",   // empty | rising | up | sinking | whacked
                        t: 0,             // state timer
                        upFor: 1,         // how long the mole stays up
                        pop: 0,           // 0..1 how far out of the hole
                        golden: false,
                        face: 0
                    });
                }
            }
            score = 0;
            misses = 0;
            alive = true;
            started = false;
            elapsed = 0;
            popTimer = 0.5;
            lastTs = 0;
            host.setScore(0);
        }

        function popRandomMole() {
            const empty = holes.filter(h => h.state === "empty");
            if (empty.length === 0) return;
            const hole = empty[Math.floor(Math.random() * empty.length)];
            hole.state = "rising";
            hole.t = 0;
            hole.golden = Math.random() < 0.12;
            hole.face = Math.floor(Math.random() * 3);
            hole.upFor = Math.max(UP_MIN, UP_BASE - elapsed * 0.012);
        }

        function holeCenter(hole) {
            return {
                x: gridX + hole.col * cellW + cellW / 2,
                y: gridY + hole.row * cellH + cellH / 2
            };
        }

        function update(dt) {
            if (!alive) return;
            elapsed += dt;

            if (started) {
                popTimer -= dt;
                const interval = Math.max(INTERVAL_MIN, INTERVAL_BASE - elapsed * 0.014);
                if (popTimer <= 0) {
                    popTimer = interval;
                    popRandomMole();
                    // Sometimes pop a second mole later in the game.
                    if (elapsed > 18 && Math.random() < 0.4) popRandomMole();
                }
            } else {
                // Attract mode: keep one mole bobbing before first tap.
                if (!holes.some(h => h.state !== "empty")) popRandomMole();
            }

            for (const hole of holes) {
                hole.t += dt;
                switch (hole.state) {
                    case "rising":
                        hole.pop = Math.min(1, hole.t / 0.16);
                        if (hole.pop >= 1) { hole.state = "up"; hole.t = 0; }
                        break;
                    case "up":
                        if (started && hole.t >= hole.upFor) {
                            hole.state = "sinking";
                            hole.t = 0;
                            if (!hole.golden) {
                                misses += 1;
                                host.vibrate(30);
                                SGSound.play("wrong");
                                if (misses >= MAX_MISSES) {
                                    alive = false;
                                    setTimeout(() => host.gameOver(score), 600);
                                }
                            }
                        } else if (!started && hole.t >= 1.4) {
                            hole.state = "sinking";
                            hole.t = 0;
                        }
                        break;
                    case "sinking":
                        hole.pop = Math.max(0, 1 - hole.t / 0.14);
                        if (hole.pop <= 0) { hole.state = "empty"; hole.t = 0; }
                        break;
                    case "whacked":
                        hole.pop = Math.max(0, hole.pop - dt * 7);
                        if (hole.pop <= 0) { hole.state = "empty"; hole.t = 0; }
                        break;
                }
            }
        }

        function whackAt(x, y) {
            if (!alive) return;
            for (const hole of holes) {
                if (hole.state !== "up" && hole.state !== "rising") continue;
                const c = holeCenter(hole);
                const dx = x - c.x, dy = y - c.y;
                const hitR = holeR * 1.45;
                if (dx * dx + dy * dy <= hitR * hitR) {
                    started = true;
                    hole.state = "whacked";
                    hole.t = 0;
                    score += hole.golden ? 3 : 1;
                    host.setScore(score);
                    host.vibrate(hole.golden ? [15, 25, 15] : 12);
                    SGSound.play(hole.golden ? "perfect" : "whack");
                    return;
                }
            }
            // Tapping dirt is fine before the game starts.
            if (started) {
                host.vibrate(5);
                SGSound.play("flip");
            } else {
                started = true;
            }
        }

        function drawMole(c, pop, golden, face, whacked) {
            const r = holeR;
            const lift = pop * r * 1.5;

            ctx.save();
            ctx.beginPath();
            ctx.rect(c.x - r * 1.6, c.y - r * 2.6, r * 3.2, r * 2.6 + r * 0.55);
            ctx.clip();

            const my = c.y - lift + r * 0.9;

            // Body
            ctx.fillStyle = golden ? "#ffd166" : "#a9745b";
            ctx.beginPath();
            ctx.ellipse(c.x, my, r * 0.85, r * 1.05, 0, 0, Math.PI * 2);
            ctx.fill();

            // Belly
            ctx.fillStyle = golden ? "#ffe7a9" : "#d9b196";
            ctx.beginPath();
            ctx.ellipse(c.x, my + r * 0.32, r * 0.5, r * 0.55, 0, 0, Math.PI * 2);
            ctx.fill();

            // Ears
            ctx.fillStyle = golden ? "#ffd166" : "#a9745b";
            ctx.beginPath();
            ctx.arc(c.x - r * 0.55, my - r * 0.85, r * 0.22, 0, Math.PI * 2);
            ctx.arc(c.x + r * 0.55, my - r * 0.85, r * 0.22, 0, Math.PI * 2);
            ctx.fill();

            // Eyes
            const ey = my - r * 0.35;
            if (whacked) {
                ctx.strokeStyle = "#12121f";
                ctx.lineWidth = 2.5;
                const s = r * 0.14;
                for (const sx of [-r * 0.32, r * 0.32]) {
                    ctx.beginPath();
                    ctx.moveTo(c.x + sx - s, ey - s); ctx.lineTo(c.x + sx + s, ey + s);
                    ctx.moveTo(c.x + sx + s, ey - s); ctx.lineTo(c.x + sx - s, ey + s);
                    ctx.stroke();
                }
            } else {
                ctx.fillStyle = "#12121f";
                ctx.beginPath();
                if (face === 1) {
                    // Sleepy half-eyes
                    ctx.rect(c.x - r * 0.42, ey, r * 0.24, r * 0.08);
                    ctx.rect(c.x + r * 0.18, ey, r * 0.24, r * 0.08);
                } else {
                    ctx.arc(c.x - r * 0.3, ey, r * 0.11, 0, Math.PI * 2);
                    ctx.arc(c.x + r * 0.3, ey, r * 0.11, 0, Math.PI * 2);
                }
                ctx.fill();
            }

            // Nose
            ctx.fillStyle = "#ff8da6";
            ctx.beginPath();
            ctx.ellipse(c.x, my - r * 0.1, r * 0.16, r * 0.12, 0, 0, Math.PI * 2);
            ctx.fill();

            // Whiskers
            ctx.strokeStyle = "rgba(18, 18, 31, 0.55)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (const side of [-1, 1]) {
                ctx.moveTo(c.x + side * r * 0.2, my - r * 0.05);
                ctx.lineTo(c.x + side * r * 0.75, my - r * 0.15);
                ctx.moveTo(c.x + side * r * 0.2, my + r * 0.05);
                ctx.lineTo(c.x + side * r * 0.75, my + r * 0.08);
            }
            ctx.stroke();

            ctx.restore();
        }

        function draw() {
            // Lawn
            const grad = ctx.createLinearGradient(0, 0, 0, H);
            grad.addColorStop(0, "#1d3322");
            grad.addColorStop(1, "#16281b");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, H);

            for (const hole of holes) {
                const c = holeCenter(hole);

                // Dirt mound + hole
                ctx.fillStyle = "#0e0d18";
                ctx.beginPath();
                ctx.ellipse(c.x, c.y + holeR * 0.55, holeR * 1.15, holeR * 0.45, 0, 0, Math.PI * 2);
                ctx.fill();

                if (hole.pop > 0) {
                    drawMole(c, hole.pop, hole.golden, hole.face, hole.state === "whacked");
                }

                // Front lip of the hole hides the mole's bottom.
                ctx.fillStyle = "#241b12";
                ctx.beginPath();
                ctx.ellipse(c.x, c.y + holeR * 0.62, holeR * 1.18, holeR * 0.4, 0, 0, Math.PI);
                ctx.fill();
            }

            // Miss hearts
            ctx.font = "20px system-ui, sans-serif";
            ctx.textAlign = "left";
            for (let i = 0; i < MAX_MISSES; i++) {
                ctx.globalAlpha = i < MAX_MISSES - misses ? 1 : 0.22;
                ctx.fillText("\u2764\uFE0F", 14 + i * 28, 34);
            }
            ctx.globalAlpha = 1;

            if (!started && alive) {
                ctx.fillStyle = "rgba(242, 243, 255, 0.85)";
                ctx.font = "700 17px system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("Tap the moles!", W / 2, gridY - 26);
                ctx.font = "500 14px system-ui, sans-serif";
                ctx.fillStyle = "rgba(154, 160, 195, 0.9)";
                ctx.fillText("Golden moles are worth 3", W / 2, gridY - 4);
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

        function pointFromEvent(e) {
            const rect = canvas.getBoundingClientRect();
            const src = e.changedTouches ? e.changedTouches[0] : e;
            return { x: src.clientX - rect.left, y: src.clientY - rect.top };
        }

        function onPointerDown(e) {
            e.preventDefault();
            const p = pointFromEvent(e);
            whackAt(p.x, p.y);
        }

        return {
            start() {
                resize();
                reset();
                window.addEventListener("resize", resize);
                canvas.addEventListener("touchstart", onPointerDown, { passive: false });
                canvas.addEventListener("mousedown", onPointerDown);
                rafId = requestAnimationFrame(loop);
            },
            restart() {
                reset();
            },
            destroy() {
                cancelAnimationFrame(rafId);
                window.removeEventListener("resize", resize);
                canvas.removeEventListener("touchstart", onPointerDown);
                canvas.removeEventListener("mousedown", onPointerDown);
            }
        };
    }

    window.SGGames = window.SGGames || {};
    window.SGGames.moles = {
        id: "moles",
        name: "Mole Whack",
        emoji: "\u{1F439}",
        tag: "Tap the moles before they hide.",
        scoreLabel: "moles",
        create: create
    };
})();
