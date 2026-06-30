/* ============ Deep Digger — mine, loot, upgrade ============
   A pocket roguelike: dig downward through dirt and rock, grab treasure,
   then climb back to the surface to sell your haul and buy better gear
   from the shopkeeper. Better gear lets you dig deeper for richer loot.

   Controls
     - Swipe in any of the 8 directions to dig & move that way. Swipe (or
       hold) diagonally up — e.g. up-and-right — to move or mine diagonally
       upward, climbing a dug staircase. Hold and drag to keep digging.
     - Gravity pulls you down off ledges, so for taller straight-up climbs
       place ladders: tap the 🪜 button (or press Space). Buy more at the shop.
     - Place a box with the 📦 button (or press Q). Boxes land in front of
       you, or beneath you if blocked. Mine them to get them back.
     - WASD or arrow keys move & dig; hold up + a side key for a diagonal.
     - The shop opens automatically when you climb back to the surface; tap
       the shop (or press the SHOP button) to open it any time at the top.
   ========================================================= */
(function () {
    "use strict";

    const COLS = 18;                // mine width (wide world, camera scrolls horizontally)
    const SURFACE_Y = 0;            // walkable ground row; y>0 is underground
    const SKY_ROWS = 2;            // rows of sky drawn above the surface

    // Topsoil: the band just below the surface is always plain dirt (no rock
    // or hazards) so the starting pickaxe can reach all of it. It is seeded
    // with a guaranteed loot budget, so a player who clears it can always
    // afford the first pickaxe (and then mine the rock beneath).
    const TOPSOIL = 6;              // rows 1..TOPSOIL are guaranteed dirt
    const STARTER_LOOT = 120;       // coins guaranteed reachable before any upgrade

    // Tile kinds. `hard` = dig power required to break it.
    const T = {
        EMPTY: 0,   // dug out / air
        DIRT: 1,    // hard 1
        ROCK: 2,    // hard 2
        DENSE: 3,   // hard 3
        OBSID: 4,   // hard 4
        HAZARD: 5,  // gas pocket — hurts when dug
        LADDER: 6,  // placed by the player; the only way to climb up
        BOX: 7,     // crate placed by the player; solid, minable to recover
        BEDROCK: 9  // walls at the edges, never breakable
    };

    const HARD = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 1, 7: 1 };

    // Base mining time per tile type (ms) using the starting (level-1) pickaxe.
    // Each pickaxe upgrade shaves time off; see digTimeFor().
    const DIG_MS = {
        [T.DIRT]: 500,
        [T.ROCK]: 800,
        [T.DENSE]: 1100,
        [T.OBSID]: 1500,
        [T.HAZARD]: 300,
        [T.BOX]: 350
    };

    // Treasure tiers carried inside a dug tile.
    const LOOT = {
        none: 0,
        coin: 3,
        gold: 9,
        gem: 22,
        diamond: 60
    };

    // Brief pause (ms) after stepping into open space before a mine can start,
    // so breaking into a cavern doesn't instantly chew the far wall — and the
    // player gets a beat to change direction (e.g. swing into a diagonal climb).
    const ENTER_DELAY_MS = 160;

    function create(host) {
        const canvas = host.canvas;
        const ctx = canvas.getContext("2d");
        const kids = !!host.kids;

        let cell, topPad;
        let viewRows, viewCols;
        let camX, camY;   // camera in world-column / world-row (fractional)
        let rafId;
        let facing = 1;   // last horizontal direction: 1=right, -1=left
        // offX / offY are pixel offsets; computed per-draw from camX/camY
        function offX() { return canvas.clientWidth / 2 - (camX + 0.5) * cell; }

        // World: sparse map of "x,y" -> { type, hard, loot }
        const world = new Map();
        let player, stats, carry, banked, depthBest, mode, shopRects, msg, msgT, ladders, boxes;
        let mining = null;        // tile being broken: { x, y, dx, dy, t, required }
        let heldDir = null;       // direction held (swipe-drag / key) for chained digging
        const heldKeys = new Set(); // movement keys currently down, for 8-way (diagonal) input
        let prevY = 0;            // player.y on the previous onEnter, to detect surfacing
        let dead = false;         // true after a game over
        let lastTs = 0;           // last frame timestamp (ms) for real-time mining
        let flash = 0;            // damage flash timer
        let moveLock = 0;         // ms before a mine may start after stepping into open space
        let particles = [];
        const noLadderMsg = "No ladders! Buy more at the shop";

        // ----- Surface scene animation state -----
        let surfaceAnimT = 0;       // running time (seconds) for surface animations
        let clouds = [];            // { x, y, w, speed, alpha }
        let bird = null;            // { x, y, vy, phase, active, cooldown }
        let butterfly = null;       // { x, y, angle, wobble, active, cooldown }

        // ----- Upgradeable stats -----
        function baseStats() {
            return {
                dig: 1,             // dig power (breaks HARD <= dig)
                digLvl: 0,
                lamp: 0,            // light radius levels
                bagLvl: 0,
                stamLvl: 0,
                hpLvl: 0,
                hp: 3,              // current hp
                stam: 20            // current stamina
            };
        }

        function maxHP() { return 3 + stats.hpLvl; }
        function maxStam() { return (kids ? 28 : 20) + stats.stamLvl * 10; }
        function bagCap() { return 30 + stats.bagLvl * 30; }
        function lampR() { return 2.4 + stats.lamp * 0.8; }

        // Shop catalogue. cost() reads current level so prices scale.
        const SHOP = [
            {
                key: "dig", name: "Pickaxe", emoji: "⛏️",
                desc: () => "Break tier-" + (stats.dig + 1) + " rock",
                max: 3, lvl: () => stats.digLvl,
                cost: () => [25, 40, 100][stats.digLvl],
                buy: () => { stats.digLvl++; stats.dig++; }
            },
            {
                key: "lamp", name: "Lantern", emoji: "\u{1F3EE}",
                desc: () => "See further underground",
                max: 4, lvl: () => stats.lamp,
                cost: () => [25, 25, 25, 50][stats.lamp],
                buy: () => { stats.lamp++; }
            },
            {
                key: "stam", name: "Battery", emoji: "\u{1F50B}",
                desc: () => "+10 max stamina",
                max: 4, lvl: () => stats.stamLvl,
                cost: () => [30, 30, 50, 70][stats.stamLvl],
                buy: () => { stats.stamLvl++; }
            },
            {
                key: "bag", name: "Big Bag", emoji: "\u{1F392}",
                desc: () => "+30 carry capacity",
                max: 4, lvl: () => stats.bagLvl,
                cost: () => [30, 85, 180, 340][stats.bagLvl],
                buy: () => { stats.bagLvl++; }
            },
            {
                key: "hp", name: "Armor", emoji: "\u{1F6E1}️",
                desc: () => "+1 max heart",
                max: 4, lvl: () => stats.hpLvl,
                cost: () => [50, 120, 250, 450][stats.hpLvl],
                buy: () => { stats.hpLvl++; }
            },
            {
                key: "ladder", name: "Ladders", emoji: "\u{1FA9C}",
                desc: () => "+5 ladders (you have " + ladders + ")",
                consumable: true,
                cost: () => 20,
                buy: () => { ladders += 5; }
            },
            {
                key: "box", name: "Box", emoji: "\u{1F4E6}",
                desc: () => "Solid crate, mine to recover (have " + boxes + ")",
                consumable: true,
                cost: () => 10,
                buy: () => { boxes += 1; }
            }
        ];

        // ---------- World generation ----------
        function key(x, y) { return x + "," + y; }

        function genTile(x, y) {
            if (x < 0 || x >= COLS) return { type: T.BEDROCK, hard: 99, loot: 0 };
            if (y <= SURFACE_Y) return { type: T.EMPTY, hard: 0, loot: 0 };
            // Topsoil is plain dirt; seedTopsoil() fills in its guaranteed loot.
            if (y <= TOPSOIL) return { type: T.DIRT, hard: 1, loot: 0 };

            const depth = y;
            const r = Math.random();

            // Hazard (gas) chance grows with depth.
            const hazChance = Math.min(0.12, 0.02 + depth * 0.004);
            if (r < hazChance) return { type: T.HAZARD, hard: 1, loot: 0 };

            // Rock hardness distribution shifts down with depth.
            let type = T.DIRT;
            const rr = Math.random();
            if (depth > 22 && rr < 0.22) type = T.OBSID;
            else if (depth > 12 && rr < 0.40) type = T.DENSE;
            else if (depth > 4 && rr < 0.52) type = T.ROCK;
            else if (rr < 0.30) type = T.ROCK;

            // Treasure embedded in the tile, richer & likelier deeper.
            let loot = 0;
            const tChance = Math.min(0.32, 0.08 + depth * 0.006);
            if (Math.random() < tChance) {
                const t = Math.random();
                if (depth > 24 && t < 0.06) loot = LOOT.diamond;
                else if (depth > 14 && t < 0.16) loot = LOOT.gem;
                else if (depth > 6 && t < 0.40) loot = LOOT.gold;
                else loot = LOOT.coin;
            }
            return { type: type, hard: HARD[type] || 1, loot: loot };
        }

        function tileAt(x, y) {
            const k = key(x, y);
            let t = world.get(k);
            if (!t) { t = genTile(x, y); world.set(k, t); }
            return t;
        }

        // Lay the topsoil as plain dirt and scatter a guaranteed loot budget
        // across it, so the accessible (dig-1) dirt always holds enough coins
        // to buy the first pickaxe — the gate that unlocks mining rock.
        function seedTopsoil() {
            const cells = [];
            for (let y = 1; y <= TOPSOIL; y++) {
                for (let x = 0; x < COLS; x++) {
                    world.set(key(x, y), { type: T.DIRT, hard: 1, loot: 0 });
                    cells.push({ x: x, y: y });
                }
            }
            // Fisher–Yates shuffle so loot lands in random tiles each run.
            for (let i = cells.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const tmp = cells[i]; cells[i] = cells[j]; cells[j] = tmp;
            }
            // Hand out the budget in coin/gold chunks across distinct tiles.
            let budget = STARTER_LOOT, ci = 0;
            while (budget > 0 && ci < cells.length) {
                const c = cells[ci++];
                const val = (budget >= LOOT.gold && Math.random() < 0.4) ? LOOT.gold : LOOT.coin;
                world.get(key(c.x, c.y)).loot = val;
                budget -= val;
            }
        }

        // ---------- Sizing ----------
        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = canvas.clientWidth * dpr;
            canvas.height = canvas.clientHeight * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const W = canvas.clientWidth;
            const H = canvas.clientHeight;
            topPad = 64;                       // HUD band
            // Size cells so ~9 columns are visible at a time, world scrolls horizontally
            cell = Math.floor(W / 9);
            viewCols = Math.ceil(W / cell) + 2;
            viewRows = Math.ceil((H - topPad) / cell) + 2;
        }

        // ---------- Game state ----------
        function reset() {
            world.clear();
            seedTopsoil();
            stats = baseStats();
            player = { x: Math.floor(COLS / 2), y: SURFACE_Y };
            carry = 0;
            banked = 0;
            depthBest = 0;
            mode = "play";          // "play" | "shop"
            shopRects = [];
            msg = "Swipe to dig! ⬇️";
            msgT = 240;
            particles = [];
            camX = player.x;
            camY = 0;
            mining = null;
            heldDir = null;
            moveLock = 0;
            heldKeys.clear();
            prevY = SURFACE_Y;
            dead = false;
            lastTs = 0;
            ladders = kids ? 10 : 5;
            boxes = kids ? 5 : 1;
            facing = 1;
            host.setScore(0);

            // Surface scene animation init
            surfaceAnimT = 0;
            const W = canvas.clientWidth;
            clouds = [];
            for (let i = 0; i < 4; i++) {
                clouds.push({
                    x: Math.random() * W * 1.4,
                    y: topPad + 10 + Math.random() * 30,
                    w: 60 + Math.random() * 70,
                    speed: 8 + Math.random() * 10,
                    alpha: 0.55 + Math.random() * 0.3
                });
            }
            bird = { x: -80, y: topPad + 18, vy: 0, phase: 0, active: false, cooldown: 8 + Math.random() * 20 };
            butterfly = { x: 0, y: 0, angle: 0, wobble: 0, active: false, cooldown: 15 + Math.random() * 30 };
        }

        function setMsg(text, frames) { msg = text; msgT = frames || 150; }

        function spawnParticles(px, py, color, n) {
            for (let i = 0; i < n; i++) {
                particles.push({
                    x: px, y: py,
                    vx: (Math.random() - 0.5) * 3,
                    vy: -Math.random() * 3 - 1,
                    life: 26 + Math.random() * 14,
                    color: color
                });
            }
        }

        // ---------- Actions ----------
        // Mining time for a tile: base time minus 200ms per pickaxe level,
        // floored so it never gets instant. Kids Mode digs a little faster.
        // e.g. dirt = 500ms with the level-1 pickaxe, 300ms with level 2.
        function digTimeFor(type) {
            let ms = (DIG_MS[type] || 500) - stats.digLvl * 200;
            if (kids) ms *= 0.8;
            return Math.max(120, ms);
        }

        // A directional input (a swipe step or held keys). Diagonals are allowed
        // (e.g. up+right). Walking is instant; a solid tile starts a timed mine.
        function requestDig(dx, dy) {
            if (mode !== "play" || dead) return;
            if (dx === 0 && dy === 0) return;
            if (dx !== 0) facing = dx;
            heldDir = { dx: dx, dy: dy };
            if (!mining || mining.dx !== dx || mining.dy !== dy) beginStep(dx, dy);
        }

        // Is the tile at (x, y) something the miner can stand in / pass through?
        function isOpen(x, y) {
            if (x < 0 || x >= COLS) return false;
            const t = tileAt(x, y);
            return t.type === T.EMPTY || t.type === T.LADDER;
        }

        // Diagonal moves are gated so the miner never squeezes through a solid
        // corner (a teleport through the wall). Climbing diagonally needs
        // headroom — the tile directly above the player must be open — while
        // dropping diagonally needs the tile directly above the target open, so
        // the miner slides into it instead of cutting across the sealed corner.
        function diagClear(dx, dy) {
            if (dx === 0 || dy === 0) return true;   // not a diagonal
            if (dy < 0) return isOpen(player.x, player.y + dy);   // up: tile above the player
            return isOpen(player.x + dx, player.y);              // down: tile above the target
        }

        function beginStep(dx, dy) {
            mining = null;
            const nx = player.x + dx, ny = player.y + dy;
            if (nx < 0 || nx >= COLS) return;
            if (ny < SURFACE_Y) return;             // can't go up into the sky

            if (ny <= SURFACE_Y) {                  // step out onto the surface
                player.x = nx; player.y = ny;
                onEnter(nx, ny);
                return;
            }

            const t = tileAt(nx, ny);

            // Straight up into an already-dug ceiling: instead of bobbing up and
            // falling straight back, reach up and mine the block two above the
            // head — carving headroom for ladders or a staircase. Skipped while
            // climbing a ladder so ascending still works.
            if (dx === 0 && dy === -1 && t.type === T.EMPTY &&
                tileAt(player.x, player.y).type !== T.LADDER) {
                const ry = ny - 1;                  // two rows above the head
                if (ry > SURFACE_Y && !isOpen(nx, ry)) tryStartMine(nx, ry, 0, -1);
                return;
            }

            // Diagonal blocked by the corner rule (climbing needs the tile above
            // the player open; descending needs the tile above the target open):
            // don't squeeze through the corner. Dig the vertical neighbour first
            // — the headroom directly above the head when climbing (which is the
            // very tile the climb rule needs cleared, so the next held step takes
            // the now-open diagonal), or straight down when descending. Pass the
            // diagonal dx/dy so the held-dig guard keeps matching and a wiggling
            // finger doesn't restart the dig.
            if (dx !== 0 && dy !== 0 && !diagClear(dx, dy)) {
                tryStartMine(player.x, ny, dx, dy);
                return;
            }

            if (t.type === T.EMPTY || t.type === T.LADDER) {
                // Walk (any direction, including diagonally up) through dug space
                // and ladders; the sealed-corner case above has already been
                // handled, so any diagonal reaching here has room to pass.
                // Gravity then pulls us down if we stepped into air.
                player.x = nx; player.y = ny;
                onEnter(nx, ny);
                settle();
                // Pause mining briefly so running into open space doesn't
                // instantly chew the next tile — and leaves a beat to turn.
                moveLock = ENTER_DELAY_MS;
                return;
            }

            // Solid tile → start chipping it (mines diagonally up too).
            tryStartMine(nx, ny, dx, dy);
        }

        // Shared guard + mine starter for solid tiles. Refuses (with feedback)
        // on bedrock, no stamina, or rock harder than the current pickaxe.
        function tryStartMine(nx, ny, dx, dy) {
            if (moveLock > 0) return;   // just stepped into open space — wait a beat
            const t = tileAt(nx, ny);
            if (t.type === T.BEDROCK) { SGSound.play("wrong"); return; }
            if (stats.stam <= 0) {
                setMsg("Out of stamina — head up! ↑", 120);
                SGSound.play("wrong"); host.vibrate(20);
                return;
            }
            if (HARD[t.type] > stats.dig && t.type !== T.HAZARD) {
                setMsg("Rock too hard — upgrade pickaxe", 120);
                SGSound.play("wrong"); host.vibrate([20, 30, 20]);
                spawnParticles(cx(nx), cyRow(ny), "#6b7280", 4);
                return;
            }
            // Start chipping away; update() finishes it after `required` ms.
            mining = { x: nx, y: ny, dx: dx, dy: dy, t: 0, required: digTimeFor(t.type) };
        }

        // Gravity: if the miner is in open air (not on a ladder, nothing solid
        // below), drop straight down until something catches them.
        function settle() {
            let fell = 0;
            while (player.y > SURFACE_Y &&
                tileAt(player.x, player.y).type !== T.LADDER &&
                tileAt(player.x, player.y + 1).type === T.EMPTY) {
                player.y++;
                fell++;
            }
            if (fell > 0) {
                onEnter(player.x, player.y);
                if (fell >= 2) {
                    SGSound.play("drop");
                    host.vibrate(12);
                    spawnParticles(cx(player.x), cyRow(player.y), "#7a4a28", 6);
                }
            }
        }

        // Place a ladder to build a climb path. It drops into the first empty
        // tile above the player, skipping over any ladders already stacked
        // there — so on a ladder it extends straight up. Errors if there's no
        // open slot (solid ceiling or already at the surface).
        function placeLadder() {
            if (mode !== "play" || dead) return;
            if (ladders <= 0) {
                if (msg !== noLadderMsg || msgT <= 0) SGSound.play("wrong");
                setMsg(noLadderMsg, 110); host.vibrate(20);
                return;
            }
            const tx = player.x;
            let ty = player.y - 1;
            while (ty > SURFACE_Y && tileAt(tx, ty).type === T.LADDER) ty--;
            if (ty <= SURFACE_Y || tileAt(tx, ty).type !== T.EMPTY) {
                SGSound.play("wrong"); host.vibrate([20, 30, 20]);
                setMsg("No room for a ladder", 100);
                return;
            }
            world.set(key(tx, ty), { type: T.LADDER, hard: 0, loot: 0 });
            ladders--;
            SGSound.play("flip"); host.vibrate(12);
            spawnParticles(cx(tx), cyRow(ty), "#caa15a", 6);
            setMsg("Ladder placed \u{1FA9C} (×" + ladders + ")", 70);
        }

        // Place a crate in front of the player (same row, facing direction).
        // Falls back to placing at the player's tile and moving them on top.
        const noBoxMsg = "No boxes! Buy more at the shop";
        function placeBox() {
            if (mode !== "play" || dead) return;
            if (boxes <= 0) {
                SGSound.play("wrong"); host.vibrate(20);
                setMsg(noBoxMsg, 110);
                return;
            }
            const frontX = player.x + facing;
            const frontY = player.y;

            if (frontX >= 0 && frontX < COLS && tileAt(frontX, frontY).type === T.EMPTY) {
                // Primary: place in front of player
                world.set(key(frontX, frontY), { type: T.BOX, hard: 1, loot: 0 });
                boxes--;
                SGSound.play("drop"); host.vibrate(12);
                spawnParticles(cx(frontX), cyRow(frontY), "#8b5e2a", 6);
                setMsg("Box placed \u{1F4E6} (×" + boxes + ")", 70);
            } else {
                // Fallback: place at player's current tile and step up on top
                const aboveY = player.y - 1;
                if (aboveY > SURFACE_Y && tileAt(player.x, aboveY).type === T.EMPTY) {
                    world.set(key(player.x, player.y), { type: T.BOX, hard: 1, loot: 0 });
                    player.y = aboveY;  // step onto the box
                    boxes--;
                    SGSound.play("drop"); host.vibrate(12);
                    spawnParticles(cx(player.x), cyRow(player.y + 1), "#8b5e2a", 6);
                    setMsg("Box placed below \u{1F4E6} (×" + boxes + ")", 70);
                } else {
                    SGSound.play("wrong"); host.vibrate([20, 30, 20]);
                    setMsg("No room for a box", 100);
                }
            }
        }

        function breakTile(x, y, t) {
            stats.stam--;
            const cxp = cx(x), cyp = cyRow(y);
            // Step into the tile we broke, except when it was straight overhead —
            // you don't rise into a dug ceiling. Diagonally-up counts as a step,
            // so you can climb a staircase; gravity (settle) pulls you back if
            // there's no footing under the new tile.
            const sdx = x - player.x, sdy = y - player.y;
            let movesInto = !(sdx === 0 && sdy < 0);
            // Refuse to slide into a diagonal block when the corner rule isn't
            // met (no headroom above when climbing, or no opening above the
            // target when descending) — that would teleport the miner through a
            // wall corner. They still break the block, just don't move into it.
            if (movesInto && sdx !== 0 && sdy !== 0 && !diagClear(sdx, sdy)) {
                movesInto = false;
            }

            // Box: recover to inventory instead of discarding
            if (t.type === T.BOX) {
                world.set(key(x, y), { type: T.EMPTY, hard: 0, loot: 0 });
                boxes++;
                SGSound.play("drop"); host.vibrate(10);
                spawnParticles(cxp, cyp, "#8b5e2a", 6);
                if (movesInto) { player.x = x; player.y = y; }
                setMsg("Box recovered \u{1F4E6} (\u00d7" + boxes + ")", 90);
                onEnter(player.x, player.y);
                if (movesInto) settle();
                return;
            }

            if (t.type === T.HAZARD) {
                world.set(key(x, y), { type: T.EMPTY, hard: 0, loot: 0 });
                spawnParticles(cxp, cyp, "#7CFF9E", 14);
                if (movesInto) { player.x = x; player.y = y; }
                damage(1, "Gas pocket! −❤️");
                return;
            }

            const loot = t.loot;
            world.set(key(x, y), { type: T.EMPTY, hard: 0, loot: 0 });
            SGSound.play("drop");
            host.vibrate(10);
            spawnParticles(cxp, cyp, tileColor(t.type), 6);
            if (movesInto) { player.x = x; player.y = y; }

            if (loot > 0) collect(loot, cxp, cyp);
            onEnter(player.x, player.y);
            if (movesInto) settle();
        }

        function collect(value, px, py) {
            const space = bagCap() - carry;
            if (space <= 0) {
                setMsg("Bag full! Sell at the surface", 120);
                SGSound.play("wrong");
                return;
            }
            const got = Math.min(value, space);
            carry += got;
            const label = value >= LOOT.diamond ? "\u{1F48E} Diamond!" :
                value >= LOOT.gem ? "\u{1F537} Gem!" :
                value >= LOOT.gold ? "Gold!" : "Coins";
            setMsg("+" + got + " — " + label, 90);
            SGSound.play(value >= LOOT.gem ? "perfect" : "eat");
            host.vibrate(value >= LOOT.gem ? [15, 30, 30] : 12);
            spawnParticles(px, py, "#ffd35a", value >= LOOT.gem ? 16 : 8);
        }

        function onEnter(x, y) {
            if (y > depthBest) depthBest = y;
            if (y <= SURFACE_Y) {
                const cameUpFromBelow = prevY > SURFACE_Y;
                arriveSurface();
                // Pop the shop open automatically when we climb back up.
                if (cameUpFromBelow && mode === "play" && !dead) openShop();
            }
            prevY = y;
        }

        function arriveSurface() {
            // Cash in the haul and refill.
            if (carry > 0) {
                banked += carry;
                setMsg("Sold haul: +" + carry + " coins \u{1F4B0}", 150);
                SGSound.play("score");
                host.vibrate([10, 20, 10]);
                carry = 0;
                host.setScore(banked);
            }
            if (stats.hp < maxHP() || stats.stam < maxStam()) {
                stats.hp = maxHP();
                stats.stam = maxStam();
            }
        }

        function damage(n, text) {
            stats.hp -= n;
            flash = 14;
            setMsg(text || "Ouch!", 110);
            SGSound.play("hit");
            host.vibrate([30, 40, 40]);
            if (stats.hp <= 0) collapse();
        }

        function collapse() {
            // Out of hearts — game over. Banked coins are the final score.
            dead = true;
            mining = null;
            heldDir = null;
            carry = 0;
            SGSound.play("gameover");
            host.vibrate([60, 40, 80, 40, 120]);
            setMsg("Out of hearts!", 200);
            host.gameOver(banked);
        }

        // ---------- Shop ----------
        function openShop() {
            if (player.y !== SURFACE_Y) { setMsg("Return to the surface to shop", 90); return; }
            mode = "shop";
            SGSound.play("tap");
        }
        function closeShop() { mode = "play"; SGSound.play("tap"); }

        function buy(item) {
            if (!item.consumable && item.lvl() >= item.max) { SGSound.play("wrong"); return; }
            const cost = item.cost();
            if (banked < cost) { setMsg("Not enough coins", 80); SGSound.play("wrong"); return; }
            banked -= cost;
            item.buy();
            if (!item.consumable) {
                // Refill to new maxima so upgrades feel immediate.
                stats.hp = maxHP();
                stats.stam = maxStam();
            }
            host.setScore(banked);
            SGSound.play("match");
            host.vibrate(20);
            setMsg(item.name + (item.consumable ? " bought!" : " upgraded!"), 90);
        }

        // ---------- Coordinate helpers ----------
        function cx(col) { return offX() + col * cell + cell / 2; }
        function cyRow(row) { return topPad + (row - camY) * cell + cell / 2; }

        // ---------- Drawing ----------
        function tileColor(type) {
            switch (type) {
                case T.DIRT: return "#7a4a28";
                case T.ROCK: return "#6b6f76";
                case T.DENSE: return "#4a5560";
                case T.OBSID: return "#2b2438";
                case T.HAZARD: return "#3a7d4a";
                case T.LADDER: return "#caa15a";
                case T.BOX: return "#8b5e2a";
                case T.BEDROCK: return "#15151f";
                default: return "#1c1320";
            }
        }

        function update(dt) {
            // Advance an in-progress mine; finish it once enough time passes.
            if (mining && !dead && mode === "play") {
                const t = tileAt(mining.x, mining.y);
                if (t.type === T.EMPTY || stats.stam <= 0) {
                    mining = null;                  // tile gone or no stamina left
                } else {
                    mining.t += dt * 1000;
                    if (Math.random() < dt * 14) {
                        spawnParticles(cx(mining.x), cyRow(mining.y), tileColor(t.type), 2);
                    }
                    if (mining.t >= mining.required) {
                        breakTile(mining.x, mining.y, t);
                        mining = null;
                        // Keep digging while a direction is held down.
                        if (!dead && heldDir) beginStep(heldDir.dx, heldDir.dy);
                    }
                }
            }

            // Camera eases toward keeping the miner centred horizontally and a bit above centre vertically.
            const targetCamX = player.x;
            const halfView = canvas.clientWidth / (2 * cell) - 0.5;
            const minCamX = halfView;
            const maxCamX = COLS - halfView - 1;
            camX += (Math.max(minCamX, Math.min(maxCamX, targetCamX)) - camX) * 0.14;
            const targetCam = player.y - Math.floor((viewRows - 2) * 0.42);
            camY += (Math.max(SURFACE_Y - SKY_ROWS, targetCam) - camY) * 0.18;

            if (flash > 0) flash--;
            if (msgT > 0) msgT--;
            if (moveLock > 0) moveLock -= dt * 1000;

            for (let i = particles.length - 1; i >= 0; i--) {
                const p = particles[i];
                p.x += p.vx; p.y += p.vy; p.vy += 0.25; p.life--;
                if (p.life <= 0) particles.splice(i, 1);
            }

            // Surface scene: advance clouds, bird, butterfly every frame
            surfaceAnimT += dt;
            const W2 = canvas.clientWidth;
            for (const c of clouds) {
                c.x += c.speed * dt;
                if (c.x - c.w > W2) c.x = -c.w * 1.5;
            }
            // Bird: rare flyover, left to right
            if (bird.active) {
                bird.x += 90 * dt;
                bird.phase += dt * 6;
                bird.y += Math.sin(bird.phase) * 0.4;
                if (bird.x > W2 + 60) { bird.active = false; bird.cooldown = 12 + Math.random() * 25; }
            } else {
                bird.cooldown -= dt;
                if (bird.cooldown <= 0) {
                    bird.active = true;
                    bird.x = -60;
                    bird.y = topPad + 12 + Math.random() * 22;
                    bird.phase = 0;
                }
            }
            // Butterfly: rare hover near surface
            if (butterfly.active) {
                butterfly.angle += dt * 1.4;
                butterfly.wobble += dt * 3.5;
                butterfly.x += Math.cos(butterfly.angle) * 18 * dt;
                butterfly.y += Math.sin(butterfly.wobble) * 14 * dt;
                butterfly.life -= dt;
                // Keep in horizontal bounds (clamp to world pixel extents)
                const _ox = offX();
                if (butterfly.x < _ox) butterfly.x = _ox + 4;
                if (butterfly.x > _ox + COLS * cell - 4) butterfly.x = _ox + COLS * cell - 4;
                if (butterfly.life <= 0) { butterfly.active = false; butterfly.cooldown = 20 + Math.random() * 40; }
            } else {
                butterfly.cooldown -= dt;
                if (butterfly.cooldown <= 0) {
                    butterfly.active = true;
                    butterfly.x = offX() + (0.1 + Math.random() * 0.8) * COLS * cell;
                    butterfly.y = topPad + (SURFACE_Y - camY) * cell - cell * 1.8;
                    butterfly.angle = Math.random() * Math.PI * 2;
                    butterfly.wobble = 0;
                    butterfly.life = 6 + Math.random() * 5;
                }
            }
        }

        function draw() {
            const W = canvas.clientWidth, H = canvas.clientHeight;
            ctx.clearRect(0, 0, W, H);

            const ox = offX(); // pixel left-edge of col 0 this frame
            const startRow = Math.floor(camY) - 1;
            const endRow = startRow + viewRows + 2;
            const startCol = Math.floor(camX - viewCols / 2) - 1;
            const endCol = startCol + viewCols + 2;
            const lr = lampR();
            const pcx = cx(player.x), pcy = cyRow(player.y);

            // Sky pre-pass: full sky backdrop rendered once before tile loop
            const groundY = topPad + (SURFACE_Y - camY) * cell;
            if (groundY > topPad) {
                drawSkyScene(W, topPad, groundY - topPad);
            }

            for (let row = startRow; row <= endRow; row++) {
                for (let col = startCol; col <= endCol; col++) {
                    const x = ox + col * cell;
                    const y = topPad + (row - camY) * cell;

                    if (row < SURFACE_Y) {
                        // Sky handled by pre-pass above — skip tile fill
                        continue;
                    }
                    if (row === SURFACE_Y) {
                        if (col < 0 || col >= COLS) continue;
                        ctx.fillStyle = "#3f8a45";   // grass
                        ctx.fillRect(x, y, cell + 1, cell + 1);
                        ctx.fillStyle = "#357a3c";
                        ctx.fillRect(x, y, cell + 1, cell * 0.28);
                        continue;
                    }

                    const t = tileAt(col, row);

                    // Distance-based lighting.
                    const dx = col - player.x, dy = row - player.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    let light = 1 - (dist - lr) / 2.2;
                    light = Math.max(0.08, Math.min(1, light));

                    if (t.type === T.EMPTY) {
                        ctx.fillStyle = shade("#1c1320", light);
                        ctx.fillRect(x, y, cell + 1, cell + 1);
                    } else if (t.type === T.LADDER) {
                        drawLadderTile(x, y, light);
                    } else if (t.type === T.BOX) {
                        drawBoxTile(x, y, light);
                    } else {
                        ctx.fillStyle = shade(tileColor(t.type), light);
                        ctx.fillRect(x, y, cell + 1, cell + 1);
                        // texture speckle
                        if (light > 0.25 && t.type !== T.BEDROCK) {
                            ctx.fillStyle = shade("#000000", 1 - light * 0.5);
                            ctx.globalAlpha = 0.12;
                            ctx.fillRect(x + cell * 0.18, y + cell * 0.2, cell * 0.16, cell * 0.16);
                            ctx.fillRect(x + cell * 0.6, y + cell * 0.55, cell * 0.14, cell * 0.14);
                            ctx.globalAlpha = 1;
                        }
                        // Treasure glint (only when lit).
                        if (t.loot > 0 && light > 0.35) {
                            drawGem(x + cell / 2, y + cell / 2, t.loot, light);
                        }
                        // Hazard bubbles.
                        if (t.type === T.HAZARD && light > 0.25) {
                            ctx.fillStyle = shade("#9affb4", light);
                            ctx.globalAlpha = 0.8;
                            ctx.beginPath();
                            ctx.arc(x + cell * 0.4, y + cell * 0.45, cell * 0.1, 0, 7);
                            ctx.arc(x + cell * 0.62, y + cell * 0.62, cell * 0.07, 0, 7);
                            ctx.fill();
                            ctx.globalAlpha = 1;
                        }
                    }
                }
            }

            // Mining progress overlay on the tile being broken.
            if (mining) {
                const mx = offX() + mining.x * cell;
                const my = topPad + (mining.y - camY) * cell;
                const prog = Math.min(1, mining.t / mining.required);
                ctx.fillStyle = "rgba(0,0,0,0.32)";
                ctx.fillRect(mx, my, cell + 1, cell + 1);
                const bw = cell * 0.7, bx = mx + (cell - bw) / 2;
                const bh = cell * 0.12, by = my + cell * 0.78;
                ctx.fillStyle = "rgba(0,0,0,0.55)";
                ctx.fillRect(bx, by, bw, bh);
                ctx.fillStyle = "#ffd35a";
                ctx.fillRect(bx, by, bw * prog, bh);
            }

            // Surface scenery: rare creatures, only while the sky is on-screen
            // (never underground — the bird stays up by the shop).
            if (groundY > topPad) drawSurfaceCreatures();

            // Shop building on the surface (top-right corner of the mine).
            drawShopBuilding();

            // Particles
            for (const p of particles) {
                ctx.globalAlpha = Math.max(0, p.life / 36);
                ctx.fillStyle = p.color;
                ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
            }
            ctx.globalAlpha = 1;

            // Player (miner)
            drawMiner(pcx, pcy);

            // Vignette under HUD
            ctx.fillStyle = "#12121f";
            ctx.fillRect(0, 0, W, topPad);

            drawHUD();
            drawLadderButton();
            drawBoxButton();

            if (flash > 0) {
                ctx.fillStyle = "rgba(255,60,60," + (flash / 14) * 0.35 + ")";
                ctx.fillRect(0, topPad, W, H - topPad);
            }

            if (mode === "shop") drawShop();
        }

        // ========== Surface scene drawing helpers ==========

        // Full sky backdrop: gradient, mountains, clouds
        function drawSkyScene(W, top, skyH) {
            // Sky gradient — dawn-to-noon blue
            const grad = ctx.createLinearGradient(0, top, 0, top + skyH);
            grad.addColorStop(0, "#1a2355");
            grad.addColorStop(0.45, "#3a6bb5");
            grad.addColorStop(1, "#6fb3e0");
            ctx.fillStyle = grad;
            ctx.fillRect(0, top, W, skyH);

            // Far mountain range (muted blue-grey)
            drawMtnRange(0, top + skyH, W, skyH * 0.55, "#4a6080", 7, 0.42);
            // Near mountain range (darker greens)
            drawMtnRange(0, top + skyH, W, skyH * 0.32, "#2f4a2f", 5, 0.68);

            // Clouds
            for (const c of clouds) {
                drawCloud(c.x, c.y, c.w, c.alpha);
            }
        }

        // Procedural mountain silhouette using a seeded pseudo-random ridge
        function drawMtnRange(left, baseY, width, maxH, color, peaks, seed) {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(left, baseY);
            const step = width / (peaks * 2);
            let x = left;
            // Simple deterministic peaks using sine combination
            for (let i = 0; i <= peaks * 2; i++) {
                const t2 = i / (peaks * 2);
                const h = maxH * (0.3 + 0.7 * Math.abs(Math.sin(t2 * Math.PI * peaks + seed * 3.7)) *
                    (0.6 + 0.4 * Math.sin(t2 * Math.PI * (peaks + 1) + seed)));
                ctx.lineTo(x, baseY - h);
                x += step;
            }
            ctx.lineTo(left + width, baseY);
            ctx.closePath();
            ctx.fill();
        }

        // Fluffy cloud made of overlapping circles
        function drawCloud(cx2, cy2, w, alpha) {
            ctx.globalAlpha = alpha;
            ctx.fillStyle = "#e8f0ff";
            const h = w * 0.38;
            const puffs = [
                { dx: 0, dy: 0, r: h * 0.7 },
                { dx: w * 0.22, dy: -h * 0.1, r: h * 0.85 },
                { dx: w * 0.46, dy: h * 0.02, r: h * 0.75 },
                { dx: w * 0.68, dy: -h * 0.05, r: h * 0.65 },
                { dx: w * 0.88, dy: h * 0.08, r: h * 0.5 }
            ];
            for (const p of puffs) {
                ctx.beginPath();
                ctx.arc(cx2 + p.dx, cy2 + p.dy, p.r, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
        }

        // Draw rare bird and butterfly when active
        function drawSurfaceCreatures() {
            if (bird.active) drawBird(bird.x, bird.y, bird.phase);
            if (butterfly.active) drawButterfly(butterfly.x, butterfly.y, surfaceAnimT);
        }

        // Simple V-wing bird silhouette
        function drawBird(bx, by, phase) {
            const flap = Math.sin(phase) * 0.4;       // 0..0.4 wing dip
            ctx.fillStyle = "#1a1a3a";
            ctx.strokeStyle = "#1a1a3a";
            ctx.lineWidth = 2;
            ctx.lineCap = "round";
            ctx.beginPath();
            // Left wing
            ctx.moveTo(bx, by);
            ctx.quadraticCurveTo(bx - 11, by - 8 + flap * 14, bx - 20, by + 3 + flap * 10);
            // Right wing
            ctx.moveTo(bx, by);
            ctx.quadraticCurveTo(bx + 11, by - 8 + flap * 14, bx + 20, by + 3 + flap * 10);
            ctx.stroke();
            // Body dot
            ctx.beginPath();
            ctx.arc(bx, by, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }

        // Delicate butterfly with colourful wings
        function drawButterfly(bx2, by2, t2) {
            const flap = Math.sin(t2 * 9) * 0.5 + 0.5; // 0..1
            const wingW = cell * 0.28;
            const wingH = cell * 0.22;
            ctx.save();
            ctx.translate(bx2, by2);
            // Upper wings (bright orange/yellow)
            const upper = [
                { sx: -1, color: "#ff9020" },
                { sx: 1, color: "#ff9020" }
            ];
            for (const w of upper) {
                ctx.save();
                ctx.scale(w.sx, 1);
                ctx.fillStyle = w.color;
                ctx.globalAlpha = 0.92;
                ctx.beginPath();
                ctx.ellipse(wingW * (0.3 + flap * 0.4), -wingH * 0.4, wingW * (0.9 - flap * 0.3), wingH * 0.7, -0.3, 0, Math.PI * 2);
                ctx.fill();
                // Wing dot
                ctx.fillStyle = "#1a0a00";
                ctx.globalAlpha = 0.6;
                ctx.beginPath();
                ctx.ellipse(wingW * (0.55 + flap * 0.25), -wingH * 0.3, wingW * 0.16, wingH * 0.18, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
            // Lower wings (smaller, slightly blue-tipped)
            for (const w of upper) {
                ctx.save();
                ctx.scale(w.sx, 1);
                ctx.fillStyle = "#ffcc00";
                ctx.globalAlpha = 0.85;
                ctx.beginPath();
                ctx.ellipse(wingW * (0.25 + flap * 0.3), wingH * 0.5, wingW * 0.55, wingH * 0.45, 0.2, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
            // Body
            ctx.globalAlpha = 1;
            ctx.fillStyle = "#1a0a00";
            ctx.beginPath();
            ctx.ellipse(0, 0, 2, 7, 0, 0, Math.PI * 2);
            ctx.fill();
            // Antennae
            ctx.strokeStyle = "#1a0a00";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(-1, -6); ctx.lineTo(-5, -13);
            ctx.moveTo(1, -6); ctx.lineTo(5, -13);
            ctx.stroke();
            ctx.restore();
        }

        // ====================================================

        function drawGem(cxp, cyp, loot, light) {
            let color = "#ffd35a";
            if (loot >= LOOT.diamond) color = "#9be8ff";
            else if (loot >= LOOT.gem) color = "#5ad1ff";
            else if (loot >= LOOT.gold) color = "#ffcf3f";
            ctx.fillStyle = shade(color, light);
            ctx.beginPath();
            const r = cell * (loot >= LOOT.gem ? 0.22 : 0.16);
            ctx.moveTo(cxp, cyp - r);
            ctx.lineTo(cxp + r, cyp);
            ctx.lineTo(cxp, cyp + r);
            ctx.lineTo(cxp - r, cyp);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = "rgba(255,255,255,0.7)";
            ctx.fillRect(cxp - r * 0.2, cyp - r * 0.5, r * 0.3, r * 0.5);
        }

        function drawLadderTile(x, y, light) {
            // Dug-out background, then a wooden ladder over it.
            ctx.fillStyle = shade("#1c1320", light);
            ctx.fillRect(x, y, cell + 1, cell + 1);
            ctx.fillStyle = shade("#caa15a", Math.max(0.5, light));
            const railW = Math.max(2, cell * 0.08);
            const lx = x + cell * 0.26, rx = x + cell * 0.64;
            ctx.fillRect(lx, y, railW, cell + 1);
            ctx.fillRect(rx, y, railW, cell + 1);
            for (let i = 0; i < 3; i++) {
                const ry = y + cell * (0.18 + i * 0.32);
                ctx.fillRect(lx, ry, (rx - lx) + railW, railW);
            }
        }

        function drawBoxTile(x, y, light) {
            // Solid wooden crate with cross-brace and metal corner brackets.
            ctx.fillStyle = shade("#8b5e2a", light);
            ctx.fillRect(x, y, cell + 1, cell + 1);
            // Outer border
            const brd = Math.max(1.5, cell * 0.07);
            ctx.fillStyle = shade("#5a3010", Math.max(0.4, light));
            ctx.fillRect(x, y, cell + 1, brd);              // top
            ctx.fillRect(x, y + cell - brd, cell + 1, brd); // bottom
            ctx.fillRect(x, y, brd, cell + 1);              // left
            ctx.fillRect(x + cell - brd, y, brd, cell + 1); // right
            // Mid-slats
            ctx.fillStyle = shade("#6b3f1a", Math.max(0.45, light));
            const sl = Math.max(1, cell * 0.055);
            ctx.fillRect(x, y + cell / 2 - sl / 2, cell + 1, sl); // horizontal
            ctx.fillRect(x + cell / 2 - sl / 2, y, sl, cell + 1); // vertical
            // Metal corner brackets
            const cs = cell * 0.18;
            ctx.fillStyle = shade("#8a8a9a", Math.max(0.5, light));
            ctx.fillRect(x + 1, y + 1, cs, cs);
            ctx.fillRect(x + cell - cs, y + 1, cs, cs);
            ctx.fillRect(x + 1, y + cell - cs, cs, cs);
            ctx.fillRect(x + cell - cs, y + cell - cs, cs, cs);
        }

        function drawMiner(px, py) {
            const r = cell * 0.34;
            // body
            ctx.fillStyle = "#3b7bd6";
            roundRect(px - r, py - r * 0.2, r * 2, r * 1.5, r * 0.4);
            // head
            ctx.fillStyle = "#f0c08a";
            ctx.beginPath();
            ctx.arc(px, py - r * 0.5, r * 0.7, 0, 7);
            ctx.fill();
            // helmet
            ctx.fillStyle = "#ffcf3f";
            ctx.beginPath();
            ctx.arc(px, py - r * 0.7, r * 0.72, Math.PI, 0);
            ctx.fill();
            ctx.fillRect(px - r * 0.72, py - r * 0.72, r * 1.44, r * 0.18);
            // headlamp glow
            ctx.fillStyle = "rgba(255,240,180,0.9)";
            ctx.beginPath();
            ctx.arc(px, py - r * 0.95, r * 0.16, 0, 7);
            ctx.fill();
        }

        let shopBtnRect = null;
        function drawShopBuilding() {
            // The shop spans 2 columns wide and sits on the surface row.
            // Anchor: right edge of the mine grid, bottom = surface ground line.
            const groundY = topPad + (SURFACE_Y - camY) * cell;
            const shopW = cell * 2.1;
            const shopH = cell * 2.4;
            const sx = offX() + COLS * cell - shopW;   // left edge
            const sy = groundY - shopH;               // top edge

            // --- Foundation / stone wall ---
            ctx.fillStyle = "#5a5060";
            ctx.fillRect(sx, sy + shopH * 0.38, shopW, shopH * 0.62);

            // Stone bricks texture
            ctx.fillStyle = "#4a4055";
            const brickH = shopH * 0.10;
            const brickW = shopW * 0.32;
            for (let row = 0; row < 5; row++) {
                const by2 = sy + shopH * 0.38 + row * brickH;
                const offset = (row % 2 === 0) ? 0 : brickW * 0.5;
                for (let col = 0; col < 4; col++) {
                    ctx.strokeStyle = "#3a3048";
                    ctx.lineWidth = 1;
                    ctx.strokeRect(sx + offset + col * brickW + 1, by2 + 1, brickW - 2, brickH - 2);
                }
            }

            // --- Roof (pitched, tiled) ---
            const roofBaseY = sy + shopH * 0.38;
            const roofPeakY = sy;
            ctx.fillStyle = "#8b2a1e";
            ctx.beginPath();
            ctx.moveTo(sx - cell * 0.1, roofBaseY);
            ctx.lineTo(sx + shopW / 2, roofPeakY);
            ctx.lineTo(sx + shopW + cell * 0.1, roofBaseY);
            ctx.closePath();
            ctx.fill();
            // Shingle lines
            ctx.strokeStyle = "#6b1e14";
            ctx.lineWidth = 1.5;
            const shingleRows = 5;
            for (let sr = 1; sr <= shingleRows; sr++) {
                const t2 = sr / (shingleRows + 1);
                const lx = sx + (shopW / 2) * t2 - cell * 0.1 * (1 - t2);
                const rx = sx + shopW - (shopW / 2) * t2 + cell * 0.1 * (1 - t2);
                const ry = roofPeakY + (roofBaseY - roofPeakY) * t2;
                ctx.beginPath(); ctx.moveTo(lx, ry); ctx.lineTo(rx, ry); ctx.stroke();
            }
            // Roof ridge cap
            ctx.fillStyle = "#c0392b";
            ctx.fillRect(sx + shopW / 2 - 4, roofPeakY - 3, 8, 12);

            // --- Chimney (left side) ---
            const chimneyX = sx + shopW * 0.18;
            const chimneyW = shopW * 0.13;
            ctx.fillStyle = "#4a3838";
            ctx.fillRect(chimneyX, sy - cell * 0.35, chimneyW, shopH * 0.3 + cell * 0.35);
            ctx.fillStyle = "#3a2828";
            ctx.fillRect(chimneyX - 3, sy - cell * 0.35, chimneyW + 6, chimneyW * 0.4);
            // Smoke puffs
            const smokeT = surfaceAnimT * 0.7;
            for (let s = 0; s < 3; s++) {
                const sf2 = ((smokeT + s * 0.55) % 1.65) / 1.65;
                const sAlpha = Math.max(0, 0.5 - sf2 * 0.5);
                const sY = sy - cell * 0.35 - sf2 * cell * 0.8;
                const sX = chimneyX + chimneyW / 2 + Math.sin(smokeT + s) * 4;
                const sR = 3 + sf2 * 7;
                ctx.globalAlpha = sAlpha;
                ctx.fillStyle = "#c8b8a8";
                ctx.beginPath();
                ctx.arc(sX, sY, sR, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;

            // --- Awning (striped canvas, over the door) ---
            const awningX = sx + shopW * 0.18;
            const awningW = shopW * 0.64;
            const awningY = sy + shopH * 0.53;
            const awningH2 = shopH * 0.10;
            // Awning shape
            ctx.fillStyle = "#c0392b";
            ctx.beginPath();
            ctx.moveTo(awningX, awningY);
            ctx.lineTo(awningX + awningW, awningY);
            ctx.lineTo(awningX + awningW + 6, awningY + awningH2);
            ctx.lineTo(awningX - 6, awningY + awningH2);
            ctx.closePath();
            ctx.fill();
            // Awning stripes
            ctx.fillStyle = "#f0ede0";
            const stripeW = awningW / 7;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(awningX, awningY);
            ctx.lineTo(awningX + awningW, awningY);
            ctx.lineTo(awningX + awningW + 6, awningY + awningH2);
            ctx.lineTo(awningX - 6, awningY + awningH2);
            ctx.closePath();
            ctx.clip();
            for (let i = 0; i < 7; i += 2) {
                ctx.fillRect(awningX + i * stripeW, awningY, stripeW, awningH2 * 2);
            }
            ctx.restore();

            // --- Door (arched, dark wood) ---
            const doorW = shopW * 0.28;
            const doorH = shopH * 0.35;
            const doorX = sx + (shopW - doorW) / 2;
            const doorY = groundY - doorH;
            ctx.fillStyle = "#4a2e12";
            ctx.beginPath();
            ctx.moveTo(doorX, groundY);
            ctx.lineTo(doorX, doorY + doorW / 2);
            ctx.arc(doorX + doorW / 2, doorY + doorW / 2, doorW / 2, Math.PI, 0, false);
            ctx.lineTo(doorX + doorW, groundY);
            ctx.closePath();
            ctx.fill();
            // Door planks
            ctx.strokeStyle = "#3a1e08";
            ctx.lineWidth = 1.5;
            for (let p = 1; p < 3; p++) {
                ctx.beginPath();
                ctx.moveTo(doorX + p * doorW / 3, doorY + doorW * 0.7);
                ctx.lineTo(doorX + p * doorW / 3, groundY);
                ctx.stroke();
            }
            // Door knob
            ctx.fillStyle = "#ffd35a";
            ctx.beginPath();
            ctx.arc(doorX + doorW * 0.72, doorY + doorH * 0.62, 3, 0, Math.PI * 2);
            ctx.fill();

            // --- Window (left of door) ---
            const winX = sx + shopW * 0.10;
            const winY = sy + shopH * 0.50;
            const winW = shopW * 0.22;
            const winH = shopH * 0.20;
            // Frame
            ctx.fillStyle = "#6b3a1a";
            ctx.fillRect(winX, winY, winW, winH);
            // Glass panes
            ctx.fillStyle = "rgba(160,210,255,0.55)";
            ctx.fillRect(winX + 3, winY + 3, winW / 2 - 4, winH - 6);
            ctx.fillRect(winX + winW / 2 + 1, winY + 3, winW / 2 - 4, winH - 6);
            // Cross divider
            ctx.fillStyle = "#6b3a1a";
            ctx.fillRect(winX + winW / 2 - 1.5, winY, 3, winH);
            ctx.fillRect(winX, winY + winH / 2 - 1.5, winW, 3);
            // Shutters
            ctx.fillStyle = "#3f8a45";
            ctx.fillRect(winX - winW * 0.22, winY, winW * 0.18, winH);
            ctx.fillRect(winX + winW + winW * 0.04, winY, winW * 0.18, winH);
            // Shutter slats
            ctx.strokeStyle = "#2e6a34";
            ctx.lineWidth = 1;
            for (let sl = 1; sl < 4; sl++) {
                const sly = winY + sl * winH / 4;
                ctx.beginPath(); ctx.moveTo(winX - winW * 0.22, sly); ctx.lineTo(winX - winW * 0.04, sly); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(winX + winW + winW * 0.04, sly); ctx.lineTo(winX + winW + winW * 0.22, sly); ctx.stroke();
            }

            // --- Hanging sign ---
            const signW = shopW * 0.55;
            const signH = shopH * 0.14;
            const signX = sx + (shopW - signW) / 2;
            const signY = sy + shopH * 0.04;
            // Chains
            ctx.strokeStyle = "#a08040";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(signX + signW * 0.2, roofBaseY); ctx.lineTo(signX + signW * 0.2, signY);
            ctx.moveTo(signX + signW * 0.8, roofBaseY); ctx.lineTo(signX + signW * 0.8, signY);
            ctx.stroke();
            // Sign board
            ctx.fillStyle = "#8b5e2a";
            roundRect(signX, signY, signW, signH, 4);
            ctx.fillStyle = "#f0c060";
            ctx.strokeStyle = "#a07030";
            ctx.lineWidth = 2;
            ctx.strokeRect(signX + 3, signY + 3, signW - 6, signH - 6);
            ctx.textAlign = "center";
            ctx.font = "700 " + Math.floor(signH * 0.62) + "px system-ui, sans-serif";
            ctx.fillStyle = "#1a0a00";
            ctx.fillText("🛒 SHOP", signX + signW / 2, signY + signH * 0.72);

            // --- Lanterns either side of door ---
            for (const lx of [doorX - 10, doorX + doorW + 6]) {
                const lanternY = awningY + awningH2 + 4;
                // Pole
                ctx.strokeStyle = "#5a4020";
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(lx + 4, lanternY); ctx.lineTo(lx + 4, lanternY + 14); ctx.stroke();
                // Glow
                const glow = ctx.createRadialGradient(lx + 4, lanternY + 8, 1, lx + 4, lanternY + 8, 10);
                glow.addColorStop(0, "rgba(255,230,100,0.7)");
                glow.addColorStop(1, "rgba(255,180,40,0)");
                ctx.fillStyle = glow;
                ctx.beginPath(); ctx.arc(lx + 4, lanternY + 8, 10, 0, Math.PI * 2); ctx.fill();
                // Cage
                ctx.fillStyle = "#ffd35a";
                ctx.fillRect(lx, lanternY + 2, 8, 10);
                ctx.strokeStyle = "#a08000";
                ctx.lineWidth = 1;
                ctx.strokeRect(lx, lanternY + 2, 8, 10);
                ctx.beginPath(); ctx.moveTo(lx + 4, lanternY + 2); ctx.lineTo(lx + 4, lanternY + 12); ctx.stroke();
            }

            // --- Merchandise cart (left of shop) ---
            const cartX = sx - cell * 0.95;
            const cartY = groundY - cell * 0.62;
            const cartW = cell * 0.80;
            const cartH = cell * 0.48;
            // Cart body
            ctx.fillStyle = "#7a4a1a";
            ctx.fillRect(cartX, cartY, cartW, cartH);
            ctx.strokeStyle = "#5a3010";
            ctx.lineWidth = 2;
            ctx.strokeRect(cartX, cartY, cartW, cartH);
            // Cart slats
            ctx.lineWidth = 1;
            for (let s = 1; s < 3; s++) {
                ctx.beginPath();
                ctx.moveTo(cartX + s * cartW / 3, cartY);
                ctx.lineTo(cartX + s * cartW / 3, cartY + cartH);
                ctx.stroke();
            }
            // Wheels
            for (const wx of [cartX + cartW * 0.22, cartX + cartW * 0.78]) {
                ctx.fillStyle = "#5a3010";
                ctx.beginPath(); ctx.arc(wx, groundY, cartH * 0.42, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = "#8b5a2a";
                ctx.beginPath(); ctx.arc(wx, groundY, cartH * 0.25, 0, Math.PI * 2); ctx.fill();
                // Spokes
                ctx.strokeStyle = "#5a3010";
                ctx.lineWidth = 1.5;
                for (let sp = 0; sp < 4; sp++) {
                    const ang = sp * Math.PI / 2;
                    ctx.beginPath();
                    ctx.moveTo(wx, groundY);
                    ctx.lineTo(wx + Math.cos(ang) * cartH * 0.25, groundY + Math.sin(ang) * cartH * 0.25);
                    ctx.stroke();
                }
            }
            // Cart contents: gem icons
            ctx.font = Math.floor(cell * 0.22) + "px system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("💎⛏️🥇", cartX + cartW / 2, cartY + cartH * 0.6);

            shopBtnRect = { x: sx - cell * 0.95, y: sy, w: shopW + cell * 0.95, h: shopH + cell * 0.4 };
        }

        function drawHUD() {
            const W = canvas.clientWidth;
            ctx.textAlign = "left";
            ctx.font = "700 15px system-ui, sans-serif";

            // Hearts
            let hx = 12;
            for (let i = 0; i < maxHP(); i++) {
                ctx.fillStyle = i < stats.hp ? "#ff5d6c" : "#46324a";
                heart(hx, 14, 11);
                hx += 22;
            }

            // Stamina bar
            const sbW = 110, sbX = 12, sbY = 34;
            ctx.fillStyle = "#2a2336";
            roundRect(sbX, sbY, sbW, 12, 6);
            ctx.fillStyle = "#5fd0ff";
            const sf = Math.max(0, stats.stam / maxStam());
            roundRect(sbX, sbY, Math.max(6, sbW * sf), 12, 6);
            ctx.fillStyle = "#cfe9ff";
            ctx.font = "600 11px system-ui, sans-serif";
            ctx.fillText("⚡ " + stats.stam, sbX + sbW + 8, sbY + 11);

            // Coins (carry / banked) + depth, right aligned
            ctx.textAlign = "right";
            ctx.font = "700 15px system-ui, sans-serif";
            ctx.fillStyle = "#ffd35a";
            ctx.fillText("\u{1F45C} " + carry + "/" + bagCap(), W - 12, 18);
            ctx.fillStyle = "#9be8ff";
            ctx.fillText("\u{1F4B0} " + banked, W - 12, 38);
            ctx.fillStyle = "#b9b9d6";
            ctx.font = "600 12px system-ui, sans-serif";
            ctx.fillText("Depth " + Math.max(0, player.y) + "m", W - 12, 56);

            // SHOP button (only useful at surface, but always visible)
            const atSurface = player.y === SURFACE_Y;
            ctx.textAlign = "center";
            const bw = 64, bh = 26, bx = W / 2 - bw / 2, by = 6;
            ctx.fillStyle = atSurface ? "#3f8a45" : "#2a2336";
            roundRect(bx, by, bw, bh, 8);
            ctx.fillStyle = atSurface ? "#eafff0" : "#6b6b86";
            ctx.font = "700 13px system-ui, sans-serif";
            ctx.fillText("\u{1F6D2} SHOP", W / 2, by + 17);
            hudShopRect = { x: bx, y: 0, w: bw, h: topPad };

            // Message ticker
            if (msgT > 0 && msg) {
                ctx.textAlign = "center";
                ctx.globalAlpha = Math.min(1, msgT / 30);
                ctx.fillStyle = "rgba(18,18,31,0.85)";
                const mw = ctx.measureText(msg).width + 28;
                roundRect(W / 2 - mw / 2, topPad + 8, mw, 26, 8);
                ctx.fillStyle = "#f2f3ff";
                ctx.font = "600 13px system-ui, sans-serif";
                ctx.fillText(msg, W / 2, topPad + 25);
                ctx.globalAlpha = 1;
            }
        }
        let hudShopRect = null;
        let ladderBtnRect = null;
        let boxBtnRect = null;

        function drawLadderButton() {
            const W = canvas.clientWidth, H = canvas.clientHeight;
            const s = 58, m = 16;
            const bx = W - s - m, by = H - s - m;
            ctx.fillStyle = ladders > 0 ? "rgba(36,38,64,0.92)" : "rgba(64,32,42,0.92)";
            roundRect(bx, by, s, s, 14);
            ctx.textAlign = "center";
            ctx.font = Math.floor(s * 0.42) + "px system-ui, sans-serif";
            ctx.fillStyle = ladders > 0 ? "#f2f3ff" : "#8a6a76";
            ctx.fillText("\u{1FA9C}", bx + s / 2, by + s * 0.47);
            ctx.font = "700 13px system-ui, sans-serif";
            ctx.fillStyle = ladders > 0 ? "#ffd35a" : "#8a6a76";
            ctx.fillText("×" + ladders, bx + s / 2, by + s - 8);
            ladderBtnRect = { x: bx, y: by, w: s, h: s };
        }

        function drawBoxButton() {
            const W = canvas.clientWidth, H = canvas.clientHeight;
            const s = 58, m = 16;
            const bx = W - s * 2 - m - 12, by = H - s - m;
            ctx.fillStyle = boxes > 0 ? "rgba(36,38,64,0.92)" : "rgba(64,32,42,0.92)";
            roundRect(bx, by, s, s, 14);
            ctx.textAlign = "center";
            ctx.font = Math.floor(s * 0.42) + "px system-ui, sans-serif";
            ctx.fillStyle = boxes > 0 ? "#f2f3ff" : "#8a6a76";
            ctx.fillText("\u{1F4E6}", bx + s / 2, by + s * 0.47);
            ctx.font = "700 13px system-ui, sans-serif";
            ctx.fillStyle = boxes > 0 ? "#ffd35a" : "#8a6a76";
            ctx.fillText("×" + boxes, bx + s / 2, by + s - 8);
            boxBtnRect = { x: bx, y: by, w: s, h: s };
        }

        function drawShop() {
            const W = canvas.clientWidth, H = canvas.clientHeight;
            ctx.fillStyle = "rgba(10,10,18,0.86)";
            ctx.fillRect(0, 0, W, H);

            const panelW = Math.min(W - 24, 380);
            const px = (W - panelW) / 2;
            let py = Math.max(topPad + 8, H * 0.07);

            ctx.textAlign = "center";
            ctx.fillStyle = "#ffd35a";
            ctx.font = "800 22px system-ui, sans-serif";
            ctx.fillText("\u{1F6D2} Shopkeeper", W / 2, py + 6);
            ctx.fillStyle = "#9be8ff";
            ctx.font = "700 15px system-ui, sans-serif";
            ctx.fillText("\u{1F4B0} " + banked + " coins", W / 2, py + 30);

            py += 52;
            const rowH = 56, gap = 7;
            shopRects = [];

            for (const item of SHOP) {
                const consumable = !!item.consumable;
                const lvl = consumable ? 0 : item.lvl();
                const maxed = !consumable && lvl >= item.max;
                const cost = maxed ? 0 : item.cost();
                const afford = banked >= cost;

                ctx.fillStyle = "#1d1b2e";
                roundRect(px, py, panelW, rowH, 12);

                // icon
                ctx.textAlign = "left";
                ctx.font = "26px system-ui, sans-serif";
                ctx.fillText(item.emoji, px + 14, py + rowH / 2 + 9);

                // name + desc + level pips
                ctx.fillStyle = "#f2f3ff";
                ctx.font = "700 15px system-ui, sans-serif";
                ctx.fillText(item.name, px + 52, py + 22);
                ctx.fillStyle = "#a8a8c8";
                ctx.font = "500 12px system-ui, sans-serif";
                ctx.fillText(item.desc(), px + 52, py + 40);
                // level pips (upgrades only)
                if (!consumable) {
                    for (let i = 0; i < item.max; i++) {
                        ctx.fillStyle = i < lvl ? "#5fd0ff" : "#3a3550";
                        ctx.fillRect(px + 52 + i * 12, py + 48, 8, 5);
                    }
                }

                // buy button
                const btw = 78, bth = 38, btx = px + panelW - btw - 12, bty = py + (rowH - bth) / 2;
                ctx.fillStyle = maxed ? "#2a2336" : (afford ? "#3f8a45" : "#5a2330");
                roundRect(btx, bty, btw, bth, 9);
                ctx.textAlign = "center";
                ctx.fillStyle = maxed ? "#7a7a96" : "#ffffff";
                ctx.font = "700 13px system-ui, sans-serif";
                if (maxed) {
                    ctx.fillText("MAX", btx + btw / 2, bty + 23);
                } else {
                    ctx.fillText("\u{1F4B0}" + cost, btx + btw / 2, bty + 23);
                }
                if (!maxed) shopRects.push({ x: btx, y: bty, w: btw, h: bth, item: item });

                py += rowH + gap;
            }

            // Close button
            const cbw = 160, cbh = 42, cbx = W / 2 - cbw / 2;
            const cby = Math.min(H - cbh - 14, py + 6);
            ctx.fillStyle = "#3b7bd6";
            roundRect(cbx, cby, cbw, cbh, 10);
            ctx.fillStyle = "#fff";
            ctx.font = "700 15px system-ui, sans-serif";
            ctx.textBaseline = "middle";
            ctx.fillText("⛏️ Back to digging", W / 2, cby + cbh / 2);
            ctx.textBaseline = "alphabetic";
            shopCloseRect = { x: cbx, y: cby, w: cbw, h: cbh };
        }
        let shopCloseRect = null;

        // ---------- Canvas helpers ----------
        function shade(hex, f) {
            const n = parseInt(hex.slice(1), 16);
            const r = Math.round(((n >> 16) & 255) * f);
            const g = Math.round(((n >> 8) & 255) * f);
            const b = Math.round((n & 255) * f);
            return "rgb(" + r + "," + g + "," + b + ")";
        }
        function roundRect(x, y, w, h, r) {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.arcTo(x + w, y, x + w, y + h, r);
            ctx.arcTo(x + w, y + h, x, y + h, r);
            ctx.arcTo(x, y + h, x, y, r);
            ctx.arcTo(x, y, x + w, y, r);
            ctx.fill();
        }
        function heart(x, y, s) {
            ctx.beginPath();
            ctx.moveTo(x + s / 2, y + s * 0.85);
            ctx.bezierCurveTo(x - s * 0.1, y + s * 0.4, x + s * 0.1, y - s * 0.1, x + s / 2, y + s * 0.3);
            ctx.bezierCurveTo(x + s * 0.9, y - s * 0.1, x + s * 1.1, y + s * 0.4, x + s / 2, y + s * 0.85);
            ctx.fill();
        }

        // ---------- Input ----------
        function hit(rect, mx, my) {
            return rect && mx >= rect.x && mx <= rect.x + rect.w && my >= rect.y && my <= rect.y + rect.h;
        }

        // Returns true if a tap at (mx,my) hit a UI control and was handled.
        function uiTapAt(mx, my) {
            if (mode === "shop") {
                if (hit(shopCloseRect, mx, my)) { closeShop(); return true; }
                for (const r of shopRects) {
                    if (hit(r, mx, my)) { buy(r.item); return true; }
                }
                return true;   // swallow taps anywhere on the shop overlay
            }
            if (hit(ladderBtnRect, mx, my)) { placeLadder(); return true; }
            if (hit(boxBtnRect, mx, my)) { placeBox(); return true; }
            if (hit(hudShopRect, mx, my)) { openShop(); return true; }
            if (hit(shopBtnRect, mx, my) && player.y <= SURFACE_Y) { openShop(); return true; }
            if (my < topPad) return true;   // ignore the HUD band
            return false;
        }

        let drag = null;   // active swipe-to-dig gesture anchor, or null

        function eventPos(e) {
            const rect = canvas.getBoundingClientRect();
            const pt = (e.touches && e.touches[0]) ||
                (e.changedTouches && e.changedTouches[0]) || e;
            return { mx: pt.clientX - rect.left, my: pt.clientY - rect.top };
        }

        function onPointerDown(e) {
            const p = eventPos(e);
            if (e.cancelable) e.preventDefault();
            if (uiTapAt(p.mx, p.my)) { drag = null; return; }
            drag = { x: p.mx, y: p.my };   // begin a swipe gesture
        }

        function onPointerMove(e) {
            if (!drag) return;
            const p = eventPos(e);
            if (e.cancelable) e.preventDefault();
            const dx = p.mx - drag.x, dy = p.my - drag.y;
            const thresh = Math.max(12, cell * 0.4);
            if (Math.abs(dx) < thresh && Math.abs(dy) < thresh) return;
            // 8-direction: include each axis that clears the threshold, and also
            // the lesser axis if the swipe is roughly diagonal, so up-and-side
            // swipes move/mine diagonally upward.
            let sx = Math.abs(dx) >= thresh ? Math.sign(dx) : 0;
            let sy = Math.abs(dy) >= thresh ? Math.sign(dy) : 0;
            if (sx !== 0 && sy === 0 && Math.abs(dy) >= Math.abs(dx) * 0.5) sy = Math.sign(dy);
            if (sy !== 0 && sx === 0 && Math.abs(dx) >= Math.abs(dy) * 0.5) sx = Math.sign(dx);
            requestDig(sx, sy);
            // Re-anchor so a held drag keeps digging tile by tile.
            drag = { x: p.mx, y: p.my };
        }

        function onPointerUp() { drag = null; heldDir = null; }

        // Map a movement key to its axis vector, or null if it isn't one.
        function keyVec(key) {
            switch (key) {
                case "ArrowUp": case "w": case "W": return [0, -1];
                case "ArrowDown": case "s": case "S": return [0, 1];
                case "ArrowLeft": case "a": case "A": return [-1, 0];
                case "ArrowRight": case "d": case "D": return [1, 0];
                default: return null;
            }
        }

        // Combine all held movement keys into one (possibly diagonal) direction.
        function heldVec() {
            let dx = 0, dy = 0;
            for (const k of heldKeys) {
                const v = keyVec(k);
                if (!v) continue;
                dx += v[0]; dy += v[1];
            }
            return { dx: Math.sign(dx), dy: Math.sign(dy) };
        }

        function onKey(e) {
            if (dead) return;
            if (mode === "shop") {
                if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); closeShop(); }
                const idx = parseInt(e.key, 10);
                if (idx >= 1 && idx <= SHOP.length) { e.preventDefault(); buy(SHOP[idx - 1]); }
                return;
            }
            if (e.key === "b" || e.key === "B") { e.preventDefault(); openShop(); return; }
            if (e.key === " " || e.key === "e" || e.key === "E") { e.preventDefault(); placeLadder(); return; }
            if (e.key === "q" || e.key === "Q") { e.preventDefault(); placeBox(); return; }
            if (keyVec(e.key)) {
                e.preventDefault();
                heldKeys.add(e.key);
                const v = heldVec();           // up + side held → diagonal
                requestDig(v.dx, v.dy);
            }
        }

        function onKeyUp(e) {
            if (e && keyVec(e.key)) heldKeys.delete(e.key);
            heldDir = (heldKeys.size > 0) ? heldVec() : null;
        }

        function loop(ts) {
            rafId = requestAnimationFrame(loop);
            if (!lastTs) lastTs = ts;
            const dt = Math.min((ts - lastTs) / 1000, 0.05);
            lastTs = ts;
            update(dt);
            draw();
        }

        return {
            start() {
                resize();
                reset();
                window.addEventListener("resize", resize);
                canvas.addEventListener("touchstart", onPointerDown, { passive: false });
                window.addEventListener("touchmove", onPointerMove, { passive: false });
                window.addEventListener("touchend", onPointerUp);
                window.addEventListener("touchcancel", onPointerUp);
                canvas.addEventListener("mousedown", onPointerDown);
                window.addEventListener("mousemove", onPointerMove);
                window.addEventListener("mouseup", onPointerUp);
                window.addEventListener("keydown", onKey);
                window.addEventListener("keyup", onKeyUp);
                rafId = requestAnimationFrame(loop);
            },
            restart() {
                reset();
            },
            destroy() {
                cancelAnimationFrame(rafId);
                window.removeEventListener("resize", resize);
                canvas.removeEventListener("touchstart", onPointerDown);
                window.removeEventListener("touchmove", onPointerMove);
                window.removeEventListener("touchend", onPointerUp);
                window.removeEventListener("touchcancel", onPointerUp);
                canvas.removeEventListener("mousedown", onPointerDown);
                window.removeEventListener("mousemove", onPointerMove);
                window.removeEventListener("mouseup", onPointerUp);
                window.removeEventListener("keydown", onKey);
                window.removeEventListener("keyup", onKeyUp);
            }
        };
    }

    window.SGGames = window.SGGames || {};
    window.SGGames.digger = {
        id: "digger",
        name: "Deep Digger",
        emoji: "⛏️",
        tag: "Dig for treasure, then upgrade your gear at the shop.",
        scoreLabel: "coins",
        create: create
    };
})();
