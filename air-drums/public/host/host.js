import { createDholAudio } from "./audio.js";
import { createDholStage } from "./visuals.js";
import {
    MESSAGE_TYPES,
    DEFAULT_ROOM,
    parseServerMessage
} from "../shared/protocol.js";

const canvas = document.getElementById("stage");
const stage = createDholStage(canvas);
const audio = createDholAudio();

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const roomLabel = document.getElementById("roomLabel");
const welcomeRoom = document.getElementById("welcomeRoom");
const controllerUrl = document.getElementById("controllerUrl");

const hitCountElement = document.getElementById("hitCount");
const comboElement = document.getElementById("combo");
const controllerCountElement = document.getElementById("controllerCount");

const welcome = document.getElementById("welcome");
const startStageButton = document.getElementById("startStage");

const volumeInput = document.getElementById("volume");
const volumeValue = document.getElementById("volumeValue");
const metronomeInput = document.getElementById("metronome");
const bpmInput = document.getElementById("bpm");
const bpmValue = document.getElementById("bpmValue");
const guide = document.getElementById("guide");
const pairPhoneButton = document.getElementById("pairPhone");
const testSoundButton = document.getElementById("testSound");
const fullscreenButton = document.getElementById("fullscreen");
const toast = document.getElementById("toast");

const room = (new URLSearchParams(window.location.search).get("room") || DEFAULT_ROOM)
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 32) || DEFAULT_ROOM;

let socket = null;
let reconnectTimer = null;
let stageStarted = false;

let hitCount = 0;
let combo = 0;
let lastHitAt = 0;
let recentHits = [];

let controllerCount = 0;
let controllerLink = "";

let beatTimer = null;
let toastTimer = null;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function readStored(key, fallback) {
    try {
        const value = window.localStorage.getItem(key);
        return value === null ? fallback : value;
    } catch (error) {
        return fallback;
    }
}

function writeStored(key, value) {
    try {
        window.localStorage.setItem(key, String(value));
    } catch (error) {
        return undefined;
    }
}

function setStatus(message, state) {
    statusText.textContent = message;

    statusDot.classList.remove("connected", "waiting", "offline");

    if (state) {
        statusDot.classList.add(state);
    }
}

function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");

    window.clearTimeout(toastTimer);

    toastTimer = window.setTimeout(() => {
        toast.classList.remove("show");
    }, 2400);
}

function updatePresence() {
    controllerCountElement.textContent = String(controllerCount);

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        setStatus("Offline", "offline");
        return;
    }

    if (controllerCount > 0) {
        setStatus("Controller linked", "connected");
    } else {
        setStatus("Waiting for controller", "waiting");
    }
}

function connect() {
    if (
        socket &&
        (
            socket.readyState === WebSocket.OPEN ||
            socket.readyState === WebSocket.CONNECTING
        )
    ) {
        return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/?role=host&room=${encodeURIComponent(room)}`;
    const currentSocket = new WebSocket(url);

    socket = currentSocket;

    currentSocket.addEventListener("open", () => {
        if (socket !== currentSocket) return;

        window.clearTimeout(reconnectTimer);
        updatePresence();
    });

    currentSocket.addEventListener("message", event => {
        if (socket !== currentSocket) return;

        const message = parseServerMessage(event.data);
        if (!message) return;

        if (message.type === MESSAGE_TYPES.PRESENCE) {
            controllerCount = Number(message.controllers) || 0;
            updatePresence();
            return;
        }

        if (message.type === MESSAGE_TYPES.HAND_STATE) {
            stage.setHands(message.hands || []);
            return;
        }

        if (message.type === MESSAGE_TYPES.HIT) {
            if (!stageStarted) return;
            if (message.instrument && message.instrument !== "dhol") return;
            handleHit(message);
        }
    });

    currentSocket.addEventListener("close", () => {
        if (socket !== currentSocket) return;

        controllerCount = 0;
        controllerCountElement.textContent = "0";
        setStatus("Reconnecting", "offline");

        window.clearTimeout(reconnectTimer);

        reconnectTimer = window.setTimeout(connect, 1500);
    });

    currentSocket.addEventListener("error", () => {
        if (socket !== currentSocket) return;
        setStatus("Connection error", "offline");
    });
}

function handleHit(message) {
    const hand = message.hand === "right" ? "right" : "left";
    const stroke = message.stroke === "treble"
        ? "treble"
        : message.stroke === "rim"
            ? "rim"
            : "bass";
    const intensity = clamp(Number(message.intensity) || 0.7, 0.2, 1);

    if (stroke === "treble") {
        audio.playTreble(intensity);
    } else if (stroke === "rim") {
        audio.playRim(intensity);
    } else {
        audio.playBass(intensity);
    }

    const now = performance.now();
    let paired = false;

    if (stroke !== "rim") {
        const pairIndex = recentHits.findIndex(item =>
            item.stroke !== stroke && now - item.at < 110
        );

        if (pairIndex !== -1) {
            paired = true;
            recentHits.splice(pairIndex, 1);
            audio.playDhaAccent(intensity);
        }
    }

    recentHits.push({ stroke, at: now });
    recentHits = recentHits.filter(item => now - item.at < 260);

    stage.registerHit({
        hand,
        stroke,
        intensity,
        paired
    });

    hitCount++;

    if (now - lastHitAt < 1600) {
        combo++;
    } else {
        combo = 1;
    }

    lastHitAt = now;

    hitCountElement.textContent = String(hitCount);
    comboElement.textContent = `x${combo}`;

    comboElement.classList.remove("bump");
    void comboElement.offsetWidth;
    comboElement.classList.add("bump");
}

function setActiveBeat(beat) {
    const bols = guide.querySelectorAll(".bol");

    for (const bol of bols) {
        bol.classList.toggle("active", Number(bol.dataset.beat) === beat);
    }

    window.clearTimeout(beatTimer);

    beatTimer = window.setTimeout(() => {
        for (const bol of bols) {
            bol.classList.remove("active");
        }
    }, 170);

    stage.pulseBeat(beat === 0);
}

function clearBeat() {
    window.clearTimeout(beatTimer);

    for (const bol of guide.querySelectorAll(".bol")) {
        bol.classList.remove("active");
    }
}

function copyText(text) {
    if (navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(text);
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();

    return Promise.resolve();
}

async function loadControllerLink() {
    try {
        const response = await fetch("/health");

        if (!response.ok) return;

        const info = await response.json();

        controllerLink = `https://${info.ip}:${info.port}/controller/?room=${encodeURIComponent(room)}`;
        controllerUrl.textContent = controllerLink;
    } catch (error) {
        controllerUrl.textContent = "Open /controller/ on your phone";
    }
}

