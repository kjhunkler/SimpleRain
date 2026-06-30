/* ============ Brick Breaker — drag the paddle, smash the bricks ============ */
(function () {
    "use strict";

    const BRICK_COLORS = ["#ff4d8d", "#ff8c42", "#ffd166", "#5ef58a", "#39d0ff", "#8e5bd6"];

    function create(host) {
        const canvas = host.canvas;
        const ctx = canvas.getContext("2d");

        const BRICK_ROWS = 6;
        const BRICK_COLS = 7;
        let W, H;
        let paddle, ball, bricks, particles;
        let score, lives, level, alive, started, stuck;
        let rafId, lastTs;
        const kids = !!host.kids;
        const START_LIVES = kids ? 5 : 3;
        const BALL_SPEED_SCALE = kids ? 0.74 : 1;
        const PADDLE_FRAC = kids ? 0.4 : 0.3;
        const PADDLE_MAX = kids ? 150 : 120;
        // Lift the paddle well clear of the screen bottom so a finger dragging it
        // doesn't land in the iOS home-indicator gesture zone (which swipes
        // between apps instead of moving the paddle).
        const PADDLE_BOTTOM_MARGIN = 110;

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = canvas.clientWidth;
            H = canvas.clientHeight;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        function reset() {
            paddle = { w: Math.min(W * PADDLE_FRAC, PADDLE_MAX), h: 14, x: W / 2 - Math.min(W * PADDLE_FRAC, PADDLE_MAX) / 2, y: H - PADDLE_BOTTOM_MARGIN };
            score = 0;
            lives = START_LIVES;
            level = 1;
            alive = true;
            started = false;
            particles = [];
            lastTs = 0;
            buildBricks();
            resetBall();
            host.setScore(0);
        }

        function resetBall() {
            stuck = true;
            ball = { x: paddle.x + paddle.w / 2, y: paddle.y - 9, r: 8, vx: 0, vy: 0 };
        }

        function launchBall() {
            if (!stuck) return;
            stuck = false;
            started = true;
            const speed = (380 + (level - 1) * 30) * BALL_SPEED_SCALE;
            const a = -Math.PI / 2 + (Math.random() - 0.5) * 0.7;
            ball.vx = Math.cos(a) * speed;
            ball.vy = Math.sin(a) * speed;
            SGSound.play("tap");
        }

        function buildBricks() {
            bricks = [];
            const top = 64;
            const sideGap = 10;
            const gap = 6;
            const bw = (W - sideGap * 2 - gap * (BRICK_COLS - 1)) / BRICK_COLS;
            const bh = 22;
            for (let r = 0; r < BRICK_ROWS; r++) {
                for (let c = 0; c < BRICK_COLS; c++) {
                    // Higher levels add tougher bricks at the top.
                    const tough = level > 1 && r < Math.min(level - 1, 3);
                    bricks.push({
                        x: sideGap + c * (bw + gap),
                        y: top + r * (bh + gap),
                        w: bw, h: bh,
                        color: BRICK_COLORS[r % BRICK_COLORS.length],
                        hp: tough ? 2 : 1
                    });
                }
            }
        }

        function explode(x, y, color, count) {
            for (let i = 0; i < count; i++) {
                const a = Math.random() * Math.PI * 2;
                const sp = Math.random() * 140 + 40;
                particles.push({
                    x: x, y: y,
                    vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                    life: 1, decay: Math.random() * 1.8 + 1.4,
                    color: color, size: Math.random() * 3.5 + 1.5
                });
            }
        }

        function loseLife() {
            lives -= 1;
            host.vibrate([60, 40, 80]);
            SGSound.play("miss");
            if (lives <= 0) {
                alive = false;
                SGSound.play("explode");
                setTimeout(() => host.gameOver(score), 700);
            } else {
                resetBall();
            }
        }

        function nextLevel() {
            level += 1;
            score += 25;
            host.setScore(score);
            SGSound.play("perfect");
            host.vibrate([15, 30, 15, 30, 15]);
            buildBricks();
            resetBall();
        }

        function update(dt) {
            for (let i = particles.length - 1; i >= 0; i--) {
                const p = particles[i];
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.life -= p.decay * dt;
                if (p.life <= 0) particles.splice(i, 1);
            }

            if (!alive) return;

            if (stuck) {
                ball.x = paddle.x + paddle.w / 2;
                ball.y = paddle.y - ball.r - 1;
                return;
            }

            ball.x += ball.vx * dt;
            ball.y += ball.vy * dt;

            // Walls
            if (ball.x - ball.r < 0) { ball.x = ball.r; ball.vx = Math.abs(ball.vx); SGSound.play("bounce"); }
            if (ball.x + ball.r > W) { ball.x = W - ball.r; ball.vx = -Math.abs(ball.vx); SGSound.play("bounce"); }
            if (ball.y - ball.r < 0) { ball.y = ball.r; ball.vy = Math.abs(ball.vy); SGSound.play("bounce"); }

            // Paddle
            if (ball.vy > 0 &&
                ball.y + ball.r >= paddle.y && ball.y + ball.r <= paddle.y + paddle.h + 12 &&
                ball.x >= paddle.x - ball.r && ball.x <= paddle.x + paddle.w + ball.r) {
                ball.y = paddle.y - ball.r;
                // Bounce angle depends on where the ball hits the paddle.
                const hit = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
                const speed = Math.hypot(ball.vx, ball.vy);
                const a = -Math.PI / 2 + hit * 1.05;
                ball.vx = Math.cos(a) * speed;
                ball.vy = Math.sin(a) * speed;
                host.vibrate(6);
                SGSound.play("bounce");
            }

            // Bricks
            for (let i = bricks.length - 1; i >= 0; i--) {
                const b = bricks[i];
                if (ball.x + ball.r < b.x || ball.x - ball.r > b.x + b.w ||
                    ball.y + ball.r < b.y || ball.y - ball.r > b.y + b.h) continue;

                // Pick reflection axis from the smallest overlap.
                const overlapX = Math.min(ball.x + ball.r - b.x, b.x + b.w - (ball.x - ball.r));
                const overlapY = Math.min(ball.y + ball.r - b.y, b.y + b.h - (ball.y - ball.r));
                if (overlapX < overlapY) ball.vx = -ball.vx;
                else ball.vy = -ball.vy;

                b.hp -= 1;
                if (b.hp <= 0) {
                    explode(b.x + b.w / 2, b.y + b.h / 2, b.color, 10);
                    bricks.splice(i, 1);
                    score += 1;
                    host.setScore(score);
                    host.vibrate(10);
                    SGSound.play("hit");
                } else {
                    SGSound.play("flip");
                }
                break;
            }

            if (bricks.length === 0) {
                nextLevel();
                return;
            }

            // Fell off the bottom
            if (ball.y - ball.r > H) loseLife();
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

        function draw() {
            const grad = ctx.createLinearGradient(0, 0, 0, H);
            grad.addColorStop(0, "#161628");
            grad.addColorStop(1, "#231b38");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, H);

            // Bricks
            for (const b of bricks) {
                ctx.globalAlpha = b.hp > 1 ? 1 : 0.92;
                ctx.fillStyle = b.color;
                roundRect(b.x, b.y, b.w, b.h, 6);
                if (b.hp > 1) {
                    ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
                    roundRect(b.x + 3, b.y + 3, b.w - 6, 4, 2);
                }
            }
            ctx.globalAlpha = 1;

            // Paddle
            ctx.fillStyle = "#39d0ff";
            roundRect(paddle.x, paddle.y, paddle.w, paddle.h, 8);
            ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
            roundRect(paddle.x + 4, paddle.y + 3, paddle.w - 8, 4, 2);

            // Ball
            ctx.fillStyle = "#f2f3ff";
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
            ctx.fill();

            // Particles
            for (const p of particles) {
                ctx.globalAlpha = Math.max(p.life, 0);
                ctx.fillStyle = p.color;
                ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
            }
            ctx.globalAlpha = 1;

            // Lives & level
            ctx.font = "16px system-ui, sans-serif";
            ctx.textAlign = "left";
            for (let i = 0; i < START_LIVES; i++) {
                ctx.globalAlpha = i < lives ? 1 : 0.2;
                ctx.fillText("\u2764\uFE0F", 12 + i * 24, 30);
            }
            ctx.globalAlpha = 1;
            ctx.fillStyle = "rgba(154, 160, 195, 0.9)";
            ctx.font = "700 13px system-ui, sans-serif";
            ctx.textAlign = "right";
            ctx.fillText("Level " + level, W - 12, 30);

            if (stuck && alive) {
                ctx.fillStyle = "rgba(242, 243, 255, 0.85)";
                ctx.font = "700 17px system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText(started ? "Tap to launch" : "Drag to move, tap to launch", W / 2, H * 0.6);
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

        function movePaddleTo(clientX) {
            const rect = canvas.getBoundingClientRect();
            const x = clientX - rect.left;
            paddle.x = Math.max(0, Math.min(W - paddle.w, x - paddle.w / 2));
        }

        function onTouchStart(e) {
            e.preventDefault();
            movePaddleTo(e.changedTouches[0].clientX);
            launchBall();
        }

        function onTouchMove(e) {
            e.preventDefault();
            movePaddleTo(e.changedTouches[0].clientX);
        }

        function onMouseDown(e) {
            movePaddleTo(e.clientX);
            launchBall();
            canvas.addEventListener("mousemove", onMouseMove);
        }

        function onMouseMove(e) {
            movePaddleTo(e.clientX);
        }

        function onMouseUp() {
            canvas.removeEventListener("mousemove", onMouseMove);
        }

        return {
            start() {
                resize();
                reset();
                window.addEventListener("resize", resize);
                canvas.addEventListener("touchstart", onTouchStart, { passive: false });
                canvas.addEventListener("touchmove", onTouchMove, { passive: false });
                canvas.addEventListener("mousedown", onMouseDown);
                window.addEventListener("mouseup", onMouseUp);
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
                canvas.removeEventListener("mousedown", onMouseDown);
                canvas.removeEventListener("mousemove", onMouseMove);
                window.removeEventListener("mouseup", onMouseUp);
            }
        };
    }

    window.SGGames = window.SGGames || {};
    window.SGGames.bricks = {
        id: "bricks",
        name: "Brick Breaker",
        emoji: "\u{1F9F1}",
        tag: "Drag the paddle. Smash every brick.",
        scoreLabel: "bricks",
        create: create
    };
})();
