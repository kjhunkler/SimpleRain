/* ============ Letter Siege — spot the letter, defend the city from the robot ============ */
(function () {
    "use strict";

    const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

    // Kid-friendly words for the Command Center "starts with" puzzle.
    const WORDS = [
        { w: "APPLE", e: "\u{1F34E}" }, { w: "BALL", e: "\u26BD" }, { w: "CAT", e: "\u{1F431}" },
        { w: "DOG", e: "\u{1F436}" }, { w: "EGG", e: "\u{1F95A}" }, { w: "FISH", e: "\u{1F41F}" },
        { w: "GOAT", e: "\u{1F410}" }, { w: "HAT", e: "\u{1F3A9}" }, { w: "ICE", e: "\u{1F9CA}" },
        { w: "JUICE", e: "\u{1F9C3}" }, { w: "KITE", e: "\u{1FA81}" }, { w: "LION", e: "\u{1F981}" },
        { w: "MOON", e: "\u{1F319}" }, { w: "NEST", e: "\u{1FAB9}" }, { w: "ORANGE", e: "\u{1F34A}" },
        { w: "PIG", e: "\u{1F437}" }, { w: "QUEEN", e: "\u{1F451}" }, { w: "RAIN", e: "\u{1F327}" },
        { w: "SUN", e: "\u2600\uFE0F" }, { w: "TREE", e: "\u{1F333}" }, { w: "UMBRELLA", e: "\u2602\uFE0F" },
        { w: "VAN", e: "\u{1F690}" }, { w: "WHALE", e: "\u{1F433}" }, { w: "YARN", e: "\u{1F9F6}" },
        { w: "ZEBRA", e: "\u{1F993}" }
    ];

    // Commander cheers when a special cross-case attack is diverted.
    const COMMENDS = [
        "Great job!", "You're doing it!", "Awesome work!",
        "Way to go!", "Fantastic!", "You're a hero!", "Keep it up!"
    ];

    // Celebration firework colors.
    const FWCOL = ["#ff5d6c", "#ffd166", "#39d0ff", "#9b5de5", "#39d98a", "#ff8a3c"];

    // Friendly names + warning callouts for the next approaching monster.
    const MONSTER_NAME = { slime: "slime monster", robot: "giant robot" };
    const THREATS = [
        "Incoming! A {m} approaches!",
        "Warning! A {m} is coming!",
        "Look out! A {m} is on the way!",
        "Heads up! A {m} is almost here!",
        "Danger! A {m} approaches the city!",
        "Get ready! A {m} is closing in!"
    ];

    function create(host) {
        const canvas = host.canvas;
        const ctx = canvas.getContext("2d");

        const kids = !!host.kids;
        const MAX_LIVES = kids ? 5 : 3;

        let W, H, groundY, s, rcx, rcy;
        let mode;                 // "intro" | "siege" | "command" | "over" | "interlude"
        let phase;                // within siege: "answer" | "win" | "lose"
        let phaseT;               // resolve-animation timer
        let lives, score, combo;
        let target, choices, targetCase, choiceCase, targetIdx, lastTapped, answeredRight;
        let special, lastWasSpecial;        // cross-case "special attack" round
        let commanderText, commanderT;      // commander encouragement banner
        let roundTime, timer, charge, warned;
        let ccCooldown;           // successful defends needed before re-using command center
        let lastChance;           // true while the final-heart rescue puzzle is active
        let puzzle;
        let rafId, lastTs;
        let speechPrimed = false;  // mobile speech unlock (set once, on first tap)
        let speechVoice = null;
        let lastSpeechText = "";
        let waitingForSpeech = false;

        // World pieces
        let buildings;
        let rain, embers, smoke, bolts;
        let lightTimer, flash, ambient;
        let shakeT, shakeMag;
        let robotLunge, hitFlash, healFlash;
        let beam;                 // active attack/defense beam
        let forcefield;           // protective dome that deflects a boss attack
        let sway;

        // Boss progression (robot ↔ slime), defeat sequence, and FX pools
        let bossType, bossLevel, bossHP, bossMaxHP, bossDefeated, bossDrop;
        let interlude;            // defeat → reward → warning → next-boss sequence
        let crumble, sparks;

        // Cached tap layouts (kept in sync by the matching draw routines)
        let siegeRects = [], ccBtn = null, puzzleRects = [];

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = canvas.clientWidth;
            H = canvas.clientHeight;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            groundY = H * 0.70;
            s = Math.min(H / 480, W / 420);
            rcx = W / 2;
            rcy = H * 0.33;
            makeCity();
            makeRain();
        }

        function rint(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
        function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

        function makeCity() {
            buildings = [];
            let x = -10;
            while (x < W + 10) {
                const bw = rint(38, 84);
                const bh = rint(Math.floor(H * 0.12), Math.floor(H * 0.34));
                const shade = rint(20, 40);
                const cols = Math.max(2, Math.floor(bw / 16));
                const rows = Math.max(3, Math.floor(bh / 22));
                const lit = [];
                for (let i = 0; i < cols * rows; i++) lit.push(Math.random() < 0.55);
                buildings.push({
                    x: x, w: bw, h: bh, baseH: bh,
                    color: "rgb(" + (shade + 8) + "," + (shade + 12) + "," + (shade + 28) + ")",
                    cols: cols, rows: rows, lit: lit,
                    antenna: Math.random() < 0.4, damage: 0
                });
                x += bw + rint(2, 10);
            }
        }

        function makeRain() {
            rain = [];
            const n = Math.floor((W * H) / 9000);
            for (let i = 0; i < n; i++) {
                rain.push({
                    x: Math.random() * (W + 80) - 40,
                    y: Math.random() * H,
                    len: 10 + Math.random() * 16,
                    sp: 480 + Math.random() * 360
                });
            }
        }

        function reset() {
            mode = "intro";
            phase = "answer";
            phaseT = 0;
            lives = MAX_LIVES;
            score = 0;
            combo = 0;
            ccCooldown = 0;
            lastChance = false;
            target = "A"; choices = []; targetCase = "upper"; choiceCase = "upper";
            special = false; lastWasSpecial = false;
            commanderText = ""; commanderT = 0;
            targetIdx = -1; lastTapped = -1; answeredRight = false;
            roundTime = 6; timer = 6; charge = 0; warned = false;
            puzzle = null;
            waitingForSpeech = false;
            embers = []; smoke = []; bolts = [];
            lightTimer = 2 + Math.random() * 3;
            flash = 0; ambient = 0;
            shakeT = 0; shakeMag = 0;
            robotLunge = 0; hitFlash = 0; healFlash = 0;
            beam = null; forcefield = null; sway = 0;
            setupBoss("robot", 0);
            bossDrop = 0;
            interlude = null;
            crumble = []; sparks = [];
            lastTs = 0;
            if (W) { makeCity(); makeRain(); }
            host.setScore(0);
        }

        /* ---------- round flow ---------- */
        function roundTimeForScore() {
            return kids
                ? 8
                : Math.max(3.2, 6 - score * 0.12);
        }

        function choiceCount() {
            return kids
                ? Math.min(3 + Math.floor(score / 10), 5)
                : Math.min(4 + Math.floor(score / 6), 7);
        }

        function newRound() {
            mode = "siege";
            phase = "answer";
            phaseT = 0;
            target = pick(ALPHA);
            const n = choiceCount();
            const set = [target];
            while (set.length < n) {
                const c = pick(ALPHA);
                if (set.indexOf(c) < 0) set.push(c);
            }
            // shuffle
            for (let i = set.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const t = set[i]; set[i] = set[j]; set[j] = t;
            }
            choices = set;
            targetIdx = set.indexOf(target);
            lastTapped = -1;
            answeredRight = false;

            // Occasionally the robot charges a special cross-case attack: the
            // called letter is shown in one case and the choices in the other.
            special = !lastWasSpecial && score >= (kids ? 3 : 2) && Math.random() < 0.2;
            lastWasSpecial = special;
            if (special) {
                if (Math.random() < 0.5) { targetCase = "upper"; choiceCase = "lower"; }
                else { targetCase = "lower"; choiceCase = "upper"; }
            } else {
                targetCase = choiceCase = kids ? "upper" : (Math.random() < 0.5 ? "upper" : "lower");
            }

            // Special attacks grant extra thinking time and a longer wind-up.
            roundTime = special && kids ? 15 : roundTimeForScore() + (special ? 4 : 0);
            timer = roundTime;
            charge = 0;
            warned = false;
            beam = null;
            forcefield = null;
            if (special) SGSound.play("bosszap");   // electric wind-up cue
            announceTarget();
        }

        function dispCase(ch, mode) { return mode === "lower" ? ch.toLowerCase() : ch.toUpperCase(); }

        function refreshSpeechVoice() {
            try {
                if (!("speechSynthesis" in window)) return;
                const voices = window.speechSynthesis.getVoices();
                speechVoice = voices.find(v => /^en(-|_)/i.test(v.lang)) || voices[0] || null;
            } catch (e) { /* speech is a nice-to-have; never break the game */ }
        }

        function speak(text) {
            try {
                if (!SGSound.isEnabled() || !("speechSynthesis" in window)) return;
                lastSpeechText = text;
                // Cancelling before the very first utterance can void the mobile
                // speech unlock, so only interrupt once speech is already primed.
                if (speechPrimed) window.speechSynthesis.cancel();
                speechPrimed = true;
                if (!speechVoice) refreshSpeechVoice();
                if (window.speechSynthesis.paused) window.speechSynthesis.resume();
                const u = new SpeechSynthesisUtterance(text);
                if (speechVoice) u.voice = speechVoice;
                u.rate = 0.9; u.pitch = 1.05; u.volume = 1;
                window.speechSynthesis.speak(u);
            } catch (e) { /* speech is a nice-to-have; never break the game */ }
        }

        // Mobile browsers only allow speech that begins inside a user gesture.
        // Load voices on the first tap, then let the real prompt speak in that same gesture.
        function primeSpeech() {
            if (speechPrimed) return;
            refreshSpeechVoice();
            try {
                if (("speechSynthesis" in window) && window.speechSynthesis.paused) {
                    window.speechSynthesis.resume();
                }
            } catch (e) { /* speech is a nice-to-have; never break the game */ }
        }

        // iPhone Safari may reject speech on touchstart but allow it on touchend.
        // Retry the most recent real prompt from that second user gesture.
        function retrySpeechFromGesture() {
            try {
                if (!lastSpeechText || !SGSound.isEnabled() || !("speechSynthesis" in window)) return;
                refreshSpeechVoice();
                if (window.speechSynthesis.paused) window.speechSynthesis.resume();
                if (!window.speechSynthesis.speaking) speak(lastSpeechText);
            } catch (e) { /* speech is a nice-to-have; never break the game */ }
        }

        function afterSpeech(cb, delay) {
            const wait = delay === undefined ? 1.5 : delay;
            let tries = 0;
            function done() { setTimeout(cb, wait * 1000); }
            try {
                if (!SGSound.isEnabled() || !("speechSynthesis" in window)) { done(); return; }
                if (window.speechSynthesis.paused) window.speechSynthesis.resume();
                function check() {
                    if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) { done(); return; }
                    tries += 1;
                    if (tries > 120) { done(); return; }
                    setTimeout(check, 100);
                }
                check();
            } catch (e) { done(); }
        }

        function speakThen(text, cb, delay) {
            let called = false;
            function finish() {
                if (called) return;
                called = true;
                setTimeout(cb, (delay === undefined ? 1.5 : delay) * 1000);
            }
            try {
                if (!SGSound.isEnabled() || !("speechSynthesis" in window)) { finish(); return; }
                lastSpeechText = text;
                if (speechPrimed) window.speechSynthesis.cancel();
                speechPrimed = true;
                if (!speechVoice) refreshSpeechVoice();
                if (window.speechSynthesis.paused) window.speechSynthesis.resume();
                const u = new SpeechSynthesisUtterance(text);
                if (speechVoice) u.voice = speechVoice;
                u.rate = 0.9; u.pitch = 1.05; u.volume = 1;
                u.onend = finish;
                u.onerror = finish;
                window.speechSynthesis.speak(u);
                setTimeout(finish, 1600 + text.length * 110);
            } catch (e) { finish(); }
        }

        // Read the called-out letter aloud; on a special round, name the case to find.
        function announceTarget() {
            if (special) {
                const want = choiceCase === "lower" ? "lower-case" : "upper-case";
                speak("Find the " + want + " " + target.toLowerCase());
            } else {
                speak("the letter " + target.toLowerCase());
            }
        }

        // The commander cheers the player on over the loudspeaker.
        function commander(text) {
            commanderText = text;
            commanderT = 2;
            speak(text);
        }

        function onCorrect(idx) {
            lastTapped = idx;
            answeredRight = true;
            phase = "win";
            phaseT = special ? 1.1 : 0.85;
            score += 1;
            combo += 1;
            if (combo > 1 && combo % 5 === 0) score += 1; // streak bonus
            host.setScore(score);
            damageBoss();
            if (ccCooldown > 0) ccCooldown -= 1;
            hitFlash = 1;
            robotLunge = -1;
            shake(0.32, 9);
            beam = { kind: "player", t: 0, x: W / 2 };
            // A protective dome snaps up over the city, deflecting the attack.
            forcefield = { t: 0, dur: special ? 1.1 : 0.85, special: special };
            host.vibrate(12);
            SGSound.play("bosslaser");
            SGSound.play(combo > 1 && combo % 5 === 0 ? "perfect" : "score");
            // Diverting the special electric attack earns a commander cheer.
            if (special) commander(pick(COMMENDS));
            waitingForSpeech = true;
            afterSpeech(() => { phaseT = 0; waitingForSpeech = false; }, 1.5);
        }

        function robotAttacks(tappedIdx) {
            lastTapped = (tappedIdx === undefined) ? -1 : tappedIdx;
            answeredRight = false;
            phase = "lose";
            phaseT = 1.05;
            combo = 0;
            lives -= 1;
            robotLunge = 1;
            shake(special ? 0.6 : 0.5, special ? 24 : 20);
            // Smash the building nearest the city centre-ish (random for variety).
            const b = damageNearestBuilding(W / 2 + (Math.random() * W * 0.5 - W * 0.25));
            beam = { kind: "robot", special: special, t: 0, x: b ? b.x + b.w / 2 : W / 2 };
            host.vibrate([60, 40, 90]);
            SGSound.play("wrong");
            SGSound.play(special ? "bosszap" : "bossslam");
            waitingForSpeech = true;
            afterSpeech(() => { phaseT = 0; waitingForSpeech = false; }, 1.5);
        }

        function damageNearestBuilding(px) {
            let best = null, bd = Infinity;
            for (const b of buildings) {
                const cx = b.x + b.w / 2;
                const d = Math.abs(cx - px);
                if (d < bd) { bd = d; best = b; }
            }
            if (best) {
                best.repairing = false;   // a fresh hit interrupts any patch-up
                best.damage = Math.min(1, best.damage + 0.5);
                best.h = Math.max(best.baseH * 0.45, best.h - best.baseH * 0.22);
                for (let i = 0; i < 14; i++) spawnSmoke(best.x + Math.random() * best.w, groundY - best.h + Math.random() * 20, true);
                for (let i = 0; i < 18; i++) spawnEmber(best.x + Math.random() * best.w, groundY - best.h);
            }
            return best;
        }

        function resolveWin() { if (bossDefeated) startInterlude(); else newRound(); }

        function resolveLose() {
            if (lives <= 0) {
                // Final-heart rescue: if the command center is charged, give the
                // player one chance to win a heart back before the game ends.
                if (ccCooldown <= 0) {
                    lastChance = true;
                    openCommand();
                    return;
                }
                mode = "over";
                SGSound.play("gameover");
                setTimeout(() => host.gameOver(score), 700);
            } else {
                newRound();
            }
        }

        /* ---------- boss progression ---------- */
        function setupBoss(type, level) {
            bossType = type;
            bossLevel = level;
            bossMaxHP = (kids ? 4 : 5) + level * 2;
            bossHP = bossMaxHP;
            bossDefeated = false;
        }

        // Each correct answer chips away at the current boss's health bar.
        function damageBoss() {
            if (bossDefeated) return;
            bossHP = Math.max(0, bossHP - 1);
            if (bossHP <= 0) bossDefeated = true;
        }

        function cityIntact() {
            for (const b of buildings) { if (b.damage > 0) return false; }
            return true;
        }

        // Begin patching up to `count` damaged buildings (worst-hit first),
        // animating only those specific buildings.
        function repairBuildings(count) {
            const damaged = buildings
                .filter(b => b.damage > 0 && !b.repairing)
                .sort((a, b) => b.damage - a.damage);
            const n = Math.min(count, damaged.length);
            for (let i = 0; i < n; i++) beginRepair(damaged[i]);
            return n;
        }

        // Stand a repair crew on one building and start its rebuild timer.
        function beginRepair(b) {
            b.repairing = true;
            b.repairFrom = b.h;
            b.repairTo = b.baseH;
            b.repairT = 0;
            b.repairDur = 1.8;
            b.worker = (Math.random() * 0.6 + 0.2);   // worker offset across the face
            b.solderT = Math.random();
        }

        function startInterlude() {
            const intact = cityIntact();
            mode = "interlude";
            lives = MAX_LIVES;          // defeating a boss fully restores hearts
            healFlash = 1;
            charge = 0; warned = false; beam = null; forcefield = null;
            interlude = {
                stage: "crumble",
                t: 0,
                reward: intact ? "fireworks" : "repair",
                next: bossType === "robot" ? "slime" : "robot"
            };
            // Break the boss apart into tumbling debris.
            spawnCrumble();
            shake(0.7, 22);
            host.vibrate([30, 40, 60]);
            SGSound.play("explode");
            commander(intact ? "We did it! The city is safe!" : "Got it! Patch up those buildings!");
        }

        function spawnCrumble() {
            crumble = [];
            const n = 26;
            for (let i = 0; i < n; i++) {
                crumble.push({
                    x: rcx + (Math.random() - 0.5) * 150 * s,
                    y: rcy + (Math.random() - 0.5) * 150 * s,
                    vx: (Math.random() - 0.5) * 160 * s,
                    vy: -60 * s - Math.random() * 120 * s,
                    rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 8,
                    sz: (6 + Math.random() * 14) * s,
                    slime: bossType === "slime"
                });
            }
        }

        function spawnFirework() {
            const fx = W * (0.2 + Math.random() * 0.6);
            const fy = groundY - (60 + Math.random() * 160) * s;
            const col = pick(FWCOL);
            const n = 24;
            for (let i = 0; i < n; i++) {
                const a = (i / n) * Math.PI * 2;
                const sp = (60 + Math.random() * 70) * s;
                sparks.push({
                    x: fx, y: fy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                    life: 1, col: col
                });
            }
            SGSound.play("highscore");
        }

        // Stand a crew on every damaged building (boss-defeat rebuild).
        function startRepairs() {
            for (const b of buildings) {
                if (b.damage > 0 && !b.repairing) beginRepair(b);
            }
        }

        // Advance welding/firework sparks and any in-progress building repairs.
        // Runs every frame in all modes so Command Center patch-ups animate too.
        function tickRepairs(dt) {
            for (let i = sparks.length - 1; i >= 0; i--) {
                const sp = sparks[i];
                sp.x += sp.vx * dt; sp.y += sp.vy * dt;
                sp.vy += (sp.weld ? 180 : 70) * s * dt;
                sp.life -= dt * (sp.weld ? 1.6 : 0.7);
                if (sp.life <= 0) sparks.splice(i, 1);
            }
            for (const b of buildings) {
                if (!b.repairing) continue;
                b.repairT += dt;
                const p = Math.min(1, b.repairT / b.repairDur);
                b.h = b.repairFrom + (b.repairTo - b.repairFrom) * p;
                b.solderT += dt * 6;
                if (Math.random() < dt * 8) {
                    spawnSpark(b.x + b.w * b.worker, groundY - b.h, "#ffd166");
                }
                if (p >= 1) {
                    b.h = b.baseH;
                    b.damage = 0;
                    b.repairing = false;
                }
            }
        }

        function spawnSpark(x, y, col) {
            sparks.push({
                x: x, y: y,
                vx: (Math.random() - 0.5) * 60, vy: -20 - Math.random() * 50,
                life: 0.6, col: col || "#ffd166", weld: true
            });
        }

        function updateInterlude(dt) {
            const it = interlude;
            it.t += dt;

            // Tumbling boss debris falls under gravity.
            for (let i = crumble.length - 1; i >= 0; i--) {
                const c = crumble[i];
                c.x += c.vx * dt; c.y += c.vy * dt;
                c.vy += 320 * s * dt; c.rot += c.vr * dt;
                if (c.y > groundY + 30 * s) crumble.splice(i, 1);
            }

            if (it.stage === "crumble") {
                if (it.t > 1.4) {
                    it.stage = "reward"; it.t = 0;
                    bossDrop = 0;
                    if (it.reward === "repair") startRepairs();
                }
            } else if (it.stage === "reward") {
                if (it.reward === "fireworks") {
                    if (Math.random() < dt * 3) spawnFirework();
                }
                if (it.t > 3) {
                    it.stage = "warn"; it.t = 0; warned = false;
                    // Announce the approaching monster over the loudspeaker.
                    const m = MONSTER_NAME[it.next] || "monster";
                    speak(pick(THREATS).replace("{m}", m));
                }
            } else if (it.stage === "warn") {
                // Escalating pre-shocks announce the next monster.
                const pulse = Math.sin(it.t * 14);
                if (pulse > 0.92 && Math.random() < 0.5) shake(0.16, 6 + it.t * 6);
                if (!warned && it.t > 0.3) { warned = true; SGSound.play("bosscharge"); }
                if (it.t > 2.2) {
                    it.stage = "rise"; it.t = 0;
                    setupBoss(it.next, bossLevel + 1);
                    bossDrop = H * 0.7;   // rises up from behind the city
                    SGSound.play(it.next === "slime" ? "bossroar" : "bossslam");
                    shake(0.6, 18);
                }
            } else if (it.stage === "rise") {
                bossDrop += (0 - bossDrop) * Math.min(1, dt * 4);
                if (it.t > 1.1) {
                    bossDrop = 0;
                    interlude = null;
                    newRound();
                }
            }
        }

        /* ---------- command center ---------- */
        function commandAvailable() {
            return mode === "siege" && phase === "answer" &&
                lives < MAX_LIVES && ccCooldown <= 0;
        }

        function openCommand() {
            mode = "command";
            const item = pick(WORDS);
            const answer = item.w[0];
            const cnt = kids ? 3 : 4;
            const set = [answer];
            while (set.length < cnt) {
                const c = pick(ALPHA);
                if (set.indexOf(c) < 0) set.push(c);
            }
            for (let i = set.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const t = set[i]; set[i] = set[j]; set[j] = t;
            }
            puzzle = { word: item.w, emoji: item.e, answer: answer, choices: set, picked: -1, done: false, t: 0 };
            SGSound.play("tap");
            if (lastChance) {
                SGSound.play("bosscharge");
                speak("Last chance! " + item.w + " starts with?");
            } else {
                speak(item.w + " starts with?");
            }
        }

        function resolveCommand(idx) {
            if (!puzzle || puzzle.done) return;
            puzzle.picked = idx;
            puzzle.done = true;
            puzzle.t = 0;
            const correct = puzzle.choices[idx] === puzzle.answer;
            ccCooldown = 2; // must successfully defend twice before next visit
            if (correct) {
                lives = Math.min(MAX_LIVES, lives + 1);
                healFlash = 1;
                // Patch up the city: one building, or every one if hearts are full.
                repairBuildings(lives >= MAX_LIVES ? buildings.length : 1);
                host.vibrate([10, 30, 10]);
                SGSound.play("highscore");
                speakThen(lastChance ? "Saved! " + puzzle.choices[idx] : puzzle.choices[idx], () => {
                    if (mode === "command") newRound();
                }, 1.5);
                lastChance = false;
            } else {
                shake(0.25, 8);
                SGSound.play("wrong");
            }
            // A failed last-chance rescue ends the game instead of resuming.
            if (lastChance && !correct) {
                lastChance = false;
                puzzle.fatal = true;
                setTimeout(() => {
                    if (mode !== "command") return;
                    mode = "over";
                    SGSound.play("gameover");
                    setTimeout(() => host.gameOver(score), 700);
                }, 800);
                return;
            }
            // Brief pause so the player sees the result, then back to the siege.
            if (!correct) setTimeout(() => { if (mode === "command") newRound(); }, 700);
        }

        /* ---------- atmosphere & fx ---------- */
        function shake(dur, mag) { shakeT = Math.max(shakeT, dur); shakeMag = Math.max(shakeMag, mag); }

        function spawnSmoke(x, y, dark) {
            if (smoke.length > 90) return;
            smoke.push({
                x: x, y: y, r: 6 + Math.random() * 10,
                vy: -18 - Math.random() * 22, vx: (Math.random() - 0.5) * 14,
                life: 1, max: 1.6 + Math.random() * 1.4, dark: !!dark
            });
        }
        function spawnEmber(x, y) {
            if (embers.length > 120) return;
            embers.push({
                x: x, y: y, vx: (Math.random() - 0.5) * 30,
                vy: -30 - Math.random() * 50, life: 1,
                size: 1 + Math.random() * 2.5
            });
        }

        function strikeLightning() {
            const tx = Math.random() * W;
            const pts = [{ x: tx, y: -10 }];
            let cx = tx, cy = -10;
            const steps = 6 + Math.floor(Math.random() * 4);
            const endY = groundY - rint(0, 80);
            for (let i = 1; i <= steps; i++) {
                cy += (endY + 10) / steps;
                cx += (Math.random() - 0.5) * 70;
                pts.push({ x: cx, y: cy });
            }
            bolts.push({ pts: pts, life: 0.35 });
            flash = 1;
            SGSound.play("bosszap");
        }

        function updateAtmosphere(dt) {
            // Rain
            for (const d of rain) {
                d.y += d.sp * dt;
                d.x += d.sp * 0.18 * dt;
                if (d.y > H) { d.y = -d.len; d.x = Math.random() * (W + 80) - 40; }
            }
            // Lightning
            lightTimer -= dt;
            if (lightTimer <= 0) {
                strikeLightning();
                lightTimer = 3 + Math.random() * 5;
            }
            for (let i = bolts.length - 1; i >= 0; i--) {
                bolts[i].life -= dt;
                if (bolts[i].life <= 0) bolts.splice(i, 1);
            }
            flash = Math.max(0, flash - dt * 3.2);
            ambient = Math.max(flash, ambient - dt * 2);

            // Smoke
            for (let i = smoke.length - 1; i >= 0; i--) {
                const p = smoke[i];
                p.x += p.vx * dt; p.y += p.vy * dt;
                p.vy *= (1 - dt * 0.4);
                p.r += dt * 10;
                p.life -= dt / p.max;
                if (p.life <= 0) smoke.splice(i, 1);
            }
            // Embers
            for (let i = embers.length - 1; i >= 0; i--) {
                const p = embers[i];
                p.x += p.vx * dt; p.y += p.vy * dt;
                p.vy += 26 * dt; p.life -= dt * 0.6;
                if (p.life <= 0) embers.splice(i, 1);
            }
            // Robot exhaust drifts constantly (only while the robot is on the field)
            if (bossType === "robot" && mode === "siege" && Math.random() < dt * 8) {
                spawnSmoke(rcx - 70 * s + Math.random() * 20, rcy - 70 * s, true);
                spawnSmoke(rcx + 60 * s + Math.random() * 20, rcy - 70 * s, true);
            }
            // Embers from damaged buildings
            for (const b of buildings) {
                if (b.damage > 0 && Math.random() < dt * 2 * b.damage) {
                    spawnEmber(b.x + Math.random() * b.w, groundY - b.h);
                    if (Math.random() < 0.4) spawnSmoke(b.x + Math.random() * b.w, groundY - b.h, true);
                }
            }

            // Shake + slow eases
            if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);
            sway = Math.sin(lastTs / 1000 * 1.4) * 3 * s;
            robotLunge += (0 - robotLunge) * Math.min(1, dt * 6);
            hitFlash = Math.max(0, hitFlash - dt * 3);
            healFlash = Math.max(0, healFlash - dt * 1.6);
            if (commanderT > 0) commanderT = Math.max(0, commanderT - dt);
        }

        function updateFx(dt) {
            if (beam) {
                beam.t += dt;
                if (beam.t > 0.6) beam = null;
            }
            if (forcefield) {
                forcefield.t += dt;
                if (forcefield.t > forcefield.dur) forcefield = null;
            }
        }

        function update(dt) {
            updateAtmosphere(dt);
            updateFx(dt);
            tickRepairs(dt);
            if (puzzle && puzzle.done) puzzle.t += dt;

            if (mode === "interlude") { updateInterlude(dt); return; }
            if (mode !== "siege") return;

            if (phase === "answer") {
                timer -= dt;
                charge = Math.max(0, Math.min(1, 1 - timer / roundTime));
                if (!warned && charge > 0.68) { warned = true; SGSound.play("bosscharge"); }
                if (timer <= 0) robotAttacks(undefined);
            } else if (waitingForSpeech) {
                return;
            } else if (phase === "win") {
                phaseT -= dt;
                if (phaseT <= 0) resolveWin();
            } else if (phase === "lose") {
                phaseT -= dt;
                if (phaseT <= 0) resolveLose();
            }
        }

        /* ---------- drawing helpers ---------- */
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

        function drawHeart(x, y, r, filled) {
            ctx.save();
            ctx.globalAlpha = filled ? 1 : 0.25;
            ctx.fillStyle = filled ? "#ff5d6c" : "#6a6a82";
            ctx.beginPath();
            ctx.moveTo(x, y + r * 0.85);
            ctx.bezierCurveTo(x - r * 1.4, y - r * 0.25, x - r * 0.7, y - r * 1.2, x, y - r * 0.35);
            ctx.bezierCurveTo(x + r * 0.7, y - r * 1.2, x + r * 1.4, y - r * 0.25, x, y + r * 0.85);
            ctx.fill();
            if (filled) {
                ctx.globalAlpha = 0.6;
                ctx.fillStyle = "rgba(255,255,255,0.6)";
                ctx.beginPath();
                ctx.ellipse(x - r * 0.35, y - r * 0.35, r * 0.22, r * 0.16, -0.5, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        function drawSky() {
            const g = ctx.createLinearGradient(0, 0, 0, H);
            g.addColorStop(0, "#080812");
            g.addColorStop(0.5, "#141528");
            g.addColorStop(1, "#241a38");
            ctx.fillStyle = g;
            ctx.fillRect(-40, -40, W + 80, H + 80);

            if (ambient > 0) {
                ctx.fillStyle = "rgba(150,170,255," + (ambient * 0.28) + ")";
                ctx.fillRect(-40, -40, W + 80, H + 80);
            }
            // Sickly moon glow
            ctx.save();
            const mg = ctx.createRadialGradient(W * 0.74, H * 0.2, 4, W * 0.74, H * 0.2, 120 * s);
            mg.addColorStop(0, "rgba(180,210,180,0.5)");
            mg.addColorStop(1, "rgba(180,210,180,0)");
            ctx.fillStyle = mg;
            ctx.fillRect(W * 0.74 - 130 * s, H * 0.2 - 130 * s, 260 * s, 260 * s);
            ctx.fillStyle = "rgba(210,225,200,0.85)";
            ctx.beginPath();
            ctx.arc(W * 0.74, H * 0.2, 26 * s, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        function drawSearchlights() {
            const t = lastTs / 1000;
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            const beams = [
                { x: W * 0.18, base: -1.15, sweep: 0.5, ph: 0 },
                { x: W * 0.82, base: -1.95, sweep: 0.5, ph: 1.7 }
            ];
            for (const bm of beams) {
                const ang = bm.base + Math.sin(t * 0.6 + bm.ph) * bm.sweep;
                const len = H * 1.1;
                const spread = 36 * s;
                const ex = bm.x + Math.cos(ang) * len;
                const ey = groundY + Math.sin(ang) * len;
                const nx = Math.cos(ang + Math.PI / 2), ny = Math.sin(ang + Math.PI / 2);
                const grd = ctx.createLinearGradient(bm.x, groundY, ex, ey);
                grd.addColorStop(0, "rgba(120,170,255,0.16)");
                grd.addColorStop(1, "rgba(120,170,255,0)");
                ctx.fillStyle = grd;
                ctx.beginPath();
                ctx.moveTo(bm.x, groundY);
                ctx.lineTo(ex + nx * spread, ey + ny * spread);
                ctx.lineTo(ex - nx * spread, ey - ny * spread);
                ctx.closePath();
                ctx.fill();
            }
            ctx.restore();
        }

        function drawFog() {
            const t = lastTs / 1000;
            ctx.save();
            for (let i = 0; i < 3; i++) {
                const y = groundY - 30 * s + i * 22 * s;
                const off = ((t * (6 + i * 4)) % (W + 200)) - 100;
                ctx.fillStyle = "rgba(180,190,210," + (0.05 + i * 0.02) + ")";
                ctx.beginPath();
                ctx.ellipse((off + W * 0.5) % (W + 200) - 100, y, W * 0.4, 26 * s, 0, 0, Math.PI * 2);
                ctx.ellipse(((off + W) % (W + 200)) - 100, y + 8, W * 0.3, 20 * s, 0, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        // Draw the active monster, or its tumbling remains during the crumble.
        function drawBoss() {
            if (mode === "interlude" && interlude && interlude.stage === "crumble") {
                drawCrumble();
                return;
            }
            if (mode === "interlude" && interlude &&
                (interlude.stage === "reward" || interlude.stage === "warn")) {
                return; // arena is empty between monsters
            }
            if (bossType === "slime") drawSlime();
            else drawRobot();
        }

        function drawCrumble() {
            for (const c of crumble) {
                ctx.save();
                ctx.translate(c.x + sway, c.y);
                ctx.rotate(c.rot);
                if (c.slime) {
                    ctx.fillStyle = "rgba(120,210,90,0.9)";
                    ctx.beginPath(); ctx.arc(0, 0, c.sz * 0.6, 0, Math.PI * 2); ctx.fill();
                } else {
                    ctx.fillStyle = "#5a6478";
                    roundRect(-c.sz / 2, -c.sz / 2, c.sz, c.sz, 2 * s); ctx.fill();
                    ctx.fillStyle = "rgba(0,0,0,0.3)";
                    roundRect(-c.sz / 2, c.sz * 0.1, c.sz, c.sz * 0.4, 2 * s); ctx.fill();
                }
                ctx.restore();
            }
        }

        function drawSlime() {
            const cx = rcx + sway;
            const breathe = Math.sin(lastTs / 1000 * 2) * 6 * s;
            const cy = rcy + bossDrop + robotLunge * 16 * s + breathe;
            const danger = charge;
            ctx.save();
            ctx.translate(cx, cy);

            const bodyR = 120 * s;
            const wob = Math.sin(lastTs / 1000 * 3) * 8 * s;

            // gooey shadow puddle
            ctx.fillStyle = "rgba(40,80,30,0.5)";
            ctx.beginPath();
            ctx.ellipse(0, bodyR * 0.9, bodyR * 1.1, 26 * s, 0, 0, Math.PI * 2);
            ctx.fill();

            // blobby body
            const bg = ctx.createRadialGradient(-30 * s, -40 * s, 10 * s, 0, 0, bodyR * 1.3);
            bg.addColorStop(0, "#bff36a");
            bg.addColorStop(0.6, "#76c442");
            bg.addColorStop(1, "#3f7d27");
            ctx.fillStyle = bg;
            ctx.beginPath();
            const lobes = 12;
            for (let i = 0; i <= lobes; i++) {
                const a = (i / lobes) * Math.PI * 2;
                const rr = bodyR + Math.sin(a * 3 + lastTs / 1000 * 2) * 10 * s + (a < Math.PI ? wob * 0.3 : 0);
                const px = Math.cos(a) * rr;
                const py = Math.sin(a) * rr * 0.92;
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath(); ctx.fill();

            // drippy highlights
            ctx.fillStyle = "rgba(255,255,255,0.25)";
            ctx.beginPath(); ctx.ellipse(-40 * s, -50 * s, 26 * s, 18 * s, -0.5, 0, Math.PI * 2); ctx.fill();

            // angry charging eyes
            const eyeC = "rgba(" + Math.floor(40 + 200 * danger) + ",30,40,1)";
            for (const sgn of [-1, 1]) {
                ctx.fillStyle = "#0c1a08";
                ctx.beginPath(); ctx.ellipse(sgn * 38 * s, -18 * s, 22 * s, 26 * s, 0, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = eyeC;
                ctx.beginPath(); ctx.arc(sgn * 38 * s, -12 * s, 9 * s, 0, Math.PI * 2); ctx.fill();
                // angry brow
                ctx.strokeStyle = "#234d18"; ctx.lineWidth = 6 * s;
                ctx.beginPath();
                ctx.moveTo(sgn * 20 * s, -40 * s); ctx.lineTo(sgn * 56 * s, -30 * s); ctx.stroke();
            }
            // mouth (widens with charge)
            ctx.fillStyle = "#0c1a08";
            ctx.beginPath();
            ctx.ellipse(0, 34 * s, (24 + danger * 18) * s, (10 + danger * 14) * s, 0, 0, Math.PI * 2);
            ctx.fill();
            // dripping goo from the mouth as it winds up
            if (danger > 0.05 && phase === "answer") {
                ctx.fillStyle = "rgba(150,230,90," + (0.4 + danger * 0.5) + ")";
                ctx.beginPath();
                ctx.arc(0, (48 + danger * 26) * s, (5 + danger * 8) * s, 0, Math.PI * 2);
                ctx.fill();
            }

            // struck flash
            if (hitFlash > 0) {
                ctx.globalAlpha = hitFlash * 0.6;
                ctx.fillStyle = "#ffffff";
                ctx.beginPath(); ctx.arc(0, 0, bodyR, 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = 1;
            }
            ctx.restore();
        }

        function drawRobot() {
            const lunge = robotLunge * 16 * s;
            const cx = rcx + sway;
            const cy = rcy + bossDrop + lunge + Math.sin(lastTs / 1000 * 1.6) * 3 * s;
            const danger = charge;             // 0..1 charge meter drives the menace
            const eye = "rgba(" + Math.floor(120 + 135 * danger) + "," + Math.floor(220 - 170 * danger) + ",255,1)";
            const core = "rgba(" + Math.floor(120 + 135 * danger) + "," + Math.floor(200 - 150 * danger) + "," + Math.floor(255 - 180 * danger) + ",1)";

            ctx.save();
            ctx.translate(cx, cy);

            const metalL = "#5a6478", metalD = "#2b3142", metalE = "#7d8aa6";

            // --- legs (mostly hidden behind the city) --- //
            for (const sgn of [-1, 1]) {
                ctx.save();
                ctx.translate(sgn * 46 * s, 60 * s);
                ctx.fillStyle = metalD;
                roundRect(-18 * s, 0, 36 * s, 150 * s, 12 * s); ctx.fill();
                ctx.fillStyle = metalL;
                roundRect(-14 * s, 6 * s, 28 * s, 60 * s, 10 * s); ctx.fill();
                // knee joint
                ctx.fillStyle = metalE;
                ctx.beginPath(); ctx.arc(0, 72 * s, 13 * s, 0, Math.PI * 2); ctx.fill();
                // foot
                ctx.fillStyle = metalD;
                roundRect(-26 * s, 150 * s, 52 * s, 22 * s, 8 * s); ctx.fill();
                ctx.restore();
            }

            // --- exhaust stacks with glow --- //
            for (const sgn of [-1, 1]) {
                ctx.fillStyle = "#1c2130";
                roundRect(sgn * 60 * s - 6 * s, -82 * s, 12 * s, 26 * s, 4 * s); ctx.fill();
                ctx.fillStyle = "rgba(255,140,60,0.7)";
                ctx.beginPath(); ctx.arc(sgn * 60 * s, -82 * s, 5 * s, 0, Math.PI * 2); ctx.fill();
            }

            // --- torso --- //
            const tw = 150 * s, th = 124 * s;
            const tg = ctx.createLinearGradient(0, -th / 2, 0, th / 2);
            tg.addColorStop(0, metalE);
            tg.addColorStop(0.5, metalL);
            tg.addColorStop(1, metalD);
            ctx.fillStyle = tg;
            roundRect(-tw / 2, -th / 2, tw, th, 22 * s); ctx.fill();
            // chest plate seams
            ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 2 * s;
            ctx.beginPath();
            ctx.moveTo(-tw / 2 + 14 * s, -th / 2 + 30 * s); ctx.lineTo(tw / 2 - 14 * s, -th / 2 + 30 * s);
            ctx.moveTo(0, -th / 2 + 30 * s); ctx.lineTo(0, th / 2 - 16 * s);
            ctx.stroke();
            // rivets
            ctx.fillStyle = "rgba(0,0,0,0.3)";
            for (const rx of [-tw / 2 + 12 * s, tw / 2 - 12 * s]) {
                for (let ry = -th / 2 + 14 * s; ry < th / 2; ry += 26 * s) {
                    ctx.beginPath(); ctx.arc(rx, ry, 2.4 * s, 0, Math.PI * 2); ctx.fill();
                }
            }
            // warning stripes on the belly
            ctx.save();
            roundRect(-tw / 2 + 10 * s, th / 2 - 28 * s, tw - 20 * s, 18 * s, 6 * s); ctx.clip();
            for (let i = -tw; i < tw; i += 18 * s) {
                ctx.fillStyle = (Math.floor(i / (18 * s)) % 2 === 0) ? "#f2c84b" : "#1c2130";
                ctx.beginPath();
                ctx.moveTo(i, th / 2 - 28 * s); ctx.lineTo(i + 10 * s, th / 2 - 28 * s);
                ctx.lineTo(i + 10 * s - 14 * s, th / 2 - 10 * s); ctx.lineTo(i - 14 * s, th / 2 - 10 * s);
                ctx.closePath(); ctx.fill();
            }
            ctx.restore();

            // --- reactor core --- //
            const coreR = (20 + 6 * danger) * s;
            const cg = ctx.createRadialGradient(0, -6 * s, 2, 0, -6 * s, coreR * 1.6);
            cg.addColorStop(0, "#ffffff");
            cg.addColorStop(0.4, core);
            cg.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = cg;
            ctx.beginPath(); ctx.arc(0, -6 * s, coreR * 1.6, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = core;
            ctx.beginPath(); ctx.arc(0, -6 * s, coreR * 0.5, 0, Math.PI * 2); ctx.fill();

            // --- shoulders + arms --- //
            for (const sgn of [-1, 1]) {
                ctx.save();
                ctx.translate(sgn * 96 * s, -44 * s);
                ctx.fillStyle = metalD;
                roundRect(-34 * s, -28 * s, 68 * s, 52 * s, 16 * s); ctx.fill();
                ctx.fillStyle = metalL;
                roundRect(-28 * s, -22 * s, 40 * s, 22 * s, 10 * s); ctx.fill();
                ctx.restore();
            }
            // left arm = fist
            ctx.save();
            ctx.translate(-104 * s, 6 * s);
            ctx.fillStyle = metalL;
            roundRect(-16 * s, 0, 32 * s, 80 * s, 12 * s); ctx.fill();
            ctx.fillStyle = metalD;
            roundRect(-22 * s, 78 * s, 44 * s, 34 * s, 12 * s); ctx.fill();
            ctx.restore();
            // right arm = cannon (aimed at the city)
            ctx.save();
            ctx.translate(104 * s, 6 * s);
            ctx.fillStyle = metalL;
            roundRect(-16 * s, 0, 32 * s, 62 * s, 12 * s); ctx.fill();
            ctx.fillStyle = metalD;
            roundRect(-24 * s, 58 * s, 48 * s, 40 * s, 10 * s); ctx.fill();
            // muzzle
            ctx.fillStyle = "#11131d";
            roundRect(-14 * s, 92 * s, 28 * s, 22 * s, 6 * s); ctx.fill();
            // charging glow at the muzzle
            if (danger > 0.05 && phase === "answer") {
                if (special) {
                    // electric wind-up: crackling blue arcs gather at the muzzle
                    const er = (6 + 12 * danger) * s;
                    ctx.save();
                    ctx.shadowColor = "rgba(120,200,255,0.95)";
                    ctx.shadowBlur = 14 * s;
                    ctx.fillStyle = "rgba(170,225,255," + (0.3 + danger * 0.6) + ")";
                    ctx.beginPath(); ctx.arc(0, 110 * s, er, 0, Math.PI * 2); ctx.fill();
                    const arcs = 3 + Math.floor(danger * 4);
                    ctx.strokeStyle = "rgba(200,235,255," + (0.5 + danger * 0.5) + ")";
                    ctx.lineWidth = 1.6 * s;
                    for (let k = 0; k < arcs; k++) {
                        const a0 = Math.random() * Math.PI * 2;
                        ctx.beginPath();
                        ctx.moveTo(Math.cos(a0) * er * 0.4, 110 * s + Math.sin(a0) * er * 0.4);
                        const steps = 3;
                        for (let j = 1; j <= steps; j++) {
                            const rr = er * (0.6 + j * 0.5);
                            ctx.lineTo(
                                Math.cos(a0) * rr + (Math.random() - 0.5) * 8 * s,
                                110 * s + Math.sin(a0) * rr + (Math.random() - 0.5) * 8 * s
                            );
                        }
                        ctx.stroke();
                    }
                    ctx.restore();
                } else {
                    ctx.fillStyle = "rgba(255," + Math.floor(200 - 160 * danger) + ",80," + (0.25 + danger * 0.6) + ")";
                    ctx.beginPath(); ctx.arc(0, 110 * s, (6 + 10 * danger) * s, 0, Math.PI * 2); ctx.fill();
                }
            }
            ctx.restore();

            // --- neck + head --- //
            ctx.fillStyle = metalD;
            roundRect(-20 * s, -th / 2 - 16 * s, 40 * s, 22 * s, 6 * s); ctx.fill();
            const hw = 104 * s, hh = 76 * s, hy = -th / 2 - 16 * s - hh;
            const hg = ctx.createLinearGradient(0, hy, 0, hy + hh);
            hg.addColorStop(0, metalE); hg.addColorStop(1, metalD);
            ctx.fillStyle = hg;
            roundRect(-hw / 2, hy, hw, hh, 18 * s); ctx.fill();
            // visor
            ctx.fillStyle = "#0a0c14";
            roundRect(-hw / 2 + 12 * s, hy + 22 * s, hw - 24 * s, 30 * s, 10 * s); ctx.fill();
            // eyes
            ctx.save();
            ctx.shadowColor = eye; ctx.shadowBlur = 16 * s;
            ctx.fillStyle = eye;
            for (const sgn of [-1, 1]) {
                roundRect(sgn * 26 * s - 12 * s, hy + 30 * s, 24 * s, 12 * s, 4 * s); ctx.fill();
            }
            ctx.restore();
            // antenna with blinking tip
            ctx.strokeStyle = metalE; ctx.lineWidth = 4 * s;
            ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(0, hy - 24 * s); ctx.stroke();
            const blink = (Math.floor(lastTs / 280) % 2 === 0);
            ctx.fillStyle = blink ? "#ff5d6c" : "#5a2030";
            ctx.beginPath(); ctx.arc(0, hy - 26 * s, 5 * s, 0, Math.PI * 2); ctx.fill();

            // --- struck flash --- //
            if (hitFlash > 0) {
                ctx.globalAlpha = hitFlash * 0.7;
                ctx.fillStyle = "#ffffff";
                roundRect(-tw / 2, hy, tw, th + 16 * s + hh, 22 * s); ctx.fill();
                ctx.globalAlpha = 1;
            }
            ctx.restore();
        }

        function drawCity() {
            for (const b of buildings) {
                const top = groundY - b.h;
                ctx.fillStyle = b.color;
                ctx.fillRect(b.x, top, b.w, b.h);
                // subtle face shading
                ctx.fillStyle = "rgba(0,0,0,0.18)";
                ctx.fillRect(b.x + b.w * 0.66, top, b.w * 0.34, b.h);
                // windows
                const pad = 5;
                const cw = (b.w - pad * 2) / b.cols;
                const ch = (b.h - pad * 2) / b.rows;
                for (let r = 0; r < b.rows; r++) {
                    for (let c = 0; c < b.cols; c++) {
                        const idx = r * b.cols + c;
                        const on = b.lit[idx];
                        // Damaged buildings simply dim their windows — no flicker.
                        ctx.fillStyle = on
                            ? (b.damage >= 0.5 ? "#caa24f" : "#ffd166")
                            : "rgba(40,52,80,0.7)";
                        ctx.fillRect(b.x + pad + c * cw + 1, top + pad + r * ch + 1, cw - 2.5, ch - 2.5);
                    }
                }
                if (b.antenna) {
                    ctx.strokeStyle = "#11131d"; ctx.lineWidth = 2;
                    ctx.beginPath(); ctx.moveTo(b.x + b.w / 2, top); ctx.lineTo(b.x + b.w / 2, top - 14); ctx.stroke();
                    ctx.fillStyle = "#ff5d6c";
                    ctx.beginPath(); ctx.arc(b.x + b.w / 2, top - 14, 2.5, 0, Math.PI * 2); ctx.fill();
                }
                if (b.damage > 0) {
                    ctx.fillStyle = "rgba(0,0,0," + (b.damage * 0.35) + ")";
                    ctx.fillRect(b.x, top, b.w, b.h);
                }
                if (b.repairing) drawScaffold(b, top);
            }
            // ground line
            ctx.fillStyle = "#0c0e16";
            ctx.fillRect(-40, groundY, W + 80, H - groundY + 40);
            ctx.fillStyle = "rgba(120,170,255,0.15)";
            ctx.fillRect(-40, groundY, W + 80, 2);
        }

        // Tiny construction crew: scaffolding poles plus a worker with a torch.
        function drawScaffold(b, top) {
            ctx.save();
            // scaffolding frame
            ctx.strokeStyle = "#caa24f"; ctx.lineWidth = 2;
            for (let gx = b.x + 6; gx < b.x + b.w; gx += 14) {
                ctx.beginPath(); ctx.moveTo(gx, top); ctx.lineTo(gx, groundY); ctx.stroke();
            }
            for (let gy = top + 12; gy < groundY; gy += 18) {
                ctx.beginPath(); ctx.moveTo(b.x + 4, gy); ctx.lineTo(b.x + b.w - 4, gy); ctx.stroke();
            }
            // worker on a plank near the repair seam
            const wx = b.x + b.w * (b.worker || 0.5);
            const wy = top + 8;
            ctx.fillStyle = "#ffd166";
            ctx.beginPath(); ctx.arc(wx, wy - 7, 3.2, 0, Math.PI * 2); ctx.fill();   // helmet
            ctx.fillStyle = "#3a73c4";
            ctx.fillRect(wx - 2.5, wy - 4, 5, 8);                                     // body
            // soldering torch flicker
            if (Math.floor((b.solderT || 0) * 6) % 2 === 0) {
                ctx.fillStyle = "#9fe2ff";
                ctx.beginPath(); ctx.arc(wx + 5, wy + 2, 2.4, 0, Math.PI * 2); ctx.fill();
            }
            ctx.restore();
        }

        function drawBeams() {
            if (!beam) return;
            const a = Math.max(0, 1 - beam.t / 0.6);
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            if (beam.kind === "player") {
                // city cannon zaps up into the robot
                const x = beam.x;
                ctx.strokeStyle = "rgba(120,230,255," + a + ")";
                ctx.lineWidth = (8 + 8 * a) * s;
                ctx.beginPath(); ctx.moveTo(x, groundY); ctx.lineTo(rcx + sway, rcy + 40 * s); ctx.stroke();
                ctx.strokeStyle = "rgba(255,255,255," + a + ")";
                ctx.lineWidth = 3 * s;
                ctx.beginPath(); ctx.moveTo(x, groundY); ctx.lineTo(rcx + sway, rcy + 40 * s); ctx.stroke();
            } else if (beam.special) {
                // robot unleashes a jagged electric bolt down into the city
                const x = beam.x;
                const sx = rcx + sway + 104 * s, sy = rcy + 110 * s;
                const segs = 9;
                const bolts = kids ? 4 : 2;
                ctx.shadowColor = "rgba(120,200,255,0.95)"; ctx.shadowBlur = (kids ? 28 : 16) * s;
                for (let b = 0; b < bolts; b++) {
                    const ba = a * (b === 0 ? 1 : 0.55);
                    ctx.strokeStyle = b % 2 === 0 ? "rgba(150,210,255," + ba + ")" : "rgba(255,255,120," + ba + ")";
                    ctx.lineWidth = (kids ? 9 + 13 * ba : 7 + 9 * ba) * s;
                    ctx.beginPath();
                    ctx.moveTo(sx, sy);
                    for (let i = 1; i < segs; i++) {
                        const f = i / segs;
                        const jx = sx + (x - sx) * f + (Math.random() - 0.5) * (kids ? 46 : 26) * s;
                        const jy = sy + (groundY - 10 - sy) * f + (Math.random() - 0.5) * (kids ? 26 : 14) * s;
                        ctx.lineTo(jx, jy);
                    }
                    ctx.lineTo(x + (Math.random() - 0.5) * (kids ? 36 : 0) * s, groundY - 10);
                    ctx.stroke();
                }
                ctx.shadowBlur = 0;
                ctx.fillStyle = "rgba(255,255,255," + (0.45 * a) + ")";
                ctx.fillRect(-40, -40, W + 80, H + 80);
                ctx.fillStyle = "rgba(190,230,255," + a + ")";
                ctx.beginPath(); ctx.arc(x, groundY - 10, (kids ? 24 + 46 * a : 16 + 24 * a) * s, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = "rgba(255,255,120," + (0.9 * a) + ")";
                ctx.lineWidth = 3 * s;
                ctx.beginPath(); ctx.arc(x, groundY - 10, (kids ? 38 + 78 * (1 - a) : 24 + 34 * (1 - a)) * s, 0, Math.PI * 2); ctx.stroke();
            } else {
                // robot cannon smashes down into the city
                const x = beam.x;
                ctx.strokeStyle = "rgba(255,120,90," + a + ")";
                ctx.lineWidth = (10 + 12 * a) * s;
                ctx.beginPath(); ctx.moveTo(rcx + sway + 104 * s, rcy + 110 * s); ctx.lineTo(x, groundY - 10); ctx.stroke();
                ctx.fillStyle = "rgba(255,200,120," + a + ")";
                ctx.beginPath(); ctx.arc(x, groundY - 10, (16 + 26 * a) * s, 0, Math.PI * 2); ctx.fill();
            }
            ctx.restore();
        }

        // A translucent protective dome that snaps up over the city and
        // glances the boss's blow away, showing the city was kept safe.
        function drawForcefield() {
            if (!forcefield) return;
            const ff = forcefield;
            const p = ff.t / ff.dur;
            const deploy = Math.min(1, ff.t / 0.16);            // quick pop-up
            const fade = p > 0.65 ? Math.max(0, 1 - (p - 0.65) / 0.35) : 1;
            const a = deploy * fade;
            if (a <= 0) return;

            const cx = W / 2;
            const cy = groundY + 6 * s;
            const rx = W * 0.6;
            const ry = groundY * 0.62 * (0.62 + 0.38 * deploy);
            const apexY = cy - ry;
            const t = lastTs / 1000;
            const hue = ff.special ? "150,210,255" : "120,230,255";
            const flashBoost = ff.special && kids ? 1.7 : 1;

            ctx.save();
            ctx.globalCompositeOperation = "lighter";

            // Faint translucent body so the city stays clearly visible through it.
            const g = ctx.createRadialGradient(cx, cy, ry * 0.2, cx, cy, ry);
            g.addColorStop(0, "rgba(" + hue + ",0)");
            g.addColorStop(0.78, "rgba(" + hue + "," + (0.06 * a * flashBoost) + ")");
            g.addColorStop(1, "rgba(" + hue + "," + (0.20 * a * flashBoost) + ")");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, Math.PI * 2);
            ctx.closePath();
            ctx.fill();

            // Bright energy rim with a gentle shimmer.
            const rimA = a * (0.8 + 0.2 * Math.sin(t * 10));
            ctx.lineWidth = (2.5 + 1.5 * a * flashBoost) * s;
            ctx.strokeStyle = "rgba(" + hue + "," + (0.6 * rimA * flashBoost) + ")";
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, Math.PI * 2);
            ctx.stroke();

            // Horizontal lattice rings give it a force-field lattice look.
            ctx.lineWidth = 1 * s;
            for (let k = 1; k <= 3; k++) {
                const h = ry * (k / 4);
                const rw = rx * Math.sqrt(Math.max(0, 1 - (h / ry) * (h / ry)));
                ctx.strokeStyle = "rgba(" + hue + "," + (0.12 * a * flashBoost) + ")";
                ctx.beginPath();
                ctx.ellipse(cx, cy - h, rw, rw * 0.12, 0, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Impact: the boss's strike glances off the apex in a burst of light.
            const impact = Math.max(0, 1 - ff.t / 0.45);
            if (impact > 0) {
                ctx.strokeStyle = "rgba(255,255,255," + (0.5 * impact * flashBoost) + ")";
                ctx.lineWidth = (3 + 4 * impact * flashBoost) * s;
                ctx.beginPath();
                ctx.moveTo(rcx + sway, rcy + 80 * s);
                ctx.lineTo(cx, apexY);
                ctx.stroke();

                const fr = (12 + 60 * flashBoost * (1 - impact)) * s;
                const ig = ctx.createRadialGradient(cx, apexY, 0, cx, apexY, fr);
                ig.addColorStop(0, "rgba(255,255,255," + (0.9 * impact) + ")");
                ig.addColorStop(0.4, "rgba(" + hue + "," + (0.7 * impact) + ")");
                ig.addColorStop(1, "rgba(" + hue + ",0)");
                ctx.fillStyle = ig;
                ctx.beginPath(); ctx.arc(cx, apexY, fr, 0, Math.PI * 2); ctx.fill();

                const rr = (10 + 120 * flashBoost * (1 - impact)) * s;
                ctx.strokeStyle = "rgba(255,255,255," + (0.6 * impact * flashBoost) + ")";
                ctx.lineWidth = 3 * s * impact * flashBoost;
                ctx.beginPath(); ctx.arc(cx, apexY, rr, 0, Math.PI * 2); ctx.stroke();
            }

            // Ricochet sparks scatter off the top as the blow is turned aside.
            const spark = Math.max(0, 1 - ff.t / 0.55);
            if (spark > 0) {
                const n = ff.special && kids ? 18 : 9;
                for (let i = 0; i < n; i++) {
                    const ang = -Math.PI / 2 + (i / (n - 1) - 0.5) * 2.4 + Math.sin(i * 3.1) * 0.12;
                    const dist = (18 + ff.t * 520) * s;
                    const px = cx + Math.cos(ang) * dist;
                    const py = apexY + Math.sin(ang) * dist;
                    ctx.fillStyle = "rgba(" + hue + "," + spark + ")";
                    ctx.fillRect(px, py, 3 * s, 3 * s);
                }
            }

            ctx.restore();
        }

        function drawWeather() {
            // Rain
            ctx.strokeStyle = "rgba(160,190,230,0.32)";
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            for (const d of rain) {
                ctx.moveTo(d.x, d.y);
                ctx.lineTo(d.x - d.len * 0.18, d.y + d.len);
            }
            ctx.stroke();
            // Smoke
            for (const p of smoke) {
                ctx.globalAlpha = Math.max(0, p.life) * 0.5;
                ctx.fillStyle = p.dark ? "#2a2a32" : "#9aa0b0";
                ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
            }
            ctx.globalAlpha = 1;
            // Embers
            ctx.globalCompositeOperation = "lighter";
            for (const p of embers) {
                ctx.globalAlpha = Math.max(0, p.life);
                ctx.fillStyle = p.life > 0.5 ? "#ffd166" : "#ff7a3c";
                ctx.fillRect(p.x, p.y, p.size, p.size);
            }
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = "source-over";
            // Lightning bolts
            for (const bo of bolts) {
                ctx.globalAlpha = Math.min(1, bo.life / 0.35);
                ctx.strokeStyle = "rgba(220,235,255,0.95)";
                ctx.lineWidth = 2.5;
                ctx.shadowColor = "rgba(180,210,255,0.9)"; ctx.shadowBlur = 12;
                ctx.beginPath();
                ctx.moveTo(bo.pts[0].x, bo.pts[0].y);
                for (let i = 1; i < bo.pts.length; i++) ctx.lineTo(bo.pts[i].x, bo.pts[i].y);
                ctx.stroke();
                ctx.shadowBlur = 0;
            }
            ctx.globalAlpha = 1;
            // Fireworks + welding sparks (celebration / repair)
            if (sparks.length) {
                ctx.globalCompositeOperation = "lighter";
                for (const sp of sparks) {
                    ctx.globalAlpha = Math.max(0, sp.life);
                    ctx.fillStyle = sp.col;
                    ctx.beginPath(); ctx.arc(sp.x, sp.y, (sp.weld ? 1.6 : 2.6), 0, Math.PI * 2); ctx.fill();
                }
                ctx.globalAlpha = 1;
                ctx.globalCompositeOperation = "source-over";
            }
        }

        /* ---------- HUD + panels ---------- */
        function drawHearts() {
            for (let i = 0; i < MAX_LIVES; i++) {
                drawHeart(22 + i * 26, 26, 9, i < lives);
            }
        }

        function drawCenteredIconText(icon, text, cx, y, iconFont, textFont, gap) {
            gap = gap === undefined ? 5 : gap;
            ctx.save();
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.font = iconFont;
            const iw = ctx.measureText(icon).width;
            ctx.font = textFont;
            const tw = ctx.measureText(text).width;
            const x = cx - (iw + gap + tw) / 2;
            ctx.font = iconFont;
            ctx.fillText(icon, x, y);
            ctx.font = textFont;
            ctx.fillText(text, x + iw + gap, y);
            ctx.restore();
        }

        function layoutSiege() {
            const panelTop = H * 0.71;
            const n = choices.length;
            const cols = Math.min(n, 4);
            const rows = Math.ceil(n / cols);
            const gx = 12, gy = panelTop + 50;
            const gw = W - gx * 2;
            const gh = H - gy - 14;
            const gap = 8;
            const cw = (gw - gap * (cols - 1)) / cols;
            const chh = (gh - gap * (rows - 1)) / rows;
            siegeRects = [];
            for (let i = 0; i < n; i++) {
                const r = Math.floor(i / cols);
                const c = i % cols;
                const rowN = (r === rows - 1) ? (n - cols * r) : cols;
                const rowW = rowN * cw + (rowN - 1) * gap;
                const x0 = (W - rowW) / 2;
                siegeRects.push({ ch: choices[i], idx: i, x: x0 + c * (cw + gap), y: gy + r * (chh + gap), w: cw, h: chh });
            }
            return { panelTop: panelTop };
        }

        function drawSiegeHUD() {
            const lay = layoutSiege();
            // panel backdrop
            ctx.fillStyle = "rgba(8,10,20,0.82)";
            ctx.fillRect(0, lay.panelTop, W, H - lay.panelTop);
            ctx.fillStyle = "rgba(120,170,255,0.18)";
            ctx.fillRect(0, lay.panelTop, W, 2);

            // danger timer bar
            const barY = lay.panelTop + 10;
            const left = timer / roundTime;
            ctx.fillStyle = "rgba(255,255,255,0.12)";
            roundRect(14, barY, W - 28, 8, 4); ctx.fill();
            ctx.fillStyle = charge > 0.66 ? "#ff5d6c" : (charge > 0.4 ? "#ffd166" : "#39d0ff");
            roundRect(14, barY, (W - 28) * left, 8, 4); ctx.fill();

            // prompt
            ctx.textAlign = "center";
            ctx.textBaseline = "alphabetic";
            if (special) {
                const want = (choiceCase === "lower")
                    ? (kids ? "little" : "lowercase")
                    : (kids ? "BIG" : "UPPERCASE");
                ctx.fillStyle = "#8ad6ff";
                const f = W < 360 ? "800 14px system-ui, sans-serif" : "800 16px system-ui, sans-serif";
                drawCenteredIconText("\u26A1", "SPECIAL: TAP THE " + want + " LETTER", W / 2, lay.panelTop + 32, f, f, 6);
            } else {
                ctx.fillStyle = charge > 0.66 ? "#ff8a92" : "rgba(242,243,255,0.92)";
                const f = W < 360 ? "800 14px system-ui, sans-serif" : "800 16px system-ui, sans-serif";
                drawCenteredIconText("\u26A0\uFE0F", "TAP THE LETTER", W / 2, lay.panelTop + 32, f, f, 7);
            }

            // big target letter, top-centre over the action
            ctx.save();
            ctx.font = "900 " + Math.floor(46 + charge * 8) + "px system-ui, sans-serif";
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillStyle = "rgba(0,0,0,0.45)";
            roundRect(W / 2 - 44, 16, 88, 70, 16); ctx.fill();
            ctx.strokeStyle = special ? "#8ad6ff" : (charge > 0.66 ? "#ff5d6c" : "#39d0ff");
            ctx.lineWidth = 3; ctx.stroke();
            ctx.fillStyle = "#ffffff";
            ctx.fillText(dispCase(target, targetCase), W / 2, 53);
            ctx.restore();

            // choice buttons
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            for (const r of siegeRects) {
                let fill = "#2a3350", edge = "rgba(255,255,255,0.14)", txt = "#f2f3ff";
                if (phase !== "answer") {
                    if (r.idx === targetIdx) { fill = "#1f7a48"; edge = "#39d98a"; }
                    else if (r.idx === lastTapped && !answeredRight) { fill = "#7a2230"; edge = "#ff5d6c"; }
                }
                const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
                g.addColorStop(0, fill);
                g.addColorStop(1, "rgba(0,0,0,0.3)");
                ctx.fillStyle = g;
                roundRect(r.x, r.y, r.w, r.h, 12); ctx.fill();
                ctx.strokeStyle = edge; ctx.lineWidth = 2; ctx.stroke();
                ctx.fillStyle = txt;
                ctx.font = "800 " + Math.floor(Math.min(r.w, r.h) * 0.5) + "px system-ui, sans-serif";
                ctx.fillText(dispCase(r.ch, choiceCase), r.x + r.w / 2, r.y + r.h / 2 + 1);
            }

            // command center button
            const avail = commandAvailable();
            const compact = W < 380;
            const cbw = compact ? Math.min(156, W - 24) : 132, cbh = 34;
            ccBtn = { x: compact ? (W - cbw) / 2 : W - cbw - 10, y: compact ? 88 : 12, w: cbw, h: cbh, avail: avail };
            ctx.globalAlpha = avail ? 1 : 0.4;
            const cg = ctx.createLinearGradient(0, ccBtn.y, 0, ccBtn.y + cbh);
            cg.addColorStop(0, "#3a2f6a"); cg.addColorStop(1, "#241c46");
            ctx.fillStyle = cg;
            roundRect(ccBtn.x, ccBtn.y, cbw, cbh, 10); ctx.fill();
            ctx.strokeStyle = avail ? "#ffd166" : "rgba(255,255,255,0.25)";
            ctx.lineWidth = 2; ctx.stroke();
            ctx.fillStyle = "#fff";
            ctx.font = "700 13px system-ui, sans-serif";
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            const label = lives >= MAX_LIVES ? "Hearts full"
                : avail ? "Command Center"
                    : "Recharge " + ccCooldown;
            drawCenteredIconText("\u{1F6E1}\uFE0F", label, ccBtn.x + cbw / 2, ccBtn.y + cbh / 2 + 1, "700 13px system-ui, sans-serif", "700 13px system-ui, sans-serif", 4);
            ctx.globalAlpha = 1;

            // score
            ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
            ctx.fillStyle = "rgba(154,160,195,0.95)";
            ctx.font = "700 13px system-ui, sans-serif";
            ctx.fillText("Defenses " + score, W - 12, 62);
        }

        function drawCommandPanel() {
            ctx.fillStyle = "rgba(6,8,18,0.78)";
            ctx.fillRect(0, 0, W, H);
            const cw = Math.min(330, W - 32), ch = 320;
            const x = (W - cw) / 2, y = (H - ch) / 2;
            const g = ctx.createLinearGradient(0, y, 0, y + ch);
            g.addColorStop(0, "#1a1e36"); g.addColorStop(1, "#12121f");
            ctx.fillStyle = g;
            roundRect(x, y, cw, ch, 20); ctx.fill();
            ctx.strokeStyle = "#6c7bff"; ctx.lineWidth = 2; ctx.stroke();

            ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
            ctx.fillStyle = "#ffd166";
            const titleFont = W < 360 ? "800 15px system-ui, sans-serif" : "800 17px system-ui, sans-serif";
            drawCenteredIconText("\u{1F6E1}\uFE0F", "COMMAND CENTER", x + cw / 2, y + 30, titleFont, titleFont, 6);
            if (lastChance) {
                ctx.fillStyle = "#ff8a92";
                ctx.font = "800 13px system-ui, sans-serif";
                ctx.fillText("\u26A0\uFE0F LAST CHANCE \u2014 answer to survive!", x + cw / 2, y + 50);
            } else {
                ctx.fillStyle = "rgba(154,160,195,0.95)";
                ctx.font = "500 13px system-ui, sans-serif";
                ctx.fillText("Answer to repair a heart", x + cw / 2, y + 50);
            }

            // word + emoji
            ctx.font = "54px system-ui, sans-serif";
            ctx.fillText(puzzle.emoji, x + cw / 2, y + 110);
            ctx.fillStyle = "#f2f3ff";
            ctx.font = "800 26px system-ui, sans-serif";
            ctx.fillText(puzzle.word, x + cw / 2, y + 146);
            ctx.fillStyle = "rgba(242,243,255,0.9)";
            ctx.font = "700 15px system-ui, sans-serif";
            ctx.fillText("starts with...", x + cw / 2, y + 172);

            // choice buttons
            const n = puzzle.choices.length;
            const gap = 10, bw = (cw - 40 - gap * (n - 1)) / n, bh = 60;
            const by = y + 190, bx0 = x + 20;
            puzzleRects = [];
            ctx.textBaseline = "middle";
            for (let i = 0; i < n; i++) {
                const bx = bx0 + i * (bw + gap);
                puzzleRects.push({ idx: i, x: bx, y: by, w: bw, h: bh });
                let fill = "#2a3350", edge = "rgba(255,255,255,0.16)";
                if (puzzle.done) {
                    if (puzzle.choices[i] === puzzle.answer) { fill = "#1f7a48"; edge = "#39d98a"; }
                    else if (i === puzzle.picked) { fill = "#7a2230"; edge = "#ff5d6c"; }
                }
                ctx.fillStyle = fill;
                roundRect(bx, by, bw, bh, 12); ctx.fill();
                ctx.strokeStyle = edge; ctx.lineWidth = 2; ctx.stroke();
                ctx.fillStyle = "#fff";
                ctx.font = "800 26px system-ui, sans-serif";
                ctx.fillText(puzzle.choices[i], bx + bw / 2, by + bh / 2 + 1);
            }

            if (puzzle.done) {
                const ok = puzzle.choices[puzzle.picked] === puzzle.answer;
                ctx.fillStyle = ok ? "#39d98a" : "#ff8a92";
                ctx.font = "800 16px system-ui, sans-serif";
                ctx.textBaseline = "alphabetic";
                const msg = ok ? "\u2764\uFE0F Heart repaired!"
                    : (puzzle.fatal ? "\u{1F480} City overrun! It starts with " + puzzle.answer + "."
                        : "It starts with " + puzzle.answer + ".");
                ctx.fillText(msg, x + cw / 2, y + ch - 18);
            }
        }

        function drawIntro() {
            ctx.fillStyle = "rgba(6,8,18,0.55)";
            ctx.fillRect(0, 0, W, H);
            ctx.textAlign = "center";
            ctx.fillStyle = "#f2f3ff";
            ctx.font = "900 30px system-ui, sans-serif";
            ctx.fillText("LETTER SIEGE", W / 2, H * 0.34);
            ctx.fillStyle = "rgba(242,243,255,0.92)";
            ctx.font = "600 16px system-ui, sans-serif";
            ctx.fillText("A giant robot is attacking the city!", W / 2, H * 0.34 + 34);
            ctx.fillStyle = "rgba(154,160,195,0.95)";
            ctx.font = "500 14px system-ui, sans-serif";
            ctx.fillText("Tap the called-out letter to blast it back.", W / 2, H * 0.34 + 60);
            ctx.fillText("Miss, and it smashes a building \u2014 you lose a heart.", W / 2, H * 0.34 + 82);
            ctx.fillText("Empty its health bar to defeat each monster!", W / 2, H * 0.34 + 104);
            ctx.fillStyle = "#ffd166";
            ctx.font = "800 18px system-ui, sans-serif";
            ctx.fillText("Tap to defend!", W / 2, H * 0.34 + 142);
        }

        function drawBossBar() {
            if (mode === "intro" || mode === "over") return;
            if (mode === "interlude" && interlude &&
                interlude.stage !== "rise") return;   // no bar while arena is empty
            const bw = Math.min(200, W * 0.46), bh = 11;
            const bx = (W - bw) / 2, by = 94;   // sits just under the target-letter card
            const frac = bossMaxHP > 0 ? bossHP / bossMaxHP : 0;
            const name = bossType === "slime" ? "\u{1F7E2} GOO BLOB" : "\u{1F916} MEGA-BOT";
            ctx.save();
            ctx.fillStyle = "rgba(8,10,20,0.7)";
            roundRect(bx - 4, by - 4, bw + 8, bh + 8, 7); ctx.fill();
            ctx.fillStyle = "rgba(255,255,255,0.14)";
            roundRect(bx, by, bw, bh, 6); ctx.fill();
            ctx.fillStyle = frac > 0.5 ? "#ff5d6c" : (frac > 0.25 ? "#ff8a3c" : "#ffd166");
            roundRect(bx, by, bw * frac, bh, 6); ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 1.5;
            roundRect(bx, by, bw, bh, 6); ctx.stroke();
            ctx.fillStyle = "#f2f3ff";
            ctx.font = "800 11px system-ui, sans-serif";
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText(name + "  Lv " + (bossLevel + 1), W / 2, by + bh + 9);
            ctx.restore();
        }

        function drawInterludeOverlay() {
            if (!interlude) return;
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            if (interlude.stage === "reward") {
                ctx.fillStyle = "#ffd166";
                ctx.font = "900 26px system-ui, sans-serif";
                ctx.fillText(interlude.reward === "fireworks"
                    ? "\u{1F386} CITY SAVED! \u{1F386}"
                    : "\u{1F477} REBUILDING\u2026", W / 2, H * 0.3);
            } else if (interlude.stage === "warn") {
                // Pulsing warning icon as the next monster approaches.
                const blink = Math.sin(interlude.t * 12) > 0;
                ctx.save();
                ctx.globalAlpha = blink ? 1 : 0.35;
                ctx.fillStyle = "#ff5d6c";
                ctx.font = "900 64px system-ui, sans-serif";
                ctx.fillText("\u26A0\uFE0F", W / 2, H * 0.32);
                ctx.globalAlpha = 1;
                ctx.fillStyle = "#ff8a92";
                ctx.font = "900 22px system-ui, sans-serif";
                ctx.fillText("INCOMING!", W / 2, H * 0.32 + 56);
                ctx.restore();
            }
        }

        function draw() {
            // screen shake
            let shx = 0, shy = 0;
            if (shakeT > 0) {
                const m = shakeMag * (shakeT / 0.5);
                shx = (Math.random() * 2 - 1) * m;
                shy = (Math.random() * 2 - 1) * m;
            }
            ctx.save();
            ctx.translate(shx, shy);

            drawSky();
            drawSearchlights();
            drawBoss();
            drawFog();
            drawCity();
            drawBeams();
            drawForcefield();
            drawWeather();

            ctx.restore(); // end shake for crisp HUD

            drawHearts();
            drawBossBar();
            if (mode === "siege") drawSiegeHUD();
            if (mode === "intro") drawIntro();
            if (mode === "command") drawCommandPanel();
            if (mode === "interlude") drawInterludeOverlay();

            // heal flash vignette
            if (healFlash > 0) {
                ctx.fillStyle = "rgba(57,217,138," + (healFlash * 0.3) + ")";
                ctx.fillRect(0, 0, W, H);
            }

            // commander encouragement banner (loudspeaker callout)
            if (commanderT > 0 && commanderText) {
                const a = Math.min(1, commanderT / 0.4);
                ctx.save();
                ctx.globalAlpha = a;
                ctx.textAlign = "center"; ctx.textBaseline = "middle";
                ctx.font = "900 22px system-ui, sans-serif";
                const tw = ctx.measureText(commanderText).width + 44;
                const bx = W / 2 - tw / 2, by = H * 0.16;
                const g = ctx.createLinearGradient(0, by, 0, by + 44);
                g.addColorStop(0, "#1f7a48"); g.addColorStop(1, "#13502f");
                ctx.fillStyle = g;
                roundRect(bx, by, tw, 44, 14); ctx.fill();
                ctx.strokeStyle = "#39d98a"; ctx.lineWidth = 2; ctx.stroke();
                ctx.fillStyle = "#eafff3";
                ctx.fillText("\u{1F4E3} " + commanderText, W / 2, by + 23);
                ctx.restore();
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

        /* ---------- input ---------- */
        function pointFromEvent(e) {
            const rect = canvas.getBoundingClientRect();
            const src = e.changedTouches ? e.changedTouches[0] : e;
            return { x: src.clientX - rect.left, y: src.clientY - rect.top };
        }

        function inside(r, x, y) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

        function onDown(e) {
            e.preventDefault();
            const p = pointFromEvent(e);
            SGSound.unlock();
            primeSpeech();

            if (mode === "intro") {
                newRound();
                return;
            }
            if (mode === "over") return;
            if (mode === "interlude") return;

            if (mode === "command") {
                if (puzzle && !puzzle.done) {
                    for (const r of puzzleRects) {
                        if (inside(r, p.x, p.y)) { resolveCommand(r.idx); return; }
                    }
                }
                return;
            }

            // siege
            if (phase !== "answer") return;
            if (ccBtn && commandAvailable() && inside(ccBtn, p.x, p.y)) {
                openCommand();
                return;
            }
            for (const r of siegeRects) {
                if (inside(r, p.x, p.y)) {
                    if (r.ch.toUpperCase() === target.toUpperCase()) onCorrect(r.idx);
                    else robotAttacks(r.idx);
                    return;
                }
            }
        }

        return {
            start() {
                resize();
                reset();
                window.addEventListener("resize", resize);
                canvas.addEventListener("touchstart", onDown, { passive: false });
                canvas.addEventListener("touchend", retrySpeechFromGesture, { passive: false });
                canvas.addEventListener("mousedown", onDown);
                rafId = requestAnimationFrame(loop);
            },
            restart() {
                reset();
            },
            destroy() {
                cancelAnimationFrame(rafId);
                window.removeEventListener("resize", resize);
                canvas.removeEventListener("touchstart", onDown);
                canvas.removeEventListener("touchend", retrySpeechFromGesture);
                canvas.removeEventListener("mousedown", onDown);
            }
        };
    }

    window.SGGames = window.SGGames || {};
    window.SGGames.lettersiege = {
        id: "lettersiege",
        name: "Letter Siege",
        emoji: "\u{1F916}",
        tag: "Spot the letter to blast the robot and save the city!",
        scoreLabel: "defenses",
        create: create
    };
})();
