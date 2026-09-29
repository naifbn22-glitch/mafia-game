import { io } from "socket.io-client";

// Mafia SA multi-server stress test
// Usage:
//   node full-auto-multiserver-test.mjs ROOMS MATCHES_PER_ROOM RECONNECT_PERCENT RECONNECT_INTERVAL_SECONDS [ALL|A|B|C|R]
// Examples:
//   node full-auto-multiserver-test.mjs 30 1 5 10 ALL
//   node full-auto-multiserver-test.mjs 20 1 5 10 A
//   node full-auto-multiserver-test.mjs 20 1 5 10 B
//   node full-auto-multiserver-test.mjs 20 1 5 10 C
//   node full-auto-multiserver-test.mjs 20 1 5 10 R
//
// 1 room = 1 host socket + 9 player sockets = 10 sockets.

const SERVERS = Object.freeze({
  A: Object.freeze({
    id: "A",
    name: "Railway A",
    url: "https://naif-mafia-realtime-production-156f.up.railway.app",
    capacityWeight: 3,
  }),
  B: Object.freeze({
    id: "B",
    name: "Railway B",
    url: "https://mafia-game-production-5ac2.up.railway.app",
    capacityWeight: 3,
  }),
  C: Object.freeze({
    id: "C",
    name: "Railway C",
    url: "https://mafia-game-c-production.up.railway.app",
    capacityWeight: 3,
  }),
  R: Object.freeze({
    id: "R",
    name: "Render",
    url: "https://mafia-game-1-mo6i.onrender.com",
    capacityWeight: 1,
  }),
});

const ROOM_COUNT = positiveInt(process.argv[2], 30);
const MATCHES_PER_ROOM = positiveInt(process.argv[3], 1);
const RECONNECT_PERCENT = clampNumber(process.argv[4], 10, 0, 100);
const RECONNECT_INTERVAL_SECONDS = clampNumber(process.argv[5], 10, 1, 3600);
const TARGET_SERVER = String(process.argv[6] || "ALL").trim().toUpperCase();

if (!["ALL", "A", "B", "C", "R"].includes(TARGET_SERVER)) {
  throw new Error("INVALID_TARGET_SERVER: use ALL, A, B, C, or R");
}

const PLAYERS_PER_ROOM = 9;
const SOCKETS_PER_ROOM = PLAYERS_PER_ROOM + 1;
const TOTAL_TARGET_SOCKETS = ROOM_COUNT * SOCKETS_PER_ROOM;
const TOTAL_TARGET_MATCHES = ROOM_COUNT * MATCHES_PER_ROOM;
const ACK_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 30_000;
const HEALTH_TIMEOUT_MS = 60_000;
const SETUP_ROOM_GAP_MS = 250;
const CONNECT_RETRY_LIMIT = 4;
const MAX_GAME_ROUNDS = 12;
const BETWEEN_STEPS_MS = 70;
const RECONNECT_DOWNTIME_MIN_MS = 180;
const RECONNECT_DOWNTIME_MAX_MS = 900;

let stopping = false;
let reconnectTimer = null;
let progressTimer = null;
const testStartedAt = Date.now();
const allClients = [];
const roomContexts = [];
const inFlightReconnects = new Set();

const globalMetrics = {
  ackCount: 0,
  ackLatencyTotal: 0,
  ackLatencyMax: 0,
  ackLatencySamples: [],
  commandRetries: 0,
  syncRetries: 0,
  errors: 0,
  transportErrors: 0,
  reconnectAttempts: 0,
  reconnectSuccesses: 0,
  reconnectFailures: 0,
  rounds: 0,
  nightActions: 0,
  votes: 0,
  matchesCompleted: 0,
  roomsFailed: 0,
  winners: { citizens: 0, thieves: 0 },
  errorSamples: [],
};

const serverMetrics = Object.fromEntries(
  Object.values(SERVERS).map(server => [server.id, {
    id: server.id,
    name: server.name,
    url: server.url,
    rooms: 0,
    sockets: 0,
    matchesTarget: 0,
    matchesCompleted: 0,
    roomsFailed: 0,
    rounds: 0,
    nightActions: 0,
    votes: 0,
    ackCount: 0,
    ackLatencyTotal: 0,
    ackLatencyMax: 0,
    ackLatencySamples: [],
    errors: 0,
    transportErrors: 0,
    reconnectAttempts: 0,
    reconnectSuccesses: 0,
    reconnectFailures: 0,
    winners: { citizens: 0, thieves: 0 },
  }]),
);

function positiveInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function randomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function nowClock() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function formatMs(value) {
  return `${Math.round(Number(value || 0))}ms`;
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function serverForCode(code) {
  const id = normalizeCode(code)[0];
  return SERVERS[id] || SERVERS.R;
}

function logError(error, context = "", serverId = null) {
  const message = error instanceof Error ? error.message : String(error || "UNKNOWN_ERROR");
  globalMetrics.errors += 1;
  if (serverId && serverMetrics[serverId]) serverMetrics[serverId].errors += 1;
  if (globalMetrics.errorSamples.length < 40) {
    globalMetrics.errorSamples.push({ context, serverId, message });
  }
  console.error(`[${nowClock()}] [ERROR]${serverId ? ` [${serverId}]` : ""} ${context}: ${message}`);
}

function recordLatency(serverId, latencyMs) {
  globalMetrics.ackCount += 1;
  globalMetrics.ackLatencyTotal += latencyMs;
  globalMetrics.ackLatencyMax = Math.max(globalMetrics.ackLatencyMax, latencyMs);
  globalMetrics.ackLatencySamples.push(latencyMs);

  const metrics = serverMetrics[serverId];
  if (!metrics) return;
  metrics.ackCount += 1;
  metrics.ackLatencyTotal += latencyMs;
  metrics.ackLatencyMax = Math.max(metrics.ackLatencyMax, latencyMs);
  metrics.ackLatencySamples.push(latencyMs);
}

async function fetchHealth(server, timeoutMs = HEALTH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const response = await fetch(`${server.url}/api/health`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: { "Cache-Control": "no-cache" },
    });
    if (!response.ok) throw new Error(`HEALTH_HTTP_${response.status}`);
    const data = await response.json();
    if (!data?.ok) throw new Error("HEALTH_NOT_OK");

    return {
      ...server,
      health: data,
      latencyMs: Date.now() - started,
      activeRooms: Math.max(0, Number(data.activeRooms || 0)),
      connections: Math.max(0, Number(data.connections || 0)),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function preflight() {
  console.log("\n=== PRE-FLIGHT HEALTH CHECK ===");

  const serversToCheck =
    TARGET_SERVER === "ALL"
      ? Object.values(SERVERS)
      : [SERVERS[TARGET_SERVER]];

  for (const server of serversToCheck) {
    const result = await fetchHealth(server);
    const actualId = String(result.health?.serverId || "").toUpperCase();
    if (actualId !== server.id) {
      throw new Error(
        `${server.name} returned serverId=${actualId || "missing"}, expected ${server.id}`,
      );
    }

    console.log(
      `[${server.id}] ${server.name} OK | ${formatMs(result.latencyMs)} | ` +
      `activeRooms=${result.activeRooms} | connections=${result.connections} | redis=${Boolean(result.health?.redis)}`,
    );
  }
}

async function chooseBestServerForNewRoom() {
  if (TARGET_SERVER !== "ALL") {
    const server = SERVERS[TARGET_SERVER];
    const result = await fetchHealth(server, 12_000);
    return result;
  }

  const results = await Promise.allSettled(
    Object.values(SERVERS).map(server => fetchHealth(server, 12_000)),
  );

  const available = results
    .filter(result => result.status === "fulfilled")
    .map(result => result.value);

  if (!available.length) throw new Error("NO_HEALTHY_GAME_SERVERS");

  for (const server of available) {
    const loadUnits = server.activeRooms + server.connections / 250 + 1;
    server.score = loadUnits / Math.max(0.5, Number(server.capacityWeight || 1));
  }

  available.sort((a, b) => {
    const difference = a.score - b.score;
    if (Math.abs(difference) > 0.08) return difference;
    return Math.random() - 0.5;
  });

  return available[0];
}

function waitForConnect(socket, timeoutMs = CONNECT_TIMEOUT_MS) {
  if (socket.connected) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let lastError = null;

    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          lastError?.message
            ? `CONNECT_TIMEOUT:${lastError.message}`
            : "CONNECT_TIMEOUT",
        ),
      );
    }, timeoutMs);

    const onConnect = () => {
      cleanup();
      resolve();
    };

    const onError = error => {
      // Do not fail the whole test on the first Socket.IO handshake timeout.
      // Socket.IO is configured to reconnect automatically, so keep waiting
      // until the overall connection window expires.
      lastError =
        error instanceof Error
          ? error
          : new Error(String(error || "CONNECT_ERROR"));
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
    };

    socket.once("connect", onConnect);
    socket.on("connect_error", onError);
    socket.connect();
  });
}

async function connectClientReliably(client, { retries = CONNECT_RETRY_LIMIT } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      await waitForConnect(client.socket, CONNECT_TIMEOUT_MS);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= retries - 1) break;

      globalMetrics.commandRetries += 1;

      try {
        client.socket.disconnect();
      } catch {}

      await sleep(500 + attempt * 500);

      try {
        client.socket.connect();
      } catch {}
    }
  }

  throw lastError || new Error("CONNECT_FAILED");
}

