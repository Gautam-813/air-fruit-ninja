
const express = require("express");
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const WebSocket = require("ws");

// ==========================================
// 1. CONFIGURATION
// ==========================================

const app = express();

const PORT = 3000;
const HOST = "0.0.0.0";

const projectRoot = path.join(__dirname, "..");

// ==========================================
// 2. DETECT LOCAL NETWORK IP
// ==========================================

function getLocalIPAddress() {

    const interfaces = os.networkInterfaces();
    const candidates = [];

    for (const entries of Object.values(interfaces)) {

        for (const network of entries || []) {

            const isIPv4 =
                network.family === "IPv4" ||
                network.family === 4;

            if (isIPv4 && !network.internal) {
                candidates.push(network.address);
            }
        }
    }

    // Prefer the common home-network address range.
    const preferred = candidates.find(ip =>
        ip.startsWith("192.168.")
    );

    return preferred || candidates[0] || "localhost";
}

const LOCAL_IP = getLocalIPAddress();

// ==========================================
// 3. HTTPS CERTIFICATES
// ==========================================

const certificatePath = path.join(
    projectRoot,
    "certs",
    "server.pem"
);

const privateKeyPath = path.join(
    projectRoot,
    "certs",
    "server-key.pem"
);

const httpsOptions = {
    cert: fs.readFileSync(certificatePath),
    key: fs.readFileSync(privateKeyPath)
};

// ==========================================
// 4. SERVE GAME AND CONTROLLER
// ==========================================

app.use(
    express.static(
        path.join(projectRoot, "public")
    )
);

// ==========================================
// 5. HEALTH ENDPOINT
// ==========================================

app.get("/health", (req, res) => {

    res.json({
        status: "ok",
        application: "Air Fruit Ninja",
        protocol: "https",
        ip: LOCAL_IP,
        port: PORT
    });

});

// ==========================================
// 6. CREATE HTTPS SERVER
// ==========================================

const server = https.createServer(
    httpsOptions,
    app
);

// ==========================================
// 7. WEBSOCKET SERVER
// ==========================================

const wss = new WebSocket.Server({
    server,
    maxPayload: 2048
});

wss.on("connection", (socket) => {

    console.log("A device connected!");

    socket.send(
        JSON.stringify({
            type: "CONNECTED",
            message: "Welcome to Air Fruit Ninja!"
        })
    );

    socket.on("message", (message) => {

        // No per-frame console logging here.
        // Tracking messages arrive continuously.

        const messageText = message.toString();

        // Forward to all other connected devices.
        for (const client of wss.clients) {

            if (
                client !== socket &&
                client.readyState === WebSocket.OPEN
            ) {

                // Avoid adding more messages to a congested
                // outgoing socket buffer.
                if (client.bufferedAmount > 16384) {
                    continue;
                }

                client.send(messageText);
            }
        }

    });

    socket.on("close", () => {
        console.log("A device disconnected.");
    });

    socket.on("error", (error) => {
        console.error(
            "WebSocket error:",
            error.message
        );
    });

});

// ==========================================
// 8. START SERVER
// ==========================================

server.listen(PORT, HOST, () => {

    console.log("");
    console.log("====================================");
    console.log(" AIR FRUIT NINJA SERVER STARTED");
    console.log("====================================");

    console.log(`Port:       ${PORT}`);
    console.log(`Game:       https://localhost:${PORT}/game/`);

    console.log(
        `Controller: https://${LOCAL_IP}:${PORT}/controller/`
    );

    console.log(
        `Health:     https://${LOCAL_IP}:${PORT}/health`
    );

    console.log("====================================");
    console.log("");

});