const storedVolume = Number(readStored("airDhol.volume", "75"));
const storedBpm = Number(readStored("airDhol.bpm", "96"));

if (Number.isFinite(storedVolume)) {
    volumeInput.value = String(clamp(Math.round(storedVolume), 0, 100));
}

if (Number.isFinite(storedBpm)) {
    bpmInput.value = String(clamp(Math.round(storedBpm), 60, 180));
}

volumeValue.textContent = volumeInput.value;
bpmValue.textContent = bpmInput.value;

audio.setVolume(Number(volumeInput.value) / 100);
audio.setBpm(Number(bpmInput.value));

roomLabel.textContent = room;
welcomeRoom.textContent = room;

volumeInput.addEventListener("input", () => {
    const value = Number(volumeInput.value);

    volumeValue.textContent = String(value);
    audio.setVolume(value / 100);
    writeStored("airDhol.volume", value);
});

bpmInput.addEventListener("input", () => {
    const value = Number(bpmInput.value);

    bpmValue.textContent = String(value);
    audio.setBpm(value);
    writeStored("airDhol.bpm", value);
});

metronomeInput.addEventListener("change", () => {
    if (metronomeInput.checked) {
        if (!stageStarted) {
            metronomeInput.checked = false;
            return;
        }

        audio.startMetronome(setActiveBeat);
        guide.hidden = false;
        showToast("Metronome on");
    } else {
        audio.stopMetronome();
        guide.hidden = true;
        clearBeat();
        showToast("Metronome off");
    }
});

pairPhoneButton.addEventListener("click", async () => {
    if (!controllerLink) {
        showToast("Controller link is still loading");
        return;
    }

    try {
        await copyText(controllerLink);
        showToast("Controller link copied");
    } catch (error) {
        showToast(controllerLink);
    }
});

testSoundButton.addEventListener("click", () => {
    audio.init();
    audio.setVolume(Number(volumeInput.value) / 100);
    audio.playBass(0.85);

    window.setTimeout(() => {
        audio.playTreble(0.85);
    }, 140);

    showToast("Test sound played. Check tab and system volume if silent.");
});

fullscreenButton.addEventListener("click", async () => {
    try {
        if (document.fullscreenElement) {
            await document.exitFullscreen();
        } else {
            await document.documentElement.requestFullscreen();
        }
    } catch (error) {
        showToast("Fullscreen is unavailable");
    }
});

startStageButton.addEventListener("click", () => {
    audio.init();
    audio.setVolume(Number(volumeInput.value) / 100);
    audio.setBpm(Number(bpmInput.value));
    audio.playReadyChime();

    stageStarted = true;
    recentHits = [];

    welcome.classList.add("hidden");
    welcome.setAttribute("aria-hidden", "true");
    welcome.inert = true;

    window.setTimeout(() => {
        welcome.style.display = "none";
    }, 520);

    updatePresence();
    showToast("Audio ready. Strike down on your phone.");
});

window.addEventListener("beforeunload", () => {
    window.clearTimeout(reconnectTimer);
    window.clearTimeout(beatTimer);
    window.clearTimeout(toastTimer);

    if (socket) {
        socket.close();
    }
});

window.airDhol = {
    audio,
    stage,
    simulateHit: (stroke = "bass", hand = "left", intensity = 0.8) => {
        handleHit({ stroke, hand, intensity });
    },
    getState: () => ({
        room,
        stageStarted,
        controllerCount,
        hitCount,
        combo,
        socketState: socket ? socket.readyState : -1,
        audio: audio.getState(),
        stage: stage.getState()
    })
};

loadControllerLink();
connect();
