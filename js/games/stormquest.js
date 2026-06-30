/* ============ Storm Quest — auto-run adventure, charge lightning to zap monsters ============ */
(function () {
    "use strict";

    function create(host) {
        const canvas = host.canvas;
        const ctx = canvas.getContext("2d");

        let W, H, groundY;
        let hero, platforms, monsters, pickups, bolts, particles, clouds, fireballs;
        let score, distance, lives, invuln, alive, started;
        let charge, charging, holdStart, holdMoved;
        let shieldTime, speedBoost;
        let speed, spawnX, rafId, lastTs;
        let aimAngle, pointerDown, swipeRoll;
        let rollTime, rollCd;
        let boss, bossLevel, nextBossAt;
        let bannerText, bannerTime;
        let aimKey, gestureStartX, gestureStartY;

        const kids = !!host.kids;
        const MAX_LIVES = kids ? 5 : 3;
        const GRACE_TIME = kids ? 3 : 2;
        const SPEED_SCALE = kids ? 0.66 : 1;
        const CHARGE_FULL = kids ? 0.6 : 0.9;   // seconds of holding for max bolt
        const TAP_MAX = 0.18;      // press shorter than this = jump
        const AIM_MIN = -Math.PI / 2; // highest aim: straight up
        const AIM_MAX = 0;            // lowest aim: straight ahead (never downward)
        const ROLL_DUR = 0.45;     // seconds of the dodge roll (i-frames)
        const ROLL_CD = kids ? 0.6 : 0.85;      // roll cooldown after the i-frames
        const FIRST_BOSS = kids ? 2600 : 3400;  // distance before the first boss
        const BOSS_GAP = kids ? 4200 : 3800;    // distance between bosses
        // Keep the ground (and the hero that runs on it) well clear of the screen
        // bottom so a finger swiping/rolling doesn't land in the iOS home-indicator
        // gesture zone, which switches apps instead of controlling the hero.
        const GROUND_MARGIN = 110;

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = canvas.clientWidth;
            H = canvas.clientHeight;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            groundY = H - GROUND_MARGIN;
        }

        function reset() {
            hero = {
                x: 90, y: groundY, vy: 0, w: 34, h: 44,
                onGround: true, jumps: 0, run: 0
            };
            platforms = [];
            monsters = [];
            pickups = [];
            bolts = [];
            particles = [];
            clouds = [];
            fireballs = [];
            for (let i = 0; i < 5; i++) {
                clouds.push({ x: Math.random() * W, y: 30 + Math.random() * H * 0.25, s: 0.6 + Math.random() * 0.8 });
            }
            score = 0;
            distance = 0;
            lives = MAX_LIVES;
            invuln = 0;
            alive = true;
            started = false;
            charge = 0;
            charging = false;
            holdStart = 0;
            holdMoved = false;
            shieldTime = 0;
            speedBoost = 0;
            aimAngle = -0.12;
            pointerDown = false;
            swipeRoll = false;
            rollTime = 0;
            rollCd = 0;
            aimKey = 0;
            gestureStartX = 0;
            gestureStartY = 0;
            boss = null;
            bossLevel = 0;
            nextBossAt = FIRST_BOSS;
            bannerText = "";
            bannerTime = 0;
            speed = 230;
            spawnX = W + 60;
            lastTs = 0;
            host.setScore(0);
        }

        /* ---------- world generation ---------- */

        function spawnChunk() {
            const r = Math.random();
            if (r < 0.34) {
                // Floating platform, often with a pickup on top.
                const pw = 90 + Math.random() * 70;
                const py = groundY - (70 + Math.random() * 90);
                platforms.push({ x: spawnX, y: py, w: pw, h: 16 });
                if (Math.random() < 0.65) spawnPickup(spawnX + pw / 2, py - 28);
                if (Math.random() < 0.3) spawnMonster(spawnX + pw / 2, py, true);
                spawnX += pw + 130 + Math.random() * 120;
            } else if (r < 0.72) {
                spawnMonster(spawnX, groundY, false);
                spawnX += 230 + Math.random() * 200;
            } else {
                spawnPickup(spawnX, groundY - 34 - Math.random() * 50);
                spawnX += 170 + Math.random() * 130;
            }
        }

        function spawnMonster(x, surfaceY, onPlatform) {
            const kind = Math.random();
            if (kind < 0.45) {
                // Slime — walks, jumpable, zappable.
                monsters.push({
                    x: x, y: surfaceY, w: 36, h: 28, type: "slime",
                    hp: 1, wob: Math.random() * 6, vx: -30, baseY: surfaceY, onPlatform: onPlatform
                });
            } else if (kind < 0.8) {
                // Spiky beetle — tougher, needs a charged bolt.
                monsters.push({
                    x: x, y: surfaceY, w: 40, h: 30, type: "spiky",
                    hp: 2, wob: Math.random() * 6, vx: -55, baseY: surfaceY, onPlatform: onPlatform
                });
            } else {
                // Ghost — floats in a sine wave, only lightning hurts it.
                monsters.push({
                    x: x, y: surfaceY - 90, w: 34, h: 34, type: "ghost",
                    hp: 1, wob: Math.random() * 6, vx: -40, baseY: surfaceY - 90, onPlatform: false
                });
            }
        }

        function spawnPickup(x, y) {
            const r = Math.random();
            let type = "gem";
            if (r < 0.18) type = "heart";
            else if (r < 0.3) type = "shield";
            else if (r < 0.4) type = "bolt";
            pickups.push({ x: x, y: y, type: type, wob: Math.random() * 6 });
        }

        /* ---------- actions ---------- */

        function jump() {
            if (!alive) return;
            started = true;
            if (hero.onGround || hero.jumps < 2) {
                hero.vy = hero.onGround ? -520 : -460;
                hero.jumps = hero.onGround ? 1 : hero.jumps + 1;
                hero.onGround = false;
                host.vibrate(8);
                SGSound.play("jump");
            }
        }

        function releaseBolt() {
            const power = Math.min(charge / CHARGE_FULL, 1);
            if (power < 0.25) { charge = 0; return; }
            const mega = power >= 1;
            const boltSpeed = 600 + power * 260;
            bolts.push({
                x: hero.x + hero.w / 2,
                y: hero.y - hero.h / 2,
                vx: Math.cos(aimAngle) * boltSpeed,
                vy: Math.sin(aimAngle) * boltSpeed,
                angle: aimAngle,
                power: power,
                mega: mega,
                hitBoss: false,
                life: mega ? 1.0 : 0.75,
                seed: Math.random() * 100
            });
            charge = 0;
            host.vibrate(mega ? [40, 30, 80] : 15);
            SGSound.play(mega ? "explode" : "flap");
            // Recoil flash particles
            for (let i = 0; i < (mega ? 14 : 6); i++) {
                particles.push({
                    x: hero.x + hero.w / 2, y: hero.y - hero.h / 2,
                    vx: Math.random() * 120 - 30, vy: (Math.random() - 0.5) * 160,
                    life: 0.5, color: mega ? "#9ad8ff" : "#ffd166", size: Math.random() * 3 + 2
                });
            }
        }

        /* ---------- aiming, rolling & the boss ---------- */

        function clampAim(a) {
            return Math.max(AIM_MIN, Math.min(AIM_MAX, a));
        }

        function aimFromClient(clientX, clientY) {
            const rect = canvas.getBoundingClientRect();
            const ox = hero.x + hero.w / 2;
            const oy = hero.y - hero.h / 2;
            const a = Math.atan2((clientY - rect.top) - oy, (clientX - rect.left) - ox);
            // Constrain between straight up and straight ahead — never down or backward.
            aimAngle = clampAim(a);
        }

        function roll() {
            if (!alive || rollTime > 0 || rollCd > 0) return;
            if (charging && charge > TAP_MAX) return; // no rolling while a bolt is charging
            started = true;
            rollTime = ROLL_DUR;
            rollCd = ROLL_DUR + ROLL_CD;
            charging = false;
            charge = 0;
            host.vibrate([10, 18]);
            SGSound.play("flip");
            for (let i = 0; i < 9; i++) {
                particles.push({
                    x: hero.x, y: hero.y - 4,
                    vx: -(Math.random() * 170 + 40), vy: -(Math.random() * 70),
                    life: 0.5, color: "#cfd6ff", size: Math.random() * 3 + 2
                });
            }
        }

        function bossMaxHp() {
            const base = kids ? 6 : 9;
            return base + bossLevel * (kids ? 3 : 5);
        }

        function startBoss() {
            const hp = bossMaxHp();
            boss = {
                x: W + 130, stationX: Math.min(W - 96, W * 0.74),
                y: groundY - 175, baseY: groundY - 175,
                w: 86, h: 74, hp: hp, maxHp: hp,
                state: "enter", wob: Math.random() * 6,
                fireTimer: 1.6, hitFlash: 0, dying: 0
            };
            monsters = [];
            pickups = [];
            fireballs = [];
            bolts = [];
            banner("\u26A0 STORM TITAN APPROACHES", 2.2);
            host.vibrate([60, 40, 80]);
            SGSound.play("explode");
        }

        function throwFireball(spread) {
            const ox = boss.x - boss.w * 0.28;
            const oy = boss.y + 6;
            const tx = hero.x + hero.w / 2;
            const ty = hero.y - hero.h / 2;
            const sp = 250 + bossLevel * 22;
            const baseA = Math.atan2(ty - oy, tx - ox);
            const offs = spread ? [-0.26, 0, 0.26] : [0];
            for (const off of offs) {
                const a = baseA + off;
                fireballs.push({
                    x: ox, y: oy,
                    vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                    r: 13, life: 4.5, spin: Math.random() * 6
                });
            }
            host.vibrate(10);
            SGSound.play("shoot");
        }

        function updateBoss(dt) {
            boss.wob += dt * 3;
            if (boss.hitFlash > 0) boss.hitFlash = Math.max(0, boss.hitFlash - dt);

            if (boss.state === "enter") {
                boss.x -= 230 * dt;
                boss.y = boss.baseY + Math.sin(boss.wob) * 8;
                if (boss.x <= boss.stationX) {
                    boss.x = boss.stationX;
                    boss.state = "fight";
                    boss.fireTimer = 1.1;
                    banner("FIGHT!", 1.1);
                    SGSound.play("perfect");
                }
            } else if (boss.state === "fight") {
                boss.y = boss.baseY + Math.sin(boss.wob) * 16;
                boss.fireTimer -= dt;
                if (boss.fireTimer <= 0) {
                    const enrage = boss.hp <= boss.maxHp * 0.4;
                    throwFireball(enrage);
                    const interval = (kids ? 1.9 : 1.35) - Math.min(bossLevel * 0.08, 0.5);
                    boss.fireTimer = Math.max(0.6, interval) * (enrage ? 0.7 : 1);
                }
            } else if (boss.state === "dying") {
                boss.dying += dt;
                boss.y = boss.baseY + Math.sin(boss.wob * 3) * 6;
                if (Math.random() < 0.6) {
                    particles.push({
                        x: boss.x + (Math.random() - 0.5) * boss.w,
                        y: boss.y + (Math.random() - 0.5) * boss.h,
                        vx: (Math.random() - 0.5) * 240, vy: (Math.random() - 0.8) * 240,
                        life: 0.8, color: Math.random() < 0.5 ? "#ffd166" : "#ff7b3d",
                        size: Math.random() * 4 + 2
                    });
                }
                if (boss.dying >= 1.3) defeatBoss();
            }
        }

        function hitBoss(dmg, fx, fy) {
            if (!boss || boss.state === "dying") return;
            boss.hp -= dmg;
            boss.hitFlash = 0.16;
            host.vibrate(12);
            SGSound.play("eat");
            for (let k = 0; k < 8; k++) {
                particles.push({
                    x: fx, y: fy,
                    vx: (Math.random() - 0.5) * 240, vy: (Math.random() - 0.8) * 240,
                    life: 0.6, color: "#9ad8ff", size: Math.random() * 3 + 2
                });
            }
            if (boss.hp <= 0) {
                boss.hp = 0;
                boss.state = "dying";
                boss.dying = 0;
                fireballs = [];
                SGSound.play("explode");
            }
        }

        function defeatBoss() {
            const bonus = 25 + bossLevel * 15;
            score += bonus;
            host.setScore(score);
            if (lives < MAX_LIVES) lives += 1;
            banner("TITAN DEFEATED!  +" + bonus, 2);
            for (let i = 0; i < 40; i++) {
                particles.push({
                    x: boss.x, y: boss.y,
                    vx: (Math.random() - 0.5) * 420, vy: (Math.random() - 0.6) * 420,
                    life: 1, color: ["#ffd166", "#ff7b3d", "#9ad8ff"][i % 3],
                    size: Math.random() * 4 + 2
                });
            }
            host.vibrate([80, 40, 120]);
            SGSound.play("highscore");
            boss = null;
            fireballs = [];
            bossLevel += 1;
            nextBossAt = distance + BOSS_GAP;
            spawnX = W + 80;
        }

        function banner(text, time) {
            bannerText = text;
            bannerTime = time;
        }

        function hurtHero() {
            if (invuln > 0 || rollTime > 0) return;
            if (shieldTime > 0) {
                shieldTime = 0;
                invuln = 1;
                SGSound.play("flip");
                host.vibrate(20);
                return;
            }
            lives -= 1;
            host.vibrate([80, 50, 110]);
            SGSound.play("hit");
            for (let i = 0; i < 12; i++) {
                particles.push({
                    x: hero.x + hero.w / 2, y: hero.y - hero.h / 2,
                    vx: (Math.random() - 0.5) * 260, vy: (Math.random() - 0.7) * 260,
                    life: 0.8, color: "#ff5d5d", size: Math.random() * 4 + 2
                });
            }
            if (lives <= 0) {
                alive = false;
                setTimeout(() => host.gameOver(score), 800);
            } else {
                invuln = GRACE_TIME;
            }
        }

        function collectPickup(p) {
            if (p.type === "heart") {
                if (lives < MAX_LIVES) lives += 1;
                score += 5;
                SGSound.play("perfect");
            } else if (p.type === "shield") {
                shieldTime = 6;
                score += 5;
                SGSound.play("match");
            } else if (p.type === "bolt") {
                speedBoost = 4;
                score += 5;
                SGSound.play("match");
            } else {
                score += 3;
                SGSound.play("score");
            }
            host.setScore(score);
            host.vibrate(10);
            for (let i = 0; i < 8; i++) {
                particles.push({
                    x: p.x, y: p.y,
                    vx: (Math.random() - 0.5) * 200, vy: (Math.random() - 0.8) * 200,
                    life: 0.6, color: pickupColor(p.type), size: Math.random() * 3 + 2
                });
            }
        }

        function pickupColor(type) {
            if (type === "heart") return "#ff5d8d";
            if (type === "shield") return "#39d0ff";
            if (type === "bolt") return "#ffd166";
            return "#5ef58a";
        }

        /* ---------- update ---------- */

        function update(dt) {
            for (const c of clouds) {
                c.x -= dt * 14 * c.s;
                if (c.x < -90) { c.x = W + 60; c.y = 30 + Math.random() * H * 0.25; }
            }

            for (let i = particles.length - 1; i >= 0; i--) {
                const p = particles[i];
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.vy += 500 * dt;
                p.life -= dt * 1.6;
                if (p.life <= 0) particles.splice(i, 1);
            }

            if (bannerTime > 0) bannerTime = Math.max(0, bannerTime - dt);

            if (!alive || !started) return;

            if (invuln > 0) invuln = Math.max(0, invuln - dt);
            if (shieldTime > 0) shieldTime = Math.max(0, shieldTime - dt);
            if (speedBoost > 0) speedBoost = Math.max(0, speedBoost - dt);
            if (rollTime > 0) rollTime = Math.max(0, rollTime - dt);
            if (rollCd > 0) rollCd = Math.max(0, rollCd - dt);

            if (boss) updateBoss(dt);
            else if (distance >= nextBossAt) startBoss();

            if (charging) charge = Math.min(charge + dt, CHARGE_FULL * 1.4);
            if (aimKey !== 0) aimAngle = clampAim(aimAngle + aimKey * 1.8 * dt);

            const worldMoving = !boss || boss.state === "enter";
            const slowWhileCharging = charging && charge > TAP_MAX ? 0.55 : 1;
            const boost = speedBoost > 0 ? 1.45 : 1;
            const moveSpeed = worldMoving
                ? (speed + Math.min(distance / 60, 200)) * slowWhileCharging * boost
                : 0;
            distance += moveSpeed * dt;

            // Hero physics
            hero.vy += 1300 * dt;
            hero.y += hero.vy * dt;
            hero.run += dt * (10 * boost);

            // Land on ground
            if (hero.y >= groundY) {
                hero.y = groundY;
                hero.vy = 0;
                if (!hero.onGround) SGSound.play("tap");
                hero.onGround = true;
                hero.jumps = 0;
            } else {
                hero.onGround = false;
            }

            // Land on platforms (only when falling)
            for (const pf of platforms) {
                if (hero.vy >= 0 &&
                    hero.x + hero.w * 0.5 > pf.x && hero.x - hero.w * 0.5 < pf.x + pf.w &&
                    hero.y >= pf.y && hero.y - hero.vy * dt <= pf.y + 6) {
                    hero.y = pf.y;
                    hero.vy = 0;
                    hero.onGround = true;
                    hero.jumps = 0;
                }
            }

            // Scroll world
            for (const pf of platforms) pf.x -= moveSpeed * dt;
            for (const m of monsters) {
                m.x -= (moveSpeed - m.vx) * dt;
                m.wob += dt * 6;
                if (m.type === "ghost") m.y = m.baseY + Math.sin(m.wob) * 26;
                else if (m.type === "slime") m.y = m.baseY - Math.abs(Math.sin(m.wob * 1.4)) * 10;
            }
            for (const p of pickups) { p.x -= moveSpeed * dt; p.wob += dt * 4; }
            spawnX -= moveSpeed * dt;
            if (worldMoving && !boss) {
                while (spawnX < W + 200) spawnChunk();
            }

            platforms = platforms.filter(pf => pf.x + pf.w > -40);
            monsters = monsters.filter(m => m.x + m.w > -60 && m.hp > 0);
            pickups = pickups.filter(p => p.x > -40 && !p.got);

            // Bolts fly along their aim and strike monsters or the boss
            for (let i = bolts.length - 1; i >= 0; i--) {
                const b = bolts[i];
                b.x += b.vx * dt;
                b.y += b.vy * dt;
                b.life -= dt;
                if (b.life <= 0 || b.x > W + 80 || b.x < -80 || b.y < -80 || b.y > H + 80) {
                    bolts.splice(i, 1);
                    continue;
                }
                if (boss && !b.hitBoss && boss.state !== "dying") {
                    if (Math.abs(b.x - boss.x) < boss.w / 2 + 16 &&
                        Math.abs(b.y - boss.y) < boss.h / 2 + 16) {
                        b.hitBoss = true;
                        if (!b.mega) b.life = 0;
                        hitBoss(b.mega ? 4 : 1, b.x, b.y);
                    }
                }
                for (const m of monsters) {
                    if (m.hp <= 0) continue;
                    const my = m.y - m.h / 2;
                    const vertReach = b.mega ? 120 : 36;
                    if (Math.abs(b.x - m.x) < (m.w / 2 + 18) && Math.abs(b.y - my) < vertReach) {
                        m.hp -= b.mega ? 3 : 1;
                        if (!b.mega) b.life = 0;
                        if (m.hp <= 0) {
                            score += m.type === "spiky" ? 8 : (m.type === "ghost" ? 6 : 4);
                            host.setScore(score);
                            SGSound.play("eat");
                            host.vibrate(12);
                            for (let k = 0; k < 10; k++) {
                                particles.push({
                                    x: m.x, y: my,
                                    vx: (Math.random() - 0.5) * 280, vy: (Math.random() - 0.8) * 280,
                                    life: 0.7, color: "#b9e8ff", size: Math.random() * 4 + 2
                                });
                            }
                        }
                    }
                }
            }

            // Boss fireballs drift toward the hero
            for (let i = fireballs.length - 1; i >= 0; i--) {
                const f = fireballs[i];
                f.x += f.vx * dt;
                f.y += f.vy * dt;
                f.spin += dt * 8;
                f.life -= dt;
                if (f.life <= 0 || f.x < -40 || f.y < -40 || f.y > H + 40) {
                    fireballs.splice(i, 1);
                    continue;
                }
                const hx = hero.x;
                const hy = hero.y - hero.h / 2;
                if (Math.abs(f.x - hx) < f.r + hero.w * 0.3 &&
                    Math.abs(f.y - hy) < f.r + hero.h * 0.4) {
                    fireballs.splice(i, 1);
                    hurtHero();
                    if (!alive) return;
                }
            }

            // Hero vs monsters
            for (const m of monsters) {
                if (m.hp <= 0) continue;
                const my = m.y - m.h / 2;
                const hy = hero.y - hero.h / 2;
                if (Math.abs(hero.x - m.x) < (hero.w + m.w) * 0.4 &&
                    Math.abs(hy - my) < (hero.h + m.h) * 0.4) {
                    // Stomp slimes from above
                    if (m.type === "slime" && hero.vy > 120 && hy < my - 8) {
                        m.hp = 0;
                        hero.vy = -380;
                        score += 4;
                        host.setScore(score);
                        SGSound.play("eat");
                        host.vibrate(12);
                    } else {
                        hurtHero();
                        if (!alive) return;
                        m.hp = 0; // monster bursts so it can't re-hit during grace
                    }
                }
            }

            // Hero vs pickups
            for (const p of pickups) {
                if (Math.abs(hero.x - p.x) < 34 && Math.abs((hero.y - hero.h / 2) - p.y) < 40) {
                    p.got = true;
                    collectPickup(p);
                }
            }

            // Distance score (1 per 150px)
            const dScore = Math.floor(distance / 150);
            if (dScore > (update.lastD || 0)) {
                score += dScore - (update.lastD || 0);
                update.lastD = dScore;
                host.setScore(score);
            }
        }

        /* ---------- drawing ---------- */

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

        function drawHeart(x, y, r) {
            ctx.beginPath();
            ctx.moveTo(x, y + r * 0.9);
            ctx.bezierCurveTo(x - r * 1.4, y - r * 0.2, x - r * 0.7, y - r * 1.2, x, y - r * 0.3);
            ctx.bezierCurveTo(x + r * 0.7, y - r * 1.2, x + r * 1.4, y - r * 0.2, x, y + r * 0.9);
            ctx.fill();
        }

        function drawLightningPath(x1, y1, x2, seed, jag) {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            const segs = 6;
            for (let i = 1; i <= segs; i++) {
                const t = i / segs;
                const x = x1 + (x2 - x1) * t;
                const off = i === segs ? 0 : Math.sin(seed + i * 12.9898) * jag;
                ctx.lineTo(x, y1 + off);
            }
            ctx.stroke();
        }

        function drawHero() {
            const hy = hero.y - hero.h;
            const blink = invuln > 0 && Math.floor(invuln * 8) % 2 === 0;
            if (blink) return;

            const rolling = rollTime > 0;
            const rollT = rolling ? 1 - rollTime / ROLL_DUR : 0;

            ctx.save();
            ctx.translate(hero.x, hy);

            // Dodge-roll: duck low, spin, and leave a motion ghost
            if (rolling) {
                ctx.globalAlpha = 0.3;
                ctx.fillStyle = "#9ad8ff";
                ctx.beginPath();
                ctx.ellipse(hero.w / 2 - 6, hero.h * 0.55, hero.w * 0.62, hero.h * 0.4, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
                ctx.translate(hero.w / 2 - 6, hero.h * 0.5);
                ctx.rotate(rollT * Math.PI * 2);
                ctx.scale(0.82, 0.82);
                ctx.translate(-(hero.w / 2 - 6), -(hero.h * 0.5));
            }

            // Shield bubble
            if (shieldTime > 0) {
                ctx.globalAlpha = 0.3 + Math.sin(Date.now() / 120) * 0.12;
                ctx.fillStyle = "#39d0ff";
                ctx.beginPath();
                ctx.arc(hero.w / 2 - 17, hero.h / 2, hero.h * 0.85, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
            }

            const legSwing = hero.onGround ? Math.sin(hero.run * 2.2) * 6 : 3;

            // Legs
            ctx.strokeStyle = "#2c3550";
            ctx.lineWidth = 6;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(-6, hero.h - 14);
            ctx.lineTo(-6 + legSwing, hero.h - 1);
            ctx.moveTo(6, hero.h - 14);
            ctx.lineTo(6 - legSwing, hero.h - 1);
            ctx.stroke();

            // Body (cape + tunic)
            ctx.fillStyle = "#7b5bd6";
            roundRect(-14, 2, 28, 30, 9);
            ctx.fillStyle = "#9ad8ff";
            roundRect(-10, 8, 20, 16, 6);

            // Head
            ctx.fillStyle = "#ffd9b3";
            ctx.beginPath();
            ctx.arc(0, -8, 12, 0, Math.PI * 2);
            ctx.fill();
            // Hair / hood
            ctx.fillStyle = "#4a3f8f";
            ctx.beginPath();
            ctx.arc(0, -11, 12, Math.PI, Math.PI * 2);
            ctx.fill();
            // Eye
            ctx.fillStyle = "#1b2438";
            ctx.beginPath();
            ctx.arc(5, -8, 2, 0, Math.PI * 2);
            ctx.fill();

            // Charging hand glow
            if (charging && charge > TAP_MAX) {
                const p = Math.min(charge / CHARGE_FULL, 1);
                const r = 6 + p * 12 + Math.sin(Date.now() / 60) * 2;
                ctx.globalAlpha = 0.75;
                ctx.fillStyle = p >= 1 ? "#ffffff" : "#ffd166";
                ctx.beginPath();
                ctx.arc(18, 10, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
                ctx.strokeStyle = "#9ad8ff";
                ctx.lineWidth = 2;
                for (let i = 0; i < 3; i++) {
                    const a = Date.now() / 90 + i * 2.1;
                    ctx.beginPath();
                    ctx.moveTo(18 + Math.cos(a) * r, 10 + Math.sin(a) * r);
                    ctx.lineTo(18 + Math.cos(a) * (r + 7), 10 + Math.sin(a) * (r + 7));
                    ctx.stroke();
                }
            }

            ctx.restore();
        }

        function drawMonster(m) {
            const my = m.y - m.h;
            ctx.save();
            ctx.translate(m.x, my);
            if (m.type === "slime") {
                const squish = 1 + Math.sin(m.wob * 1.4) * 0.12;
                ctx.fillStyle = "#5ec97c";
                ctx.beginPath();
                ctx.ellipse(0, m.h / 2 + 6, m.w / 2 * squish, (m.h / 2) / squish + 4, 0, Math.PI, 0);
                ctx.fill();
                ctx.fillRect(-m.w / 2 * squish, m.h / 2 + 5, m.w * squish, 2);
                ctx.fillStyle = "#1b2438";
                ctx.beginPath();
                ctx.arc(-6, m.h / 2 - 2, 3, 0, Math.PI * 2);
                ctx.arc(6, m.h / 2 - 2, 3, 0, Math.PI * 2);
                ctx.fill();
            } else if (m.type === "spiky") {
                ctx.fillStyle = "#c23a3a";
                ctx.beginPath();
                ctx.ellipse(0, m.h / 2 + 4, m.w / 2, m.h / 2, 0, Math.PI, 0);
                ctx.fill();
                ctx.fillStyle = "#8f2727";
                for (let i = -2; i <= 2; i++) {
                    ctx.beginPath();
                    ctx.moveTo(i * 8 - 4, m.h / 2 - 6 + Math.abs(i) * 3);
                    ctx.lineTo(i * 8, m.h / 2 - 20 + Math.abs(i) * 4);
                    ctx.lineTo(i * 8 + 4, m.h / 2 - 6 + Math.abs(i) * 3);
                    ctx.closePath();
                    ctx.fill();
                }
                ctx.fillStyle = "#ffd166";
                ctx.beginPath();
                ctx.arc(-7, m.h / 2, 3, 0, Math.PI * 2);
                ctx.arc(7, m.h / 2, 3, 0, Math.PI * 2);
                ctx.fill();
                if (m.hp > 1) {
                    ctx.strokeStyle = "rgba(255, 209, 102, 0.6)";
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(0, m.h / 2 - 2, m.w / 2 + 5, 0, Math.PI * 2);
                    ctx.stroke();
                }
            } else {
                // ghost
                ctx.globalAlpha = 0.85;
                ctx.fillStyle = "#cfd6ff";
                ctx.beginPath();
                ctx.arc(0, m.h / 2 - 6, m.w / 2, Math.PI, 0);
                ctx.lineTo(m.w / 2, m.h / 2 + 8);
                for (let i = 2; i >= -2; i--) {
                    ctx.quadraticCurveTo(i * m.w / 5 + m.w / 10, m.h / 2 + (i % 2 ? 2 : 14), i * m.w / 5, m.h / 2 + 8);
                }
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = "#1b2438";
                ctx.beginPath();
                ctx.arc(-6, m.h / 2 - 8, 3.4, 0, Math.PI * 2);
                ctx.arc(6, m.h / 2 - 8, 3.4, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
            }
            ctx.restore();
        }

        function drawPickup(p) {
            const y = p.y + Math.sin(p.wob) * 5;
            ctx.save();
            ctx.translate(p.x, y);
            if (p.type === "heart") {
                ctx.fillStyle = "#ff5d8d";
                drawHeart(0, 0, 11);
                ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
                ctx.beginPath();
                ctx.arc(-3, -4, 2.5, 0, Math.PI * 2);
                ctx.fill();
            } else if (p.type === "shield") {
                ctx.fillStyle = "#39d0ff";
                ctx.beginPath();
                ctx.moveTo(0, -12);
                ctx.lineTo(10, -7);
                ctx.lineTo(10, 3);
                ctx.quadraticCurveTo(10, 12, 0, 15);
                ctx.quadraticCurveTo(-10, 12, -10, 3);
                ctx.lineTo(-10, -7);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = "#d9f4ff";
                ctx.fillRect(-1.5, -8, 3, 18);
                ctx.fillRect(-7, -2, 14, 3);
            } else if (p.type === "bolt") {
                ctx.fillStyle = "#ffd166";
                ctx.beginPath();
                ctx.moveTo(3, -14);
                ctx.lineTo(-7, 2);
                ctx.lineTo(-1, 2);
                ctx.lineTo(-3, 14);
                ctx.lineTo(7, -2);
                ctx.lineTo(1, -2);
                ctx.closePath();
                ctx.fill();
            } else {
                ctx.fillStyle = "#5ef58a";
                ctx.beginPath();
                ctx.moveTo(0, -10);
                ctx.lineTo(9, 0);
                ctx.lineTo(0, 12);
                ctx.lineTo(-9, 0);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
                ctx.beginPath();
                ctx.moveTo(0, -7);
                ctx.lineTo(4, -1);
                ctx.lineTo(-4, -1);
                ctx.closePath();
                ctx.fill();
            }
            ctx.restore();
        }

        function drawAimGuide() {
            const ox = hero.x + hero.w / 2;
            const oy = hero.y - hero.h / 2;
            const p = Math.min(charge / CHARGE_FULL, 1);
            const len = 70 + p * 70;
            ctx.save();
            ctx.globalAlpha = 0.55;
            ctx.strokeStyle = p >= 1 ? "#ffffff" : "#ffd166";
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 7]);
            ctx.beginPath();
            ctx.moveTo(ox, oy);
            ctx.lineTo(ox + Math.cos(aimAngle) * len, oy + Math.sin(aimAngle) * len);
            ctx.stroke();
            ctx.setLineDash([]);
            // Arrow head
            const tx = ox + Math.cos(aimAngle) * len;
            const ty = oy + Math.sin(aimAngle) * len;
            ctx.globalAlpha = 0.85;
            ctx.fillStyle = p >= 1 ? "#ffffff" : "#ffd166";
            ctx.beginPath();
            ctx.moveTo(tx + Math.cos(aimAngle) * 10, ty + Math.sin(aimAngle) * 10);
            ctx.lineTo(tx + Math.cos(aimAngle + 2.4) * 9, ty + Math.sin(aimAngle + 2.4) * 9);
            ctx.lineTo(tx + Math.cos(aimAngle - 2.4) * 9, ty + Math.sin(aimAngle - 2.4) * 9);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }

        function drawFireball(f) {
            ctx.save();
            ctx.translate(f.x, f.y);
            const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, f.r + 6);
            glow.addColorStop(0, "#fff1c2");
            glow.addColorStop(0.5, "#ff7b3d");
            glow.addColorStop(1, "rgba(255, 77, 77, 0)");
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(0, 0, f.r + 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#ff4d4d";
            ctx.beginPath();
            ctx.arc(0, 0, f.r * 0.62, 0, Math.PI * 2);
            ctx.fill();
            // Trailing flames
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = "#ffd166";
            for (let i = 1; i <= 3; i++) {
                ctx.beginPath();
                ctx.arc(f.vx > 0 ? -i * 6 : i * 6, Math.sin(f.spin + i) * 3, f.r * 0.4 - i, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        function drawBoss() {
            const b = boss;
            ctx.save();
            ctx.translate(b.x, b.y);
            // Shadow on the ground
            ctx.globalAlpha = 0.25;
            ctx.fillStyle = "#000";
            ctx.beginPath();
            ctx.ellipse(0, groundY - b.y, b.w * 0.5, 12, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;

            const body = b.hitFlash > 0 ? "#ffffff" : "#5b4aa0";
            // Storm cloud body
            ctx.fillStyle = body;
            ctx.beginPath();
            ctx.arc(-b.w * 0.28, 0, b.h * 0.42, 0, Math.PI * 2);
            ctx.arc(b.w * 0.28, 0, b.h * 0.42, 0, Math.PI * 2);
            ctx.arc(0, -b.h * 0.18, b.h * 0.5, 0, Math.PI * 2);
            ctx.arc(0, b.h * 0.1, b.h * 0.46, 0, Math.PI * 2);
            ctx.fill();
            // Darker underside
            ctx.fillStyle = b.hitFlash > 0 ? "#ffffff" : "#3c2f73";
            ctx.beginPath();
            ctx.ellipse(0, b.h * 0.22, b.w * 0.5, b.h * 0.2, 0, 0, Math.PI);
            ctx.fill();
            // Glowing eyes
            const enrage = b.hp <= b.maxHp * 0.4;
            ctx.fillStyle = enrage ? "#ff4d4d" : "#ffd166";
            ctx.beginPath();
            ctx.arc(-b.w * 0.16, -b.h * 0.1, 7, 0, Math.PI * 2);
            ctx.arc(b.w * 0.16, -b.h * 0.1, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#1b2438";
            ctx.beginPath();
            ctx.arc(-b.w * 0.16, -b.h * 0.1, 3, 0, Math.PI * 2);
            ctx.arc(b.w * 0.16, -b.h * 0.1, 3, 0, Math.PI * 2);
            ctx.fill();
            // Angry brow
            ctx.strokeStyle = "#1b2438";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(-b.w * 0.28, -b.h * 0.24);
            ctx.lineTo(-b.w * 0.05, -b.h * 0.14);
            ctx.moveTo(b.w * 0.28, -b.h * 0.24);
            ctx.lineTo(b.w * 0.05, -b.h * 0.14);
            ctx.stroke();
            // Crackling lightning beard
            ctx.strokeStyle = "#9ad8ff";
            ctx.lineWidth = 2;
            for (let i = -1; i <= 1; i++) {
                ctx.beginPath();
                ctx.moveTo(i * b.w * 0.22, b.h * 0.28);
                ctx.lineTo(i * b.w * 0.22 + 5, b.h * 0.4);
                ctx.lineTo(i * b.w * 0.22 - 3, b.h * 0.5);
                ctx.stroke();
            }
            ctx.restore();
        }

        function draw() {
            // Stormy dusk sky
            const grad = ctx.createLinearGradient(0, 0, 0, H);
            grad.addColorStop(0, "#1b1b38");
            grad.addColorStop(0.7, "#2c2450");
            grad.addColorStop(1, "#231c3e");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, H);

            // Moon
            ctx.fillStyle = "#e8e4ff";
            ctx.beginPath();
            ctx.arc(W - 70, 70, 26, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#d3cdf2";
            ctx.beginPath();
            ctx.arc(W - 78, 64, 6, 0, Math.PI * 2);
            ctx.arc(W - 62, 78, 4, 0, Math.PI * 2);
            ctx.fill();

            // Clouds
            ctx.fillStyle = "rgba(160, 160, 210, 0.25)";
            for (const c of clouds) {
                ctx.beginPath();
                ctx.arc(c.x, c.y, 18 * c.s, 0, Math.PI * 2);
                ctx.arc(c.x + 20 * c.s, c.y + 4 * c.s, 14 * c.s, 0, Math.PI * 2);
                ctx.arc(c.x - 20 * c.s, c.y + 5 * c.s, 13 * c.s, 0, Math.PI * 2);
                ctx.fill();
            }

            // Distant hills
            ctx.fillStyle = "#252046";
            ctx.beginPath();
            ctx.moveTo(0, groundY);
            for (let x = 0; x <= W; x += 60) {
                ctx.lineTo(x, groundY - 30 - Math.sin((x + distance * 0.2) / 90) * 22);
            }
            ctx.lineTo(W, groundY);
            ctx.closePath();
            ctx.fill();

            // Ground
            ctx.fillStyle = "#2f2a52";
            ctx.fillRect(0, groundY, W, H - groundY);
            ctx.fillStyle = "#4a3f8f";
            ctx.fillRect(0, groundY, W, 6);
            // Ground speckles scrolling
            ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
            for (let i = 0; i < 14; i++) {
                const gx = ((i * 97 - distance * 0.9) % (W + 40) + W + 40) % (W + 40) - 20;
                ctx.fillRect(gx, groundY + 16 + (i * 31) % 40, 10, 3);
            }

            // Platforms
            for (const pf of platforms) {
                ctx.fillStyle = "#4a3f8f";
                roundRect(pf.x, pf.y, pf.w, pf.h, 7);
                ctx.fillStyle = "#6a5bc4";
                roundRect(pf.x, pf.y, pf.w, 5, 3);
            }

            for (const p of pickups) drawPickup(p);
            for (const m of monsters) drawMonster(m);
            if (boss) drawBoss();

            // Boss fireballs
            for (const f of fireballs) drawFireball(f);

            // Bolts travel along their aimed angle
            for (const b of bolts) {
                ctx.save();
                ctx.translate(b.x, b.y);
                ctx.rotate(b.angle);
                ctx.strokeStyle = b.mega ? "#ffffff" : "#ffd166";
                ctx.lineWidth = b.mega ? 5 : 3;
                ctx.lineCap = "round";
                drawLightningPath(-60, 0, 0, b.seed + Date.now() / 40, b.mega ? 16 : 8);
                if (b.mega) {
                    ctx.strokeStyle = "rgba(154, 216, 255, 0.7)";
                    ctx.lineWidth = 9;
                    drawLightningPath(-60, 0, 0, b.seed + Date.now() / 31 + 5, 22);
                }
                ctx.restore();
            }

            // Aim guide while charging a bolt
            if (charging && charge > TAP_MAX && alive) {
                drawAimGuide();
            }

            // Particles
            for (const p of particles) {
                ctx.globalAlpha = Math.max(p.life, 0);
                ctx.fillStyle = p.color;
                ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
            }
            ctx.globalAlpha = 1;

            drawHero();

            // HUD: hearts
            for (let i = 0; i < MAX_LIVES; i++) {
                ctx.globalAlpha = i < lives ? 1 : 0.2;
                ctx.fillStyle = "#ff5d5d";
                drawHeart(24 + i * 28, 26, 9);
            }
            ctx.globalAlpha = 1;

            // HUD: power-up timers
            let hudX = 24 + MAX_LIVES * 28 + 8;
            if (shieldTime > 0) {
                ctx.fillStyle = "#39d0ff";
                ctx.font = "700 13px system-ui, sans-serif";
                ctx.textAlign = "left";
                ctx.fillText("SHIELD " + Math.ceil(shieldTime), hudX, 31);
                hudX += 74;
            }
            if (speedBoost > 0) {
                ctx.fillStyle = "#ffd166";
                ctx.font = "700 13px system-ui, sans-serif";
                ctx.textAlign = "left";
                ctx.fillText("SPEED " + Math.ceil(speedBoost), hudX, 31);
            }

            // Charge meter
            if (charging && charge > TAP_MAX) {
                const p = Math.min(charge / CHARGE_FULL, 1);
                const bw = Math.min(W * 0.5, 220);
                const bx = (W - bw) / 2;
                const by = H - 36;
                ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
                roundRect(bx - 3, by - 3, bw + 6, 16, 8);
                ctx.fillStyle = p >= 1 ? "#ffffff" : "#ffd166";
                roundRect(bx, by, bw * p, 10, 5);
                if (p >= 1) {
                    ctx.fillStyle = "#9ad8ff";
                    ctx.font = "700 12px system-ui, sans-serif";
                    ctx.textAlign = "center";
                    ctx.fillText("MEGA BOLT READY!", W / 2, by - 8);
                }
            }

            // Roll cooldown pip
            if (rollCd > 0 && rollTime <= 0) {
                const cp = 1 - rollCd / (ROLL_DUR + ROLL_CD);
                ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
                roundRect(W - 96, H - 30, 72, 12, 6);
                ctx.fillStyle = "#9ad8ff";
                roundRect(W - 94, H - 28, 68 * cp, 8, 4);
            } else if (rollTime <= 0) {
                ctx.fillStyle = "#9ad8ff";
                ctx.font = "700 12px system-ui, sans-serif";
                ctx.textAlign = "right";
                ctx.fillText("\u2193 ROLL READY", W - 24, H - 20);
            }

            // Boss health bar
            if (boss && boss.state !== "enter") {
                const bw = Math.min(W - 48, 320);
                const bx = (W - bw) / 2;
                const by = 48;
                ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
                roundRect(bx - 4, by - 4, bw + 8, 22, 8);
                const hpPct = Math.max(0, boss.hp / boss.maxHp);
                ctx.fillStyle = hpPct > 0.4 ? "#ff7b3d" : "#ff4d4d";
                roundRect(bx, by, bw * hpPct, 14, 6);
                ctx.fillStyle = "#f2f3ff";
                ctx.font = "800 12px system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("STORM TITAN", W / 2, by + 11);
            }

            // Center banner (boss intro / victory)
            if (bannerTime > 0) {
                ctx.globalAlpha = Math.min(1, bannerTime * 1.5);
                ctx.fillStyle = "#ffd166";
                ctx.font = "800 24px system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText(bannerText, W / 2, H * 0.26);
                ctx.globalAlpha = 1;
            }

            if (!started && alive) {
                ctx.fillStyle = "rgba(242, 243, 255, 0.9)";
                ctx.font = "700 17px system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("Tap to jump \u2022 double-tap for double jump", W / 2, H * 0.3);
                ctx.font = "500 14px system-ui, sans-serif";
                ctx.fillStyle = "rgba(154, 160, 195, 0.95)";
                ctx.fillText("HOLD to charge \u2022 drag to AIM \u2022 release to ZAP!", W / 2, H * 0.3 + 26);
                ctx.fillText("Swipe DOWN to roll & dodge \u2022 beat the boss!", W / 2, H * 0.3 + 48);
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

        /* ---------- input: tap = jump, hold = charge & aim, swipe down = roll ---------- */

        const SWIPE_ROLL = 46; // downward pixels that trigger a dodge roll

        function pressStart() {
            if (!alive) return;
            holdStart = performance.now();
            charging = true;
            charge = 0;
            holdMoved = false;
        }

        function pressEnd() {
            if (!alive || !charging) return;
            charging = false;
            if (swipeRoll) { swipeRoll = false; return; }
            const held = (performance.now() - holdStart) / 1000;
            if (held < TAP_MAX) {
                charge = 0;
                jump();
            } else {
                started = true;
                releaseBolt();
            }
        }

        function onTouchStart(e) {
            e.preventDefault();
            const t = e.changedTouches[0];
            gestureStartX = t.clientX;
            gestureStartY = t.clientY;
            swipeRoll = false;
            pressStart();
        }
        function onTouchMove(e) {
            e.preventDefault();
            if (!charging) return;
            const t = e.changedTouches[0];
            const dx = t.clientX - gestureStartX;
            const dy = t.clientY - gestureStartY;
            // A clear downward flick rolls — but only before a bolt starts charging.
            if (!swipeRoll && charge <= TAP_MAX && dy > SWIPE_ROLL && dy > Math.abs(dx)) {
                swipeRoll = true;
                charging = false;
                charge = 0;
                roll();
                return;
            }
            aimFromClient(t.clientX, t.clientY);
        }
        function onTouchEnd(e) {
            e.preventDefault();
            pressEnd();
        }
        function onMouseDown(e) {
            gestureStartX = e.clientX;
            gestureStartY = e.clientY;
            swipeRoll = false;
            pressStart();
        }
        function onMouseMove(e) {
            if (!charging) return;
            const dx = e.clientX - gestureStartX;
            const dy = e.clientY - gestureStartY;
            if (!swipeRoll && charge <= TAP_MAX && dy > SWIPE_ROLL && dy > Math.abs(dx)) {
                swipeRoll = true;
                charging = false;
                charge = 0;
                roll();
                return;
            }
            aimFromClient(e.clientX, e.clientY);
        }
        function onMouseUp() { pressEnd(); }
        function onKeyDown(e) {
            if (e.repeat) return;
            if (e.code === "Space" || e.key === "ArrowUp") { e.preventDefault(); pressStart(); }
            else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") { e.preventDefault(); roll(); }
            else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") { aimKey = -1; }
            else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") { aimKey = 1; }
        }
        function onKeyUp(e) {
            if (e.code === "Space" || e.key === "ArrowUp") { e.preventDefault(); pressEnd(); }
            else if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") { if (aimKey < 0) aimKey = 0; }
            else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") { if (aimKey > 0) aimKey = 0; }
        }

        return {
            start() {
                resize();
                reset();
                window.addEventListener("resize", resize);
                canvas.addEventListener("touchstart", onTouchStart, { passive: false });
                canvas.addEventListener("touchmove", onTouchMove, { passive: false });
                canvas.addEventListener("touchend", onTouchEnd, { passive: false });
                canvas.addEventListener("mousedown", onMouseDown);
                window.addEventListener("mousemove", onMouseMove);
                window.addEventListener("mouseup", onMouseUp);
                window.addEventListener("keydown", onKeyDown);
                window.addEventListener("keyup", onKeyUp);
                rafId = requestAnimationFrame(loop);
            },
            restart() {
                update.lastD = 0;
                reset();
            },
            destroy() {
                cancelAnimationFrame(rafId);
                window.removeEventListener("resize", resize);
                canvas.removeEventListener("touchstart", onTouchStart);
                canvas.removeEventListener("touchmove", onTouchMove);
                canvas.removeEventListener("touchend", onTouchEnd);
                canvas.removeEventListener("mousedown", onMouseDown);
                window.removeEventListener("mousemove", onMouseMove);
                window.removeEventListener("mouseup", onMouseUp);
                window.removeEventListener("keydown", onKeyDown);
                window.removeEventListener("keyup", onKeyUp);
            }
        };
    }

    window.SGGames = window.SGGames || {};
    window.SGGames.stormquest = {
        id: "stormquest",
        name: "Storm Quest",
        emoji: "\u26A1",
        tag: "Aim lightning, roll to dodge & slay the Storm Titan.",
        scoreLabel: "points",
        create: create
    };
})();