function createClient(server, kind, label) {
  const socket = io(server.url, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 300,
    reconnectionDelayMax: 2200,
    timeout: 20_000,
    forceNew: true,
    multiplex: false,
  });

  const client = {
    serverId: server.id,
    server,
    kind,
    label,
    socket,
    code: null,
    token: null,
    playerId: null,
    needsSubscribe: false,
    reconnecting: false,
    reconnectPromise: null,
    closed: false,
  };

  socket.on("disconnect", () => {
    if (client.code && client.token) client.needsSubscribe = true;
  });

  socket.on("connect_error", error => {
    if (stopping || client.closed) return;

    globalMetrics.transportErrors += 1;
    serverMetrics[server.id].transportErrors += 1;

    if (globalMetrics.errorSamples.length < 40) {
      globalMetrics.errorSamples.push({
        context: `transport:${client.label}`,
        serverId: server.id,
        message: error?.message || "CONNECT_ERROR",
      });
    }
  });

  allClients.push(client);
  return client;
}

function rawEmitAck(client, eventName, payload, timeoutMs = ACK_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const socket = client.socket;

    if (!socket.connected) {
      reject(new Error("SOCKET_NOT_CONNECTED"));
      return;
    }

    const started = Date.now();
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`SERVER_TIMEOUT:${eventName}`));
    }, timeoutMs);

    try {
      socket.emit(eventName, payload, response => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        recordLatency(client.serverId, Date.now() - started);

        if (!response?.ok) {
          reject(new Error(response?.error || `SERVER_ERROR:${eventName}`));
        } else {
          resolve(response);
        }
      });
    } catch (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    }
  });
}

async function subscribeClient(client) {
  if (!client.code || !client.token) return;

  const payload = client.kind === "host"
    ? { code: client.code, mode: "host", token: client.token }
    : {
        code: client.code,
        mode: "player",
        playerId: client.playerId,
        token: client.token,
      };

  await rawEmitAck(client, "room:subscribe", payload);
  client.needsSubscribe = false;
}

async function ensureClientReady(client) {
  if (client.closed) throw new Error("CLIENT_CLOSED");

  if (client.reconnectPromise) {
    await client.reconnectPromise;
  }

  if (!client.socket.connected) {
    await connectClientReliably(client);
  }

  if (client.needsSubscribe && client.code && client.token) {
    await subscribeClient(client);
  }
}

async function clientAck(client, eventName, payload, timeoutMs = ACK_TIMEOUT_MS) {
  await ensureClientReady(client);
  return rawEmitAck(client, eventName, payload, timeoutMs);
}

async function reliableSync(client, payload, { retries = 4 } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      await ensureClientReady(client);
      return await rawEmitAck(client, "room:sync", payload, ACK_TIMEOUT_MS);
    } catch (error) {
      lastError = error;

      if (attempt >= retries - 1) break;

      globalMetrics.syncRetries += 1;

      // A forced disconnect can make an already-sent ACK disappear even though
      // the socket reconnect itself succeeds. Wait for the reconnect/subscription
      // cycle, then repeat room:sync just like the production client does.
      try {
        await ensureClientReady(client);
      } catch {
        // The next retry will attempt recovery again.
      }

      await sleep(180 + attempt * 260);
    }
  }

  throw lastError || new Error("ROOM_SYNC_FAILED");
}

async function syncHost(roomCtx) {
  const response = await reliableSync(roomCtx.host, {
    code: roomCtx.code,
    mode: "host",
    token: roomCtx.host.token,
  });

  roomCtx.hostState = response.room;
  return response.room;
}

async function syncPlayer(playerClient) {
  const response = await reliableSync(playerClient, {
    code: playerClient.code,
    mode: "player",
    playerId: playerClient.playerId,
    token: playerClient.token,
  });

  return response.room;
}

async function reliableCommand({
  client,
  eventName,
  payload,
  verify = null,
  label = eventName,
  retries = 3,
}) {
  let lastError = null;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await clientAck(client, eventName, payload);
    } catch (error) {
      lastError = error;

      if (attempt >= retries - 1) break;

      globalMetrics.commandRetries += 1;

      try {
        if (verify) {
          const verified = await verify();
          if (verified) {
            return { ok: true, recovered: true, room: verified };
          }
        }
      } catch {
        // Retry below after reconnect/subscription recovery.
      }

      await sleep(180 + attempt * 220);

      try {
        await ensureClientReady(client);
      } catch {
        // The next retry records the final outcome.
      }
    }
  }

  throw new Error(`${label}: ${lastError?.message || "FAILED"}`);
}

async function hostCommand(roomCtx, action, payload = {}, expected = null) {
  const response = await reliableCommand({
    client: roomCtx.host,
    eventName: "host:command",
    payload: {
      code: roomCtx.code,
      token: roomCtx.host.token,
      action,
      payload,
    },
    label: `host:${action}`,
    verify: expected
      ? async () => {
          const room = await syncHost(roomCtx);
          return expected(room) ? room : null;
        }
      : null,
  });

  if (response?.room) roomCtx.hostState = response.room;
  return response?.room || roomCtx.hostState;
}

