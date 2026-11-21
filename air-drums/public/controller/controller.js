import {
    FilesetResolver,
    HandLandmarker
} from "/vendor/mediapipe/vision_bundle.mjs";

import { DholHitDetector } from "../shared/hit-detector.js";
import {
    createHitMessage,
    createHandStateMessage,
    MESSAGE_TYPES,
    DEFAULT_ROOM,
    parseServerMessage
} from "../shared/protocol.js";

const TAU = Math.PI * 2;
const WASM_PATH = "/vendor/mediapipe/wasm";
const MODEL_URL = "/models/hand_landmarker.task";
const MAX_SOCKET_BUFFER = 8192;
const HAND_STATE_INTERVAL = 33;
const LANDMARK_SMOOTHING = 0.55;
const CALIBRATION_DURATION = 5000;
const PALM_IDS = [0, 5, 9, 13, 17];
const STRIKE_IDS = [8, 12];

const HAND_THEME = {
    left: {
        rgb: "255, 171, 74",
        main: "#ffab4a",
        light: "#ffe4b0"
    },
    right: {
        rgb: "103, 232, 232",
        main: "#67e8e8",
        light: "#c9fffb"
    }
};

const PAD_LAYOUT = {
    left: {
        centerX: 0.25,
        centerY: 0.63,
        width: 0.42,
        height: 0.56,
        title: "BASS",
        side: "LEFT"
    },
    right: {
        centerX: 0.75,
        centerY: 0.63,
        width: 0.42,
        height: 0.56,
        title: "TREBLE",
        side: "RIGHT"
    }
};

const camera = document.getElementById("camera");
const cameraFrame = document.getElementById("cameraFrame");
const overlay = document.getElementById("overlay");
const context = overlay.getContext("2d");

const statusElement = document.getElementById("status");
const serverPill = document.getElementById("serverPill");
const serverDot = document.getElementById("serverDot");
const serverText = document.getElementById("serverText");

const fpsElement = document.getElementById("fps");
const inferenceElement = document.getElementById("inference");
const handCountElement = document.getElementById("handCount");

const startCameraButton = document.getElementById("startCamera");
const calibrateButton = document.getElementById("calibrate");
const testHitButton = document.getElementById("testHit");
const reconnectButton = document.getElementById("reconnect");
const resetTuningButton = document.getElementById("resetTuning");

const leftStrikeFill = document.getElementById("leftStrikeFill");
const rightStrikeFill = document.getElementById("rightStrikeFill");
const leftStrikeValue = document.getElementById("leftStrikeValue");
const rightStrikeValue = document.getElementById("rightStrikeValue");

const sensitivityInput = document.getElementById("sensitivity");
const sensitivityValue = document.getElementById("sensitivityValue");
const thresholdsElement = document.getElementById("thresholds");

const calibrationBanner = document.getElementById("calibrationBanner");
const calibrationProgress = document.getElementById("calibrationProgress");

const room = (new URLSearchParams(window.location.search).get("room") || DEFAULT_ROOM)
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 32) || DEFAULT_ROOM;

