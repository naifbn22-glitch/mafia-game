import express from "express";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import rateLimit from "express-rate-limit";
import http from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RoomStore } from "./server/roomStore.js";
import { createSocketServer } from "./server/socketServer.js";
import { hostProjection, normalizeRoomCode, requireHost, startVoting } from "./server/gameEngine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const SERVER_ID = String(process.env.SERVER_ID || "R").trim().toUpperCase();
const defaultOrigins = process.env.NODE_ENV === "production"
  ? "https://mafiagameplay.com,https://www.mafiagameplay.com,capacitor://localhost"
  : "http://localhost:5173,http://127.0.0.1:5173,capacitor://localhost";
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || defaultOrigins).split(",").map(v => v.trim()).filter(Boolean);
const app = express();

const ROOM_CREATE_QUEUE_COORDINATOR_ID = "A";
const ROOM_CREATE_SPACING_MS = Math.max(
  500,
  Number(process.env.ROOM_CREATE_SPACING_MS || 2520),
);
const ROOM_CREATE_QUEUE_MAX = Math.max(
  20,
  Number(process.env.ROOM_CREATE_QUEUE_MAX || 500),
);
const ROOM_CREATE_WAIT_TTL_MS = 10 * 60_000;
const ROOM_CREATE_READY_TTL_MS = 60_000;
const roomCreateQueue = [];
const roomCreateTickets = new Map();
const roomCreateRequestIndex = new Map();
let roomCreateNextReleaseAt = 0;
let roomCreateQueueTimer = null;

function removeRoomCreateTicket(ticketId) {
  const ticket = roomCreateTickets.get(ticketId);
  if (!ticket) return;

  const index = roomCreateQueue.indexOf(ticketId);
  if (index >= 0) roomCreateQueue.splice(index, 1);

  roomCreateTickets.delete(ticketId);
  if (
    ticket.requestId &&
    roomCreateRequestIndex.get(ticket.requestId) === ticketId
  ) {
    roomCreateRequestIndex.delete(ticket.requestId);
  }
}

function pruneRoomCreateQueue(now = Date.now()) {
  for (const [ticketId, ticket] of roomCreateTickets.entries()) {
    const expiresAt = Number(ticket.expiresAt || 0);
    if (expiresAt > 0 && expiresAt <= now) {
      removeRoomCreateTicket(ticketId);
    }
  }
}

function roomCreateQueuePayload(ticket, now = Date.now()) {
  if (!ticket) return null;

  const positionIndex =
    ticket.status === "waiting"
      ? roomCreateQueue.indexOf(ticket.id)
      : -1;

  const position = positionIndex >= 0 ? positionIndex + 1 : 0;
  const firstReleaseAt = Math.max(
    now,
    Number(roomCreateNextReleaseAt || now),
  );
  const estimatedWaitMs =
    ticket.status === "waiting" && positionIndex >= 0
      ? Math.max(0, firstReleaseAt - now) +
        positionIndex * ROOM_CREATE_SPACING_MS
      : 0;

  return {
    ok: true,
    ticket: ticket.id,
    status: ticket.status,
    position,
    spacingMs: ROOM_CREATE_SPACING_MS,
    estimatedWaitMs,
    readyAt: Number(ticket.readyAt || 0),
  };
}

function processRoomCreateQueue() {
  roomCreateQueueTimer = null;
  const now = Date.now();
  pruneRoomCreateQueue(now);

  while (roomCreateQueue.length) {
    const firstTicket = roomCreateTickets.get(roomCreateQueue[0]);
    if (firstTicket?.status === "waiting") break;
    roomCreateQueue.shift();
  }

  if (!roomCreateQueue.length) return;

  const waitMs = Math.max(0, Number(roomCreateNextReleaseAt || 0) - now);
  if (waitMs > 0) {
    roomCreateQueueTimer = setTimeout(processRoomCreateQueue, waitMs);
    return;
  }

  const ticketId = roomCreateQueue.shift();
  const ticket = roomCreateTickets.get(ticketId);

  if (ticket?.status === "waiting") {
    ticket.status = "ready";
    ticket.readyAt = now;
    ticket.expiresAt = now + ROOM_CREATE_READY_TTL_MS;
    roomCreateNextReleaseAt = now + ROOM_CREATE_SPACING_MS;
  }

  if (roomCreateQueue.length) {
    roomCreateQueueTimer = setTimeout(
      processRoomCreateQueue,
      ROOM_CREATE_SPACING_MS,
    );
  }
}

function ensureRoomCreateQueueTimer() {
  if (roomCreateQueueTimer) return;
  processRoomCreateQueue();
}

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'", "data:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", "https:", "wss:"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  referrerPolicy: { policy: "no-referrer" },
}));
app.use(compression());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("ORIGIN_NOT_ALLOWED"));
  },
  credentials: false,
}));
app.use(express.json({ limit: "64kb", strict: true }));

