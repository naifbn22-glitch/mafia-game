import { io } from "socket.io-client";

export const GAME_SERVERS = Object.freeze({
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
  R: Object.freeze({
    id: "R",
    name: "Render",
    url: "https://mafia-game-1-mo6i.onrender.com",
    capacityWeight: 1,
  }),
});

export const LEGACY_SERVER_ID = "R";

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function serverIdForRoomCode(code) {
  const normalized = normalizeCode(code);

  // New sharded room codes are seven characters:
  // Axxxxxx, Bxxxxxx, Rxxxxxx.
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
      connections: Math.max(0, Number(data.connections || 0)),
    };
  } finally {
    window.clearTimeout(timer);
  }
}

export async function chooseBestServerForNewRoom() {
  const results = await Promise.allSettled(
    Object.values(GAME_SERVERS).map(server => fetchServerHealth(server)),
  );

  const available = results
    .filter(result => result.status === "fulfilled")
    .map(result => result.value);

  if (!available.length) {
    // Preserve the old working behaviour if health checks are temporarily blocked.
    return GAME_SERVERS[LEGACY_SERVER_ID];
  }

  // Room count is the main signal. Current connections are a secondary signal.
  // The +1 prevents an empty low-capacity server from always tying a stronger one.
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

export function createRoutedSocket(options = {}) {
  const listeners = new Map();
  let currentServer = GAME_SERVERS[LEGACY_SERVER_ID];
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
