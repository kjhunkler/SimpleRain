/* ============ Bug Hunt — same-network multiplayer bug collecting ============ */
/* Needs the Python server (see /server/server.py). The page and the socket
   share a host, so when you open the app FROM the server it connects itself. */
(function () {
    "use strict";

    const PLAYER_SPEED = 200;          // world px / second
    const MOVE_SEND_MS = 60;           // how often we push our position
    const STYLE_ID = "bughunt-style";
    const VIEW_W = 640, VIEW_H = 640;  // world units kept visible (camera zoom)
    const HORIZON = 120;               // world y above this is sky/mountains (keep in sync with server)

    // Hard-coded server location. The server's port is 8765 (see server.py).
    const SERVER_HOST = "192.168.0.12";
    const SERVER_PORT = 8765;

    // Solo (offline) mode mirrors the Python server's gameplay constants and bug
    // species so a lone player gets the same round when no server is reachable.
    const SOLO_SPECIES = [
        ["ladybug", "\u{1F41E}"], ["ant", "\u{1F41C}"], ["honeybee", "\u{1F41D}"],
        ["butterfly", "\u{1F98B}"], ["caterpillar", "\u{1F41B}"], ["snail", "\u{1F40C}"],
        ["spider", "\u{1F577}\uFE0F"], ["scorpion", "\u{1F982}"]
    ];
    const SOLO_SPOT_TYPES = ["log", "tree", "grass"];
    const SOLO_CFG = {
        PLAY_TOP: HORIZON + 14,
        SEARCH_RADIUS: 58, CAPTURE_RADIUS: 78, CAPTURE_TIME: 3.0,
        PROGRESS_DECAY: 1.6, FLEE_TRIGGER: 165, FLEE_SPEED: 95,
        WANDER_SPEED: 28, CORNERED_FACTOR: 0.32,
        TARGETS: 4, EXTRA_BUGS: 4, RESET_SECONDS: 10.0
    };

    const CSS = `
    .bh-hud{position:absolute;inset:0;pointer-events:none;font-family:system-ui,sans-serif;
        color:#f2f3ff;-webkit-user-select:none;user-select:none;touch-action:none;}
    .bh-hud button{font-family:inherit;}
    .bh-top{position:absolute;top:0;left:0;right:0;display:flex;flex-direction:column;gap:6px;
        padding:8px 10px;background:linear-gradient(#0b1411cc,#0b141100);pointer-events:none;}
    .bh-targets{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:13px;font-weight:700;}
    .bh-targets .lbl{opacity:.8;font-weight:600;}
    .bh-chip{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;
        border-radius:9px;background:#ffffff1f;font-size:18px;position:relative;}
    .bh-chip.done{background:#39d98a33;outline:2px solid #39d98a;}
    .bh-chip.next{outline:2px dashed #ffd166;}
    .bh-chip .ord{position:absolute;top:-7px;left:-7px;width:16px;height:16px;border-radius:50%;
        background:#12121f;font-size:10px;line-height:16px;text-align:center;font-weight:800;}
    .bh-inv{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-height:36px;}
    .bh-inv .lbl{opacity:.8;font-size:12px;font-weight:600;}
    .bh-inv button{pointer-events:auto;width:34px;height:34px;border-radius:10px;border:none;
        background:#ffffff26;font-size:20px;cursor:pointer;padding:0;}
    .bh-inv button.target{box-shadow:inset 0 0 0 2px #39d98a;}
    .bh-empty{opacity:.55;font-size:12px;}
    .bh-stick{position:absolute;left:26px;bottom:30px;width:128px;height:128px;border-radius:50%;
        background:radial-gradient(circle at 50% 45%,#ffffff26,#ffffff10 70%,#ffffff05);
        border:2px solid #ffffff33;pointer-events:auto;touch-action:none;
        box-shadow:0 6px 20px #0006;}
    .bh-knob{position:absolute;left:50%;top:50%;width:58px;height:58px;border-radius:50%;
        margin:-29px 0 0 -29px;background:radial-gradient(circle at 40% 35%,#ffffffcc,#9fb0ff 80%);
        box-shadow:0 4px 12px #0007;will-change:transform;}
    .bh-row{display:flex;gap:10px;margin-top:8px;}
    .bh-row .bh-btn{margin-top:0;}
    .bh-ready{position:absolute;right:16px;bottom:24px;pointer-events:auto;border:none;
        padding:14px 20px;border-radius:16px;font-size:16px;font-weight:800;cursor:pointer;
        background:#39d98a;color:#06281a;display:none;}
    .bh-ready.on{background:#ffd166;color:#3a2c00;}
    .bh-center{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
        pointer-events:none;}
    .bh-card{pointer-events:auto;background:#12121fef;border:1px solid #ffffff1f;border-radius:18px;
        padding:22px;width:min(330px,86%);text-align:center;box-shadow:0 18px 50px #000a;}
    .bh-card h2{margin:0 0 6px;font-size:22px;}
    .bh-card p{margin:6px 0 14px;font-size:14px;opacity:.85;line-height:1.4;}
    .bh-errbody{text-align:left;font-size:13px;}
    .bh-errbody p{margin:6px 0;}
    .bh-list{text-align:left;margin:6px 0 12px;padding-left:18px;font-size:13px;opacity:.9;line-height:1.45;}
    .bh-list li{margin:4px 0;}
    .bh-addr{display:block;font-family:ui-monospace,Menlo,Consolas,monospace;background:#0c0c16;
        border:1px solid #ffffff26;border-radius:8px;padding:10px;word-break:break-all;font-size:14px;opacity:1;}
    a.bh-addr,a.bh-link{color:#9fc1ff;text-decoration:underline;cursor:pointer;}
    a.bh-addr{font-weight:700;border-color:#6c7bff66;}
    a.bh-addr:active,a.bh-link:active{color:#fff;}
    .bh-errbody code{background:#ffffff1f;padding:1px 5px;border-radius:5px;font-size:12px;}
    .bh-card input{width:100%;box-sizing:border-box;padding:11px;border-radius:11px;border:1px solid #ffffff33;
        background:#0c0c16;color:#fff;font-size:14px;margin-bottom:12px;}
    .bh-card .field-label{display:block;text-align:left;font-size:12px;opacity:.7;margin:0 0 4px;}
    .bh-btn{display:block;width:100%;border:none;padding:13px;border-radius:13px;font-size:16px;
        font-weight:800;cursor:pointer;background:#6c7bff;color:#fff;margin-top:6px;}
    .bh-btn.alt{background:#ffffff1f;}
    .bh-who{font-size:30px;margin-bottom:6px;}
    .bh-status{position:absolute;top:8px;right:10px;font-size:11px;opacity:.65;pointer-events:none;}
    .bh-hidden{display:none!important;}
    `;

    function defaultWsUrl() {
        // An https page can only use a secure socket (wss); http uses ws.
        // Host/port are hard-coded so it works wherever the page is opened from.
        const scheme = window.location.protocol === "https:" ? "wss" : "ws";
        return scheme + "://" + SERVER_HOST + ":" + SERVER_PORT + "/ws";
    }

    // Tappable links for the error/help cards.
    function addrLink(url) {
        return '<a class="bh-addr bh-link" href="' + url + '" target="_blank" rel="noopener">' + url + "</a>";
    }
    function inlineLink(url) {
        return '<a class="bh-link" href="' + url + '" target="_blank" rel="noopener">' + url + "</a>";
    }

    function create(host) {
        const canvas = host.canvas;
        const ctx = canvas.getContext("2d");
        const stage = canvas.parentElement;

        // Profile comes from the URL (when launched as a standalone page from the
        // menu) or, failing that, from the app's active profile.
        const params = new URLSearchParams(window.location.search);
        const urlName = params.get("name");
        const urlAvatar = params.get("avatar");
        const profile = (window.SGStorage && SGStorage.getActiveProfile()) || null;
        const myName = urlName || (profile ? profile.name : "Player");
        const myAvatar = urlAvatar || (profile ? profile.avatar : "\u{1F642}");

        let W = 0, H = 0, scale = 1, camX = 500, camY = 350, dpr = 1;
        let world = { w: 1000, h: 700 };
        let ws = null, myId = null, connected = false;
        let state = null;                  // latest shared state from server
        let me = { x: 500, y: 350 };       // locally predicted position
        let havePos = false;
        let captureTime = 3.0;

        let prevInvCount = 0;
        let lastWinner = null;
        const keys = { up: false, down: false, left: false, right: false };
        const joy = { active: false, dx: 0, dy: 0, pid: null }; // analog -1..1
        let lastMoveSent = 0, rafId = null, lastTs = 0;
        let promptOpen = false;
        let solo = false, soloSim = null, soloAccum = 0;
        const SOLO_TICK = 1 / 20;   // advance the offline sim at the server's tick rate

        // Decorative scenery, generated once so it stays put frame to frame.
        const tufts = [];
        for (let i = 0; i < 170; i++) {
            tufts.push({
                x: Math.random() * world.w,
                y: HORIZON + 14 + Math.random() * (world.h - HORIZON - 24),
                s: 0.7 + Math.random() * 0.9
            });
        }
        const clouds = [];
        for (let i = 0; i < 5; i++) {
            clouds.push({ x: Math.random(), y: 0.18 + Math.random() * 0.5, s: 0.7 + Math.random(), sp: 5 + Math.random() * 8 });
        }
        const mountains = makeMountains();

        // ---- HUD DOM ----------------------------------------------------- //
        let hud, elTargets, elInv, elReady, elCenter, elStatus, elStick, elKnob;

        function injectStyle() {
            if (document.getElementById(STYLE_ID)) return;
            const s = document.createElement("style");
            s.id = STYLE_ID;
            s.textContent = CSS;
            document.head.appendChild(s);
        }

        function buildHud() {
            hud = document.createElement("div");
            hud.className = "bh-hud";
            hud.innerHTML =
                '<div class="bh-top">' +
                '  <div class="bh-targets"></div>' +
                '  <div class="bh-inv"></div>' +
                '</div>' +
                '<div class="bh-status">connecting…</div>' +
                '<div class="bh-stick"><div class="bh-knob"></div></div>' +
                '<button class="bh-ready">I\'m ready</button>' +
                '<div class="bh-center"></div>';
            stage.appendChild(hud);
            elTargets = hud.querySelector(".bh-targets");
            elInv = hud.querySelector(".bh-inv");
            elReady = hud.querySelector(".bh-ready");
            elCenter = hud.querySelector(".bh-center");
            elStatus = hud.querySelector(".bh-status");
            elStick = hud.querySelector(".bh-stick");
            elKnob = hud.querySelector(".bh-knob");

            elStick.addEventListener("pointerdown", stickStart);
            elStick.addEventListener("pointermove", stickMove);
            elStick.addEventListener("pointerup", stickEnd);
            elStick.addEventListener("pointercancel", stickEnd);
            elStick.addEventListener("pointerleave", stickEnd);

            elReady.addEventListener("click", () => {
                if (solo) { soloNewRound(); refreshSoloState(); SGSound.play("tap"); return; }
                const meP = myPlayer();
                send({ type: "ready", value: !(meP && meP.ready) });
                SGSound.play("tap");
            });
        }

        // ---- joystick ---------------------------------------------------- //
        function stickVector(e) {
            const rect = elStick.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            let dx = e.clientX - cx;
            let dy = e.clientY - cy;
            const max = rect.width / 2;
            const len = Math.hypot(dx, dy);
            if (len > max) { dx = dx / len * max; dy = dy / len * max; }
            elKnob.style.transform = "translate(" + dx + "px," + dy + "px)";
            joy.dx = dx / max;
            joy.dy = dy / max;
        }
        function stickStart(e) {
            e.preventDefault();
            joy.active = true;
            joy.pid = e.pointerId;
            try { elStick.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
            stickVector(e);
        }
        function stickMove(e) {
            if (!joy.active || e.pointerId !== joy.pid) return;
            e.preventDefault();
            stickVector(e);
        }
        function stickEnd(e) {
            if (e.pointerId !== joy.pid && joy.pid !== null) return;
            joy.active = false;
            joy.pid = null;
            joy.dx = 0;
            joy.dy = 0;
            elKnob.style.transform = "translate(0,0)";
        }

        // Hide the on-screen controls while a card (join/error) is showing, so
        // they can't sit on top of buttons or links the player needs to tap.
        function setControls(visible) {
            if (elStick) elStick.classList.toggle("bh-hidden", !visible);
            if (!visible) stickEnd({ pointerId: joy.pid });
        }

        function showJoin() {
            setControls(false);
            elCenter.innerHTML =
                '<div class="bh-card">' +
                '  <div class="bh-who">' + myAvatar + "</div>" +
                '  <h2>Bug Hunt</h2>' +
                '  <p>Catch your 4 bugs in the right order. Search logs, trees and tall grass — the first to fill the bar nabs the bug!</p>' +
                '  <span class="field-label">Server</span>' +
                '  <input class="bh-server" type="text" autocomplete="off" />' +
                '  <button class="bh-btn bh-join">Join as ' + myName + "</button>" +
                '  <button class="bh-btn alt bh-solo">Play solo (offline)</button>' +
                '</div>';
            const input = elCenter.querySelector(".bh-server");
            input.value = defaultWsUrl();
            elCenter.querySelector(".bh-join").addEventListener("click", () => {
                SGSound.unlock();
                SGSound.play("tap");
                connect(input.value.trim() || defaultWsUrl());
            });
            elCenter.querySelector(".bh-solo").addEventListener("click", () => {
                SGSound.unlock();
                SGSound.play("tap");
                startSolo();
            });
        }

        function clearCenter() { elCenter.innerHTML = ""; }

        function showConnecting() {
            setControls(false);
            elCenter.innerHTML =
                '<div class="bh-card">' +
                '  <div class="bh-who">' + myAvatar + "</div>" +
                '  <h2>Joining as ' + myName + "…</h2>" +
                '  <p>Connecting to the game.</p>' +
                "</div>";
        }

        function showError(title, htmlBody) {
            setControls(false);
            elStatus.textContent = "offline";
            elCenter.innerHTML =
                '<div class="bh-card">' +
                '  <h2>' + title + "</h2>" +
                '  <div class="bh-errbody">' + htmlBody + "</div>" +
                '  <button class="bh-btn bh-solo">Play solo (offline)</button>' +
                '  <button class="bh-btn alt bh-retry">Try again</button>' +
                "</div>";
            elCenter.querySelector(".bh-retry").addEventListener("click", showJoin);
            elCenter.querySelector(".bh-solo").addEventListener("click", () => {
                SGSound.unlock();
                SGSound.play("tap");
                startSolo();
            });
        }

        // ---- networking -------------------------------------------------- //
        let connectTimer = null;

        function connect(url) {
            showConnecting();
            elStatus.textContent = "connecting…";

            // An https page can't open an insecure ws:// (mixed content). With the
            // default URL this never happens (https -> wss), but guard a manual one.
            if (window.location.protocol === "https:" && url.indexOf("ws://") === 0) {
                showError("Can't connect (https blocks ws://)",
                    "<p>This page is <b>https</b>, so it can't use an insecure " +
                    "<code>ws://</code> connection.</p>" +
                    "<p>Either use a <code>wss://</code> address, or simply open the game " +
                    "over http (tap to open):</p>" +
                    addrLink("http://" + SERVER_HOST + ":" + SERVER_PORT));
                return;
            }

            try {
                ws = new WebSocket(url);
            } catch (e) {
                showError("That address didn't work", "<p>" + e.message + "</p>");
                return;
            }

            // If it neither opens nor closes, it's almost always a firewall, a
            // wrong IP, or (for wss) an untrusted certificate.
            clearTimeout(connectTimer);
            connectTimer = setTimeout(() => {
                if (ws && ws.readyState === WebSocket.CONNECTING) {
                    try { ws.close(); } catch (e) { /* ignore */ }
                    showError("Couldn't reach the server", causes(url));
                }
            }, 8000);

            ws.addEventListener("open", () => {
                clearTimeout(connectTimer);
                connected = true;
                elStatus.textContent = "connected";
                send({ type: "join", name: myName, avatar: myAvatar });
            });
            ws.addEventListener("message", (ev) => onMessage(ev.data));
            ws.addEventListener("close", (ev) => {
                clearTimeout(connectTimer);
                connected = false;
                elStatus.textContent = "offline";
                if (!hud) return;
                if (myId) {
                    showError("Disconnected", "<p>Lost contact with the server" +
                        (ev && ev.code ? " (code " + ev.code + ")" : "") + ".</p>");
                } else {
                    showError("Couldn't reach the server", causes(url));
                }
            });
            ws.addEventListener("error", () => {
                // The error event carries no detail; the close handler shows why.
                elStatus.textContent = "error";
            });
        }

        function causes(url) {
            return url.indexOf("wss://") === 0 ? secureCauses(url) : commonCauses(url);
        }

        function commonCauses(url) {
            return "<p>Tried to reach:</p>" +
                "<p class=\"bh-addr\">" + url + "</p>" +
                "<p>Check that:</p>" +
                "<ul class=\"bh-list\">" +
                "<li>the server (<code>server.py</code>) is running</li>" +
                "<li>this device is on the <b>same Wi‑Fi</b> as the server</li>" +
                "<li>the address above is the server's current IP</li>" +
                "<li>the server PC's <b>firewall</b> allows port " + SERVER_PORT +
                " (Windows often blocks it the first time — click <i>Allow access</i> on the popup, or allow Python on Private networks)</li>" +
                "</ul>";
        }

        function secureCauses(url) {
            const https = "https://" + SERVER_HOST + ":" + SERVER_PORT;
            const http = "http://" + SERVER_HOST + ":" + SERVER_PORT;
            return "<p>This page is <b>https</b>, so the game must use a secure " +
                "connection:</p>" +
                "<p class=\"bh-addr\">" + url + "</p>" +
                "<p>To allow it on this device:</p>" +
                "<ol class=\"bh-list\">" +
                "<li>start the server with <code>python server.py --https</code></li>" +
                "<li>open " + inlineLink(https) + " in <b>this</b> browser</li>" +
                "<li>tap <b>Advanced</b> → <b>Proceed / Visit anyway</b> to trust the " +
                "certificate (it's your own server)</li>" +
                "<li>come back here and tap <b>Try again</b></li>" +
                "</ol>" +
                "<p><b>Easier:</b> skip certificates and open the game over http " +
                "(tap to open):</p>" +
                addrLink(http);
        }

        function send(obj) {
            if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
        }

        function onMessage(raw) {
            let msg;
            try { msg = JSON.parse(raw); } catch (e) { return; }
            if (msg.type === "welcome") {
                myId = msg.id;
                world = msg.world || world;
                clearCenter();
                setControls(true);
            } else if (msg.type === "state") {
                applyState(msg);
            }
        }

        function applyState(s) {
            state = s;
            world = s.world || world;
            captureTime = s.captureTime || captureTime;

            // Seed our local position once from the server's copy.
            if (!havePos) {
                const mine = (s.players || []).find((p) => p.id === myId);
                if (mine) { me.x = mine.x; me.y = mine.y; havePos = true; }
            }

            // Capture / win feedback.
            const you = s.you || {};
            const inv = you.inventory || [];
            if (inv.length > prevInvCount) {
                SGSound.play("eat");
                host.vibrate(20);
            }
            prevInvCount = inv.length;
            host.setScore((you.progress || 0) + "/" + (you.targets ? you.targets.length : 4));

            if (s.phase === "won" && lastWinner !== s.winnerName) {
                lastWinner = s.winnerName;
                const iWon = you.id && (s.players || []).some((p) => p.id === you.id && p.won);
                SGSound.play(iWon ? "highscore" : "gameover");
                host.vibrate(iWon ? [20, 40, 20, 40, 60] : 40);
            }
            if (s.phase === "playing") lastWinner = null;

            renderHud();
        }

        function myPlayer() {
            if (!state) return null;
            return (state.players || []).find((p) => p.id === myId) || null;
        }

        // ---- solo mode (offline, no server) ------------------------------ //
        // Mirrors the Python server's bug AI and capture rules closely enough
        // that one player gets the same round when nobody can host. Each tick we
        // rebuild a server-shaped state object and feed it through applyState so
        // the HUD/renderer behave exactly as they do online.
        function soloEmoji(species) {
            const f = SOLO_SPECIES.find((s) => s[0] === species);
            return f ? f[1] : "\u{1F41B}";
        }
        function soloShuffle(arr) {
            const a = arr.slice();
            for (let i = a.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const t = a[i]; a[i] = a[j]; a[j] = t;
            }
            return a;
        }
        function soloRandomPos(margin) {
            margin = margin || 70;
            return {
                x: margin + Math.random() * (world.w - margin * 2),
                y: SOLO_CFG.PLAY_TOP + margin +
                    Math.random() * (world.h - SOLO_CFG.PLAY_TOP - margin * 2)
            };
        }
        function soloSpacedPos(others, minDist) {
            minDist = minDist || 90;
            for (let i = 0; i < 40; i++) {
                const p = soloRandomPos();
                if (others.every((o) => (p.x - o.x) * (p.x - o.x) +
                    (p.y - o.y) * (p.y - o.y) >= minDist * minDist)) return p;
            }
            return soloRandomPos();
        }
        function soloNextBugId() { return "b" + (++soloSim.bugSeq); }
        function soloSpawnHidden(species) {
            const pos = soloSpacedPos(soloSim.spots, 85);
            const spot = {
                id: "s" + soloSim.spots.length,
                type: SOLO_SPOT_TYPES[Math.floor(Math.random() * SOLO_SPOT_TYPES.length)],
                x: pos.x, y: pos.y, rustle: 0
            };
            soloSim.spots.push(spot);
            soloSim.bugs.push({
                id: soloNextBugId(), species: species, emoji: soloEmoji(species),
                state: "hidden", x: pos.x, y: pos.y, spot: spot.id,
                heading: Math.random() * Math.PI * 2, prog: 0, cap: null
            });
        }
        function soloSpawnFleeing(species, x, y) {
            soloSim.bugs.push({
                id: soloNextBugId(), species: species, emoji: soloEmoji(species),
                state: "fleeing",
                x: Math.max(20, Math.min(world.w - 20, x)),
                y: Math.max(SOLO_CFG.PLAY_TOP + 4, Math.min(world.h - 20, y)),
                spot: null, heading: Math.random() * Math.PI * 2, prog: 0, cap: null
            });
        }
        function soloHeld() {
            return soloSim.inventory
                .filter((it) => soloSim.targets.indexOf(it.species) >= 0)
                .map((it) => it.species);
        }
        function soloTargetsMet() {
            const held = soloHeld();
            return held.length === soloSim.targets.length &&
                held.every((s, i) => s === soloSim.targets[i]);
        }
        function soloProgress() {
            if (soloTargetsMet()) return soloSim.targets.length;
            const held = soloHeld();
            let k = 0;
            for (const t of soloSim.targets) {
                if (k < held.length && held[k] === t) k++; else break;
            }
            return k;
        }
        function soloNewRound() {
            world = { w: 1000, h: 700 };
            soloSim.phase = "playing";
            soloSim.resetTimer = 0;
            soloSim.bugs = [];
            soloSim.spots = [];
            soloSim.bugSeq = 0;
            soloSim.inventory = [];
            const keys = SOLO_SPECIES.map((s) => s[0]);
            soloSim.targets = soloShuffle(keys).slice(0, SOLO_CFG.TARGETS);
            for (const sp of soloSim.targets) soloSpawnHidden(sp);
            for (let i = 0; i < SOLO_CFG.EXTRA_BUGS; i++) {
                soloSpawnHidden(keys[Math.floor(Math.random() * keys.length)]);
            }
            for (let i = 0; i < 4; i++) {
                const pos = soloSpacedPos(soloSim.spots, 85);
                soloSim.spots.push({
                    id: "s" + soloSim.spots.length,
                    type: SOLO_SPOT_TYPES[Math.floor(Math.random() * SOLO_SPOT_TYPES.length)],
                    x: pos.x, y: pos.y, rustle: 0
                });
            }
            const pp = soloRandomPos();
            me.x = pp.x; me.y = pp.y; havePos = true;
            prevInvCount = 0;
            lastWinner = null;
        }
        function soloRelease(bugId, x, y) {
            const i = soloSim.inventory.findIndex((it) => it.bugId === bugId);
            if (i < 0) return;
            const it = soloSim.inventory[i];
            soloSim.inventory.splice(i, 1);
            soloSpawnFleeing(it.species, x, y);
            refreshSoloState();
        }
        function soloCapture(bug) {
            bug.state = "captured";
            soloSim.inventory.push({ bugId: bug.id, species: bug.species, emoji: bug.emoji });
            // applyState plays the catch sound when the bag count grows.
            if (soloSim.phase === "playing" && soloTargetsMet()) {
                soloSim.phase = "won";
                soloSim.resetTimer = SOLO_CFG.RESET_SECONDS;
            }
        }
        function refreshSoloState() {
            applyState({
                phase: soloSim.phase,
                resetTimer: Math.max(0, soloSim.resetTimer),
                winnerName: soloSim.phase === "won" ? myName : "",
                world: { w: world.w, h: world.h },
                captureTime: SOLO_CFG.CAPTURE_TIME,
                players: [{
                    id: myId, name: myName, avatar: myAvatar,
                    x: me.x, y: me.y, ready: false, won: soloSim.phase === "won"
                }],
                spots: soloSim.spots.map((s) => ({
                    id: s.id, type: s.type, x: s.x, y: s.y, rustle: s.rustle
                })),
                bugs: soloSim.bugs.filter((b) => b.state === "fleeing").map((b) => ({
                    id: b.id, emoji: b.emoji, x: b.x, y: b.y, cap: b.cap || null
                })),
                you: {
                    id: myId, ready: false,
                    targets: soloSim.targets.map((s) => ({ species: s, emoji: soloEmoji(s) })),
                    progress: soloProgress(),
                    inventory: soloSim.inventory.map((it) => ({
                        bugId: it.bugId, species: it.species, emoji: it.emoji,
                        isTarget: soloSim.targets.indexOf(it.species) >= 0
                    }))
                }
            });
        }
        function startSolo() {
            solo = true;
            connected = true;          // lets step() run local player movement
            myId = "solo";
            soloAccum = 0;
            soloSim = {
                phase: "playing", resetTimer: 0, bugs: [], spots: [],
                bugSeq: 0, targets: [], inventory: []
            };
            soloNewRound();
            clearCenter();
            setControls(true);
            if (elStatus) elStatus.textContent = "solo";
            refreshSoloState();
        }
        function soloTick(dt) {
            if (!soloSim) return;
            soloAccum += dt;
            if (soloAccum < SOLO_TICK) return;
            const sdt = soloAccum;
            soloAccum = 0;

            if (soloSim.phase === "won") {
                soloSim.resetTimer -= sdt;
                if (soloSim.resetTimer <= 0) soloNewRound();
                refreshSoloState();
                return;
            }

            for (const s of soloSim.spots) s.rustle = Math.max(0, s.rustle - sdt);

            const cfg = SOLO_CFG;
            for (const bug of soloSim.bugs) {
                if (bug.state === "captured") continue;
                const dx = me.x - bug.x, dy = me.y - bug.y;
                const d2 = dx * dx + dy * dy;

                if (bug.state === "hidden") {
                    if (d2 <= cfg.SEARCH_RADIUS * cfg.SEARCH_RADIUS) {
                        bug.state = "fleeing";
                        const spot = soloSim.spots.find((s) => s.id === bug.spot);
                        if (spot) spot.rustle = 0.5;
                    }
                    continue;
                }

                let beingCaptured = false;
                if (d2 <= cfg.CAPTURE_RADIUS * cfg.CAPTURE_RADIUS) {
                    bug.prog += sdt; beingCaptured = true;
                } else if (bug.prog > 0) {
                    bug.prog = Math.max(0, bug.prog - cfg.PROGRESS_DECAY * sdt);
                }
                if (bug.prog >= cfg.CAPTURE_TIME) { soloCapture(bug); continue; }
                bug.cap = bug.prog > 0
                    ? { by: myId, p: Math.min(1, bug.prog / cfg.CAPTURE_TIME) } : null;

                let speed = cfg.WANDER_SPEED;
                if (d2 < cfg.FLEE_TRIGGER * cfg.FLEE_TRIGGER) {
                    bug.heading = Math.atan2(bug.y - me.y, bug.x - me.x);
                    speed = cfg.FLEE_SPEED;
                } else {
                    bug.heading += (Math.random() * 3 - 1.5) * sdt;
                }
                if (beingCaptured) speed *= cfg.CORNERED_FACTOR;
                bug.x += Math.cos(bug.heading) * speed * sdt;
                bug.y += Math.sin(bug.heading) * speed * sdt;
                if (bug.x < 18 || bug.x > world.w - 18) bug.heading = Math.PI - bug.heading;
                if (bug.y < cfg.PLAY_TOP + 4 || bug.y > world.h - 18) bug.heading = -bug.heading;
                bug.x = Math.max(18, Math.min(world.w - 18, bug.x));
                bug.y = Math.max(cfg.PLAY_TOP + 4, Math.min(world.h - 18, bug.y));
            }
            soloSim.bugs = soloSim.bugs.filter((b) => b.state !== "captured");
            refreshSoloState();
        }

        // ---- HUD rendering ----------------------------------------------- //
        function renderHud() {
            if (!state) return;
            const you = state.you || {};
            const targets = you.targets || [];
            const progress = you.progress || 0;

            let th = '<span class="lbl">Catch in order:</span>';
            targets.forEach((t, i) => {
                let cls = "bh-chip";
                if (i < progress) cls += " done";
                else if (i === progress) cls += " next";
                th += '<span class="' + cls + '"><span class="ord">' + (i + 1) + "</span>" +
                    (i < progress ? "✅" : t.emoji) + "</span>";
            });
            elTargets.innerHTML = th;

            const inv = you.inventory || [];
            if (inv.length === 0) {
                elInv.innerHTML = '<span class="lbl">Bag:</span><span class="bh-empty">empty — go catch some bugs!</span>';
            } else {
                let ih = '<span class="lbl">Bag:</span>';
                inv.forEach((it) => {
                    ih += '<button class="' + (it.isTarget ? "target" : "") + '" data-bug="' +
                        it.bugId + '">' + it.emoji + "</button>";
                });
                elInv.innerHTML = ih;
                elInv.querySelectorAll("button").forEach((b) => {
                    b.addEventListener("click", () => {
                        const it = inv.find((x) => x.bugId === b.dataset.bug);
                        if (it) showReleasePrompt(it);
                    });
                });
            }

            // Win banner + ready button.
            if (state.phase === "won") {
                elReady.style.display = "block";
                const meP = myPlayer();
                elReady.classList.toggle("on", !!(meP && meP.ready));
                elReady.textContent = meP && meP.ready ? "Ready! ✔" : "I'm ready";
                if (!elCenter.querySelector(".bh-win")) {
                    const iWon = (state.players || []).some((p) => p.id === myId && p.won);
                    elCenter.innerHTML =
                        '<div class="bh-card bh-win">' +
                        '  <h2>' + (iWon ? "\u{1F389} You win!" : "\u{1F3C6} " + state.winnerName + " wins!") + "</h2>" +
                        '  <p>New round in <span class="bh-count">' + Math.ceil(state.resetTimer) + "</span>s." +
                        " Tap <b>I'm ready</b> to start sooner.</p>" +
                        "</div>";
                }
                const c = elCenter.querySelector(".bh-count");
                if (c) c.textContent = Math.ceil(state.resetTimer);
            } else {
                elReady.style.display = "none";
                const win = elCenter.querySelector(".bh-win");
                if (win) clearCenter();
            }
        }

        function showReleasePrompt(item) {
            promptOpen = true;
            setControls(false);
            elCenter.innerHTML =
                '<div class="bh-card bh-prompt">' +
                '  <div class="bh-who">' + item.emoji + "</div>" +
                '  <h2>Release this bug?</h2>' +
                '  <p>It hops back into the grass right where you\'re standing.</p>' +
                '  <div class="bh-row">' +
                '    <button class="bh-btn bh-rel">Release</button>' +
                '    <button class="bh-btn alt bh-keep">Keep</button>' +
                '  </div>' +
                "</div>";
            elCenter.querySelector(".bh-rel").addEventListener("click", () => {
                if (solo) soloRelease(item.bugId, me.x, me.y);
                else send({ type: "release", bugId: item.bugId, x: me.x, y: me.y });
                SGSound.play("drop");
                host.vibrate(15);
                closePrompt();
            });
            elCenter.querySelector(".bh-keep").addEventListener("click", () => {
                SGSound.play("tap");
                closePrompt();
            });
        }

        function closePrompt() {
            promptOpen = false;
            clearCenter();
            setControls(true);
        }

        // ---- input ------------------------------------------------------- //
        function onKeyDown(e) {
            const k = e.key.toLowerCase();
            if (k === "arrowup" || k === "w") keys.up = true;
            else if (k === "arrowdown" || k === "s") keys.down = true;
            else if (k === "arrowleft" || k === "a") keys.left = true;
            else if (k === "arrowright" || k === "d") keys.right = true;
            else return;
            e.preventDefault();
        }
        function onKeyUp(e) {
            const k = e.key.toLowerCase();
            if (k === "arrowup" || k === "w") keys.up = false;
            else if (k === "arrowdown" || k === "s") keys.down = false;
            else if (k === "arrowleft" || k === "a") keys.left = false;
            else if (k === "arrowright" || k === "d") keys.right = false;
        }

        // ---- simulation + render loop ------------------------------------ //
        function resize() {
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = canvas.clientWidth;
            H = canvas.clientHeight;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            // Zoom so a comfortable window of the world fills the screen (no bars).
            scale = Math.max(W / VIEW_W, H / VIEW_H);
        }

        function updateCamera() {
            const halfW = (W / scale) / 2, halfH = (H / scale) / 2;
            const cx = havePos ? me.x : world.w / 2;
            const cy = havePos ? me.y : world.h / 2;
            camX = world.w <= halfW * 2 ? world.w / 2 : Math.max(halfW, Math.min(world.w - halfW, cx));
            camY = world.h <= halfH * 2 ? world.h / 2 : Math.max(halfH, Math.min(world.h - halfH, cy));
        }

        function step(dt) {
            if (!(state && state.phase === "playing" && connected && havePos)) return;

            // Joystick gives an analog vector; keyboard is a digital fallback.
            let vx = joy.dx, vy = joy.dy;
            if (!joy.active) {
                vx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
                vy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
            }
            let mag = Math.hypot(vx, vy);
            if (mag < 0.08) return;            // small dead zone
            if (mag > 1) { vx /= mag; vy /= mag; mag = 1; }

            me.x += vx * PLAYER_SPEED * dt;
            me.y += vy * PLAYER_SPEED * dt;
            me.x = Math.max(16, Math.min(world.w - 16, me.x));
            me.y = Math.max(HORIZON + 14, Math.min(world.h - 16, me.y));
            const now = performance.now();
            if (now - lastMoveSent > MOVE_SEND_MS) {
                send({ type: "move", x: me.x, y: me.y });
                lastMoveSent = now;
            }
        }

        function wx(x) { return (x - camX) * scale + W / 2; }
        function wy(y) { return (y - camY) * scale + H / 2; }

        function makeMountains() {
            function layer(min, max, step) {
                const pts = [];
                for (let x = -160; x <= 1160; x += step) {
                    pts.push([x, HORIZON - (min + Math.random() * (max - min))]);
                }
                return pts;
            }
            return [
                { pts: layer(34, 78, 150), color: "#6b7da0" },   // far, hazy blue
                { pts: layer(46, 104, 120), color: "#4a6a52" },  // mid, green
                { pts: layer(58, 130, 95), color: "#35513a" }    // near, dark green
            ];
        }

        function drawShadow(x, y, rx, ry) {
            ctx.save();
            ctx.fillStyle = "rgba(0,0,0,0.22)";
            ctx.beginPath();
            ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        function drawSky(skyBottom) {
            const sb = Math.min(skyBottom, H);
            if (sb <= 0) return;
            const sky = ctx.createLinearGradient(0, 0, 0, sb);
            sky.addColorStop(0, "#7ec6f4");
            sky.addColorStop(0.7, "#bfe4f0");
            sky.addColorStop(1, "#dff1e0");
            ctx.fillStyle = sky;
            ctx.fillRect(0, 0, W, sb);

            // Sun
            ctx.save();
            ctx.beginPath(); ctx.rect(0, 0, W, sb); ctx.clip();
            ctx.fillStyle = "rgba(255,245,200,0.95)";
            ctx.beginPath(); ctx.arc(W * 0.8, sb * 0.32, Math.max(20, sb * 0.12), 0, Math.PI * 2); ctx.fill();

            // Clouds drift slowly across the sky.
            const t = lastTs / 1000;
            ctx.fillStyle = "rgba(255,255,255,0.9)";
            for (const c of clouds) {
                const cx = ((c.x * (W + 200) + t * c.sp) % (W + 200)) - 100;
                const cy = c.y * sb;
                const r = 16 * c.s;
                ctx.beginPath();
                ctx.ellipse(cx, cy, r * 1.6, r, 0, 0, Math.PI * 2);
                ctx.ellipse(cx + r * 1.3, cy + r * 0.2, r * 1.1, r * 0.8, 0, 0, Math.PI * 2);
                ctx.ellipse(cx - r * 1.2, cy + r * 0.25, r, r * 0.7, 0, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();

            // Mountain ranges sit on the horizon line.
            for (const L of mountains) {
                ctx.fillStyle = L.color;
                ctx.beginPath();
                ctx.moveTo(wx(L.pts[0][0]), sb + 4);
                for (const p of L.pts) ctx.lineTo(wx(p[0]), wy(p[1]));
                ctx.lineTo(wx(L.pts[L.pts.length - 1][0]), sb + 4);
                ctx.closePath();
                ctx.fill();
            }
        }

        function drawSpot(s, t) {
            const x = wx(s.x), y = wy(s.y);
            const wob = s.rustle > 0 ? Math.sin(t * 30) * 3 * s.rustle : 0;
            const fs = Math.max(28, 36 * scale);
            drawShadow(x, y + fs * 0.42, fs * 0.5, fs * 0.18);
            ctx.save();
            ctx.translate(x + wob, y);
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            if (s.type === "log") {
                // Drawn (not emoji) so it always shows — the wood emoji is new and
                // renders as a blank box on older phones.
                const w = fs * 1.05, h = fs * 0.5;
                ctx.fillStyle = "#6b4a2b";
                roundRect(-w / 2, -h / 2, w, h, h / 2);
                ctx.fill();
                ctx.fillStyle = "#caa06a";
                ctx.beginPath();
                ctx.ellipse(w / 2 - h * 0.18, 0, h * 0.32, h * 0.42, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = "#8a6a44";
                ctx.beginPath();
                ctx.ellipse(w / 2 - h * 0.18, 0, h * 0.16, h * 0.22, 0, 0, Math.PI * 2);
                ctx.fill();
            } else {
                ctx.font = fs + "px system-ui, sans-serif";
                ctx.fillStyle = "#2f7d3f";       // visible if the emoji falls back
                ctx.fillText(s.type === "tree" ? "\u{1F333}" : "\u{1F33F}", 0, 0);
            }
            ctx.restore();
        }

        function roundRect(x, y, w, h, r) {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.arcTo(x + w, y, x + w, y + h, r);
            ctx.arcTo(x + w, y + h, x, y + h, r);
            ctx.arcTo(x, y + h, x, y, r);
            ctx.arcTo(x, y, x + w, y, r);
            ctx.closePath();
        }

        function drawBug(b, t) {
            const x = wx(b.x), y = wy(b.y);
            const bob = Math.sin(t * 8 + b.x) * 2;
            const r = Math.max(18, 22 * scale);
            drawShadow(x, y + r * 0.7, r * 0.7, r * 0.28);
            ctx.save();
            ctx.translate(x, y + bob);
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.font = Math.max(24, 30 * scale) + "px system-ui, sans-serif";
            // No halo behind the bug: a soft drop shadow lifts it off the grass
            // for readability, and the light fill keeps any monochrome-fallback
            // glyph visible on the dark field.
            ctx.shadowColor = "rgba(0,0,0,0.5)";
            ctx.shadowBlur = 5;
            ctx.fillStyle = "#eafff1";
            ctx.fillText(b.emoji, 0, 0);
            ctx.shadowBlur = 0;
            if (b.cap && b.cap.p > 0.02) {
                const bw = 40, bh = 6, by = -24;
                ctx.fillStyle = "#0009";
                ctx.fillRect(-bw / 2, by, bw, bh);
                ctx.fillStyle = b.cap.by === myId ? "#39d98a" : "#ffd166";
                ctx.fillRect(-bw / 2, by, bw * b.cap.p, bh);
            }
            ctx.restore();
        }

        function drawPlayer(p) {
            const x = wx(p.x), y = wy(p.y);
            const mine = p.id === myId;
            drawShadow(x, y + 16, 16, 6);
            ctx.save();
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.font = "30px system-ui, sans-serif";
            ctx.fillStyle = "#fff";
            ctx.fillText(p.avatar, x, y + 1);
            ctx.font = "700 12px system-ui, sans-serif";
            ctx.fillStyle = mine ? "#ffd166" : "#fff";
            ctx.fillText(p.name + (mine ? " (you)" : ""), x, y - 26);
            ctx.restore();
        }

        function draw(t) {
            updateCamera();

            // Distant grass fills any area beside/below the playable field.
            ctx.fillStyle = "#173a23";
            ctx.fillRect(0, 0, W, H);

            // Sky + mountains above the horizon line.
            const horizonY = wy(HORIZON);
            drawSky(horizonY);

            // The grassy playable field (world y from HORIZON to the bottom).
            const fx = wx(0), fyTop = wy(HORIZON);
            const fw = world.w * scale, fh = (world.h - HORIZON) * scale;
            const g = ctx.createLinearGradient(0, fyTop, 0, fyTop + fh);
            g.addColorStop(0, "#2e6038");
            g.addColorStop(1, "#1d4427");
            ctx.fillStyle = g;
            ctx.fillRect(fx, fyTop, fw, fh);

            // Grass tufts give the ground texture (clipped to the field).
            ctx.save();
            ctx.beginPath();
            ctx.rect(fx, fyTop, fw, fh);
            ctx.clip();
            ctx.strokeStyle = "rgba(120,200,130,0.35)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (const tf of tufts) {
                const gxp = wx(tf.x), gyp = wy(tf.y), bl = 5 * tf.s * scale;
                ctx.moveTo(gxp, gyp); ctx.lineTo(gxp - bl * 0.4, gyp - bl);
                ctx.moveTo(gxp, gyp); ctx.lineTo(gxp, gyp - bl * 1.2);
                ctx.moveTo(gxp, gyp); ctx.lineTo(gxp + bl * 0.4, gyp - bl);
            }
            ctx.stroke();
            ctx.restore();

            // A soft edge where grass meets the horizon.
            const hz = ctx.createLinearGradient(0, fyTop, 0, fyTop + 26);
            hz.addColorStop(0, "rgba(20,40,25,0.55)");
            hz.addColorStop(1, "rgba(20,40,25,0)");
            ctx.fillStyle = hz;
            ctx.fillRect(fx, fyTop, fw, 26);

            // Field border (sides + bottom; top blends into the horizon).
            ctx.strokeStyle = "#ffffff22";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(fx, fyTop); ctx.lineTo(fx, fyTop + fh);
            ctx.lineTo(fx + fw, fyTop + fh); ctx.lineTo(fx + fw, fyTop);
            ctx.stroke();

            if (state) {
                // Sort so things lower on screen draw in front (depth ordering).
                const ents = [];
                for (const s of state.spots || []) ents.push({ y: s.y, fn: () => drawSpot(s, t) });
                for (const b of state.bugs || []) ents.push({ y: b.y, fn: () => drawBug(b, t) });
                for (const p of state.players || []) {
                    const pp = (p.id === myId && havePos) ? { ...p, x: me.x, y: me.y } : p;
                    ents.push({ y: pp.y, fn: () => drawPlayer(pp) });
                }
                ents.sort((a, b) => a.y - b.y);
                for (const e of ents) e.fn();
            }

            // Gentle vignette for depth.
            const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35,
                W / 2, H / 2, Math.max(W, H) * 0.72);
            vg.addColorStop(0, "rgba(0,0,0,0)");
            vg.addColorStop(1, "rgba(0,0,0,0.32)");
            ctx.fillStyle = vg;
            ctx.fillRect(0, 0, W, H);
        }

        function loop(ts) {
            rafId = requestAnimationFrame(loop);
            if (!lastTs) lastTs = ts;
            const dt = Math.min((ts - lastTs) / 1000, 0.05);
            lastTs = ts;
            step(dt);
            if (solo) soloTick(dt);
            draw(ts / 1000);
        }

        return {
            start() {
                injectStyle();
                buildHud();
                resize();
                window.addEventListener("resize", resize);
                window.addEventListener("keydown", onKeyDown);
                window.addEventListener("keyup", onKeyUp);
                // Launched standalone with a profile? Drop straight into the game.
                // Otherwise show the join panel (e.g. running inside the app shell).
                if (urlName) connect(defaultWsUrl());
                else showJoin();
                rafId = requestAnimationFrame(loop);
            },
            restart() {
                // Standard "play again" just reopens the join panel.
                solo = false;
                soloSim = null;
                havePos = false;
                if (ws) { try { ws.close(); } catch (e) { /* ignore */ } ws = null; }
                showJoin();
            },
            destroy() {
                cancelAnimationFrame(rafId);
                window.removeEventListener("resize", resize);
                window.removeEventListener("keydown", onKeyDown);
                window.removeEventListener("keyup", onKeyUp);
                if (ws) { try { ws.close(); } catch (e) { /* ignore */ } ws = null; }
                if (hud && hud.parentElement) hud.parentElement.removeChild(hud);
                const st = document.getElementById(STYLE_ID);
                if (st) st.remove();
            }
        };
    }

    window.SGGames = window.SGGames || {};
    window.SGGames.bughunt = {
        id: "bughunt",
        name: "Bug Hunt",
        emoji: "\u{1F41B}",
        tag: "Same-Wi-Fi multiplayer. Catch your bugs in order!",
        scoreLabel: "bugs",
        create: create,
        // Bug Hunt needs the live server and a plain http origin (so ws:// works
        // and the PWA's https/offline shell doesn't get in the way). The menu
        // opens this URL directly as a fresh page, passing the chosen profile so
        // the player drops straight into the game.
        launchUrl: function (profile) {
            const base = "http://" + SERVER_HOST + ":" + SERVER_PORT + "/bughunt.html";
            const q = "?name=" + encodeURIComponent(profile ? profile.name : "Player") +
                "&avatar=" + encodeURIComponent(profile ? profile.avatar : "\u{1F642}");
            return base + q;
        }
    };
})();