const store = new RoomStore({ redisUrl: process.env.REDIS_URL || "", databaseUrl: process.env.DATABASE_URL || "" });
await store.connect();

let io = null;

app.get("/api/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
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

  const connections = io
    ? Number(io.engine?.clientsCount || io.sockets?.sockets?.size || 0)
    : 0;

  res.json({
    ok: true,
    serverId: SERVER_ID,
    realtime: "socket.io",
    redis: Boolean(process.env.REDIS_URL),
    liveRooms,
    connections,
    roomCreateQueue:
      SERVER_ID === ROOM_CREATE_QUEUE_COORDINATOR_ID
        ? {
            waiting: roomCreateQueue.length,
            spacingMs: ROOM_CREATE_SPACING_MS,
            nextReleaseAt: Number(roomCreateNextReleaseAt || 0),
          }
        : null,
    now: Date.now(),
  });
});

const roomCreateQueueLimiter = rateLimit({
  windowMs: 60_000,
  limit: 3000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

app.use("/api/room-create-queue", roomCreateQueueLimiter);

app.post("/api/room-create-queue", (req, res) => {
  if (SERVER_ID !== ROOM_CREATE_QUEUE_COORDINATOR_ID) {
    return res.status(409).json({
      ok: false,
      error: "ROOM_CREATE_QUEUE_WRONG_COORDINATOR",
    });
  }

  const now = Date.now();
  pruneRoomCreateQueue(now);

  const requestId = String(req.body?.requestId || "")
    .trim()
    .slice(0, 128);

  if (requestId) {
    const existingTicketId = roomCreateRequestIndex.get(requestId);
    const existingTicket = existingTicketId
      ? roomCreateTickets.get(existingTicketId)
      : null;

    if (existingTicket) {
      ensureRoomCreateQueueTimer();
      return res.json(roomCreateQueuePayload(existingTicket, now));
    }
  }

  if (roomCreateQueue.length >= ROOM_CREATE_QUEUE_MAX) {
    return res.status(503).json({
      ok: false,
      error: "ROOM_CREATE_QUEUE_FULL",
    });
  }

  const ticket = {
    id: randomUUID(),
    requestId,
    status: "waiting",
    createdAt: now,
    readyAt: 0,
    expiresAt: now + ROOM_CREATE_WAIT_TTL_MS,
  };

  roomCreateTickets.set(ticket.id, ticket);
  if (requestId) roomCreateRequestIndex.set(requestId, ticket.id);
  roomCreateQueue.push(ticket.id);
  ensureRoomCreateQueueTimer();

  return res.json(roomCreateQueuePayload(ticket, now));
});

app.get("/api/room-create-queue/:ticket", (req, res) => {
  if (SERVER_ID !== ROOM_CREATE_QUEUE_COORDINATOR_ID) {
    return res.status(409).json({
      ok: false,
      error: "ROOM_CREATE_QUEUE_WRONG_COORDINATOR",
    });
  }

  const now = Date.now();
  pruneRoomCreateQueue(now);
  const ticketId = String(req.params.ticket || "");
  const ticket = roomCreateTickets.get(ticketId);

  if (!ticket) {
    return res.status(404).json({
      ok: false,
      error: "ROOM_CREATE_QUEUE_TICKET_NOT_FOUND",
    });
  }

  ensureRoomCreateQueueTimer();
  return res.json(roomCreateQueuePayload(ticket, now));
});

app.delete("/api/room-create-queue/:ticket", (req, res) => {
  if (SERVER_ID !== ROOM_CREATE_QUEUE_COORDINATOR_ID) {
    return res.status(409).json({
      ok: false,
      error: "ROOM_CREATE_QUEUE_WRONG_COORDINATOR",
    });
  }

  const ticketId = String(req.params.ticket || "");
  removeRoomCreateTicket(ticketId);
  ensureRoomCreateQueueTimer();

  return res.json({ ok: true });
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
// CDN/browser caching policy:
// - Vite fingerprinted assets can be cached for a year because their filename changes with content.
// - Public images/audio/fonts use a shorter cache plus stale-while-revalidate.
// - HTML is always revalidated so deployments are visible quickly.
// Live API/Socket.IO game state is intentionally never cached here.
app.use(express.static(path.join(__dirname, "dist"), {
  etag: true,
  lastModified: true,
  maxAge: 0,
  setHeaders(res, filePath) {
    const normalized = filePath.replace(/\\/g, "/");

    if (/\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|ttf|otf)$/i.test(normalized)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return;
    }

    if (/\.(?:png|jpe?g|webp|gif|svg|ico|mp3|m4a|wav|ogg|woff2?|ttf|otf)$/i.test(normalized)) {
      res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      return;
    }

    if (/\.html$/i.test(normalized)) {
      res.setHeader("Cache-Control", "no-cache");
    }
  },
}));
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  res.set("Cache-Control", "no-cache");
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
