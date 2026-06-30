/* ============ Simple Games — sound effects (WebAudio, no files) ============ */
(function () {
    "use strict";

    const KEY = "simple-games-sound";
    const MASTER = 0.5;

    let ctx = null;
    let enabled = true;
    try {
        enabled = localStorage.getItem(KEY) !== "off";
    } catch (err) { /* default to on */ }

    function ensureCtx() {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        if (!ctx) {
            try { ctx = new AC(); } catch (err) { return null; }
        }
        if (ctx.state === "suspended") ctx.resume();
        return ctx;
    }

    /** Simple oscillator beep with optional pitch slide. */
    function tone(freq, dur, opts) {
        opts = opts || {};
        const t0 = ctx.currentTime + (opts.delay || 0);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = opts.type || "square";
        osc.frequency.setValueAtTime(freq, t0);
        if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(opts.slide, 1), t0 + dur);
        const vol = (opts.vol || 0.2) * MASTER;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(vol, t0 + (opts.attack || 0.008));
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.06);
    }

    /** Filtered white noise burst (hits, explosions, whacks). */
    function noise(dur, opts) {
        opts = opts || {};
        const t0 = ctx.currentTime + (opts.delay || 0);
        const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
        const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = opts.filterType || "lowpass";
        filter.frequency.setValueAtTime(opts.filter || 1200, t0);
        if (opts.filterSlide) filter.frequency.exponentialRampToValueAtTime(Math.max(opts.filterSlide, 40), t0 + dur);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime((opts.vol || 0.25) * MASTER, t0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        src.start(t0);
        src.stop(t0 + dur);
    }

    const FX = {
        tap() { tone(440, 0.07, { type: "sine", slide: 560, vol: 0.14 }); },
        flip() { tone(900, 0.05, { type: "sine", vol: 0.1 }); },
        eat() {
            tone(640, 0.07, { vol: 0.12 });
            tone(960, 0.1, { vol: 0.12, delay: 0.06 });
        },
        score() {
            tone(660, 0.07, { type: "triangle", vol: 0.18 });
            tone(990, 0.11, { type: "triangle", vol: 0.18, delay: 0.07 });
        },
        match() {
            tone(523, 0.08, { type: "triangle", vol: 0.18 });
            tone(784, 0.12, { type: "triangle", vol: 0.18, delay: 0.08 });
        },
        perfect() {
            tone(523, 0.09, { type: "triangle", vol: 0.16 });
            tone(659, 0.09, { type: "triangle", vol: 0.16, delay: 0.07 });
            tone(784, 0.09, { type: "triangle", vol: 0.16, delay: 0.14 });
            tone(1047, 0.16, { type: "triangle", vol: 0.18, delay: 0.21 });
        },
        flap() { tone(380, 0.09, { type: "sine", slide: 720, vol: 0.12 }); },
        jump() { tone(300, 0.12, { type: "square", slide: 620, vol: 0.1 }); },
        bounce() { tone(520, 0.05, { type: "sine", slide: 660, vol: 0.12 }); },
        note0() { tone(261.63, 0.3, { type: "triangle", vol: 0.22 }); },
        note1() { tone(329.63, 0.3, { type: "triangle", vol: 0.22 }); },
        note2() { tone(392.00, 0.3, { type: "triangle", vol: 0.22 }); },
        note3() { tone(523.25, 0.3, { type: "triangle", vol: 0.22 }); },
        kick() {
            tone(150, 0.18, { type: "sine", slide: 48, vol: 0.3 });
        },
        hat() { noise(0.04, { filterType: "highpass", filter: 6000, vol: 0.1 }); },
        shoot() { tone(820, 0.1, { type: "sawtooth", slide: 160, vol: 0.05 }); },
        hit() { noise(0.07, { filter: 1900, vol: 0.14 }); },
        explode() {
            noise(0.35, { filter: 1000, filterSlide: 120, vol: 0.3 });
            tone(130, 0.3, { type: "triangle", slide: 45, vol: 0.2 });
        },
        drop() {
            tone(170, 0.12, { type: "triangle", slide: 85, vol: 0.26 });
            noise(0.05, { filter: 900, vol: 0.1 });
        },
        whack() {
            noise(0.06, { filter: 2400, vol: 0.22 });
            tone(220, 0.1, { slide: 90, vol: 0.16 });
        },
        wrong() {
            tone(220, 0.16, { slide: 170, vol: 0.1 });
            tone(165, 0.2, { slide: 130, vol: 0.1, delay: 0.13 });
        },
        miss() { tone(320, 0.28, { type: "sawtooth", slide: 130, vol: 0.12 }); },
        gameover() {
            tone(440, 0.16, { type: "triangle", vol: 0.18 });
            tone(330, 0.16, { type: "triangle", vol: 0.18, delay: 0.14 });
            tone(247, 0.16, { type: "triangle", vol: 0.18, delay: 0.28 });
            tone(165, 0.34, { type: "triangle", vol: 0.2, delay: 0.42 });
        },
        highscore() {
            tone(523, 0.1, { type: "triangle", vol: 0.18 });
            tone(659, 0.1, { type: "triangle", vol: 0.18, delay: 0.09 });
            tone(784, 0.1, { type: "triangle", vol: 0.18, delay: 0.18 });
            tone(1047, 0.14, { type: "triangle", vol: 0.2, delay: 0.27 });
            tone(1319, 0.3, { type: "triangle", vol: 0.2, delay: 0.4 });
        },
        bossroar() {
            // Low, snarling rumble that pitches down — a beast's bellow.
            tone(150, 0.5, { type: "sawtooth", slide: 60, vol: 0.26 });
            tone(90, 0.55, { type: "square", slide: 42, vol: 0.2, delay: 0.04 });
            noise(0.5, { filter: 700, filterSlide: 160, vol: 0.18 });
        },
        bosscharge() {
            // Rising whine that warns of an incoming heavy attack.
            tone(180, 0.45, { type: "sawtooth", slide: 720, vol: 0.12 });
            tone(240, 0.45, { type: "square", slide: 960, vol: 0.06, delay: 0.02 });
        },
        bossslam() {
            // Heavy ground impact: deep boom plus a gritty crunch.
            tone(110, 0.4, { type: "sine", slide: 36, vol: 0.34 });
            noise(0.4, { filter: 1400, filterSlide: 90, vol: 0.32 });
            tone(70, 0.34, { type: "square", slide: 30, vol: 0.18, delay: 0.02 });
        },
        bosslaser() {
            // Sustained energy beam: bright buzzing tone with a noisy edge.
            tone(680, 0.5, { type: "sawtooth", slide: 520, vol: 0.12 });
            tone(1020, 0.5, { type: "square", slide: 760, vol: 0.06 });
            noise(0.5, { filterType: "highpass", filter: 2600, vol: 0.08 });
        },
        missile() {
            // Quick whoosh-launch for projectile salvos.
            tone(520, 0.18, { type: "sawtooth", slide: 1080, vol: 0.07 });
            noise(0.12, { filterType: "highpass", filter: 3200, vol: 0.06 });
        },
        bossswoop() {
            // Airy dive — a falling whoosh for the flying boss.
            tone(900, 0.3, { type: "sine", slide: 220, vol: 0.1 });
            noise(0.3, { filterType: "bandpass", filter: 1800, filterSlide: 500, vol: 0.1 });
        },
        bosszap() {
            // Electric crack: a sharp zap with a bright crackle for lightning.
            tone(1200, 0.16, { type: "sawtooth", slide: 180, vol: 0.12 });
            tone(440, 0.12, { type: "square", slide: 90, vol: 0.08, delay: 0.01 });
            noise(0.22, { filterType: "highpass", filter: 3400, filterSlide: 1200, vol: 0.16 });
        }
    };

    window.SGSound = {
        isEnabled() {
            return enabled;
        },
        setEnabled(on) {
            enabled = !!on;
            try { localStorage.setItem(KEY, enabled ? "on" : "off"); } catch (err) { /* ignore */ }
            if (enabled) ensureCtx();
        },
        toggle() {
            this.setEnabled(!enabled);
            return enabled;
        },
        /** Call from a user gesture so mobile browsers allow audio. */
        unlock() {
            if (enabled) ensureCtx();
        },
        play(name) {
            if (!enabled) return;
            if (!ensureCtx()) return;
            const fx = FX[name];
            if (!fx) return;
            try { fx(); } catch (err) { /* sound must never break a game */ }
        },
        /** Play an arbitrary melodic note (frequency in Hz). */
        note(freq, dur, vol) {
            if (!enabled) return;
            if (!ensureCtx()) return;
            try {
                tone(freq, dur || 0.28, { type: "triangle", vol: vol || 0.22 });
            } catch (err) { /* sound must never break a game */ }
        }
    };
})();
