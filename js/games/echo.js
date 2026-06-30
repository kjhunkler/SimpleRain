/* ============ Echo Pads — watch the pattern, tap it back ============ */
(function () {
    "use strict";

    const PADS = [
        { base: "#2f7d4c", lit: "#5ef58a", note: "note0" },
        { base: "#9c2f44", lit: "#ff5d7d", note: "note1" },
        { base: "#9c7c2f", lit: "#ffd166", note: "note2" },
        { base: "#2f5d9c", lit: "#39d0ff", note: "note3" }
    ];

    function create(host) {
        const canvas = host.canvas;
        const ctx = canvas.getContext("2d");

        let W, H, padSize, gap, gridX, gridY;
        let seq, inputIndex, score, state, alive;
        let showTimer, lastShown, gapTimer, flash;
        let rafId, lastTs;
        const kids = !!host.kids;
        const STEP_BASE = kids ? 0.72 : 0.55;
        const STEP_MIN = kids ? 0.42 : 0.3;
        const STEP_RAMP = kids ? 0.01 : 0.015;

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = canvas.clientWidth;
            H = canvas.clientHeight;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            gap = 14;
            padSize = Math.min((W - gap - 48) / 2, (H - gap - 170) / 2, 175);
            gridX = (W - (padSize * 2 + gap)) / 2;
            gridY = (H - (padSize * 2 + gap)) / 2 + 14;
        }

        function reset() {
            seq = [];
            inputIndex = 0;
            score = 0;
            state = "idle";     // idle | show | input | gap | dead
            alive = true;
            showTimer = 0;
            lastShown = -1;
            gapTimer = 0;
            flash = [0, 0, 0, 0];
            lastTs = 0;
            host.setScore(0);
        }

        function stepDur() {
            return Math.max(STEP_MIN, STEP_BASE - seq.length * STEP_RAMP);
        }

        function beginRound() {
            seq.push(Math.floor(Math.random() * 4));
            state = "show";
            showTimer = 0;
            lastShown = -1;
        }

        function padRect(i) {
            return {
                x: gridX + (i % 2) * (padSize + gap),
                y: gridY + Math.floor(i / 2) * (padSize + gap)
            };
        }

        function lightPad(i) {
            flash[i] = 1;
            SGSound.play(PADS[i].note);
        }

        function tapAt(x, y) {
            if (!alive) return;

            if (state === "idle") {
                beginRound();
                host.vibrate(10);
                return;
            }
            if (state !== "input") return;

            for (let i = 0; i < 4; i++) {
                const r = padRect(i);
                if (x >= r.x && x <= r.x + padSize && y >= r.y && y <= r.y + padSize) {
                    pressPad(i);
                    return;
                }
            }
        }

        function pressPad(i) {
            lightPad(i);
            host.vibrate(8);

            if (i !== seq[inputIndex]) {
                // Wrong pad — game over.
                alive = false;
                state = "dead";
                SGSound.play("wrong");
                host.vibrate([70, 40, 90]);
                flash[seq[inputIndex]] = 1.6; // show what it should have been
                setTimeout(() => host.gameOver(score), 900);
                return;
            }

            inputIndex += 1;
            if (inputIndex >= seq.length) {
                score = seq.length;
                host.setScore(score);
                SGSound.play("score");
                host.vibrate([10, 20, 10]);
                state = "gap";
                gapTimer = 0;
            }
        }

        function update(dt) {
            for (let i = 0; i < 4; i++) {
                if (flash[i] > 0) flash[i] = Math.max(0, flash[i] - dt * 3.2);
            }

            if (state === "show") {
                showTimer += dt;
                const step = Math.floor(showTimer / stepDur());
                if (step !== lastShown) {
                    if (step < seq.length) {
                        lastShown = step;
                        lightPad(seq[step]);
                    } else {
                        state = "input";
                        inputIndex = 0;
                    }
                }
            } else if (state === "gap") {
                gapTimer += dt;
                if (gapTimer >= 0.7) beginRound();
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
            grad.addColorStop(0, "#1b1b30");
            grad.addColorStop(1, "#1d1530");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, H);

            for (let i = 0; i < 4; i++) {
                const r = padRect(i);
                const lit = Math.min(flash[i], 1);
                ctx.save();
                if (lit > 0) {
                    ctx.shadowColor = PADS[i].lit;
                    ctx.shadowBlur = 28 * lit;
                }
                ctx.fillStyle = lit > 0.05 ? PADS[i].lit : PADS[i].base;
                ctx.globalAlpha = lit > 0.05 ? 0.45 + lit * 0.55 : 1;
                roundRect(r.x, r.y, padSize, padSize, 22);
                ctx.restore();
                ctx.globalAlpha = 1;
            }

            // Status text
            ctx.textAlign = "center";
            if (state === "idle") {
                ctx.fillStyle = "rgba(242, 243, 255, 0.85)";
                ctx.font = "700 17px system-ui, sans-serif";
                ctx.fillText("Tap to start", W / 2, gridY - 40);
                ctx.font = "500 14px system-ui, sans-serif";
                ctx.fillStyle = "rgba(154, 160, 195, 0.9)";
                ctx.fillText("Watch the pattern, then repeat it", W / 2, gridY - 18);
            } else if (state === "show") {
                ctx.fillStyle = "rgba(255, 209, 102, 0.95)";
                ctx.font = "700 17px system-ui, sans-serif";
                ctx.fillText("Watch\u2026 \u{1F440}", W / 2, gridY - 24);
            } else if (state === "input") {
                ctx.fillStyle = "rgba(94, 245, 138, 0.95)";
                ctx.font = "700 17px system-ui, sans-serif";
                ctx.fillText("Your turn! (" + inputIndex + "/" + seq.length + ")", W / 2, gridY - 24);
            } else if (state === "gap") {
                ctx.fillStyle = "rgba(242, 243, 255, 0.85)";
                ctx.font = "700 17px system-ui, sans-serif";
                ctx.fillText("Round " + (seq.length + 1) + "!", W / 2, gridY - 24);
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
            tapAt(p.x, p.y);
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
    window.SGGames.echo = {
        id: "echo",
        name: "Echo Pads",
        emoji: "\u{1F3B5}",
        tag: "Watch the pattern. Tap it back.",
        scoreLabel: "rounds",
        create: create
    };
})();
