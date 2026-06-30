/* ============ Watch Swap — guard the wall ============ */
/* Night: the Knight Owl stands centre-wall and swipes to aim a narrow
   lantern beam at the wolves converging on the gate; light wears them down.
   Day: the Early Bird keeps the noise down so the Owl can sleep.          */
(function () {
    "use strict";

    function create(host) {
        const canvas = host.canvas;
        const ctx = canvas.getContext("2d");
        const kids = !!host.kids;

        // --- Tunables (kids mode is gentler) ---
        const START_HEARTS = kids ? 5 : 3;
        const NIGHT_MS = kids ? 40000 : 46000;
        const BEAM_HALF = 0.16;                // narrow beam cone — aim matters
        const MAX_TILT = kids ? 1.05 : 0.95;   // how far the beam swings from vertical
        const AIM_LERP = 14;                   // how quickly the beam eases to the swipe
        const AIM_SENS = 2.2;                  // swipe gain — beam travel per finger travel
        const BUSH_COUNT = 6;
        const DAY_MS = kids ? 32000 : 36000;
        const DAY_SPEED = 0.52;                // bird patrol speed (×W / sec)
        const HUSH_FRAC = 0.18;                // bird must be within this (×unit) to hush an item
        const NOISE_MAX = 100;
        const COMBO_WINDOW = 2.6;              // seconds to chain good actions into a combo
        const OVERLAP_AUTO = 7;                // seconds before a hand-off auto-continues
        const WOLF_HP = kids ? 0.8 : 1.0;      // seconds of sustained light to drive a wolf off
        const STALKER_HP = kids ? 1.2 : 1.6;   // stalkers take longer to wear down
        const LIGHT_DPS = 1.0;                 // light drains this much wolf health per second

        let W, H, unit, wallY, fieldTop, lanternY, ox, targetX, facing;
        let bushes, wolves, hearts, score, night;
        let beamActive, beamAngle, beamTargetAngle, pointerDown, started, alive, paused;
        let spawnTimer, spawnInterval, wolfTravel, nightT;
        let phase, dayT, noise, owlRested, beamHalfMul, beamRangeMul, beamPowerMul;
        let spots, distSpawnTimer, distInterval;
        let keepFloorY, owlBedX, flash, lanternStationX, lanternReady;
        let overlapKind, overlapNext, overlapT;
        let pops, particles, combo, comboTimer, hurt, shakeT;
        let rafId, lastTs;
        let dragging = false;
        const keys = { left: false, right: false };

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = canvas.clientWidth;
            H = canvas.clientHeight;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            unit = Math.min(W, H);
            wallY = H * 0.82;
            fieldTop = H * 0.30;
            lanternY = wallY - unit * 0.14;
            layoutBushes();
            layoutKeep();
        }

        // The day's castle-keep bedroom: fixed furniture, each a possible noise source.
        function layoutKeep() {
            keepFloorY = H * 0.80;
            owlBedX = W * 0.16;
            lanternStationX = W * 0.50;
            const defs = [
                { x: 0.30, vy: 0.60, kind: "books" },
                { x: 0.40, vy: 0.74, kind: "dishes" },
                { x: 0.64, vy: 0.78, kind: "mouse", hidden: true },
                { x: 0.74, vy: 0.66, kind: "armor" },
                { x: 0.88, vy: 0.20, kind: "window" }
            ];
            const keep = spots;   // preserve active state across resizes
            spots = defs.map(function (d, i) {
                return {
                    x: W * d.x, vy: H * d.vy, kind: d.kind, hidden: !!d.hidden,
                    active: keep && keep[i] ? keep[i].active : false,
                    shake: Math.random() * 6.28, sndT: 0, rate: 0
                };
            });
        }

        function layoutBushes() {
            bushes = [];
            for (let i = 0; i < BUSH_COUNT; i++) {
                const t = (i + 0.5) / BUSH_COUNT;
                bushes.push({ x: W * (0.08 + t * 0.84), y: fieldTop + Math.sin(i * 1.7) * (unit * 0.02) });
            }
        }

        function reset() {
            ox = W / 2;
            targetX = ox;
            facing = 1;
            wolves = [];
            hearts = START_HEARTS;
            score = 0;
            night = 1;
            beamActive = false; beamAngle = 0; beamTargetAngle = 0; pointerDown = false;
            started = false;
            alive = true;
            paused = false;
            nightT = 0;
            phase = "night";
            dayT = 0;
            noise = 0;
            owlRested = true;
            beamHalfMul = 1;
            beamRangeMul = 1;
            beamPowerMul = 1;
            lanternReady = 0;
            for (const s of spots) s.active = false;
            flash = 0;
            overlapNext = null;
            overlapT = 0;
            pops = []; particles = []; combo = 0; comboTimer = 0; hurt = 0; shakeT = 0;
            applyNight();
            spawnTimer = spawnInterval * 0.6;
            lastTs = 0;
            host.setScore(0);
        }

        // Difficulty scales gently with each night survived.
        function applyNight() {
            const n = night - 1;
            spawnInterval = Math.max(kids ? 1.5 : 1.0, (kids ? 3.2 : 2.3) - n * 0.22);
            wolfTravel = Math.max(kids ? 6.5 : 4.4, (kids ? 9.5 : 7.2) - n * 0.45); // seconds tree→wall
        }
        function applyDay() {
            distInterval = Math.max(kids ? 2.4 : 1.7, (kids ? 3.8 : 2.9) - (night - 1) * 0.18);
        }

        // Dawn: the night is survived — hand off to the Early Bird's day watch.
        function enterDay() {
            phase = "day";
            dayT = 0;
            score += 5;                 // survived the night
            host.setScore(score);
            wolves = [];
            noise = 0;
            owlRested = true;
            lanternReady = 0;
            for (const s of spots) s.active = false;
            combo = 0; comboTimer = 0; pops = []; particles = [];
            ox = W / 2; targetX = ox; facing = 1;
            applyDay();
            distSpawnTimer = distInterval * 0.5;
            flash = 0.5;
            host.vibrate([20, 40, 20]);
            SGSound.play("score");
        }

        // Dusk: hand the watch back to the Owl. A kept-awake owl guards poorly.
        function enterNight() {
            phase = "night";
            night += 1;
            applyNight();
            nightT = 0;
            wolves = [];
            beamHalfMul = owlRested ? 1 : 0.62;
            beamRangeMul = owlRested ? 1 : 0.68;
            // Rest sets the base; a well-tended lantern adds power on top.
            beamPowerMul = Math.min(1.4, (owlRested ? 1 : 0.5) + (lanternReady / 100) * 0.5);
            if (owlRested) { score += 3; host.setScore(score); }   // quiet-day bonus
            ox = W / 2; targetX = ox; facing = 1;
            beamActive = false; beamAngle = 0; beamTargetAngle = 0; pointerDown = false;
            combo = 0; comboTimer = 0; pops = []; particles = [];
            spawnTimer = spawnInterval * 0.6;
            flash = 0.5;
            host.vibrate([20, 40, 20]);
            SGSound.play(owlRested ? "score" : "wrong");
        }

        // Wake a random quiet item in the keep — it starts rattling.
        function spawnDisturbance() {
            const idle = spots.filter(function (s) { return !s.active; });
            if (!idle.length) return;
            const s = idle[Math.floor(Math.random() * idle.length)];
            s.active = true;
            s.sndT = 0.4 + Math.random() * 0.4;
            s.rate = (kids ? 5 : 8) + (night - 1) * 0.6;
            playNoise(s.kind);
        }

        // Each item has its own racket, repeated while it's left unhushed.
        function playNoise(kind) {
            if (kind === "window") SGSound.play("note3");
            else if (kind === "armor") SGSound.play("note1");
            else if (kind === "dishes") SGSound.play("note2");
            else if (kind === "books") SGSound.play("note0");
            else SGSound.play("flip");   // mouse
        }

        function hush(s) {
            if (!s.active) return;
            s.active = false;
            goodAction();
            noise = Math.max(0, noise - 6 - combo);   // a hush streak settles the room faster
            host.vibrate(12);
            SGSound.play(combo > 2 ? "match" : "eat");
            addPop(s.x, s.vy, combo > 1 ? "shh ×" + combo : "shh", "#9ad6a0");
            burst(s.x, s.vy, 6, "#e7d2a4", unit * 0.6);
        }

        function spotOf(kind) { for (const s of spots) if (s.kind === kind) return s; return null; }
        function spotJitter(kind) { const s = spotOf(kind); return (s && s.active) ? Math.sin(s.shake) * unit * 0.006 : 0; }

        // Tending the lantern readies the night's beam — but it's noisy work.
        function tendLantern() {
            lanternReady = Math.min(100, lanternReady + 25);
            noise = Math.min(NOISE_MAX, noise + 12);
            host.vibrate(10);
            SGSound.play("drop");
            if (noise >= NOISE_MAX && owlRested) wakeOwl();
        }

        function wakeOwl() {
            owlRested = false;   // locked in — the owl will guard poorly tonight
            combo = 0;
            flash = 0.6;
            hurt = 0.5;
            shakeT = 0.35;
            host.vibrate([60, 40, 60]);
            SGSound.play("wrong");
            addPop(owlBedX, keepFloorY - unit * 0.16, "owl woke!", "#ff6a52");
        }

        function spawnWolf() {
            const b = bushes[Math.floor(Math.random() * bushes.length)];
            // Stalkers show up from night 2 on — faster, darker, exploit dark gaps.
            const stalker = night >= 2 && Math.random() < Math.min(0.45, 0.12 + (night - 2) * 0.08);
            const hp = stalker ? STALKER_HP : WOLF_HP;
            wolves.push({
                x: b.x + (Math.random() - 0.5) * unit * 0.06,
                y: b.y,
                wait: (stalker ? 0.3 : 0.5) + Math.random() * 0.8,   // lurk in the bush first
                state: "lurk",                      // lurk → creep → flee
                stalker: stalker,
                hp: hp,
                maxHp: hp,
                wob: Math.random() * 6.28
            });
        }

        // Point the beam toward the swiped column (clamped to the tilt range).
        function aimBeam(x) {
            const t = (x - W / 2) / (W * 0.5) * AIM_SENS;   // sensitivity gain
            beamTargetAngle = Math.max(-MAX_TILT, Math.min(MAX_TILT, t * MAX_TILT));
        }

        /* ---------- Geometry ---------- */
        function clampX(x) { return Math.max(W * 0.06, Math.min(W * 0.94, x)); }

        // Is the wolf inside the aimed, narrow beam from the centered owl?
        function inBeam(w) {
            if (!beamActive) return false;
            const dx = w.x - W / 2;
            const dy = lanternY - w.y;            // positive = above the owl
            if (dy <= 0) return false;
            if (Math.hypot(dx, dy) > unit * 1.7 * beamRangeMul) return false;
            const ang = Math.atan2(dx, dy);       // signed: right of vertical = positive
            return Math.abs(ang - beamAngle) < BEAM_HALF * beamHalfMul;
        }
        function isLit(w) { return inBeam(w); }

        /* ---------- Update ---------- */
        function update(dt) {
            if (flash > 0) flash = Math.max(0, flash - dt);
            if (hurt > 0) hurt = Math.max(0, hurt - dt);
            if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);
            if (comboTimer > 0) { comboTimer -= dt; if (comboTimer <= 0) combo = 0; }
            updateFx(dt);
            if (phase === "night") updateNight(dt);
            else if (phase === "day") updateDay(dt);
            else updateOverlap(dt);
        }

        /* ---------- Juice (pops, particles, combo) ---------- */
        function goodAction() { combo += 1; comboTimer = COMBO_WINDOW; }
        function addPop(x, y, text, color) { pops.push({ x: x, y: y, text: text, color: color, t: 0 }); }
        function burst(x, y, n, color, spd) {
            for (let i = 0; i < n; i++) {
                particles.push({
                    x: x, y: y, vx: (Math.random() - 0.5) * spd, vy: -Math.random() * spd * 0.8,
                    t: 0, life: 0.45 + Math.random() * 0.35, r: unit * 0.008 * (0.7 + Math.random()), color: color
                });
            }
        }
        function updateFx(dt) {
            for (let i = pops.length - 1; i >= 0; i--) { pops[i].t += dt; if (pops[i].t > 0.9) pops.splice(i, 1); }
            for (let i = particles.length - 1; i >= 0; i--) {
                const p = particles[i];
                p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += unit * 2.4 * dt;
                if (p.t > p.life) particles.splice(i, 1);
            }
        }

        // The shared dawn/dusk hand-off — a cozy beat in the tower.
        function enterOverlap(kind, nextFn) {
            phase = "overlap";
            overlapKind = kind;
            overlapNext = nextFn;
            overlapT = 0;
            dragging = false; pointerDown = false;
            if (kind === "dawn" && hearts < START_HEARTS) hearts += 1;   // a good night's rest
            flash = 0.5;
            host.vibrate(20);
            SGSound.play("match");
        }

        function updateOverlap(dt) {
            overlapT += dt;
            if (overlapT >= OVERLAP_AUTO) continueOverlap();
        }

        function continueOverlap() {
            const fn = overlapNext;
            overlapNext = null;
            if (fn) fn();
        }

        function moveGuard(speedFrac, dt) {
            const speed = speedFrac * W;
            if (keys.left) targetX = W * 0.06;
            else if (keys.right) targetX = W * 0.94;
            const dx = targetX - ox;
            if (Math.abs(dx) > 1) {
                const move = Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
                ox += move;
                facing = Math.sign(dx);
            }
        }

        function updateNight(dt) {
            // The owl is fixed; the beam eases toward the swipe (or arrow keys).
            if (keys.left) beamTargetAngle = -MAX_TILT;
            else if (keys.right) beamTargetAngle = MAX_TILT;
            beamActive = (pointerDown || keys.left || keys.right);
            beamAngle += (beamTargetAngle - beamAngle) * Math.min(1, dt * AIM_LERP);
            facing = beamAngle < 0 ? -1 : 1;
            if (!started) return;

            nightT += dt;
            if (nightT >= NIGHT_MS / 1000) { enterOverlap("dawn", enterDay); return; }

            // Spawn wolves.
            spawnTimer -= dt;
            if (spawnTimer <= 0) {
                spawnTimer = spawnInterval * (0.7 + Math.random() * 0.6);
                if (wolves.length < 7) spawnWolf();
            }

            const v = (wallY - fieldTop) / wolfTravel;   // px/sec toward the gate
            const gx = W / 2, gy = wallY - unit * 0.04;
            for (let i = wolves.length - 1; i >= 0; i--) {
                const w = wolves[i];
                w.wob += dt * 4;
                const speed = v * (w.stalker ? 1.45 : 1);

                if (w.state === "lurk") {
                    if (isLit(w)) { w.hp -= LIGHT_DPS * beamPowerMul * dt; if (w.hp <= 0) scare(w); }
                    else { w.wait -= dt; if (w.wait <= 0) w.state = "creep"; }
                } else if (w.state === "creep") {
                    if (isLit(w)) {
                        // Light holds the wolf at bay and wears it down (slower if the beam is weak).
                        w.hp -= LIGHT_DPS * beamPowerMul * dt;
                        if (w.hp <= 0) scare(w);
                    } else {
                        // Advance toward the gate at the centre of the wall.
                        const dxg = gx - w.x, dyg = gy - w.y, d = Math.hypot(dxg, dyg) || 1;
                        w.x += (dxg / d) * speed * dt;
                        w.y += (dyg / d) * speed * dt;
                        if (w.y >= gy - 1) { breach(); wolves.splice(i, 1); }
                    }
                } else if (w.state === "flee") {
                    w.y -= speed * 2.2 * dt;
                    if (w.y < fieldTop - unit * 0.08) wolves.splice(i, 1);
                }
            }
        }

        function updateDay(dt) {
            moveGuard(DAY_SPEED, dt);

            dayT += dt;
            if (dayT >= DAY_MS / 1000) { enterOverlap("dusk", enterNight); return; }

            // Now and then a quiet item starts up.
            distSpawnTimer -= dt;
            if (distSpawnTimer <= 0) {
                distSpawnTimer = distInterval * (0.7 + Math.random() * 0.6);
                spawnDisturbance();
            }

            // Active items rattle — sound, a buzz of vibration, and rising noise.
            let rate = 0;
            for (const s of spots) {
                if (!s.active) continue;
                s.shake += dt * 16;
                rate += s.rate;
                s.sndT -= dt;
                if (s.sndT <= 0) { s.sndT = 1.0 + Math.random() * 0.5; playNoise(s.kind); host.vibrate(6); }
            }
            if (rate > 0) noise = Math.min(NOISE_MAX, noise + rate * dt);
            else noise = Math.max(0, noise - dt * 4);
            if (noise >= NOISE_MAX && owlRested) wakeOwl();
        }

        function scare(w) {
            if (w.state === "flee") return;
            w.state = "flee";
            goodAction();
            score += combo;                 // chained shoos are worth more
            host.setScore(score);
            host.vibrate(10);
            SGSound.play(combo > 2 ? "score" : "flap");
            addPop(w.x, w.y - unit * 0.05, "+" + combo, "#ffe14d");
            burst(w.x, w.y, 7, "#7a6e54", unit * 0.9);
        }

        function breach() {
            hearts -= 1;
            combo = 0;
            hurt = 0.6;
            shakeT = 0.4;
            host.vibrate([50, 30, 60]);
            SGSound.play("hit");
            addPop(W / 2, wallY - unit * 0.12, "breach!", "#ff6a52");
            burst(W / 2, wallY - unit * 0.02, 10, "#6b6456", unit * 1.1);
            if (hearts <= 0) {
                alive = false;
                SGSound.play("gameover");
                host.gameOver(score);
            }
        }

        /* ---------- Drawing ---------- */
        function draw() {
            const shaking = shakeT > 0;
            if (shaking) {
                const m = shakeT * unit * 0.04;
                ctx.save();
                ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
            }
            if (phase === "night") drawNight();
            else if (phase === "day") drawDay();
            else drawOverlap();
            drawParticles();
            drawPops();
            if (phase !== "overlap") drawCombo();
            if (shaking) ctx.restore();

            if (flash > 0) {
                ctx.fillStyle = "rgba(255,247,235," + (flash * 0.5) + ")";
                ctx.fillRect(0, 0, W, H);
            }
            if (hurt > 0) {
                ctx.fillStyle = "rgba(200,40,30," + (hurt * 0.38) + ")";
                ctx.fillRect(0, 0, W, H);
            }
        }

        function drawParticles() {
            for (const p of particles) {
                ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
                ctx.fillStyle = p.color;
                ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill();
            }
            ctx.globalAlpha = 1;
        }

        function drawPops() {
            ctx.textAlign = "center";
            for (const p of pops) {
                ctx.globalAlpha = Math.max(0, 1 - p.t / 0.9);
                ctx.fillStyle = p.color;
                ctx.font = "700 " + Math.round(unit * (0.04 + p.t * 0.02)) + "px Georgia, serif";
                ctx.fillText(p.text, p.x, p.y - p.t * unit * 0.12);
            }
            ctx.globalAlpha = 1;
        }

        function drawCombo() {
            if (combo < 2) return;
            ctx.globalAlpha = Math.min(1, comboTimer / COMBO_WINDOW + 0.25);
            ctx.fillStyle = "#ffd86a";
            ctx.font = "700 " + Math.round(unit * 0.052) + "px Georgia, serif";
            ctx.textAlign = "center";
            ctx.fillText(combo + "× combo!", W / 2, H * 0.24);
            ctx.globalAlpha = 1;
        }

        function drawNight() {
            // Sky
            const sky = ctx.createLinearGradient(0, 0, 0, wallY);
            sky.addColorStop(0, "#13153a");
            sky.addColorStop(0.6, "#231f4c");
            sky.addColorStop(1, "#3a3566");
            ctx.fillStyle = sky;
            ctx.fillRect(0, 0, W, H);

            drawMoonAndStars();

            // Grass field
            const grass = ctx.createLinearGradient(0, fieldTop, 0, wallY);
            grass.addColorStop(0, "#2c3a30");
            grass.addColorStop(1, "#161f17");
            ctx.fillStyle = grass;
            ctx.fillRect(0, fieldTop, W, wallY - fieldTop);

            for (const b of bushes) drawBush(b.x, b.y);

            // Lurking wolves' eyes shine from the bushes; creeping ones in the open.
            for (const w of wolves) if (w.state !== "lurk") drawWolf(w);
            for (const w of wolves) if (w.state === "lurk") drawEyes(w.x, w.y, !w.stalker);
            for (const w of wolves) if (w.state !== "flee" && w.hp < w.maxHp) drawWolfHealth(w);

            drawBeam();
            drawOwl();
            drawWall();
            drawHUD();

            if (!started) {
                ctx.fillStyle = "rgba(242,243,255,0.9)";
                ctx.font = "600 " + Math.round(unit * 0.05) + "px Georgia, serif";
                ctx.textAlign = "center";
                ctx.fillText("Swipe to aim the lantern beam", W / 2, fieldTop + unit * 0.16);
                ctx.font = "500 " + Math.round(unit * 0.038) + "px Georgia, serif";
                ctx.fillStyle = "rgba(242,243,255,0.7)";
                ctx.fillText("Hold the light on a wolf to wear it down and drive it back", W / 2, fieldTop + unit * 0.24);
            }
        }

        function drawMoonAndStars() {
            const mx = W * 0.84, my = H * 0.18, mr = unit * 0.07;
            const g = ctx.createRadialGradient(mx, my, mr * 0.4, mx, my, mr * 3);
            g.addColorStop(0, "rgba(238,240,255,0.5)");
            g.addColorStop(1, "rgba(238,240,255,0)");
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(mx, my, mr * 3, 0, 6.28); ctx.fill();
            ctx.fillStyle = "#eef0ff";
            ctx.beginPath(); ctx.arc(mx, my, mr, 0, 6.28); ctx.fill();

            ctx.fillStyle = "rgba(223,226,255,0.85)";
            for (let i = 0; i < 22; i++) {
                const sx = (i * 97 % 100) / 100 * W;
                const sy = ((i * 53) % 100) / 100 * fieldTop * 0.95;
                ctx.beginPath(); ctx.arc(sx, sy, (i % 3 === 0 ? 1.6 : 1), 0, 6.28); ctx.fill();
            }
        }

        function drawBush(x, y) {
            const r = unit * 0.07;
            ctx.fillStyle = "#22341d";
            ctx.beginPath(); ctx.ellipse(x, y + r * 0.5, r * 1.1, r * 0.6, 0, 0, 6.28); ctx.fill();
            const bumps = [[-0.7, 0.1, 0.55], [0, -0.25, 0.7], [0.7, 0.1, 0.55], [-0.35, -0.1, 0.4], [0.35, -0.1, 0.4]];
            for (let i = 0; i < bumps.length; i++) {
                ctx.fillStyle = i % 2 ? "#33502c" : "#2c4426";
                ctx.beginPath();
                ctx.arc(x + bumps[i][0] * r, y + bumps[i][1] * r, bumps[i][2] * r, 0, 6.28);
                ctx.fill();
            }
        }

        function drawEyes(x, y, warm) {
            const s = unit * 0.012;
            ctx.fillStyle = warm ? "#ffe14d" : "#9af0a0";
            ctx.beginPath(); ctx.arc(x - s * 1.4, y, s, 0, 6.28); ctx.arc(x + s * 1.4, y, s, 0, 6.28); ctx.fill();
            ctx.fillStyle = "#1a1206";
            ctx.beginPath(); ctx.arc(x - s * 1.4, y, s * 0.4, 0, 6.28); ctx.arc(x + s * 1.4, y, s * 0.4, 0, 6.28); ctx.fill();
        }

        function drawWolf(w) {
            const lit = w.state === "flee" || isLit(w);
            const s = unit * (w.stalker ? 0.042 : 0.05);
            const bob = Math.sin(w.wob) * s * 0.06;
            ctx.save();
            ctx.translate(w.x, w.y + bob);
            if (w.state === "flee") { ctx.rotate(Math.sin(w.wob) * 0.4); ctx.scale(-1, 1); }   // tumble and run
            ctx.fillStyle = lit ? "#6a6e78" : (w.stalker ? "#23272f" : "#3f434c");
            ctx.beginPath(); ctx.ellipse(0, s * 0.2, s * 0.7, s * 0.36, 0, 0, 6.28); ctx.fill();
            // legs
            ctx.fillStyle = lit ? "#565a63" : "#33373f";
            for (const lx of [-0.45, -0.15, 0.15, 0.45]) ctx.fillRect(lx * s - s * 0.05, s * 0.4, s * 0.1, s * 0.35);
            // head
            ctx.beginPath(); ctx.arc(-s * 0.55, -s * 0.1, s * 0.3, 0, 6.28); ctx.fill();
            ctx.beginPath(); ctx.moveTo(-s * 0.8, -s * 0.05); ctx.lineTo(-s * 1.15, s * 0.08); ctx.lineTo(-s * 0.78, s * 0.18); ctx.fill();
            // ears
            ctx.beginPath(); ctx.moveTo(-s * 0.65, -s * 0.35); ctx.lineTo(-s * 0.55, -s * 0.55); ctx.lineTo(-s * 0.45, -s * 0.3); ctx.fill();
            ctx.restore();
            drawEyes(w.x - s * 0.55, w.y - s * 0.12 + bob, !w.stalker);
        }

        function drawWolfHealth(w) {
            const s = unit * (w.stalker ? 0.042 : 0.05);
            const bw = s * 1.7, bh = unit * 0.011, bx = w.x - bw / 2, by = w.y - s * 1.05;
            ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
            const r = Math.max(0, w.hp / w.maxHp);
            ctx.fillStyle = r > 0.5 ? "#7cd86a" : (r > 0.25 ? "#e8b84a" : "#e0503a");
            ctx.fillRect(bx, by, bw * r, bh);
        }

        function drawBeam() {
            if (!beamActive) return;
            const half = BEAM_HALF * beamHalfMul;
            const len = unit * 1.7 * beamRangeMul;
            const ax = W / 2, ay = lanternY;
            const a1 = beamAngle - half, a2 = beamAngle + half;
            const x1 = ax + Math.sin(a1) * len, y1 = ay - Math.cos(a1) * len;
            const x2 = ax + Math.sin(a2) * len, y2 = ay - Math.cos(a2) * len;
            const cx = ax + Math.sin(beamAngle) * len, cy = ay - Math.cos(beamAngle) * len;
            const g = ctx.createLinearGradient(ax, ay, cx, cy);
            const a = beamRangeMul < 1 ? 0.28 : 0.42;   // a tired owl's beam is dimmer
            g.addColorStop(0, "rgba(255,231,168," + a + ")");
            g.addColorStop(1, "rgba(255,231,168,0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(ax, ay); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.closePath();
            ctx.fill();
        }

        function drawOwl() {
            const cx = W / 2, baseY = wallY, h = unit * 0.2;   // owl is fixed at centre
            const headR = h * 0.42, bodyW = h * 0.5, bodyH = h * 0.6;
            const bodyCy = baseY - bodyH * 0.55;
            const headCy = bodyCy - bodyH * 0.55;

            // body (armor)
            ctx.fillStyle = "#7e8694";
            ctx.beginPath(); ctx.ellipse(cx, bodyCy, bodyW, bodyH * 0.62, 0, 0, 6.28); ctx.fill();
            ctx.fillStyle = "#9aa1ad";
            ctx.beginPath(); ctx.ellipse(cx - bodyW * 0.12, bodyCy + bodyH * 0.05, bodyW * 0.55, bodyH * 0.45, 0, 0, 6.28); ctx.fill();
            // head
            ctx.fillStyle = "#8a6840";
            ctx.beginPath(); ctx.arc(cx, headCy, headR, 0, 6.28); ctx.fill();
            // helmet dome
            ctx.fillStyle = "#aab1bd";
            ctx.beginPath(); ctx.arc(cx, headCy, headR, Math.PI, 0); ctx.lineTo(cx + headR * 0.85, headCy); ctx.arc(cx, headCy, headR * 0.85, 0, Math.PI, true); ctx.fill();
            ctx.fillStyle = "#878e9c";
            ctx.fillRect(cx - headR * 0.1, headCy - headR * 0.8, headR * 0.2, headR * 0.85);
            // face disc + eyes
            ctx.fillStyle = "#dcc99e";
            ctx.beginPath(); ctx.ellipse(cx, headCy + headR * 0.2, headR * 0.78, headR * 0.72, 0, 0, 6.28); ctx.fill();
            const er = headR * 0.3;
            for (const side of [-1, 1]) {
                const exx = cx + side * headR * 0.34;
                ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(exx, headCy + headR * 0.12, er, 0, 6.28); ctx.fill();
                ctx.fillStyle = "#e8a93a"; ctx.beginPath(); ctx.arc(exx + facing * er * 0.18, headCy + headR * 0.14, er * 0.6, 0, 6.28); ctx.fill();
                ctx.fillStyle = "#20140a"; ctx.beginPath(); ctx.arc(exx + facing * er * 0.18, headCy + headR * 0.14, er * 0.3, 0, 6.28); ctx.fill();
            }
            ctx.fillStyle = "#d98a34";
            ctx.beginPath(); ctx.moveTo(cx - er * 0.3, headCy + headR * 0.5); ctx.lineTo(cx + er * 0.3, headCy + headR * 0.5); ctx.lineTo(cx, headCy + headR * 0.8); ctx.fill();

            // A kept-awake owl is heavy-lidded and droopy.
            if (!owlRested) {
                ctx.fillStyle = "#dcc99e";
                for (const side of [-1, 1]) {
                    const exx = cx + side * headR * 0.34;
                    ctx.beginPath(); ctx.ellipse(exx, headCy + headR * 0.12 - er * 0.5, er * 1.15, er * 0.78, 0, 0, 6.28); ctx.fill();
                }
            }

        }

        function drawWall() {
            const top = wallY + unit * 0.02;
            ctx.fillStyle = "#5f5a4d";
            ctx.fillRect(0, top, W, H - top);
            ctx.fillStyle = "#726c5c";
            ctx.fillRect(0, top - unit * 0.012, W, unit * 0.018);
            // merlons
            ctx.fillStyle = "#6b6456";
            const mw = unit * 0.07, gap = mw * 1.4;
            for (let x = -gap * 0.5; x < W; x += mw + gap) ctx.fillRect(x, top - unit * 0.045, mw, unit * 0.05);
        }

        function heart(x, y, r, filled) {
            ctx.fillStyle = filled ? "#ff5d7d" : "rgba(255,255,255,0.22)";
            ctx.beginPath();
            ctx.moveTo(x, y + r * 0.3);
            ctx.bezierCurveTo(x, y, x - r, y - r * 0.1, x - r, y + r * 0.35);
            ctx.bezierCurveTo(x - r, y + r * 0.8, x, y + r * 1.1, x, y + r * 1.4);
            ctx.bezierCurveTo(x, y + r * 1.1, x + r, y + r * 0.8, x + r, y + r * 0.35);
            ctx.bezierCurveTo(x + r, y - r * 0.1, x, y, x, y + r * 0.3);
            ctx.fill();
        }

        function roundRectFill(x, y, w, h, r) {
            r = Math.min(r, w / 2, h / 2);
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.arcTo(x + w, y, x + w, y + h, r);
            ctx.arcTo(x + w, y + h, x, y + h, r);
            ctx.arcTo(x, y + h, x, y, r);
            ctx.arcTo(x, y, x + w, y, r);
            ctx.fill();
        }

        // Sun→moon arc with a token showing how far through the phase we are.
        function drawDial(p, label, labelColor) {
            p = Math.min(1, p);
            const cx = W / 2, ay = unit * 0.07, aw = unit * 0.34, ah = unit * 0.05;
            ctx.strokeStyle = "rgba(216,195,154,0.85)"; ctx.lineWidth = unit * 0.012;
            ctx.beginPath(); ctx.moveTo(cx - aw, ay); ctx.quadraticCurveTo(cx, ay - ah, cx + aw, ay); ctx.stroke();
            ctx.fillStyle = "#ffd86a"; ctx.beginPath(); ctx.arc(cx - aw, ay, unit * 0.014, 0, 6.28); ctx.fill();
            ctx.fillStyle = "#eef0ff"; ctx.beginPath(); ctx.arc(cx + aw, ay, unit * 0.016, 0, 6.28); ctx.fill();
            const tx = cx - aw + p * aw * 2, ty = ay - ah * (1 - (2 * p - 1) * (2 * p - 1));
            ctx.fillStyle = "#fff1c0"; ctx.strokeStyle = "#c98a2e"; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(tx, ty, unit * 0.018, 0, 6.28); ctx.fill(); ctx.stroke();
            ctx.fillStyle = labelColor;
            ctx.font = "600 " + Math.round(unit * 0.032) + "px Georgia, serif";
            ctx.textAlign = "center";
            ctx.fillText(label, cx, ay + unit * 0.06);
        }

        function drawNoiseMeter() {
            const bw = unit * 0.26, bh = unit * 0.03, bx = unit * 0.06, by = unit * 0.055;
            ctx.fillStyle = "rgba(40,40,60,0.9)";
            ctx.font = "600 " + Math.round(unit * 0.028) + "px Georgia, serif";
            ctx.textAlign = "left";
            ctx.fillText("noise", bx, by - unit * 0.012);
            ctx.fillStyle = "rgba(120,110,90,0.4)"; roundRectFill(bx, by, bw, bh, bh * 0.5);
            const p = noise / NOISE_MAX;
            ctx.fillStyle = p > 0.75 ? "#e0503a" : "#e0922e";
            if (p > 0) roundRectFill(bx, by, bw * p, bh, bh * 0.5);
            ctx.textAlign = "center";
        }

        function drawHUD() {
            const hr = unit * 0.025;
            for (let i = 0; i < START_HEARTS; i++) heart(unit * 0.06 + i * hr * 3, unit * 0.05, hr, i < hearts);
            drawDial(nightT / (NIGHT_MS / 1000), "Night " + night, "rgba(242,243,255,0.85)");
            ctx.font = "500 " + Math.round(unit * 0.026) + "px Georgia, serif";
            ctx.textAlign = "center";
            if (beamPowerMul < 0.9) {
                ctx.fillStyle = "rgba(255,150,110,0.95)";
                ctx.fillText("tired owl · weak beam", W / 2, unit * 0.165);
            } else if (beamPowerMul > 1.15) {
                ctx.fillStyle = "rgba(150,230,150,0.95)";
                ctx.fillText("lantern readied · strong beam", W / 2, unit * 0.165);
            }
        }

        function drawReadyGauge(labelColor) {
            const ogw = unit * 0.2, ogh = unit * 0.03, ogx = W - ogw - unit * 0.05, ogy = unit * 0.055;
            ctx.fillStyle = labelColor;
            ctx.font = "600 " + Math.round(unit * 0.026) + "px Georgia, serif";
            ctx.textAlign = "right";
            ctx.fillText("lantern", ogx + ogw, ogy - unit * 0.012);
            ctx.fillStyle = "rgba(191,166,118,0.4)";
            roundRectFill(ogx, ogy, ogw, ogh, ogh * 0.5);
            ctx.fillStyle = "#e0a82e";
            if (lanternReady > 0) roundRectFill(ogx, ogy, ogw * (lanternReady / 100), ogh, ogh * 0.5);
            ctx.textAlign = "center";
        }

        function drawHUDDay() {
            drawNoiseMeter();
            drawReadyGauge("rgba(40,40,60,0.9)");
            drawDial(dayT / (DAY_MS / 1000), "Day " + night, "rgba(40,40,60,0.9)");
        }

        function drawDay() {
            const fy = keepFloorY;
            // Warm stone back wall.
            const wall = ctx.createLinearGradient(0, 0, 0, fy);
            wall.addColorStop(0, "#caa978"); wall.addColorStop(1, "#b6926a");
            ctx.fillStyle = wall; ctx.fillRect(0, 0, W, fy);
            ctx.strokeStyle = "rgba(150,120,80,0.35)"; ctx.lineWidth = unit * 0.003;
            for (let yy = H * 0.13; yy < fy; yy += unit * 0.1) { ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke(); }
            drawBunting(H * 0.06);
            drawKeepWindow(W * 0.58, H * 0.17, unit * 0.12, unit * 0.16, 0);

            // Wood floor + rug.
            const floor = ctx.createLinearGradient(0, fy, 0, H);
            floor.addColorStop(0, "#8a5e34"); floor.addColorStop(1, "#6e4a2a");
            ctx.fillStyle = floor; ctx.fillRect(0, fy, W, H - fy);
            ctx.strokeStyle = "rgba(110,74,42,0.5)"; ctx.lineWidth = unit * 0.003;
            for (let x = 0; x < W; x += unit * 0.1) { ctx.beginPath(); ctx.moveTo(x, fy); ctx.lineTo(x, H); ctx.stroke(); }
            drawRug(W * 0.46, fy + unit * 0.07);

            // Noisy window on the wall (rattling shutter).
            drawKeepWindow(W * 0.88 + spotJitter("window"), H * 0.11, unit * 0.11, unit * 0.18, 1);

            // Furniture.
            drawBookshelf(W * 0.30);
            drawArmorStand(W * 0.74);
            drawBed(owlBedX);
            drawKeepTable(W * 0.42);
            drawLanternStation();
            drawBarrels(W * 0.64);

            for (const s of spots) if (s.active) drawSpotNoise(s);
            drawBird(ox);
            for (const s of spots) if (s.active && Math.abs(ox - s.x) < unit * HUSH_FRAC) drawHushPrompt(s);

            drawHUDDay();

            if (night === 1 && dayT < 6) {
                ctx.fillStyle = "rgba(40,32,22,0.92)"; ctx.textAlign = "center";
                ctx.font = "600 " + Math.round(unit * 0.046) + "px Georgia, serif";
                ctx.fillText("Quiet watch — let the owl sleep", W / 2, H * 0.30);
                ctx.font = "500 " + Math.round(unit * 0.032) + "px Georgia, serif";
                ctx.fillText("Walk to a rattling item and tap it — only works up close", W / 2, H * 0.37);
                ctx.fillText("Tend the lantern on the table to ready tonight's beam", W / 2, H * 0.43);
            }
        }

        function drawRug(cx, y) {
            ctx.fillStyle = "#9a4a38"; ctx.beginPath(); ctx.ellipse(cx, y, unit * 0.24, unit * 0.045, 0, 0, 6.28); ctx.fill();
            ctx.fillStyle = "#c06a4f"; ctx.beginPath(); ctx.ellipse(cx, y, unit * 0.18, unit * 0.033, 0, 0, 6.28); ctx.fill();
            ctx.fillStyle = "#e0a24a"; ctx.beginPath(); ctx.ellipse(cx, y, unit * 0.08, unit * 0.015, 0, 0, 6.28); ctx.fill();
        }

        function drawKeepWindow(x, y, w, h, noisy) {
            ctx.fillStyle = "#8a6a48"; roundRectFill(x - w / 2 - unit * 0.012, y - unit * 0.012, w + unit * 0.024, h + unit * 0.024, unit * 0.008);
            const g = ctx.createLinearGradient(0, y, 0, y + h);
            g.addColorStop(0, "#9fcaf0"); g.addColorStop(1, "#d6e9f6");
            ctx.fillStyle = g; roundRectFill(x - w / 2, y, w, h, unit * 0.006);
            ctx.strokeStyle = "#7a5a3a"; ctx.lineWidth = unit * 0.005;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.moveTo(x - w / 2, y + h * 0.5); ctx.lineTo(x + w / 2, y + h * 0.5); ctx.stroke();
            if (noisy) { ctx.fillStyle = "#6e4a2a"; ctx.fillRect(x - w / 2 - unit * 0.02, y, unit * 0.018, h); }   // shutter
        }

        function drawBookshelf(x) {
            x += spotJitter("books");
            const fy = keepFloorY, w = unit * 0.14, h = unit * 0.34, rows = 4;
            ctx.fillStyle = "#6e4a2a"; roundRectFill(x - w / 2, fy - h, w, h, unit * 0.006);
            ctx.fillStyle = "#8a6238"; ctx.fillRect(x - w / 2 + unit * 0.006, fy - h + unit * 0.006, w - unit * 0.012, h - unit * 0.012);
            const bcols = ["#b5543f", "#4f7a8c", "#caa24a", "#6a7a4a", "#9a5a86"];
            for (let r = 0; r < rows; r++) {
                const rowH = (h - unit * 0.02) / rows, sy = fy - h + unit * 0.01 + r * rowH, sh = rowH;
                ctx.fillStyle = "#5e3f22"; ctx.fillRect(x - w / 2 + unit * 0.006, sy + sh - unit * 0.006, w - unit * 0.012, unit * 0.006);
                let bx = x - w / 2 + unit * 0.012;
                for (let b = 0; b < 5; b++) {
                    const bw = unit * 0.02, bh = sh * (0.65 + ((r + b) % 3) * 0.12);
                    ctx.fillStyle = bcols[(r * 2 + b) % 5];
                    ctx.fillRect(bx, sy + sh - unit * 0.006 - bh, bw, bh);
                    bx += bw + unit * 0.002;
                }
            }
        }

        function drawKeepTable(x) {
            const fy = keepFloorY, tTop = fy - unit * 0.1, w = unit * 0.28, jit = spotJitter("dishes");
            ctx.fillStyle = "#7a5230"; ctx.fillRect(x - w / 2, tTop - unit * 0.02, w, unit * 0.026);
            ctx.fillStyle = "#6e4a2a";
            ctx.fillRect(x - w / 2 + unit * 0.012, tTop, unit * 0.022, unit * 0.1);
            ctx.fillRect(x + w / 2 - unit * 0.034, tTop, unit * 0.022, unit * 0.1);
            // pancakes
            const px = x - w * 0.3;
            for (let i = 0; i < 3; i++) { ctx.fillStyle = "#e9b96a"; ctx.beginPath(); ctx.ellipse(px, tTop - unit * 0.026 - i * unit * 0.015, unit * 0.045, unit * 0.012, 0, 0, 6.28); ctx.fill(); }
            ctx.fillStyle = "#a85a2a"; ctx.beginPath(); ctx.ellipse(px, tTop - unit * 0.026 - 2 * unit * 0.015, unit * 0.045, unit * 0.012, 0, 0, 3.14); ctx.fill();
            ctx.fillStyle = "#ffe9a0"; ctx.fillRect(px - unit * 0.008, tTop - unit * 0.064, unit * 0.016, unit * 0.012);   // butter
            // a jar + a mug (the rattling dishes)
            ctx.fillStyle = "#5a4632"; ctx.fillRect(x - w * 0.02 + jit, tTop - unit * 0.052, unit * 0.034, unit * 0.052);
            ctx.fillStyle = "#7a6a4a"; roundRectFill(x + w * 0.1 + jit, tTop - unit * 0.046, unit * 0.03, unit * 0.046, unit * 0.005);
            ctx.strokeStyle = "#7a6a4a"; ctx.lineWidth = unit * 0.005;
            ctx.beginPath(); ctx.arc(x + w * 0.13 + jit + unit * 0.03, tTop - unit * 0.022, unit * 0.012, -1.3, 1.3); ctx.stroke();
        }

        function drawLanternStation() {
            const x = lanternStationX, ly = keepFloorY - unit * 0.13, ready = lanternReady / 100;
            const g = ctx.createRadialGradient(x, ly, 1, x, ly, unit * 0.07);
            g.addColorStop(0, "rgba(255,225,150," + (0.22 + ready * 0.66) + ")"); g.addColorStop(1, "rgba(255,206,120,0)");
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, ly, unit * 0.07, 0, 6.28); ctx.fill();
            ctx.fillStyle = "#4a3a26"; ctx.fillRect(x - unit * 0.024, ly - unit * 0.028, unit * 0.048, unit * 0.008);
            ctx.fillStyle = "#6e5a38"; roundRectFill(x - unit * 0.018, ly - unit * 0.02, unit * 0.036, unit * 0.05, unit * 0.006);
            ctx.fillStyle = ready > 0.05 ? "#ffe39a" : "#3a3322"; roundRectFill(x - unit * 0.012, ly - unit * 0.012, unit * 0.024, unit * 0.034, unit * 0.004);
        }

        function drawBarrels(x) {
            const fy = keepFloorY, jit = spotJitter("mouse"), ms = spotOf("mouse");
            // The mouse hides behind the barrels — only its sound (and a peek) shows.
            if (ms && ms.active) {
                ctx.fillStyle = "#7a6a66";
                ctx.beginPath(); ctx.ellipse(x + unit * 0.07 + jit, fy - unit * 0.015, unit * 0.02, unit * 0.012, 0, 0, 6.28); ctx.fill();
                ctx.strokeStyle = "#7a6a66"; ctx.lineWidth = unit * 0.004;
                ctx.beginPath(); ctx.moveTo(x + unit * 0.085 + jit, fy - unit * 0.015); ctx.quadraticCurveTo(x + unit * 0.12, fy - unit * 0.03, x + unit * 0.1, fy); ctx.stroke();
            }
            function barrel(bx, bw, bh) {
                ctx.fillStyle = "#8a5a32"; roundRectFill(bx - bw / 2, fy - bh, bw, bh, unit * 0.012);
                ctx.fillStyle = "#9a6a40"; ctx.fillRect(bx - bw / 2, fy - bh * 0.92, bw, bh * 0.84);
                ctx.strokeStyle = "#4a3018"; ctx.lineWidth = unit * 0.005;
                ctx.beginPath(); ctx.moveTo(bx - bw / 2, fy - bh * 0.72); ctx.lineTo(bx + bw / 2, fy - bh * 0.72);
                ctx.moveTo(bx - bw / 2, fy - bh * 0.32); ctx.lineTo(bx + bw / 2, fy - bh * 0.32); ctx.stroke();
            }
            barrel(x - unit * 0.04, unit * 0.075, unit * 0.12);
            barrel(x + unit * 0.04, unit * 0.07, unit * 0.105);
        }

        function drawArmorStand(x) {
            x += spotJitter("armor");
            const fy = keepFloorY;
            ctx.fillStyle = "#4a3a26"; ctx.fillRect(x - unit * 0.006, fy - unit * 0.16, unit * 0.012, unit * 0.16);
            ctx.beginPath(); ctx.moveTo(x - unit * 0.04, fy); ctx.lineTo(x + unit * 0.04, fy); ctx.lineTo(x, fy - unit * 0.02); ctx.fill();
            ctx.fillStyle = "#9aa1ad"; roundRectFill(x - unit * 0.05, fy - unit * 0.15, unit * 0.1, unit * 0.09, unit * 0.02);
            ctx.fillStyle = "#7e8694"; ctx.fillRect(x - unit * 0.012, fy - unit * 0.15, unit * 0.024, unit * 0.09);
            ctx.fillStyle = "#aab1bd"; ctx.beginPath(); ctx.arc(x, fy - unit * 0.165, unit * 0.034, Math.PI, 0); ctx.fill();
            ctx.fillRect(x - unit * 0.034, fy - unit * 0.165, unit * 0.068, unit * 0.018);
            ctx.fillStyle = "#878e9c"; ctx.fillRect(x - unit * 0.006, fy - unit * 0.18, unit * 0.012, unit * 0.026);
        }

        function drawBed(x) {
            const fy = keepFloorY, w = unit * 0.24, hb = unit * 0.16;
            ctx.fillStyle = "#6e4a2a"; roundRectFill(x - w * 0.5, fy - hb, unit * 0.028, hb, unit * 0.008);
            ctx.fillStyle = "#7a5230"; ctx.fillRect(x - w * 0.5, fy - unit * 0.05, w, unit * 0.05);
            ctx.fillStyle = "#efe6cf"; roundRectFill(x - w * 0.46, fy - unit * 0.075, w * 0.92, unit * 0.03, unit * 0.008);
            // patchwork quilt
            const qx = x - w * 0.16, qy = fy - unit * 0.07, qw = w * 0.6, qh = unit * 0.05;
            const cols = ["#9a5a86", "#5f7a8c", "#b5543f", "#6a7a4a"];
            for (let i = 0; i < 4; i++) { ctx.fillStyle = cols[i]; roundRectFill(qx + i * qw / 4, qy, qw / 4 - 1, qh, 2); }
            ctx.fillStyle = "#f4eeda"; roundRectFill(x - w * 0.46, fy - unit * 0.078, unit * 0.05, unit * 0.03, unit * 0.01);
            // sleeping owl head on the pillow
            const hx = x - w * 0.38, hy = fy - unit * 0.088, hr = unit * 0.034;
            ctx.fillStyle = "#8a6840"; ctx.beginPath(); ctx.arc(hx, hy, hr, 0, 6.28); ctx.fill();
            ctx.fillStyle = "#6a6aa8"; ctx.beginPath();
            ctx.moveTo(hx - hr * 0.9, hy - hr * 0.1);
            ctx.quadraticCurveTo(hx, hy - hr * 2, hx + hr * 1.4, hy - hr * 0.9);
            ctx.quadraticCurveTo(hx + hr * 0.2, hy - hr * 0.4, hx + hr * 0.9, hy - hr * 0.1);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = "#ececf8"; ctx.beginPath(); ctx.arc(hx + hr * 1.4, hy - hr * 0.9, hr * 0.26, 0, 6.28); ctx.fill();
            ctx.strokeStyle = "#3a2412"; ctx.lineWidth = unit * 0.004; ctx.lineCap = "round";
            ctx.beginPath(); ctx.moveTo(hx - hr * 0.35, hy + hr * 0.05); ctx.quadraticCurveTo(hx - hr * 0.18, hy + hr * 0.25, hx - hr * 0.02, hy + hr * 0.05); ctx.stroke();
            ctx.fillStyle = "#d98a34"; ctx.beginPath();
            ctx.moveTo(hx - hr * 0.12, hy + hr * 0.28); ctx.lineTo(hx + hr * 0.12, hy + hr * 0.28); ctx.lineTo(hx, hy + hr * 0.5); ctx.fill();
            const zt = (Date.now() % 2600) / 2600;
            ctx.fillStyle = "rgba(60,60,90," + (0.85 - zt * 0.7) + ")";
            ctx.font = "600 " + Math.round(unit * 0.03 * (1 + zt * 0.4)) + "px Georgia, serif"; ctx.textAlign = "left";
            ctx.fillText("z", hx + hr * 1.3, hy - hr * 1.9 - zt * unit * 0.03);
        }

        function drawSpotNoise(s) {
            const x = s.x, y = s.vy, ring = (s.shake % 6.28) / 6.28;
            ctx.strokeStyle = "rgba(255,90,70,0.6)"; ctx.lineWidth = unit * 0.005;
            for (let k = 0; k < 2; k++) {
                const r = unit * 0.025 + ((ring + k * 0.5) % 1) * unit * 0.05;
                ctx.beginPath(); ctx.arc(x, y, r, -1.1, 1.1); ctx.stroke();
                ctx.beginPath(); ctx.arc(x, y, r, Math.PI - 1.1, Math.PI + 1.1); ctx.stroke();
            }
            ctx.fillStyle = "#ff5a46"; ctx.font = "700 " + Math.round(unit * 0.038) + "px Georgia, serif"; ctx.textAlign = "center";
            ctx.fillText("!", x, y - unit * 0.03);
        }

        function drawHushPrompt(s) {
            const pulse = 0.45 + 0.4 * Math.sin(Date.now() / 240);
            ctx.strokeStyle = "rgba(130,235,130," + pulse + ")"; ctx.lineWidth = unit * 0.006;
            ctx.beginPath(); ctx.arc(s.x, s.vy, unit * 0.055, 0, 6.28); ctx.stroke();
            ctx.fillStyle = "rgba(130,235,130," + pulse + ")"; ctx.font = "600 " + Math.round(unit * 0.026) + "px Georgia, serif"; ctx.textAlign = "center";
            ctx.fillText("tap!", s.x, s.vy + unit * 0.085);
        }

        function drawBird(x) {
            const s = unit * 0.07, cy = keepFloorY - s * 0.7;
            ctx.save(); ctx.translate(x, cy); ctx.scale(facing, 1);
            ctx.fillStyle = "#7c5230"; ctx.beginPath(); ctx.ellipse(0, 0, s * 0.5, s * 0.6, 0, 0, 6.28); ctx.fill();
            ctx.fillStyle = "#db7f37"; ctx.beginPath(); ctx.ellipse(s * 0.12, s * 0.1, s * 0.32, s * 0.42, 0, 0, 6.28); ctx.fill();
            ctx.fillStyle = "#7c5230"; ctx.beginPath(); ctx.arc(s * 0.1, -s * 0.55, s * 0.36, 0, 6.28); ctx.fill();
            ctx.fillStyle = "#9aa0a8"; ctx.beginPath(); ctx.arc(s * 0.1, -s * 0.6, s * 0.37, Math.PI, 0); ctx.fill();
            ctx.fillRect(s * 0.04, -s * 1.05, s * 0.12, s * 0.14);
            ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(s * 0.22, -s * 0.55, s * 0.1, 0, 6.28); ctx.fill();
            ctx.fillStyle = "#20140a"; ctx.beginPath(); ctx.arc(s * 0.25, -s * 0.55, s * 0.05, 0, 6.28); ctx.fill();
            ctx.fillStyle = "#e09a33"; ctx.beginPath();
            ctx.moveTo(s * 0.4, -s * 0.5); ctx.lineTo(s * 0.62, -s * 0.45); ctx.lineTo(s * 0.4, -s * 0.38); ctx.fill();
            ctx.restore();
        }

        /* ---------- Overlap (tower hand-off) ---------- */
        function drawOverlap() {
            const floorY = H * 0.76;
            let g = ctx.createLinearGradient(0, 0, 0, floorY);
            g.addColorStop(0, "#e0bd8a"); g.addColorStop(1, "#cda572");
            ctx.fillStyle = g; ctx.fillRect(0, 0, W, floorY);
            ctx.fillStyle = "#8a5e34"; ctx.fillRect(0, floorY, W, H - floorY);
            ctx.strokeStyle = "rgba(110,74,42,0.6)"; ctx.lineWidth = unit * 0.004;
            for (let x = 0; x < W; x += unit * 0.12) { ctx.beginPath(); ctx.moveTo(x, floorY); ctx.lineTo(x, H); ctx.stroke(); }

            // window showing the time of day outside
            const wx = W * 0.5, wy = H * 0.13, ww = unit * 0.17, wh = unit * 0.2;
            ctx.fillStyle = "#b8966a"; roundRectFill(wx - ww / 2 - unit * 0.012, wy - unit * 0.012, ww + unit * 0.024, wh + unit * 0.024, unit * 0.01);
            if (overlapKind === "dawn") { g = ctx.createLinearGradient(0, wy, 0, wy + wh); g.addColorStop(0, "#f6c87a"); g.addColorStop(1, "#f0a0a8"); }
            else { g = ctx.createLinearGradient(0, wy, 0, wy + wh); g.addColorStop(0, "#5b5a8c"); g.addColorStop(1, "#e89a5c"); }
            ctx.fillStyle = g; roundRectFill(wx - ww / 2, wy, ww, wh, unit * 0.008);
            ctx.fillStyle = overlapKind === "dawn" ? "#fff0c0" : "#eef0ff";
            ctx.beginPath(); ctx.arc(wx, wy + wh * 0.42, unit * 0.028, 0, 6.28); ctx.fill();

            drawBunting(H * 0.07);

            // breakfast table
            const tx = W * 0.5, tTop = floorY - unit * 0.02;
            ctx.fillStyle = "#7a5230"; ctx.fillRect(tx - unit * 0.16, tTop - unit * 0.022, unit * 0.32, unit * 0.03);
            ctx.fillRect(tx - unit * 0.14, tTop, unit * 0.025, unit * 0.08);
            ctx.fillRect(tx + unit * 0.115, tTop, unit * 0.025, unit * 0.08);
            for (let i = 0; i < 3; i++) { ctx.fillStyle = "#e9b96a"; ctx.beginPath(); ctx.ellipse(tx - unit * 0.06, tTop - unit * 0.035 - i * unit * 0.017, unit * 0.05, unit * 0.013, 0, 0, 6.28); ctx.fill(); }
            ctx.fillStyle = "#a85a2a"; ctx.beginPath(); ctx.ellipse(tx - unit * 0.06, tTop - unit * 0.035 - 2 * unit * 0.017, unit * 0.05, unit * 0.013, 0, 0, 3.14); ctx.fill();
            ctx.fillStyle = "#5a4632"; ctx.fillRect(tx + unit * 0.05, tTop - unit * 0.052, unit * 0.042, unit * 0.046);
            ctx.fillStyle = "#e6dcc0"; ctx.fillRect(tx + unit * 0.005, tTop - unit * 0.064, unit * 0.012, unit * 0.044);
            ctx.fillStyle = "#ffce6a"; ctx.beginPath(); ctx.arc(tx + unit * 0.011, tTop - unit * 0.07, unit * 0.01, 0, 6.28); ctx.fill();

            drawCozyOwl(W * 0.28, floorY - unit * 0.01);
            drawCozyBird(W * 0.72, floorY - unit * 0.01);

            ctx.textAlign = "center";
            ctx.fillStyle = "rgba(50,40,28,0.95)";
            ctx.font = "600 " + Math.round(unit * 0.055) + "px Georgia, serif";
            ctx.fillText(overlapKind === "dawn" ? "Breakfast!" : "Changing of the watch", W / 2, H * 0.34);
            ctx.font = "500 " + Math.round(unit * 0.034) + "px Georgia, serif";
            ctx.fillStyle = "rgba(60,48,32,0.9)";
            ctx.fillText(overlapKind === "dawn"
                ? "The night is won — a heart restored over breakfast."
                : "The Bird turns in; the Owl takes the wall.", W / 2, H * 0.41);

            const pulse = 0.55 + 0.35 * Math.sin(Date.now() / 320);
            ctx.fillStyle = "rgba(50,40,28," + pulse + ")";
            ctx.font = "600 " + Math.round(unit * 0.04) + "px Georgia, serif";
            ctx.fillText("tap to take the " + (overlapKind === "dawn" ? "day" : "night") + " watch", W / 2, H * 0.88);
        }

        function drawBunting(y) {
            ctx.strokeStyle = "#9a7a48"; ctx.lineWidth = unit * 0.004;
            ctx.beginPath(); ctx.moveTo(W * 0.1, y); ctx.quadraticCurveTo(W * 0.5, y + unit * 0.03, W * 0.9, y); ctx.stroke();
            const cols = ["#e0a24a", "#7488ae", "#c47a84"];
            for (let i = 0; i < 7; i++) {
                const x = W * (0.14 + i * 0.12), yy = y + Math.sin(i / 6 * Math.PI) * unit * 0.022;
                ctx.fillStyle = cols[i % 3];
                ctx.beginPath(); ctx.moveTo(x - unit * 0.018, yy); ctx.lineTo(x + unit * 0.018, yy); ctx.lineTo(x, yy + unit * 0.03); ctx.fill();
            }
        }

        function drawCozyOwl(x, baseY) {
            const h = unit * 0.16, bodyH = h * 0.7, bodyCy = baseY - bodyH * 0.5, headR = h * 0.38, headCy = bodyCy - bodyH * 0.5;
            ctx.fillStyle = "#8a92a0"; ctx.beginPath(); ctx.ellipse(x, bodyCy, h * 0.46, bodyH * 0.6, 0, 0, 6.28); ctx.fill();
            ctx.fillStyle = "#8a6840"; ctx.beginPath(); ctx.arc(x, headCy, headR, 0, 6.28); ctx.fill();
            ctx.fillStyle = "#6a6aa8"; ctx.beginPath();
            ctx.moveTo(x - headR * 0.95, headCy - headR * 0.1);
            ctx.quadraticCurveTo(x - headR * 0.2, headCy - headR * 1.7, x + headR * 1.2, headCy - headR * 1.2);
            ctx.quadraticCurveTo(x + headR * 0.2, headCy - headR * 0.55, x + headR * 0.95, headCy - headR * 0.1);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = "#ececf8"; ctx.beginPath(); ctx.arc(x + headR * 1.2, headCy - headR * 1.2, headR * 0.2, 0, 6.28); ctx.fill();
            ctx.fillStyle = "#dcc99e"; ctx.beginPath(); ctx.ellipse(x, headCy + headR * 0.15, headR * 0.7, headR * 0.6, 0, 0, 6.28); ctx.fill();
            for (const sd of [-1, 1]) {
                ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x + sd * headR * 0.3, headCy + headR * 0.1, headR * 0.22, 0, 6.28); ctx.fill();
                ctx.fillStyle = "#20140a"; ctx.beginPath(); ctx.arc(x + sd * headR * 0.3, headCy + headR * 0.1, headR * 0.1, 0, 6.28); ctx.fill();
            }
            ctx.fillStyle = "#d98a34"; ctx.beginPath();
            ctx.moveTo(x - headR * 0.1, headCy + headR * 0.35); ctx.lineTo(x + headR * 0.1, headCy + headR * 0.35); ctx.lineTo(x, headCy + headR * 0.55); ctx.fill();
            ctx.fillStyle = "#5a4632"; ctx.fillRect(x + h * 0.34, bodyCy - h * 0.02, h * 0.14, h * 0.17);
        }

        function drawCozyBird(x, baseY) {
            const s = unit * 0.11, cy = baseY - s * 0.55;
            ctx.fillStyle = "#7c5230"; ctx.beginPath(); ctx.ellipse(x, cy, s * 0.42, s * 0.5, 0, 0, 6.28); ctx.fill();
            ctx.fillStyle = "#db7f37"; ctx.beginPath(); ctx.ellipse(x, cy + s * 0.08, s * 0.28, s * 0.36, 0, 0, 6.28); ctx.fill();
            ctx.fillStyle = "#7c5230"; ctx.beginPath(); ctx.arc(x, cy - s * 0.5, s * 0.32, 0, 6.28); ctx.fill();
            ctx.fillStyle = "#5a7a44"; ctx.beginPath(); ctx.arc(x, cy - s * 0.55, s * 0.34, Math.PI, 0); ctx.fill();
            ctx.beginPath(); ctx.moveTo(x + s * 0.2, cy - s * 0.8); ctx.quadraticCurveTo(x + s * 0.5, cy - s * 0.7, x + s * 0.4, cy - s * 0.5); ctx.fill();
            ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x + s * 0.12, cy - s * 0.5, s * 0.08, 0, 6.28); ctx.fill();
            ctx.fillStyle = "#20140a"; ctx.beginPath(); ctx.arc(x + s * 0.14, cy - s * 0.5, s * 0.04, 0, 6.28); ctx.fill();
            ctx.fillStyle = "#e09a33"; ctx.beginPath();
            ctx.moveTo(x + s * 0.3, cy - s * 0.46); ctx.lineTo(x + s * 0.5, cy - s * 0.42); ctx.lineTo(x + s * 0.3, cy - s * 0.36); ctx.fill();
        }

        function drawRotateHint() {
            ctx.fillStyle = "#13153a"; ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = "#f2f3ff"; ctx.textAlign = "center";
            ctx.font = "600 " + Math.round(Math.min(W, H) * 0.07) + "px Georgia, serif";
            ctx.fillText("\u{1F504}", W / 2, H / 2 - Math.min(W, H) * 0.06);
            ctx.font = "500 " + Math.round(Math.min(W, H) * 0.05) + "px Georgia, serif";
            ctx.fillText("Rotate to landscape", W / 2, H / 2 + Math.min(W, H) * 0.04);
        }

        /* ---------- Orientation ---------- */
        function lockLandscape() {
            try {
                if (screen.orientation && screen.orientation.lock) {
                    screen.orientation.lock("landscape").catch(function () { /* unsupported (iOS) — overlay handles it */ });
                }
            } catch (e) { /* ignore */ }
        }
        function unlockOrientation() {
            try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) { /* ignore */ }
        }
        function isPortrait() { return canvas.clientHeight > canvas.clientWidth * 1.05; }

        /* ---------- Loop ---------- */
        function loop(ts) {
            rafId = requestAnimationFrame(loop);
            if (isPortrait()) { resize(); paused = true; lastTs = ts; drawRotateHint(); return; }
            if (paused) { paused = false; resize(); }
            const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
            lastTs = ts;
            if (alive) update(dt);
            draw();
        }

        /* ---------- Input ---------- */
        function localPoint(clientX, clientY) {
            const r = canvas.getBoundingClientRect();
            return { x: clientX - r.left, y: clientY - r.top };
        }
        function onDown(x, y) {
            if (!alive) return;
            if (phase === "overlap") { continueOverlap(); return; }
            if (phase === "day") { onDownDay(x, y); return; }
            // Night: light + aim the beam.
            pointerDown = true; started = true; aimBeam(x);
        }
        function onDownDay(x) {
            // Hush a rattling item only if the bird is standing close to it.
            for (const s of spots) {
                if (s.active && Math.abs(x - s.x) < unit * 0.1 && Math.abs(ox - s.x) < unit * HUSH_FRAC) { hush(s); return; }
            }
            // Tend the lantern when up close.
            if (Math.abs(x - lanternStationX) < unit * 0.1 && Math.abs(ox - lanternStationX) < unit * HUSH_FRAC) { tendLantern(); return; }
            // Otherwise, walk toward the tap.
            dragging = true; targetX = clampX(x);
        }
        function onMove(x) {
            if (phase === "night") { if (pointerDown) aimBeam(x); return; }
            if (dragging) targetX = clampX(x);
        }
        function onUp() { dragging = false; pointerDown = false; }

        // A touch fires touchstart AND a synthesized mousedown ~300ms later; without
        // this guard the second one re-toggles the lantern/torch, cancelling the first.
        let lastTouch = 0;
        function onTouchStart(e) { lastTouch = Date.now(); const t = e.changedTouches[0]; const p = localPoint(t.clientX, t.clientY); onDown(p.x, p.y); }
        function onTouchMove(e) { e.preventDefault(); lastTouch = Date.now(); const t = e.changedTouches[0]; const p = localPoint(t.clientX, t.clientY); onMove(p.x); }
        function onTouchEnd() { lastTouch = Date.now(); onUp(); }
        function onMouseDown(e) { if (Date.now() - lastTouch < 700) return; const p = localPoint(e.clientX, e.clientY); onDown(p.x, p.y); }
        function onMouseMove(e) { if (Date.now() - lastTouch < 700) return; const p = localPoint(e.clientX, e.clientY); onMove(p.x); }
        function onMouseUp(e) { if (Date.now() - lastTouch < 700) return; onUp(); }
        function onKey(e) {
            if (e.key === "ArrowLeft" || e.key === "a") { keys.left = true; started = true; e.preventDefault(); }
            else if (e.key === "ArrowRight" || e.key === "d") { keys.right = true; started = true; e.preventDefault(); }
            else if (e.key === " " || e.key === "ArrowUp" || e.key === "Enter") {
                if (phase === "overlap") continueOverlap();
                e.preventDefault();
            }
        }
        function onKeyUp(e) {
            if (e.key === "ArrowLeft" || e.key === "a") keys.left = false;
            else if (e.key === "ArrowRight" || e.key === "d") keys.right = false;
        }

        return {
            start() {
                lockLandscape();
                resize();
                reset();
                window.addEventListener("resize", resize);
                canvas.addEventListener("touchstart", onTouchStart, { passive: true });
                canvas.addEventListener("touchmove", onTouchMove, { passive: false });
                canvas.addEventListener("touchend", onTouchEnd, { passive: true });
                canvas.addEventListener("mousedown", onMouseDown);
                window.addEventListener("mousemove", onMouseMove);
                window.addEventListener("mouseup", onMouseUp);
                window.addEventListener("keydown", onKey);
                window.addEventListener("keyup", onKeyUp);
                rafId = requestAnimationFrame(loop);
            },
            restart() { reset(); },
            destroy() {
                cancelAnimationFrame(rafId);
                unlockOrientation();
                window.removeEventListener("resize", resize);
                canvas.removeEventListener("touchstart", onTouchStart);
                canvas.removeEventListener("touchmove", onTouchMove);
                canvas.removeEventListener("touchend", onTouchEnd);
                canvas.removeEventListener("mousedown", onMouseDown);
                window.removeEventListener("mousemove", onMouseMove);
                window.removeEventListener("mouseup", onMouseUp);
                window.removeEventListener("keydown", onKey);
                window.removeEventListener("keyup", onKeyUp);
            }
        };
    }

    window.SGGames = window.SGGames || {};
    window.SGGames.watchswap = {
        id: "watchswap",
        name: "Watch Swap",
        emoji: "\u{1F989}",
        tag: "Guard the wall. Shine the lantern, shoo the wolves.",
        scoreLabel: "points",
        create: create
    };
})();