const SERVER_URL = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/?role=controller&room=${encodeURIComponent(room)}`;

const detector = new DholHitDetector();

let socket = null;
let reconnectTimer = null;

let cameraStream = null;
let handLandmarker = null;

let tracking = false;
let lastVideoTime = -1;
let lastDetectionTimestamp = 0;
let animationFrame = null;
let videoFrameCallbackId = null;

let fpsWindowStart = 0;
let fpsFrameCount = 0;
let displayedFPS = 0;
let averageInference = 0;
let lastPerformanceUpdate = 0;

let lastHandStateAt = 0;
let handsVisible = false;
let lastHandCount = 0;

let hostCount = 0;
let hitsSent = 0;
let testHand = "left";

let smoothedLandmarks = {
    left: null,
    right: null
};

let lastSeen = {
    left: 0,
    right: 0
};

let hitFlashes = {
    left: 0,
    right: 0
};

let calibrationRunning = false;
let calibrationStartedAt = 0;
let calibrationTimer = null;

let currentStatus = "";

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function setStatus(message) {
    if (message === currentStatus) return;

    currentStatus = message;
    statusElement.textContent = message;
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

function updateServerPill() {
    serverDot.classList.remove("online", "waiting", "offline");

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        serverDot.classList.add("offline");
        serverText.textContent = "Server offline";
        return;
    }

    if (hostCount > 0) {
        serverDot.classList.add("online");
        serverText.textContent = "Stage online";
    } else {
        serverDot.classList.add("waiting");
        serverText.textContent = "Waiting for stage";
    }
}

function connectToServer() {
    if (
        socket &&
        (
            socket.readyState === WebSocket.OPEN ||
            socket.readyState === WebSocket.CONNECTING
        )
    ) {
        return;
    }

    const currentSocket = new WebSocket(SERVER_URL);

    socket = currentSocket;

    currentSocket.addEventListener("open", () => {
        if (socket !== currentSocket) return;

        window.clearTimeout(reconnectTimer);
        updateServerPill();

        if (!tracking) {
            setStatus("Server online. Start the camera.");
        }
    });

    currentSocket.addEventListener("message", event => {
        if (socket !== currentSocket) return;

        const message = parseServerMessage(event.data);
        if (!message) return;

        if (message.type === MESSAGE_TYPES.PRESENCE) {
            hostCount = Number(message.hosts) || 0;
            updateServerPill();
        }
    });

    currentSocket.addEventListener("close", () => {
        if (socket !== currentSocket) return;

        hostCount = 0;
        updateServerPill();

        if (!tracking) {
            setStatus("Server disconnected. Reconnecting...");
        }

        window.clearTimeout(reconnectTimer);

        reconnectTimer = window.setTimeout(() => {
            if (socket === currentSocket) {
                socket = null;
                connectToServer();
            }
        }, 1500);
    });

    currentSocket.addEventListener("error", () => {
        if (socket !== currentSocket) return;
        updateServerPill();
    });

    updateServerPill();
}

function reconnectManually() {
    window.clearTimeout(reconnectTimer);

    const oldSocket = socket;
    socket = null;

    if (oldSocket) {
        oldSocket.close();
    }

    connectToServer();
}

function sendMessage(message, maxBuffer = MAX_SOCKET_BUFFER) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount > maxBuffer) return false;

    socket.send(JSON.stringify(message));

    return true;
}

function triggerLocalHit(hand) {
    hitFlashes[hand] = performance.now();

    if (navigator.vibrate) {
        navigator.vibrate(18);
    }
}

function sendHit(hit) {
    const message = createHitMessage({
        hand: hit.hand,
        stroke: hit.stroke,
        intensity: hit.intensity,
        x: hit.x,
        y: hit.y
    });

    if (sendMessage(message, 32768)) {
        hitsSent++;
    }

    triggerLocalHit(hit.hand);
}

function updateSensitivity() {
    const value = clamp(Number(sensitivityInput.value) || 1, 0.5, 2);

    detector.setThresholdScale(1 / value);
    sensitivityValue.textContent = `x${value.toFixed(1)}`;

    updateThresholdLabel();
    writeStored("airDhol.sensitivity", value);
}

function updateThresholdLabel() {
    const thresholds = detector.getEffectiveThresholds();

    thresholdsElement.textContent =
        `Strike threshold — L ${thresholds.left.toFixed(2)} / R ${thresholds.right.toFixed(2)}`;
}

function loadCalibration() {
    const savedThresholds = readStored("airDhol.thresholds", "");
    const savedSensitivity = Number(readStored("airDhol.sensitivity", "1"));

    if (savedThresholds) {
        try {
            detector.setThresholds(JSON.parse(savedThresholds));
        } catch (error) {
            detector.setThresholds({});
        }
    }

    if (Number.isFinite(savedSensitivity)) {
        sensitivityInput.value = String(clamp(savedSensitivity, 0.5, 2));
    }

    updateSensitivity();
}

function startCalibration() {
    if (calibrationRunning) return;

    if (!tracking) {
        setStatus("Start the camera before calibrating.");
        return;
    }

    calibrationRunning = true;
    calibrationStartedAt = performance.now();

    detector.beginCalibration(calibrationStartedAt);

    calibrationBanner.hidden = false;
    calibrationProgress.style.transform = "scaleX(0)";
    calibrateButton.disabled = true;

    setStatus("Calibration: strike down with each hand.");

    window.clearInterval(calibrationTimer);

    calibrationTimer = window.setInterval(() => {
        const progress = Math.min(
            1,
            (performance.now() - calibrationStartedAt) / CALIBRATION_DURATION
        );

        calibrationProgress.style.transform = `scaleX(${progress})`;

        if (progress >= 1) {
            finishCalibration();
        }
    }, 80);
}

function finishCalibration() {
    window.clearInterval(calibrationTimer);
    calibrationTimer = null;

    const suggested = detector.endCalibration();
    const existing = detector.getThresholds();

    const merged = {
        left: suggested.left ?? existing.left ?? null,
        right: suggested.right ?? existing.right ?? null
    };

    detector.setThresholds(merged);

    try {
        window.localStorage.setItem("airDhol.thresholds", JSON.stringify(merged));
    } catch (error) {
        setStatus("Calibration applied, but could not be saved.");
    }

    calibrationRunning = false;
    calibrationBanner.hidden = true;
    calibrateButton.disabled = false;

    updateThresholdLabel();

    const detectedHands = [];

    if (suggested.left !== null) detectedHands.push("left");
    if (suggested.right !== null) detectedHands.push("right");

    if (detectedHands.length === 0) {
        setStatus("No strikes detected. Keeping previous thresholds.");
    } else {
        setStatus(`Calibration saved for ${detectedHands.join(" and ")} hand.`);
    }
}

async function initializeHandLandmarker() {
    setStatus("Loading hand-tracking model...");

    const vision = await FilesetResolver.forVisionTasks(WASM_PATH);

    const options = {
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5
    };

    try {
        handLandmarker = await HandLandmarker.createFromOptions(
            vision,
            {
                ...options,
                baseOptions: {
                    modelAssetPath: MODEL_URL,
                    delegate: "GPU"
                }
            }
        );
    } catch (error) {
        handLandmarker = await HandLandmarker.createFromOptions(
            vision,
            {
                ...options,
                baseOptions: {
                    modelAssetPath: MODEL_URL
                }
            }
        );
    }
}

async function initializeCamera() {
    if (cameraStream) return;

    if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera API unavailable. HTTPS and certificate trust are required.");
    }

    setStatus("Starting phone camera...");

    cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
            facingMode: {
                ideal: "user"
            },
            width: {
                ideal: 480
            },
            height: {
                ideal: 360
            },
            frameRate: {
                ideal: 30,
                max: 30
            }
        }
    });

    camera.srcObject = cameraStream;

    await camera.play();

    if (camera.videoWidth && camera.videoHeight) {
        cameraFrame.style.aspectRatio = `${camera.videoWidth} / ${camera.videoHeight}`;
    }

    resizeOverlay();
    drawOverlay([], performance.now());
}

function resizeOverlay() {
    const width = camera.videoWidth || 480;
    const height = camera.videoHeight || 360;

    if (overlay.width !== width || overlay.height !== height) {
        overlay.width = width;
        overlay.height = height;
    }
}

function roundRectPath(x, y, width, height, radius) {
    const safeRadius = Math.min(radius, width / 2, height / 2);

    context.beginPath();
    context.moveTo(x + safeRadius, y);
    context.arcTo(x + width, y, x + width, y + height, safeRadius);
    context.arcTo(x + width, y + height, x, y + height, safeRadius);
    context.arcTo(x, y + height, x, y, safeRadius);
    context.arcTo(x, y, x + width, y, safeRadius);
    context.closePath();
}

function drawPad(hand, now) {
    const layout = PAD_LAYOUT[hand];
    const theme = HAND_THEME[hand];

    const width = overlay.width;
    const height = overlay.height;

    const padWidth = width * layout.width;
    const padHeight = height * layout.height;
    const centerX = width * layout.centerX;
    const centerY = height * layout.centerY;
    const x = centerX - padWidth / 2;
    const y = centerY - padHeight / 2;

    const flashAge = now - hitFlashes[hand];
    const flash = flashAge >= 0 && flashAge < 260
        ? 1 - flashAge / 260
        : 0;

    roundRectPath(x, y, padWidth, padHeight, Math.min(padWidth, padHeight) * 0.16);

    const fill = context.createLinearGradient(0, y, 0, y + padHeight);
    fill.addColorStop(0, `rgba(${theme.rgb}, ${0.035 + flash * 0.16})`);
    fill.addColorStop(1, `rgba(${theme.rgb}, ${0.1 + flash * 0.22})`);

    context.fillStyle = fill;
    context.fill();

    context.strokeStyle = `rgba(${theme.rgb}, ${0.24 + flash * 0.62})`;
    context.lineWidth = Math.max(1.5, width * 0.004 + flash * 3);
    context.stroke();

    if (flash > 0) {
        const glow = context.createRadialGradient(
            centerX,
            centerY,
            0,
            centerX,
            centerY,
            padWidth * 0.5
        );

        glow.addColorStop(0, `rgba(${theme.rgb}, ${flash * 0.32})`);
        glow.addColorStop(1, `rgba(${theme.rgb}, 0)`);

        roundRectPath(x, y, padWidth, padHeight, Math.min(padWidth, padHeight) * 0.16);
        context.fillStyle = glow;
        context.fill();
    }

    const chevronY = y + padHeight * 0.16;
    const chevronWidth = padWidth * 0.09;

    context.beginPath();
    context.moveTo(centerX - chevronWidth, chevronY);
    context.lineTo(centerX, chevronY + chevronWidth * 0.8);
    context.lineTo(centerX + chevronWidth, chevronY);

    context.strokeStyle = `rgba(${theme.rgb}, ${0.28 + flash * 0.4})`;
    context.lineWidth = Math.max(1.5, width * 0.005);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke();

    const titleSize = Math.max(15, width * 0.042);
    const sideSize = Math.max(9, width * 0.021);

    context.textAlign = "center";
    context.textBaseline = "middle";

    context.font = `700 ${sideSize}px "Trebuchet MS", Verdana, sans-serif`;
    context.fillStyle = `rgba(${theme.rgb}, 0.5)`;
    context.fillText(layout.side, centerX, y + padHeight * 0.72);

    context.font = `700 ${titleSize}px "Trebuchet MS", Verdana, sans-serif`;
    context.lineWidth = Math.max(2, titleSize * 0.18);
    context.strokeStyle = "rgba(5, 2, 1, 0.6)";
    context.fillStyle = `rgba(${theme.rgb}, ${0.6 + flash * 0.4})`;

    context.strokeText(layout.title, centerX, y + padHeight * 0.82);
    context.fillText(layout.title, centerX, y + padHeight * 0.82);
}

function drawHand(candidate, now) {
    const theme = HAND_THEME[candidate.hand];
    const width = overlay.width;
    const height = overlay.height;

    const toPoint = landmark => ({
        x: (1 - landmark.x) * width,
        y: landmark.y * height
    });

    const connections = HandLandmarker.HAND_CONNECTIONS;

    context.lineWidth = Math.max(2, width * 0.006);
    context.strokeStyle = `rgba(${theme.rgb}, 0.78)`;
    context.lineCap = "round";

    for (const connection of connections) {
        const start = toPoint(candidate.landmarks[connection.start]);
        const end = toPoint(candidate.landmarks[connection.end]);

        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.stroke();
    }

    context.fillStyle = `rgba(${theme.rgb}, 0.9)`;

    for (const landmark of candidate.landmarks) {
        const point = toPoint(landmark);

        context.beginPath();
        context.arc(point.x, point.y, Math.max(1.5, width * 0.005), 0, TAU);
        context.fill();
    }

    const palmX = candidate.smoothX * width;
    const palmY = candidate.smoothY * height;
    const flashAge = now - hitFlashes[candidate.hand];
    const flash = flashAge >= 0 && flashAge < 260
        ? 1 - flashAge / 260
        : 0;

    if (flash > 0) {
        const glow = context.createRadialGradient(
            palmX,
            palmY,
            0,
            palmX,
            palmY,
            Math.max(40, width * 0.12)
        );

        glow.addColorStop(0, `rgba(${theme.rgb}, ${flash * 0.45})`);
        glow.addColorStop(1, `rgba(${theme.rgb}, 0)`);

        context.fillStyle = glow;
        context.beginPath();
        context.arc(palmX, palmY, Math.max(40, width * 0.12), 0, TAU);
        context.fill();
    }

    context.beginPath();
    context.arc(palmX, palmY, Math.max(7, width * 0.022), 0, TAU);
    context.fillStyle = "rgba(5, 2, 1, 0.55)";
    context.fill();

    context.lineWidth = Math.max(2, width * 0.006);
    context.strokeStyle = theme.main;
    context.stroke();

    const strikeX = candidate.strikeX * width;
    const strikeY = candidate.strikeY * height;
    const strikeRadius = Math.max(5, width * 0.016);

    context.beginPath();
    context.arc(strikeX, strikeY, strikeRadius, 0, TAU);
    context.fillStyle = `rgba(${theme.rgb}, 0.22)`;
    context.fill();
    context.lineWidth = Math.max(1.5, width * 0.005);
    context.strokeStyle = theme.main;
    context.stroke();

    const wrist = toPoint(candidate.landmarks[0]);
    const labelSize = Math.max(11, width * 0.026);

    context.font = `700 ${labelSize}px "Trebuchet MS", Verdana, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineWidth = Math.max(2, labelSize * 0.22);
    context.strokeStyle = "rgba(5, 2, 1, 0.75)";
    context.fillStyle = theme.main;

    const label = candidate.hand === "left" ? "L" : "R";
    const labelX = wrist.x;
    const labelY = wrist.y - labelSize * 1.1;

    context.strokeText(label, labelX, labelY);
    context.fillText(label, labelX, labelY);
}

