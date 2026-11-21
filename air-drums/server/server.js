import express from "express";
import https from "https";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT) || 3100;
const HOST = "0.0.0.0";
const MAX_PAYLOAD = 8192;

function getLocalIPAddress() {
    const interfaces = os.networkInterfaces();
    const candidates = [];

    for (const entries of Object.values(interfaces)) {
        for (const network of entries || []) {
            const isIPv4 = network.family === "IPv4" || network.family === 4;

            if (isIPv4 && !network.internal) {
                candidates.push(network.address);
            }
        }
    }

    const preferred = candidates.find(ip => ip.startsWith("192.168."));

    return preferred || candidates[0] || "localhost";
}

const LOCAL_IP = getLocalIPAddress();

const certificatePath = path.join(PROJECT_ROOT, "certs", "server.pem");
const privateKeyPath = path.join(PROJECT_ROOT, "certs", "server-key.pem");

let httpsOptions;

try {
    httpsOptions = {
        cert: fs.readFileSync(certificatePath),
        key: fs.readFileSync(privateKeyPath)
    };
} catch (error) {
    console.error("TLS certificates not found.");
    console.error("Create certs/server.pem and certs/server-key.pem first.");
    console.error(`Looked in: ${path.dirname(certificatePath)}`);
    process.exit(1);
}

const app = express();

app.use(express.static(path.join(PROJECT_ROOT, "public")));

const server = https.createServer(httpsOptions, app);
const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD });

function parseClientParameters(request) {
    let url;

    try {
        url = new URL(request.url || "/", `https://${request.headers.host || "localhost"}`);
    } catch (error) {
        url = new URL("https://localhost/");
    }

    const requestedRole = url.searchParams.get("role");
    const role = requestedRole === "host" || requestedRole === "controller"
        ? requestedRole
        : "unknown";

    const rawRoom = url.searchParams.get("room") || "main";
    const room = rawRoom.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "main";

    return { role, room };
}

function openClientsInRoom(room) {
    return [...wss.clients].filter(
        client => client.room === room && client.readyState === WebSocket.OPEN
    );
}

function broadcastPresence(room) {
    const clients = openClientsInRoom(room);
    const hosts = clients.filter(client => client.role === "host").length;
    const controllers = clients.filter(client => client.role === "controller").length;

    const payload = JSON.stringify({
        type: "PRESENCE",
        room,
        hosts,
        controllers
    });

    for (const client of clients) {
        if (client.role === "unknown") continue;
        if (client.bufferedAmount > 4096) continue;

        client.send(payload);
    }
}

function relayMessage(sender, message) {
    if (message.length > MAX_PAYLOAD) return;

    const targetRole = sender.role === "controller"
        ? "host"
        : sender.role === "host"
            ? "controller"
            : null;

    for (const client of wss.clients) {
        if (client === sender) continue;
        if (client.readyState !== WebSocket.OPEN) continue;
        if (client.room !== sender.room) continue;
        if (targetRole && client.role !== targetRole) continue;
        if (client.bufferedAmount > 32768) continue;

        client.send(message, { binary: false });
    }
}

wss.on("connection", (socket, request) => {
    const { role, room } = parseClientParameters(request);

    socket.role = role;
    socket.room = room;
    socket.isAlive = true;

    console.log(`Connected: role=${role} room=${room}`);

    socket.send(JSON.stringify({
        type: "CONNECTED",
        role,
        room,
        message: "Welcome to Air Dhol!"
    }));

    broadcastPresence(room);

    socket.on("pong", () => {
        socket.isAlive = true;
    });

    socket.on("message", message => {
        relayMessage(socket, message);
    });

    socket.on("close", () => {
        console.log(`Disconnected: role=${role} room=${room}`);
        broadcastPresence(room);
    });

    socket.on("error", error => {
        console.error("WebSocket error:", error.message);
    });
});

const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
        if (client.isAlive === false) {
            client.terminate();
            continue;
        }

        client.isAlive = false;
        client.ping();
    }
}, 30000);

wss.on("close", () => {
    clearInterval(heartbeat);
});

app.get("/health", (request, response) => {
    const clients = [...wss.clients].filter(
        client => client.readyState === WebSocket.OPEN
    );

    response.json({
        status: "ok",
        application: "Air Drums",
        protocol: "https",
        ip: LOCAL_IP,
        port: PORT,
        hosts: clients.filter(client => client.role === "host").length,
        controllers: clients.filter(client => client.role === "controller").length
    });
});

server.listen(PORT, HOST, () => {
    console.log("");
    console.log("====================================");
    console.log(" AIR DHOL STAGE STARTED");
    console.log("====================================");
    console.log(`Port:       ${PORT}`);
    console.log(`Landing:    https://${LOCAL_IP}:${PORT}/`);
    console.log(`Stage:      https://localhost:${PORT}/host/`);
    console.log(`Controller: https://${LOCAL_IP}:${PORT}/controller/`);
    console.log(`Health:     https://${LOCAL_IP}:${PORT}/health`);
    console.log("====================================");
    console.log("");
});
