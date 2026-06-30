/* ============ Lane Dash — swipe between lanes, dodge the traffic ============ */
(function () {
    "use strict";

    const LANES = 3;

    const CAR_COLORS = [
        { body: "#ff5d5d", dark: "#c23a3a" },
        { body: "#ff8c42", dark: "#cc6a2c" },
        { body: "#8e5bd6", dark: "#6a41a6" },
        { body: "#5ea9f5", dark: "#3f7fc2" },
        { body: "#5ec97c", dark: "#3f9c5a" }
    ];

    function create(host) {
        const canvas = host.canvas;
        const ctx = canvas.getContext("2d");

        let W, H, laneW;
        let player, things, dashes, scenery, sparks, score, coins, distance;
        let alive, started, lives, invuln;
        let spawnTimer, speed, lastOpenLane;
        let rafId, lastTs;
        let touchStartX = 0, touchStartY = 0, touchMoved = false;
        const kids = !!host.kids;
        const MAX_LIVES = kids ? 5 : 3;
        const GRACE_TIME = kids ? 3 : 2.2;
        // Kids mode: slower traffic and noticeably wider spacing between rows so
        // there's more time to react and slip into the open lane. The wider gap
        // also keeps consecutive rows from overlapping into one collision band
        // (which previously could block all three lanes at once).
        const SPEED_SCALE = kids ? 0.5 : 1;
        const SPAWN_BASE = kids ? 1.2 : 0.85;
        const SPAWN_MIN = kids ? 0.8 : 0.42;
        const FIRST_SPAWN = kids ? 0.8 : 0.4;

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = canvas.clientWidth;
            H = canvas.clientHeight;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            laneW = Math.min(W / LANES, 150);
        }

        function laneX(lane) {
            const roadW = laneW * LANES;
            return (W - roadW) / 2 + lane * laneW + laneW / 2;
        }

        function reset() {
            player = { lane: 1, x: laneX(1), w: 44, h: 74, tilt: 0, bob: 0 };
            things = [];
            dashes = [];
            for (let i = 0; i < 10; i++) {
                dashes.push({ y: i * (H / 8) });
            }
            scenery = [];
            for (let i = 0; i < 8; i++) {
                scenery.push(makeScenery(Math.random() * H));
            }
            sparks = [];
            score = 0;
            coins = 0;
            distance = 0;
            alive = true;
            started = false;
            lives = MAX_LIVES;
            invuln = 0;
            spawnTimer = FIRST_SPAWN;
            speed = 300 * SPEED_SCALE;
            lastOpenLane = 1;
            lastTs = 0;
            host.setScore(0);
        }

        function makeScenery(y) {
            const roadW = laneW * LANES;
            const rx = (W - roadW) / 2;
            const left = Math.random() < 0.5;
            const margin = Math.max(rx - 14, 18);
            return {
                y: y,
                x: left ? Math.random() * margin * 0.7 + 6 : W - (Math.random() * margin * 0.7 + 6) - 20,
                kind: Math.random() < 0.7 ? "tree" : "bush",
                s: 0.8 + Math.random() * 0.5
            };
        }

        function spawnRow() {
            // Always keep one lane open, drifting it by at most one lane from
            // the previous row so it stays reachable. Combined with uniform
            // obstacle speed (rows never overlap into the same band), this
            // guarantees the three lanes are never all blocked at once.
            const openLane = Math.max(0, Math.min(LANES - 1,
                lastOpenLane + (Math.floor(Math.random() * 3) - 1)));
            lastOpenLane = openLane;

            // Candidate lanes to block (everything but the open one), shuffled.
            const blockable = [0, 1, 2].filter((l) => l !== openLane);
            for (let i = blockable.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const tmp = blockable[i]; blockable[i] = blockable[j]; blockable[j] = tmp;
            }
            // Block one lane usually; both (max) more often as you speed up.
            const blockBoth = Math.random() < Math.min(0.18 + distance / 4000, 0.6);
            const count = blockBoth ? 2 : 1;

            for (let i = 0; i < count; i++) {
                const lane = blockable[i];
                // Semi trucks (longer, harder to dodge) mix in with the cars.
                // They travel at the same speed as everything else so the
                // "one lane always reachable" guarantee above still holds.
                const truck = Math.random() < 0.22;
                things.push({
                    lane: lane,
                    y: -90,
                    coin: false,
                    kind: truck ? "truck" : "car",
                    color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
                    w: truck ? 48 : 44,
                    h: truck ? 100 : 74,
                    wob: Math.random() * Math.PI * 2
                });
            }
            // Sometimes drop a star in the open lane to reward staying on path.
            if (Math.random() < 0.45) {
                things.push({ lane: openLane, y: -60, coin: true, w: 30, h: 30, spin: 0 });
            }
        }

        function steer(dx) {
            if (!alive) return;
            started = true;
            const next = Math.max(0, Math.min(LANES - 1, player.lane + dx));
            if (next !== player.lane) {
                player.lane = next;
                player.tilt = dx * 0.3;
                host.vibrate(8);
                SGSound.play("flip");
            }
        }

        function crash() {
            lives -= 1;
            host.vibrate([80, 50, 110]);
            SGSound.play("explode");
            for (let i = 0; i < 18; i++) {
                const a = Math.random() * Math.PI * 2;
                const sp = Math.random() * 200 + 60;
                sparks.push({
                    x: player.x, y: H - 110,
                    vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                    life: 1, color: Math.random() < 0.5 ? "#ffd166" : "#ff8c42",
                    size: Math.random() * 4 + 2
                });
            }
            if (lives <= 0) {
                alive = false;
                setTimeout(() => host.gameOver(score), 700);
            } else {
                // Grace period: flashing & invulnerable so you can recover.
                invuln = GRACE_TIME;
            }
        }

        function update(dt) {
            const dashSpeed = started && alive ? speed : 120;
            for (const d of dashes) {
                d.y += dashSpeed * dt;
                if (d.y > H) d.y -= H + H / 8;
            }
            for (const s of scenery) {
                s.y += dashSpeed * 0.92 * dt;
                if (s.y > H + 40) {
                    const ns = makeScenery(-40);
                    s.x = ns.x; s.kind = ns.kind; s.s = ns.s;
                    s.y = -40;
                }
            }

            for (let i = sparks.length - 1; i >= 0; i--) {
                const p = sparks[i];
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.life -= dt * 2.2;
                if (p.life <= 0) sparks.splice(i, 1);
            }

            player.x += (laneX(player.lane) - player.x) * Math.min(dt * 14, 1);
            player.tilt *= Math.pow(0.02, dt);
            player.bob += dt * 14;

            if (invuln > 0) invuln = Math.max(0, invuln - dt);

            if (!alive || !started) return;

            distance += speed * dt;
            speed = (300 + Math.min(distance / 30, 320)) * SPEED_SCALE;

            spawnTimer -= dt;
            if (spawnTimer <= 0) {
                spawnTimer = Math.max(SPAWN_MIN, SPAWN_BASE - distance / 9000);
                spawnRow();
            }

            const py = H - 110;
            for (let i = things.length - 1; i >= 0; i--) {
                const t = things[i];
                t.y += speed * dt; // uniform speed keeps rows spaced so a path always exists
                if (t.coin) t.spin += dt * 5;
                if (t.wob !== undefined) t.wob += dt * 3;

                if (t.y > H + 90) {
                    things.splice(i, 1);
                    continue;
                }

                if (t.lane === player.lane && Math.abs(t.y - py) < (t.h + player.h) * 0.42) {
                    if (t.coin) {
                        things.splice(i, 1);
                        coins += 1;
                        host.vibrate(10);
                        SGSound.play("score");
                    } else if (invuln <= 0) {
                        things.splice(i, 1);
                        crash();
                        if (!alive) return;
                    }
                }
            }

            const total = Math.floor(distance / 400) + coins * 5;
            if (total !== score) {
                score = total;
                host.setScore(score);
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

        /** Vector car drawn nose-down (traffic) or nose-up (player). */
        function drawCar(x, y, w, h, colors, facingUp, braking) {
            ctx.save();
            ctx.translate(x, y);

            // Drop shadow
            ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
            ctx.beginPath();
            ctx.ellipse(0, h * 0.06, w * 0.62, h * 0.52, 0, 0, Math.PI * 2);
            ctx.fill();

            // Body
            ctx.fillStyle = colors.body;
            roundRect(-w / 2, -h / 2, w, h, w * 0.28);

            // Cabin glass
            ctx.fillStyle = "#1b2438";
            roundRect(-w * 0.34, facingUp ? -h * 0.18 : -h * 0.34, w * 0.68, h * 0.4, w * 0.16);

            // Roof stripe
            ctx.fillStyle = colors.dark;
            roundRect(-w * 0.34, facingUp ? h * 0.26 : -h * 0.46, w * 0.68, h * 0.16, w * 0.08);

            // Wheels (poking out the sides)
            ctx.fillStyle = "#12121f";
            const wy = [-h * 0.30, h * 0.18];
            for (const yy of wy) {
                roundRect(-w / 2 - 4, yy, 6, h * 0.2, 3);
                roundRect(w / 2 - 2, yy, 6, h * 0.2, 3);
            }

            // Lights
            const ly = facingUp ? -h / 2 + 3 : h / 2 - 9;
            ctx.fillStyle = facingUp ? "#fff3c4" : (braking ? "#ff5d5d" : "#ffb3b3");
            roundRect(-w * 0.36, ly, w * 0.2, 6, 3);
            roundRect(w * 0.16, ly, w * 0.2, 6, 3);

            ctx.restore();
        }

        /** Semi truck: a boxy trailer with a small cab, drawn nose-down. */
        function drawTruck(x, y, w, h, colors, wob) {
            ctx.save();
            ctx.translate(x, y + Math.sin(wob) * 0.8);

            // Drop shadow
            ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
            ctx.beginPath();
            ctx.ellipse(0, h * 0.04, w * 0.66, h * 0.52, 0, 0, Math.PI * 2);
            ctx.fill();

            // Wheels (poking out along the length)
            ctx.fillStyle = "#12121f";
            const wy = [-h * 0.34, -h * 0.04, h * 0.26];
            for (const yy of wy) {
                roundRect(-w / 2 - 4, yy, 6, h * 0.16, 3);
                roundRect(w / 2 - 2, yy, 6, h * 0.16, 3);
            }

            // Trailer (the long rear box)
            ctx.fillStyle = "#e8eaf2";
            roundRect(-w / 2, -h * 0.46, w, h * 0.7, w * 0.12);
            // Trailer seam lines
            ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
            for (let i = 1; i < 3; i++) {
                ctx.fillRect(-w / 2, -h * 0.46 + (h * 0.7) * (i / 3), w, 2);
            }

            // Cab (nose, painted in the truck's color)
            ctx.fillStyle = colors.body;
            roundRect(-w / 2, h * 0.18, w, h * 0.28, w * 0.2);
            // Windshield
            ctx.fillStyle = "#1b2438";
            roundRect(-w * 0.36, h * 0.2, w * 0.72, h * 0.1, w * 0.1);
            // Headlights
            ctx.fillStyle = "#fff3c4";
            roundRect(-w * 0.38, h / 2 - 8, w * 0.18, 6, 3);
            roundRect(w * 0.2, h / 2 - 8, w * 0.18, 6, 3);

            ctx.restore();
        }

        function drawStar(x, y, r, spin) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(Math.sin(spin) * 0.35);
            ctx.fillStyle = "#ffd166";
            ctx.beginPath();
            for (let i = 0; i < 5; i++) {
                const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
                const a2 = a + Math.PI / 5;
                ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
                ctx.lineTo(Math.cos(a2) * r * 0.45, Math.sin(a2) * r * 0.45);
            }
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
            ctx.beginPath();
            ctx.arc(-r * 0.2, -r * 0.25, r * 0.16, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        function drawScenery(s) {
            ctx.save();
            ctx.translate(s.x + 10, s.y);
            ctx.scale(s.s, s.s);
            if (s.kind === "tree") {
                ctx.fillStyle = "#5a3d28";
                ctx.fillRect(-3, 2, 6, 14);
                ctx.fillStyle = "#2f6e42";
                ctx.beginPath();
                ctx.arc(0, -6, 13, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = "#3f8a54";
                ctx.beginPath();
                ctx.arc(-5, -10, 8, 0, Math.PI * 2);
                ctx.arc(6, -8, 7, 0, Math.PI * 2);
                ctx.fill();
            } else {
                ctx.fillStyle = "#37704a";
                ctx.beginPath();
                ctx.arc(-6, 6, 8, 0, Math.PI * 2);
                ctx.arc(5, 4, 9, 0, Math.PI * 2);
                ctx.arc(0, 0, 8, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        function draw() {
            // Grass with subtle vertical shading
            const grad = ctx.createLinearGradient(0, 0, 0, H);
            grad.addColorStop(0, "#1a2e20");
            grad.addColorStop(1, "#142318");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, H);

            for (const s of scenery) drawScenery(s);

            // Road
            const roadW = laneW * LANES;
            const rx = (W - roadW) / 2;
            ctx.fillStyle = "#2a2a45";
            ctx.fillRect(rx, 0, roadW, H);
            // Road texture: darker center wear lines per lane
            ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
            for (let l = 0; l < LANES; l++) {
                ctx.fillRect(rx + l * laneW + laneW * 0.18, 0, laneW * 0.64, H);
            }

            // Edge lines
            ctx.fillStyle = "#ffd166";
            ctx.fillRect(rx - 6, 0, 5, H);
            ctx.fillRect(rx + roadW + 1, 0, 5, H);
            ctx.fillStyle = "#f2f3ff";
            ctx.fillRect(rx - 1, 0, 2, H);
            ctx.fillRect(rx + roadW - 1, 0, 2, H);

            // Lane dashes
            ctx.fillStyle = "rgba(242, 243, 255, 0.4)";
            for (let l = 1; l < LANES; l++) {
                const x = rx + l * laneW;
                for (const d of dashes) {
                    roundRect(x - 3, d.y, 6, H / 16, 3);
                }
            }

            // Things
            for (const t of things) {
                const x = laneX(t.lane);
                if (t.coin) drawStar(x, t.y, t.w * 0.62, t.spin);
                else if (t.kind === "truck") drawTruck(x, t.y, t.w, t.h, t.color, t.wob);
                else drawCar(x, t.y, t.w, t.h, t.color, false, Math.sin(t.wob) > 0.6);
            }

            // Sparks
            for (const p of sparks) {
                ctx.globalAlpha = Math.max(p.life, 0);
                ctx.fillStyle = p.color;
                ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
            }
            ctx.globalAlpha = 1;

            // Player car (blinks during grace period)
            const py = H - 110;
            const blink = invuln > 0 && Math.floor(invuln * 8) % 2 === 0;
            if (!blink && (alive || sparks.length === 0)) {
                const bobY = py + Math.sin(player.bob) * 1.2;
                ctx.save();
                ctx.translate(player.x, bobY);
                ctx.rotate(player.tilt);
                drawCar(0, 0, player.w, player.h, { body: "#39d0ff", dark: "#2898bd" }, true, false);
                ctx.restore();
            }

            // Lives
            for (let i = 0; i < MAX_LIVES; i++) {
                const lx = 24 + i * 28;
                ctx.globalAlpha = i < lives ? 1 : 0.2;
                drawHeart(lx, 26, 9);
            }
            ctx.globalAlpha = 1;

            if (!started && alive) {
                ctx.fillStyle = "rgba(242, 243, 255, 0.85)";
                ctx.font = "700 17px system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("Swipe left & right to dodge!", W / 2, H * 0.32);
                ctx.font = "500 14px system-ui, sans-serif";
                ctx.fillStyle = "rgba(154, 160, 195, 0.9)";
                ctx.fillText("Grab the stars for bonus points", W / 2, H * 0.32 + 26);
            }
        }

        function drawHeart(x, y, r) {
            ctx.fillStyle = "#ff5d5d";
            ctx.beginPath();
            ctx.moveTo(x, y + r * 0.9);
            ctx.bezierCurveTo(x - r * 1.4, y - r * 0.2, x - r * 0.7, y - r * 1.2, x, y - r * 0.3);
            ctx.bezierCurveTo(x + r * 0.7, y - r * 1.2, x + r * 1.4, y - r * 0.2, x, y + r * 0.9);
            ctx.fill();
        }

        function loop(ts) {
            rafId = requestAnimationFrame(loop);
            if (!lastTs) lastTs = ts;
            const dt = Math.min((ts - lastTs) / 1000, 0.05);
            lastTs = ts;
            update(dt);
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
            if (Math.abs(dx) < 24 || Math.abs(dx) < Math.abs(dy)) return;
            touchMoved = true;
            steer(dx > 0 ? 1 : -1);
        }

        function onTouchEnd(e) {
            if (touchMoved) return;
            const rect = canvas.getBoundingClientRect();
            const x = e.changedTouches[0].clientX - rect.left;
            steer(x > player.x ? 1 : -1);
        }

        function onKey(e) {
            if (e.key === "ArrowLeft" || e.key === "a") { e.preventDefault(); steer(-1); }
            else if (e.key === "ArrowRight" || e.key === "d") { e.preventDefault(); steer(1); }
        }

        function onMouseDown(e) {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            steer(x > player.x ? 1 : -1);
        }

        return {
            start() {
                resize();
                reset();
                window.addEventListener("resize", resize);
                canvas.addEventListener("touchstart", onTouchStart, { passive: true });
                canvas.addEventListener("touchmove", onTouchMove, { passive: false });
                canvas.addEventListener("touchend", onTouchEnd);
                canvas.addEventListener("mousedown", onMouseDown);
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
                canvas.removeEventListener("touchend", onTouchEnd);
                canvas.removeEventListener("mousedown", onMouseDown);
                window.removeEventListener("keydown", onKey);
            }
        };
    }

    window.SGGames = window.SGGames || {};
    window.SGGames.lanedash = {
        id: "lanedash",
        name: "Lane Dash",
        emoji: "\u{1F3CE}\uFE0F",
        tag: "Swipe lanes. Dodge traffic. Grab stars.",
        scoreLabel: "points",
        create: create
    };
})();