function drawOverlay(candidates, now) {
    if (!overlay.width || !overlay.height) return;

    context.clearRect(0, 0, overlay.width, overlay.height);

    drawPad("left", now);
    drawPad("right", now);

    context.beginPath();
    context.moveTo(overlay.width / 2, overlay.height * 0.08);
    context.lineTo(overlay.width / 2, overlay.height * 0.94);

    const divider = context.createLinearGradient(
        0,
        overlay.height * 0.08,
        0,
        overlay.height * 0.94
    );

    divider.addColorStop(0, "rgba(255, 243, 223, 0)");
    divider.addColorStop(0.5, "rgba(255, 243, 223, 0.1)");
    divider.addColorStop(1, "rgba(255, 243, 223, 0)");

    context.strokeStyle = divider;
    context.lineWidth = 1;
    context.stroke();

    for (const candidate of candidates) {
        drawHand(candidate, now);
    }
}

function palmCenter(landmarks) {
    let x = 0;
    let y = 0;

    for (const id of PALM_IDS) {
        x += landmarks[id].x;
        y += landmarks[id].y;
    }

    return {
        x: x / PALM_IDS.length,
        y: y / PALM_IDS.length
    };
}

function strikePoint(landmarks) {
    let x = 0;
    let y = 0;

    for (const id of STRIKE_IDS) {
        x += landmarks[id].x;
        y += landmarks[id].y;
    }

    return {
        x: x / STRIKE_IDS.length,
        y: y / STRIKE_IDS.length
    };
}

