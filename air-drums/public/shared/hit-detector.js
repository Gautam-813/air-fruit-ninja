const DEFAULTS = Object.freeze({
    threshold: 0.75,
    cooldownMs: 110,
    velocitySmoothing: 0.7,
    minDownwardDelta: 0.003,
    minY: 0.1,
    rearmFactor: 0.5
});

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function currentTime() {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export class DholHitDetector {
    constructor(options = {}) {
        this.options = { ...DEFAULTS, ...options };
        this.thresholds = { left: null, right: null };
        this.thresholdScale = 1;
        this.states = new Map();
        this.calibrating = false;
        this.calibrationPeaks = { left: 0, right: 0 };
        this.calibrationStart = 0;
    }

    setThresholds(values = {}) {
        for (const hand of ["left", "right"]) {
            const value = Number(values[hand]);
            this.thresholds[hand] = Number.isFinite(value) && value > 0
                ? clamp(value, 0.4, 5)
                : null;
        }
    }

    getThresholds() {
        return {
            left: this.thresholds.left,
            right: this.thresholds.right
        };
    }

    getEffectiveThresholds() {
        return {
            left: this.getThreshold("left"),
            right: this.getThreshold("right")
        };
    }

    setThresholdScale(scale) {
        this.thresholdScale = clamp(Number(scale) || 1, 0.35, 3);
    }

    getThreshold(hand) {
        return (this.thresholds[hand] ?? this.options.threshold) * this.thresholdScale;
    }

    getHandState(hand) {
        const state = this.states.get(hand);
        const threshold = this.getThreshold(hand);

        return {
            active: Boolean(state),
            velocity: state?.vy ?? 0,
            rawVelocity: state?.rawVelocity ?? 0,
            threshold,
            armed: state?.armed ?? true
        };
    }

    resetHand(hand) {
        this.states.delete(hand);
    }

    resetAll() {
        this.states.clear();
    }

    beginCalibration(now = currentTime()) {
        this.calibrating = true;
        this.calibrationPeaks = { left: 0, right: 0 };
        this.calibrationStart = now;
    }

    endCalibration() {
        this.calibrating = false;

        const suggested = {};

        for (const hand of ["left", "right"]) {
            const peak = this.calibrationPeaks[hand];
            suggested[hand] = peak >= 0.45
                ? clamp(peak * 0.35, 0.45, 2.6)
                : null;
        }

        return suggested;
    }

    update(hand, x, y, now = currentTime()) {
        if (hand !== "left" && hand !== "right") return null;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

        let state = this.states.get(hand);

        if (!state) {
            this.states.set(hand, {
                lastX: x,
                lastY: y,
                lastT: now,
                vy: 0,
                rawVelocity: 0,
                threshold: this.getThreshold(hand),
                lastHitAt: -Infinity,
                armed: true
            });

            return null;
        }

        const dt = Math.max(0.008, (now - state.lastT) / 1000);
        const dy = y - state.lastY;
        const rawVelocity = dt > 0.3 ? 0 : clamp(dy / dt, -15, 15);

        state.vy += (rawVelocity - state.vy) * this.options.velocitySmoothing;

        const threshold = this.getThreshold(hand);
        const downward = dy >= this.options.minDownwardDelta;

        state.rawVelocity = rawVelocity;
        state.threshold = threshold;

        state.lastX = x;
        state.lastY = y;
        state.lastT = now;

        if (this.calibrating) {
            if (rawVelocity > 0) {
                this.calibrationPeaks[hand] = Math.max(
                    this.calibrationPeaks[hand],
                    rawVelocity
                );
            }

            return null;
        }

        if (!state.armed && (state.vy < threshold * this.options.rearmFactor || dy < 0)) {
            state.armed = true;
        }

        if (!downward || !state.armed) return null;
        if (y < this.options.minY) return null;
        if (state.vy < threshold) return null;
        if (now - state.lastHitAt < this.options.cooldownMs) return null;

        state.lastHitAt = now;
        state.armed = false;

        const intensity = clamp(
            0.25 + ((state.vy - threshold) / (threshold * 1.6)) * 0.75,
            0.25,
            1
        );

        return {
            hand,
            stroke: hand === "left" ? "bass" : "treble",
            x,
            y,
            velocity: state.vy,
            threshold,
            intensity
        };
    }
}
