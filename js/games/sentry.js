/* ============ Sentry Swap — sleep darts for aliens, bombs for bots ============ */
(function () {
    "use strict";

    const DART = "dart"; // sleep darts -> aliens
    const BOMB = "bomb"; // thermal detonators -> robots

    // Each ammo mode gets its own colour scheme + stage frame so it's always
    // obvious which mode you're in.
    const MODE = {
        dart: {
            title: "SLEEP DARTS",
            target: "ALIENS",
            color: "#39d0ff",
            glow: "rgba(57, 208, 255, 0.55)",
            bg0: "#0d1c2e",
            bg1: "#0a1422",
            barActive: "#123a55",
            cls: "ammo-dart"
        },
        bomb: {
            title: "THERMAL DETONATORS",
            target: "ROBOTS",
            color: "#ff5d5d",
            glow: "rgba(255, 93, 93, 0.55)",
            bg0: "#28101a",
            bg1: "#1c0b12",
            barActive: "#4d1820",
            cls: "ammo-bomb"
        }
    };

    const BLAST_R = 78; // thermal detonator splash radius

    function create(host) {
        const canvas = host.canvas;
        const ctx = canvas.getContext("2d");
        const stage = canvas.parentElement; // #game-stage — gets the mode frame

        let W, H, barH, dangerY;
        let player, enemies, shots, particles, floaters, stars;
        let ammo, score, lives, alive, started, timeAlive;
        let spawnTimer, spawnEvery, flash, shake, scoreDirty;
        let rafId, lastTs, lastTouch = 0;

        const kids = !!host.kids;
        const MAX_LIVES = kids ? 5 : 3;
        const SPEED_SCALE = kids ? 0.6 : 1;
        const SPAWN_BASE = kids ? 1.9 : 1.35;
        const SPAWN_MIN = kids ? 0.78 : 0.5;

        function rand(min, max) { return Math.random() * (max - min) + min; }

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = canvas.clientWidth;
            H = canvas.clientHeight;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            barH = Math.max(82, Math.min(H * 0.17, 104));
            if (player) {
                player.y = H - barH - 48;
                player.x = Math.max(40, Math.min(W - 40, player.x));
            }
            dangerY = H - barH - 18;
        }

        function reset() {
            player = { x: W / 2, y: H - barH - 48, aim: -Math.PI / 2, recoil: 0, bob: 0 };
            enemies = [];
            shots = [];
            particles = [];
            floaters = [];
            stars = [];
            for (let i = 0; i < 46; i++) {
                stars.push({ x: Math.random() * W, y: Math.random() * H, s: Math.random() * 1.6 + 0.4, tw: Math.random() * Math.PI * 2 });
            }
            ammo = DART;
            score = 0;
            lives = MAX_LIVES;
            alive = true;
            started = false;
            timeAlive = 0;
            spawnTimer = 1.1;
            spawnEvery = SPAWN_BASE;
            flash = 0;
            shake = 0;
            scoreDirty = false;
            lastTs = 0;
            host.setScore(0);
            applyFrame();
        }

        /* ---------- Ammo mode ---------- */
        function applyFrame() {
            stage.classList.remove(MODE.dart.cls, MODE.bomb.cls);
            stage.classList.add(MODE[ammo].cls);
        }

        function clearFrame() {
            stage.classList.remove(MODE.dart.cls, MODE.bomb.cls);
        }

        function setAmmo(type) {
            if (!alive || type === ammo) return;
            ammo = type;
            started = true;
            flash = 1;
            applyFrame();
            host.vibrate(12);
            SGSound.play("flip");
        }

        function toggleAmmo() {
            setAmmo(ammo === DART ? BOMB : DART);
        }

        /* ---------- Spawning ---------- */
        function spawnEnemy() {
            const alien = Math.random() < 0.5;
            const r = alien ? rand(18, 23) : rand(19, 24);
            const x = rand(r + 14, W - r - 14);
            const speed = (40 + Math.min(timeAlive * 2.1, 116)) * SPEED_SCALE;
            const drift = rand(10, 30) * (player.x < x ? -1 : 1);
            enemies.push({
                kind: alien ? "alien" : "robot",
                x: x, y: -r - 6, r: r,
                vy: speed * rand(0.9, 1.12),
                vx: drift,
                wob: Math.random() * Math.PI * 2,
                hue: alien ? rand(96, 140) : 0,
                flash: 0,
                dead: false
            });
        }

        /* ---------- Throwing ---------- */
        function throwAt(tx, ty) {
            if (!alive) return;
            started = true;
            const ang = Math.atan2(ty - (player.y - 16), tx - player.x);
            player.aim = ang;
            player.recoil = 1;
            const sp = ammo === DART ? 700 : 560;
            shots.push({
                x: player.x, y: player.y - 18,
                vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
                type: ammo, r: ammo === DART ? 5 : 9,
                spin: 0, life: 2.2, dead: false
            });
            host.vibrate(8);
            SGSound.play(ammo === DART ? "shoot" : "drop");
        }

        /* ---------- Effects ---------- */
        function burst(x, y, color, count, speedMax) {
            for (let i = 0; i < count; i++) {
                const a = Math.random() * Math.PI * 2;
                const sp = Math.random() * speedMax + 30;
                particles.push({
                    x: x, y: y,
                    vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                    life: 1, decay: rand(1.3, 2.4),
                    color: color, size: rand(2, 4.5)
                });
            }
        }

        function floater(x, y, text, color) {
            floaters.push({ x: x, y: y, text: text, color: color, life: 1 });
        }

        function addScore(n) {
            score += n;
            scoreDirty = true;
        }

        function sleepAlien(en) {
            en.dead = true;
            addScore(1);
            burst(en.x, en.y, "#39d0ff", 14, 130);
            floater(en.x, en.y - en.r, "Zzz", "#9fe6ff");
            host.vibrate(10);
            SGSound.play("score");
        }

        function boomRobot(en, splash) {
            en.dead = true;
            addScore(1);
            burst(en.x, en.y, splash ? "#ffd166" : "#ff8c42", 18, 200);
            burst(en.x, en.y, "#ff5d5d", 8, 120);
            shake = Math.max(shake, splash ? 0.18 : 0.3);
            if (!splash) floater(en.x, en.y - en.r, "BOOM", "#ffb35e");
        }

        function blast(x, y) {
            for (const en of enemies) {
                if (en.dead || en.kind !== "robot") continue;
                const dx = en.x - x, dy = en.y - y;
                if (dx * dx + dy * dy <= BLAST_R * BLAST_R) boomRobot(en, true);
            }
        }

        function fizzle(x, y, en) {
            en.flash = 0.3;
            burst(x, y, "#7d83a8", 7, 70);
            floater(en.x, en.y - en.r, "IMMUNE", "#aab0d6");
            host.vibrate(6);
            SGSound.play("wrong");
        }

        function loseLife(en) {
            lives -= 1;
            burst(en.x, en.y, en.kind === "alien" ? "#7CFC00" : "#cfd3e6", 16, 150);
            shake = Math.max(shake, 0.4);
            host.vibrate([70, 40, 90]);
            SGSound.play("hit");
            if (lives <= 0) {
                alive = false;
                floater(player.x, player.y - 40, "OVERRUN!", "#ff5d5d");
                setTimeout(() => host.gameOver(score), 750);
            }
        }

        /* ---------- Update ---------- */
        function update(dt) {
            if (started && alive) timeAlive += dt;
            if (flash > 0) flash = Math.max(0, flash - dt * 2.4);
            if (shake > 0) shake = Math.max(0, shake - dt * 1.6);
            player.recoil = Math.max(0, player.recoil - dt * 5);
            player.bob += dt * 4;
            player.aim += (-Math.PI / 2 - player.aim) * Math.min(dt * 2.2, 1) * (player.recoil > 0 ? 0 : 1);

            for (const s of stars) s.tw += dt * 2;

            // Shots
            for (const s of shots) {
                s.x += s.vx * dt;
                s.y += s.vy * dt;
                s.spin += dt * 16;
                s.life -= dt;
                if (s.life <= 0 || s.x < -24 || s.x > W + 24 || s.y < -24 || s.y > H + 24) {
                    s.dead = true;
                    continue;
                }
                for (const en of enemies) {
                    if (en.dead) continue;
                    const dx = en.x - s.x, dy = en.y - s.y;
                    const rr = en.r + s.r;
                    if (dx * dx + dy * dy <= rr * rr) {
                        const match = (s.type === DART && en.kind === "alien") ||
                            (s.type === BOMB && en.kind === "robot");
                        if (!match) {
                            fizzle(s.x, s.y, en);
                        } else if (s.type === DART) {
                            sleepAlien(en);
                        } else {
                            boomRobot(en, false);
                            blast(en.x, en.y);
                        }
                        s.dead = true;
                        break;
                    }
                }
            }
            shots = shots.filter(s => !s.dead);

            // Enemies march toward the human
            if (alive) {
                for (const en of enemies) {
                    if (en.dead) continue;
                    en.y += en.vy * dt;
                    en.x += en.vx * dt;
                    if (en.x < en.r + 4) { en.x = en.r + 4; en.vx = Math.abs(en.vx); }
                    else if (en.x > W - en.r - 4) { en.x = W - en.r - 4; en.vx = -Math.abs(en.vx); }
                    en.wob += dt * 6;
                    if (en.flash > 0) en.flash = Math.max(0, en.flash - dt);
                    if (en.y >= dangerY) {
                        en.dead = true;
                        loseLife(en);
                        if (!alive) break;
                    }
                }
            }
            enemies = enemies.filter(e => !e.dead);

            // Particles
            for (const p of particles) {
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.vy += 120 * dt;
                p.life -= dt * p.decay;
            }
            particles = particles.filter(p => p.life > 0);

            // Floaters
            for (const f of floaters) {
                f.y -= 34 * dt;
                f.life -= dt * 1.1;
            }
            floaters = floaters.filter(f => f.life > 0);

            // Spawning + difficulty
            if (alive && started) {
                spawnTimer -= dt;
                if (spawnTimer <= 0) {
                    spawnEvery = Math.max(SPAWN_MIN, SPAWN_BASE - timeAlive * 0.018);
                    spawnTimer = spawnEvery * rand(0.85, 1.15);
                    spawnEnemy();
                    if (timeAlive > 22 && Math.random() < 0.32) spawnEnemy();
                }
            }

            if (scoreDirty) {
                host.setScore(score);
                scoreDirty = false;
            }
        }

        /* ---------- Drawing helpers ---------- */
        function roundRect(x, y, w, h, r) {
            r = Math.min(r, w / 2, h / 2);
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.arcTo(x + w, y, x + w, y + h, r);
            ctx.arcTo(x + w, y + h, x, y + h, r);
            ctx.arcTo(x, y + h, x, y, r);
            ctx.arcTo(x, y, x + w, y, r);
            ctx.closePath();
        }

        function drawAlien(en) {
            ctx.save();
            ctx.translate(en.x, en.y + Math.sin(en.wob) * 1.5);
            const r = en.r;
            ctx.fillStyle = "rgba(0,0,0,0.3)";
            ctx.beginPath();
            ctx.ellipse(0, r * 0.95, r * 0.7, r * 0.24, 0, 0, Math.PI * 2);
            ctx.fill();
            const body = "hsl(" + en.hue + ", 70%, 55%)";
            const dark = "hsl(" + en.hue + ", 70%, 38%)";
            // Antennae
            ctx.strokeStyle = dark;
            ctx.lineWidth = 2.5;
            for (const sgn of [-1, 1]) {
                ctx.beginPath();
                ctx.moveTo(sgn * r * 0.3, -r * 0.5);
                ctx.lineTo(sgn * r * 0.55, -r * 1.05);
                ctx.stroke();
                ctx.fillStyle = "#ffd166";
                ctx.beginPath();
                ctx.arc(sgn * r * 0.55, -r * 1.05, 2.6, 0, Math.PI * 2);
                ctx.fill();
            }
            // Head/body blob
            ctx.fillStyle = en.flash > 0 ? "#ffffff" : body;
            ctx.beginPath();
            ctx.arc(0, 0, r, Math.PI, 0);
            ctx.lineTo(r, r * 0.5);
            for (let i = 0; i <= 6; i++) {
                const bx = r - (i / 6) * (r * 2);
                const by = r * 0.5 + (i % 2 === 0 ? r * 0.22 : 0);
                ctx.lineTo(bx, by);
            }
            ctx.closePath();
            ctx.fill();
            // Eyes
            ctx.fillStyle = "#0d0d18";
            ctx.beginPath();
            ctx.arc(-r * 0.34, -r * 0.05, r * 0.2, 0, Math.PI * 2);
            ctx.arc(r * 0.34, -r * 0.05, r * 0.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#fff";
            ctx.beginPath();
            ctx.arc(-r * 0.28, -r * 0.12, r * 0.07, 0, Math.PI * 2);
            ctx.arc(r * 0.4, -r * 0.12, r * 0.07, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        function drawRobot(en) {
            ctx.save();
            ctx.translate(en.x, en.y + Math.sin(en.wob) * 1.2);
            const r = en.r;
            ctx.fillStyle = "rgba(0,0,0,0.3)";
            ctx.beginPath();
            ctx.ellipse(0, r * 0.98, r * 0.72, r * 0.24, 0, 0, Math.PI * 2);
            ctx.fill();
            // Antenna
            ctx.strokeStyle = "#8b90ad";
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(0, -r * 0.7);
            ctx.lineTo(0, -r * 1.15);
            ctx.stroke();
            ctx.fillStyle = "#ff5d5d";
            ctx.beginPath();
            ctx.arc(0, -r * 1.2, 3, 0, Math.PI * 2);
            ctx.fill();
            // Body
            ctx.fillStyle = en.flash > 0 ? "#ffffff" : "#b9bedd";
            roundRect(-r * 0.82, -r * 0.7, r * 1.64, r * 1.7, r * 0.32);
            ctx.fill();
            ctx.fillStyle = "#7d83a8";
            roundRect(-r * 0.82, r * 0.5, r * 1.64, r * 0.5, r * 0.2);
            ctx.fill();
            // Face plate
            ctx.fillStyle = "#2a2f4a";
            roundRect(-r * 0.6, -r * 0.42, r * 1.2, r * 0.74, r * 0.18);
            ctx.fill();
            // Eyes
            ctx.fillStyle = en.flash > 0 ? "#ff8c42" : "#39d0ff";
            ctx.beginPath();
            ctx.arc(-r * 0.26, -r * 0.05, r * 0.16, 0, Math.PI * 2);
            ctx.arc(r * 0.26, -r * 0.05, r * 0.16, 0, Math.PI * 2);
            ctx.fill();
            // Bolts
            ctx.fillStyle = "#8b90ad";
            for (const sx of [-1, 1]) {
                ctx.beginPath();
                ctx.arc(sx * r * 0.62, -r * 0.5, 2.2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        function drawDart(s) {
            ctx.save();
            ctx.translate(s.x, s.y);
            ctx.rotate(Math.atan2(s.vy, s.vx));
            ctx.fillStyle = "#39d0ff";
            roundRect(-9, -2, 16, 4, 2);
            ctx.fill();
            ctx.fillStyle = "#d7f6ff";
            ctx.beginPath();
            ctx.moveTo(7, 0);
            ctx.lineTo(2, -3.5);
            ctx.lineTo(2, 3.5);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = "#1f8fbf";
            ctx.beginPath();
            ctx.moveTo(-9, 0);
            ctx.lineTo(-13, -4);
            ctx.lineTo(-13, 4);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }

        function drawBomb(s) {
            ctx.save();
            ctx.translate(s.x, s.y);
            ctx.rotate(s.spin);
            ctx.fillStyle = "#2a2f4a";
            ctx.beginPath();
            ctx.arc(0, 0, s.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#454c70";
            roundRect(-3, -s.r - 3, 6, 5, 2);
            ctx.fill();
            const blink = (Math.sin(s.spin * 3) + 1) / 2;
            ctx.fillStyle = "rgba(255, 93, 93," + (0.4 + blink * 0.6) + ")";
            ctx.beginPath();
            ctx.arc(0, 0, 3.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        function drawPlayer() {
            const p = player;
            const y = p.y + Math.sin(p.bob) * 1.2;
            ctx.save();
            ctx.translate(p.x, y);
            // Shadow
            ctx.fillStyle = "rgba(0,0,0,0.32)";
            ctx.beginPath();
            ctx.ellipse(0, 30, 22, 6, 0, 0, Math.PI * 2);
            ctx.fill();
            // Legs
            ctx.fillStyle = "#34374f";
            roundRect(-9, 12, 7, 18, 3); ctx.fill();
            roundRect(2, 12, 7, 18, 3); ctx.fill();
            // Torso
            ctx.fillStyle = "#3f7fc2";
            roundRect(-12, -10, 24, 26, 8); ctx.fill();
            ctx.fillStyle = "#2f618f";
            roundRect(-12, 6, 24, 8, 4); ctx.fill();
            // Head
            ctx.fillStyle = "#f0c39b";
            ctx.beginPath();
            ctx.arc(0, -20, 9, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#4a3526";
            roundRect(-9, -27, 18, 6, 3); ctx.fill();
            // Throwing arm toward aim, holding the active ammo
            const a = p.aim - (p.recoil * 0.5);
            const sh = { x: -2, y: -6 };
            const hand = { x: sh.x + Math.cos(a) * 20, y: sh.y + Math.sin(a) * 20 };
            ctx.strokeStyle = "#3f7fc2";
            ctx.lineWidth = 6;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(sh.x, sh.y);
            ctx.lineTo(hand.x, hand.y);
            ctx.stroke();
            const cfg = MODE[ammo];
            if (ammo === DART) {
                ctx.save();
                ctx.translate(hand.x, hand.y);
                ctx.rotate(a);
                ctx.fillStyle = cfg.color;
                roundRect(-2, -3, 12, 6, 2); ctx.fill();
                ctx.restore();
            } else {
                ctx.fillStyle = "#2a2f4a";
                ctx.beginPath();
                ctx.arc(hand.x, hand.y, 6, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = cfg.color;
                ctx.beginPath();
                ctx.arc(hand.x, hand.y, 2.4, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        function drawAmmoButton(x, w, type) {
            const cfg = MODE[type];
            const active = ammo === type;
            const m = 9;
            const bx = x + m, by = H - barH + m, bw = w - m * 2, bh = barH - m * 2;
            roundRect(bx, by, bw, bh, 14);
            ctx.fillStyle = active ? cfg.barActive : "#1b1b30";
            ctx.fill();
            if (active) {
                ctx.lineWidth = 3;
                ctx.strokeStyle = cfg.color;
                ctx.stroke();
            }
            const cx = bx + 26;
            const cy = by + bh / 2;
            ctx.globalAlpha = active ? 1 : 0.55;
            if (type === DART) {
                ctx.fillStyle = cfg.color;
                roundRect(cx - 11, cy - 2, 18, 4, 2); ctx.fill();
                ctx.beginPath();
                ctx.moveTo(cx + 7, cy);
                ctx.lineTo(cx + 1, cy - 4);
                ctx.lineTo(cx + 1, cy + 4);
                ctx.closePath();
                ctx.fill();
            } else {
                ctx.fillStyle = "#2a2f4a";
                ctx.beginPath();
                ctx.arc(cx, cy + 1, 9, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = cfg.color;
                ctx.beginPath();
                ctx.arc(cx, cy + 1, 3, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.textAlign = "left";
            ctx.fillStyle = active ? "#f2f3ff" : "#9aa0c3";
            ctx.font = "800 13px system-ui, sans-serif";
            ctx.fillText(type === DART ? "SLEEP DART" : "DETONATOR", cx + 22, cy - 3);
            ctx.fillStyle = active ? cfg.color : "#6b7099";
            ctx.font = "600 11px system-ui, sans-serif";
            ctx.fillText(type === DART ? "for aliens" : "for robots", cx + 22, cy + 12);
            ctx.globalAlpha = 1;
        }

        function draw() {
            const cfg = MODE[ammo];
            ctx.save();
            if (shake > 0) {
                ctx.translate((Math.random() - 0.5) * shake * 14, (Math.random() - 0.5) * shake * 14);
            }

            // Background tinted by current mode
            const g = ctx.createLinearGradient(0, 0, 0, H);
            g.addColorStop(0, cfg.bg0);
            g.addColorStop(1, cfg.bg1);
            ctx.fillStyle = g;
            ctx.fillRect(-20, -20, W + 40, H + 40);

            // Stars
            for (const s of stars) {
                ctx.globalAlpha = 0.4 + (Math.sin(s.tw) + 1) * 0.25;
                ctx.fillStyle = "#cdd3ff";
                ctx.fillRect(s.x, s.y, s.s, s.s);
            }
            ctx.globalAlpha = 1;

            // Danger line near the human
            ctx.strokeStyle = "rgba(255, 93, 93, 0.35)";
            ctx.lineWidth = 2;
            ctx.setLineDash([10, 8]);
            ctx.beginPath();
            ctx.moveTo(0, dangerY);
            ctx.lineTo(W, dangerY);
            ctx.stroke();
            ctx.setLineDash([]);

            for (const en of enemies) {
                if (en.kind === "alien") drawAlien(en); else drawRobot(en);
            }
            for (const s of shots) {
                if (s.type === DART) drawDart(s); else drawBomb(s);
            }
            for (const p of particles) {
                ctx.globalAlpha = Math.max(p.life, 0);
                ctx.fillStyle = p.color;
                ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
            }
            ctx.globalAlpha = 1;

            drawPlayer();

            for (const f of floaters) {
                ctx.globalAlpha = Math.max(f.life, 0);
                ctx.fillStyle = f.color;
                ctx.font = "800 16px system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText(f.text, f.x, f.y);
            }
            ctx.globalAlpha = 1;

            // Mode banner at the top
            ctx.textAlign = "center";
            const label = cfg.title + "  \u2192  hit the " + cfg.target;
            ctx.font = "800 14px system-ui, sans-serif";
            const tw = ctx.measureText(label).width;
            roundRect(W / 2 - tw / 2 - 14, 12, tw + 28, 28, 14);
            ctx.fillStyle = "rgba(10, 10, 22, 0.6)";
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = cfg.color;
            ctx.stroke();
            ctx.fillStyle = cfg.color;
            ctx.fillText(label, W / 2, 31);

            // Lives
            for (let i = 0; i < MAX_LIVES; i++) {
                ctx.globalAlpha = i < lives ? 1 : 0.22;
                ctx.fillStyle = "#ff5d5d";
                const hx = 16 + i * 22, hy = 56;
                ctx.beginPath();
                ctx.moveTo(hx, hy + 6);
                ctx.bezierCurveTo(hx - 9, hy - 2, hx - 5, hy - 9, hx, hy - 3);
                ctx.bezierCurveTo(hx + 5, hy - 9, hx + 9, hy - 2, hx, hy + 6);
                ctx.fill();
            }
            ctx.globalAlpha = 1;

            // Control bar with two ammo buttons
            ctx.fillStyle = "#101022";
            ctx.fillRect(0, H - barH, W, barH);
            ctx.fillStyle = MODE[ammo].color;
            ctx.fillRect(0, H - barH, W, 3);
            drawAmmoButton(0, W / 2, DART);
            drawAmmoButton(W / 2, W / 2, BOMB);

            // Mode-switch flash
            if (flash > 0) {
                ctx.globalAlpha = flash * 0.28;
                ctx.fillStyle = cfg.color;
                ctx.fillRect(0, 0, W, H);
                ctx.globalAlpha = 1;
            }

            // Start hint
            if (!started) {
                ctx.fillStyle = "rgba(242, 243, 255, 0.92)";
                ctx.font = "700 17px system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("Tap to throw at the invaders!", W / 2, H * 0.42);
                ctx.font = "500 14px system-ui, sans-serif";
                ctx.fillStyle = "rgba(154, 160, 195, 0.95)";
                ctx.fillText("Darts put aliens to sleep \u2014 bombs wreck robots.", W / 2, H * 0.42 + 26);
                ctx.fillText("Switch ammo with the buttons below.", W / 2, H * 0.42 + 48);
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

        /* ---------- Input ---------- */
        function pointAt(clientX, clientY) {
            const rect = canvas.getBoundingClientRect();
            const x = clientX - rect.left;
            const y = clientY - rect.top;
            if (y >= H - barH) {
                setAmmo(x < W / 2 ? DART : BOMB);
            } else {
                throwAt(x, y);
            }
        }

        function onTouchStart(e) {
            e.preventDefault();
            lastTouch = Date.now();
            const t = e.changedTouches[0];
            pointAt(t.clientX, t.clientY);
        }

        function onMouseDown(e) {
            if (Date.now() - lastTouch < 600) return;
            pointAt(e.clientX, e.clientY);
        }

        function onKey(e) {
            const k = e.key.toLowerCase();
            if (k === "1" || k === "q") { setAmmo(DART); }
            else if (k === "2" || k === "e") { setAmmo(BOMB); }
            else if (e.key === " " || e.key === "Tab") { e.preventDefault(); toggleAmmo(); }
        }

        return {
            start() {
                resize();
                reset();
                window.addEventListener("resize", resize);
                canvas.addEventListener("touchstart", onTouchStart, { passive: false });
                canvas.addEventListener("mousedown", onMouseDown);
                window.addEventListener("keydown", onKey);
                rafId = requestAnimationFrame(loop);
            },
            restart() {
                reset();
            },
            destroy() {
                cancelAnimationFrame(rafId);
                clearFrame();
                window.removeEventListener("resize", resize);
                canvas.removeEventListener("touchstart", onTouchStart);
                canvas.removeEventListener("mousedown", onMouseDown);
                window.removeEventListener("keydown", onKey);
            }
        };
    }

    window.SGGames = window.SGGames || {};
    window.SGGames.sentry = {
        id: "sentry",
        name: "Sentry Swap",
        emoji: "\u{1F47E}",
        tag: "Sleep darts for aliens, bombs for bots. Switch fast!",
        scoreLabel: "points",
        create: create
    };
})();
