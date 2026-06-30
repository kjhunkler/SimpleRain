/* ============ Star Catcher — drag the basket, catch the stars ============ */
(function () {
    "use strict";

    function create(host) {
        const canvas = host.canvas;
        const ctx = canvas.getContext("2d");

        let W, H, basketW, basketH, basketY;
        let basketX, targetX;
        let items, score, lives, alive, started, elapsed;
        let spawnTimer, rafId, lastTs, dragging;
        let explosions, shakeT;
        const SHAKE_DUR = 0.4;        // seconds a bomb shake lasts
        const SHAKE_MAG = 16;         // max shake offset (px)
        const kids = !!host.kids;
        const MAX_LIVES = kids ? 5 : 3;
        const FALL_BASE = kids ? 150 : 200;       // px/sec at the start
        const FALL_MAX = kids ? 360 : 520;        // px/sec cap
        const SPAWN_BASE = kids ? 1.15 : 0.9;     // seconds between drops
        const SPAWN_MIN = kids ? 0.55 : 0.38;
        const BOMB_CHANCE = kids ? 0.12 : 0.2;
        const GOLD_CHANCE = 0.1;

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = canvas.clientWidth;
            H = canvas.clientHeight;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            basketW = Math.min(W * 0.32, 150);
            basketH = basketW * 0.6;
            basketY = H - basketH - 24;
            if (basketX === undefined) {
                basketX = W / 2;
                targetX = W / 2;
            }
            clampBasket();
        }

        function clampBasket() {
            const half = basketW / 2;
            basketX = Math.max(half, Math.min(W - half, basketX));
            targetX = Math.max(half, Math.min(W - half, targetX));
        }

        function reset() {
            items = [];
            score = 0;
            lives = MAX_LIVES;
            alive = true;
            started = false;
            elapsed = 0;
            spawnTimer = 0.6;
            lastTs = 0;
            dragging = false;
            explosions = [];
            shakeT = 0;
            if (W) { basketX = W / 2; targetX = W / 2; }
            host.setScore(0);
        }

        function spawnItem() {
            const r = Math.max(16, Math.min(W, H) * 0.04);
            const isBomb = Math.random() < BOMB_CHANCE;
            const isGold = !isBomb && Math.random() < GOLD_CHANCE;
            const speed = Math.min(FALL_MAX, FALL_BASE + elapsed * 9);
            items.push({
                x: r + Math.random() * (W - r * 2),
                y: -r,
                r: r,
                vy: speed * (0.85 + Math.random() * 0.3),
                spin: (Math.random() - 0.5) * 4,
                rot: Math.random() * Math.PI,
                type: isBomb ? "bomb" : (isGold ? "gold" : "star")
            });
        }

        function loseLife() {
            lives -= 1;
            host.vibrate(40);
            SGSound.play("wrong");
            if (lives <= 0) {
                alive = false;
                setTimeout(() => host.gameOver(score), 650);
            }
        }

        function update(dt) {
            // Explosions and screen shake animate even during the game-over delay.
            if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);
            for (let i = explosions.length - 1; i >= 0; i--) {
                const ex = explosions[i];
                ex.t += dt;
                for (const p of ex.parts) {
                    p.x += p.vx * dt;
                    p.y += p.vy * dt;
                    p.vy += 380 * dt;        // gravity
                    p.vx *= (1 - dt * 1.5);  // air drag
                    p.life -= dt;
                }
                if (ex.t >= ex.life) explosions.splice(i, 1);
            }

            if (!alive) return;
            elapsed += dt;

            // Ease the basket toward the target position for a smooth feel.
            basketX += (targetX - basketX) * Math.min(1, dt * 16);

            if (started) {
                spawnTimer -= dt;
                const interval = Math.max(SPAWN_MIN, SPAWN_BASE - elapsed * 0.012);
                if (spawnTimer <= 0) {
                    spawnTimer = interval;
                    spawnItem();
                }
            }

            const half = basketW / 2;
            const rimY = basketY + basketH * 0.25;
            for (let i = items.length - 1; i >= 0; i--) {
                const it = items[i];
                it.y += it.vy * dt;
                it.rot += it.spin * dt;

                // Catch test: item center enters the basket mouth.
                if (it.y + it.r >= rimY && it.y - it.r <= basketY + basketH &&
                    it.x >= basketX - half && it.x <= basketX + half) {
                    items.splice(i, 1);
                    if (it.type === "bomb") {
                        spawnExplosion(it.x, it.y, it.r);
                        loseLife();
                    } else {
                        const gain = it.type === "gold" ? 3 : 1;
                        score += gain;
                        host.setScore(score);
                        host.vibrate(it.type === "gold" ? [12, 18, 12] : 10);
                        SGSound.play(it.type === "gold" ? "perfect" : "eat");
                    }
                    continue;
                }

                // Off the bottom: a missed star costs a life, bombs are safe.
                // Kids Mode is forgiving — only bombs can cost a life.
                if (it.y - it.r > H) {
                    items.splice(i, 1);
                    if (!kids && it.type !== "bomb") loseLife();
                }
            }
        }

        function spawnExplosion(x, y, r) {
            const parts = [];
            const n = 20;
            for (let i = 0; i < n; i++) {
                const ang = (Math.PI * 2 * i) / n + Math.random() * 0.4;
                const spd = 120 + Math.random() * 240;
                const life = 0.45 + Math.random() * 0.45;
                parts.push({
                    x: x, y: y,
                    vx: Math.cos(ang) * spd,
                    vy: Math.sin(ang) * spd,
                    life: life,
                    maxLife: life,
                    size: 2.5 + Math.random() * 4.5,
                    color: i % 3 === 0 ? "#ffd166" : (i % 3 === 1 ? "#ff7b3d" : "#ff3d3d")
                });
            }
            explosions.push({ x: x, y: y, t: 0, life: 0.6, r: r, parts: parts });
            shakeT = SHAKE_DUR;
            SGSound.play("explode");
        }

        function drawExplosion(ex) {
            const k = Math.min(1, ex.t / ex.life);   // 0..1 progress
            // Expanding shock ring
            ctx.globalAlpha = Math.max(0, 1 - k);
            ctx.strokeStyle = "rgba(255,180,80," + (1 - k) + ")";
            ctx.lineWidth = Math.max(1, ex.r * 0.5 * (1 - k));
            ctx.beginPath();
            ctx.arc(ex.x, ex.y, ex.r * (1 + k * 4), 0, Math.PI * 2);
            ctx.stroke();
            // Bright flash core (early frames only)
            if (k < 0.4) {
                ctx.globalAlpha = (0.4 - k) / 0.4;
                ctx.fillStyle = "#fff3c4";
                ctx.beginPath();
                ctx.arc(ex.x, ex.y, ex.r * (1.2 + k * 2.5), 0, Math.PI * 2);
                ctx.fill();
            }
            // Flying debris particles
            for (const p of ex.parts) {
                if (p.life <= 0) continue;
                ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
        }

        function drawStar(x, y, r, rot, fill, glow) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(rot);
            ctx.beginPath();
            for (let i = 0; i < 10; i++) {
                const ang = (Math.PI / 5) * i - Math.PI / 2;
                const rad = i % 2 === 0 ? r : r * 0.45;
                ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
            }
            ctx.closePath();
            ctx.shadowColor = glow;
            ctx.shadowBlur = 14;
            ctx.fillStyle = fill;
            ctx.fill();
            ctx.restore();
        }

        function drawBomb(x, y, r, rot) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(rot);
            ctx.fillStyle = "#2b2b3a";
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.fill();
            // Shine
            ctx.fillStyle = "rgba(255,255,255,0.25)";
            ctx.beginPath();
            ctx.arc(-r * 0.3, -r * 0.3, r * 0.28, 0, Math.PI * 2);
            ctx.fill();
            // Fuse
            ctx.strokeStyle = "#a9745b";
            ctx.lineWidth = Math.max(2, r * 0.14);
            ctx.beginPath();
            ctx.moveTo(0, -r);
            ctx.quadraticCurveTo(r * 0.6, -r * 1.3, r * 0.8, -r * 1.1);
            ctx.stroke();
            ctx.fillStyle = "#ffb347";
            ctx.beginPath();
            ctx.arc(r * 0.85, -r * 1.1, r * 0.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        function drawBasket() {
            const half = basketW / 2;
            const x = basketX - half;
            const y = basketY;

            // Rim
            ctx.fillStyle = "#b5793f";
            ctx.beginPath();
            ctx.ellipse(basketX, y + basketH * 0.25, half, basketH * 0.18, 0, 0, Math.PI * 2);
            ctx.fill();

            // Body
            ctx.fillStyle = "#8a5a2b";
            ctx.beginPath();
            ctx.moveTo(x, y + basketH * 0.25);
            ctx.lineTo(x + basketW * 0.12, y + basketH);
            ctx.lineTo(x + basketW * 0.88, y + basketH);
            ctx.lineTo(x + basketW, y + basketH * 0.25);
            ctx.closePath();
            ctx.fill();

            // Weave lines
            ctx.strokeStyle = "rgba(0,0,0,0.18)";
            ctx.lineWidth = 2;
            for (let i = 1; i < 4; i++) {
                const t = i / 4;
                ctx.beginPath();
                ctx.moveTo(x + basketW * 0.1 * t + basketW * 0.04, y + basketH * 0.25 + (basketH * 0.75) * t);
                ctx.lineTo(x + basketW - basketW * 0.1 * t - basketW * 0.04, y + basketH * 0.25 + (basketH * 0.75) * t);
                ctx.stroke();
            }

            // Front rim highlight
            ctx.strokeStyle = "#d4914f";
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.ellipse(basketX, y + basketH * 0.25, half, basketH * 0.18, 0, 0, Math.PI);
            ctx.stroke();
        }

        function draw() {
            // Screen shake offset (decays over SHAKE_DUR).
            let shx = 0, shy = 0;
            if (shakeT > 0) {
                const mag = SHAKE_MAG * (shakeT / SHAKE_DUR);
                shx = (Math.random() * 2 - 1) * mag;
                shy = (Math.random() * 2 - 1) * mag;
            }
            ctx.save();
            ctx.translate(shx, shy);

            // Night sky (over-filled so the shake never exposes the edges)
            const grad = ctx.createLinearGradient(0, 0, 0, H);
            grad.addColorStop(0, "#1a1a3a");
            grad.addColorStop(1, "#2a1a40");
            ctx.fillStyle = grad;
            ctx.fillRect(-SHAKE_MAG * 2, -SHAKE_MAG * 2, W + SHAKE_MAG * 4, H + SHAKE_MAG * 4);

            // Twinkle backdrop
            ctx.fillStyle = "rgba(255,255,255,0.5)";
            for (let i = 0; i < 24; i++) {
                const sx = ((i * 73) % W);
                const sy = ((i * 137) % (H - 60));
                const tw = 0.4 + 0.6 * Math.abs(Math.sin(elapsed * 1.5 + i));
                ctx.globalAlpha = tw * 0.5;
                ctx.fillRect(sx, sy, 2, 2);
            }
            ctx.globalAlpha = 1;

            for (const it of items) {
                if (it.type === "bomb") drawBomb(it.x, it.y, it.r, it.rot);
                else if (it.type === "gold") drawStar(it.x, it.y, it.r, it.rot, "#ffd166", "rgba(255,209,102,0.9)");
                else drawStar(it.x, it.y, it.r, it.rot, "#9ad0ff", "rgba(154,208,255,0.8)");
            }

            drawBasket();

            // Explosions burst on top of everything in the play field
            for (const ex of explosions) drawExplosion(ex);

            // Lives as hearts
            ctx.font = "20px system-ui, sans-serif";
            ctx.textAlign = "left";
            for (let i = 0; i < MAX_LIVES; i++) {
                ctx.globalAlpha = i < lives ? 1 : 0.22;
                ctx.fillText("❤️", 14 + i * 28, 34);
            }
            ctx.globalAlpha = 1;

            if (!started && alive) {
                ctx.fillStyle = "rgba(242, 243, 255, 0.9)";
                ctx.font = "700 18px system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("Catch the falling stars!", W / 2, H * 0.4);
                ctx.font = "500 14px system-ui, sans-serif";
                ctx.fillStyle = "rgba(154, 160, 195, 0.9)";
                ctx.fillText("Drag the basket • dodge the bombs \u{1F4A3}", W / 2, H * 0.4 + 26);
                ctx.fillText("Gold stars are worth 3", W / 2, H * 0.4 + 48);
            }

            ctx.restore();
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

        function moveTo(x) {
            targetX = x;
            clampBasket();
        }

        function onDown(e) {
            e.preventDefault();
            if (!alive) return;
            started = true;
            dragging = true;
            moveTo(pointFromEvent(e).x);
        }

        function onMove(e) {
            if (!dragging) return;
            e.preventDefault();
            moveTo(pointFromEvent(e).x);
        }

        function onUp() {
            dragging = false;
        }

        return {
            start() {
                resize();
                reset();
                window.addEventListener("resize", resize);
                canvas.addEventListener("touchstart", onDown, { passive: false });
                canvas.addEventListener("touchmove", onMove, { passive: false });
                canvas.addEventListener("touchend", onUp);
                canvas.addEventListener("mousedown", onDown);
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
                rafId = requestAnimationFrame(loop);
            },
            restart() {
                reset();
            },
            destroy() {
                cancelAnimationFrame(rafId);
                window.removeEventListener("resize", resize);
                canvas.removeEventListener("touchstart", onDown);
                canvas.removeEventListener("touchmove", onMove);
                canvas.removeEventListener("touchend", onUp);
                canvas.removeEventListener("mousedown", onDown);
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
            }
        };
    }

    window.SGGames = window.SGGames || {};
    window.SGGames.catcher = {
        id: "catcher",
        name: "Star Catcher",
        emoji: "⭐",
        tag: "Drag the basket to catch falling stars.",
        scoreLabel: "stars",
        create: create
    };
})();
