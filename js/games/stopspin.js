/* ============ Stop Spin — stop the needle in the target zone ============ */
(function () {
    "use strict";

    function create(host) {
        const canvas = host.canvas;
        const ctx = canvas.getContext("2d");

        let W, H, cx, cy, radius;
        let angle, speed, dir, zoneStart, zoneSize, perfectSize;
        let score, lives, alive, started, resultFlash;
        let rafId, lastTs;
        const MAX_LIVES = 3;
        const kids = !!host.kids;
        const SPEED_BASE = kids ? 1.7 : 2.4;
        const SPEED_RAMP = kids ? 0.09 : 0.14;
        const SPEED_MAX = kids ? 5 : 7.5;
        const ZONE_BASE = kids ? 1.05 : 0.85;
        const ZONE_MIN = kids ? 0.42 : 0.28;
        const ZONE_RAMP = kids ? 0.015 : 0.022;

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = canvas.clientWidth;
            H = canvas.clientHeight;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            cx = W / 2;
            cy = H / 2 + 10;
            radius = Math.min(W, H) * 0.32;
        }

        function reset() {
            angle = -Math.PI / 2;
            speed = SPEED_BASE;
            dir = 1;
            score = 0;
            lives = MAX_LIVES;
            alive = true;
            started = false;
            resultFlash = null;
            lastTs = 0;
            newZone();
            host.setScore(0);
        }

        function newZone() {
            zoneSize = Math.max(ZONE_MIN, ZONE_BASE - score * ZONE_RAMP);
            perfectSize = zoneSize * 0.3;
            // Place the zone away from the needle so it's never an instant win.
            const needle = norm(angle);
            let start;
            do {
                start = Math.random() * Math.PI * 2;
            } while (angularDist(needle, start + zoneSize / 2) < zoneSize * 1.2);
            zoneStart = start;
        }

        function norm(a) {
            return ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        }

        function angularDist(a, b) {
            const d = Math.abs(norm(a) - norm(b));
            return Math.min(d, Math.PI * 2 - d);
        }

        function stopNeedle() {
            if (!alive) return;
            if (!started) {
                started = true;
                host.vibrate(10);
                return;
            }

            const needle = norm(angle);
            const zoneCenter = norm(zoneStart + zoneSize / 2);
            const dist = angularDist(needle, zoneCenter);

            if (dist <= perfectSize / 2) {
                score += 3;
                resultFlash = { kind: "perfect", t: 1 };
                host.vibrate([15, 30, 15]);
                SGSound.play("perfect");
            } else if (dist <= zoneSize / 2) {
                score += 1;
                resultFlash = { kind: "good", t: 1 };
                host.vibrate(12);
                SGSound.play("score");
            } else {
                lives -= 1;
                resultFlash = { kind: "miss", t: 1 };
                host.vibrate(40);
                SGSound.play("wrong");
                if (lives <= 0) {
                    alive = false;
                    setTimeout(() => host.gameOver(score), 700);
                    return;
                }
            }

            host.setScore(score);
            // Speed up, reverse direction sometimes, move the zone.
            speed = Math.min(SPEED_BASE + score * SPEED_RAMP, SPEED_MAX);
            if (Math.random() < 0.35) dir = -dir;
            newZone();
        }

        function update(dt) {
            if (alive && started) angle += speed * dir * dt;
            if (resultFlash) {
                resultFlash.t -= dt * 1.6;
                if (resultFlash.t <= 0) resultFlash = null;
            }
        }

        function draw() {
            const grad = ctx.createLinearGradient(0, 0, 0, H);
            grad.addColorStop(0, "#181830");
            grad.addColorStop(1, "#221a36");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, H);

            // Outer ring
            ctx.strokeStyle = "#2c2c52";
            ctx.lineWidth = 26;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.stroke();

            // Target zone
            ctx.strokeStyle = "#39d07f";
            ctx.beginPath();
            ctx.arc(cx, cy, radius, zoneStart, zoneStart + zoneSize);
            ctx.stroke();

            // Perfect sliver
            const pc = zoneStart + zoneSize / 2;
            ctx.strokeStyle = "#ffd166";
            ctx.beginPath();
            ctx.arc(cx, cy, radius, pc - perfectSize / 2, pc + perfectSize / 2);
            ctx.stroke();

            // Needle
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(angle);
            ctx.strokeStyle = "#f2f3ff";
            ctx.lineWidth = 5;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(radius + 18, 0);
            ctx.stroke();
            ctx.fillStyle = "#ff4d8d";
            ctx.beginPath();
            ctx.arc(0, 0, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            // Result flash text
            if (resultFlash) {
                const f = resultFlash;
                ctx.globalAlpha = Math.max(f.t, 0);
                ctx.textAlign = "center";
                ctx.font = "800 " + (26 + (1 - f.t) * 10) + "px system-ui, sans-serif";
                if (f.kind === "perfect") { ctx.fillStyle = "#ffd166"; ctx.fillText("PERFECT! +3", cx, cy - radius - 38); }
                else if (f.kind === "good") { ctx.fillStyle = "#5ef58a"; ctx.fillText("+1", cx, cy - radius - 38); }
                else { ctx.fillStyle = "#ff5d5d"; ctx.fillText("MISS!", cx, cy - radius - 38); }
                ctx.globalAlpha = 1;
            }

            // Lives
            ctx.font = "20px system-ui, sans-serif";
            ctx.textAlign = "left";
            for (let i = 0; i < MAX_LIVES; i++) {
                ctx.globalAlpha = i < lives ? 1 : 0.22;
                ctx.fillText("\u2764\uFE0F", 14 + i * 28, 34);
            }
            ctx.globalAlpha = 1;

            if (!started && alive) {
                ctx.fillStyle = "rgba(242, 243, 255, 0.85)";
                ctx.font = "700 17px system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("Tap to start, tap to stop!", cx, cy + radius + 56);
                ctx.font = "500 14px system-ui, sans-serif";
                ctx.fillStyle = "rgba(154, 160, 195, 0.9)";
                ctx.fillText("Land in the green \u2014 gold is a perfect +3", cx, cy + radius + 80);
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
            stopNeedle();
        }

        function onKey(e) {
            if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                stopNeedle();
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
    window.SGGames.stopspin = {
        id: "stopspin",
        name: "Stop Spin",
        emoji: "\u{1F3AF}",
        tag: "Stop the needle in the zone.",
        scoreLabel: "points",
        create: create
    };
})();
