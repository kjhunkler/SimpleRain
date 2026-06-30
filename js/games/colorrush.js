/* ============ Color Rush — tap only the matching color ============ */
(function () {
    "use strict";

    const COLORS = [
        { name: "RED", value: "#ff5d5d" },
        { name: "BLUE", value: "#39d0ff" },
        { name: "GREEN", value: "#5ef58a" },
        { name: "YELLOW", value: "#ffd166" },
        { name: "PINK", value: "#ff4d8d" },
        { name: "PURPLE", value: "#8e5bd6" }
    ];

    function create(host) {
        const canvas = host.canvas;
        const ctx = canvas.getContext("2d");

        let W, H;
        let bubbles, targetIdx, score, lives, alive, started, elapsed;
        let spawnTimer, switchTimer, pulse;
        let switchInterval, warning, warnPulse, changeFlash;
        let rafId, lastTs;
        const MAX_LIVES = 3;
        const kids = !!host.kids;
        const DIFF_RAMP = kids ? 110 : 75;
        const SPEED_SCALE = kids ? 0.7 : 1;
        const SWITCH_BASE = kids ? 12 : 9;
        const SWITCH_MIN = kids ? 7 : 5;
        const WARN_LEAD = kids ? 2.6 : 1.8;

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = canvas.clientWidth;
            H = canvas.clientHeight;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        function reset() {
            bubbles = [];
            targetIdx = Math.floor(Math.random() * COLORS.length);
            score = 0;
            lives = MAX_LIVES;
            alive = true;
            started = false;
            elapsed = 0;
            spawnTimer = 0;
            switchTimer = 0;
            switchInterval = SWITCH_BASE;
            warning = false;
            warnPulse = 0;
            changeFlash = 0;
            pulse = 0;
            lastTs = 0;
            host.setScore(0);
        }

        function difficulty() {
            return Math.min(elapsed / DIFF_RAMP, 1);
        }

        function spawnBubble() {
            const d = difficulty();
            const r = 26 + Math.random() * 16 - d * 6;
            // Guarantee a decent share of target-colored bubbles.
            const isTarget = Math.random() < 0.42;
            const idx = isTarget
                ? targetIdx
                : (targetIdx + 1 + Math.floor(Math.random() * (COLORS.length - 1))) % COLORS.length;
            bubbles.push({
                x: r + Math.random() * (W - r * 2),
                y: H + r,
                r: r,
                vy: -(46 + Math.random() * 30 + d * 55) * SPEED_SCALE,
                wob: Math.random() * Math.PI * 2,
                wobSpeed: 1.2 + Math.random() * 1.6,
                color: idx,
                pop: 0,
                missed: false
            });
        }

        function switchTarget() {
            let next;
            do {
                next = Math.floor(Math.random() * COLORS.length);
            } while (next === targetIdx);
            targetIdx = next;
            pulse = 1;
            warning = false;
            warnPulse = 0;
            changeFlash = 1;
            host.vibrate([30, 40, 30]);
            SGSound.play("match");
        }

        function loseLife() {
            lives -= 1;
            host.vibrate(30);
            SGSound.play("wrong");
            if (lives <= 0) {
                alive = false;
                setTimeout(() => host.gameOver(score), 600);
            }
        }

        function update(dt) {
            if (pulse > 0) pulse = Math.max(0, pulse - dt * 2.2);
            if (changeFlash > 0) changeFlash = Math.max(0, changeFlash - dt * 1.6);
            if (warning) warnPulse += dt * 7;
            if (!alive) return;
            if (!started) return;

            elapsed += dt;
            const d = difficulty();

            spawnTimer -= dt;
            if (spawnTimer <= 0) {
                spawnTimer = Math.max(0.3, 0.85 - d * 0.45);
                spawnBubble();
            }

            switchTimer += dt;
            switchInterval = Math.max(SWITCH_MIN, SWITCH_BASE - d * 4);
            // Flag an upcoming change so the player gets a heads-up countdown.
            if (!warning && switchTimer >= switchInterval - WARN_LEAD) {
                warning = true;
                warnPulse = 0;
                host.vibrate(15);
                SGSound.play("flip");
            }
            if (switchTimer >= switchInterval) {
                switchTimer = 0;
                switchTarget();
            }

            for (let i = bubbles.length - 1; i >= 0; i--) {
                const b = bubbles[i];
                if (b.pop > 0) {
                    b.pop += dt * 5;
                    if (b.pop >= 1.6) bubbles.splice(i, 1);
                    continue;
                }
                b.wob += b.wobSpeed * dt;
                b.x += Math.sin(b.wob) * 26 * dt;
                b.y += b.vy * dt;

                if (b.y < -b.r) {
                    // A target bubble escaping costs a life.
                    if (b.color === targetIdx && !b.missed) {
                        b.missed = true;
                        loseLife();
                    }
                    bubbles.splice(i, 1);
                }
            }
        }

        function tapAt(x, y) {
            if (!alive) return;
            if (!started) {
                started = true;
                host.vibrate(10);
                return;
            }

            for (let i = bubbles.length - 1; i >= 0; i--) {
                const b = bubbles[i];
                if (b.pop > 0) continue;
                const dx = x - b.x, dy = y - b.y;
                if (dx * dx + dy * dy <= (b.r + 10) * (b.r + 10)) {
                    if (b.color === targetIdx) {
                        b.pop = 0.01;
                        score += 1;
                        host.setScore(score);
                        host.vibrate(10);
                        SGSound.play("score");
                    } else {
                        b.pop = 0.01;
                        loseLife();
                    }
                    return;
                }
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
            grad.addColorStop(0, "#181830");
            grad.addColorStop(1, "#241634");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, H);

            // Bubbles
            for (const b of bubbles) {
                const popScale = b.pop > 0 ? 1 + b.pop * 0.5 : 1;
                const alpha = b.pop > 0 ? Math.max(1 - b.pop, 0) : 1;
                ctx.globalAlpha = alpha;
                ctx.fillStyle = COLORS[b.color].value;
                ctx.beginPath();
                ctx.arc(b.x, b.y, b.r * popScale, 0, Math.PI * 2);
                ctx.fill();
                // Shine
                ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
                ctx.beginPath();
                ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.35, b.r * 0.22 * popScale, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;

            // Warning border glow as a color change approaches.
            if (warning && alive && started) {
                const blink = 0.5 + 0.5 * Math.sin(warnPulse);
                ctx.save();
                ctx.lineWidth = 12;
                ctx.strokeStyle = COLORS[targetIdx].value;
                ctx.globalAlpha = 0.25 + blink * 0.5;
                ctx.strokeRect(6, 6, W - 12, H - 12);
                ctx.restore();
                ctx.globalAlpha = 1;
            }

            // Full-screen flash the instant the color changes.
            if (changeFlash > 0) {
                ctx.save();
                ctx.globalAlpha = changeFlash * 0.5;
                ctx.fillStyle = COLORS[targetIdx].value;
                ctx.fillRect(0, 0, W, H);
                ctx.restore();
                ctx.globalAlpha = 1;
            }

            // Target banner
            const bannerY = 26;
            const warnBlink = warning ? 0.5 + 0.5 * Math.sin(warnPulse) : 0;
            const scale = 1 + pulse * 0.18 + changeFlash * 0.22 + warnBlink * 0.12;
            ctx.save();
            ctx.translate(W / 2, bannerY + 14);
            ctx.scale(scale, scale);
            const bw = 190;
            if (warning) {
                // Highlight the banner so the upcoming change is unmissable.
                ctx.fillStyle = COLORS[targetIdx].value;
                ctx.globalAlpha = 0.25 + warnBlink * 0.55;
                roundRect(-bw / 2 - 5, -29, bw + 10, 58, 28);
                ctx.globalAlpha = 1;
            }
            ctx.fillStyle = "rgba(18, 18, 31, 0.78)";
            roundRect(-bw / 2, -24, bw, 48, 24);
            ctx.fillStyle = warning ? COLORS[targetIdx].value : "rgba(242, 243, 255, 0.75)";
            ctx.font = "800 11px system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(warning ? "\u26A0\uFE0F CHANGING SOON \u26A0\uFE0F" : "POP ONLY", 0, -7);
            ctx.fillStyle = COLORS[targetIdx].value;
            ctx.font = "800 21px system-ui, sans-serif";
            ctx.fillText(COLORS[targetIdx].name, 0, 15);
            ctx.restore();

            // Lives
            ctx.font = "20px system-ui, sans-serif";
            ctx.textAlign = "left";
            for (let i = 0; i < MAX_LIVES; i++) {
                ctx.globalAlpha = i < lives ? 1 : 0.22;
                ctx.fillText("\u2764\uFE0F", 14, 34 + i * 28);
            }
            ctx.globalAlpha = 1;

            if (!started && alive) {
                ctx.fillStyle = "rgba(242, 243, 255, 0.85)";
                ctx.font = "700 17px system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("Tap to start!", W / 2, H * 0.42);
                ctx.font = "500 14px system-ui, sans-serif";
                ctx.fillStyle = "rgba(154, 160, 195, 0.9)";
                ctx.fillText("Pop bubbles that match the color above", W / 2, H * 0.42 + 26);
                ctx.fillText("Wrong color or escaped match = lost heart", W / 2, H * 0.42 + 48);
                ctx.fillText("Watch for the \u26A0\uFE0F warning \u2014 the color changes!", W / 2, H * 0.42 + 70);
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
    window.SGGames.colorrush = {
        id: "colorrush",
        name: "Color Rush",
        emoji: "\u{1F388}",
        tag: "Pop only the matching color!",
        scoreLabel: "bubbles",
        create: create
    };
})();