function smoothLandmarks(rawLandmarks, previous) {
    if (!previous || previous.length !== rawLandmarks.length) {
        return rawLandmarks.map(point => ({
            x: point.x,
            y: point.y,
            z: point.z
        }));
    }

    for (let index = 0; index < rawLandmarks.length; index++) {
        const raw = rawLandmarks[index];
        const smoothed = previous[index];

        smoothed.x += (raw.x - smoothed.x) * LANDMARK_SMOOTHING;
        smoothed.y += (raw.y - smoothed.y) * LANDMARK_SMOOTHING;
        smoothed.z += (raw.z - smoothed.z) * LANDMARK_SMOOTHING;
    }

    return previous;
}

function buildHandCandidates(landmarksList, now) {
    const entries = landmarksList.slice(0, 2).map(rawLandmarks => {
        const palm = palmCenter(rawLandmarks);
        const strike = strikePoint(rawLandmarks);

        return {
            rawLandmarks,
            gameX: clamp(1 - palm.x, 0, 1),
            gameY: clamp(palm.y, 0, 1),
            strikeX: clamp(1 - strike.x, 0, 1),
            strikeY: clamp(strike.y, 0, 1)
        };
    });

    if (entries.length === 0) return [];

    entries.sort((first, second) => first.gameX - second.gameX);

    const handOrder = entries.length === 1
        ? [entries[0].gameX < 0.5 ? "left" : "right"]
        : ["left", "right"];

    return entries.map((entry, index) => {
        const hand = handOrder[index];

        smoothedLandmarks[hand] = smoothLandmarks(
            entry.rawLandmarks,
            smoothedLandmarks[hand]
        );

        const smoothedPalm = palmCenter(smoothedLandmarks[hand]);

        lastSeen[hand] = now;

        return {
            hand,
            rawX: entry.gameX,
            rawY: entry.gameY,
            strikeX: entry.strikeX,
            strikeY: entry.strikeY,
            smoothX: clamp(1 - smoothedPalm.x, 0, 1),
            smoothY: clamp(smoothedPalm.y, 0, 1),
            landmarks: smoothedLandmarks[hand]
        };
    });
}

