import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import {
  addTimeline, beginEyesClosed, beginNextNight, castVote, confirmNightAction, createRoom, finishNight, hostProjection, joinPlayer,
  markRoleKnown, normalizeRoomCode, playerProjection, publicProjection, requireHost, requirePlayer,
  selectNightTarget, skipKingPardon, startGame, startVoting, resetForRematch, touch, wakeRole,
} from "./gameEngine.js";

const safeError = error => ({ ok: false, error: error?.message || "SERVER_ERROR" });

export async function createSocketServer(httpServer, store, { allowedOrigins = ["*"] } = {}) {
  const io = new Server(httpServer, {
    cors: { origin: allowedOrigins.includes("*") ? true : allowedOrigins, methods: ["GET", "POST"] },
    transports: ["websocket", "polling"],
    pingInterval: 10000,
    pingTimeout: 20000,
    maxHttpBufferSize: 1e6,
  });

  if (process.env.REDIS_URL) {
    const pubClient = createClient({ url: process.env.REDIS_URL });
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
  }

  async function emitRoom(room) {
    io.to(`room:${room.code}:public`).emit("room:snapshot", publicProjection(room));
    io.to(`room:${room.code}:host`).emit("room:snapshot", hostProjection(room));
    for (const player of room.players) io.to(`room:${room.code}:player:${player.id}`).emit("room:snapshot", playerProjection(room, player));
  }

  io.on("connection", socket => {
    socket.emit("server:ready", { now: Date.now() });

    socket.on("room:create", async (payload, ack = () => {}) => {
      try {
        const room = createRoom(payload || {});
        while (await store.get(room.code)) room.code = createRoom(payload || {}).code;
        await store.set(room);
        ack({ ok: true, room: hostProjection(room), hostToken: room.hostToken });
      } catch (error) { ack(safeError(error)); }
    });

    socket.on("room:lookup", async ({ code }, ack = () => {}) => {
      try {
        const room = await store.get(normalizeRoomCode(code));
        ack(room ? { ok: true, room: publicProjection(room) } : { ok: false, error: "ROOM_NOT_FOUND" });
      } catch (error) { ack(safeError(error)); }
    });

    socket.on("room:sync", async ({ code, mode = "public", playerId, token }, ack = () => {}) => {
      try {
        const normalized = normalizeRoomCode(code);
        const room = await store.get(normalized);
        if (!room) throw new Error("ROOM_NOT_FOUND");

        if (mode === "host") {
          requireHost(room, token);
          ack({ ok: true, room: hostProjection(room) });
          return;
        }

        if (mode === "player") {
          const player = requirePlayer(room, playerId, token);
          ack({ ok: true, room: playerProjection(room, player) });
          return;
        }

        ack({ ok: true, room: publicProjection(room) });
      } catch (error) {
        ack(safeError(error));
      }
    });

    socket.on("room:subscribe", async ({ code, mode = "public", playerId, token }, ack = () => {}) => {
      try {
        const normalized = normalizeRoomCode(code);
        const room = await store.get(normalized);
        if (!room) throw new Error("ROOM_NOT_FOUND");
        if (mode === "host") {
          requireHost(room, token);
          await socket.join(`room:${normalized}:host`);
          ack({ ok: true, room: hostProjection(room) });
        } else if (mode === "player") {
          const player = requirePlayer(room, playerId, token);
          player.online = true; player.lastSeenAt = Date.now(); touch(room); await store.set(room);
          await socket.join(`room:${normalized}:player:${player.id}`);
          ack({ ok: true, room: playerProjection(room, player) });
          await emitRoom(room);
        } else {
          await socket.join(`room:${normalized}:public`);
          ack({ ok: true, room: publicProjection(room) });
        }
      } catch (error) { ack(safeError(error)); }
    });

    socket.on("player:join", async ({ code, name, gender, avatar }, ack = () => {}) => {
      try {
        const room = await store.get(normalizeRoomCode(code));
        if (!room) throw new Error("ROOM_NOT_FOUND");
        const player = joinPlayer(room, { name, gender, avatar });
        await store.set(room); await emitRoom(room);
        ack({ ok: true, player: { id: player.id, sessionToken: player.sessionToken }, room: playerProjection(room, player) });
      } catch (error) { ack(safeError(error)); }
    });

    socket.on("host:command", async ({ code, token, action, payload = {} }, ack = () => {}) => {
      try {
        const room = await store.get(normalizeRoomCode(code));
        if (!room) throw new Error("ROOM_NOT_FOUND");
        requireHost(room, token);
        if (action === "remove-player") room.players = room.players.filter(p => p.id !== payload.playerId);
        else if (action === "start-game") startGame(room);
        else if (action === "skip-role-reveal") { room.roleRevealEndsAt = Date.now(); touch(room); }
        else if (action === "eyes-closed") beginEyesClosed(room);
        else if (action === "wake-role") wakeRole(room, payload.role);
        else if (action === "finish-night") finishNight(room);
        else if (action === "start-voting") startVoting(room);
        else if (action === "next-night") beginNextNight(room);
        else if (action === "rematch") resetForRematch(room);
        else throw new Error("UNKNOWN_ACTION");
        await store.set(room); await emitRoom(room);
        ack({ ok: true, room: hostProjection(room) });
      } catch (error) { ack(safeError(error)); }
    });

    socket.on("player:command", async ({ code, playerId, token, action, payload = {} }, ack = () => {}) => {
      try {
        const room = await store.get(normalizeRoomCode(code));
        if (!room) throw new Error("ROOM_NOT_FOUND");
        const player = requirePlayer(room, playerId, token);
        if (action === "role-known") markRoleKnown(room, player);
        else if (action === "select-night-target") selectNightTarget(room, player, payload.targetId);
        else if (action === "skip-king-pardon") skipKingPardon(room, player);
        else if (action === "confirm-night-action") confirmNightAction(room, player);
        else if (action === "cast-vote") castVote(room, player, payload.targetId);
        else throw new Error("UNKNOWN_ACTION");
        await store.set(room); await emitRoom(room);
        ack({ ok: true, room: playerProjection(room, player) });
      } catch (error) { ack(safeError(error)); }
    });
  });

  return io;
}