async function playerCommand(playerClient, action, payload = {}, verify = null) {
  return reliableCommand({
    client: playerClient,
    eventName: "player:command",
    payload: {
      code: playerClient.code,
      playerId: playerClient.playerId,
      token: playerClient.token,
      action,
      payload,
    },
    label: `player:${action}`,
    verify: verify
      ? async () => {
          const room = await syncPlayer(playerClient);
          return verify(room) ? room : null;
        }
      : null,
  });
}

async function setupRoom(index) {
  const chosen = await chooseBestServerForNewRoom();
  const host = createClient(chosen, "host", `room-${index}-host`);
  await connectClientReliably(host);

  const createResponse = await rawEmitAck(host, "room:create", {
    hostName: `LoadHost-${String(index).padStart(3, "0")}`,
    roomName: `Load Room ${index}`,
    maxPlayers: PLAYERS_PER_ROOM,
    discussionDurationSeconds: 30,
  }, 20_000);

  const code = normalizeCode(createResponse.room?.code);
  if (!code) throw new Error("ROOM_CREATE_NO_CODE");

  if (code[0] !== chosen.id) {
    throw new Error(`ROOM_PREFIX_MISMATCH code=${code} chosen=${chosen.id}`);
  }

  const routedServer = serverForCode(code);
  if (routedServer.id !== chosen.id) {
    throw new Error(
      `ROUTER_MISMATCH code=${code} expected=${chosen.id} got=${routedServer.id}`,
    );
  }

  host.code = code;
  host.token = createResponse.hostToken;
  host.needsSubscribe = true;
  await subscribeClient(host);

  const roomCtx = {
    index,
    code,
    serverId: chosen.id,
    server: chosen,
    host,
    players: [],
    hostState: createResponse.room,
    matchesCompleted: 0,
    failed: false,
  };

  const playerClients = Array.from({ length: PLAYERS_PER_ROOM }, (_, offset) => {
    const playerNumber = offset + 1;
    return createClient(
      routedServer,
      "player",
      `room-${index}-player-${playerNumber}`,
    );
  });

  await Promise.all(playerClients.map(client => connectClientReliably(client)));

  const joinResults = await Promise.all(
    playerClients.map(async (client, offset) => {
      const playerNumber = offset + 1;

      const response = await rawEmitAck(client, "player:join", {
        code,
        name: `R${index}-P${playerNumber}`,
        gender: playerNumber % 2 === 0 ? "female" : "male",
        avatar:
          `/avatars/avatar-${String(((playerNumber - 1) % 12) + 1).padStart(2, "0")}.png`,
      }, 20_000);

      client.code = code;
      client.playerId = response.player.id;
      client.token = response.player.sessionToken;
      client.needsSubscribe = true;

      await subscribeClient(client);
      return client;
    }),
  );

  roomCtx.players = joinResults;
  roomContexts.push(roomCtx);

  const metrics = serverMetrics[chosen.id];
  metrics.rooms += 1;
  metrics.sockets += SOCKETS_PER_ROOM;
  metrics.matchesTarget += MATCHES_PER_ROOM;

  console.log(
    `[SETUP ${String(index).padStart(3, "0")}/${ROOM_COUNT}] ${code} -> ${chosen.id} ` +
    `(${chosen.name}) | sockets=${SOCKETS_PER_ROOM}`,
  );

  return roomCtx;
}

function playerClientById(roomCtx, playerId) {
  return roomCtx.players.find(client => client.playerId === playerId) || null;
}

async function markAllRolesKnown(roomCtx) {
  const state = roomCtx.hostState || await syncHost(roomCtx);

  await Promise.all(
    state.players.map(async player => {
      const client = playerClientById(roomCtx, player.id);
      if (!client) throw new Error(`PLAYER_CLIENT_MISSING:${player.id}`);

      await playerCommand(client, "role-known", {}, room => {
        const me = room.players?.find(item => item.id === client.playerId);
        return Boolean(me?.roleKnown);
      });
    }),
  );
}

function chooseTargetForRole(hostState, actor) {
  const alive = hostState.players.filter(player => player.alive);

  if (actor.role === "thief") {
    return alive.find(player =>
      player.role !== "thief" &&
      player.id !== hostState.lastTargets?.thief
    ) || null;
  }

  if (actor.role === "nurse") {
    return alive.find(player => player.id !== hostState.lastTargets?.nurse) || null;
  }

  if (actor.role === "investigator") {
    return alive.find(player => player.id !== actor.id) || null;
  }

  if (actor.role === "king") {
    return alive.find(player => player.id !== actor.id) || null;
  }

  return null;
}