function updateMissingHands(now, candidates) {
    const present = new Set(candidates.map(candidate => candidate.hand));

    for (const hand of ["left", "right"]) {
        if (present.has(hand)) continue;

        if (lastSeen[hand] > 0 && now - lastSeen[hand] > 300) {
            detector.resetHand(hand);
            smoothedLandmarks[hand] = null;
            lastSeen[hand] = 0;
        }
    }
}

function sendHandState(candidates, now) {
    if (candidates.length === 0) {
        if (!handsVisible) return;

        handsVisible = false;
        sendMessage(createHandStateMessage([]));

        return;
    }

    handsVisible = true;

    if (now - lastHandStateAt < HAND_STATE_INTERVAL) return;

    lastHandStateAt = now;

    sendMessage(createHandStateMessage(
        candidates.map(candidate => ({
            hand: candidate.hand,
            x: candidate.smoothX,
            y: candidate.smoothY
        }))
    ));
}

function updateStrikeMeters(candidates) {
    const present = new Set(candidates.map(candidate => candidate.hand));

    for (const hand of ["left", "right"]) {
        const fill = hand === "left" ? leftStrikeFill : rightStrikeFill;
        const valueElement = hand === "left" ? leftStrikeValue : rightStrikeValue;
        const state = detector.getHandState(hand);
        const active = present.has(hand) && state.active;
        const ratio = active && state.threshold > 0
            ? clamp(state.velocity / (state.threshold * 2), 0, 1)
            : 0;
        const hot = active && state.velocity >= state.threshold;

        fill.style.transform = `scaleX(${ratio.toFixed(3)})`;
        fill.classList.toggle("hot", hot);
        valueElement.textContent = active ? state.velocity.toFixed(1) : "0.0";
        valueElement.classList.toggle("hot", hot);
    }
}

