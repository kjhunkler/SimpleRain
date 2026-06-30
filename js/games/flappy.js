/* ============ Bouncy Bird — tap to flap ============ */
(function () {
    "use strict";

    function create(host) {
        const canvas = host.canvas;
        const ctx = canvas.getContext("2d");

        const PIPE_W = 64;
        let W, H;
        let bird, pipes, clouds, score, alive, started;
        let spawnTimer, rafId, lastTs;
        const kids = !!host.kids;
        const GAP_BASE = kids ? 230 : 195;
        const GAP_MIN = kids ? 185 : 145;
        const SCROLL_BASE = kids ? 120 : 160;
        const GRAVITY = kids ? 1100 : 1400;
        const FLAP_V = kids ? -360 : -400;

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = canvas.clientWidth;
            H = canvas.clientHeight;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        function reset() {
            bird = { x: W * 0.3, y: H * 0.45, vy: 0, r: 15, rot: 0, wing: 0 };
            pipes = [];
            clouds = [];
            for (let i = 0; i < 5; i++) {
                clouds.push({
                    x: Math.random() * W,
                    y: Math.random() * H * 0.55,
                    w: 60 + Math.random() * 70,
                    v: 12 + Math.random() * 12
                });
            }
            score = 0;
            alive = true;
            started = false;
            spawnTimer = 0.9;
            lastTs = 0;
            host.setScore(0);
        }

        function flap() {
            if (!alive) return;
            started = true;
            bird.vy = FLAP_V;
            bird.wing = 1;
            host.vibrate(8);
            SGSound.play("flap");
        }

        function spawnPipe() {
            const gap = Math.max(GAP_MIN, GAP_BASE - score * 2.5);
            const margin = 70;
            const gy = margin + Math.random() * Math.max(H - margin * 2 - gap, 40);
            pipes.push({ x: W + PIPE_W, gapY: gy, gapH: gap, passed: false });
        }

        function die() {
            if (!alive) return;
            alive = false;
            host.vibrate([60, 40, 80]);
            SGSound.play("hit");
            setTimeout(() => host.gameOver(score), 700);
        }

        function update(dt) {
            for (const c of clouds) {
                c.x -= c.v * dt;
                if (c.x < -c.w) { c.x = W + c.w; c.y = Math.random() * H * 0.55; }
            }

            bird.wing = Math.max(0, bird.wing - dt * 4);

            if (!started) {
                bird.y = H * 0.45 + Math.sin(performance.now() / 400) * 8;
                return;
            }

            bird.vy += GRAVITY * dt;
            bird.y += bird.vy * dt;
            bird.rot = Math.max(-0.5, Math.min(1.2, bird.vy / 600));

            // Soft ceiling
            if (bird.y - bird.r < 0) { bird.y = bird.r; bird.vy = 0; }

            if (!alive) {
                // Dead bird keeps tumbling until the overlay shows.
                if (bird.y > H + 60) bird.y = H + 60;
                return;
            }

            const speed = SCROLL_BASE + Math.min(score * 3, 80);
            spawnTimer -= dt;
            if (spawnTimer <= 0) {
                spawnTimer = 1.5;
                spawnPipe();
            }

            for (let i = pipes.length - 1; i >= 0; i--) {
                const p = pipes[i];
                p.x -= speed * dt;
                if (p.x + PIPE_W < -10) { pipes.splice(i, 1); continue; }

                if (!p.passed && p.x + PIPE_W < bird.x - bird.r) {
                    p.passed = true;
                    score += 1;
                    host.setScore(score);
                    host.vibrate(10);
                    SGSound.play("score");
                }

                if (bird.x + bird.r * 0.8 > p.x && bird.x - bird.r * 0.8 < p.x + PIPE_W &&
                    (bird.y - bird.r * 0.8 < p.gapY || bird.y + bird.r * 0.8 > p.gapY + p.gapH)) {
                    die();
                    return;
                }
            }

            // Ground
            if (bird.y + bird.r >= H - 12) {
                bird.y = H - 12 - bird.r;
                die();
            }
        }

        function drawPipe(p) {
            const lip = 10;
            ctx.fillStyle = "#3fae6a";
            ctx.strokeStyle = "#2c7d4c";
            ctx.lineWidth = 3;
            // Top pipe
            ctx.fillRect(p.x, -4, PIPE_W, p.gapY + 4);
            ctx.strokeRect(p.x, -4, PIPE_W, p.gapY + 4);
            ctx.fillRect(p.x - 4, p.gapY - lip, PIPE_W + 8, lip);
            ctx.strokeRect(p.x - 4, p.gapY - lip, PIPE_W + 8, lip);
            // Bottom pipe
            const by = p.gapY + p.gapH;
            ctx.fillRect(p.x, by, PIPE_W, H - by);
            ctx.strokeRect(p.x, by, PIPE_W, H - by + 6);
            ctx.fillRect(p.x - 4, by, PIPE_W + 8, lip);
            ctx.strokeRect(p.x - 4, by, PIPE_W + 8, lip);
        }

        function drawBird() {
            ctx.save();
            ctx.translate(bird.x, bird.y);
            ctx.rotate(bird.rot);
            const r = bird.r;

            // Body
            ctx.fillStyle = "#ffd166";
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.fill();

            // Wing
            ctx.fillStyle = "#ffb347";
            ctx.beginPath();
            ctx.ellipse(-r * 0.2, r * 0.15 - bird.wing * r * 0.5, r * 0.55, r * 0.35, -0.4, 0, Math.PI * 2);
            ctx.fill();

            // Eye
            ctx.fillStyle = "#fff";
            ctx.beginPath();
            ctx.arc(r * 0.35, -r * 0.3, r * 0.32, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#12121f";
            ctx.beginPath();
            ctx.arc(r * 0.45, -r * 0.3, r * 0.15, 0, Math.PI * 2);
            ctx.fill();

            // Beak
            ctx.fillStyle = "#ff8c42";
            ctx.beginPath();
            ctx.moveTo(r * 0.75, -r * 0.05);
            ctx.lineTo(r * 1.35, r * 0.12);
            ctx.lineTo(r * 0.72, r * 0.34);
            ctx.closePath();
            ctx.fill();

            ctx.restore();
        }

        function draw() {
            const grad = ctx.createLinearGradient(0, 0, 0, H);
            grad.addColorStop(0, "#1b2a4a");
            grad.addColorStop(1, "#2a2040");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, H);

            // Clouds
            ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
            for (const c of clouds) {
                ctx.beginPath();
                ctx.ellipse(c.x, c.y, c.w, c.w * 0.36, 0, 0, Math.PI * 2);
                ctx.fill();
            }

            for (const p of pipes) drawPipe(p);

            // Ground strip
            ctx.fillStyle = "#1a2a1f";
            ctx.fillRect(0, H - 12, W, 12);

            drawBird();

            if (!started && alive) {
                ctx.fillStyle = "rgba(242, 243, 255, 0.85)";
                ctx.font = "700 17px system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("Tap to flap!", W / 2, H * 0.3);
                ctx.font = "500 14px system-ui, sans-serif";
                ctx.fillStyle = "rgba(154, 160, 195, 0.9)";
                ctx.fillText("Fly through the gaps", W / 2, H * 0.3 + 26);
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

        function onPointerDown(e) {
            e.preventDefault();
            flap();
        }

        function onKey(e) {
            if (e.key === " " || e.key === "ArrowUp") {
                e.preventDefault();
                flap();
            }
        }

        return {
            start() {
                resize();
                reset();
                window.addEventListener("resize", resize);
                canvas.addEventListener("touchstart", onPointerDown, { passive: false });
                canvas.addEventListener("mousedown", onPointerDown);
                window.addEventListener("keydown", onKey);
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
                window.removeEventListener("keydown", onKey);
            }
        };
    }

    window.SGGames = window.SGGames || {};
    window.SGGames.flappy = {
        id: "flappy",
        name: "Bouncy Bird",
        emoji: "\u{1F424}",
        tag: "Tap to flap through the gaps.",
        scoreLabel: "pipes",
        create: create
    };
})();
