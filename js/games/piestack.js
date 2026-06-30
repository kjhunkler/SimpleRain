/* ============ Pie Stack — tap to drop the pie ============ */
(function () {
    "use strict";

    const PIE_COLORS = [
        { crust: "#e0a458", filling: "#ff4d8d" },  // cherry
        { crust: "#e0a458", filling: "#8e5bd6" },  // blueberry
        { crust: "#e0a458", filling: "#ffd166" },  // lemon
        { crust: "#e0a458", filling: "#7cc97c" },  // apple
        { crust: "#e0a458", filling: "#ff8c42" }   // pumpkin
    ];

    function create(host) {
        const canvas = host.canvas;
        const ctx = canvas.getContext("2d");

        let W, H;
        let stack, mover, score, alive, started;
        let cameraY, targetCameraY;
        let crumbs, rafId, lastTs;
        const PIE_H = 26;
        const kids = !!host.kids;
        const SPEED_SCALE = kids ? 0.62 : 1;
        const PERFECT_TOL = kids ? 12 : 7;

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = canvas.clientWidth;
            H = canvas.clientHeight;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        function reset() {
            const baseW = Math.min(W * 0.55, 230);
            stack = [{
                x: (W - baseW) / 2,
                w: baseW,
                y: 0,            // stack height index 0 = bottom
                color: PIE_COLORS[0],
                wobble: 0
            }];
            score = 0;
            alive = true;
            started = false;
            cameraY = 0;
            targetCameraY = 0;
            crumbs = [];
            lastTs = 0;
            newMover();
            host.setScore(0);
        }

        function newMover() {
            const top = stack[stack.length - 1];
            const speed = (170 + Math.min(score * 11, 330)) * SPEED_SCALE;
            const fromLeft = stack.length % 2 === 0;
            mover = {
                x: fromLeft ? -top.w : W,
                w: top.w,
                y: stack.length,
                dir: fromLeft ? 1 : -1,
                speed: speed,
                color: PIE_COLORS[stack.length % PIE_COLORS.length],
                dropping: false,
                dropY: 0
            };
        }

        function pieScreenY(level) {
            // Bottom pie sits near the bottom of the canvas.
            return H - 70 - level * PIE_H + cameraY;
        }

        function drop() {
            if (!alive || !mover || mover.dropping) return;
            started = true;

            const top = stack[stack.length - 1];
            const overlapStart = Math.max(mover.x, top.x);
            const overlapEnd = Math.min(mover.x + mover.w, top.x + top.w);
            const overlap = overlapEnd - overlapStart;

            if (overlap <= 6) {
                // Complete miss — pie falls off.
                alive = false;
                mover.dropping = true;
                mover.dropY = pieScreenY(mover.y);
                host.vibrate([70, 40, 90]);
                SGSound.play("miss");
                setTimeout(() => host.gameOver(score), 800);
                return;
            }

            // Spawn crumbs for the trimmed part.
            const cutLeft = mover.x < overlapStart;
            const trimmed = mover.w - overlap;
            if (trimmed > 1) {
                const crumbX = cutLeft ? mover.x : overlapEnd;
                spawnCrumbs(crumbX, trimmed, pieScreenY(mover.y), mover.color);
            }

            const perfect = trimmed < PERFECT_TOL;
            if (perfect) {
                // Perfect drop: keep full width, snap into place, bonus point.
                mover.x = top.x;
                mover.w = top.w;
                score += 2;
                host.vibrate([15, 30, 15]);
                SGSound.play("perfect");
            } else {
                mover.x = overlapStart;
                mover.w = overlap;
                score += 1;
                host.vibrate(15);
                SGSound.play("drop");
            }
            host.setScore(score);

            stack.push({ x: mover.x, w: mover.w, y: mover.y, color: mover.color, wobble: perfect ? 1 : 0 });

            // Move camera up as the tower grows.
            const towerTopScreen = pieScreenY(stack.length);
            if (towerTopScreen < H * 0.42) {
                targetCameraY += PIE_H;
            }

            newMover();
        }

        function spawnCrumbs(x, w, y, color) {
            const n = Math.min(Math.floor(w / 7) + 3, 16);
            for (let i = 0; i < n; i++) {
                crumbs.push({
                    x: x + Math.random() * w,
                    y: y + Math.random() * PIE_H,
                    vx: (Math.random() - 0.5) * 90,
                    vy: -Math.random() * 60,
                    size: Math.random() * 5 + 3,
                    color: Math.random() > 0.5 ? color.filling : color.crust,
                    life: 1
                });
            }
        }

        function update(dt) {
            cameraY += (targetCameraY - cameraY) * Math.min(dt * 6, 1);

            if (mover && !mover.dropping && alive) {
                mover.x += mover.dir * mover.speed * dt;
                if (mover.x < -mover.w * 0.4) { mover.x = -mover.w * 0.4; mover.dir = 1; }
                if (mover.x + mover.w > W + mover.w * 0.4) { mover.x = W + mover.w * 0.4 - mover.w; mover.dir = -1; }
            }

            if (mover && mover.dropping) {
                mover.dropY += 540 * dt;
            }

            for (let i = crumbs.length - 1; i >= 0; i--) {
                const c = crumbs[i];
                c.vy += 600 * dt;
                c.x += c.vx * dt;
                c.y += c.vy * dt;
                c.life -= dt * 0.9;
                if (c.life <= 0 || c.y > H + 30) crumbs.splice(i, 1);
            }

            for (const p of stack) {
                if (p.wobble > 0) p.wobble = Math.max(0, p.wobble - dt * 2.4);
            }
        }

        function drawPie(x, y, w, color, wobble) {
            const squish = wobble ? Math.sin(wobble * Math.PI) * 3 : 0;
            const h = PIE_H - 4;

            // Pie dish/crust base
            ctx.fillStyle = "#c98c3f";
            roundRect(x, y + h - 8 - squish, w, 8 + squish, 4);

            // Filling
            ctx.fillStyle = color.filling;
            roundRect(x + 2, y + 4, w - 4, h - 10, 6);

            // Crust top with scallops
            ctx.fillStyle = color.crust;
            const scallops = Math.max(Math.floor(w / 16), 3);
            const sw = w / scallops;
            for (let i = 0; i < scallops; i++) {
                ctx.beginPath();
                ctx.arc(x + sw * i + sw / 2, y + 5, sw * 0.42, 0, Math.PI * 2);
                ctx.fill();
            }

            // Steam wisp on top pie only adds charm: skipped for perf.
            // Highlight
            ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
            roundRect(x + 4, y + 6, Math.max(w * 0.25, 8), 4, 2);
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
            // Sky gradient
            const grad = ctx.createLinearGradient(0, 0, 0, H);
            grad.addColorStop(0, "#1b1b30");
            grad.addColorStop(1, "#2a2040");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, H);

            // Counter/table
            ctx.fillStyle = "#3a2c4a";
            ctx.fillRect(0, H - 70 + PIE_H + cameraY, W, Math.max(70 + H, H));

            // Stack
            for (const p of stack) {
                drawPie(p.x, pieScreenY(p.y), p.w, p.color, p.wobble);
            }

            // Mover
            if (mover && alive) {
                drawPie(mover.x, mover.dropping ? mover.dropY : pieScreenY(mover.y), mover.w, mover.color, 0);
            } else if (mover && mover.dropping) {
                drawPie(mover.x, mover.dropY, mover.w, mover.color, 0);
            }

            // Crumbs
            for (const c of crumbs) {
                ctx.globalAlpha = Math.max(c.life, 0);
                ctx.fillStyle = c.color;
                ctx.fillRect(c.x, c.y, c.size, c.size);
            }
            ctx.globalAlpha = 1;

            if (!started && alive) {
                ctx.fillStyle = "rgba(242, 243, 255, 0.85)";
                ctx.font = "700 17px system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("Tap to drop the pie!", W / 2, H * 0.3);
                ctx.font = "500 14px system-ui, sans-serif";
                ctx.fillStyle = "rgba(154, 160, 195, 0.9)";
                ctx.fillText("Line it up with the stack below", W / 2, H * 0.3 + 26);
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
            drop();
        }

        function onKey(e) {
            if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                drop();
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
    window.SGGames.piestack = {
        id: "piestack",
        name: "Pie Stack",
        emoji: "\u{1F967}",
        tag: "Tap to drop. Stack pies sky-high.",
        scoreLabel: "pies",
        create: create
    };
})();
