import express from "express";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import rateLimit from "express-rate-limit";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RoomStore } from "./server/roomStore.js";
import { createSocketServer } from "./server/socketServer.js";
import { hostProjection, playerProjection, publicProjection, normalizeRoomCode, requireHost, requirePlayer } from "./server/gameEngine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || "*").split(",").map(v => v.trim()).filter(Boolean);
const app = express();

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(compression());
app.use(cors({ origin: allowedOrigins.includes("*") ? true : allowedOrigins, credentials: false }));
app.use(express.json({ limit: "512kb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: "draft-7", legacyHeaders: false }));

const store = new RoomStore({ redisUrl: process.env.REDIS_URL || "", databaseUrl: process.env.DATABASE_URL || "" });
await store.connect();

app.get("/api/health", (_req, res) => res.json({ ok: true, realtime: "socket.io", redis: Boolean(process.env.REDIS_URL), now: Date.now() }));

// HTTP snapshot endpoint used as a resilient fallback for lobby/live synchronization.
// It bypasses browser WebSocket quirks and always returns the newest room state from Redis/Postgres.
app.post("/api/rooms/sync", async (req, res) => {
  try {
    const { code, mode = "public", playerId, token } = req.body || {};
    const normalized = normalizeRoomCode(code);
    if (!normalized) return res.status(400).json({ ok: false, error: "INVALID_ROOM_CODE" });

    const room = await store.get(normalized);
    if (!room) return res.status(404).json({ ok: false, error: "ROOM_NOT_FOUND" });

    if (mode === "host") {
      requireHost(room, token);
      return res.json({ ok: true, room: hostProjection(room) });
    }

    if (mode === "player") {
      const player = requirePlayer(room, playerId, token);
      return res.json({ ok: true, room: playerProjection(room, player) });
    }

    return res.json({ ok: true, room: publicProjection(room) });
  } catch (error) {
    const status = /UNAUTHORIZED/.test(String(error?.message || "")) ? 401 : 400;
    return res.status(status).json({ ok: false, error: error?.message || "SERVER_ERROR" });
  }
});
app.use(express.static(path.join(__dirname, "dist"), { maxAge: "1h", etag: true }));
app.use((_req, res) => res.sendFile(path.join(__dirname, "dist", "index.html")));

const server = http.createServer(app);
await createSocketServer(server, store, { allowedOrigins });
server.listen(PORT, "0.0.0.0", () => console.log(`Mafia realtime server listening on port ${PORT}`));
