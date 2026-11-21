import assert from "node:assert/strict";
import { DholHitDetector } from "../public/shared/hit-detector.js";

function runFrames(detector, hand, points, startTime, interval = 30) {
    const hits = [];
    let time = startTime;

    for (const [x, y] of points) {
        const hit = detector.update(hand, x, y, time);
        if (hit) hits.push(hit);
        time += interval;
    }

    return { hits, nextTime: time };
}

function strikePoints(x, startY = 0.2, step = 0.1, count = 7) {
    return Array.from({ length: count }, (_, index) => [
        x,
        startY + index * step
    ]);
}

const detector = new DholHitDetector();
const leftStrike = runFrames(detector, "left", strikePoints(0.25), 1000);

assert.equal(leftStrike.hits.length, 1, "a fast downward strike should fire once");
assert.equal(leftStrike.hits[0].hand, "left");
assert.equal(leftStrike.hits[0].stroke, "bass");
assert.ok(leftStrike.hits[0].intensity > 0.2, "intensity should be reported");

const continuedMotion = runFrames(
    detector,
    "left",
    strikePoints(0.25, 0.9, 0.01, 10),
    leftStrike.nextTime
);

assert.equal(continuedMotion.hits.length, 0, "continued downward motion must not retrigger");

const rearmAndStrike = runFrames(
    detector,
    "left",
    [
        [0.25, 0.6],
        [0.25, 0.4],
        [0.25, 0.3],
        ...strikePoints(0.25, 0.3, 0.1, 7)
    ],
    continuedMotion.nextTime + 200
);

assert.equal(rearmAndStrike.hits.length, 1, "a fresh strike should fire after re-arming");

const upwardDetector = new DholHitDetector();
const upwardStrike = runFrames(
    upwardDetector,
    "right",
    strikePoints(0.75, 0.9, -0.1, 7),
    1000
);

assert.equal(upwardStrike.hits.length, 0, "upward motion must not fire");

const rightStrike = runFrames(
    upwardDetector,
    "right",
    strikePoints(0.75, 0.2, 0.1, 7),
    3000
);

assert.equal(rightStrike.hits.length, 1);
assert.equal(rightStrike.hits[0].stroke, "treble");

const gentleDetector = new DholHitDetector();
const gentlePoints = strikePoints(0.2, 0.2, 0.03, 9);
const gentleNormal = runFrames(gentleDetector, "left", gentlePoints, 1000).hits;

assert.equal(gentleNormal.length, 1, "a moderate strike should pass the default threshold");

gentleDetector.setThresholdScale(1.8);
gentleDetector.resetAll();

const gentleRaised = runFrames(gentleDetector, "left", gentlePoints, 2000).hits;

assert.equal(gentleRaised.length, 0, "a raised threshold should reject the moderate strike");

const calibrationDetector = new DholHitDetector({ threshold: 0.8 });
calibrationDetector.beginCalibration(1000);
runFrames(calibrationDetector, "left", strikePoints(0.25), 1000);

const suggested = calibrationDetector.endCalibration();

assert.ok(suggested.left !== null, "calibration should detect the left hand");
assert.ok(suggested.left >= 0.45 && suggested.left <= 2.6, "suggested threshold should be clamped");
assert.equal(suggested.right, null, "unused hand should have no suggestion");

calibrationDetector.setThresholds({
    left: suggested.left,
    right: 1.1
});

calibrationDetector.resetAll();

const calibratedStrike = runFrames(
    calibrationDetector,
    "right",
    strikePoints(0.75),
    5000
).hits;

assert.equal(calibratedStrike.length, 1, "a calibrated threshold should still accept a real strike");
assert.equal(calibratedStrike[0].stroke, "treble");

const effective = calibrationDetector.getEffectiveThresholds();
const rightState = calibrationDetector.getHandState("right");

assert.ok(effective.left > 0 && effective.right > 0);
assert.equal(rightState.active, true);
assert.ok(rightState.velocity > 0 && Number.isFinite(rightState.rawVelocity));
assert.equal(calibrationDetector.update("middle", 0.5, 0.5, 9000), null);

console.log("hit-detector tests passed");