function processVideoFrame() {
    if (
        !tracking ||
        !handLandmarker ||
        camera.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
        return;
    }

    if (camera.currentTime === lastVideoTime) {
        return;
    }

    lastVideoTime = camera.currentTime;

    resizeOverlay();

    const inferenceStartedAt = performance.now();
    const mediaPipeTimestamp = Math.max(
        performance.now(),
        lastDetectionTimestamp + 1
    );

    lastDetectionTimestamp = mediaPipeTimestamp;

    let result;

    try {
        result = handLandmarker.detectForVideo(camera, mediaPipeTimestamp);
    } catch (error) {
        setStatus("Hand tracking error. Check the browser console.");
        console.error("Hand tracking error:", error);
        return;
    }

    const now = performance.now();

    updatePerformance(now, now - inferenceStartedAt);

    const candidates = buildHandCandidates(result.landmarks || [], now);

    for (const candidate of candidates) {
        const hit = detector.update(
            candidate.hand,
            candidate.strikeX,
            candidate.strikeY,
            now
        );

        if (hit) {
            sendHit(hit);
        }
    }

    updateMissingHands(now, candidates);
    updateStrikeMeters(candidates);
    sendHandState(candidates, now);
    drawOverlay(candidates, now);

    handCountElement.textContent = String(candidates.length);

    if (candidates.length !== lastHandCount) {
        lastHandCount = candidates.length;

        if (!calibrationRunning) {
            if (candidates.length === 0) {
                setStatus("Show both hands to the camera.");
            } else if (candidates.length === 1) {
                setStatus("1 hand tracked. Show the other hand for both heads.");
            } else {
                setStatus("Both hands tracked. Strike down to play.");
            }
        }
    }
}

