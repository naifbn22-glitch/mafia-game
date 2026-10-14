import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { io as createSocketClient } from "socket.io-client";
import { RoomStore } from "../server/roomStore.js";
import { createSocketServer } from "../server/socketServer.js";

function connectClient(url) {
  return new Promise((resolve, reject) => {
    const socket = createSocketClient(url, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
      timeout: 3000,
    });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(3000).emit(event, payload, (error, result) => {
      if (error) return reject(error);
      if (!result?.ok) return reject(new Error(result?.error || "SOCKET_ACTION_FAILED"));
      resolve(result);
    });
  });
}

test("demo night commentary reaches the host and every online player once", async t => {
  const previousEnabled = process.env.AI_COMMENTARY_ENABLED;
  const previousMode = process.env.AI_COMMENTARY_MODE;
  process.env.AI_COMMENTARY_ENABLED = "true";
  process.env.AI_COMMENTARY_MODE = "demo";

  const httpServer = http.createServer();
  const store = new RoomStore();
  const ioServer = await createSocketServer(httpServer, store);
  const sockets = [];
  await new Promise(resolve => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  const serverUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    for (const socket of sockets) socket.disconnect();
    await new Promise(resolve => ioServer.close(resolve));
    if (httpServer.listening) await new Promise(resolve => httpServer.close(resolve));
    if (previousEnabled === undefined) delete process.env.AI_COMMENTARY_ENABLED;
    else process.env.AI_COMMENTARY_ENABLED = previousEnabled;
    if (previousMode === undefined) delete process.env.AI_COMMENTARY_MODE;
    else process.env.AI_COMMENTARY_MODE = previousMode;
  });

  const host = await connectClient(serverUrl);
  sockets.push(host);
  const created = await emitAck(host, "room:create", {
    hostName: "Host",
    roomName: "AI voice test",
    maxPlayers: 4,
    discussionDurationSeconds: 30,
  });
  const code = created.room.code;
  const hostToken = created.hostToken;
  await emitAck(host, "room:subscribe", { code, mode: "host", token: hostToken });

  const players = [];
  for (let index = 0; index < 4; index += 1) {
    const joined = await emitAck(host, "player:join", {
      code,
      name: `Player ${index + 1}`,
      gender: "male",
      avatar: "/avatars/avatar-01.png",
    });
    const socket = await connectClient(serverUrl);
    sockets.push(socket);
    await emitAck(socket, "room:subscribe", {
      code,
      mode: "player",
      playerId: joined.player.id,
      token: joined.player.sessionToken,
    });
    players.push({ ...joined.player, name: `Player ${index + 1}`, socket });
  }

  const started = await emitAck(host, "host:command", { code, token: hostToken, action: "start-game" });
  const rolesByName = new Map(started.room.players.map(player => [player.name, player.role]));
  const playersByRole = new Map(players.map(player => [rolesByName.get(player.name), player]));
  await emitAck(host, "host:command", { code, token: hostToken, action: "skip-role-reveal" });
  await emitAck(host, "host:command", { code, token: hostToken, action: "eyes-closed" });

  const aliveNonThieves = started.room.players.filter(player => player.role !== "thief");
  const thiefTargetId = aliveNonThieves[0].id;
  for (const role of ["thief", "nurse", "king"]) {
    await emitAck(host, "host:command", { code, token: hostToken, action: "wake-role", payload: { role } });
    const actor = playersByRole.get(role);
    if (role === "king") {
      await emitAck(actor.socket, "player:command", {
        code,
        playerId: actor.id,
        token: actor.sessionToken,
        action: "skip-king-pardon",
      });
    } else {
      const targetId = role === "thief" ? thiefTargetId : aliveNonThieves[1].id;
      await emitAck(actor.socket, "player:command", {
        code,
        playerId: actor.id,
        token: actor.sessionToken,
        action: "select-night-target",
        payload: { targetId },
      });
    }
    await emitAck(actor.socket, "player:command", {
      code,
      playerId: actor.id,
      token: actor.sessionToken,
      action: "confirm-night-action",
    });
  }

  const receivedCounts = new Map(sockets.map(socket => [socket, 0]));
  const expectedEventId = `${code}:1:1`;
  let resolveAllReceived;
  const allReceived = new Promise(resolve => { resolveAllReceived = resolve; });
  for (const socket of sockets) {
    socket.on("room:ai-commentary", payload => {
      receivedCounts.set(socket, receivedCounts.get(socket) + 1);
      if (payload?.id === expectedEventId && [...receivedCounts.values()].every(count => count === 1)) {
        resolveAllReceived(payload);
      }
    });
  }

  await emitAck(host, "host:command", { code, token: hostToken, action: "finish-night" });
  const commentary = await Promise.race([
    allReceived,
    new Promise((_, reject) => setTimeout(() => reject(new Error("AI_COMMENTARY_BROADCAST_TIMEOUT")), 4000)),
  ]);

  assert.equal(commentary.mode, "demo");
  assert.equal(commentary.audioBase64, null);
  assert.match(commentary.text, /أشرقت الشمس|مرّت الليلة|انتهت الليلة/);
  assert.deepEqual([...receivedCounts.values()], [1, 1, 1, 1, 1]);
});
