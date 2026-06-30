/* ============ Fruit Slice — swipe to slice, dodge the bombs ============ */
(function () {
    "use strict";

    const FRUITS = [
        { emoji: "\u{1F349}", color: "#ff5d7d" },  // watermelon
        { emoji: "\u{1F34A}", color: "#ff8c42" },  // orange
        { emoji: "\u{1F34B}", color: "#ffd166" },  // lemon
        { emoji: "\u{1F34E}", color: "#ff4d4d" },  // apple
        { emoji: "\u{1F95D}", color: "#5ef58a" },  // kiwi
        { emoji: "\u{1F353}", color: "#ff6f91" }   // strawberry
    ];

    // Rotated emoji text renders as dark silhouettes on some canvas backends,
    // so emoji are rasterized once (unrotated) and drawn as bitmaps instead.
    const SPRITE = 128;
    let fruitSprites = null, skullSprite = null;

    function makeSprite(text, scale) {
        const c = document.createElement("canvas");
        c.width = SPRITE;
        c.height = SPRITE;
        const sctx = c.getContext("2d");
        sctx.font = Math.floor(SPRITE * (scale || 0.8)) + "px system-ui, sans-serif";
        sctx.textAlign = "center";
        sctx.textBaseline = "middle";
        sctx.fillText(text, SPRITE / 2, SPRITE / 2 + SPRITE * 0.03);
        return c;
    }

    function ensureSprites() {
        if (fruitSprites) return;
        fruitSprites = FRUITS.map(f => makeSprite(f.emoji));
        skullSprite = makeSprite("\u{1F480}", 0.55);
    }

    function create(host) {
        const canvas = host.canvas;
        const ctx = canvas.getContext("2d");
        ensureSprites();

        let W, H;
        let items, chunks, trail, score, lives, alive, started, elapsed;
        let spawnTimer, rafId, lastTs;
        let slicing = false;
        const kids = !!host.kids;
        const MAX_LIVES = kids ? 5 : 3;
        const BOMB_SCALE = kids ? 0.45 : 1;
        const SPAWN_BASE = kids ? 2.1 : 1.7;
        const SPAWN_MIN = kids ? 1.15 : 0.85;

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = canvas.clientWidth;
            H = canvas.clientHeight;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        function reset() {
            items = [];
            chunks = [];
            trail = [];
            score = 0;
            lives = MAX_LIVES;
            alive = true;
            started = false;
            elapsed = 0;
            spawnTimer = 0.6;
            lastTs = 0;
            slicing = false;
            host.setScore(0);
        }

        function spawnWave() {
            const difficulty = Math.min(elapsed / 60, 1);
            const count = 1 + Math.floor(Math.random() * (2 + difficulty * 2));
            for (let i = 0; i < count; i++) {
                const isBomb = started && Math.random() < (0.12 + difficulty * 0.1) * BOMB_SCALE;
                const x = W * 0.15 + Math.random() * W * 0.7;
                const fi = Math.floor(Math.random() * FRUITS.length);
                items.push({
                    x: x,
                    y: H + 40,
                    vx: (W / 2 - x) * (0.4 + Math.random() * 0.7) / 60,
                    vy: -(H * 1.25 + Math.random() * H * 0.35),
                    r: isBomb ? 26 : 30,
                    rot: Math.random() * Math.PI * 2,
                    vr: (Math.random() - 0.5) * 4,
                    bomb: isBomb,
                    fruit: FRUITS[fi],
                    sprite: fruitSprites[fi],
                    sliced: false
                });
            }
        }

        function sliceItem(item) {
            item.sliced = true;

            if (item.bomb) {
                // Boom — lose a life, clear the screen flash.
                lives -= 1;
                host.vibrate([80, 50, 110]);
                SGSound.play("explode");
                chunks.push({ boom: true, x: item.x, y: item.y, life: 1 });
                if (lives <= 0) {
                    alive = false;
                    setTimeout(() => host.gameOver(score), 800);
                }
                return;
            }

            score += 1;
            host.setScore(score);
            host.vibrate(10);
            SGSound.play("whack");

            // Two halves fly apart + juice splats.
            for (const dir of [-1, 1]) {
                chunks.push({
                    x: item.x, y: item.y,
                    vx: item.vx * 30 + dir * (60 + Math.random() * 60),
                    vy: item.vy * 0.2 - 40,
                    rot: item.rot, vr: dir * 6,
                    sprite: item.sprite,
                    half: dir,
                    r: item.r,
                    life: 1
                });
            }
            for (let i = 0; i < 7; i++) {
                chunks.push({
                    x: item.x, y: item.y,
                    vx: (Math.random() - 0.5) * 260,
                    vy: -Math.random() * 160,
                    drop: true,
                    color: item.fruit.color,
                    size: Math.random() * 5 + 3,
                    life: 1
                });
            }
        }

        function update(dt) {
            elapsed += dt;

            if (alive && started) {
                spawnTimer -= dt;
                if (spawnTimer <= 0) {
                    spawnTimer = Math.max(SPAWN_MIN, SPAWN_BASE - elapsed * 0.015);
                    spawnWave();
                }
            } else if (alive && !started && items.length === 0) {
                spawnWave(); // attract: lob a fruit now and then
                spawnTimer = 2;
            }

            const g = H * 1.05;
            for (let i = items.length - 1; i >= 0; i--) {
                const it = items[i];
                it.vy += g * dt;
                it.x += it.vx * dt * 60;
                it.y += it.vy * dt;
                it.rot += it.vr * dt;
                if (it.y > H + 80 && it.vy > 0) {
                    // Missed a fruit (bombs are fine to miss).
                    if (!it.bomb && !it.sliced && started && alive) {
                        lives -= 1;
                        host.vibrate(30);
                        SGSound.play("wrong");
                        if (lives <= 0) {
                            alive = false;
                            setTimeout(() => host.gameOver(score), 600);
                        }
                    }
                    items.splice(i, 1);
                }
            }

            for (let i = chunks.length - 1; i >= 0; i--) {
                const c = chunks[i];
                c.life -= dt * (c.boom ? 1.6 : 0.9);
                if (!c.boom) {
                    c.vy += g * 0.8 * dt;
                    c.x += c.vx * dt;
                    c.y += c.vy * dt;
                    if (c.vr) c.rot += c.vr * dt;
                }
                if (c.life <= 0 || c.y > H + 80) chunks.splice(i, 1);
            }

            for (let i = trail.length - 1; i >= 0; i--) {
                trail[i].life -= dt * 4;
                if (trail[i].life <= 0) trail.splice(i, 1);
            }
        }

        function checkSlice(x, y, px, py) {
            if (!alive) return;
            for (const it of items) {
                if (it.sliced) continue;
                // Distance from item center to the swipe segment.
                const dx = x - px, dy = y - py;
                const len2 = dx * dx + dy * dy || 1;
                let t = ((it.x - px) * dx + (it.y - py) * dy) / len2;
                t = Math.max(0, Math.min(1, t));
                const cx = px + dx * t - it.x;
                const cy = py + dy * t - it.y;
                if (cx * cx + cy * cy <= it.r * it.r * 1.3) {
                    sliceItem(it);
                }
            }
            items = items.filter(it => !it.sliced);
        }

        function draw() {
            const grad = ctx.createLinearGradient(0, 0, 0, H);
            grad.addColorStop(0, "#1d1530");
            grad.addColorStop(1, "#2a1b2e");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, H);

            // Juice drops & halves & booms
            for (const c of chunks) {
                if (c.boom) {
                    ctx.globalAlpha = Math.max(c.life, 0) * 0.8;
                    ctx.fillStyle = "#ffd166";
                    ctx.beginPath();
                    ctx.arc(c.x, c.y, (1 - c.life) * 90 + 20, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.globalAlpha = 1;
                    continue;
                }
                ctx.globalAlpha = Math.max(c.life, 0);
                if (c.drop) {
                    ctx.fillStyle = c.color;
                    ctx.fillRect(c.x, c.y, c.size, c.size);
                } else {
                    ctx.save();
                    ctx.translate(c.x, c.y);
                    ctx.rotate(c.rot);
                    const d = c.r * 2.4;
                    if (c.half < 0) ctx.drawImage(c.sprite, 0, 0, SPRITE / 2, SPRITE, -d / 2, -d / 2, d / 2, d);
                    else ctx.drawImage(c.sprite, SPRITE / 2, 0, SPRITE / 2, SPRITE, 0, -d / 2, d / 2, d);
                    ctx.restore();
                }
            }
            ctx.globalAlpha = 1;

            // Items
            for (const it of items) {
                ctx.save();
                ctx.translate(it.x, it.y);
                ctx.rotate(it.rot);
                if (it.bomb) {
                    ctx.fillStyle = "#23233c";
                    ctx.beginPath();
                    ctx.arc(0, 0, it.r * 0.85, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = "#3c3c5e";
                    ctx.lineWidth = 3;
                    ctx.stroke();
                    // Fuse
                    ctx.strokeStyle = "#c98c3f";
                    ctx.lineWidth = 3.5;
                    ctx.beginPath();
                    ctx.moveTo(0, -it.r * 0.8);
                    ctx.quadraticCurveTo(it.r * 0.5, -it.r * 1.3, it.r * 0.7, -it.r * 1.05);
                    ctx.stroke();
                    // Spark
                    ctx.fillStyle = Math.random() > 0.5 ? "#ffd166" : "#ff8c42";
                    ctx.beginPath();
                    ctx.arc(it.r * 0.7, -it.r * 1.05, 4 + Math.random() * 2.5, 0, Math.PI * 2);
                    ctx.fill();
                    // Skull
                    const sd = it.r * 1.1;
                    ctx.drawImage(skullSprite, -sd / 2, -sd / 2 + 2, sd, sd);
                } else {
                    const d = it.r * 2.4;
                    ctx.drawImage(it.sprite, -d / 2, -d / 2, d, d);
                }
                ctx.restore();
            }

            // Swipe trail
            if (trail.length > 1) {
                ctx.strokeStyle = "rgba(242, 243, 255, 0.8)";
                ctx.lineCap = "round";
                ctx.lineJoin = "round";
                for (let i = 1; i < trail.length; i++) {
                    ctx.globalAlpha = trail[i].life * 0.9;
                    ctx.lineWidth = trail[i].life * 7;
                    ctx.beginPath();
                    ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
                    ctx.lineTo(trail[i].x, trail[i].y);
                    ctx.stroke();
                }
                ctx.globalAlpha = 1;
            }

            // Lives
            ctx.font = "20px system-ui, sans-serif";
            ctx.textAlign = "left";
            for (let i = 0; i < MAX_LIVES; i++) {
                ctx.globalAlpha = i < lives ? 1 : 0.22;
                ctx.fillText("\u2764\uFE0F", 14 + i * 28, 34);
            }
            ctx.globalAlpha = 1;

            if (!started && alive) {
                ctx.fillStyle = "rgba(242, 243, 255, 0.85)";
                ctx.font = "700 17px system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("Swipe to slice the fruit!", W / 2, H * 0.3);
                ctx.font = "500 14px system-ui, sans-serif";
                ctx.fillStyle = "rgba(154, 160, 195, 0.9)";
                ctx.fillText("Don't slice the bombs \u{1F4A3}", W / 2, H * 0.3 + 26);
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

        let prevX = 0, prevY = 0;

        function pointFromEvent(e) {
            const rect = canvas.getBoundingClientRect();
            const src = e.changedTouches ? e.changedTouches[0] : e;
            return { x: src.clientX - rect.left, y: src.clientY - rect.top };
        }

        function onPointerDown(e) {
            e.preventDefault();
            const p = pointFromEvent(e);
            slicing = true;
            started = true;
            prevX = p.x;
            prevY = p.y;
            trail.push({ x: p.x, y: p.y, life: 1 });
        }

        function onPointerMove(e) {
            if (!slicing) return;
            e.preventDefault();
            const p = pointFromEvent(e);
            checkSlice(p.x, p.y, prevX, prevY);
            prevX = p.x;
            prevY = p.y;
            trail.push({ x: p.x, y: p.y, life: 1 });
            if (trail.length > 24) trail.shift();
        }

        function onPointerUp() {
            slicing = false;
        }

        return {
            start() {
                resize();
                reset();
                window.addEventListener("resize", resize);
                canvas.addEventListener("touchstart", onPointerDown, { passive: false });
                canvas.addEventListener("touchmove", onPointerMove, { passive: false });
                canvas.addEventListener("touchend", onPointerUp);
                canvas.addEventListener("mousedown", onPointerDown);
                canvas.addEventListener("mousemove", onPointerMove);
                window.addEventListener("mouseup", onPointerUp);
                rafId = requestAnimationFrame(loop);
            },
            restart() {
                reset();
            },
            destroy() {
                cancelAnimationFrame(rafId);
                window.removeEventListener("resize", resize);
                canvas.removeEventListener("touchstart", onPointerDown);
                canvas.removeEventListener("touchmove", onPointerMove);
                canvas.removeEventListener("touchend", onPointerUp);
                canvas.removeEventListener("mousedown", onPointerDown);
                canvas.removeEventListener("mousemove", onPointerMove);
                window.removeEventListener("mouseup", onPointerUp);
            }
        };
    }

    window.SGGames = window.SGGames || {};
    window.SGGames.fruit = {
        id: "fruit",
        name: "Fruit Slice",
        emoji: "\u{1F349}",
        tag: "Swipe to slice. Dodge the bombs.",
        scoreLabel: "fruits",
        create: create
    };
})();
