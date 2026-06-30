/* ============ Beat Loop — paint notes, hear your loop groove ============ */
(function () {
    "use strict";

    const STEPS = 8;
    const NOTE_ROWS = [
        { freq: 523.25, color: "#ff4d8d" },  // C5
        { freq: 440.00, color: "#ff8c42" },  // A4
        { freq: 392.00, color: "#ffd166" },  // G4
        { freq: 329.63, color: "#5ef58a" },  // E4
        { freq: 293.66, color: "#39d0ff" },  // D4
        { freq: 261.63, color: "#8e5bd6" }   // C4
    ];
    const KICK_ROW = NOTE_ROWS.length;       // bottom row is the drum
    const ROWS = NOTE_ROWS.length + 1;
    const STEP_DUR = 0.22;                   // ~136 BPM eighth notes

    function create(host) {
        const canvas = host.canvas;
        const ctx = canvas.getContext("2d");

        let W, H, cell, gridX, gridY, gap;
        let cells, flash, step, stepTimer, score, started, finished;
        let saveBtn, clearBtn;
        let rafId, lastTs;

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = canvas.clientWidth;
            H = canvas.clientHeight;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            gap = 5;
            cell = Math.min(
                (W - 24 - gap * (STEPS - 1)) / STEPS,
                (H - 160 - gap * (ROWS - 1)) / ROWS,
                58
            );
            gridX = (W - (cell * STEPS + gap * (STEPS - 1))) / 2;
            gridY = (H - (cell * ROWS + gap * (ROWS - 1))) / 2 + 16;
            saveBtn = { x: W - 118, y: 16, w: 102, h: 40 };
            clearBtn = { x: 16, y: 16, w: 88, h: 40 };
        }

        function reset() {
            cells = [];
            flash = [];
            for (let r = 0; r < ROWS; r++) {
                cells.push(new Array(STEPS).fill(false));
                flash.push(new Array(STEPS).fill(0));
            }
            // Seed a simple kick so the loop grooves right away.
            cells[KICK_ROW][0] = true;
            cells[KICK_ROW][4] = true;
            step = -1;
            stepTimer = 0;
            score = 0;
            started = false;
            finished = false;
            lastTs = 0;
            host.setScore(0);
        }

        function triggerColumn(col) {
            let played = 0;
            for (let r = 0; r < ROWS; r++) {
                if (!cells[r][col]) continue;
                flash[r][col] = 1;
                if (r === KICK_ROW) SGSound.play("kick");
                else SGSound.note(NOTE_ROWS[r].freq, 0.26, 0.2);
                played += 1;
            }
            if (played > 0) {
                score += played;
                host.setScore(score);
            }
        }

        function update(dt) {
            if (finished) return;
            stepTimer += dt;
            while (stepTimer >= STEP_DUR) {
                stepTimer -= STEP_DUR;
                step = (step + 1) % STEPS;
                triggerColumn(step);
            }
            for (let r = 0; r < ROWS; r++)
                for (let c = 0; c < STEPS; c++)
                    if (flash[r][c] > 0) flash[r][c] = Math.max(0, flash[r][c] - dt * 4);
        }

        function inRect(p, rect) {
            return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
        }

        function tapAt(p) {
            if (finished) return;
            if (inRect(p, saveBtn)) {
                finished = true;
                host.vibrate(10);
                host.gameOver(score);
                return;
            }
            if (inRect(p, clearBtn)) {
                for (let r = 0; r < ROWS; r++) cells[r].fill(false);
                host.vibrate(15);
                SGSound.play("flip");
                return;
            }
            const c = Math.floor((p.x - gridX) / (cell + gap));
            const r = Math.floor((p.y - gridY) / (cell + gap));
            if (c < 0 || c >= STEPS || r < 0 || r >= ROWS) return;
            // Ignore taps in the gaps between cells.
            if ((p.x - gridX) % (cell + gap) > cell || (p.y - gridY) % (cell + gap) > cell) return;

            cells[r][c] = !cells[r][c];
            started = true;
            host.vibrate(8);
            if (cells[r][c]) {
                // Preview the note you just placed.
                if (r === KICK_ROW) SGSound.play("kick");
                else SGSound.note(NOTE_ROWS[r].freq, 0.2, 0.16);
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

        function drawPill(rect, label, color) {
            ctx.fillStyle = color;
            roundRect(rect.x, rect.y, rect.w, rect.h, 20);
            ctx.fillStyle = "#f2f3ff";
            ctx.font = "700 14px system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
            ctx.textBaseline = "alphabetic";
        }

        function draw() {
            const grad = ctx.createLinearGradient(0, 0, 0, H);
            grad.addColorStop(0, "#161628");
            grad.addColorStop(1, "#241738");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, H);

            drawPill(clearBtn, "\u{1F9F9} Clear", "rgba(44, 44, 82, 0.9)");
            drawPill(saveBtn, "\u{1F4BE} Finish", "rgba(255, 77, 141, 0.85)");

            for (let r = 0; r < ROWS; r++) {
                const color = r === KICK_ROW ? "#9aa0c3" : NOTE_ROWS[r].color;
                for (let c = 0; c < STEPS; c++) {
                    const x = gridX + c * (cell + gap);
                    const y = gridY + r * (cell + gap);
                    const on = cells[r][c];
                    const fl = flash[r][c];

                    if (c === step) {
                        ctx.fillStyle = "rgba(255, 255, 255, 0.10)";
                        roundRect(x - 2, y - 2, cell + 4, cell + 4, 10);
                    }

                    ctx.save();
                    if (on && fl > 0) {
                        ctx.shadowColor = color;
                        ctx.shadowBlur = 18 * fl;
                    }
                    ctx.fillStyle = on ? color : "rgba(255, 255, 255, 0.07)";
                    ctx.globalAlpha = on ? 0.65 + fl * 0.35 : 1;
                    roundRect(x, y, cell, cell, 9);
                    ctx.restore();
                    ctx.globalAlpha = 1;

                    if (r === KICK_ROW && !on) {
                        ctx.fillStyle = "rgba(154, 160, 195, 0.4)";
                        ctx.font = Math.floor(cell * 0.4) + "px system-ui, sans-serif";
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        ctx.fillText("\u{1F941}", x + cell / 2, y + cell / 2 + 1);
                        ctx.textBaseline = "alphabetic";
                    }
                }
            }

            if (!started) {
                ctx.fillStyle = "rgba(242, 243, 255, 0.85)";
                ctx.font = "700 17px system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("Tap squares to paint your loop!", W / 2, gridY - 38);
                ctx.font = "500 14px system-ui, sans-serif";
                ctx.fillStyle = "rgba(154, 160, 195, 0.9)";
                ctx.fillText("Every note it plays earns a point", W / 2, gridY - 16);
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
            tapAt(pointFromEvent(e));
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
    window.SGGames.beatloop = {
        id: "beatloop",
        name: "Beat Loop",
        emoji: "\u{1F3B6}",
        tag: "Paint notes. Hear your loop groove.",
        scoreLabel: "notes",
        create: create
    };
})();
