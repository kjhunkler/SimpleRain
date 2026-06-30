/* ============ Memory Match — flip the cards, find the pairs ============ */
(function () {
    "use strict";

    const EMOJIS = [
        "\u{1F436}", "\u{1F431}", "\u{1F98A}", "\u{1F43C}", "\u{1F428}", "\u{1F435}",
        "\u{1F984}", "\u{1F438}", "\u{1F427}", "\u{1F989}", "\u{1F419}", "\u{1F99D}",
        "\u{1F353}", "\u{1F34A}", "\u{1F34D}", "\u{1F349}", "\u{1F352}", "\u{1F351}"
    ];

    const COLS = 4;
    const ROWS = 4;
    const PAIRS = (COLS * ROWS) / 2;

    function create(host) {
        const canvas = host.canvas;
        const ctx = canvas.getContext("2d");

        let W, H, cardW, cardH, gridX, gridY, gap;
        let cards, flipped, lockTimer, score, streak, matched, started, finished;
        let sparkles, rafId, lastTs;

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = canvas.clientWidth;
            H = canvas.clientHeight;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            gap = 10;
            cardW = Math.min((W - gap * (COLS + 1)) / COLS, 110);
            cardH = Math.min((H - 110 - gap * (ROWS + 1)) / ROWS, 130);
            gridX = (W - (cardW * COLS + gap * (COLS - 1))) / 2;
            gridY = (H - (cardH * ROWS + gap * (ROWS - 1))) / 2 + 10;
        }

        function reset() {
            const pool = EMOJIS.slice();
            for (let i = pool.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [pool[i], pool[j]] = [pool[j], pool[i]];
            }
            const faces = pool.slice(0, PAIRS);
            const deck = faces.concat(faces);
            for (let i = deck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [deck[i], deck[j]] = [deck[j], deck[i]];
            }

            cards = deck.map((face, i) => ({
                face: face,
                col: i % COLS,
                row: Math.floor(i / COLS),
                flip: 0,        // 0 = face down, 1 = face up
                target: 0,
                matched: false,
                shake: 0
            }));
            flipped = [];
            lockTimer = 0;
            score = 0;
            streak = 0;
            matched = 0;
            started = false;
            finished = false;
            sparkles = [];
            lastTs = 0;
            host.setScore(0);
        }

        function cardRect(card) {
            return {
                x: gridX + card.col * (cardW + gap),
                y: gridY + card.row * (cardH + gap)
            };
        }

        function tapAt(x, y) {
            if (finished || lockTimer > 0) return;
            for (const card of cards) {
                if (card.matched || card.target === 1) continue;
                const r = cardRect(card);
                if (x >= r.x && x <= r.x + cardW && y >= r.y && y <= r.y + cardH) {
                    flipCard(card);
                    return;
                }
            }
        }

        function flipCard(card) {
            started = true;
            card.target = 1;
            flipped.push(card);
            host.vibrate(8);
            SGSound.play("flip");

            if (flipped.length === 2) {
                const [a, b] = flipped;
                if (a.face === b.face) {
                    a.matched = true;
                    b.matched = true;
                    matched += 1;
                    streak += 1;
                    score += 10 + (streak - 1) * 5;
                    host.setScore(score);
                    host.vibrate([15, 30, 15]);
                    SGSound.play("match");
                    spawnSparkles(a);
                    spawnSparkles(b);
                    flipped = [];
                    if (matched === PAIRS) {
                        finished = true;
                        setTimeout(() => host.gameOver(score), 900);
                    }
                } else {
                    streak = 0;
                    lockTimer = 0.85;
                    SGSound.play("wrong");
                }
            }
        }

        function spawnSparkles(card) {
            const r = cardRect(card);
            for (let i = 0; i < 8; i++) {
                const a = Math.random() * Math.PI * 2;
                const sp = Math.random() * 90 + 30;
                sparkles.push({
                    x: r.x + cardW / 2,
                    y: r.y + cardH / 2,
                    vx: Math.cos(a) * sp,
                    vy: Math.sin(a) * sp - 40,
                    life: 1
                });
            }
        }

        function update(dt) {
            if (lockTimer > 0) {
                lockTimer -= dt;
                if (lockTimer <= 0) {
                    for (const card of flipped) {
                        card.target = 0;
                        card.shake = 1;
                    }
                    flipped = [];
                    host.vibrate(20);
                }
            }

            for (const card of cards) {
                const speed = 6;
                if (card.flip < card.target) card.flip = Math.min(card.target, card.flip + dt * speed);
                else if (card.flip > card.target) card.flip = Math.max(card.target, card.flip - dt * speed);
                if (card.shake > 0) card.shake = Math.max(0, card.shake - dt * 3);
            }

            for (let i = sparkles.length - 1; i >= 0; i--) {
                const s = sparkles[i];
                s.vy += 220 * dt;
                s.x += s.vx * dt;
                s.y += s.vy * dt;
                s.life -= dt * 1.6;
                if (s.life <= 0) sparkles.splice(i, 1);
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
            grad.addColorStop(1, "#23173a");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, H);

            for (const card of cards) {
                const r = cardRect(card);
                const wobble = card.shake > 0 ? Math.sin(card.shake * Math.PI * 6) * 4 : 0;
                // flip animates horizontal squash: 1 -> 0 -> 1 with face swap halfway
                const squash = Math.abs(1 - card.flip * 2);
                const faceUp = card.flip > 0.5;
                const cw = Math.max(cardW * squash, 2);
                const cx = r.x + (cardW - cw) / 2 + wobble;

                if (card.matched) ctx.globalAlpha = 0.55;

                if (faceUp) {
                    ctx.fillStyle = card.matched ? "#2c5240" : "#39395f";
                    roundRect(cx, r.y, cw, cardH, 14);
                    if (squash > 0.5) {
                        ctx.font = Math.floor(Math.min(cardW, cardH) * 0.52) + "px system-ui, sans-serif";
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        ctx.globalAlpha *= (squash - 0.5) * 2;
                        ctx.fillText(card.face, r.x + cardW / 2 + wobble, r.y + cardH / 2 + 2);
                        ctx.globalAlpha = card.matched ? 0.55 : 1;
                    }
                } else {
                    ctx.fillStyle = "#2c2c52";
                    roundRect(cx, r.y, cw, cardH, 14);
                    if (squash > 0.5) {
                        ctx.fillStyle = "rgba(255, 77, 141, " + (0.5 * (squash - 0.5) * 2) + ")";
                        ctx.font = Math.floor(Math.min(cardW, cardH) * 0.34) + "px system-ui, sans-serif";
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        ctx.fillText("?", r.x + cardW / 2 + wobble, r.y + cardH / 2 + 2);
                    }
                }
                ctx.globalAlpha = 1;
            }
            ctx.textBaseline = "alphabetic";

            // Sparkles
            ctx.fillStyle = "#ffd166";
            for (const s of sparkles) {
                ctx.globalAlpha = Math.max(s.life, 0);
                ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
            }
            ctx.globalAlpha = 1;

            // Streak indicator
            if (streak > 1 && !finished) {
                ctx.fillStyle = "#ffd166";
                ctx.font = "700 15px system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("\u{1F525} Streak x" + streak, W / 2, gridY - 16);
            } else if (!started) {
                ctx.fillStyle = "rgba(242, 243, 255, 0.85)";
                ctx.font = "700 17px system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("Find the matching pairs!", W / 2, gridY - 32);
                ctx.font = "500 14px system-ui, sans-serif";
                ctx.fillStyle = "rgba(154, 160, 195, 0.9)";
                ctx.fillText("Chain matches for bonus points", W / 2, gridY - 10);
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
    window.SGGames.memory = {
        id: "memory",
        name: "Memory Match",
        emoji: "\u{1F0CF}",
        tag: "Flip cards. Match pairs. Build streaks.",
        scoreLabel: "points",
        create: create
    };
})();