async function executeNightRole(roomCtx, role) {
  let hostState = roomCtx.hostState || await syncHost(roomCtx);
  const actors = hostState.players.filter(
    player => player.alive && player.role === role,
  );

  if (!actors.length) return;

  hostState = await hostCommand(
    roomCtx,
    "wake-role",
    { role },
    room => room.phase === "night-role" && room.activeRole === role,
  );

  await Promise.all(
    actors.map(async actor => {
      const client = playerClientById(roomCtx, actor.id);
      if (!client) throw new Error(`ACTOR_CLIENT_MISSING:${actor.id}`);

      if (role === "king") {
        await playerCommand(
          client,
          "skip-king-pardon",
          {},
          room => Boolean(room.nightActions?.kingSkipped),
        );

        await playerCommand(
          client,
          "confirm-night-action",
          {},
          room => Boolean(room.nightActions?.confirmedActors?.[actor.id]),
        );

        globalMetrics.nightActions += 1;
        serverMetrics[roomCtx.serverId].nightActions += 1;
        return;
      }

      const target = chooseTargetForRole(hostState, actor);
      if (!target) throw new Error(`NO_VALID_TARGET:${role}:${actor.id}`);

      await playerCommand(
        client,
        "select-night-target",
        { targetId: target.id },
        room => {
          if (role === "thief") {
            return room.nightActions?.thiefVotes?.[actor.id] === target.id;
          }
          if (role === "nurse") {
            return room.nightActions?.nurseTargetId === target.id;
          }
          if (role === "investigator") {
            return room.nightActions?.investigatorTargetId === target.id;
          }
          return false;
        },
      );

      await playerCommand(
        client,
        "confirm-night-action",
        {},
        room => Boolean(room.nightActions?.confirmedActors?.[actor.id]),
      );

      globalMetrics.nightActions += 1;
      serverMetrics[roomCtx.serverId].nightActions += 1;
    }),
  );

  roomCtx.hostState = await syncHost(roomCtx);
  await sleep(BETWEEN_STEPS_MS);
}

async function waitForDiscussionWindow(hostState) {
  const endsAt = Number(hostState?.dayEndsAt || 0);
  if (!endsAt) return;

  const remaining = endsAt - Date.now();
  if (remaining > 0) {
    await sleep(remaining + 80);
  }
}

async function executeVoting(roomCtx) {
  let hostState = roomCtx.hostState || await syncHost(roomCtx);

  hostState = await hostCommand(
    roomCtx,
    "start-voting",
    {},
    room =>
      ["voting", "voting-result"].includes(room.phase) ||
      Boolean(room.winner),
  );

  if (hostState.winner) return hostState;

  const alive = hostState.players.filter(player => player.alive);
  const thiefTarget = alive.find(player => player.role === "thief") || null;

  if (!thiefTarget) {
    return syncHost(roomCtx);
  }

  await Promise.all(
    alive.map(async voter => {
      const client = playerClientById(roomCtx, voter.id);
      if (!client) throw new Error(`VOTER_CLIENT_MISSING:${voter.id}`);

      let targetId = thiefTarget.id;

      if (voter.id === thiefTarget.id) {
        const alternate = alive.find(player => player.id !== voter.id);
        targetId = alternate?.id || "abstain";
      }

      await playerCommand(
        client,
        "cast-vote",
        { targetId },
        room => room.myVote === targetId,
      );

      globalMetrics.votes += 1;
      serverMetrics[roomCtx.serverId].votes += 1;
    }),
  );

  roomCtx.hostState = await syncHost(roomCtx);
  return roomCtx.hostState;
}

async function runSingleMatch(roomCtx, matchNumber) {
  let state = await hostCommand(
    roomCtx,
    "start-game",
    {},
    room => room.status === "playing" && room.phase === "role-reveal",
  );

  await markAllRolesKnown(roomCtx);

  await hostCommand(
    roomCtx,
    "skip-role-reveal",
    {},
    room => Number(room.roleRevealEndsAt || 0) <= Date.now() + 1500,
  );

  state = await hostCommand(
    roomCtx,
    "eyes-closed",
    {},
    room => room.phase === "eyes-closed",
  );

  for (let round = 1; round <= MAX_GAME_ROUNDS; round += 1) {
    globalMetrics.rounds += 1;
    serverMetrics[roomCtx.serverId].rounds += 1;

    for (const role of ["thief", "nurse", "king", "investigator"]) {
      await executeNightRole(roomCtx, role);
    }

    state = await hostCommand(
      roomCtx,
      "finish-night",
      {},
      room => room.phase === "day" || Boolean(room.winner),
    );

    if (state.winner) break;

    // Wait for the real 30-second production discussion window.
    // This keeps the run long enough for repeated reconnect waves.
    await waitForDiscussionWindow(state);

    state = await executeVoting(roomCtx);
    if (state.winner) break;

    state = await hostCommand(
      roomCtx,
      "next-night",
      {},
      room =>
        room.phase === "eyes-closed" &&
        Number(room.roundNumber || 1) >= round + 1,
    );

    await sleep(BETWEEN_STEPS_MS);
  }

  state = await syncHost(roomCtx);

  if (!state.winner) {
    throw new Error(
      `MATCH_DID_NOT_FINISH_WITHIN_${MAX_GAME_ROUNDS}_ROUNDS`,
    );
  }

  roomCtx.matchesCompleted += 1;
  globalMetrics.matchesCompleted += 1;
  serverMetrics[roomCtx.serverId].matchesCompleted += 1;

  const winner = state.winner === "thieves" ? "thieves" : "citizens";
  globalMetrics.winners[winner] += 1;
  serverMetrics[roomCtx.serverId].winners[winner] += 1;

  console.log(
    `[MATCH] ${roomCtx.code} | server=${roomCtx.serverId} | ` +
    `match=${matchNumber}/${MATCHES_PER_ROOM} | winner=${winner} | round=${state.roundNumber}`,
  );

  return state;
}

