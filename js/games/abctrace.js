/* ============ ABC Trace — follow the path to draw each letter ============
   A gentle pre-reader game: trace each capital letter A→Z by dragging a
   finger along a dotted stroke guide. The device speaks the letter name and
   an example word ("A — Apple"). Tracing is forgiving — you only need to drag
   roughly along the path, touching the checkpoints in order.
   ====================================================================== */
(function () {
    "use strict";

    const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    // Example word + emoji per letter (kid-friendly, common emoji).
    const WORDS = {
        A: ["Apple", "\u{1F34E}"], B: ["Bear", "\u{1F43B}"], C: ["Cat", "\u{1F431}"],
        D: ["Dog", "\u{1F436}"], E: ["Elephant", "\u{1F418}"], F: ["Fish", "\u{1F41F}"],
        G: ["Grapes", "\u{1F347}"], H: ["Hat", "\u{1F3A9}"], I: ["Ice cream", "\u{1F366}"],
        J: ["Jet", "✈️"], K: ["Key", "\u{1F511}"], L: ["Lion", "\u{1F981}"],
        M: ["Moon", "\u{1F319}"], N: ["Nose", "\u{1F443}"], O: ["Orange", "\u{1F34A}"],
        P: ["Pig", "\u{1F437}"], Q: ["Queen", "\u{1F451}"], R: ["Rainbow", "\u{1F308}"],
        S: ["Sun", "☀️"], T: ["Tiger", "\u{1F42F}"], U: ["Umbrella", "☂️"],
        V: ["Violin", "\u{1F3BB}"], W: ["Whale", "\u{1F433}"], X: ["X-ray", "\u{1FA7B}"],
        Y: ["Yo-yo", "\u{1FA80}"], Z: ["Zebra", "\u{1F993}"]
    };

    // ----- Stroke-path builders (normalized 0..1 letter box) -----
    function lineP(x1, y1, x2, y2) {
        const n = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / 0.04));
        const a = [];
        for (let i = 0; i <= n; i++) {
            const t = i / n;
            a.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
        }
        return a;
    }
    function arcP(cx, cy, rx, ry, d0, d1) {
        const steps = Math.max(8, Math.round(Math.abs(d1 - d0) / 10));
        const a = [];
        for (let i = 0; i <= steps; i++) {
            const d = (d0 + (d1 - d0) * i / steps) * Math.PI / 180;
            a.push({ x: cx + rx * Math.cos(d), y: cy + ry * Math.sin(d) });
        }
        return a;
    }
    function cat() {
        const out = [];
        for (let k = 0; k < arguments.length; k++) {
            const arr = arguments[k];
            for (const p of arr) {
                const last = out[out.length - 1];
                if (last && Math.abs(last.x - p.x) < 1e-4 && Math.abs(last.y - p.y) < 1e-4) continue;
                out.push(p);
            }
        }
        return out;
    }
    function path(coords) {
        const segs = [];
        for (let i = 0; i + 3 < coords.length; i += 2) {
            segs.push(lineP(coords[i], coords[i + 1], coords[i + 2], coords[i + 3]));
        }
        return cat.apply(null, segs);
    }

    // Each letter is an array of strokes; each stroke is a dense point list.
    const LETTERS = {
        A: [lineP(.15, .92, .5, .08), lineP(.5, .08, .85, .92), lineP(.3, .6, .7, .6)],
        B: [lineP(.27, .08, .27, .92), arcP(.27, .30, .30, .22, -90, 90), arcP(.27, .72, .34, .20, -90, 90)],
        C: [arcP(.55, .5, .33, .42, 305, 55)],
        D: [lineP(.27, .08, .27, .92), arcP(.27, .5, .44, .42, -90, 90)],
        E: [lineP(.27, .08, .27, .92), lineP(.27, .08, .72, .08), lineP(.27, .5, .62, .5), lineP(.27, .92, .72, .92)],
        F: [lineP(.27, .08, .27, .92), lineP(.27, .08, .72, .08), lineP(.27, .5, .62, .5)],
        G: [arcP(.55, .5, .33, .42, 305, 20), lineP(.86, .64, .58, .64)],
        H: [lineP(.27, .08, .27, .92), lineP(.73, .08, .73, .92), lineP(.27, .5, .73, .5)],
        I: [lineP(.32, .08, .68, .08), lineP(.5, .08, .5, .92), lineP(.32, .92, .68, .92)],
        J: [cat(lineP(.66, .08, .66, .7), arcP(.46, .7, .2, .22, 0, 180))],
        K: [lineP(.27, .08, .27, .92), lineP(.72, .08, .27, .52), lineP(.4, .45, .75, .92)],
        L: [cat(lineP(.3, .08, .3, .92), lineP(.3, .92, .72, .92))],
        M: [cat(lineP(.18, .92, .18, .08), lineP(.18, .08, .5, .62), lineP(.5, .62, .82, .08), lineP(.82, .08, .82, .92))],
        N: [cat(lineP(.24, .92, .24, .08), lineP(.24, .08, .76, .92), lineP(.76, .92, .76, .08))],
        O: [arcP(.5, .5, .36, .42, 90, 450)],
        P: [lineP(.27, .92, .27, .08), arcP(.27, .3, .4, .22, -90, 90)],
        Q: [arcP(.5, .48, .36, .4, 90, 450), lineP(.6, .62, .86, .92)],
        R: [lineP(.27, .92, .27, .08), arcP(.27, .3, .4, .22, -90, 90), lineP(.37, .52, .76, .92)],
        S: [path([.78, .22, .66, .12, .46, .11, .3, .2, .28, .36, .42, .46, .6, .54, .72, .66, .7, .82, .54, .9, .34, .89, .22, .78])],
        T: [lineP(.18, .08, .82, .08), lineP(.5, .08, .5, .92)],
        U: [cat(lineP(.27, .08, .27, .6), arcP(.5, .6, .23, .32, 180, 0), lineP(.73, .6, .73, .08))],
        V: [cat(lineP(.18, .08, .5, .92), lineP(.5, .92, .82, .08))],
        W: [cat(lineP(.12, .08, .32, .92), lineP(.32, .92, .5, .35), lineP(.5, .35, .68, .92), lineP(.68, .92, .88, .08))],
        X: [lineP(.22, .08, .78, .92), lineP(.78, .08, .22, .92)],
        Y: [cat(lineP(.22, .08, .5, .5), lineP(.5, .5, .5, .92)), lineP(.78, .08, .5, .5)],
        Z: [cat(lineP(.22, .08, .78, .08), lineP(.78, .08, .22, .92), lineP(.22, .92, .78, .92))]
    };

    function resample(pts, spacing) {
        const wp = [{ x: pts[0].x, y: pts[0].y, hit: false }];
        let acc = 0;
        for (let i = 1; i < pts.length; i++) {
            acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
            if (acc >= spacing) { wp.push({ x: pts[i].x, y: pts[i].y, hit: false }); acc = 0; }
        }
        const last = pts[pts.length - 1], lw = wp[wp.length - 1];
        if (Math.hypot(last.x - lw.x, last.y - lw.y) > spacing * 0.4) {
            wp.push({ x: last.x, y: last.y, hit: false });
        }
        return wp;
    }

    function speak(text) {
        try {
            if (!SGSound.isEnabled() || !("speechSynthesis" in window)) return;
            window.speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(text);
            u.rate = 0.85; u.pitch = 1.15; u.volume = 1;
            window.speechSynthesis.speak(u);
        } catch (e) { /* speech is a nice-to-have; never break the game */ }
    }

    // Speak, then run cb once speech finishes (so the game waits for it).
    // Falls back to a timer when speech is muted/unavailable or never ends.
    function speakThen(text, cb) {
        let called = false;
        function done() { if (!called) { called = true; if (cb) cb(); } }
        try {
            if (!SGSound.isEnabled() || !("speechSynthesis" in window)) {
                setTimeout(done, 650);
                return;
            }
            window.speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(text);
            u.rate = 0.85; u.pitch = 1.15; u.volume = 1;
            u.onend = done;
            u.onerror = done;
            window.speechSynthesis.speak(u);
            setTimeout(done, 1400 + text.length * 95);   // safety net
        } catch (e) { setTimeout(done, 650); }
    }

    function create(host) {
        const canvas = host.canvas;
        const ctx = canvas.getContext("2d");
        const kids = !!host.kids;
        const TOL = kids ? 0.19 : 0.15;     // how close a finger must come to a checkpoint

        let W, H, headerH, boxSize, boxX, boxY;
        let letterIdx, strokes, curStroke, completed;
        let celebrating, sparkles, dragging, pulse, spokeFirst;
        let gen = 0, destroyed = false;     // generation guard for async speech callbacks
        let rafId, lastTs;
        let speakerRect = null, skipRect = null;

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = canvas.clientWidth;
            H = canvas.clientHeight;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            headerH = Math.min(110, H * 0.18);
            const availH = H - headerH - 22;
            const availW = W - 28;
            boxSize = Math.max(80, Math.min(availW, availH));
            boxX = (W - boxSize) / 2;
            boxY = headerH + (H - headerH - boxSize) / 2;
        }

        function initLetter(i) {
            letterIdx = i;
            gen++;                  // invalidate any pending speech callback
            celebrating = false;
            const ch = ALPHABET[i];
            strokes = LETTERS[ch].map(function (pts) {
                return { pts: pts, wps: resample(pts, 0.085), reached: 0, done: false };
            });
            curStroke = 0;
            speak(ch);
        }

        function reset() {
            completed = 0;
            sparkles = [];
            dragging = false;
            pulse = 0;
            celebrating = false;
            spokeFirst = false;
            lastTs = 0;
            host.setScore(0);
            initLetter(0);
        }

        // ----- coordinate mapping -----
        function SX(nx) { return boxX + nx * boxSize; }
        function SY(ny) { return boxY + ny * boxSize; }

        function letterComplete() {
            const ch = ALPHABET[letterIdx];
            completed += 1;
            host.setScore(completed);
            celebrating = true;
            SGSound.play("highscore");
            host.vibrate([15, 30, 15]);
            for (let i = 0; i < 26; i++) {
                const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 200;
                sparkles.push({
                    x: boxX + boxSize / 2, y: boxY + boxSize / 2,
                    vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
                    life: 1, color: ["#ffd166", "#ff7bd5", "#7bd0ff", "#9bff8e"][i % 4]
                });
            }
            // Speak "A is for Apple" (letter once), then move on when it finishes.
            const g = gen;
            speakThen(ch + " is for " + WORDS[ch][0], function () {
                if (destroyed || g !== gen) return;
                celebrating = false;
                advance();
            });
        }

        function advance() {
            if (letterIdx + 1 >= ALPHABET.length) {
                host.gameOver(completed);
                return;
            }
            initLetter(letterIdx + 1);
        }

        function traceAt(px, py) {
            if (celebrating) return;
            const nx = (px - boxX) / boxSize, ny = (py - boxY) / boxSize;
            const s = strokes[curStroke];
            if (!s) return;
            // Advance through as many checkpoints as the finger currently covers
            // (in order), so quick drags don't skip ahead unfairly.
            let advanced = false;
            while (s.reached < s.wps.length) {
                const w = s.wps[s.reached];
                if (Math.hypot(nx - w.x, ny - w.y) <= TOL) {
                    w.hit = true; s.reached++; advanced = true;
                } else break;
            }
            if (advanced) {
                if (s.reached % 2 === 0) SGSound.play("flip");
                if (s.reached >= s.wps.length) {
                    s.done = true;
                    curStroke++;
                    SGSound.play("match");
                    host.vibrate(10);
                    if (curStroke >= strokes.length) letterComplete();
                }
            }
        }

        // ----- drawing -----
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

        function strokeThroughPts(pts, from, to, color, width) {
            if (to - from < 1) return;
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(SX(pts[from].x), SY(pts[from].y));
            for (let i = from + 1; i <= to; i++) ctx.lineTo(SX(pts[i].x), SY(pts[i].y));
            ctx.stroke();
        }

        function drawButton(rect, label) {
            ctx.fillStyle = "rgba(255,255,255,0.18)";
            roundRect(rect.x, rect.y, rect.w, rect.h, 12);
            ctx.fillStyle = "#fff";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.font = Math.floor(rect.h * 0.5) + "px system-ui, sans-serif";
            ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
        }

        function draw() {
            // Cheerful sky background
            const g = ctx.createLinearGradient(0, 0, 0, H);
            g.addColorStop(0, "#3b6fd4");
            g.addColorStop(1, "#6db0e8");
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, W, H);

            const ch = ALPHABET[letterIdx];
            const word = WORDS[ch];

            // ---- Header: big letter (left) + emoji & word as a centered block ----
            ctx.textBaseline = "middle";
            ctx.textAlign = "left";
            ctx.fillStyle = "#fff8d6";
            ctx.font = "800 " + Math.floor(headerH * 0.6) + "px system-ui, sans-serif";
            ctx.fillText(ch + ch.toLowerCase(), 16, headerH * 0.5);

            const exCx = W * 0.62;          // centre the emoji over its word
            ctx.textAlign = "center";
            ctx.font = Math.floor(headerH * 0.36) + "px system-ui, sans-serif";
            ctx.fillText(word[1], exCx, headerH * 0.37);
            ctx.fillStyle = "#ffffff";
            ctx.font = "700 " + Math.floor(headerH * 0.2) + "px system-ui, sans-serif";
            ctx.fillText(ch + " is for " + word[0], exCx, headerH * 0.74);

            // Buttons (speaker = replay, skip = next letter)
            const bs = Math.min(44, headerH * 0.5);
            speakerRect = { x: 16, y: headerH + 4, w: bs, h: bs };
            skipRect = { x: W - bs - 16, y: headerH + 4, w: bs, h: bs };
            // place buttons over the panel's top corners after the panel draws

            // ---- Trace panel ----
            ctx.fillStyle = "rgba(255,255,255,0.92)";
            roundRect(boxX, boxY, boxSize, boxSize, 22);

            // Guide strokes
            const track = Math.max(10, boxSize * 0.05);
            for (let si = 0; si < strokes.length; si++) {
                const s = strokes[si];
                // Faint full path
                strokeThroughPts(s.pts, 0, s.pts.length - 1, "#d3dae6", track);
            }
            // Traced (completed) progress in green over the guide
            for (let si = 0; si < strokes.length; si++) {
                const s = strokes[si];
                if (s.done) {
                    strokeThroughPts(s.pts, 0, s.pts.length - 1, "#4cd07a", track);
                } else if (si === curStroke && s.reached > 0) {
                    // map reached waypoints to a portion of the dense path
                    const frac = s.reached / s.wps.length;
                    const upto = Math.max(1, Math.floor(frac * (s.pts.length - 1)));
                    strokeThroughPts(s.pts, 0, upto, "#4cd07a", track);
                }
            }

            // Start dot + arrow on the current stroke's next checkpoint
            const cs = strokes[curStroke];
            if (cs && !celebrating) {
                const w = cs.wps[cs.reached] || cs.wps[cs.wps.length - 1];
                const wx = SX(w.x), wy = SY(w.y);
                const r = track * (0.7 + 0.18 * Math.sin(pulse * 4));
                ctx.fillStyle = cs.reached === 0 ? "#ff5d8f" : "#ff9d3d";
                ctx.beginPath();
                ctx.arc(wx, wy, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = "#fff";
                ctx.beginPath();
                ctx.arc(wx, wy, r * 0.42, 0, Math.PI * 2);
                ctx.fill();
                // Direction arrow toward the following checkpoint
                const nxt = cs.wps[cs.reached + 1] || cs.pts[cs.pts.length - 1];
                if (nxt) {
                    const ang = Math.atan2(SY(nxt.y) - wy, SX(nxt.x) - wx);
                    ctx.save();
                    ctx.translate(wx + Math.cos(ang) * r * 1.6, wy + Math.sin(ang) * r * 1.6);
                    ctx.rotate(ang);
                    ctx.fillStyle = "#ff5d8f";
                    ctx.beginPath();
                    ctx.moveTo(track * 0.5, 0);
                    ctx.lineTo(-track * 0.3, -track * 0.4);
                    ctx.lineTo(-track * 0.3, track * 0.4);
                    ctx.closePath();
                    ctx.fill();
                    ctx.restore();
                }
            }

            // Sparkles (letter-complete celebration)
            for (const p of sparkles) {
                ctx.globalAlpha = Math.max(0, p.life);
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;

            if (celebrating) {
                ctx.fillStyle = "#2a7d4a";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.font = "800 " + Math.floor(boxSize * 0.16) + "px system-ui, sans-serif";
                ctx.fillText("⭐ " + word[0] + "!", W / 2, boxY + boxSize / 2);
            }

            drawButton(speakerRect, "\u{1F50A}");
            drawButton(skipRect, "⏭️");
        }

        function update(dt) {
            pulse += dt;
            // Advancing to the next letter is driven by speech end (see
            // letterComplete), so update() only animates here.
            for (let i = sparkles.length - 1; i >= 0; i--) {
                const p = sparkles[i];
                p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt;
                p.life -= dt * 0.9;
                if (p.life <= 0) sparkles.splice(i, 1);
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

        // ----- input -----
        function pt(e) {
            const rect = canvas.getBoundingClientRect();
            const s = e.changedTouches ? e.changedTouches[0] : e;
            return { x: s.clientX - rect.left, y: s.clientY - rect.top };
        }
        function hit(rect, p) {
            return rect && p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
        }

        function onDown(e) {
            if (e.cancelable) e.preventDefault();
            const p = pt(e);
            // Unlock speech on the first gesture if the auto-announce was blocked.
            if (!spokeFirst) { spokeFirst = true; speak(ALPHABET[letterIdx]); }
            if (hit(speakerRect, p)) {
                if (!celebrating) {
                    const ch = ALPHABET[letterIdx];
                    speak(ch + " is for " + WORDS[ch][0]);
                }
                return;
            }
            if (hit(skipRect, p)) {
                SGSound.play("tap");
                if (letterIdx + 1 >= ALPHABET.length) host.gameOver(completed);
                else initLetter(letterIdx + 1);
                return;
            }
            dragging = true;
            traceAt(p.x, p.y);
        }
        function onMove(e) {
            if (!dragging) return;
            if (e.cancelable) e.preventDefault();
            const p = pt(e);
            traceAt(p.x, p.y);
        }
        function onUp() { dragging = false; }

        return {
            start() {
                resize();
                reset();
                window.addEventListener("resize", resize);
                canvas.addEventListener("touchstart", onDown, { passive: false });
                canvas.addEventListener("touchmove", onMove, { passive: false });
                canvas.addEventListener("touchend", onUp);
                canvas.addEventListener("mousedown", onDown);
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
                rafId = requestAnimationFrame(loop);
            },
            restart() {
                reset();
            },
            destroy() {
                destroyed = true;
                cancelAnimationFrame(rafId);
                try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
                window.removeEventListener("resize", resize);
                canvas.removeEventListener("touchstart", onDown);
                canvas.removeEventListener("touchmove", onMove);
                canvas.removeEventListener("touchend", onUp);
                canvas.removeEventListener("mousedown", onDown);
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
            }
        };
    }

    window.SGGames = window.SGGames || {};
    window.SGGames.abctrace = {
        id: "abctrace",
        name: "ABC Trace",
        emoji: "✏️",
        tag: "Trace each letter A–Z and hear it spoken.",
        scoreLabel: "letters",
        create: create
    };
})();