function updatePerformance(now, inferenceTime) {
    fpsFrameCount++;

    if (averageInference === 0) {
        averageInference = inferenceTime;
    } else {
        averageInference = averageInference * 0.8 + inferenceTime * 0.2;
    }

    if (fpsWindowStart === 0) {
        fpsWindowStart = now;
    }

    const elapsed = now - fpsWindowStart;

    if (elapsed >= 1000) {
        displayedFPS = fpsFrameCount * 1000 / elapsed;
        fpsFrameCount = 0;
        fpsWindowStart = now;
    }

    if (now - lastPerformanceUpdate >= 500) {
        fpsElement.textContent = displayedFPS.toFixed(0);
        inferenceElement.textContent = `${averageInference.toFixed(1)} ms`;
        lastPerformanceUpdate = now;
    }
}

function scheduleTrackingFrame() {
    if (!tracking) return;

    if (typeof camera.requestVideoFrameCallback === "function") {
        videoFrameCallbackId = camera.requestVideoFrameCallback(() => {
            if (!tracking) return;

            processVideoFrame();
            scheduleTrackingFrame();
        });

        return;
    }

    animationFrame = window.requestAnimationFrame(() => {
        if (!tracking) return;

        processVideoFrame();
        scheduleTrackingFrame();
    });
}

function resetTrackingState() {
    lastVideoTime = -1;
    lastDetectionTimestamp = 0;

    fpsWindowStart = 0;
    fpsFrameCount = 0;
    displayedFPS = 0;
    averageInference = 0;
    lastPerformanceUpdate = 0;

    lastHandStateAt = 0;
    handsVisible = false;
    lastHandCount = 0;

    smoothedLandmarks = {
        left: null,
        right: null
    };

    lastSeen = {
        left: 0,
        right: 0
    };

    detector.resetAll();
    updateStrikeMeters([]);
}

