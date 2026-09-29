import { io } from "socket.io-client";

export const GAME_SERVERS = Object.freeze({
  A: Object.freeze({
    id: "A",
    name: "Railway A",
    url: "https://naif-mafia-realtime-production-156f.up.railway.app",
    tier: "primary",
    maxRooms: 38,
    maxConnections: 380,
  }),
  B: Object.freeze({
    id: "B",
    name: "Railway B",
    url: "https://mafia-game-production-5ac2.up.railway.app",
    tier: "primary",
    maxRooms: 38,
    maxConnections: 380,
  }),
  C: Object.freeze({
    id: "C",
    name: "Railway C",
    url: "https://mafia-game-c-production.up.railway.app",
    tier: "primary",
    maxRooms: 40,
    maxConnections: 400,
  }),
  R: Object.freeze({
    id: "R",
    name: "Render Backup",
    url: "https://mafia-game-1-mo6i.onrender.com",
    tier: "backup",
    maxRooms: 20,
    maxConnections: 200,
  }),
});

export const LEGACY_SERVER_ID = "R";
export const INITIAL_SERVER_ID = "A";

const PRIMARY_SERVER_IDS = Object.freeze(["A", "B", "C"]);
const BACKUP_SERVER_IDS = Object.freeze(["R"]);
const PRIMARY_HEALTH_RETRIES = 3;

