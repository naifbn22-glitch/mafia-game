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
import { hostProjection, normalizeRoomCode, requireHost, startVoting } from "./server/gameEngine.js";

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
app.use(express.static(path.join(__dirname, "dist"), { maxAge: "1h", etag: true }));
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  return res.sendFile(path.join(__dirname, "dist", "index.html"));
});

const server = http.createServer(app);
const io = await createSocketServer(server, store, { allowedOrigins });

// مسار احتياطي مخصص لأمر الانتقال إلى التصويت.
// لا يغيّر أي قاعدة في اللعبة، ويستخدم نفس startVoting المعتمد في Socket.IO.
// فائدته ضمان وصول أمر المدير حتى إذا حدث انقطاع لحظي في قناة الـ WebSocket.
app.post("/api/rooms/:code/start-voting", async (req, res) => {
  try {
    const code = normalizeRoomCode(req.params.code);
    const token = String(req.body?.token || "");
    const room = await store.get(code);
    if (!room) return res.status(404).json({ ok: false, error: "ROOM_NOT_FOUND" });
    requireHost(room, token);
    startVoting(room);
    await store.set(room);

    // إشعار مرحلة عام فقط، ثم كل جهاز يجلب إسقاطه الخاص من الخادم.
    const payload = {
      code: room.code,
      phase: room.phase,
      version: room.version || 0,
      matchSequence: Number(room.matchSequence || 0),
      roundNumber: Number(room.roundNumber || 1),
      changedAt: Date.now(),
    };
    io.to(`room:${room.code}`).emit("room:voting-started", payload);
    io.to(`room:${room.code}`).emit("room:phase-changed", payload);

    // إعادة بث قصيرة لضمان الأجهزة التي أعادت الاتصال في نفس اللحظة.
    [120, 350, 800, 1600, 2800, 4200].forEach(delay => {
      setTimeout(async () => {
        try {
          const fresh = await store.get(code);
          if (!fresh || fresh.phase !== "voting") return;
          const retryPayload = {
            code: fresh.code,
            phase: fresh.phase,
            version: fresh.version || 0,
            matchSequence: Number(fresh.matchSequence || 0),
            roundNumber: Number(fresh.roundNumber || 1),
            changedAt: Date.now(),
          };
          io.to(`room:${fresh.code}`).emit("room:voting-started", retryPayload);
          io.to(`room:${fresh.code}`).emit("room:phase-changed", retryPayload);
        } catch {}
      }, delay);
    });

    res.json({ ok: true, room: hostProjection(room) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error?.message || "SERVER_ERROR" });
  }
});

server.listen(PORT, "0.0.0.0", () => console.log(`Mafia realtime server listening on port ${PORT}`));
