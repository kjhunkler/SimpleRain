/* ============ Simple Games — app shell ============ */
(function () {
    "use strict";

    const AVATARS = [
        "\u{1F436}", "\u{1F431}", "\u{1F98A}", "\u{1F43C}", "\u{1F428}", "\u{1F435}",
        "\u{1F984}", "\u{1F438}", "\u{1F427}", "\u{1F989}", "\u{1F419}", "\u{1F99D}",
        "\u{1F480}", "\u{1F47D}", "\u{1F916}", "\u{1F9A9}", "\u{1F996}", "\u{1F409}"
    ];

    const GAME_ORDER = [
        "snake", "astro", "piestack", "flappy", "moles", "memory",
        "echo", "bricks", "hopper", "fruit", "tiles", "colorrush",
        "beatloop", "taptiles", "stopspin", "lanedash", "stormquest", "sentry",
        "bughunt", "digger", "catcher", "turtlecave", "abctrace", "lettersiege",
        "watchswap"
    ];

    // Home-screen categories and which one each game belongs to. Games missing
    // from this map fall back to "classic" so a newly added game still shows up.
    const CATEGORIES = [
        { key: "classic", label: "Classic", emoji: "\u{1F579}️" },
        { key: "puzzle", label: "Puzzle", emoji: "\u{1F9E9}" },
        { key: "learning", label: "Learning", emoji: "\u{1F393}" },
        { key: "scroller", label: "Scroller", emoji: "\u{1F3C3}" }
    ];
    const GAME_CATEGORY = {
        snake: "classic", astro: "classic", piestack: "classic", moles: "classic",
        bricks: "classic", fruit: "classic", stopspin: "classic", sentry: "classic",
        bughunt: "classic", catcher: "classic", watchswap: "classic",
        memory: "puzzle", echo: "puzzle", tiles: "puzzle", colorrush: "puzzle", beatloop: "puzzle",
        abctrace: "learning", lettersiege: "learning",
        flappy: "scroller", hopper: "scroller", taptiles: "scroller", lanedash: "scroller",
        stormquest: "scroller", digger: "scroller", turtlecave: "scroller"
    };
    function categoryOf(id) { return GAME_CATEGORY[id] || "classic"; }
    let gameFilter = "all";

    const $ = (sel) => document.querySelector(sel);

    const screens = {
        profiles: $("#screen-profiles"),
        profileEdit: $("#screen-profile-edit"),
        home: $("#screen-home"),
        game: $("#screen-game")
    };

    let editingProfileId = null;
    let selectedAvatar = AVATARS[0];
    let kidsModeSelected = false;
    let currentGameDef = null;
    let currentGame = null;
    let currentScore = 0;
    let deleteArmed = false;
    let swRegistration = null;

    /* ---------- Navigation ---------- */
    function show(name) {
        Object.values(screens).forEach(s => s.classList.add("hidden"));
        screens[name].classList.remove("hidden");
    }

    function vibrate(pattern) {
        if (navigator.vibrate) navigator.vibrate(pattern);
    }

    function toast(msg) {
        const el = $("#toast");
        el.textContent = msg;
        el.classList.add("show");
        clearTimeout(toast._t);
        toast._t = setTimeout(() => el.classList.remove("show"), 2400);
    }

    /* ---------- Profiles screen ---------- */
    function renderProfiles() {
        const list = $("#profile-list");
        list.innerHTML = "";
        const profiles = SGStorage.getProfiles();

        if (profiles.length === 0) {
            const hint = document.createElement("p");
            hint.className = "empty-hint";
            hint.textContent = "No players yet.\nCreate a profile to start playing!";
            list.appendChild(hint);
            return;
        }

        for (const p of profiles) {
            const row = document.createElement("div");
            row.className = "profile-row";

            const btn = document.createElement("button");
            btn.className = "profile-btn";
            btn.innerHTML =
                '<span class="profile-avatar"></span>' +
                '<span class="profile-info">' +
                '<span class="profile-name"></span>' +
                '<span class="profile-meta"></span>' +
                "</span>";
            btn.querySelector(".profile-avatar").textContent = p.avatar;
            btn.querySelector(".profile-name").textContent = p.name;
            btn.querySelector(".profile-meta").textContent = totalScoreLabel(p);
            btn.addEventListener("click", () => {
                SGStorage.setActiveProfile(p.id);
                vibrate(10);
                renderHome();
                show("home");
            });

            const edit = document.createElement("button");
            edit.className = "btn btn-icon btn-ghost";
            edit.setAttribute("aria-label", "Edit " + p.name);
            edit.textContent = "\u270F\uFE0F";
            edit.addEventListener("click", (e) => {
                e.stopPropagation();
                openProfileEditor(p.id);
            });

            row.appendChild(btn);
            row.appendChild(edit);
            list.appendChild(row);
        }
    }

    function totalScoreLabel(profile) {
        const scores = SGStorage.getScores(profile.id);
        const parts = [];
        for (const id of GAME_ORDER) {
            if (scores[id]) {
                const def = SGGames[id];
                parts.push(def.emoji + " " + scores[id]);
            }
        }
        return parts.length ? "Best: " + parts.join("   ") : "New player";
    }

    /* ---------- Profile editor ---------- */
    function openProfileEditor(profileId) {
        editingProfileId = profileId;
        deleteArmed = false;
        const profile = profileId ? SGStorage.getProfile(profileId) : null;

        $("#profile-edit-title").textContent = profile ? "Edit Player" : "New Player";
        $("#profile-name").value = profile ? profile.name : "";
        selectedAvatar = profile ? profile.avatar : AVATARS[Math.floor(Math.random() * AVATARS.length)];
        kidsModeSelected = profile ? !!profile.kids : false;

        const del = $("#btn-delete-profile");
        del.classList.toggle("hidden", !profile);
        del.textContent = "Delete Player";
        del.classList.remove("confirm");

        renderAvatarGrid();
        renderKidsToggle();
        show("profileEdit");
        if (!profile) {
            setTimeout(() => $("#profile-name").focus(), 250);
        }
    }

    function renderAvatarGrid() {
        const grid = $("#avatar-grid");
        grid.innerHTML = "";
        for (const a of AVATARS) {
            const b = document.createElement("button");
            b.className = "avatar-option" + (a === selectedAvatar ? " selected" : "");
            b.textContent = a;
            b.setAttribute("aria-label", "Avatar " + a);
            b.addEventListener("click", () => {
                selectedAvatar = a;
                vibrate(8);
                renderAvatarGrid();
            });
            grid.appendChild(b);
        }
    }

    function renderKidsToggle() {
        $("#btn-kids-toggle").setAttribute("aria-pressed", kidsModeSelected ? "true" : "false");
    }

    function saveProfile() {
        const name = $("#profile-name").value.trim();
        if (!name) {
            toast("Give your player a name!");
            $("#profile-name").focus();
            return;
        }
        if (editingProfileId) {
            SGStorage.updateProfile(editingProfileId, name, selectedAvatar, kidsModeSelected);
        } else {
            const p = SGStorage.createProfile(name, selectedAvatar, kidsModeSelected);
            SGStorage.setActiveProfile(p.id);
            renderHome();
            show("home");
            toast("Welcome, " + name + "!");
            return;
        }
        renderProfiles();
        show("profiles");
    }

    /* ---------- Share high score ---------- */
    const SHARE_LINK = "https://kjhunkler.github.io/Simple-Games/";

    // Opens the device's SMS composer with a pre-filled brag message so the
    // player can choose a recipient and text their best score for this game.
    function shareScore(def, best) {
        const unit = def.scoreLabel ? " " + def.scoreLabel : "";
        const message =
            "\u{1F3C6} I scored " + best + unit + " in " + def.name +
            " on Simple Games! Think you can beat me? Play here: " + SHARE_LINK;
        SGSound.play("tap");
        vibrate(10);
        // Leaving the recipient blank lets the native messaging app pick a
        // contact. The "?&" prefix keeps the body working on both iOS & Android.
        window.location.href = "sms:?&body=" + encodeURIComponent(message);
    }

    // Adds a tappable "text my score" badge to a game card. Stops the click from
    // bubbling so it shares instead of launching the game underneath it.
    function addShareButton(card, def, best) {
        const share = document.createElement("span");
        share.className = "game-share";
        share.setAttribute("role", "button");
        share.setAttribute("tabindex", "0");
        share.setAttribute("aria-label", "Text my " + def.name + " high score");
        share.textContent = "\u{1F4F2}";
        const fire = (e) => {
            e.stopPropagation();
            e.preventDefault();
            shareScore(def, best);
        };
        share.addEventListener("click", fire);
        share.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") fire(e);
        });
        card.appendChild(share);
    }

    /* ---------- Home screen ---------- */
    // Ask the service worker to look for a newer version. Skipped when offline
    // so we don't fire a doomed network request. Any update found surfaces the
    // usual prompt via the registration's "updatefound" handler.
    function checkForUpdate() {
        if (!swRegistration) return;
        if ("onLine" in navigator && !navigator.onLine) return;
        swRegistration.update().catch(() => { /* offline or unreachable is fine */ });
    }

    function renderHome() {
        const profile = SGStorage.getActiveProfile();
        if (!profile) {
            show("profiles");
            return;
        }
        // Returning to the main menu is a natural moment to look for a refresh.
        checkForUpdate();
        $("#chip-avatar").textContent = profile.avatar;
        $("#chip-name").textContent = profile.name;

        renderGameFilters();
        renderGameSections(profile);
    }

    // The filter chips: "All" plus one per category. Tapping re-renders the
    // sections to show just that category.
    function renderGameFilters() {
        const bar = $("#game-filters");
        bar.innerHTML = "";
        const chips = [{ key: "all", label: "All", emoji: "\u{1F3AE}" }].concat(CATEGORIES);
        for (const c of chips) {
            const b = document.createElement("button");
            b.className = "filter-chip" + (gameFilter === c.key ? " active" : "");
            b.textContent = c.emoji + " " + c.label;
            b.setAttribute("aria-pressed", gameFilter === c.key ? "true" : "false");
            b.addEventListener("click", () => {
                if (gameFilter === c.key) return;
                gameFilter = c.key;
                SGSound.play("tap");
                vibrate(6);
                renderGameFilters();
                renderGameSections(SGStorage.getActiveProfile());
            });
            bar.appendChild(b);
        }
    }

    function renderGameSections(profile) {
        const wrap = $("#game-sections");
        wrap.innerHTML = "";
        for (const cat of CATEGORIES) {
            if (gameFilter !== "all" && gameFilter !== cat.key) continue;
            const ids = GAME_ORDER.filter(id => SGGames[id] && categoryOf(id) === cat.key);
            if (ids.length === 0) continue;

            const title = document.createElement("h3");
            title.className = "category-title";
            title.textContent = cat.emoji + " " + cat.label;
            wrap.appendChild(title);

            const grid = document.createElement("div");
            grid.className = "game-grid";
            for (const id of ids) grid.appendChild(makeGameCard(SGGames[id], id, profile));
            wrap.appendChild(grid);
        }
    }

    function makeGameCard(def, id, profile) {
        const best = SGStorage.getBestScore(profile.id, id);
        const card = document.createElement("button");
        card.className = "game-card";
        card.innerHTML =
            '<span class="game-emoji"></span>' +
            '<span class="game-name"></span>' +
            '<span class="game-tag"></span>' +
            '<span class="game-best"></span>';
        card.querySelector(".game-emoji").textContent = def.emoji;
        card.querySelector(".game-name").textContent = def.name;
        card.querySelector(".game-tag").textContent = def.tag;
        card.querySelector(".game-best").textContent = best > 0 ? "\u2B50 Best: " + best : "Not played yet";
        card.addEventListener("click", () => {
            // Some games (e.g. Bug Hunt) run as their own page on the game
            // server. Open that directly, carrying the chosen profile, instead
            // of hosting them inside the app shell.
            if (typeof def.launchUrl === "function") {
                SGSound.play("tap");
                window.location.href = def.launchUrl(profile);
                return;
            }
            startGame(id);
        });
        // Once there's a score worth bragging about, offer a quick text share.
        if (best > 0) addShareButton(card, def, best);
        return card;
    }

    /* ---------- Game hosting ---------- */
    const gameHost = {
        canvas: null,
        kids: false,
        setScore(score) {
            currentScore = score;
            $("#game-score").textContent = score;
        },
        vibrate: vibrate,
        gameOver(score) {
            const profile = SGStorage.getActiveProfile();
            const isNewBest = profile ? SGStorage.submitScore(profile.id, currentGameDef.id, score) : false;
            const best = profile ? SGStorage.getBestScore(profile.id, currentGameDef.id) : score;

            currentScore = score;
            SGSound.play(isNewBest ? "highscore" : "gameover");
            $("#overlay-emoji").textContent = isNewBest ? "\u{1F3C6}" : currentGameDef.emoji;
            $("#overlay-title").textContent = isNewBest ? "New Best!" : "Game Over";
            $("#overlay-text").textContent =
                "You scored " + score + " " + currentGameDef.scoreLabel + ".\nBest: " + best;
            $("#overlay-badge").classList.toggle("hidden", !isNewBest);

            // Offer to text the result once there's a score worth sharing.
            const shareBtn = $("#btn-overlay-share");
            const def = currentGameDef;
            shareBtn.classList.toggle("hidden", score <= 0);
            shareBtn.onclick = () => shareScore(def, score);

            $("#game-overlay").classList.remove("hidden");
        }
    };

    function startGame(gameId) {
        const def = SGGames[gameId];
        if (!def) return;
        currentGameDef = def;

        const profile = SGStorage.getActiveProfile();
        gameHost.kids = profile ? !!profile.kids : false;

        SGSound.unlock();
        SGSound.play("tap");
        $("#game-title").textContent = def.emoji + " " + def.name;
        $("#game-kids-badge").classList.toggle("hidden", !gameHost.kids);
        gameHost.setScore(0);
        updateGameBestLabel();
        $("#game-overlay").classList.add("hidden");
        $("#game-confirm").classList.add("hidden");
        show("game");
        vibrate(10);

        gameHost.canvas = $("#game-canvas");
        // Wait one frame so layout settles before the game measures the canvas.
        requestAnimationFrame(() => {
            currentGame = def.create(gameHost);
            currentGame.start();
        });
    }

    function updateGameBestLabel() {
        const profile = SGStorage.getActiveProfile();
        const best = profile ? SGStorage.getBestScore(profile.id, currentGameDef.id) : 0;
        $("#game-best").textContent = "Best " + best;
    }

    function stopGame() {
        if (currentGame) {
            currentGame.destroy();
            currentGame = null;
        }
        currentGameDef = null;
    }

    function exitToHome() {
        stopGame();
        $("#game-overlay").classList.add("hidden");
        $("#game-confirm").classList.add("hidden");
        renderHome();
        show("home");
    }

    // The header back arrow. If a run is still in progress, confirm first so the
    // player doesn't lose their game by accident. If the game already ended (the
    // game-over overlay is up) the score is recorded, so just leave.
    function requestExit() {
        const gameOverShowing = !$("#game-overlay").classList.contains("hidden");
        if (!currentGame || gameOverShowing) {
            exitToHome();
            return;
        }
        SGSound.play("tap");
        vibrate(8);
        $("#game-confirm").classList.remove("hidden");
    }

    // Confirmed quitting mid-game: record the current score (so a run that beat
    // the player's best still counts) before heading home.
    function confirmExit() {
        const profile = SGStorage.getActiveProfile();
        if (profile && currentGameDef) {
            const isNewBest = SGStorage.submitScore(profile.id, currentGameDef.id, currentScore);
            if (isNewBest) {
                SGSound.play("highscore");
                toast("\u{1F3C6} New best saved: " + currentScore);
            }
        }
        exitToHome();
    }

    /* ---------- Wire up events ---------- */
    $("#btn-add-profile").addEventListener("click", () => openProfileEditor(null));
    $("#btn-cancel-profile").addEventListener("click", () => {
        renderProfiles();
        show("profiles");
    });
    $("#btn-save-profile").addEventListener("click", saveProfile);
    $("#btn-kids-toggle").addEventListener("click", function () {
        kidsModeSelected = !kidsModeSelected;
        renderKidsToggle();
        vibrate(8);
        SGSound.play("tap");
    });
    $("#profile-name").addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); saveProfile(); }
    });

    $("#btn-delete-profile").addEventListener("click", function () {
        if (!deleteArmed) {
            deleteArmed = true;
            this.textContent = "Tap again to confirm";
            this.classList.add("confirm");
            return;
        }
        SGStorage.deleteProfile(editingProfileId);
        renderProfiles();
        show("profiles");
        toast("Player deleted");
    });

    $("#btn-switch-profile").addEventListener("click", () => {
        SGStorage.clearActiveProfile();
        renderProfiles();
        show("profiles");
    });

    $("#btn-exit-game").addEventListener("click", requestExit);
    $("#btn-confirm-quit").addEventListener("click", confirmExit);
    $("#btn-confirm-stay").addEventListener("click", () => {
        $("#game-confirm").classList.add("hidden");
        SGSound.play("tap");
    });
    $("#btn-overlay-home").addEventListener("click", exitToHome);
    $("#btn-overlay-retry").addEventListener("click", () => {
        $("#game-overlay").classList.add("hidden");
        updateGameBestLabel();
        gameHost.setScore(0);
        SGSound.play("tap");
        if (currentGame) currentGame.restart();
    });

    /* ---------- Sound toggle ---------- */
    function renderSoundButton() {
        $("#btn-sound").textContent = SGSound.isEnabled() ? "\u{1F50A}" : "\u{1F507}";
    }
    $("#btn-sound").addEventListener("click", () => {
        const on = SGSound.toggle();
        renderSoundButton();
        if (on) SGSound.play("tap");
        toast(on ? "Sound on" : "Sound off");
    });
    renderSoundButton();

    // Mobile browsers require a user gesture before audio can start.
    document.addEventListener("touchstart", () => SGSound.unlock(), { once: true, passive: true });
    document.addEventListener("mousedown", () => SGSound.unlock(), { once: true });

    // Prevent double-tap zoom on iOS.
    let lastTouchEnd = 0;
    document.addEventListener("touchend", (e) => {
        const now = Date.now();
        if (now - lastTouchEnd <= 320) e.preventDefault();
        lastTouchEnd = now;
    }, { passive: false });

    /* ---------- Service worker & updates ---------- */
    function showUpdatePrompt(worker) {
        const banner = $("#update-banner");
        banner.classList.remove("hidden");
        $("#btn-update-now").onclick = () => {
            banner.classList.add("hidden");
            // Tell the waiting worker to activate; controllerchange then reloads.
            worker.postMessage({ type: "SKIP_WAITING" });
        };
        $("#btn-update-later").onclick = () => banner.classList.add("hidden");
    }

    if ("serviceWorker" in navigator) {
        let refreshing = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
            if (refreshing) return;
            refreshing = true;
            location.reload();
        });

        window.addEventListener("load", () => {
            navigator.serviceWorker.register("./sw.js").then((reg) => {
                swRegistration = reg;
                // An update was already downloaded on a previous visit.
                if (reg.waiting) showUpdatePrompt(reg.waiting);

                // An update is found while the app is open.
                reg.addEventListener("updatefound", () => {
                    const worker = reg.installing;
                    if (!worker) return;
                    worker.addEventListener("statechange", () => {
                        if (worker.state === "installed" && navigator.serviceWorker.controller) {
                            showUpdatePrompt(worker);
                        }
                    });
                });

                // Re-check whenever the app comes back to the foreground.
                document.addEventListener("visibilitychange", () => {
                    if (document.visibilityState === "visible") {
                        reg.update().catch(() => { /* offline is fine */ });
                    }
                });
            }).catch(err => {
                console.warn("Service worker registration failed:", err);
            });
        });
    }

    /* ---------- Boot ---------- */
    const active = SGStorage.getActiveProfile();
    if (active) {
        renderHome();
        show("home");
    } else {
        renderProfiles();
        show("profiles");
    }
})();