async function runRoom(roomCtx) {
  try {
    for (
      let matchNumber = 1;
      matchNumber <= MATCHES_PER_ROOM;
      matchNumber += 1
    ) {
      if (matchNumber > 1) {
        await hostCommand(
          roomCtx,
          "rematch",
          {},
          room =>
            room.status === "waiting" &&
            room.phase === "lobby" &&
            !room.winner,
        );
      }

      await runSingleMatch(roomCtx, matchNumber);
    }
  } catch (error) {
    roomCtx.failed = true;
    globalMetrics.roomsFailed += 1;
    serverMetrics[roomCtx.serverId].roomsFailed += 1;
    logError(error, `room=${roomCtx.code}`, roomCtx.serverId);
  }
}

async function forcedReconnect(client) {
  if (stopping || client.closed || client.reconnecting) return;

  client.reconnecting = true;
  globalMetrics.reconnectAttempts += 1;
  serverMetrics[client.serverId].reconnectAttempts += 1;

  const reconnectWork = (async () => {
    try {
      client.socket.disconnect();
      client.needsSubscribe = Boolean(client.code && client.token);

      await sleep(
        randomBetween(
          RECONNECT_DOWNTIME_MIN_MS,
          RECONNECT_DOWNTIME_MAX_MS,
        ),
      );

      if (client.closed) return;

      client.socket.connect();
      await connectClientReliably(client, { retries: 3 });

      if (client.needsSubscribe) {
        await subscribeClient(client);
      }

      globalMetrics.reconnectSuccesses += 1;
      serverMetrics[client.serverId].reconnectSuccesses += 1;
    } catch (error) {
      globalMetrics.reconnectFailures += 1;
      serverMetrics[client.serverId].reconnectFailures += 1;

      if (globalMetrics.errorSamples.length < 40) {
        globalMetrics.errorSamples.push({
          context: `reconnect:${client.label}`,
          serverId: client.serverId,
          message: error?.message || "RECONNECT_FAILED",
        });
      }
    } finally {
      client.reconnecting = false;
      client.reconnectPromise = null;
    }
  })();

  client.reconnectPromise = reconnectWork;
  inFlightReconnects.add(reconnectWork);
  reconnectWork.finally(() => inFlightReconnects.delete(reconnectWork));

  return reconnectWork;
}

function randomSample(items, count) {
  const pool = [...items];

  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool.slice(0, Math.max(0, Math.min(count, pool.length)));
}

function runReconnectWave() {
  if (stopping || RECONNECT_PERCENT <= 0 || !allClients.length) return;

  const eligible = allClients.filter(
    client => !client.closed && !client.reconnecting,
  );

  if (!eligible.length) return;

  const count = Math.max(
    1,
    Math.round(allClients.length * RECONNECT_PERCENT / 100),
  );

  const selected = randomSample(eligible, count);

  console.log(
    `[RECONNECT] forcing ${selected.length}/${allClients.length} sockets (${RECONNECT_PERCENT}%)`,
  );

  for (const client of selected) {
    forcedReconnect(client);
  }
}

function startReconnectLoop() {
  if (RECONNECT_PERCENT <= 0) return;

  reconnectTimer = setInterval(
    runReconnectWave,
    RECONNECT_INTERVAL_SECONDS * 1000,
  );
}

function startProgressLoop() {
  progressTimer = setInterval(() => {
    const elapsed = Math.round((Date.now() - testStartedAt) / 1000);

    console.log(
      `[PROGRESS] ${elapsed}s | matches=${globalMetrics.matchesCompleted}/${TOTAL_TARGET_MATCHES} | ` +
      `reconnect=${globalMetrics.reconnectSuccesses}/${globalMetrics.reconnectAttempts} ` +
      `(failed=${globalMetrics.reconnectFailures}) | errors=${globalMetrics.errors}`,
    );
  }, 10_000);
}

async function shutdownSockets() {
  stopping = true;

  if (reconnectTimer) clearInterval(reconnectTimer);
  if (progressTimer) clearInterval(progressTimer);

  // Finish reconnects that already started before closing sockets.
  if (inFlightReconnects.size) {
    await Promise.allSettled([...inFlightReconnects]);
  }

  for (const client of allClients) {
    client.closed = true;

    try {
      client.socket.removeAllListeners();
      client.socket.disconnect();
    } catch {
      // Best-effort cleanup.
    }
  }

  await sleep(250);
}

