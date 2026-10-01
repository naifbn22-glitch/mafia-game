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
const SERVER_ID = String(process.env.SERVER_ID || "R").trim().toUpperCase();
const defaultOrigins = process.env.NODE_ENV === "production"
  ? "https://mafiagameplay.com,https://www.mafiagameplay.com"
  : "http://localhost:5173,http://127.0.0.1:5173";
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || defaultOrigins).split(",").map(v => v.trim()).filter(Boolean);
const app = express();

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(compression());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("ORIGIN_NOT_ALLOWED"));
  },
  credentials: false,
}));
app.use(express.json({ limit: "512kb" }));

const store = new RoomStore({ redisUrl: process.env.REDIS_URL || "", databaseUrl: process.env.DATABASE_URL || "" });
await store.connect();

let io = null;

app.get("/api/health", (_req, res) => {
  const stats = store.getStats();

  // liveRooms counts only rooms that currently have at least one Socket.IO
  // subscriber. This prevents abandoned/stale in-memory rooms from making the
  // router think a server is full after aborted stress tests or closed lobbies.
  const liveRooms = io
    ? [...io.sockets.adapter.rooms.entries()].filter(
        ([name, members]) => {
          const roomName = String(name);
          // Count only the base game room: "room:ABC1234".
          // Do NOT count private Socket.IO subrooms such as:
          // "room:ABC1234:host" or "room:ABC1234:player:<id>".
          return (
            /^room:[A-Z0-9]+$/i.test(roomName) &&
            members &&
            members.size > 0
          );
        },
      ).length
    : 0;

  res.json({
    ok: true,
    serverId: SERVER_ID,
    realtime: "socket.io",
    redis: Boolean(process.env.REDIS_URL),
    activeRooms: stats.activeRooms,
    liveRooms,
    totalRooms: stats.totalRooms,
    activePlayers: stats.activePlayers,
    connections: Number(io?.engine?.clientsCount || 0),
    now: Date.now(),
  });
});

// Health checks are intentionally outside the /api rate limiter because the
// client-side room router polls A/B/C while allocating rooms. Rate-limiting
// /api/health can make all primaries return 429 during a large or repeated
// stress test and incorrectly trigger the Render backup.
app.use("/api", rateLimit({
  windowMs: 60_000,
  limit: 240,
  standardHeaders: "draft-7",
  legacyHeaders: false,
}));
app.use(express.static(path.join(__dirname, "dist"), { maxAge: "1h", etag: true }));
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  return res.sendFile(path.join(__dirname, "dist", "index.html"));
});

const server = http.createServer(app);
io = await createSocketServer(server, store, { allowedOrigins });

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
