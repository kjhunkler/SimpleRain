/* ============ Tap Tiles — piano-tile rhythm, don't miss a note ============ */
(function () {
    "use strict";

    const LANES = 4;
    // C major pentatonic-ish ladder for pleasant random melodies.
    const SCALE = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25];
    const LANE_COLORS = ["#ff4d8d", "#ffd166", "#5ef58a", "#39d0ff"];

    function create(host) {
        const canvas = host.canvas;
        const ctx = canvas.getContext("2d");

        let W, H, laneW, tileH;
        let tiles, score, alive, started, elapsed;
        let speed, spawnGap, nextSpawnY, noteIdx, noteDir;
        let lives, grace;
        let rafId, lastTs;
        const kids = !!host.kids;
        const MAX_LIVES = kids ? 5 : 3;
        const GRACE_TIME = kids ? 2.5 : 1.5;
        const SPEED_SCALE = kids ? 0.62 : 1;

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = canvas.clientWidth;
            H = canvas.clientHeight;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            laneW = W / LANES;
            tileH = Math.min(H * 0.18, 130);
        }

        function reset() {
            tiles = [];
            score = 0;
            alive = true;
            started = false;
            elapsed = 0;
            speed = 240 * SPEED_SCALE;
            spawnGap = tileH * 1.55;
            nextSpawnY = -tileH;
            noteIdx = Math.floor(Math.random() * SCALE.length);
            noteDir = 1;
            lives = MAX_LIVES;
            grace = 0;
            lastTs = 0;
            // Pre-fill a column of tiles marching down.
            for (let i = 0; i < 4; i++) spawnTile();
            host.setScore(0);
        }

        function nextNote() {
            // Random walk over the scale sounds melodic without a song library.
            if (noteIdx <= 0) noteDir = 1;
            else if (noteIdx >= SCALE.length - 1) noteDir = -1;
            else if (Math.random() < 0.3) noteDir = -noteDir;
            noteIdx += noteDir * (Math.random() < 0.25 ? 2 : 1);
            noteIdx = Math.max(0, Math.min(SCALE.length - 1, noteIdx));
            return SCALE[noteIdx];
        }

        function spawnTile() {
            let lane;
            do {
                lane = Math.floor(Math.random() * LANES);
            } while (tiles.length && tiles[tiles.length - 1].lane === lane && Math.random() < 0.5);
            tiles.push({
                lane: lane,
                y: nextSpawnY,
                freq: nextNote(),
                hit: false,
                flash: 0
            });
            nextSpawnY -= spawnGap;
        }

        function loseLife() {
            if (!alive || grace > 0) return;
            lives -= 1;
            host.vibrate([70, 40, 90]);
            SGSound.play("wrong");
            if (lives <= 0) {
                alive = false;
                setTimeout(() => host.gameOver(score), 700);
            } else {
                // Grace period: briefly forgiving so you can find the beat again.
                grace = GRACE_TIME;
            }
        }

        function update(dt) {
            if (!alive || !started) return;
            elapsed += dt;
            speed = (240 + Math.min(elapsed * 9, 320)) * SPEED_SCALE;
            if (grace > 0) grace = Math.max(0, grace - dt);

            for (const t of tiles) {
                t.y += speed * dt;
                if (t.flash > 0) t.flash = Math.max(0, t.flash - dt * 5);
            }

            // A live tile slipping past the bottom = miss.
            for (const t of tiles) {
                if (!t.hit && t.y > H) {
                    if (grace > 0) {
                        t.hit = true; // forgiven during grace
                    } else {
                        t.hit = true;
                        loseLife();
                        if (!alive) return;
                    }
                }
            }

            tiles = tiles.filter(t => t.y < H + tileH * 2);

            // Keep the conveyor stocked.
            nextSpawnY += speed * dt;
            while (nextSpawnY > -tileH) spawnTile();
        }

        function tapAt(x, y) {
            if (!alive) return;
            const lane = Math.floor(x / laneW);

            if (!started) {
                // First tap must hit the lowest tile to start the song.
                started = true;
            }

            // Find the lowest unhit tile in this lane that's tappable.
            let target = null;
            for (const t of tiles) {
                if (t.hit || t.lane !== lane) continue;
                if (!target || t.y > target.y) target = t;
            }

            // Any unhit tile in another lane lower than this one means a wrong tap.
            let lowest = null;
            for (const t of tiles) {
                if (t.hit) continue;
                if (!lowest || t.y > lowest.y) lowest = t;
            }

            if (!target || target !== lowest || target.y + tileH < 0) {
                // Tapped an empty/wrong lane. Kids mode forgives stray background
                // taps so little fingers aren't punished for missing a tile; a
                // tile slipping past the bottom still costs a heart.
                if (!kids) loseLife();
                return;
            }

            target.hit = true;
            target.flash = 1;
            score += 1;
            host.setScore(score);
            host.vibrate(8);
            SGSound.note(target.freq, 0.3, 0.22);
        }

        function draw() {
            ctx.fillStyle = "#12121f";
            ctx.fillRect(0, 0, W, H);

            // Lane dividers
            ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
            ctx.lineWidth = 1;
            for (let i = 1; i < LANES; i++) {
                ctx.beginPath();
                ctx.moveTo(i * laneW, 0);
                ctx.lineTo(i * laneW, H);
                ctx.stroke();
            }

            for (const t of tiles) {
                const x = t.lane * laneW;
                if (t.hit) {
                    ctx.globalAlpha = t.flash * 0.6;
                    ctx.fillStyle = LANE_COLORS[t.lane];
                    ctx.fillRect(x + 3, t.y, laneW - 6, tileH);
                    ctx.globalAlpha = 1;
                    continue;
                }
                ctx.fillStyle = "#262644";
                ctx.fillRect(x + 3, t.y, laneW - 6, tileH);
                ctx.fillStyle = LANE_COLORS[t.lane];
                ctx.fillRect(x + 3, t.y + tileH - 7, laneW - 6, 7);
                // Note dot
                ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
                ctx.beginPath();
                ctx.arc(x + laneW / 2, t.y + tileH / 2, 7, 0, Math.PI * 2);
                ctx.fill();
            }

            if (!started && alive) {
                ctx.fillStyle = "rgba(242, 243, 255, 0.85)";
                ctx.font = "700 17px system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("Tap the tiles as they fall!", W / 2, H * 0.42);
                ctx.font = "500 14px system-ui, sans-serif";
                ctx.fillStyle = "rgba(154, 160, 195, 0.9)";
                ctx.fillText("Always tap the lowest tile \u2014 don't let one pass!", W / 2, H * 0.42 + 26);
            }

            // Lives hearts
            for (let i = 0; i < MAX_LIVES; i++) {
                ctx.globalAlpha = i < lives ? 1 : 0.2;
                drawHeart(24 + i * 28, 26, 9);
            }
            ctx.globalAlpha = 1;

            // Grace flash: red vignette pulse
            if (grace > 0) {
                ctx.globalAlpha = grace / GRACE_TIME * 0.25 * (0.6 + Math.sin(grace * 14) * 0.4);
                ctx.fillStyle = "#ff4d6d";
                ctx.fillRect(0, 0, W, H);
                ctx.globalAlpha = 1;
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

        function pointFromEvent(e) {
            const rect = canvas.getBoundingClientRect();
            const src = e.changedTouches ? e.changedTouches[0] : e;
            return { x: src.clientX - rect.left, y: src.clientY - rect.top };
        }

        function onPointerDown(e) {
            e.preventDefault();
            // Support multi-touch: process every new finger.
            if (e.changedTouches) {
                const rect = canvas.getBoundingClientRect();
                for (const t of e.changedTouches) {
                    tapAt(t.clientX - rect.left, t.clientY - rect.top);
                }
            } else {
                const p = pointFromEvent(e);
                tapAt(p.x, p.y);
            }
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
    window.SGGames.taptiles = {
        id: "taptiles",
        name: "Tap Tiles",
        emoji: "\u{1F3B9}",
        tag: "Tap the falling tiles. Play the tune.",
        scoreLabel: "notes",
        create: create
    };
})();