function averageLatency(metrics) {
  return metrics.ackCount
    ? metrics.ackLatencyTotal / metrics.ackCount
    : 0;
}

function percentileLatency(metrics, percentile) {
  const samples = Array.isArray(metrics.ackLatencySamples)
    ? metrics.ackLatencySamples
    : [];

  if (!samples.length) return 0;

  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1),
  );

  return sorted[index];
}

function countLatencyOver(metrics, thresholdMs) {
  const samples = Array.isArray(metrics.ackLatencySamples)
    ? metrics.ackLatencySamples
    : [];

  return samples.filter(value => value > thresholdMs).length;
}

function latencyPercent(count, total) {
  if (!total) return "0.00%";
  return `${((count / total) * 100).toFixed(2)}%`;
}

function latencySummary(metrics) {
  const total = metrics.ackLatencySamples?.length || 0;
  const over2s = countLatencyOver(metrics, 2_000);
  const over5s = countLatencyOver(metrics, 5_000);
  const over7s = countLatencyOver(metrics, 7_000);

  return {
    total,
    p95: percentileLatency(metrics, 95),
    p99: percentileLatency(metrics, 99),
    over2s,
    over5s,
    over7s,
    over2sPct: latencyPercent(over2s, total),
    over5sPct: latencyPercent(over5s, total),
    over7sPct: latencyPercent(over7s, total),
  };
}

function printFinalReport() {
  const elapsedSeconds = Math.max(
    1,
    Math.round((Date.now() - testStartedAt) / 1000),
  );

  console.log("\n============================================================");
  console.log("MAFIA MULTI-SERVER STRESS TEST REPORT");
  console.log("============================================================");
  console.log(`Rooms requested      : ${ROOM_COUNT}`);
  console.log(`Players per room     : ${PLAYERS_PER_ROOM}`);
  console.log(`Sockets per room     : ${SOCKETS_PER_ROOM}`);
  console.log(`Target sockets       : ${TOTAL_TARGET_SOCKETS}`);
  console.log(`Matches per room     : ${MATCHES_PER_ROOM}`);
  console.log(`Target matches       : ${TOTAL_TARGET_MATCHES}`);
  console.log(
    `Reconnect policy     : ${RECONNECT_PERCENT}% every ${RECONNECT_INTERVAL_SECONDS}s`,
  );
  console.log(`Elapsed              : ${elapsedSeconds}s`);
  console.log("");

  for (const id of ["A", "B", "C", "R"]) {
    const metrics = serverMetrics[id];
    const latency = latencySummary(metrics);

    console.log(
      `${id} (${metrics.name})\n` +
      `  rooms             : ${metrics.rooms}\n` +
      `  sockets           : ${metrics.sockets}\n` +
      `  matches           : ${metrics.matchesCompleted}/${metrics.matchesTarget}\n` +
      `  failed rooms      : ${metrics.roomsFailed}\n` +
      `  rounds            : ${metrics.rounds}\n` +
      `  night actions     : ${metrics.nightActions}\n` +
      `  votes             : ${metrics.votes}\n` +
      `  winners           : citizens=${metrics.winners.citizens}, thieves=${metrics.winners.thieves}\n` +
      `  reconnect         : attempts=${metrics.reconnectAttempts}, success=${metrics.reconnectSuccesses}, failed=${metrics.reconnectFailures}\n` +
      `  avg ack latency   : ${formatMs(averageLatency(metrics))}\n` +
      `  p95 ack latency   : ${formatMs(latency.p95)}\n` +
      `  p99 ack latency   : ${formatMs(latency.p99)}\n` +
      `  max ack latency   : ${formatMs(metrics.ackLatencyMax)}\n` +
      `  ack > 2s          : ${latency.over2s}/${latency.total} (${latency.over2sPct})\n` +
      `  ack > 5s          : ${latency.over5s}/${latency.total} (${latency.over5sPct})\n` +
      `  ack > 7s          : ${latency.over7s}/${latency.total} (${latency.over7sPct})\n` +
      `  transport errors  : ${metrics.transportErrors}\n` +
      `  final errors      : ${metrics.errors}`,
    );

    console.log("");
  }

  console.log("TOTAL");
  console.log(
    `  rooms created      : ${roomContexts.length}/${ROOM_COUNT}`,
  );
  console.log(
    `  sockets created    : ${allClients.length}/${TOTAL_TARGET_SOCKETS}`,
  );
  console.log(
    `  matches completed  : ${globalMetrics.matchesCompleted}/${TOTAL_TARGET_MATCHES}`,
  );
  console.log(`  failed rooms       : ${globalMetrics.roomsFailed}`);
  console.log(`  rounds             : ${globalMetrics.rounds}`);
  console.log(`  night actions      : ${globalMetrics.nightActions}`);
  console.log(`  votes              : ${globalMetrics.votes}`);
  console.log(
    `  citizen wins       : ${globalMetrics.winners.citizens}`,
  );
  console.log(
    `  thief wins         : ${globalMetrics.winners.thieves}`,
  );
  console.log(
    `  reconnect attempts : ${globalMetrics.reconnectAttempts}`,
  );
  console.log(
    `  reconnect success  : ${globalMetrics.reconnectSuccesses}`,
  );
  console.log(
    `  reconnect failed   : ${globalMetrics.reconnectFailures}`,
  );
  console.log(`  command retries    : ${globalMetrics.commandRetries}`);
  const totalLatency = latencySummary(globalMetrics);

  console.log(
    `  avg ack latency    : ${formatMs(averageLatency(globalMetrics))}`,
  );
  console.log(
    `  p95 ack latency    : ${formatMs(totalLatency.p95)}`,
  );
  console.log(
    `  p99 ack latency    : ${formatMs(totalLatency.p99)}`,
  );
  console.log(
    `  max ack latency    : ${formatMs(globalMetrics.ackLatencyMax)}`,
  );
  console.log(
    `  ack > 2s           : ${totalLatency.over2s}/${totalLatency.total} (${totalLatency.over2sPct})`,
  );
  console.log(
    `  ack > 5s           : ${totalLatency.over5s}/${totalLatency.total} (${totalLatency.over5sPct})`,
  );
  console.log(
    `  ack > 7s           : ${totalLatency.over7s}/${totalLatency.total} (${totalLatency.over7sPct})`,
  );
  console.log(
    `  transport errors   : ${globalMetrics.transportErrors}`,
  );
  console.log(`  final errors       : ${globalMetrics.errors}`);

  if (globalMetrics.errorSamples.length) {
    console.log("\nERROR SAMPLES (up to 40)");

    for (const sample of globalMetrics.errorSamples) {
      console.log(
        `  - ${sample.serverId ? `[${sample.serverId}] ` : ""}${sample.context}: ${sample.message}`,
      );
    }
  }

  const allServersUsed = ["A", "B", "C", "R"].every(
    id => serverMetrics[id].rooms > 0,
  );

  const clean =
    roomContexts.length === ROOM_COUNT &&
    allClients.length === TOTAL_TARGET_SOCKETS &&
    globalMetrics.matchesCompleted === TOTAL_TARGET_MATCHES &&
    globalMetrics.roomsFailed === 0 &&
    globalMetrics.reconnectFailures === 0 &&
    globalMetrics.errors === 0;

  console.log("\nRESULT");

  if (TARGET_SERVER === "ALL" && !allServersUsed) {
    console.log(
      "  WARNING: This run did not allocate at least one room to all A/B/C/R servers.",
    );
    console.log(
      "  Use more rooms to exercise every configured server.",
    );
  }

  console.log(clean ? "  PASS" : "  CHECK REPORT");
  console.log("============================================================\n");

  return clean;
}

