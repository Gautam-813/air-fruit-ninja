export const MESSAGE_TYPES = Object.freeze({
    CONNECTED: "CONNECTED",
    PRESENCE: "PRESENCE",
    HIT: "HIT",
    HAND_STATE: "HAND_STATE"
});

export const STROKES = Object.freeze({
    BASS: "bass",
    TREBLE: "treble",
    RIM: "rim"
});

export const HANDS = Object.freeze({
    LEFT: "left",
    RIGHT: "right"
});

export const DEFAULT_ROOM = "main";
export const INSTRUMENT_ID = "dhol";
export const MAX_MESSAGE_BYTES = 8192;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export function createHitMessage({
    hand,
    stroke,
    intensity,
    x,
    y
}) {
    return {
        type: MESSAGE_TYPES.HIT,
        instrument: INSTRUMENT_ID,
        hand: hand === HANDS.LEFT ? HANDS.LEFT : HANDS.RIGHT,
        stroke: stroke === STROKES.TREBLE
            ? STROKES.TREBLE
            : stroke === STROKES.RIM
                ? STROKES.RIM
                : STROKES.BASS,
        intensity: clamp(Number(intensity) || 0.6, 0, 1),
        x: Number.isFinite(x) ? clamp(x, 0, 1) : 0.5,
        y: Number.isFinite(y) ? clamp(y, 0, 1) : 0.5,
        t: Date.now()
    };
}

export function createHandStateMessage(hands) {
    const payload = Array.isArray(hands)
        ? hands.slice(0, 4).map(item => ({
            hand: item.hand === HANDS.LEFT ? HANDS.LEFT : HANDS.RIGHT,
            x: Number.isFinite(item.x) ? clamp(item.x, 0, 1) : 0.5,
            y: Number.isFinite(item.y) ? clamp(item.y, 0, 1) : 0.5
        }))
        : [];

    return {
        type: MESSAGE_TYPES.HAND_STATE,
        instrument: INSTRUMENT_ID,
        hands: payload,
        t: Date.now()
    };
}

export function parseServerMessage(raw) {
    try {
        const message = JSON.parse(raw);

        if (!message || typeof message.type !== "string") {
            return null;
        }

        return message;
    } catch (error) {
        return null;
    }
}