function delay(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function serverIdForRoomCode(code) {
  const normalized = normalizeCode(code);

  // New sharded room codes are seven characters:
  // Axxxxxx, Bxxxxxx, Cxxxxxx, Rxxxxxx.
  // Existing six-character room codes stay on Render for backward compatibility.
  if (normalized.length === 7 && GAME_SERVERS[normalized[0]]) {
    return normalized[0];
  }

  return LEGACY_SERVER_ID;
}

export function serverForRoomCode(code) {
  return GAME_SERVERS[serverIdForRoomCode(code)] || GAME_SERVERS[LEGACY_SERVER_ID];
}

export function serverUrlForRoomCode(code) {
  return serverForRoomCode(code).url;
}

async function fetchServerHealth(server, timeoutMs = 6500) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${server.url}/api/health`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) throw new Error("SERVER_UNAVAILABLE");

    const data = await response.json();
    if (!data?.ok) throw new Error("SERVER_UNHEALTHY");

    return {
      ...server,
      health: data,
      activeRooms: Math.max(0, Number(data.activeRooms || 0)),
      liveRooms: Math.max(
        0,
        Number(data.liveRooms ?? data.activeRooms ?? 0),
      ),
      connections: Math.max(0, Number(data.connections || 0)),
    };
  } finally {
    window.clearTimeout(timer);
  }
}

function serverHasCapacity(server) {
  return (
    server.liveRooms < Number(server.maxRooms || 0) &&
    server.connections < Number(server.maxConnections || 0)
  );
}

function serverFillRatio(server) {
  const roomRatio =
    Number(server.maxRooms || 0) > 0
      ? server.liveRooms / Number(server.maxRooms)
      : 1;

  const connectionRatio =
    Number(server.maxConnections || 0) > 0
      ? server.connections / Number(server.maxConnections)
      : 1;

  // Keep room distribution proportional to the configured room limits while
  // still protecting a server whose live socket count is unusually high.
  return Math.max(roomRatio, connectionRatio);
}

function chooseLeastFilled(servers) {
  return [...servers].sort((a, b) => {
    const difference = serverFillRatio(a) - serverFillRatio(b);
    if (Math.abs(difference) > 0.02) return difference;
    return Math.random() - 0.5;
  })[0];
}

async function fetchHealthyServers(serverIds, timeoutMs = 6500) {
  const results = await Promise.allSettled(
    serverIds.map(id => fetchServerHealth(GAME_SERVERS[id], timeoutMs)),
  );

  return results
    .filter(result => result.status === "fulfilled")
    .map(result => result.value);
}

export async function chooseBestServerForNewRoom() {
  // Primary pool:
  // A = 38 rooms / 380 sockets
  // B = 38 rooms / 380 sockets
  // C = 40 rooms / 400 sockets
  //
  // IMPORTANT:
  // A failed/slow health check is NOT treated as "primary is full".
  // Render is allowed only after A, B and C all explicitly answer health
  // checks and all three are confirmed at their configured capacity.
  let primariesConfirmedFull = false;

  for (let attempt = 0; attempt < PRIMARY_HEALTH_RETRIES; attempt += 1) {
    const healthyPrimaries = await fetchHealthyServers(
      PRIMARY_SERVER_IDS,
      attempt === 0 ? 6500 : 4500,
    );

    const primaryServers = healthyPrimaries.filter(serverHasCapacity);

    if (primaryServers.length) {
      return chooseLeastFilled(primaryServers);
    }

    const allPrimariesAnswered =
      healthyPrimaries.length === PRIMARY_SERVER_IDS.length;

    if (allPrimariesAnswered) {
      // Every primary answered successfully and none has capacity.
      primariesConfirmedFull = true;
      break;
    }

    if (attempt < PRIMARY_HEALTH_RETRIES - 1) {
      await delay(400 + attempt * 400);
    }
  }

  // Never spill rooms to Render merely because Railway health checks timed out.
  // This prevents premature Render allocation under test/load spikes.
  if (!primariesConfirmedFull) {
    throw new Error("PRIMARY_HEALTH_UNCERTAIN");
  }

  const healthyBackups = await fetchHealthyServers(BACKUP_SERVER_IDS, 5000);
  const backupServers = healthyBackups.filter(serverHasCapacity);

  if (backupServers.length) {
    return chooseLeastFilled(backupServers);
  }

  throw new Error("NO_GAME_SERVER_CAPACITY");
}

export function createRoutedSocket(options = {}) {
  const listeners = new Map();
  // Never connect idle clients to the Render backup by default.
  let currentServer = GAME_SERVERS[INITIAL_SERVER_ID];
  let currentSocket = null;

  const bindListeners = socket => {
    for (const [eventName, handlers] of listeners.entries()) {
      for (const handler of handlers) socket.on(eventName, handler);
    }
  };

  const switchTo = server => {
    if (!server?.url) throw new Error("INVALID_GAME_SERVER");

    if (currentSocket && currentServer?.url === server.url) {
      return false;
    }

    if (currentSocket) {
      for (const [eventName, handlers] of listeners.entries()) {
        for (const handler of handlers) currentSocket.off(eventName, handler);
      }
      currentSocket.disconnect();
    }

    currentServer = server;
    currentSocket = io(server.url, options);
    bindListeners(currentSocket);
    return true;
  };

  // Keep legacy behaviour on first load. Routing changes only when a room is
  // created or a room code identifies another shard.
  switchTo(currentServer);

  return {
    get connected() {
      return Boolean(currentSocket?.connected);
    },

    get serverId() {
      return currentServer?.id || LEGACY_SERVER_ID;
    },

    get serverUrl() {
      return currentServer?.url || GAME_SERVERS[LEGACY_SERVER_ID].url;
    },

    on(eventName, handler) {
      if (!listeners.has(eventName)) listeners.set(eventName, new Set());
      listeners.get(eventName).add(handler);
      currentSocket?.on(eventName, handler);
      return this;
    },

    off(eventName, handler) {
      listeners.get(eventName)?.delete(handler);
      currentSocket?.off(eventName, handler);
      return this;
    },

    emit(...args) {
      return currentSocket?.emit(...args);
    },

    connect() {
      currentSocket?.connect();
      return this;
    },

    disconnect() {
      currentSocket?.disconnect();
      return this;
    },

    useServer(server) {
      const changed = switchTo(server);
      return { server: currentServer, changed };
    },

    useServerForRoom(code) {
      const server = serverForRoomCode(code);
      const changed = switchTo(server);
      return { server, changed };
    },

    async useBestServerForNewRoom() {
      const server = await chooseBestServerForNewRoom();
      const changed = switchTo(server);
      return { server, changed };
    },
  };
}
