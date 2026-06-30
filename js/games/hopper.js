/* ============ Sky Hopper — tilt-free doodle jumping, drag to steer ============ */
(function () {
    "use strict";

    function create(host) {
        const canvas = host.canvas;
        const ctx = canvas.getContext("2d");

        let W, H;
        let player, platforms, clouds, score, highestY, alive, started;
        let cameraY, rafId, lastTs;
        let steerX = null;
        const kids = !!host.kids;
        const GRAVITY = kids ? 1180 : 1500;
        const JUMP_V = kids ? -700 : -640;

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = canvas.clientWidth;
            H = canvas.clientHeight;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        function reset() {
            player = { x: W / 2, y: H - 90, vx: 0, vy: 0, r: 16, face: 1 };
            platforms = [];
            clouds = [];
            score = 0;
            highestY = player.y;
            alive = true;
            started = false;
            cameraY = 0;
            steerX = null;
            lastTs = 0;

            // Starter platform right under the player, then fill upward.
            platforms.push({ x: W / 2 - 34, y: H - 60, w: 68, type: "static", phase: 0 });
            let y = H - 60;
            while (y > -H) {
                y -= 52 + Math.random() * 36;
                spawnPlatform(y);
            }
            for (let i = 0; i < 6; i++) {
                clouds.push({ x: Math.random() * W, y: Math.random() * H, w: 50 + Math.random() * 60 });
            }
            host.setScore(0);
        }

        function spawnPlatform(y) {
            const w = 58 + Math.random() * 26;
            const difficulty = Math.min(score / 120, 1);
            const movingChance = (0.12 + difficulty * 0.35) * (kids ? 0.5 : 1);
            const fragileChance = (0.08 + difficulty * 0.22) * (kids ? 0.5 : 1);
            const roll = Math.random();
            let type = "static";
            if (roll < movingChance) type = "moving";
            else if (roll < movingChance + fragileChance) type = "fragile";
            platforms.push({
                x: Math.random() * (W - w),
                y: y,
                w: w,
                type: type,
                phase: Math.random() * Math.PI * 2,
                broken: false
            });
        }

        function update(dt) {
            if (!alive) return;
            if (!started) {
                player.y = H - 90 + Math.sin(performance.now() / 350) * 5;
                return;
            }

            // Steering eases toward the touch x.
            if (steerX !== null) {
                const target = (steerX - player.x) * 8;
                player.vx += (target - player.vx) * Math.min(dt * 10, 1);
            } else {
                player.vx *= Math.pow(0.05, dt); // friction
            }
            if (Math.abs(player.vx) > 2) player.face = player.vx > 0 ? 1 : -1;

            player.vy += GRAVITY * dt;
            player.x += player.vx * dt;
            player.y += player.vy * dt;

            // Wrap horizontally.
            if (player.x < -player.r) player.x = W + player.r;
            if (player.x > W + player.r) player.x = -player.r;

            // Platforms
            for (const p of platforms) {
                if (p.type === "moving") {
                    p.phase += dt * 1.6;
                    p.x += Math.sin(p.phase) * 40 * dt;
                    p.x = Math.max(0, Math.min(W - p.w, p.x));
                }

                // Land only while falling.
                if (player.vy > 0 && !p.broken &&
                    player.x > p.x - 6 && player.x < p.x + p.w + 6 &&
                    player.y + player.r > p.y && player.y + player.r < p.y + 16 + player.vy * dt) {
                    if (p.type === "fragile") {
                        p.broken = true;
                        SGSound.play("flip");
                        continue; // breaks, no bounce
                    }
                    player.y = p.y - player.r;
                    player.vy = JUMP_V;
                    host.vibrate(6);
                    SGSound.play("jump");
                }
            }

            // Camera follows upward only.
            const targetCam = Math.min(cameraY, player.y - H * 0.45);
            cameraY = targetCam;

            // Score from height climbed.
            if (player.y < highestY) {
                highestY = player.y;
                const newScore = Math.floor((H - 90 - highestY) / 14);
                if (newScore > score) {
                    score = newScore;
                    host.setScore(score);
                }
            }

            // Recycle platforms below the view; add new above.
            const viewBottom = cameraY + H;
            platforms = platforms.filter(p => p.y < viewBottom + 40 && !(p.broken && p.y > viewBottom));
            let topMost = Infinity;
            for (const p of platforms) topMost = Math.min(topMost, p.y);
            while (topMost > cameraY - 80) {
                topMost -= 52 + Math.random() * 36;
                spawnPlatform(topMost);
            }

            // Fell off the bottom.
            if (player.y - cameraY > H + 60) {
                alive = false;
                host.vibrate([70, 40, 90]);
                SGSound.play("miss");
                setTimeout(() => host.gameOver(score), 600);
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

        function draw() {
            const grad = ctx.createLinearGradient(0, 0, 0, H);
            grad.addColorStop(0, "#162038");
            grad.addColorStop(1, "#251c3d");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, H);

            // Clouds parallax slowly with camera.
            ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
            for (const c of clouds) {
                const cy = ((c.y - cameraY * 0.3) % (H + 80) + H + 80) % (H + 80) - 40;
                ctx.beginPath();
                ctx.ellipse(c.x, cy, c.w, c.w * 0.34, 0, 0, Math.PI * 2);
                ctx.fill();
            }

            // Platforms
            for (const p of platforms) {
                const sy = p.y - cameraY;
                if (sy < -20 || sy > H + 20) continue;
                if (p.broken) ctx.globalAlpha = 0.35;
                if (p.type === "fragile") ctx.fillStyle = "#9c6f4a";
                else if (p.type === "moving") ctx.fillStyle = "#39d0ff";
                else ctx.fillStyle = "#5ef58a";
                roundRect(p.x, sy, p.w, 12, 6);
                if (p.type === "fragile" && !p.broken) {
                    ctx.strokeStyle = "rgba(18, 18, 31, 0.5)";
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(p.x + p.w * 0.3, sy + 2);
                    ctx.lineTo(p.x + p.w * 0.45, sy + 7);
                    ctx.lineTo(p.x + p.w * 0.6, sy + 3);
                    ctx.lineTo(p.x + p.w * 0.72, sy + 9);
                    ctx.stroke();
                }
                ctx.globalAlpha = 1;
            }

            // Player (round jelly hopper)
            const py = player.y - cameraY;
            const squash = Math.min(Math.max(player.vy / 1200, -0.25), 0.25);
            ctx.save();
            ctx.translate(player.x, py);
            ctx.scale(1 - squash * 0.6, 1 + squash);

            ctx.fillStyle = "#ff8c42";
            ctx.beginPath();
            ctx.arc(0, 0, player.r, 0, Math.PI * 2);
            ctx.fill();

            // Face
            ctx.fillStyle = "#fff";
            ctx.beginPath();
            ctx.arc(player.face * 5, -4, 5.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#12121f";
            ctx.beginPath();
            ctx.arc(player.face * 6.5, -4, 2.6, 0, Math.PI * 2);
            ctx.fill();

            // Feet
            ctx.fillStyle = "#e0702a";
            ctx.beginPath();
            ctx.ellipse(-6, player.r - 2, 5, 3.5, 0, 0, Math.PI * 2);
            ctx.ellipse(6, player.r - 2, 5, 3.5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            if (!started && alive) {
                ctx.fillStyle = "rgba(242, 243, 255, 0.85)";
                ctx.font = "700 17px system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("Tap to hop!", W / 2, H * 0.32);
                ctx.font = "500 14px system-ui, sans-serif";
                ctx.fillStyle = "rgba(154, 160, 195, 0.9)";
                ctx.fillText("Hold & drag to steer left and right", W / 2, H * 0.32 + 26);
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

        function clientToX(clientX) {
            return clientX - canvas.getBoundingClientRect().left;
        }

        function onTouchStart(e) {
            e.preventDefault();
            steerX = clientToX(e.changedTouches[0].clientX);
            if (!started) {
                started = true;
                player.vy = -640;
                SGSound.play("jump");
            }
        }

        function onTouchMove(e) {
            e.preventDefault();
            steerX = clientToX(e.changedTouches[0].clientX);
        }

        function onTouchEnd() {
            steerX = null;
        }

        function onMouseDown(e) {
            steerX = clientToX(e.clientX);
            if (!started) {
                started = true;
                player.vy = -640;
                SGSound.play("jump");
            }
            canvas.addEventListener("mousemove", onMouseMove);
        }

        function onMouseMove(e) {
            steerX = clientToX(e.clientX);
        }

        function onMouseUp() {
            steerX = null;
            canvas.removeEventListener("mousemove", onMouseMove);
        }

        return {
            start() {
                resize();
                reset();
                window.addEventListener("resize", resize);
                canvas.addEventListener("touchstart", onTouchStart, { passive: false });
                canvas.addEventListener("touchmove", onTouchMove, { passive: false });
                canvas.addEventListener("touchend", onTouchEnd);
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
                canvas.removeEventListener("touchend", onTouchEnd);
                canvas.removeEventListener("mousedown", onMouseDown);
                canvas.removeEventListener("mousemove", onMouseMove);
                window.removeEventListener("mouseup", onMouseUp);
            }
        };
    }

    window.SGGames = window.SGGames || {};
    window.SGGames.hopper = {
        id: "hopper",
        name: "Sky Hopper",
        emoji: "\u{1F438}",
        tag: "Bounce up the platforms. Don't fall!",
        scoreLabel: "meters",
        create: create
    };
})();