startCameraButton.addEventListener("click", async () => {
    startCameraButton.disabled = true;
    startCameraButton.textContent = "STARTING CAMERA...";

    try {
        await initializeCamera();

        if (!handLandmarker) {
            await initializeHandLandmarker();
        }

        tracking = true;
        resetTrackingState();

        calibrateButton.disabled = false;

        startCameraButton.textContent = "CAMERA ACTIVE";

        setStatus("Camera active. Show both hands.");

        fpsElement.textContent = "--";
        inferenceElement.textContent = "-- ms";

        scheduleTrackingFrame();
    } catch (error) {
        console.error("Camera or tracking initialization error:", error);

        startCameraButton.disabled = false;
        startCameraButton.textContent = "RETRY CAMERA";

        setStatus(`Initialization error: ${error.message}`);
    }
});

calibrateButton.addEventListener("click", startCalibration);

testHitButton.addEventListener("click", () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        setStatus("Server offline. Reconnect first.");
        return;
    }

    if (hostCount === 0) {
        setStatus("Stage not connected. Open the stage on your TV.");
        return;
    }

    const hand = testHand;
    testHand = hand === "left" ? "right" : "left";

    sendHit({
        hand,
        stroke: hand === "left" ? "bass" : "treble",
        intensity: 0.8,
        x: hand === "left" ? 0.25 : 0.75,
        y: 0.7
    });

    setStatus(`Test ${hand === "left" ? "bass" : "treble"} hit sent.`);
});

reconnectButton.addEventListener("click", reconnectManually);
sensitivityInput.addEventListener("input", updateSensitivity);

resetTuningButton.addEventListener("click", () => {
    if (calibrationRunning) {
        setStatus("Wait for calibration to finish before resetting.");
        return;
    }

    detector.setThresholds({});
    sensitivityInput.value = "1";
    updateSensitivity();

    try {
        window.localStorage.removeItem("airDhol.thresholds");
    } catch (error) {
        return undefined;
    }

    detector.resetAll();
    updateStrikeMeters([]);

    setStatus("Tuning reset. Strike down with your fingertips.");
});

window.addEventListener("beforeunload", () => {
    tracking = false;

    window.clearTimeout(reconnectTimer);
    window.clearInterval(calibrationTimer);

    if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
    }

    if (
        videoFrameCallbackId !== null &&
        typeof camera.cancelVideoFrameCallback === "function"
    ) {
        camera.cancelVideoFrameCallback(videoFrameCallbackId);
    }

    if (cameraStream) {
        for (const track of cameraStream.getTracks()) {
            track.stop();
        }
    }

    if (handLandmarker) {
        handLandmarker.close();
    }

    if (socket) {
        socket.close();
    }
});

window.airDholController = {
    detector,
    simulateStrike: (hand = "left") => {
        const safeHand = hand === "right" ? "right" : "left";

        sendHit({
            hand: safeHand,
            stroke: safeHand === "left" ? "bass" : "treble",
            intensity: 0.8,
            x: safeHand === "left" ? 0.25 : 0.75,
            y: 0.7
        });
    },
    getState: () => ({
        room,
        tracking,
        socketState: socket ? socket.readyState : -1,
        hostCount,
        handCount: lastHandCount,
        hitsSent,
        calibrationRunning,
        fps: displayedFPS,
        inference: averageInference,
        thresholds: detector.getEffectiveThresholds(),
        strikeStates: {
            left: detector.getHandState("left"),
            right: detector.getHandState("right")
        }
    })
};

loadCalibration();
resizeOverlay();
updateStrikeMeters([]);
drawOverlay([], performance.now());
connectToServer();
