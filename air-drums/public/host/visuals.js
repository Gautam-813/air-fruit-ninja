const TAU = Math.PI * 2;

const HAND_STYLES = {
    left: {
        main: "#ffb454",
        soft: "rgba(255, 171, 74, 0.65)",
        glow: "rgba(255, 138, 40, ",
        dark: "#4a2104"
    },
    right: {
        main: "#67e8e8",
        soft: "rgba(103, 232, 232, 0.65)",
        glow: "rgba(64, 224, 224, ",
        dark: "#043838"
    }
};

const PARTICLE_COLORS = {
    bass: ["#ffd7a1", "#ffae4d", "#ff7a1a", "#ffe9c9"],
    treble: ["#c5fffb", "#6fe9ea", "#2ec6d1", "#ffffff"],
    paired: ["#ffe6a3", "#ffc94d", "#fff5d6"]
};

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function lerp(start, end, amount) {
    return start + (end - start) * amount;
}

function easeOutCubic(value) {
    return 1 - Math.pow(1 - value, 3);
}

export function createDholStage(canvas) {
    const context = canvas.getContext("2d");

    let width = 1;
    let height = 1;
    let dpr = 1;

    let hands = [];
    let handsUpdatedAt = 0;

    let impacts = [];
    let particles = [];
    let floaters = [];
    let dust = [];

    let strikeAnimations = {
        left: 0,
        right: 0
    };

    let shakeStartedAt = 0;
    let shakeStrength = 0;

    let beatPulseStartedAt = 0;
    let beatPulseAccent = false;

    let lastFrameTime = performance.now();
    let clock = 0;

    function resize() {
        const rect = canvas.getBoundingClientRect();

        dpr = Math.min(2, window.devicePixelRatio || 1);
        width = Math.max(1, rect.width);
        height = Math.max(1, rect.height);

        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);

        context.setTransform(dpr, 0, 0, dpr, 0, 0);

        dust = Array.from({ length: 34 }, () => ({
            x: Math.random() * width,
            y: Math.random() * height,
            radius: 0.6 + Math.random() * 1.8,
            speed: 4 + Math.random() * 12,
            drift: Math.random() * TAU,
            alpha: 0.05 + Math.random() * 0.12
        }));
    }

    function getLayout() {
        const headRadius = Math.min(width * 0.138, height * 0.245);
        const headOffset = headRadius * 1.72;
        const centerX = width / 2;
        const centerY = height * 0.515;
        const bodyTop = centerY - headRadius * 0.86;
        const bodyBottom = centerY + headRadius * 0.86;

        return {
            centerX,
            centerY,
            headRadius,
            headOffset,
            bodyTop,
            bodyBottom,
            bodyLeft: centerX - headOffset,
            bodyRight: centerX + headOffset,
            left: {
                x: centerX - headOffset,
                y: centerY,
                radius: headRadius
            },
            right: {
                x: centerX + headOffset,
                y: centerY,
                radius: headRadius
            }
        };
    }

    function headForHand(layout, hand) {
        return hand === "left" ? layout.left : layout.right;
    }

    function drawBackground(now) {
        const background = context.createLinearGradient(0, 0, 0, height);
        background.addColorStop(0, "#1c0d0a");
        background.addColorStop(0.45, "#120806");
        background.addColorStop(1, "#070303");

        context.fillStyle = background;
        context.fillRect(0, 0, width, height);

        const spotlight = context.createRadialGradient(
            width * 0.5,
            -height * 0.12,
            0,
            width * 0.5,
            height * 0.38,
            height * 0.95
        );

        spotlight.addColorStop(0, "rgba(255, 196, 120, 0.15)");
        spotlight.addColorStop(0.45, "rgba(214, 116, 50, 0.06)");
        spotlight.addColorStop(1, "rgba(0, 0, 0, 0)");

        context.fillStyle = spotlight;
        context.fillRect(0, 0, width, height);

        const layout = getLayout();
        const mandalaRadius = layout.headRadius * 2.15;

        context.save();
        context.translate(layout.centerX, layout.centerY - layout.headRadius * 0.08);
        context.rotate(now * 0.000012);

        context.strokeStyle = "rgba(255, 205, 140, 0.07)";
        context.lineWidth = 1;

        for (let ring = 1; ring <= 4; ring++) {
            context.beginPath();
            context.setLineDash(ring % 2 === 0 ? [4, 14] : [2, 10]);
            context.arc(0, 0, mandalaRadius * (ring / 4), 0, TAU);
            context.stroke();
        }

        context.setLineDash([]);
        context.strokeStyle = "rgba(255, 205, 140, 0.045)";

        for (let ray = 0; ray < 32; ray++) {
            const angle = (ray / 32) * TAU;
            const inner = mandalaRadius * 0.48;
            const outer = mandalaRadius * (ray % 2 === 0 ? 1 : 0.86);

            context.beginPath();
            context.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
            context.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
            context.stroke();
        }

        context.restore();

        const floorGlow = context.createRadialGradient(
            layout.centerX,
            layout.centerY + layout.headRadius * 0.9,
            0,
            layout.centerX,
            layout.centerY + layout.headRadius * 0.9,
            layout.headRadius * 2.4
        );

        floorGlow.addColorStop(0, "rgba(255, 140, 60, 0.09)");
        floorGlow.addColorStop(0.6, "rgba(255, 100, 40, 0.025)");
        floorGlow.addColorStop(1, "rgba(0, 0, 0, 0)");

        context.fillStyle = floorGlow;
        context.fillRect(0, 0, width, height);
    }

    function drawDust(deltaSeconds) {
        for (const mote of dust) {
            mote.y -= mote.speed * deltaSeconds;
            mote.x += Math.sin(clock * 0.0004 + mote.drift) * 0.08;

            if (mote.y < -10) {
                mote.y = height + 10;
                mote.x = Math.random() * width;
            }

            context.beginPath();
            context.fillStyle = `rgba(255, 216, 160, ${mote.alpha})`;
            context.arc(mote.x, mote.y, mote.radius, 0, TAU);
            context.fill();
        }
    }

    function drawBody(layout) {
        const {
            bodyLeft,
            bodyRight,
            bodyTop,
            bodyBottom,
            headRadius,
            centerX
        } = layout;

        context.save();

        context.beginPath();
        context.moveTo(bodyLeft, bodyTop);
        context.bezierCurveTo(
            centerX - layout.headOffset * 0.4,
            bodyTop - headRadius * 0.12,
            centerX + layout.headOffset * 0.4,
            bodyTop - headRadius * 0.12,
            bodyRight,
            bodyTop
        );
        context.lineTo(bodyRight, bodyBottom);
        context.bezierCurveTo(
            centerX + layout.headOffset * 0.4,
            bodyBottom + headRadius * 0.12,
            centerX - layout.headOffset * 0.4,
            bodyBottom + headRadius * 0.12,
            bodyLeft,
            bodyBottom
        );
        context.closePath();

        const wood = context.createLinearGradient(0, bodyTop, 0, bodyBottom);
        wood.addColorStop(0, "#3a160c");
        wood.addColorStop(0.18, "#7a371d");
        wood.addColorStop(0.46, "#b25c31");
        wood.addColorStop(0.62, "#8e4525");
        wood.addColorStop(1, "#2c0f08");

        context.fillStyle = wood;
        context.fill();

        const inner = context.createLinearGradient(0, bodyTop, 0, bodyBottom);
        inner.addColorStop(0, "rgba(0, 0, 0, 0.42)");
        inner.addColorStop(0.25, "rgba(255, 205, 150, 0.09)");
        inner.addColorStop(0.5, "rgba(0, 0, 0, 0)");
        inner.addColorStop(0.78, "rgba(0, 0, 0, 0.28)");
        inner.addColorStop(1, "rgba(0, 0, 0, 0.55)");

        context.fillStyle = inner;
        context.fill();

        const bandWidth = headRadius * 0.13;

        for (const offset of [-0.58, -0.28, 0.28, 0.58]) {
            const x = centerX + layout.headOffset * offset;

            context.fillStyle = "rgba(255, 210, 140, 0.12)";
            context.fillRect(
                x - bandWidth / 2,
                bodyTop + headRadius * 0.08,
                bandWidth,
                bodyBottom - bodyTop - headRadius * 0.16
            );

            context.strokeStyle = "rgba(255, 220, 160, 0.18)";
            context.lineWidth = Math.max(1, headRadius * 0.012);
            context.strokeRect(
                x - bandWidth / 2,
                bodyTop + headRadius * 0.08,
                bandWidth,
                bodyBottom - bodyTop - headRadius * 0.16
            );
        }

        context.strokeStyle = "rgba(244, 200, 126, 0.32)";
        context.lineWidth = Math.max(1.2, headRadius * 0.018);

        const laceStart = bodyLeft + headRadius * 0.4;
        const laceEnd = bodyRight - headRadius * 0.4;
        const laceTop = bodyTop + headRadius * 0.2;
        const laceBottom = bodyBottom - headRadius * 0.2;
        const segments = 14;

        for (let index = 0; index < segments; index++) {
            const x1 = lerp(laceStart, laceEnd, index / segments);
            const x2 = lerp(laceStart, laceEnd, (index + 1) / segments);
            const topFirst = index % 2 === 0;

            context.beginPath();
            context.moveTo(x1, topFirst ? laceTop : laceBottom);
            context.lineTo(x2, topFirst ? laceBottom : laceTop);
            context.stroke();
        }

        context.fillStyle = "rgba(255, 224, 170, 0.42)";

        for (let index = 0; index <= segments; index += 2) {
            const x = lerp(laceStart, laceEnd, index / segments);

            context.beginPath();
            context.arc(x, laceTop, headRadius * 0.022, 0, TAU);
            context.fill();
        }

        context.restore();
    }

    function drawHead(layout, head, kind, now) {
        const isBass = kind === "bass";
        const style = isBass ? HAND_STYLES.left : HAND_STYLES.right;

        context.save();

        const glowStrength = 0.1 + Math.sin(clock * 0.0018 + (isBass ? 0 : 1.7)) * 0.02;

        const outerGlow = context.createRadialGradient(
            head.x,
            head.y,
            head.radius * 0.2,
            head.x,
            head.y,
            head.radius * 1.65
        );

        outerGlow.addColorStop(0, style.glow + `${glowStrength})`);
        outerGlow.addColorStop(0.55, style.glow + `${glowStrength * 0.36})`);
        outerGlow.addColorStop(1, style.glow + "0)");

        context.fillStyle = outerGlow;
        context.beginPath();
        context.arc(head.x, head.y, head.radius * 1.65, 0, TAU);
        context.fill();

        context.beginPath();
        context.arc(head.x, head.y, head.radius, 0, TAU);

        const rim = context.createLinearGradient(
            head.x - head.radius,
            head.y - head.radius,
            head.x + head.radius,
            head.y + head.radius
        );

        rim.addColorStop(0, "#f8dc9a");
        rim.addColorStop(0.22, "#b98335");
        rim.addColorStop(0.5, "#6b4316");
        rim.addColorStop(0.72, "#e4bd6d");
        rim.addColorStop(1, "#5b3510");

        context.strokeStyle = rim;
        context.lineWidth = head.radius * 0.13;
        context.stroke();

        context.beginPath();
        context.arc(head.x, head.y, head.radius * 0.925, 0, TAU);

        const skin = context.createRadialGradient(
            head.x - head.radius * 0.34,
            head.y - head.radius * 0.38,
            head.radius * 0.08,
            head.x,
            head.y,
            head.radius
        );

        if (isBass) {
            skin.addColorStop(0, "#74401f");
            skin.addColorStop(0.45, "#4a2412");
            skin.addColorStop(0.82, "#2c140b");
            skin.addColorStop(1, "#1a0a06");
        } else {
            skin.addColorStop(0, "#e3bd83");
            skin.addColorStop(0.45, "#c29558");
            skin.addColorStop(0.82, "#946331");
            skin.addColorStop(1, "#6f4521");
        }

        context.fillStyle = skin;
        context.fill();

        const patchRadius = isBass ? head.radius * 0.56 : head.radius * 0.2;

        context.beginPath();
        context.arc(head.x, head.y, patchRadius, 0, TAU);

        const patch = context.createRadialGradient(
            head.x - patchRadius * 0.3,
            head.y - patchRadius * 0.34,
            patchRadius * 0.05,
            head.x,
            head.y,
            patchRadius
        );

        if (isBass) {
            patch.addColorStop(0, "#251a13");
            patch.addColorStop(0.65, "#120c09");
            patch.addColorStop(1, "#070403");
        } else {
            patch.addColorStop(0, "#3a2414");
            patch.addColorStop(1, "#1d1009");
        }

        context.fillStyle = patch;
        context.fill();

        context.strokeStyle = isBass
            ? "rgba(255, 205, 145, 0.16)"
            : "rgba(255, 235, 200, 0.2)";
        context.lineWidth = Math.max(1, head.radius * 0.012);
        context.stroke();

        if (isBass) {
            context.strokeStyle = "rgba(255, 200, 140, 0.09)";

            for (let ring = 1; ring <= 3; ring++) {
                context.beginPath();
                context.arc(head.x, head.y, patchRadius * (0.28 + ring * 0.2), 0, TAU);
                context.stroke();
            }
        }

        context.beginPath();
        context.arc(
            head.x,
            head.y,
            head.radius * 0.82,
            Math.PI * 1.1,
            Math.PI * 1.6
        );

        context.strokeStyle = "rgba(255, 255, 255, 0.13)";
        context.lineWidth = Math.max(1.5, head.radius * 0.025);
        context.stroke();

        for (let peg = 0; peg < 12; peg++) {
            const angle = (peg / 12) * TAU + Math.PI / 12;
            const px = head.x + Math.cos(angle) * head.radius * 1.015;
            const py = head.y + Math.sin(angle) * head.radius * 1.015;

            context.beginPath();
            context.arc(px, py, head.radius * 0.035, 0, TAU);
            context.fillStyle = peg % 2 === 0 ? "#d8ae5f" : "#7b5222";
            context.fill();
            context.strokeStyle = "rgba(0, 0, 0, 0.35)";
            context.lineWidth = Math.max(1, head.radius * 0.008);
            context.stroke();
        }

        const bol = isBass ? "GE" : "TA";

        context.save();
        context.globalAlpha = isBass ? 0.28 : 0.32;
        context.fillStyle = isBass ? "#ffdca0" : "#3a1e0e";
        context.font = `700 ${head.radius * 0.32}px "Trebuchet MS", Verdana, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(bol, head.x, head.y + head.radius * 0.66);
        context.restore();

        context.fillStyle = isBass ? "#ffcf85" : "#8ff4f4";
        context.textAlign = "center";
        context.textBaseline = "top";
        context.font = `700 ${Math.max(11, head.radius * 0.095)}px "Trebuchet MS", Verdana, sans-serif`;
        context.fillText(
            isBass ? "DAGGA" : "TILLI",
            head.x,
            head.y + head.radius * 1.24
        );

        context.fillStyle = "rgba(255, 245, 225, 0.55)";
        context.font = `600 ${Math.max(9, head.radius * 0.072)}px "Trebuchet MS", Verdana, sans-serif`;
        context.fillText(
            isBass ? "BASS" : "TREBLE",
            head.x,
            head.y + head.radius * 1.42
        );

        const strikeStartedAt = strikeAnimations[kind === "bass" ? "left" : "right"];
        const strikeProgress = (now - strikeStartedAt) / 150;

        if (strikeStartedAt > 0 && strikeProgress >= 0 && strikeProgress <= 1) {
            const eased = easeOutCubic(strikeProgress);
            const direction = isBass ? -1 : 1;
            const startX = head.x + direction * head.radius * 0.75;
            const startY = head.y - head.radius * 1.15;

            context.beginPath();
            context.moveTo(startX, startY);
            context.lineTo(
                head.x,
                head.y - head.radius * (0.18 - eased * 0.18)
            );

            context.strokeStyle = isBass
                ? `rgba(255, 205, 120, ${0.75 * (1 - strikeProgress)})`
                : `rgba(140, 255, 255, ${0.75 * (1 - strikeProgress)})`;
            context.lineWidth = head.radius * 0.055;
            context.lineCap = "round";
            context.stroke();
        }

        context.restore();
    }

    function drawHands(layout, now) {
        if (now - handsUpdatedAt > 500 || hands.length === 0) return;

        for (const hand of hands) {
            const style = HAND_STYLES[hand.hand] || HAND_STYLES.left;
            const head = headForHand(layout, hand.hand);

            const hoverX = head.x + (hand.x - 0.5) * head.radius * 0.75;
            const hoverY = head.y - head.radius * (1.75 - (hand.y - 0.5) * 0.9);
            const tipX = head.x + (hand.hand === "left" ? 0.12 : -0.12) * head.radius;
            const tipY = head.y - head.radius * 0.12;

            context.save();

            context.beginPath();
            context.moveTo(hoverX, hoverY);
            context.lineTo(tipX, tipY);

            context.strokeStyle = style.soft;
            context.lineWidth = Math.max(3, head.radius * 0.042);
            context.lineCap = "round";
            context.stroke();

            context.beginPath();
            context.moveTo(hoverX, hoverY);
            context.lineTo(tipX, tipY);

            context.strokeStyle = style.main;
            context.lineWidth = Math.max(1.2, head.radius * 0.016);
            context.stroke();

            const orbGlow = context.createRadialGradient(
                hoverX,
                hoverY,
                0,
                hoverX,
                hoverY,
                head.radius * 0.28
            );

            orbGlow.addColorStop(0, style.glow + "0.65)");
            orbGlow.addColorStop(0.55, style.glow + "0.18)");
            orbGlow.addColorStop(1, style.glow + "0)");

            context.fillStyle = orbGlow;
            context.beginPath();
            context.arc(hoverX, hoverY, head.radius * 0.28, 0, TAU);
            context.fill();

            context.beginPath();
            context.arc(hoverX, hoverY, Math.max(5, head.radius * 0.072), 0, TAU);
            context.fillStyle = style.main;
            context.fill();
            context.strokeStyle = "rgba(255, 255, 255, 0.75)";
            context.lineWidth = Math.max(1, head.radius * 0.01);
            context.stroke();

            context.fillStyle = style.main;
            context.font = `700 ${Math.max(10, head.radius * 0.075)}px "Trebuchet MS", Verdana, sans-serif`;
            context.textAlign = "center";
            context.textBaseline = "bottom";
            context.fillText(
                hand.hand === "left" ? "LEFT" : "RIGHT",
                hoverX,
                hoverY - head.radius * 0.13
            );

            context.restore();
        }
    }

    function drawImpacts(layout, now) {
        for (const impact of impacts) {
            const age = now - impact.at;
            if (age < 0 || age > 480) continue;

            const progress = age / 480;
            const head = headForHand(layout, impact.hand);
            const intensity = impact.intensity;

            const flash = context.createRadialGradient(
                head.x,
                head.y,
                0,
                head.x,
                head.y,
                head.radius * 1.1
            );

            const color = impact.stroke === "treble" ? "130, 250, 250" : "255, 180, 90";

            flash.addColorStop(0, `rgba(${color}, ${0.7 * (1 - progress) * intensity})`);
            flash.addColorStop(0.5, `rgba(${color}, ${0.22 * (1 - progress)})`);
            flash.addColorStop(1, `rgba(${color}, 0)`);

            context.fillStyle = flash;
            context.beginPath();
            context.arc(head.x, head.y, head.radius * 1.1, 0, TAU);
            context.fill();

            context.beginPath();
            context.arc(
                head.x,
                head.y,
                head.radius * (0.35 + progress * 0.95),
                0,
                TAU
            );

            context.strokeStyle = `rgba(${color}, ${0.85 * (1 - progress)})`;
            context.lineWidth = Math.max(1.5, head.radius * 0.035 * (1 - progress));
            context.stroke();

            if (impact.paired) {
                const centerProgress = progress;

                context.beginPath();
                context.ellipse(
                    layout.centerX,
                    layout.centerY,
                    layout.headOffset + layout.headRadius * (0.4 + centerProgress * 0.75),
                    layout.headRadius * (0.65 + centerProgress * 0.45),
                    0,
                    0,
                    TAU
                );

                context.strokeStyle = `rgba(255, 214, 120, ${0.5 * (1 - centerProgress)})`;
                context.lineWidth = Math.max(2, layout.headRadius * 0.025 * (1 - centerProgress));
                context.stroke();
            }
        }
    }

    function drawParticles(now) {
        for (const particle of particles) {
            if (particle.dead) continue;

            const lifeLeft = particle.diesAt - now;
            if (lifeLeft <= 0) {
                particle.dead = true;
                continue;
            }

            const alpha = clamp(lifeLeft / particle.life, 0, 1);

            context.beginPath();
            context.fillStyle = particle.color;
            context.globalAlpha = alpha;
            context.arc(particle.x, particle.y, particle.radius, 0, TAU);
            context.fill();
            context.globalAlpha = 1;
        }
    }

    function drawFloaters(layout, now) {
        for (const floater of floaters) {
            const age = now - floater.at;
            if (age < 0 || age > 820) continue;

            const progress = age / 820;
            const alpha = 1 - Math.pow(progress, 1.7);
            const head = headForHand(layout, floater.hand);

            let x = head.x;
            let y = head.y - head.radius * 0.95 - progress * head.radius * 0.42;
            let size = head.radius * 0.2;

            if (floater.paired) {
                x = layout.centerX;
                y = layout.centerY - layout.headRadius * 1.35 - progress * layout.headRadius * 0.35;
                size = layout.headRadius * 0.26;
            }

            const color = floater.paired
                ? "#ffe08a"
                : floater.stroke === "treble"
                    ? "#8ff4f4"
                    : "#ffb454";

            context.save();
            context.globalAlpha = alpha;
            context.font = `700 ${Math.max(20, size * (1 + progress * 0.12))}px "Trebuchet MS", Verdana, sans-serif`;
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.lineWidth = size * 0.14;
            context.strokeStyle = "rgba(15, 5, 3, 0.82)";
            context.fillStyle = color;
            context.shadowBlur = size * 0.8;
            context.shadowColor = color;
            context.strokeText(floater.text, x, y);
            context.fillText(floater.text, x, y);
            context.restore();
        }
    }

    function drawBeatPulse(layout, now) {
        const age = now - beatPulseStartedAt;

        if (age < 0 || age > 520) return;

        const progress = age / 520;
        const alpha = (1 - progress) * (beatPulseAccent ? 0.45 : 0.16);

        context.beginPath();
        context.ellipse(
            layout.centerX,
            layout.centerY,
            layout.headOffset + layout.headRadius * (1.05 + progress * 0.28),
            layout.headRadius * (1.18 + progress * 0.22),
            0,
            0,
            TAU
        );

        context.strokeStyle = `rgba(255, 205, 130, ${alpha})`;
        context.lineWidth = Math.max(1, layout.headRadius * (beatPulseAccent ? 0.035 : 0.015) * (1 - progress));
        context.stroke();
    }

    function updateParticles(deltaSeconds) {
        for (const particle of particles) {
            if (particle.dead) continue;

            particle.x += particle.vx * deltaSeconds;
            particle.y += particle.vy * deltaSeconds;
            particle.vy += particle.gravity * deltaSeconds;
            particle.vx *= 0.985;
        }

        particles = particles.filter(particle => !particle.dead);

        if (particles.length > 260) {
            particles.splice(0, particles.length - 260);
        }
    }

    function prune(now) {
        impacts = impacts.filter(impact => now - impact.at < 520);
        floaters = floaters.filter(floater => now - floater.at < 850);
    }

    function draw(now) {
        drawBackground(now);

        const layout = getLayout();

        let shakeX = 0;
        let shakeY = 0;

        const shakeAge = now - shakeStartedAt;

        if (shakeAge >= 0 && shakeAge < 190 && shakeStrength > 0) {
            const decay = 1 - shakeAge / 190;
            shakeX = Math.sin(now * 0.17) * shakeStrength * decay;
            shakeY = Math.cos(now * 0.23) * shakeStrength * 0.6 * decay;
        }

        context.save();
        context.translate(shakeX, shakeY);

        drawDust(lastFrameTime > 0 ? 1 / 60 : 0);

        const shadow = context.createRadialGradient(
            layout.centerX,
            layout.centerY + layout.headRadius * 1.18,
            0,
            layout.centerX,
            layout.centerY + layout.headRadius * 1.18,
            layout.headOffset + layout.headRadius
        );

        shadow.addColorStop(0, "rgba(0, 0, 0, 0.55)");
        shadow.addColorStop(1, "rgba(0, 0, 0, 0)");

        context.save();
        context.translate(0, layout.headRadius * 1.12);
        context.scale(1, 0.22);
        context.fillStyle = shadow;
        context.beginPath();
        context.arc(
            layout.centerX,
            0,
            layout.headOffset + layout.headRadius,
            0,
            TAU
        );
        context.fill();
        context.restore();

        const breath = 1 + Math.sin(clock * 0.0013) * 0.004;

        context.save();
        context.translate(layout.centerX, layout.centerY);
        context.scale(breath, breath);
        context.translate(-layout.centerX, -layout.centerY);

        drawBody(layout);
        drawHead(layout, layout.left, "bass", now);
        drawHead(layout, layout.right, "treble", now);

        context.restore();

        drawHands(layout, now);
        drawBeatPulse(layout, now);
        drawImpacts(layout, now);
        drawParticles(now);
        drawFloaters(layout, now);

        context.restore();
    }

    function frame(now) {
        const delta = Math.min(50, now - lastFrameTime);

        lastFrameTime = now;
        clock = now;

        updateParticles(delta / 1000);
        prune(now);
        draw(now);

        requestAnimationFrame(frame);
    }

    function setHands(nextHands) {
        hands = Array.isArray(nextHands)
            ? nextHands.filter(hand => hand && (hand.hand === "left" || hand.hand === "right"))
            : [];

        handsUpdatedAt = performance.now();
    }

    function registerHit({ hand, stroke, intensity = 0.7, paired = false }) {
        const now = performance.now();
        const safeHand = hand === "right" ? "right" : "left";
        const amount = clamp(Number(intensity) || 0.7, 0.2, 1);
        const layout = getLayout();
        const head = headForHand(layout, safeHand);

        strikeAnimations[safeHand] = now;
        shakeStartedAt = now;
        shakeStrength = 3 + amount * 8;

        impacts.push({
            at: now,
            hand: safeHand,
            stroke: stroke === "treble" ? "treble" : "bass",
            intensity: amount,
            paired
        });

        const colors = paired
            ? PARTICLE_COLORS.paired
            : stroke === "treble"
                ? PARTICLE_COLORS.treble
                : PARTICLE_COLORS.bass;

        const count = Math.round(16 + amount * 22);

        for (let index = 0; index < count; index++) {
            const angle = -Math.PI / 2 + (Math.random() * 2 - 1) * Math.PI * 0.85;
            const speed = 70 + Math.random() * (220 + amount * 260);
            const life = 380 + Math.random() * 480;

            particles.push({
                x: head.x + (Math.random() * 2 - 1) * head.radius * 0.15,
                y: head.y + (Math.random() * 2 - 1) * head.radius * 0.12,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                gravity: 640,
                radius: 1.2 + Math.random() * 3.2,
                life,
                diesAt: now + life,
                color: colors[Math.floor(Math.random() * colors.length)],
                dead: false
            });
        }

        floaters.push({
            at: now,
            hand: safeHand,
            stroke: stroke === "treble" ? "treble" : "bass",
            text: paired ? "DHA!" : stroke === "treble" ? "TA" : "GE",
            paired
        });
    }

    function pulseBeat(accent = false) {
        beatPulseStartedAt = performance.now();
        beatPulseAccent = Boolean(accent);
    }

    function getState() {
        return {
            hands: hands.length,
            impacts: impacts.length,
            particles: particles.length,
            floaters: floaters.length
        };
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    window.addEventListener("resize", resize);

    resize();
    requestAnimationFrame(frame);

    return {
        setHands,
        registerHit,
        pulseBeat,
        getState
    };
}
