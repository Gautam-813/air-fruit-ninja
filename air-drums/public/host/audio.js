function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function createNoiseBuffer(context, duration) {
    const frameCount = Math.floor(context.sampleRate * duration);
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const samples = buffer.getChannelData(0);

    for (let index = 0; index < frameCount; index++) {
        samples[index] = Math.random() * 2 - 1;
    }

    return buffer;
}

function createImpulseResponse(context, duration) {
    const frameCount = Math.floor(context.sampleRate * duration);
    const impulse = context.createBuffer(2, frameCount, context.sampleRate);

    for (let channel = 0; channel < 2; channel++) {
        const samples = impulse.getChannelData(channel);

        for (let index = 0; index < frameCount; index++) {
            const decay = Math.pow(1 - index / frameCount, 3.4);
            samples[index] = (Math.random() * 2 - 1) * decay;
        }
    }

    return impulse;
}

export function createDholAudio() {
    let context = null;
    let master = null;
    let compressor = null;
    let analyser = null;
    let reverb = null;
    let reverbSend = null;
    let reverbWet = null;
    let noiseBuffer = null;
    let levelBuffer = null;

    let volume = 0.75;
    let bpm = 96;
    let activeVoices = 0;

    let metronomeTimer = null;
    let nextBeatTime = 0;
    let beatIndex = 0;
    let beatCallback = null;

    function init() {
        if (!context) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;

            if (!AudioContextClass) return null;

            context = new AudioContextClass();
            levelBuffer = new Float32Array(512);

            master = context.createGain();
            master.gain.value = volume;

            compressor = context.createDynamicsCompressor();
            compressor.threshold.value = -16;
            compressor.knee.value = 20;
            compressor.ratio.value = 4;
            compressor.attack.value = 0.004;
            compressor.release.value = 0.2;

            analyser = context.createAnalyser();
            analyser.fftSize = 512;
            analyser.smoothingTimeConstant = 0.55;

            reverb = context.createConvolver();
            reverb.buffer = createImpulseResponse(context, 0.6);

            reverbSend = context.createGain();
            reverbSend.gain.value = 0.32;

            reverbWet = context.createGain();
            reverbWet.gain.value = 0.55;

            const reverbTone = context.createBiquadFilter();
            reverbTone.type = "lowpass";
            reverbTone.frequency.value = 3200;

            reverbSend.connect(reverb);
            reverb.connect(reverbTone);
            reverbTone.connect(reverbWet);
            reverbWet.connect(master);

            master.connect(compressor);
            compressor.connect(analyser);
            analyser.connect(context.destination);

            noiseBuffer = createNoiseBuffer(context, 1);
        }

        if (context.state === "suspended") {
            context.resume().catch(() => {});
        }

        return context;
    }

    function markVoice(source) {
        activeVoices++;
        source.addEventListener("ended", () => {
            activeVoices = Math.max(0, activeVoices - 1);
        }, { once: true });
    }

    function connectVoice(source, gain) {
        gain.connect(master);
        gain.connect(reverbSend);
        source.connect(gain);
    }

    function playNoise({
        time,
        duration,
        gainValue,
        filterType,
        frequency,
        endFrequency,
        q
    }) {
        const source = context.createBufferSource();
        source.buffer = noiseBuffer;

        const filter = context.createBiquadFilter();
        filter.type = filterType || "bandpass";
        filter.Q.value = q ?? 1;
        filter.frequency.setValueAtTime(frequency, time);

        if (endFrequency) {
            filter.frequency.exponentialRampToValueAtTime(
                Math.max(20, endFrequency),
                time + duration
            );
        }

        const gain = context.createGain();
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(
            Math.max(0.0002, gainValue),
            time + 0.004
        );
        gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

        source.connect(filter);
        filter.connect(gain);
        gain.connect(master);
        gain.connect(reverbSend);

        const offset = Math.random() * Math.max(0.001, 0.85 - duration);
        source.start(time, offset, duration);
        source.stop(time + duration + 0.01);

        markVoice(source);
    }

    function playBass(intensity = 0.7) {
        const audio = init();
        if (!audio) return;

        const amount = clamp(intensity, 0.2, 1);
        const level = 0.5 + amount * 0.5;
        const time = audio.currentTime + 0.002;
        const detune = 1 + (Math.random() * 0.04 - 0.02);

        const body = audio.createOscillator();
        body.type = "sine";
        body.frequency.setValueAtTime((112 + amount * 20) * detune, time);
        body.frequency.exponentialRampToValueAtTime(54 * detune, time + 0.24);

        const bodyGain = audio.createGain();
        bodyGain.gain.setValueAtTime(0.0001, time);
        bodyGain.gain.exponentialRampToValueAtTime(0.9 * level, time + 0.008);
        bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.55);

        connectVoice(body, bodyGain);
        body.start(time);
        body.stop(time + 0.58);
        markVoice(body);

        const overtone = audio.createOscillator();
        overtone.type = "triangle";
        overtone.frequency.setValueAtTime(178 * detune, time);
        overtone.frequency.exponentialRampToValueAtTime(86 * detune, time + 0.16);

        const overtoneGain = audio.createGain();
        overtoneGain.gain.setValueAtTime(0.0001, time);
        overtoneGain.gain.exponentialRampToValueAtTime(0.2 * level, time + 0.006);
        overtoneGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.2);

        connectVoice(overtone, overtoneGain);
        overtone.start(time);
        overtone.stop(time + 0.22);
        markVoice(overtone);

        playNoise({
            time,
            duration: 0.045,
            gainValue: 0.3 * level,
            filterType: "bandpass",
            frequency: 1800,
            endFrequency: 900,
            q: 0.9
        });
    }

    function playTreble(intensity = 0.7) {
        const audio = init();
        if (!audio) return;

        const amount = clamp(intensity, 0.2, 1);
        const level = 0.45 + amount * 0.45;
        const time = audio.currentTime + 0.002;
        const detune = 1 + (Math.random() * 0.05 - 0.025);

        const body = audio.createOscillator();
        body.type = "triangle";
        body.frequency.setValueAtTime((420 + amount * 70) * detune, time);
        body.frequency.exponentialRampToValueAtTime(265 * detune, time + 0.09);

        const bodyGain = audio.createGain();
        bodyGain.gain.setValueAtTime(0.0001, time);
        bodyGain.gain.exponentialRampToValueAtTime(0.55 * level, time + 0.005);
        bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.2);

        connectVoice(body, bodyGain);
        body.start(time);
        body.stop(time + 0.22);
        markVoice(body);

        const overtone = audio.createOscillator();
        overtone.type = "sine";
        overtone.frequency.setValueAtTime(724 * detune, time);
        overtone.frequency.exponentialRampToValueAtTime(510 * detune, time + 0.08);

        const overtoneGain = audio.createGain();
        overtoneGain.gain.setValueAtTime(0.0001, time);
        overtoneGain.gain.exponentialRampToValueAtTime(0.18 * level, time + 0.004);
        overtoneGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);

        connectVoice(overtone, overtoneGain);
        overtone.start(time);
        overtone.stop(time + 0.14);
        markVoice(overtone);

        const ring = audio.createOscillator();
        ring.type = "sine";
        ring.frequency.setValueAtTime(1380 * detune, time);

        const ringGain = audio.createGain();
        ringGain.gain.setValueAtTime(0.0001, time);
        ringGain.gain.exponentialRampToValueAtTime(0.08 * level, time + 0.003);
        ringGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);

        connectVoice(ring, ringGain);
        ring.start(time);
        ring.stop(time + 0.08);
        markVoice(ring);

        playNoise({
            time,
            duration: 0.03,
            gainValue: 0.32 * level,
            filterType: "bandpass",
            frequency: 2900,
            endFrequency: 1700,
            q: 1.1
        });

        playNoise({
            time,
            duration: 0.018,
            gainValue: 0.16 * level,
            filterType: "highpass",
            frequency: 5200,
            q: 0.7
        });
    }

    function playRim(intensity = 0.6) {
        const audio = init();
        if (!audio) return;

        const amount = clamp(intensity, 0.2, 1);
        const level = 0.4 + amount * 0.4;
        const time = audio.currentTime + 0.002;

        const click = audio.createOscillator();
        click.type = "triangle";
        click.frequency.setValueAtTime(780, time);
        click.frequency.exponentialRampToValueAtTime(680, time + 0.045);

        const clickGain = audio.createGain();
        clickGain.gain.setValueAtTime(0.0001, time);
        clickGain.gain.exponentialRampToValueAtTime(0.18 * level, time + 0.003);
        clickGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);

        connectVoice(click, clickGain);
        click.start(time);
        click.stop(time + 0.08);
        markVoice(click);

        playNoise({
            time,
            duration: 0.035,
            gainValue: 0.28 * level,
            filterType: "bandpass",
            frequency: 2100,
            q: 6
        });
    }

    function playDhaAccent(intensity = 0.8) {
        const audio = init();
        if (!audio) return;

        const amount = clamp(intensity, 0.2, 1);
        const time = audio.currentTime + 0.002;

        const sub = audio.createOscillator();
        sub.type = "sine";
        sub.frequency.setValueAtTime(62, time);
        sub.frequency.exponentialRampToValueAtTime(43, time + 0.3);

        const subGain = audio.createGain();
        subGain.gain.setValueAtTime(0.0001, time);
        subGain.gain.exponentialRampToValueAtTime(0.16 + amount * 0.1, time + 0.01);
        subGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.34);

        connectVoice(sub, subGain);
        sub.start(time);
        sub.stop(time + 0.36);
        markVoice(sub);
    }

    function playReadyChime() {
        const audio = init();
        if (!audio) return;

        const time = audio.currentTime + 0.02;
        const notes = [
            { frequency: 523.25, offset: 0 },
            { frequency: 783.99, offset: 0.1 }
        ];

        for (const note of notes) {
            const start = time + note.offset;
            const oscillator = audio.createOscillator();
            oscillator.type = "sine";
            oscillator.frequency.setValueAtTime(note.frequency, start);

            const gain = audio.createGain();
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(0.12, start + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);

            connectVoice(oscillator, gain);
            oscillator.start(start);
            oscillator.stop(start + 0.22);
            markVoice(oscillator);
        }
    }

    function playMetronomeClick(time, accent) {
        const oscillator = context.createOscillator();
        oscillator.type = "triangle";
        oscillator.frequency.value = accent ? 1560 : 1040;

        const gain = context.createGain();
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(accent ? 0.12 : 0.07, time + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);

        oscillator.connect(gain);
        gain.connect(master);

        oscillator.start(time);
        oscillator.stop(time + 0.06);
        markVoice(oscillator);
    }

    function scheduleMetronome() {
        if (!context) return;

        const secondsPerBeat = 60 / bpm;
        const scheduleUntil = context.currentTime + 0.12;

        while (nextBeatTime < scheduleUntil) {
            const beat = beatIndex % 4;
            const scheduledTime = nextBeatTime;

            playMetronomeClick(scheduledTime, beat === 0);

            if (beatCallback) {
                const delay = Math.max(0, (scheduledTime - context.currentTime) * 1000);

                window.setTimeout(() => {
                    if (metronomeTimer !== null) {
                        beatCallback(beat);
                    }
                }, delay);
            }

            nextBeatTime += secondsPerBeat;
            beatIndex++;
        }
    }

    function startMetronome(callback) {
        const audio = init();
        if (!audio) return;

        stopMetronome();

        beatCallback = callback;
        beatIndex = 0;
        nextBeatTime = audio.currentTime + 0.15;
        metronomeTimer = window.setInterval(scheduleMetronome, 25);

        scheduleMetronome();
    }

    function stopMetronome() {
        if (metronomeTimer !== null) {
            window.clearInterval(metronomeTimer);
            metronomeTimer = null;
        }

        beatCallback = null;
    }

    function setBpm(value) {
        bpm = clamp(Math.round(Number(value) || 96), 40, 220);
    }

    function setVolume(value) {
        volume = clamp(Number(value) || 0, 0, 1);

        if (master && context) {
            master.gain.setTargetAtTime(volume, context.currentTime, 0.03);
        }
    }

    function getLevel() {
        if (!analyser || !levelBuffer) return 0;

        analyser.getFloatTimeDomainData(levelBuffer);

        let sum = 0;

        for (let index = 0; index < levelBuffer.length; index++) {
            sum += levelBuffer[index] * levelBuffer[index];
        }

        return Math.sqrt(sum / levelBuffer.length);
    }

    function getState() {
        return {
            ready: Boolean(context),
            contextState: context ? context.state : "closed",
            volume,
            bpm,
            metronome: metronomeTimer !== null,
            activeVoices,
            level: getLevel()
        };
    }

    return {
        init,
        setVolume,
        setBpm,
        startMetronome,
        stopMetronome,
        playBass,
        playTreble,
        playRim,
        playDhaAccent,
        playReadyChime,
        getLevel,
        getState
    };
}