async function main() {
  console.log("============================================================");
  console.log("Mafia SA - Multi-Server Automatic Stress Test");
  console.log("============================================================");
  console.log(`Rooms               : ${ROOM_COUNT}`);
  console.log(`Matches per room    : ${MATCHES_PER_ROOM}`);
  console.log(`Players per room    : ${PLAYERS_PER_ROOM}`);
  console.log(`Target sockets      : ${TOTAL_TARGET_SOCKETS}`);
  console.log(
    `Reconnect           : ${RECONNECT_PERCENT}% every ${RECONNECT_INTERVAL_SECONDS}s`,
  );
  console.log(
    TARGET_SERVER === "ALL"
      ? "Routing             : health/load weighted A=3, B=3, C=3, R=1"
      : `Target server       : ${TARGET_SERVER} (${SERVERS[TARGET_SERVER].name})`,
  );
  console.log("Discussion timer    : real 30-second production window");
  console.log("============================================================");

  await preflight();

  console.log("\n=== ROOM/SOCKET SETUP ===");

  for (let index = 1; index <= ROOM_COUNT; index += 1) {
    try {
      await setupRoom(index);
      await sleep(SETUP_ROOM_GAP_MS);
    } catch (error) {
      logError(error, `setup-room-${index}`);
      throw error;
    }
  }

  console.log("\n=== SETUP COMPLETE ===");
  console.log(`Rooms   : ${roomContexts.length}`);
  console.log(`Sockets : ${allClients.length}`);
  console.log(
    `Distribution: A=${serverMetrics.A.rooms}, B=${serverMetrics.B.rooms}, C=${serverMetrics.C.rooms}, R=${serverMetrics.R.rooms}`,
  );

  startReconnectLoop();
  startProgressLoop();

  console.log("\n=== STARTING MATCHES ===");

  await Promise.all(
    roomContexts.map(room => runRoom(room)),
  );
}

let cleanResult = false;

try {
  await main();
} catch (error) {
  logError(error, "fatal");
} finally {
  await shutdownSockets();
  cleanResult = printFinalReport();
}

process.exitCode = cleanResult ? 0 : 1;
