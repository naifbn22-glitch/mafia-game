import { io } from "socket.io-client";
import { showSuccessToast, showErrorToast, showInfoToast } from "../ui/toast.js";
import { getRoleCardImage } from "../ui/roleCards.js";

const STORAGE_KEY = "mafia_online_rooms_v2";
const PLAYER_SESSION_KEY = "mafia_online_player_session_v2";
const HOST_SESSION_KEY = "mafia_online_host_session_v2";
const ONLINE_RESUME_KEY = "mafia_online_resume_v1";
const CHANNEL_NAME = "mafia-online-sync";
const channel = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL_NAME) : null;
const ONLINE_SERVER_URL = String(import.meta.env.VITE_SERVER_URL || window.location.origin).replace(/\/$/, "");
const socket = io(ONLINE_SERVER_URL, {
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 400,
  reconnectionDelayMax: 2500,
  timeout: 10000,
});
let hostRoleRevealIntervalId = null;
// حالة محلية خاصة بعرض بطاقة الدور فقط. لا تدخل في منطق الغرف أو مزامنة اللاعبين.
const roleRevealUiState = new Map();
const pendingRoleKnownSaves = new Map();
// اختيار التصويت المبدئي يبقى محليًا لكل لاعب حتى لا يختفي عند إعادة رسم الواجهة اللحظية.
const voteSelectionUiState = new Map();
const roomViewSyncControllers = new Map();
const activeSubscriptions = new Map();
const desiredSubscriptions = new Map();
let onlineDayTimerIntervalId = null;
const liveNightOverlayShown = new Map();
let liveDayTimerOverlayIntervalId = null;
let liveDayTimerOverlayKey = null;
const liveNightPardonOverlayShown = new Map();
const liveVotingPardonOverlayShown = new Map();
const liveVotingResultOverlayShown = new Map();
const liveFinalSequenceShown = new Map();


function dispatchRoomsUpdated() {
  channel?.postMessage({ type: "rooms-updated" });
  window.dispatchEvent(new CustomEvent("mafia-rooms-updated", { detail: { room: null } }));
}

function cacheServerRoom(room) {
  if (!room?.code) return false;
  const rooms = loadRooms();
  const code = normalizeRoomCode(room.code);
  const current = rooms[code];
  if (current && Number(current.version || 0) > Number(room.version || 0)) return false;

  // لا نعيد رسم الواجهة إذا كانت نسخة الغرفة مطابقة تمامًا.
  // هذا يجعل التحديث الدوري احتياطيًا وغير ملحوظ بصريًا.
  if (current && JSON.stringify(current) === JSON.stringify(room)) return false;

  rooms[code] = room;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
  channel?.postMessage({ type: "rooms-updated", code });
  window.dispatchEvent(new CustomEvent("mafia-rooms-updated", { detail: { room } }));
  return true;
}

function emitAck(eventName, payload) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("SERVER_TIMEOUT")), 12000);
    socket.emit(eventName, payload, response => {
      window.clearTimeout(timer);
      if (!response?.ok) reject(new Error(response?.error || "SERVER_ERROR"));
      else resolve(response);
    });
  });
}

function hostSession(code) {
  try {
    const data = JSON.parse(localStorage.getItem(HOST_SESSION_KEY) || "{}");
    return data?.code === normalizeRoomCode(code) ? data : null;
  } catch { return null; }
}

function loadPlayerSessions() {
  try {
    const raw = JSON.parse(localStorage.getItem(PLAYER_SESSION_KEY) || "{}");

    if (raw?.code && raw?.playerId && raw?.token) {
      const legacyCode = normalizeRoomCode(raw.code);
      return {
        [`${legacyCode}:${raw.playerId}`]: {
          code: legacyCode,
          playerId: raw.playerId,
          token: raw.token,
          savedAt: Date.now(),
        },
      };
    }

    if (raw?.sessions && typeof raw.sessions === "object") {
      return raw.sessions;
    }

    return {};
  } catch {
    return {};
  }
}

function savePlayerSession(code, playerId, token) {
  const normalizedCode = normalizeRoomCode(code);
  const sessions = loadPlayerSessions();
  sessions[`${normalizedCode}:${playerId}`] = {
    code: normalizedCode,
    playerId,
    token,
    savedAt: Date.now(),
  };

  localStorage.setItem(
    PLAYER_SESSION_KEY,
    JSON.stringify({ version: 2, sessions }),
  );
}

function playerSession(code, playerId) {
  const normalizedCode = normalizeRoomCode(code);
  const sessions = loadPlayerSessions();

  if (playerId) {
    return sessions[`${normalizedCode}:${playerId}`] || null;
  }

  return (
    Object.values(sessions)
      .filter(session => session?.code === normalizedCode)
      .sort((a, b) => Number(b?.savedAt || 0) - Number(a?.savedAt || 0))[0] ||
    null
  );
}


function saveOnlineResumeMarker(marker) {
  if (!marker?.code || !marker?.mode) return;
  localStorage.setItem(
    ONLINE_RESUME_KEY,
    JSON.stringify({
      ...marker,
      code: normalizeRoomCode(marker.code),
      savedAt: Date.now(),
    }),
  );
}

function readOnlineResumeMarker() {
  try {
    const saved = JSON.parse(localStorage.getItem(ONLINE_RESUME_KEY) || "null");
    if (saved?.code && (saved.mode === "host" || saved.mode === "player")) {
      return saved;
    }
  } catch {}

  const host = (() => {
    try { return JSON.parse(localStorage.getItem(HOST_SESSION_KEY) || "null"); }
    catch { return null; }
  })();
  if (host?.code && host?.token) {
    return { mode: "host", code: normalizeRoomCode(host.code), savedAt: Number(host.savedAt || 0) };
  }

  const latestPlayer = Object.values(loadPlayerSessions())
    .filter(session => session?.code && session?.playerId && session?.token)
    .sort((a, b) => Number(b?.savedAt || 0) - Number(a?.savedAt || 0))[0];
  if (latestPlayer) {
    return {
      mode: "player",
      code: normalizeRoomCode(latestPlayer.code),
      playerId: latestPlayer.playerId,
      savedAt: Number(latestPlayer.savedAt || 0),
    };
  }
  return null;
}

export function getSavedOnlineGame() {
  return readOnlineResumeMarker();
}

export function deleteSavedOnlineGame() {
  const marker = readOnlineResumeMarker();
  localStorage.removeItem(ONLINE_RESUME_KEY);

  if (marker?.mode === "host") {
    const session = hostSession(marker.code);
    if (session?.code === normalizeRoomCode(marker.code)) {
      localStorage.removeItem(HOST_SESSION_KEY);
    }
  }

  if (marker?.mode === "player" && marker.playerId) {
    const sessions = loadPlayerSessions();
    delete sessions[`${normalizeRoomCode(marker.code)}:${marker.playerId}`];
    localStorage.setItem(
      PLAYER_SESSION_KEY,
      JSON.stringify({ version: 2, sessions }),
    );
  }
}

export async function resumeSavedOnlineGame({ app, onBack }) {
  const marker = readOnlineResumeMarker();
  if (!marker) return false;

  const mode = marker.mode === "host" ? "host" : "player";
  const room = await fetchRoomFromServer(marker.code, mode, marker.playerId || null);
  if (!room || room.winner) {
    deleteSavedOnlineGame();
    return false;
  }

  if (marker.mode === "host") {
    history.replaceState({}, "", `?host=${room.code}`);
    saveOnlineResumeMarker({ mode: "host", code: room.code });
    renderHostLobby({ app, onBack, code: room.code });
    return true;
  }

  const player = room.players?.find(item => item.id === marker.playerId);
  if (!player) {
    deleteSavedOnlineGame();
    return false;
  }

  history.replaceState({}, "", `?room=${room.code}&player=${marker.playerId}`);
  saveOnlineResumeMarker({ mode: "player", code: room.code, playerId: marker.playerId });
  renderPlayerRoom({ app, onBack, code: room.code, playerId: marker.playerId });
  return true;
}

async function fetchRoomFromServer(code, mode = "public", playerId = null) {
  const normalizedCode = normalizeRoomCode(code);
  if (!normalizedCode) return null;

  const token =
    mode === "host"
      ? hostSession(normalizedCode)?.token
      : mode === "player"
        ? playerSession(normalizedCode, playerId)?.token
        : undefined;

  // عروض المدير واللاعب يجب أن تستلم الإسقاط المصرح به فقط.
  // السقوط إلى الإسقاط العام عند تعثر لحظي كان يسمح أحيانًا للواجهة
  // بالبقاء على نسخة ناقصة حتى تحديث الصفحة يدويًا.
  const attempts = mode === "public" ? 1 : 3;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await emitAck("room:sync", {
        code: normalizedCode,
        mode,
        playerId,
        token,
      });
      cacheServerRoom(response.room);
      return response.room;
    } catch {
      if (attempt < attempts - 1) {
        await new Promise(resolve => window.setTimeout(resolve, 120 + attempt * 180));
      }
    }
  }

  // الإسقاط العام مناسب فقط لصفحة البث أو فحص وجود الغرفة.
  if (mode !== "public") return null;
  try {
    const response = await emitAck("room:lookup", { code: normalizedCode });
    cacheServerRoom(response.room);
    return response.room;
  } catch {
    return null;
  }
}

async function createRoomOnServer(hostName, roomName, maxPlayers, discussionDurationSeconds) {
  const response = await emitAck("room:create", { hostName, roomName, maxPlayers, discussionDurationSeconds });
  localStorage.setItem(HOST_SESSION_KEY, JSON.stringify({ code: response.room.code, token: response.hostToken, savedAt: Date.now() }));
  cacheServerRoom(response.room);
  return response.room;
}

async function joinPlayerOnServer(code, player) {
  const response = await emitAck("player:join", { code, ...player });
  savePlayerSession(code, response.player.id, response.player.sessionToken);
  cacheServerRoom(response.room);
  return response;
}

async function hostCommand(code, action, payload = {}) {
  const session = hostSession(code);
  if (!session?.token) throw new Error("HOST_SESSION_MISSING");
  const response = await emitAck("host:command", { code, token: session.token, action, payload });
  cacheServerRoom(response.room);
  return response.room;
}

async function playerCommand(code, playerId, action, payload = {}) {
  const session = playerSession(code, playerId);
  if (!session?.token) throw new Error("PLAYER_SESSION_MISSING");
  const response = await emitAck("player:command", { code, playerId, token: session.token, action, payload });
  cacheServerRoom(response.room);
  return response.room;
}

async function startVotingReliably(code) {
  const normalized = normalizeRoomCode(code);
  const session = hostSession(normalized);
  if (!session?.token) throw new Error("HOST_SESSION_MISSING");

  let lastError = null;

  // المحاولة الأولى عبر Socket.IO، وهي المسار الأساسي الحالي.
  try {
    await hostCommand(normalized, "start-voting");
  } catch (error) {
    lastError = error;
  }

  const verifyVoting = async (attempts = 5) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const room = await fetchRoomFromServer(normalized, "host");
      if (room?.phase === "voting") return room;
      await new Promise(resolve => window.setTimeout(resolve, 180 + attempt * 160));
    }
    return null;
  };

  let confirmed = await verifyVoting(3);
  if (confirmed) return confirmed;

  // إذا ضاع أمر WebSocket أو ACK، نرسل نفس الأمر إلى مسار HTTP مخصص.
  // startVoting في الخادم idempotent، لذلك هذا آمن حتى إذا نجحت المحاولة الأولى متأخرة.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${ONLINE_SERVER_URL}/api/rooms/${encodeURIComponent(normalized)}/start-voting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: session.token }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "START_VOTING_FAILED");
      if (data?.room) cacheServerRoom(data.room);
      confirmed = await verifyVoting(5);
      if (confirmed) return confirmed;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => window.setTimeout(resolve, 250 + attempt * 250));
  }

  throw lastError || new Error("START_VOTING_FAILED");
}

// تنفيذ مخصص وآمن لعملية "تمت مشاهدة الدور" فقط.
// يعيد المحاولة عند انقطاع لحظي في Socket.IO بدون تغيير نظام الغرف أو الانضمام.
async function markRoleKnownReliably(code, playerId) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (!socket.connected) {
        socket.connect();
        await new Promise(resolve => window.setTimeout(resolve, 350 + attempt * 250));
      }
      return await playerCommand(code, playerId, "role-known");
    } catch (error) {
      lastError = error;
      // في حال نجح الأمر على الخادم وفقدنا ACK، نجلب حالة اللاعب قبل إعادة المحاولة.
      const synced = await fetchRoomFromServer(code, "player", playerId);
      const syncedPlayer = synced?.players?.find(item => item.id === playerId);
      if (syncedPlayer?.roleKnown) return synced;
      await new Promise(resolve => window.setTimeout(resolve, 300 + attempt * 300));
    }
  }
  throw lastError || new Error("ROLE_KNOWN_FAILED");
}

function queueRoleKnownSave(code, playerId) {
  const key = `${normalizeRoomCode(code)}:${playerId}`;
  if (pendingRoleKnownSaves.has(key)) return pendingRoleKnownSaves.get(key);

  const task = (async () => {
    let lastError = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        const room = await markRoleKnownReliably(code, playerId);
        pendingRoleKnownSaves.delete(key);
        return room;
      } catch (error) {
        lastError = error;
        if (error?.message === "PLAYER_SESSION_MISSING") {
          pendingRoleKnownSaves.delete(key);
          throw error;
        }
        await new Promise(resolve =>
          window.setTimeout(resolve, Math.min(4500, 700 + attempt * 350)),
        );
      }
    }
    pendingRoleKnownSaves.delete(key);
    throw lastError || new Error("ROLE_KNOWN_FAILED");
  })();

  pendingRoleKnownSaves.set(key, task);
  return task;
}

async function subscribeRoom(code, mode = "public", playerId = null) {
  const normalized = normalizeRoomCode(code);
  const key = `${normalized}:${mode}:${playerId || ""}`;
  desiredSubscriptions.set(key, { code: normalized, mode, playerId });
  if (activeSubscriptions.has(key) && socket.connected) return;
  const token = mode === "host" ? hostSession(normalized)?.token : mode === "player" ? playerSession(normalized, playerId)?.token : undefined;
  try {
    const response = await emitAck("room:subscribe", { code: normalized, mode, playerId, token });
    activeSubscriptions.set(key, true);
    cacheServerRoom(response.room);
  } catch (error) {
    console.warn("Room subscription failed", error.message);
  }
}

socket.on("room:snapshot", cacheServerRoom);
socket.on("connect", () => {
  activeSubscriptions.clear();
  window.dispatchEvent(new CustomEvent("mafia-server-connected"));
  window.setTimeout(() => {
    for (const subscription of desiredSubscriptions.values()) {
      subscribeRoom(subscription.code, subscription.mode, subscription.playerId);
    }
  }, 50);
});
socket.on("disconnect", () => window.dispatchEvent(new CustomEvent("mafia-server-disconnected")));

// مزامنة فورية مخصصة لتغيّر المرحلة. هذا الحدث لا يحمل بيانات سرية،
// ويطلب من كل عرض داخل الغرفة جلب إسقاطه الصحيح فورًا.

// إشعار صريح لبدء التصويت. عند وصوله نطلب فورًا الإسقاط الخاص بكل عرض
// داخل الغرفة. هذا مستقل عن مؤقت المزامنة الخلفي ويبقيه كما هو كطبقة احتياطية.
socket.on("room:day-started", payload => {
  const code = normalizeRoomCode(payload?.code);
  if (!code) return;

  const matches = [...desiredSubscriptions.values()]
    .filter(subscription => normalizeRoomCode(subscription.code) === code);

  for (const subscription of matches) {
    [0, 100, 260, 600].forEach(delay => {
      window.setTimeout(async () => {
        const room = await fetchRoomFromServer(code, subscription.mode, subscription.playerId);
        if (room?.phase === "day") {
          window.dispatchEvent(new CustomEvent("mafia-day-started", {
            detail: { room, mode: subscription.mode, playerId: subscription.playerId },
          }));
        }
      }, delay);
    });
  }
});

socket.on("room:voting-started", payload => {
  const code = normalizeRoomCode(payload?.code);
  if (!code) return;

  const matches = [...desiredSubscriptions.values()]
    .filter(subscription => normalizeRoomCode(subscription.code) === code);

  for (const subscription of matches) {
    [0, 80, 180, 360, 700, 1200, 2000, 3200].forEach(delay => {
      window.setTimeout(async () => {
        const room = await fetchRoomFromServer(code, subscription.mode, subscription.playerId);
        if (room?.phase === "voting") {
          window.dispatchEvent(new CustomEvent("mafia-voting-started", {
            detail: { room, mode: subscription.mode, playerId: subscription.playerId },
          }));
        }
      }, delay);
    });
  }
});

socket.on("room:phase-changed", payload => {
  const code = normalizeRoomCode(payload?.code);
  if (!code) return;

  const matches = [...desiredSubscriptions.values()]
    .filter(subscription => normalizeRoomCode(subscription.code) === code);

  for (const subscription of matches) {
    // محاولات قصيرة ومتدرجة تضمن أن كل جهاز يحصل على المرحلة الجديدة حتى إذا
    // وصل إشعار المرحلة قبل اكتمال مزامنة Redis/الخادم بجزء من الثانية.
    [0, 100, 260, 600, 1200, 2200].forEach(delay => {
      window.setTimeout(async () => {
        try {
          const room = await fetchRoomFromServer(code, subscription.mode, subscription.playerId);
          if (!room) return;
          if (room.phase === "day") {
            window.dispatchEvent(new CustomEvent("mafia-day-started", {
              detail: { room, mode: subscription.mode, playerId: subscription.playerId },
            }));
          } else if (room.phase === "voting") {
            window.dispatchEvent(new CustomEvent("mafia-voting-started", {
              detail: { room, mode: subscription.mode, playerId: subscription.playerId },
            }));
          }
        } catch {
          // المزامنة الدورية الحالية ستعيد المحاولة تلقائيًا.
        }
      }, delay);
    });
  }
});

function stopRoomViewSync(syncKey = null) {
  if (!syncKey) stopOnlineDayTimerTicker();
  if (syncKey) {
    const controller = roomViewSyncControllers.get(syncKey);
    controller?.stop?.();
    roomViewSyncControllers.delete(syncKey);
    return;
  }

  for (const controller of roomViewSyncControllers.values()) {
    controller?.stop?.();
  }
  roomViewSyncControllers.clear();
}

function startRoomViewSync({ code, mode = "public", playerId = null, draw, intervalMs = 500 }) {
  const normalizedCode = normalizeRoomCode(code);
  const syncKey = `${normalizedCode}:${mode}:${playerId || ""}`;

  // لا نوقف مزامنة غرفة أخرى. نعيد تشغيل المزامنة لنفس العرض فقط.
  stopRoomViewSync(syncKey);

  let disposed = false;
  let requestInFlight = false;
  let timerId = null;
  let lastDrawSignature = "";

  // لا نعتمد على version وحده. قائمة اللاعبين جزء من البصمة نفسها،
  // لذلك أي لاعب جديد يظهر فور وصول snapshot أو نتيجة المزامنة الدورية.
  const roomSignature = room => {
    if (!room) return "";
    const players = Array.isArray(room.players)
      ? room.players.map(player => [
          player.id,
          player.name,
          player.avatar || "",
          player.online !== false ? 1 : 0,
          player.alive !== false ? 1 : 0,
          player.roleKnown ? 1 : 0,
          // في عرض اللاعب يكون دوره موجودًا في الإسقاط الخاص به. إضافته للبصمة
          // تضمن تحديث شاشة اللاعب فور انتقال المدير بين الأدوار الليلية.
          mode === "player" && player.id === playerId ? (player.role || "") : "",
          mode === "player" && player.id === playerId ? Number(player.royalPardonsRemaining || 0) : "",
        ].join(":" )).join("|")
      : "";

    // واجهة اللاعب تعتمد على هذه الحقول لإظهار أسماء الأهداف، حالة التأكيد،
    // نتائج التحقيق، التصويت والانتقال بين المراحل. إدخالها في البصمة يجعل
    // التحديث اللحظي في الخلفية يغيّر الواجهة عند الحاجة فقط، بدون إعادة رسم
    // مستمرة أو وميض للقوائم.
    const playerState = mode === "player"
      ? JSON.stringify({
          nightActions: room.nightActions || null,
          investigationResult: room.investigationResult || null,
          myVote: room.myVote || null,
          daySummary: room.daySummary || null,
          votingResult: room.votingResult || null,
          winner: room.winner || null,
          completedSteps: room.completedSteps || null,
          dayEndsAt: room.dayEndsAt || null,
        })
      : "";

    return [
      room.code,
      room.version || 0,
      room.updatedAt || 0,
      room.status || "",
      room.phase || "",
      Number(room.matchSequence || 0),
      room.activeRole || "",
      players,
      playerState,
    ].join("::");
  };

  const playerStageNeedsRepair = room => {
    if (mode !== "player" || !playerId || !room) return false;
    const me = room.players?.find(player => player.id === playerId);
    if (!me) return false;

    if (room.phase === "night-role") {
      const shouldShowNightAction = Boolean(me.role && room.activeRole === me.role);
      const showingNightAction = Boolean(document.querySelector(".active-role-screen"));
      return shouldShowNightAction !== showingNightAction;
    }

    if (room.phase === "day") {
      return !document.querySelector(".online-day-player-screen");
    }

    if (room.phase === "voting") {
      if (!me.alive) {
        return !document.querySelector(".eyes-closed-screen");
      }
      if (room.myVote) {
        return !document.querySelector(".online-vote-confirmed-screen");
      }
      return !document.querySelector(".online-voting-player-screen");
    }

    if (room.phase === "voting-result") {
      return !document.querySelector(".online-voting-result");
    }

    return false;
  };

const redrawIfNeeded = (room = null, force = false) => {
  if (disposed) return;

  const currentRoom =
    room || readRoom(normalizedCode);

  if (!currentRoom) return;

  // مهم جدًا:
  // نحفظ أحدث نسخة وصلت من الخادم قبل إعادة رسم الصفحة.
  // بذلك draw() تقرأ نفس المرحلة الجديدة بدل نسخة قديمة.
  if (room) {
    cacheServerRoom(currentRoom);
  }

  const signature =
    roomSignature(currentRoom);

  const repairPlayerStage =
    playerStageNeedsRepair(currentRoom);

  if (
    !force &&
    !repairPlayerStage &&
    signature === lastDrawSignature
  ) {
    return;
  }

  lastDrawSignature = signature;

  draw();
};

  const onRoomsUpdated = event => {
    const eventRoom = event?.detail?.room;
    if (eventRoom?.code && normalizeRoomCode(eventRoom.code) !== normalizedCode) return;
    redrawIfNeeded(eventRoom || null);
  };

  const onDayStarted = event => {
    const detail = event?.detail || {};
    const eventRoom = detail.room;
    if (!eventRoom || normalizeRoomCode(eventRoom.code) !== normalizedCode) return;
    if (mode === "player" && detail.playerId && detail.playerId !== playerId) return;
    redrawIfNeeded(eventRoom, true);
  };

  const onVotingStarted = event => {
    const detail = event?.detail || {};
    const eventRoom = detail.room;
    if (!eventRoom || normalizeRoomCode(eventRoom.code) !== normalizedCode) return;
    if (mode === "player" && detail.playerId && detail.playerId !== playerId) return;
    redrawIfNeeded(eventRoom, true);
  };

  const onConnected = async () => {
    if (disposed) return;
    await subscribeRoom(normalizedCode, mode, playerId);
    const room = await fetchRoomFromServer(normalizedCode, mode, playerId);
    redrawIfNeeded(room);
  };

  const poll = async () => {
    if (disposed) return;

    if (!requestInFlight) {
      requestInFlight = true;
      try {
        const room = await fetchRoomFromServer(normalizedCode, mode, playerId);
        if (room) {
          // إعادة الرسم لا تتم إلا عند تغير بيانات الغرفة أو عندما تكون شاشة اللاعب
          // لا تطابق المرحلة الفعلية على الخادم. هذا يشمل الانتقال للتصويت فورًا.
          redrawIfNeeded(room);
        }
      } finally {
        requestInFlight = false;
      }
    }

    if (!disposed) {
      timerId = window.setTimeout(poll, Math.max(350, intervalMs));
    }
  };

  window.addEventListener("mafia-rooms-updated", onRoomsUpdated);
  window.addEventListener("mafia-server-connected", onConnected);
  window.addEventListener("mafia-day-started", onDayStarted);
  window.addEventListener("mafia-voting-started", onVotingStarted);

  // ابدأ الاشتراك والجلب فورًا، ثم استمر بتحديث خلفي ثابت حتى لو ضاع حدث WebSocket.
  subscribeRoom(normalizedCode, mode, playerId);
  timerId = window.setTimeout(poll, 120);

  const stop = () => {
    disposed = true;
    if (timerId) window.clearTimeout(timerId);
    window.removeEventListener("mafia-rooms-updated", onRoomsUpdated);
    window.removeEventListener("mafia-server-connected", onConnected);
    window.removeEventListener("mafia-day-started", onDayStarted);
    window.removeEventListener("mafia-voting-started", onVotingStarted);
  };

  roomViewSyncControllers.set(syncKey, { stop });
}

const AVATARS = Array.from({ length: 12 }, (_, index) => ({
  id: `avatar-${String(index + 1).padStart(2, "0")}`,
  src: `/avatars/avatar-${String(index + 1).padStart(2, "0")}.png`,
}));

function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    { length: 6 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join("");
}

function normalizeRoomCode(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function extractRoomCode(value) {
  const rawValue = String(value ?? "").trim();

  if (!rawValue) {
    return "";
  }

  try {
    const parsedUrl = new URL(rawValue, window.location.origin);
    const queryCode =
      parsedUrl.searchParams.get("room") ||
      parsedUrl.searchParams.get("host") ||
      parsedUrl.searchParams.get("live");

    if (queryCode) {
      return normalizeRoomCode(queryCode);
    }

    const pathParts = parsedUrl.pathname
      .split("/")
      .filter(Boolean);

    const roomIndex = pathParts.findIndex(
      (part) => part.toLowerCase() === "room",
    );

    if (roomIndex >= 0 && pathParts[roomIndex + 1]) {
      return normalizeRoomCode(pathParts[roomIndex + 1]);
    }
  } catch {
    // القيمة ليست رابطًا، وسنعاملها كرمز غرفة مباشر.
  }

  return normalizeRoomCode(rawValue);
}

function loadRooms() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function saveRooms(rooms) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
  dispatchRoomsUpdated();
}

function readRoom(code) {
  const normalizedCode = normalizeRoomCode(code);
  const rooms = loadRooms();

  return (
    rooms[normalizedCode] ||
    Object.values(rooms).find(
      (room) => normalizeRoomCode(room?.code) === normalizedCode,
    ) ||
    null
  );
}

function updateRoom(code, updater) {
  const normalizedCode = normalizeRoomCode(code);
  const rooms = loadRooms();
  const storedKey =
    Object.keys(rooms).find(
      (key) => normalizeRoomCode(key) === normalizedCode,
    ) || normalizedCode;
  const room = rooms[storedKey];
  if (!room) return null;
  const next = updater(structuredClone(room));
  rooms[storedKey] = next;
  saveRooms(rooms);
  return next;
}

function createRoomRecord(hostName, roomName, maxPlayers) {
  const rooms = loadRooms();
  let code = roomCode();
  while (rooms[code]) code = roomCode();
  rooms[code] = {
    code,
    roomName,
    hostName,
    maxPlayers,
    status: "waiting",
    phase: "lobby",
    activeRole: null,
    createdAt: Date.now(),
    players: [],
    nightNumber: 0,
    nightActions: { thiefVotes: {}, nurseTargetId: null, kingTargetId: null, kingSkipped: false, kingPardonFinalized: false, investigatorTargetId: null, confirmedActors: {} },
    lastTargets: { thief: null, nurse: null },
  };
  saveRooms(rooms);
  return rooms[code];
}

function inviteUrl(code) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("room", code);
  url.searchParams.set("join", "1");
  return url.toString();
}

function liveViewUrl(code) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("live", normalizeRoomCode(code));
  return url.toString();
}

async function copyTextToClipboard(text, sourceInput = null) {
  const value = String(text ?? "");

  if (!value) {
    return false;
  }

  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // ننتقل إلى الطريقة الاحتياطية أدناه.
  }

  const temporaryInput = sourceInput || document.createElement("textarea");
  const shouldRemove = !sourceInput;

  if (shouldRemove) {
    temporaryInput.value = value;
    temporaryInput.setAttribute("readonly", "");
    temporaryInput.style.position = "fixed";
    temporaryInput.style.opacity = "0";
    temporaryInput.style.pointerEvents = "none";
    document.body.appendChild(temporaryInput);
  }

  temporaryInput.focus();
  temporaryInput.select();
  temporaryInput.setSelectionRange?.(0, temporaryInput.value.length);

  let copied = false;

  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }

  if (shouldRemove) {
    temporaryInput.remove();
  }

  return copied;
}

async function copyInviteLink(url) {
  const sourceInput = document.querySelector("#inviteLinkInput");
  const copied = await copyTextToClipboard(url, sourceInput);

  if (copied) {
    showSuccessToast("تم نسخ رابط الدعوة.", "تم النسخ");
    return;
  }

  showErrorToast(
    "تعذر النسخ التلقائي. حدّد الرابط وانسخه يدويًا.",
    "تعذر النسخ",
  );
}

function pageShell(content, title = "اللعب عبر الشبكة") {
  return `
    <main class="online-page">
      <div class="online-atmosphere" aria-hidden="true"></div>
      <header class="online-header">
        <button class="online-back-button" id="onlineBackButton" type="button">←</button>
        <div>
          <span class="online-kicker">MAFIA ONLINE</span>
          <h1>${title}</h1>
        </div>
        <img src="/logo.png" alt="شعار مافيا" class="online-logo" />
      </header>
      <section class="online-content">${content}</section>
    </main>`;
}

function attachBack(onBack) {
  document.querySelector("#onlineBackButton")?.addEventListener("click", () => {
    // أوقف مزامنة الصفحة الحالية قبل الرجوع. وإلا قد تعيد المزامنة رسم الصفحة
    // التي غادرها المستخدم فتبدو وكأن زر الرجوع لم يعمل.
    stopRoomViewSync();
    onBack?.();
  });
}

export function openOnlinePortal({ app, onBack }) {
  stopRoomViewSync();
  const params = new URLSearchParams(location.search);
  const linkedRoom = params.get("room");
  if (linkedRoom && params.get("join") === "1") {
    renderJoinRoom({ app, onBack, code: linkedRoom });
    return;
  }

  app.innerHTML = pageShell(`
    <div class="online-portal-grid">
      <article class="online-action-card host-card">
        <div class="online-action-icon">👑</div>
        <h2>إنشاء غرفة خاصة</h2>
        <p>أنشئ المباراة، شارك رابط الدعوة، وتحكم بجميع مراحل اللعب من جهاز المدير.</p>
        <button id="createRoomChoice" class="online-primary-button" type="button">إنشاء غرفة</button>
      </article>
      <article class="online-action-card player-card">
        <div class="online-action-icon">🎭</div>
        <h2>الانضمام إلى غرفة</h2>
        <p>افتح رابط الدعوة الذي أرسله مدير اللعبة، ثم أضف اسمك وجنسك وصورتك.</p>
        <button id="joinRoomChoice" class="online-secondary-button" type="button">إدخال رابط أو رمز</button>
      </article>
    </div>
  `);
  attachBack(onBack);
  document.querySelector("#createRoomChoice")?.addEventListener("click", () => renderCreateRoom({ app, onBack }));
  document.querySelector("#joinRoomChoice")?.addEventListener("click", () => renderJoinCode({ app, onBack }));
}

function renderCreateRoom({ app, onBack }) {
  app.innerHTML = pageShell(`
    <div class="online-form-card">
      <div class="online-form-heading"><span>👑</span><div><h2>إنشاء غرفة المدير</h2><p>أدخل البيانات الأساسية، ويمكنك تعديل إعدادات الأدوار قبل بدء المباراة.</p></div></div>
      <form id="createRoomForm" class="online-form">
        <label>اسم مدير اللعبة<input id="hostNameInput" required maxlength="24" placeholder="مثال: نايف" /></label>
        <label>اسم الغرفة<input id="roomNameInput" required maxlength="32" placeholder="مثال: سهرة الجمعة" /></label>
        <label>الحد الأعلى للاعبين<select id="maxPlayersInput">${[6,7,8,9,10,12,14,16,18,20].map(n => `<option value="${n}" ${n===10?"selected":""}>${n} لاعبين</option>`).join("")}</select></label>
        <label>مدة مرحلة النهار والنقاش<select id="discussionDurationInput">${[{v:30,l:"30 ثانية"},{v:60,l:"دقيقة واحدة"},{v:90,l:"دقيقة و30 ثانية"},{v:120,l:"دقيقتان"},{v:180,l:"3 دقائق"},{v:240,l:"4 دقائق"},{v:300,l:"5 دقائق"}].map(item => `<option value="${item.v}" ${item.v===60?"selected":""}>${item.l}</option>`).join("")}</select><small class="online-field-hint">يظهر المؤقت لجميع اللاعبين وفي شاشة البث المباشر بعد انتهاء الليل.</small></label>
        <button class="online-primary-button" type="submit">إنشاء الغرفة الخاصة</button>
      </form>
    </div>
  `, "إنشاء غرفة");
  attachBack(() => openOnlinePortal({ app, onBack }));
  document.querySelector("#createRoomForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const hostName = document.querySelector("#hostNameInput").value.trim();
    const roomName = document.querySelector("#roomNameInput").value.trim();
    const maxPlayers = Number(document.querySelector("#maxPlayersInput").value);
    const discussionDurationSeconds = Number(document.querySelector("#discussionDurationInput")?.value || 60);
    if (!hostName || !roomName) return showErrorToast("أكمل اسم المدير واسم الغرفة.", "بيانات ناقصة");
    try {
      const room = await createRoomOnServer(hostName, roomName, maxPlayers, discussionDurationSeconds);
      history.replaceState({}, "", `?host=${room.code}`);
      showSuccessToast("تم إنشاء الغرفة بنجاح.", "الغرفة جاهزة");
      renderHostLobby({ app, onBack, code: room.code });
    } catch (error) {
      showErrorToast("تعذر إنشاء الغرفة. تحقق من اتصال الخادم.", "خطأ في الخادم");
    }
  });
}

function renderJoinCode({ app, onBack }) {
  app.innerHTML = pageShell(`
    <div class="online-form-card compact-form-card">
      <div class="online-form-heading"><span>🚪</span><div><h2>الانضمام إلى غرفة</h2><p>ألصق رابط الدعوة أو اكتب رمز الغرفة.</p></div></div>
      <form id="joinCodeForm" class="online-form">
        <label>رابط أو رمز الغرفة<input id="roomCodeInput" required placeholder="مثال: AB7K9P" /></label>
        <button class="online-primary-button" type="submit">متابعة</button>
      </form>
    </div>
  `, "الانضمام");
  attachBack(() => openOnlinePortal({ app, onBack }));
  document.querySelector("#joinCodeForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const value = document
      .querySelector("#roomCodeInput")
      .value;
    const code = extractRoomCode(value);

    if (!code) {
      return showErrorToast(
        "اكتب رمز الغرفة أو ألصق رابط الدعوة.",
        "الرمز مطلوب",
      );
    }

    // عند الانضمام من جهاز جديد، الخادم هو المصدر الحقيقي للغرفة.
    // لا نعتمد على sessionStorage هنا، لأن وجود نسخة محلية قد يخفي مشكلة
    // التخزين على الخادم ويجعل الغرفة تبدو موجودة على جهاز المدير فقط.
    const room = await fetchRoomFromServer(code);

    if (!room) {
      return showErrorToast(
        "لم يتم العثور على الغرفة. تأكد من الرمز ومن أن الغرفة ما زالت مفتوحة.",
        "الغرفة غير موجودة",
      );
    }

    history.replaceState({}, "", `?room=${room.code}&join=1`);
    renderJoinRoom({ app, onBack, code: room.code });
  });
}

function avatarPicker() {
  return `<div class="online-avatar-grid">${AVATARS.map((a,i) => `<button class="online-avatar-option ${i===0?"selected":""}" type="button" data-avatar="${a.src}"><img src="${a.src}" alt="صورة شخصية ${i+1}" /></button>`).join("")}</div>`;
}

function renderJoinRoom({ app, onBack, code }) {
  subscribeRoom(code, "public");
  const room = readRoom(code);
  if (!room) {
    app.innerHTML = pageShell(`<div class="online-empty"><div>⏳</div><h2>جارٍ البحث عن الغرفة</h2><p>يتم الاتصال بالخادم الآن.</p></div>`);
    attachBack(onBack);
    fetchRoomFromServer(code).then(foundRoom => {
      if (foundRoom) {
        renderJoinRoom({ app, onBack, code: foundRoom.code });
        return;
      }
      app.innerHTML = pageShell(`<div class="online-empty"><div>⚠️</div><h2>الغرفة غير موجودة</h2><p>قد يكون الرابط منتهيًا أو تم إغلاق الغرفة.</p><button id="returnPortal" class="online-primary-button">العودة</button></div>`);
      attachBack(onBack);
      document.querySelector("#returnPortal")?.addEventListener("click", () => openOnlinePortal({ app, onBack }));
    });
    return;
  }
  if (room.status !== "waiting" || room.joinLocked) {
    const message = room.joinLockedReason === "full"
      ? "اكتمل الحد الأعلى للاعبين وتم إغلاق الغرفة أمام انضمامات جديدة."
      : "المباراة بدأت بالفعل ولا يمكن إضافة لاعب جديد.";
    showInfoToast(message, "الغرفة مغلقة");
  }
  app.innerHTML = pageShell(`
    <div class="join-room-layout">
      <div class="room-preview-card"><span class="live-dot"></span><small>دعوة خاصة</small><h2>${room.roomName}</h2><p>مدير اللعبة: <strong>${room.hostName}</strong></p><div class="room-code-badge">${room.code}</div><span>${room.players.length} / ${room.maxPlayers} لاعبين</span></div>
      <form id="playerJoinForm" class="online-form-card online-form">
        <h2>بيانات المتسابق</h2>
        <label>اسم اللاعب<input id="playerNameInput" maxlength="24" required placeholder="اكتب اسمك" /></label>
        <fieldset><legend>الجنس</legend><div class="gender-options"><label><input type="radio" name="gender" value="male" checked /><span>👨 ذكر</span></label><label><input type="radio" name="gender" value="female" /><span>👩 أنثى</span></label></div></fieldset>
        <div><span class="field-label">الصورة الشخصية</span>${avatarPicker()}</div>
        <input id="selectedAvatar" type="hidden" value="${AVATARS[0].src}" />
        <button class="online-primary-button" type="submit" ${room.status !== "waiting" || room.joinLocked ? "disabled" : ""}>${room.joinLockedReason === "full" ? "اكتمل عدد اللاعبين" : room.status !== "waiting" || room.joinLocked ? "الغرفة مغلقة" : "الانضمام إلى الغرفة"}</button>
      </form>
    </div>
  `, "تسجيل المتسابق");
  attachBack(() => openOnlinePortal({ app, onBack }));
  document.querySelectorAll(".online-avatar-option").forEach(button => button.addEventListener("click", () => {
    document.querySelectorAll(".online-avatar-option").forEach(x => x.classList.remove("selected"));
    button.classList.add("selected");
    document.querySelector("#selectedAvatar").value = button.dataset.avatar;
  }));
  document.querySelector("#playerJoinForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const current = readRoom(code);
    if (!current || current.status !== "waiting" || current.joinLocked) return showErrorToast("الغرفة مغلقة الآن أمام انضمامات جديدة.", "تعذر الانضمام");
    if (current.players.length >= current.maxPlayers) return showErrorToast("اكتمل عدد اللاعبين.", "الغرفة ممتلئة");
    const name = document.querySelector("#playerNameInput").value.trim();
    if (current.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return showErrorToast("هذا الاسم مستخدم داخل الغرفة.", "اختر اسمًا آخر");
    try {
      const response = await joinPlayerOnServer(code, {
        name,
        gender: document.querySelector('input[name="gender"]:checked').value,
        avatar: document.querySelector("#selectedAvatar").value,
      });
      const playerId = response.player.id;
      history.replaceState({}, "", `?room=${code}&player=${playerId}`);
      renderPlayerRoom({ app, onBack, code, playerId });
    } catch (error) {
      const messages = { ROOM_FULL: "اكتمل عدد اللاعبين.", NAME_TAKEN: "هذا الاسم مستخدم داخل الغرفة.", ROOM_CLOSED: "الغرفة مغلقة الآن." };
      showErrorToast(messages[error.message] || "تعذر الانضمام إلى الغرفة.", "تعذر الانضمام");
    }
  });
}

function playerCard(player, host = false) {
  return `<article class="online-player-card ${!player.alive ? "eliminated" : ""}"><img src="${player.avatar}" alt="${player.name}" /><div><strong>${player.name}</strong><span>${player.roleKnown ? "✅ تمت معرفة الدور" : "⏳ بانتظار كشف الدور"}</span></div><i class="connection-dot"></i>${host ? `<button class="remove-player-button" data-remove-player="${player.id}" type="button">حذف</button>` : ""}</article>`;
}


function getRoleRevealRemainingSeconds(room) {
  const endAt = Number(room?.roleRevealEndsAt || 0);
  if (!endAt) return 0;
  return Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
}

function getRoleRevealTimerState(seconds) {
  if (seconds > 15) {
    return { className: "is-green", label: "وقت كافٍ لقراءة الأدوار" };
  }

  if (seconds > 5) {
    return { className: "is-yellow", label: "اقترب وقت بدء الليل" };
  }

  return { className: "is-red", label: "استعد لبدء المباراة" };
}

function renderHostRoleRevealCountdown(room) {
  const seconds = getRoleRevealRemainingSeconds(room);
  const timerState = getRoleRevealTimerState(seconds);
  const progress = Math.max(0, Math.min(100, (seconds / 30) * 100));
  const completed = seconds <= 0;

  return `
    <section class="role-reveal-countdown ${timerState.className}" id="roleRevealCountdown">
      <div class="role-reveal-countdown-heading">
        <span>🎴</span>
        <div>
          <h4>تم توزيع الأدوار بنجاح</h4>
          <p>انتظر حتى يرى المشاركون أدوارهم</p>
        </div>
      </div>

      <div
        class="role-reveal-timer-ring"
        id="roleRevealTimerRing"
        style="--countdown-progress: ${progress}%"
      >
        <div class="role-reveal-timer-core">
          <strong id="roleRevealTimerValue">${seconds}</strong>
          <span>ثانية</span>
        </div>
      </div>

      <p class="role-reveal-timer-status" id="roleRevealTimerStatus">
        ${completed ? "انتهى وقت الاطلاع على الأدوار" : timerState.label}
      </p>

      <div class="role-reveal-known-progress">
        <span>شاهدوا أدوارهم</span>
        <strong>${room.players.filter(player => player.roleKnown).length} / ${room.players.length}</strong>
      </div>

      <button
        id="nightModeButton"
        class="night-action-button role-reveal-eyes-button"
        type="button"
        ${completed ? "" : "hidden"}
      >
        🙈 أغمضوا أعينكم جميعًا
      </button>

      <button
        id="skipRoleRevealWait"
        class="role-reveal-skip-button"
        type="button"
        ${completed ? "hidden" : ""}
      >
        ⏭ تخطي الانتظار
      </button>
    </section>
  `;
}

function bindHostRoleRevealCountdown(code, room) {
  if (hostRoleRevealIntervalId) {
    clearInterval(hostRoleRevealIntervalId);
    hostRoleRevealIntervalId = null;
  }

  if (
    room.status !== "playing" ||
    room.phase !== "role-reveal"
  ) {
    return;
  }

  const updateDisplay = () => {
    const currentRoom = readRoom(code);
    if (!currentRoom || currentRoom.phase !== "role-reveal") {
      clearInterval(hostRoleRevealIntervalId);
      hostRoleRevealIntervalId = null;
      return;
    }

    const seconds = getRoleRevealRemainingSeconds(currentRoom);
    const timerState = getRoleRevealTimerState(seconds);
    const progress = Math.max(0, Math.min(100, (seconds / 30) * 100));
    const container = document.querySelector("#roleRevealCountdown");
    const ring = document.querySelector("#roleRevealTimerRing");
    const value = document.querySelector("#roleRevealTimerValue");
    const status = document.querySelector("#roleRevealTimerStatus");
    const eyesButton = document.querySelector("#nightModeButton");
    const skipButton = document.querySelector("#skipRoleRevealWait");

    if (!container || !ring || !value || !status) return;

    container.classList.remove("is-green", "is-yellow", "is-red", "is-complete");
    container.classList.add(seconds <= 0 ? "is-complete" : timerState.className);
    ring.style.setProperty("--countdown-progress", `${progress}%`);
    value.textContent = String(seconds);
    status.textContent = seconds <= 0
      ? "انتهى وقت الاطلاع على الأدوار"
      : timerState.label;

    if (seconds <= 0) {
      eyesButton?.removeAttribute("hidden");
      skipButton?.setAttribute("hidden", "");
      clearInterval(hostRoleRevealIntervalId);
      hostRoleRevealIntervalId = null;
    }
  };

  updateDisplay();
  hostRoleRevealIntervalId = window.setInterval(updateDisplay, 250);
}

function renderOnlineTimeline(room, limit = 8) {
  const items = Array.isArray(room?.timeline) ? room.timeline.slice(-limit).reverse() : [];
  if (!items.length) return `<div class="online-timeline-empty">لا توجد أحداث مسجلة بعد.</div>`;
  return `<div class="online-timeline">${items.map(item => `<article class="online-timeline-item"><span class="online-timeline-dot"></span><div><strong>${item.text || item.hostText || item.publicText || "تم تحديث المباراة"}</strong><small>${new Date(item.at || Date.now()).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</small></div></article>`).join("")}</div>`;
}

const LIVE_ROLE_CHAT_META = {
  thief: { label: "اللص", icon: "🗡️", className: "thief" },
  nurse: { label: "الممرضة", icon: "⚕️", className: "nurse" },
  king: { label: "الملك", icon: "♚", className: "king" },
  investigator: { label: "المحقق", icon: "🔎", className: "investigator" },
  citizen: { label: "المواطنون", icon: "🏙️", className: "citizen" },
};

const LIVE_CITIZEN_CHAT_LINES = [
  "نتمنى من السلطات إلقاء القبض على اللصوص قبل فوات الأوان.",
  "علينا مراقبة التصرفات جيدًا، فاللص قد يكون أقرب مما نتوقع.",
  "لن نتسرع في الاتهام، وسنناقش كل ما حدث قبل التصويت.",
];

function renderLiveRoleChat(room, limit = 12) {
  const timeline = Array.isArray(room?.timeline) ? room.timeline : [];
  const roleMessages = timeline
    .filter(item => item?.type === "night_action_confirmed" && (item.chatText || item.text))
    .slice(-Math.max(1, limit));

  if (!roleMessages.length) {
    return `<div class="live-role-chat-empty"><span>💬</span><p>ستظهر رسائل الأدوار هنا فور تنفيذ مهام الليل.</p></div>`;
  }

  const bubbles = roleMessages.map(item => {
    const meta = LIVE_ROLE_CHAT_META[item.role] || LIVE_ROLE_CHAT_META.citizen;
    return `
      <article class="live-chat-message live-chat-message--${meta.className}">
        <div class="live-chat-avatar" aria-hidden="true">${meta.icon}</div>
        <div class="live-chat-bubble">
          <strong>${meta.label}</strong>
          <p>${item.chatText || item.text}</p>
        </div>
      </article>
    `;
  });

  const citizenSeed = Math.max(1, Number(room?.nightNumber || room?.roundNumber || 1));
  const citizenMessages = LIVE_CITIZEN_CHAT_LINES.map((line, index) => {
    const shifted = LIVE_CITIZEN_CHAT_LINES[(index + citizenSeed - 1) % LIVE_CITIZEN_CHAT_LINES.length];
    const meta = LIVE_ROLE_CHAT_META.citizen;
    return `
      <article class="live-chat-message live-chat-message--citizen">
        <div class="live-chat-avatar" aria-hidden="true">${meta.icon}</div>
        <div class="live-chat-bubble">
          <strong>${meta.label}</strong>
          <p>${shifted}</p>
        </div>
      </article>
    `;
  });

  return `<div class="live-role-chat">${[...bubbles, ...citizenMessages].join("")}</div>`;
}


function formatOnlineClock(totalSeconds) {
  const safe = Math.max(0, Math.ceil(Number(totalSeconds) || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getOnlineDayRemaining(room) {
  return Math.max(0, Math.ceil((Number(room?.dayEndsAt || 0) - Date.now()) / 1000));
}

function renderOnlineDayTimer(room, { compact = false } = {}) {
  const total = Math.max(30, Number(room?.discussionDurationSeconds || 60));
  const remaining = getOnlineDayRemaining(room);
  const percentage = Math.max(0, Math.min(100, (remaining / total) * 100));
  const stateClass = remaining <= 5 ? "timer-danger" : remaining <= 15 ? "timer-warning" : "timer-normal";
  return `
    <section class="online-day-timer ${compact ? "is-compact" : ""}" data-day-ends-at="${Number(room?.dayEndsAt || 0)}" data-day-total="${total}">
      <div class="discussion-timer">
        <div class="timer-progress-ring ${stateClass}" role="timer" aria-live="polite" style="--timer-progress:${percentage}%">
          <div class="timer-content">
            <span>الوقت المتبقي</span>
            <strong>${formatOnlineClock(remaining)}</strong>
            <small>${remaining > 0 ? "النقاش جارٍ الآن" : "انتهى وقت النقاش"}</small>
          </div>
        </div>
      </div>
      <div class="online-day-progress"><i style="width:${percentage}%"></i></div>
    </section>
  `;
}

function renderAssassinationScene({ name, avatar }) {
  return `
    <section class="assassination-scene" aria-label="تم اغتيال اللاعب">
      <div class="assassination-blood" aria-hidden="true"></div>
      <div class="assassination-knife" aria-hidden="true">🗡️</div>
      <div class="assassination-portrait-frame">
        <img src="${avatar || "/logo.png"}" alt="${name || "اللاعب"}" />
        <span class="assassination-crack crack-a"></span>
        <span class="assassination-crack crack-b"></span>
        <span class="assassination-mourning-ribbon">تم الاغتيال</span>
      </div>
      <small>ضحية اللصوص</small>
      <h2>${name || "أحد اللاعبين"}</h2>
      <p>تم اغتياله خلال الليل وخرج من اللعبة دون كشف دوره.</p>
    </section>
  `;
}

function renderNurseRescueCard(summary) {
  const savedName = summary?.victimName || "أحد اللاعبين";
  return `
    <section class="night-event-card night-event-card--rescue" aria-label="تم إنقاذ اللاعب">
      <div class="night-event-card__pulse" aria-hidden="true"><span>＋</span><i></i><b>♥</b></div>
      <div class="night-event-card__body">
        <small>استجابة إسعافية ناجحة</small>
        <h2>${savedName}</h2>
        <p>تم إنقاذه من هجوم اللصوص وعاد إلى اللعبة.</p>
      </div>
      <div class="night-event-card__badge" aria-hidden="true">🚑</div>
    </section>
  `;
}

function renderRoyalPardonCard(summary) {
  if (!summary?.kingPardonGranted) return "";
  const pardonedName = summary?.kingPardonPlayerName || null;
  return `
    <section class="night-event-card night-event-card--pardon" aria-label="تم منح العفو الملكي">
      <div class="night-event-card__scepter" aria-hidden="true">♔</div>
      <div class="night-event-card__body">
        <small>وسام العفو الملكي</small>
        <h2>${pardonedName || "عفو ملكي"}</h2>
        <p>${pardonedName ? "حصل على وسام عفو ملكي لهذه الجولة." : "قام الملك بإعطاء عفو ملكي لأحد الأشخاص."}</p>
      </div>
      <div class="night-event-card__badge night-event-card__badge--scepter" aria-hidden="true">⚜</div>
    </section>
  `;
}

function renderOnlineNightSummary(room) {
  const summary = room?.daySummary;
  if (!summary) return "";
  const pardonCard = renderRoyalPardonCard(summary);

  if (summary.outcome === "saved") {
    return `
      <div class="night-events-stack">
        ${renderNurseRescueCard(summary)}
        ${pardonCard}
        ${summary.investigatorCompleted ? `<section class="night-event-card night-event-card--investigation"><div class="night-event-card__badge">🕵️</div><div class="night-event-card__body"><small>التحقيق الليلي</small><h3>اكتملت مهمة المحقق بسرية</h3><p>لا يتم كشف هوية المحقق أو نتيجة تحقيقه في البث العام.</p></div></section>` : ""}
      </div>
    `;
  }

  if (summary.outcome === "eliminated") {
    const victim = (room.players || []).find(player => player.id === summary.victimId) || null;
    return `
      <div class="night-events-stack">
        ${renderAssassinationScene({
          name: summary.victimName || victim?.name || "أحد اللاعبين",
          avatar: victim?.avatar || "",
        })}
        ${pardonCard}
        ${summary.investigatorCompleted ? `<section class="night-event-card night-event-card--investigation"><div class="night-event-card__badge">🕵️</div><div class="night-event-card__body"><small>التحقيق الليلي</small><h3>اكتملت مهمة المحقق بسرية</h3><p>لا يتم كشف هوية المحقق أو نتيجة تحقيقه في البث العام.</p></div></section>` : ""}
      </div>
    `;
  }

  return `
    <div class="night-events-stack">
      <section class="online-night-summary">
        <div class="online-night-summary-icon">🌅</div>
        <div>
          <small>نتيجة الليلة ${summary.nightNumber || room.nightNumber || 1}</small>
          <h3>مرّت الليلة دون خروج أي لاعب.</h3>
        </div>
      </section>
      ${pardonCard}
      ${summary.investigatorCompleted ? `<section class="night-event-card night-event-card--investigation"><div class="night-event-card__badge">🕵️</div><div class="night-event-card__body"><small>التحقيق الليلي</small><h3>اكتملت مهمة المحقق بسرية</h3><p>لا يتم كشف هوية المحقق أو نتيجة تحقيقه في البث العام.</p></div></section>` : ""}
    </div>
  `;
}

function renderOnlineVotingStatus(room) {
  const voted = new Set(room?.votingStatus?.votedPlayerIds || []);
  const alive = (room?.players || []).filter(player => player.alive);
  if (!alive.length) return "";
  return `
    <section class="online-voting-status">
      <div class="online-voting-status-heading"><strong>🗳️ حالة التصويت</strong><span>${voted.size} / ${alive.length}</span></div>
      <div class="online-voting-status-list">
        ${alive.map(player => `
          <div class="online-vote-status-player ${voted.has(player.id) ? "has-voted" : "waiting-vote"}">
            <img src="${player.avatar}" alt="${player.name}" />
            <span>${player.name}</span>
            <b>${voted.has(player.id) ? "✅ قام بالتصويت" : "⌛ لم يصوت بعد"}</b>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function finalRoleName(role, gender = "male") {
  const female = gender === "female";
  if (role === "thief") return female ? "لصة" : "لص";
  if (role === "nurse") return female ? "ممرضة" : "ممرض";
  if (role === "king") return female ? "الملكة" : "الملك";
  if (role === "investigator") return female ? "محققة" : "محقق";
  return female ? "مواطنة" : "مواطن";
}

function finalRoleIcon(role) {
  return ({ thief: "🗡️", nurse: "⚕️", king: "👑", investigator: "🔎", citizen: "🛡️" })[role] || "🎭";
}

function renderOnlineWinnerFinal(room, { live = false } = {}) {
  if (!room?.winner) return "";
  const finalRoles = Array.isArray(room.finalRoles) ? room.finalRoles : [];
  const thiefNames = finalRoles.filter(player => player.role === "thief").map(player => player.name);
  const thievesWon = room.winner === "thieves";
  const namesText = thiefNames.length ? thiefNames.join("، ") : "اللصوص";
  return `
    <section class="online-final-winner online-final-winner--${thievesWon ? "thieves" : "citizens"} ${live ? "is-live" : ""}">
      <div class="online-final-winner__icon">${thievesWon ? "🗡️" : "🛡️"}</div>
      <small>${thievesWon ? "سيطر اللصوص على المدينة" : "انتصرت المدينة"}</small>
      <h1>${thievesWon ? "اللصوص قد سيطروا على المدينة كاملة" : "تم كشف جميع اللصوص في المدينة"}</h1>
      <p>${thievesWon
        ? `اللصوص الذين نجحوا في السيطرة على المدينة هم: <strong>${namesText}</strong>`
        : "تم القبض عليهم بنجاح، وانتهى خطر اللصوص داخل المدينة."}
      </p>
    </section>`;
}

function renderLiveFinalRoles(room) {
  if (!room?.winner || !Array.isArray(room.finalRoles) || !room.finalRoles.length) return "";
  return `
    <section class="live-final-roles">
      <header>
        <span>🎭</span>
        <div><small>انتهت المباراة</small><h3>الأدوار الحقيقية للمتسابقين</h3></div>
      </header>
      <div class="live-final-roles__grid">
        ${room.finalRoles.map(player => `
          <article class="live-final-role live-final-role--${player.role}">
            <img src="${player.avatar}" alt="${player.name}" />
            <div><strong>${player.name}</strong><span>${finalRoleIcon(player.role)} ${finalRoleName(player.role, player.gender)}</span></div>
            <i class="${player.alive ? "is-alive" : "is-out"}">${player.alive ? "حي" : "خرج"}</i>
          </article>`).join("")}
      </div>
    </section>`;
}

function renderOnlineBestPlayer(room, { live = false } = {}) {
  const best = room?.bestPlayer;
  if (!room?.winner || !best?.playerName) return "";
  const player = (room.players || []).find(item => item.id === best.playerId);
  const avatar = best.avatar || player?.avatar || "";
  return `<section class="online-best-player ${live ? "is-live" : ""}">
    <div class="online-best-player-medal">🥇</div>
    ${avatar ? `<div class="online-best-player-avatar"><img src="${avatar}" alt="${best.playerName}" /></div>` : ""}
    <small>أفضل لاعب في المباراة</small>
    <h2>${best.playerName}</h2>
    <p>${best.reason || "قدم أفضل أداء إجمالي في المباراة"}</p>
  </section>`;
}

function renderOnlineVotingResult(room) {
  const result = room?.votingResult;
  if (!result) return "";
  let icon = "🗳️";
  let title = "انتهى التصويت";
  let description = "لم يخرج أي لاعب.";
  if (result.outcome === "eliminated") {
    icon = "🚪";
    title = `خرج ${result.playerName}`;
    description = `حصل على أعلى عدد من الأصوات (${result.highestVotes}) وخرج من اللعبة.`;
  } else if (result.outcome === "pardoned") {
    icon = "👑";
    title = result.playerName ? `${result.playerName} حصل على عفو ملكي` : "تم تفعيل عفو ملكي";
    description = result.playerName
      ? `حصل على أعلى عدد من الأصوات (${result.highestVotes})، لكن وسام العفو الملكي أبقاه في اللعبة.`
      : "قام الملك بإعطاء عفو ملكي لأحد الأشخاص، ولن يتم كشف هويته في البث العام.";
  } else if (result.outcome === "tie") {
    icon = "⚖️";
    title = "تعادل في الأصوات";
    description = "تساوت أعلى الأصوات، لذلك لم يخرج أحد.";
  } else if (result.outcome === "abstain") {
    icon = "✋";
    title = "الامتناع هو الأعلى";
    description = "حصل الامتناع على أعلى عدد من الأصوات، لذلك لم يخرج أحد.";
  }
  return `<section class="online-voting-result"><div>${icon}</div><small>نتيجة التصويت</small><h2>${title}</h2><p>${description}</p></section>`;
}

function isHostNightRoleComplete(room, role) {
  const rolePlayers = (room?.players || []).filter(player => player.alive && player.role === role);
  if (!rolePlayers.length) return false;
  const confirmedActors = room?.nightActions?.confirmedActors || {};
  return rolePlayers.every(player => confirmedActors[player.id]?.role === role);
}

function renderHostNightControls(room) {
  if (room.status !== "playing" || !["role-reveal", "eyes-closed", "night-role"].includes(room.phase)) return "";
  const roles = ["thief", "nurse", "king", "investigator"];
  const labels = { thief: "🗡️ استيقاظ اللصوص", nurse: "🏥 استيقاظ الممرضة", king: "👑 استيقاظ الملك", investigator: "🕵️ استيقاظ المحقق" };
  const roleButtonsLocked = room.phase === "role-reveal";
  const aliveRoles = new Set((room.players || []).filter(player => player.alive).map(player => player.role));
  return `
    <div class="role-control-grid">
      ${roles.map(role => {
        const absent = room.status === "playing" && room.players.some(player => player.role) && !aliveRoles.has(role);
        const actionComplete = isHostNightRoleComplete(room, role);
        return `<button class="role-wake-button ${room.activeRole === role ? "active" : ""} ${room.completedSteps?.includes(`wake-${role}`) ? "is-completed" : ""} ${actionComplete ? "is-action-complete" : ""}" data-role="${role}" ${roleButtonsLocked || absent || actionComplete ? "disabled" : ""}>${labels[role]}${absent ? " · غير موجود" : actionComplete ? " · ✓ تم" : ""}</button>`;
      }).join("")}
    </div>
    <button id="finishOnlineNight" class="online-primary-button large finish-night-button ${room.nightReady ? "is-ready" : "is-locked"}" type="button" ${room.nightReady ? "" : "disabled"}>
      ☀️ الانتقال إلى مرحلة النهار
    </button>
    <small class="finish-night-hint">${room.nightReady ? "اكتملت جميع مهام الليل. الزر جاهز للانتقال." : "يتفعّل تلقائيًا بعد تأكيد جميع أصحاب الأدوار الليلية لاختياراتهم."}</small>
  `;
}

function renderHostLobby({ app, onBack, code }) {
  saveOnlineResumeMarker({ mode: "host", code });
  subscribeRoom(code, "host");
  const draw = () => {
    const room = readRoom(code);
    if (!room) {
      fetchRoomFromServer(code).then(foundRoom => {
        if (foundRoom) draw();
        else openOnlinePortal({ app, onBack });
      });
      return;
    }
    const url = inviteUrl(code);
    const broadcastUrl = liveViewUrl(code);
    app.innerHTML = pageShell(`
      <div class="host-dashboard">
        <section class="host-room-hero"><div><span class="live-status"><i></i>${room.status === "waiting" && !room.joinLocked ? "الغرفة مفتوحة" : room.status === "waiting" ? "الغرفة مغلقة" : "المباراة جارية"}</span><h2>${room.roomName}</h2><p>مدير اللعبة: ${room.hostName}</p></div><div class="host-room-code"><small>رمز الغرفة</small><strong>${room.code}</strong></div></section>
        <section class="invite-panel"><div><small>رابط دعوة المتسابقين</small><input id="inviteLinkInput" readonly value="${url}" /></div><button id="copyInviteButton" class="online-secondary-button">نسخ الرابط</button><button id="shareInviteButton" class="online-primary-button">مشاركة</button></section>
        <div class="dashboard-grid">
          <section class="players-panel"><div class="panel-title"><div><h3>المتسابقون</h3><p>يظهر كل لاعب فور انضمامه</p></div><strong>${room.players.length} / ${room.maxPlayers}</strong></div><div class="online-players-list">${room.players.length ? room.players.map(p => playerCard(p, room.status === "waiting")).join("") : `<div class="online-empty small"><div>👥</div><h3>بانتظار المتسابقين</h3><p>شارك الرابط ليبدأ اللاعبون بالانضمام.</p></div>`}</div></section>
          <aside class="host-controls">
            <h3>التحكم بالمباراة</h3>
            <div class="control-stat"><span>حالة الغرفة</span><strong>${room.status === "waiting" ? "انتظار" : "بدأت"}</strong></div>
            <div class="control-stat"><span>عرفوا أدوارهم</span><strong>${room.players.filter(p=>p.roleKnown).length} / ${room.players.length}</strong></div>
            ${room.status === "waiting" ? `
              <button id="startOnlineGame" class="online-primary-button large" ${room.players.length < 4 ? "disabled" : ""}>▶ بدء اللعبة</button>
            ` : ""}
            <div class="live-share-row">
              <button id="openLiveView" class="online-secondary-button" type="button">📡 شاشة البث المباشر</button>
              <button id="shareLiveView" class="online-secondary-button live-share-button" type="button">🔗 مشاركة رابط البث</button>
            </div>
            ${room.status === "playing" && room.phase === "role-reveal" ? renderHostRoleRevealCountdown(room) : ""}
            ${renderHostNightControls(room)}
            ${room.status === "playing" && room.phase === "day" ? `
              <div class="day-stage-banner">
                <strong>☀️ مرحلة النهار</strong>
                <span>استيقظوا جميعًا، انتهت مهام الليل.</span>
              </div>
              ${renderOnlineNightSummary(room)}
              ${renderOnlineDayTimer(room, { compact: true })}
              <button id="forceStartOnlineVoting" class="online-primary-button large start-voting-button" type="button">🗳️ الانتقال إلى التصويت</button>
              <small class="finish-night-hint">زر مدير اللعبة ينقل جميع المتسابقين الأحياء في الغرفة مباشرة إلى صفحة التصويت في أي وقت من مرحلة النهار.</small>
            ` : ""}
            ${room.status === "playing" && room.phase === "voting" ? `${renderOnlineVotingStatus(room)}` : ""}
            ${room.status === "playing" && room.phase === "voting-result" ? `
              ${renderOnlineVotingResult(room)}
              ${room.winner ? `<div class="online-winner-banner">🏆 ${room.winner === "citizens" ? "فاز المواطنون" : "فاز اللصوص"}</div>${renderOnlineBestPlayer(room)}<div class="online-final-actions"><button id="restartOnlineGame" class="online-primary-button large online-rematch-button" type="button">🔄 إعادة اللعبة</button><button id="newOnlineGame" class="online-secondary-button large online-new-game-button" type="button">✨ لعبة جديدة</button></div><small class="finish-night-hint">إعادة اللعبة تبقي نفس الغرفة والمشاركين وتعيد فتح الانضمام إذا كان هناك مكان. لعبة جديدة تعيدك إلى بوابة إنشاء أو دخول غرفة.</small>` : `<button id="startNextOnlineNight" class="online-primary-button large" type="button">🌙 بدء الليلة التالية</button>`}
            ` : ""}
            <section class="host-live-timeline"><h3>سجل الأحداث المباشر</h3>${renderOnlineTimeline(room, 10)}</section>
          </aside>
        </div>
      </div>
    `, "لوحة مدير اللعبة");
    attachBack(() => openOnlinePortal({ app, onBack }));
    document
      .querySelector("#copyInviteButton")
      ?.addEventListener("click", () => copyInviteLink(url));

    document
      .querySelector("#inviteLinkInput")
      ?.addEventListener("click", (event) => event.currentTarget.select());

    document
      .querySelector("#shareInviteButton")
      ?.addEventListener("click", async () => {
        try {
          if (navigator.share) {
            await navigator.share({
              title: room.roomName,
              text: "انضم إلى غرفة مافيا",
              url,
            });
            return;
          }
        } catch (error) {
          if (error?.name === "AbortError") {
            return;
          }
        }

        const copied = await copyTextToClipboard(
          url,
          document.querySelector("#inviteLinkInput"),
        );

        if (copied) {
          showInfoToast(
            "جهازك لا يدعم نافذة المشاركة، لذلك تم نسخ الرابط.",
            "الرابط جاهز",
          );
        } else {
          showErrorToast(
            "تعذرت المشاركة والنسخ التلقائي. انسخ الرابط يدويًا.",
            "تعذر تنفيذ الطلب",
          );
        }
      });
    document.querySelectorAll("[data-remove-player]").forEach(btn => btn.addEventListener("click", async () => { try { await hostCommand(code, "remove-player", { playerId: btn.dataset.removePlayer }); } catch { showErrorToast("تعذر حذف اللاعب.", "خطأ"); } }));
    document.querySelector("#startOnlineGame")?.addEventListener("click", async () => {
      try {
        await hostCommand(code, "start-game");
        showSuccessToast("تم توزيع الأدوار وإرسالها للاعبين.", "بدأت المباراة");
      } catch { showErrorToast("تعذر بدء المباراة.", "خطأ في الخادم"); }
    });
    document.querySelector("#openLiveView")?.addEventListener("click", () => window.open(broadcastUrl, "_blank"));
    document.querySelector("#shareLiveView")?.addEventListener("click", async () => {
      try {
        if (navigator.share) {
          await navigator.share({
            title: `البث المباشر - ${room.roomName}`,
            text: "تابع أحداث مباراة مافيا مباشرة",
            url: broadcastUrl,
          });
          return;
        }
      } catch (error) {
        if (error?.name === "AbortError") return;
      }

      const copied = await copyTextToClipboard(broadcastUrl);
      if (copied) showSuccessToast("تم نسخ رابط البث المباشر.", "الرابط جاهز");
      else showErrorToast("تعذر نسخ رابط البث المباشر.", "تعذر تنفيذ الطلب");
    });

    bindHostRoleRevealCountdown(code, room);
bindOnlineDayTimerTicker();

    document.querySelector("#skipRoleRevealWait")?.addEventListener("click", async () => {
      try { await hostCommand(code, "skip-role-reveal"); } catch { showErrorToast("تعذر تخطي الانتظار.", "خطأ"); }
    });

    document.querySelector("#nightModeButton")?.addEventListener("click", async () => {
      try { await hostCommand(code, "eyes-closed"); } catch { showErrorToast("تعذر بدء مرحلة الليل.", "خطأ"); }
    });
    document.querySelectorAll("[data-role]").forEach(btn => btn.addEventListener("click", async () => {
      const role = btn.dataset.role;
      // استجابة بصرية فورية عند المدير. تبقى حالة الخادم هي المصدر النهائي للحقيقة.
      document.querySelectorAll(".role-wake-button").forEach(item => item.classList.remove("active"));
      btn.classList.add("active");
      try {
        await hostCommand(code, "wake-role", { role });
      } catch {
        btn.classList.remove("active");
        showErrorToast("تعذر إيقاظ الدور.", "خطأ");
      }
    }));
    document.querySelector("#finishOnlineNight")?.addEventListener("click", async () => {
      try {
        await hostCommand(code, "finish-night");
        showSuccessToast("اكتملت مهام الليل وبدأت مرحلة النهار.", "☀️ استيقظوا جميعًا");
      } catch {
        showErrorToast("لا يمكن الانتقال للنهار قبل اكتمال جميع مهام الليل.", "المهام غير مكتملة");
      }
    });
    document.querySelector("#forceStartOnlineVoting")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      if (button?.disabled) return;
      button.disabled = true;
      try {
        await startVotingReliably(code);
        showSuccessToast("تم الانتقال إلى التصويت لدى جميع المتسابقين.", "🗳️ بدأ التصويت");
      } catch {
        button.disabled = false;
        showErrorToast("تعذر الانتقال المباشر إلى التصويت.", "خطأ في الخادم");
      }
    });
    document.querySelector("#startNextOnlineNight")?.addEventListener("click", async () => {
      try {
        await hostCommand(code, "next-night");
        showSuccessToast("بدأت ليلة جديدة.", "🌙 الجولة التالية");
      } catch {
        showErrorToast("تعذر بدء الليلة التالية.", "خطأ في الخادم");
      }
    });
    document.querySelector("#restartOnlineGame")?.addEventListener("click", async () => {
      try {
        await hostCommand(code, "rematch");
        showSuccessToast("تمت إعادة فتح الغرفة بنفس المشاركين.", "🔄 مباراة جديدة");
      } catch {
        showErrorToast("تعذرت إعادة تجهيز الغرفة.", "خطأ في الخادم");
      }
    });
    document.querySelector("#newOnlineGame")?.addEventListener("click", () => {
      // لعبة جديدة منفصلة: لا نحذف الغرفة من الخادم، بل ننهي حفظ الاستكمال المحلي
      // ونعود إلى بوابة إنشاء/دخول غرفة جديدة.
      deleteSavedOnlineGame();
      history.replaceState({}, "", location.pathname);
      openOnlinePortal({ app, onBack });
    });
  };
  draw();
  startRoomViewSync({ code, mode: "host", draw, intervalMs: 450 });
}

function finalizeActiveNightRole(room) {
  // يتم اعتماد كل مهمة من جهاز صاحب الدور نفسه.
  // انتقال المدير لا يغيّر اختيارًا غير مؤكد ولا يستهلك أي قدرة.
  return room;
}

function shuffle(items) { return [...items].sort(() => Math.random() - 0.5); }
function distributeRoles(count) {
  const thiefCount = count <= 6 ? 1 : count <= 10 ? 2 : Math.max(3, Math.floor(count / 4));
  const roles = [...Array(thiefCount).fill("thief"), "nurse", "king"];
  if (count >= 6) roles.push("investigator");
  while (roles.length < count) roles.push("citizen");
  return shuffle(roles);
}
const ROLE_LABELS = { thief: "اللص", nurse: "الممرضة", king: "الملك", investigator: "المحقق", citizen: "المواطن" };
const ROLE_ICONS = { thief: "🗡️", nurse: "🏥", king: "👑", investigator: "🕵️", citizen: "🏙️" };

function onlineRoleCard(player, { settled = false } = {}) {
  const image = getRoleCardImage(player.role, player.gender || "male");
  if (!image) return "";
  return `
    <section class="online-role-reveal-wrap">
      <p class="role-card-secret-label">دورك السري</p>
      <h2 class="role-card-player-name">${player.name}</h2>
      <div class="role-card-stage">
        <div class="role-playing-card${settled ? " card-entered card-flipped" : ""}" id="onlineRoleCard">
          <div class="role-card-inner">
            <div class="role-card-face role-card-back">
              <img class="role-card-back-logo" src="/logo.png" alt="" />
              <p class="role-card-back-title">مافيا</p>
            </div>
            <div class="role-card-face role-card-front">
              <img class="role-card-front-image" src="${image}" alt="بطاقة ${finalRoleName(player.role, player.gender)}" />
              <span class="role-card-shine"></span>
            </div>
          </div>
        </div>
      </div>
      <div class="role-card-details${settled ? " details-visible" : ""}" id="onlineRoleDetails">
        <h2>${finalRoleName(player.role, player.gender)}</h2>
        <p>${({
          thief: "استيقظ مع اللصوص ليلًا واختروا ضحية واحدة.",
          nurse: "احمِ لاعبًا واحدًا كل ليلة، ويمكنك حماية نفسك.",
          king: "لديك 3 أوسمة عفو. امنح أحد اللاعبين عفوًا أو احتفظ بالوسام.",
          investigator: "اختر لاعبًا كل ليلة لكشف هويته، مع بقاء الملك والممرض متخفيين كمواطنين.",
          citizen: "ناقش وصوّت بحكمة لاكتشاف اللصوص وإخراجهم.",
        })[player.role] || "احفظ دورك جيدًا ولا تكشفه لأي لاعب."}</p>
        <button id="hideMyRole" class="online-secondary-button">إخفاء البطاقة</button>
      </div>
    </section>`;
}

function isNightActionConfirmed(room, playerId) {
  return Boolean(
    room.nightActions?.confirmedActors?.[playerId],
  );
}

function allowedTargets(room, player) {
  if (isNightActionConfirmed(room, player.id)) {
    return [];
  }

  return room.players.filter(target => {
    if (!target.alive) return false;

    if (player.role === "thief") {
      return (
        target.role !== "thief" &&
        target.id !== room.lastTargets?.thief
      );
    }

    if (player.role === "nurse") {
      return target.id !== room.lastTargets?.nurse;
    }

    if (player.role === "king") {
      const remaining = Number(
        player.royalPardonsRemaining || 0,
      );

      return (
        remaining > 0 &&
        !room.nightActions?.kingPardonFinalized &&
        target.id !== player.id
      );
    }

    if (player.role === "investigator") {
      return target.id !== player.id;
    }

    return false;
  });
}

function selectedTargetId(room, player) {
  const confirmedTarget =
    room.nightActions?.confirmedActors?.[player.id]?.targetId;

  if (confirmedTarget) {
    return confirmedTarget;
  }

  if (player.role === "thief") {
    return room.nightActions?.thiefVotes?.[player.id] || null;
  }

  if (player.role === "nurse") {
    return room.nightActions?.nurseTargetId || null;
  }

  if (player.role === "king") {
    return room.nightActions?.kingTargetId || null;
  }

  if (player.role === "investigator") {
    return room.nightActions?.investigatorTargetId || null;
  }

  return null;
}

async function saveNightTarget(code, playerId, targetId) {
  try {
    return await playerCommand(code, playerId, "select-night-target", { targetId });
  } catch (error) {
    showErrorToast("تعذر حفظ الاختيار. حاول مرة أخرى.", "خطأ في الاتصال");
    return null;
  }
}

async function confirmNightAction(code, playerId) {
  try {
    return await playerCommand(code, playerId, "confirm-night-action");
  } catch (error) {
    showErrorToast("تعذر تأكيد المهمة. تحقق من اختيارك واتصالك.", "تعذر التأكيد");
    return null;
  }
}

async function skipKingPardon(code, playerId) {
  try {
    return await playerCommand(code, playerId, "skip-king-pardon");
  } catch (error) {
    showErrorToast("تعذر حفظ قرار الاحتفاظ بالوسام.", "خطأ في الاتصال");
    return null;
  }
}

function getInvestigationResult(target) {
  if (!target) return null;
  if (target.role === "king" || target.role === "nurse" || target.role === "citizen") {
    return { role: "citizen", label: target.gender === "female" ? "مواطنة" : "مواطن", icon: "🏙️" };
  }
  if (target.role === "thief") {
    return { role: "thief", label: target.gender === "female" ? "لصة" : "لص", icon: "🗡️" };
  }
  if (target.role === "investigator") {
    return { role: "investigator", label: target.gender === "female" ? "محققة" : "محقق", icon: "🕵️" };
  }
  return { role: target.role, label: ROLE_LABELS[target.role] || "غير معروف", icon: ROLE_ICONS[target.role] || "🎭" };
}

function renderPlayerRoom({ app, onBack, code, playerId }) {
  saveOnlineResumeMarker({ mode: "player", code, playerId });

  const normalizedCode = normalizeRoomCode(code);

  for (const [key, subscription] of desiredSubscriptions.entries()) {
    if (
      subscription.code === normalizedCode &&
      subscription.mode === "public"
    ) {
      desiredSubscriptions.delete(key);
      activeSubscriptions.delete(key);
    }
  }

  subscribeRoom(code, "player", playerId);
    const draw = () => {
    const room = readRoom(code); const player = room?.players.find(p => p.id === playerId);
    if (!room || !player) return renderJoinRoom({ app, onBack, code });
    const revealKey = `${code}:${playerId}`;
    const revealUiState = roleRevealUiState.get(revealKey) || "new";
    const revealStartedLocally = revealUiState === "animating" || revealUiState === "settled";
    let content = "";
    if (room.winner) content = `${renderOnlineWinnerFinal(room)}${renderOnlineBestPlayer(room)}<div class="player-wait-screen compact-result-wait"><p>انتهت المباراة. بانتظار مدير اللعبة لإعادة فتح الغرفة للمباراة التالية...</p></div>`;
    else if (room.status === "waiting") content = `<div class="player-wait-screen"><img src="${player.avatar}" alt="${player.name}" /><span class="live-status"><i></i>متصل بالغرفة</span><h2>أهلًا ${player.name}</h2><p>تم تسجيلك في غرفة <strong>${room.roomName}</strong></p><div class="waiting-pulse"><b></b><b></b><b></b></div><small>بانتظار مدير اللعبة لبدء المباراة...</small></div>`;
    else if (room.phase === "role-reveal" && !player.roleKnown && !revealStartedLocally) content = `
      <div class="role-envelope role-envelope--branded">
        <div class="role-reveal-emblem" aria-hidden="true">
          <span class="role-reveal-emblem-ring"></span>
          <img src="/logo.png" alt="" />
        </div>

        <div class="role-reveal-title-wrap">
          <span class="role-reveal-title-line"></span>
          <h2>دورك جاهز</h2>
          <span class="role-reveal-title-line"></span>
        </div>

        <p class="role-reveal-privacy">
          <span class="role-reveal-privacy-icon">◉</span>
          تأكد أنه لا أحد ينظر إلى شاشتك.
        </p>

        <div class="role-reveal-divider" aria-hidden="true">
          <span></span><b>◆</b><span></span>
        </div>

        <button id="revealMyRole" class="online-primary-button large role-reveal-button">
          <span class="role-reveal-button-icon">◉</span>
          كشف الدور
        </button>
      </div>`;
    else if (room.phase === "role-reveal") {
      // إذا أخفى اللاعب بطاقته، أبقِ شاشة التأكيد ظاهرة طوال مرحلة كشف الأدوار.
      // مزامنة الغرفة لا تعيد إظهار البطاقة بعد إخفائها.
      if (revealUiState === "hidden") {
        content = `<div class="role-hidden-confirmation"><div>✅</div><h2>تمت معرفة الدور</h2><p>بانتظار بقية اللاعبين ومدير اللعبة.</p></div>`;
      } else {
        // إذا كانت البطاقة مكشوفة بالفعل فلا نعيد بناء DOM كلما وصلت مزامنة الغرفة.
        // هذا يمنع إعادة تشغيل دوران البطاقة بصورة مستمرة.
        const existingCard = document.querySelector("#onlineRoleCard");
        if (existingCard && app.contains(existingCard)) {
          return;
        }

        content = onlineRoleCard(player, { settled: revealUiState === "settled" });
      }
    }
    else if (room.phase === "eyes-closed") content = `<div class="eyes-closed-screen"><div>🙈</div><h2>أغمضوا أعينكم جميعًا</h2><p>ضع هاتفك أمامك وانتظر تعليمات مدير اللعبة.</p></div>`;
    else if (
      room.phase === "night-role" &&
      room.activeRole === player.role
    ) {
      const confirmed = isNightActionConfirmed(
        room,
        player.id,
      );

      const targets = confirmed
        ? []
        : allowedTargets(room, player);

      const selected = selectedTargetId(
        room,
        player,
      );

      const selectedPlayer = selected
        ? room.players.find(
            item => item.id === selected,
          )
        : null;

      const investigationResult =
        player.role === "investigator" && confirmed
          ? getInvestigationResult(
              room.investigationResult?.targetId === selected
                ? { ...selectedPlayer, role: room.investigationResult.actualRole }
                : selectedPlayer,
            )
          : null;

      const kingRemaining = Number(
        player.royalPardonsRemaining || 0,
      );

      const kingSkipped = Boolean(
        room.nightActions?.kingSkipped,
      );

      const kingMedals =
        player.role === "king"
          ? `
            <div class="royal-pardon-panel">
              <span>أوسمة العفو المتبقية</span>

              <div class="royal-pardon-medals">
                ${[0, 1, 2]
                  .map(
                    index => `
                      <b class="${
                        index < kingRemaining
                          ? "available"
                          : "used"
                      }">
                        🛡️
                      </b>
                    `,
                  )
                  .join("")}
              </div>

              <strong>${kingRemaining} من 3</strong>
            </div>
          `
          : "";

      const investigationResultHTML =
        investigationResult
          ? `
            <div
              class="investigation-result investigation-result--${
                investigationResult.role
              }"
            >
              <small>نتيجة التحقيق</small>
              <div>${investigationResult.icon}</div>

              <h3>
                ${selectedPlayer?.name ?? "اللاعب"}
                هو ${investigationResult.label}
              </h3>

              <p>
                ${
                  investigationResult.role === "citizen"
                    ? "الملك والممرض يظهران للمحقق كمواطنين حفاظًا على سريتهما."
                    : "تم اعتماد نتيجة التحقيق ولا يمكن تغيير اللاعب في هذه الجولة."
                }
              </p>
            </div>
          `
          : "";

      const actionDescription =
        player.role === "nurse"
          ? "اختر لاعبًا واحدًا لحمايته، ويمكنك حماية نفسك. بعد التأكيد لن تستطيع تغيير الاختيار."
          : player.role === "king"
            ? "امنح لاعبًا واحدًا عفوًا ملكيًا أو احتفظ بالوسام. لا يمكنك اختيار نفسك."
            : player.role === "thief"
              ? "اختر ضحية واحدة. لا يمكنك اختيار لص أو ضحية الليلة السابقة."
              : "اختر لاعبًا واحدًا لكشف هويته. بعد تأكيد التحقيق تُقفل المهمة لهذه الجولة.";

      const targetsHTML = confirmed
        ? `
          <div class="night-action-locked">
            <div class="night-action-locked-icon">✅</div>

            <h3>تم تأكيد الاختيار</h3>

            <p>
              ${
                selectedPlayer
                  ? `تم تأكيد اختيار ${selectedPlayer.name} وحفظه داخل اللعبة.`
                  : "تم تأكيد عدم استخدام القدرة هذه الليلة وحفظ القرار داخل اللعبة."
              }
            </p>

            <small>
              بانتظار انتقال مدير اللعبة إلى الدور التالي.
            </small>
          </div>
        `
        : `
          <div class="night-target-grid">
            ${
              targets.length
                ? targets
                    .map(
                      target => `
                        <button
                          type="button"
                          class="night-target ${
                            selected === target.id
                              ? "selected"
                              : ""
                          }"
                          data-target-id="${target.id}"
                        >
                          <img
                            src="${target.avatar}"
                            alt="${target.name}"
                          />

                          <span>${target.name}</span>

                          ${
                            selected === target.id
                              ? "<b>✓ تم الاختيار</b>"
                              : ""
                          }
                        </button>
                      `,
                    )
                    .join("")
                : `
                  <div class="online-empty small">
                    <h3>
                      ${
                        player.role === "king" &&
                        kingRemaining <= 0
                          ? "نفدت أوسمة العفو"
                          : "لا يوجد اختيار متاح"
                      }
                    </h3>

                    <p>
                      ${
                        player.role === "king"
                          ? "يمكنك الاحتفاظ بالوسام أو متابعة الجولة دون استخدامه."
                          : "لا يوجد لاعب مؤهل للاختيار في هذه الجولة."
                      }
                    </p>
                  </div>
                `
            }
          </div>
        `;

      const kingSkipButton =
        player.role === "king" && !confirmed
          ? `
            <button
              id="skipKingPardon"
              class="online-secondary-button king-skip-button ${
                kingSkipped ? "selected-skip" : ""
              }"
              type="button"
            >
              ${
                kingSkipped
                  ? "✓ تم اختيار الاحتفاظ بالوسام"
                  : "الاحتفاظ بالوسام وعدم اختيار أحد"
              }
            </button>
          `
          : "";

      const canConfirm =
        !confirmed &&
        (Boolean(selected) ||
          (player.role === "king" && kingSkipped));

      const confirmButton = !confirmed
        ? `
          <button
            id="confirmOnlineNightAction"
            class="online-primary-button confirm-night-action-button"
            type="button"
            ${canConfirm ? "" : "disabled"}
          >
            ${
              player.role === "investigator"
                ? "تأكيد وبدء التحقيق"
                : player.role === "king"
                  ? "اعتماد قرار العفو"
                  : "تأكيد الاختيار"
            }
          </button>
        `
        : "";

      content = `
        <div class="active-role-screen">
          <div class="role-symbol role-symbol--card-avatar">
  <img
    src="${getRoleCardImage(player.role, player.gender || "male")}"
    alt="${finalRoleName(player.role, player.gender)}"
    draggable="false"
  />
</div>

<h2>
  ${player.gender === "female" ? "استيقظي يا" : "استيقظ يا"} ${finalRoleName(player.role, player.gender)}
</h2>

          <p>${actionDescription}</p>

          ${kingMedals}
          ${targetsHTML}
          ${kingSkipButton}
          ${confirmButton}
          ${investigationResultHTML}

          <p class="night-choice-status ${
            confirmed ? "is-confirmed" : ""
          }">
            ${
              confirmed
                ? "✅ تم تأكيد الاختيار وحفظه داخل اللعبة، ولا يمكن تعديله في هذه الجولة."
                : selected
                  ? "تم تحديد اللاعب. اضغط زر التأكيد لاعتماد المهمة نهائيًا."
                  : kingSkipped && player.role === "king"
                    ? "تم اختيار الاحتفاظ بالوسام. اضغط اعتماد القرار."
                    : "اختر لاعبًا واحدًا ثم أكد المهمة."
            }
          </p>
        </div>
      `;
    }
    else if (room.phase === "night-role") content = `<div class="eyes-closed-screen"><div>🌙</div><h2>أبقِ عينيك مغمضتين</h2><p>الدور الحالي سري. انتظر حتى يوقظكم المدير.</p></div>`;
    else if (room.phase === "day") {
      content = `
        <div class="online-day-player-screen">
          <div class="day-awake-icon">☀️</div>
          <h2>استيقظوا جميعًا</h2>
          <p>انتهت مرحلة الليل وبدأت مرحلة النهار.</p>
          <div class="persistent-day-results">${renderOnlineNightSummary(room)}</div>
          ${renderOnlineDayTimer(room)}
          <small class="online-day-player-note">بانتظار مدير اللعبة للانتقال إلى مرحلة التصويت.</small>
        </div>`;
    }
    else if (room.phase === "voting") {
      if (!player.alive) {
        content = `<div class="eyes-closed-screen"><div>👁️</div><h2>تابع التصويت</h2><p>أنت خارج اللعبة، ويمكنك متابعة حالة التصويت من شاشة البث المباشر.</p></div>`;
      } else if (room.myVote) {
        content = `<div class="online-vote-confirmed-screen"><div>✅</div><h2>تم تسجيل تصويتك</h2><p>${room.myVote === "abstain" ? "اخترت الامتناع عن التصويت." : "تم حفظ اختيارك بصورة سرية."}</p><small>بانتظار بقية اللاعبين...</small></div>`;
      } else {
        const eligible = room.players.filter(item => item.alive && item.id !== player.id);
        const voteSelectionKey = `${code}:${playerId}`;
        const savedVoteSelection = voteSelectionUiState.get(voteSelectionKey) || null;
        content = `
          <div class="online-voting-player-screen">
            <div class="online-voting-player-heading"><span>🗳️</span><div><small>تصويت سري</small><h2>من تعتقد أنه اللص؟</h2><p>اختر لاعبًا واحدًا أو امتنع عن التصويت. لا يمكنك التصويت لنفسك.</p></div></div>
            <div class="online-vote-options">
              ${eligible.map(item => `<button type="button" class="online-vote-option ${savedVoteSelection === item.id ? "selected" : ""}" data-online-vote-target="${item.id}"><img src="${item.avatar}" alt="${item.name}"/><strong>${item.name}</strong><small>${savedVoteSelection === item.id ? "✓ تم حفظ الاختيار المبدئي" : "اختيار هذا اللاعب"}</small></button>`).join("")}
              <button type="button" class="online-vote-option abstain ${savedVoteSelection === "abstain" ? "selected" : ""}" data-online-vote-target="abstain"><span>✋</span><strong>الامتناع</strong><small>${savedVoteSelection === "abstain" ? "✓ تم حفظ الاختيار المبدئي" : "عدم اختيار أي لاعب"}</small></button>
            </div>
            <p id="onlineVoteSelectionMessage" class="night-choice-status">${savedVoteSelection ? (savedVoteSelection === "abstain" ? "تم حفظ اختيار الامتناع مبدئيًا. اضغط تأكيد التصويت." : "تم حفظ اختيار اللاعب مبدئيًا. اضغط تأكيد التصويت.") : "اختر خيارًا ثم أكد التصويت."}</p>
            <button id="confirmOnlineVote" class="online-primary-button large" type="button" ${savedVoteSelection ? "" : "disabled"}>تأكيد التصويت</button>
          </div>`;
      }
    }
    else if (room.phase === "voting-result") content = `${renderOnlineVotingResult(room)}<div class="player-wait-screen compact-result-wait"><p>بانتظار المدير لبدء الليلة التالية...</p></div>`;
    else content = `<div class="player-wait-screen"><img src="${player.avatar}" /><h2>${player.name}</h2><p>بانتظار المرحلة التالية...</p></div>`;
    app.innerHTML = pageShell(content, room.roomName);
    attachBack(onBack);
bindOnlineDayTimerTicker();
    const revealButton = document.querySelector("#revealMyRole");
    const handleReveal = event => {
      const button = revealButton;
      if (!button || button.disabled) return;
      const revealKey = `${code}:${playerId}`;
      if ((roleRevealUiState.get(revealKey) || "new") !== "new") return;

      // pointerdown يستجيب للمسة الأولى قبل أي إعادة رسم دورية قد تستبدل الزر.
      event?.preventDefault?.();
      button.disabled = true;
      const session = playerSession(code, playerId);
      roleRevealUiState.set(revealKey, "animating");
      draw();

      window.setTimeout(() => {
        roleRevealUiState.set(revealKey, "settled");
        const card = document.querySelector("#onlineRoleCard");
        card?.classList.add("card-entered", "card-flipped");
        document.querySelector("#onlineRoleDetails")?.classList.add("details-visible");
      }, 180);

      if (!session?.token) {
        console.error("Role reveal session missing", { code: normalizeRoomCode(code), playerId });
        showInfoToast("تم كشف الدور. ستتم مزامنة حالة المشاهدة بعد استعادة جلسة اللاعب.", "الدور مكشوف");
        return;
      }

      queueRoleKnownSave(code, playerId).catch(error => {
        console.error("Role reveal save failed", error);
        showInfoToast("تم كشف الدور، وسيواصل النظام تحديث حالة المشاهدة تلقائيًا عند عودة الاتصال.", "الدور مكشوف");
      });
    };
    revealButton?.addEventListener("pointerdown", handleReveal, { once: true });
    revealButton?.addEventListener("click", handleReveal, { once: true });
    document.querySelector("#hideMyRole")?.addEventListener("click", () => {
      const revealKey = `${code}:${playerId}`;
      roleRevealUiState.set(revealKey, "hidden");
      draw();
    });
    document
      .querySelectorAll("[data-target-id]")
      .forEach(button =>
        button.addEventListener("click", async () => {
          const targetId = button.dataset.targetId;
          const updated = await saveNightTarget(
            code,
            playerId,
            targetId,
          );

        }),
      );

    document
      .querySelector("#skipKingPardon")
      ?.addEventListener("click", async event => {
        const button = event.currentTarget;
        if (button?.disabled) return;
        if (button) button.disabled = true;
        try {
          await skipKingPardon(code, playerId);
          await confirmNightAction(code, playerId);
        } catch {
          if (button) button.disabled = false;
          showErrorToast("تعذر حفظ قرار عدم منح العفو. حاول مرة أخرى.", "خطأ في الاتصال");
        }
      });

    document
      .querySelector("#confirmOnlineNightAction")
      ?.addEventListener("click", async () => {
        const updated = await confirmNightAction(
          code,
          playerId,
        );

      });
    const voteSelectionKey = `${code}:${playerId}`;
    document.querySelectorAll("[data-online-vote-target]").forEach(button => {
      button.addEventListener("click", () => {
        const selectedOnlineVoteTarget = button.dataset.onlineVoteTarget || null;
        if (!selectedOnlineVoteTarget) return;

        // نحفظ الاختيار محليًا فور النقرة حتى يبقى محددًا أثناء تحديثات Socket.IO
        // وإعادة الرسم. لا يُحتسب الصوت فعليًا إلا بعد الضغط على تأكيد التصويت.
        voteSelectionUiState.set(voteSelectionKey, selectedOnlineVoteTarget);
        document.querySelectorAll("[data-online-vote-target]").forEach(item => {
          item.classList.toggle("selected", item === button);
          const small = item.querySelector("small");
          if (small) small.textContent = item === button ? "✓ تم حفظ الاختيار المبدئي" : (item.dataset.onlineVoteTarget === "abstain" ? "عدم اختيار أي لاعب" : "اختيار هذا اللاعب");
        });
        const confirmVoteButton = document.querySelector("#confirmOnlineVote");
        if (confirmVoteButton) confirmVoteButton.disabled = false;
        const message = document.querySelector("#onlineVoteSelectionMessage");
        if (message) message.textContent = selectedOnlineVoteTarget === "abstain" ? "تم حفظ اختيار الامتناع مبدئيًا. اضغط تأكيد التصويت." : "تم حفظ اختيار اللاعب مبدئيًا. اضغط تأكيد التصويت.";
      });
    });
    document.querySelector("#confirmOnlineVote")?.addEventListener("click", async event => {
      const selectedOnlineVoteTarget = voteSelectionUiState.get(voteSelectionKey) || null;
      if (!selectedOnlineVoteTarget) return;
      event.currentTarget.disabled = true;
      try {
        await playerCommand(code, playerId, "cast-vote", { targetId: selectedOnlineVoteTarget });
        voteSelectionUiState.delete(voteSelectionKey);
        showSuccessToast("تم تسجيل تصويتك بصورة سرية وحفظه داخل بيانات المباراة.", "تم التصويت");
      } catch {
        event.currentTarget.disabled = false;
        showErrorToast("تعذر حفظ التصويت. حاول مرة أخرى.", "خطأ في التصويت");
      }
    });
    const card = document.querySelector("#onlineRoleCard");
    if (card && !card.classList.contains("card-flipped")) {
      const revealKey = `${code}:${playerId}`;
      requestAnimationFrame(() => card.classList.add("card-entered"));
      window.setTimeout(() => {
        card.classList.add("card-flipped");
        document.querySelector("#onlineRoleDetails")?.classList.add("details-visible");
        roleRevealUiState.set(revealKey, "settled");
      }, 650);
    }
  };
  draw();
  startRoomViewSync({ code, mode: "player", playerId, draw, intervalMs: 700 });
}


function getLiveVisualPhase(room) {
  if (room?.phase === "eyes-closed" || room?.phase === "night-role") return "night";
  if (room?.phase === "voting" || room?.phase === "voting-result") return "voting";
  if (room?.phase === "day") return "day";
  return "lobby";
}

function renderLiveCinematicBackdrop(room) {
  const visualPhase = getLiveVisualPhase(room);
  if (visualPhase === "night") {
    return `
      <div class="live-cinematic-bg live-cinematic-bg--night" aria-hidden="true">
        <div class="live-realistic-moon"></div>
        <div class="live-night-horizon"><i></i><i></i><i></i><i></i><i></i></div>
      </div>`;
  }
  if (visualPhase === "day") {
    return `
      <div class="live-cinematic-bg live-cinematic-bg--day" aria-hidden="true">
        <div class="live-sunrise-sun"></div>
        <div class="live-day-hills"></div>
        <div class="live-day-trees"><i></i><i></i><i></i><i></i></div>
        <div class="live-rooster-silhouette">♞</div>
      </div>`;
  }
  if (visualPhase === "voting") {
    return `
      <div class="live-cinematic-bg live-cinematic-bg--voting" aria-hidden="true">
        <div class="live-voting-crowd">${Array.from({ length: 7 }, (_, index) => `<i style="--person:${index}"><b></b><span></span></i>`).join("")}</div>
        <div class="live-ballot-box"><strong>التصويت</strong><span></span></div>
      </div>`;
  }
  return `<div class="live-cinematic-bg live-cinematic-bg--lobby" aria-hidden="true"></div>`;
}

function renderLiveParticipantsRail(room) {
  const players = Array.isArray(room?.players) ? room.players : [];
  const ordered = [...players.filter(player => player.alive), ...players.filter(player => !player.alive)];
  return `
    <aside class="live-participants-rail" aria-label="حالة المتسابقين">
      <div class="live-participants-rail__heading">
        <small>الحالة المباشرة</small>
        <h3>المتسابقون</h3>
        <span>${players.filter(player => player.alive).length} أحياء</span>
      </div>
      <div class="live-participants-list">
        ${ordered.map((player, index) => `
          <article class="live-participant ${player.alive ? "is-alive" : "is-out"}" style="--player-order:${index}">
            <div class="live-participant__avatar"><img src="${player.avatar}" alt="${player.name}" /></div>
            <div class="live-participant__info">
              <strong>${player.name}</strong>
              <span>${player.roleKnown ? "✓ تمت معرفة الدور" : "⌛ لم تتم معرفة الدور"}</span>
            </div>
            <i class="live-participant__life-dot" title="${player.alive ? "داخل اللعبة" : "خرج من اللعبة"}"></i>
          </article>
        `).join("")}
      </div>
    </aside>
  `;
}


function stopOnlineDayTimerTicker() {
  if (onlineDayTimerIntervalId) {
    window.clearInterval(onlineDayTimerIntervalId);
    onlineDayTimerIntervalId = null;
  }
}

function bindOnlineDayTimerTicker({ onFinish = null } = {}) {
  stopOnlineDayTimerTicker();
  let finishNotified = false;

  const tick = () => {
    const timers = [...document.querySelectorAll(".online-day-timer[data-day-ends-at]")];
    if (!timers.length) return;

    let anyFinished = false;
    for (const timer of timers) {
      const endsAt = Number(timer.dataset.dayEndsAt || 0);
      const total = Math.max(30, Number(timer.dataset.dayTotal || 60));
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      const percentage = Math.max(0, Math.min(100, (remaining / total) * 100));
      const stateClass = remaining <= 5 ? "timer-danger" : remaining <= 15 ? "timer-warning" : "timer-normal";

      const ring = timer.querySelector(".timer-progress-ring");
      const value = timer.querySelector(".timer-content strong");
      const status = timer.querySelector(".timer-content small");
      const progress = timer.querySelector(".online-day-progress i");

      if (value) value.textContent = formatOnlineClock(remaining);
      if (status) status.textContent = remaining > 0 ? "النقاش جارٍ الآن" : "انتهى وقت النقاش";
      if (progress) progress.style.width = `${percentage}%`;
      if (ring) {
        ring.style.setProperty("--timer-progress", `${percentage}%`);
        ring.classList.remove("timer-normal", "timer-warning", "timer-danger");
        ring.classList.add(stateClass);
      }
      anyFinished ||= remaining <= 0;
    }

    if (anyFinished && !finishNotified) {
      finishNotified = true;
      onFinish?.();
    }
  };

  tick();
  onlineDayTimerIntervalId = window.setInterval(tick, 250);
}

function renderLiveNightResultOverlayContent(room) {
  const summary = room?.daySummary;
  if (!summary) return "";
  if (summary.outcome === "saved") return renderNurseRescueCard(summary);
  if (summary.outcome === "eliminated") {
    const victim = (room.players || []).find(player => player.id === summary.victimId) || null;
    return renderAssassinationScene({
      name: summary.victimName || victim?.name || "أحد اللاعبين",
      avatar: victim?.avatar || "",
    });
  }
  return `
    <section class="online-night-summary live-night-result-peace">
      <div class="online-night-summary-icon">🌅</div>
      <div><small>نتيجة الليلة ${summary.nightNumber || room.nightNumber || 1}</small><h3>مرّت الليلة دون خروج أي لاعب.</h3></div>
    </section>`;
}

function showLiveNightResultOverlay(room) {
  if (room?.phase !== "day" || !room?.daySummary) return;

  const summary = room.daySummary;
  const nightNumber = summary.nightNumber || room.nightNumber || 0;
  const nightKey = `${normalizeRoomCode(room.code)}:${Number(room.matchSequence || 0)}:${nightNumber}`;
  const startedAt = Number(room.dayStartedAt || 0);
  const now = Date.now();
  const elapsed = startedAt ? Math.max(0, now - startedAt) : 0;

  // أول 7 ثوانٍ لنتيجة الهجوم أو الإنقاذ.
  if (!liveNightOverlayShown.has(nightKey) && elapsed < 7000) {
    const remaining = Math.max(0, 7000 - elapsed);
    liveNightOverlayShown.set(nightKey, true);
    document.querySelector(".live-night-result-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "live-night-result-overlay";
    overlay.innerHTML = `<div class="live-night-result-overlay__content">${renderLiveNightResultOverlayContent(room)}</div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("is-visible"));
    window.setTimeout(() => {
      overlay.classList.remove("is-visible");
      window.setTimeout(() => overlay.remove(), 420);
    }, remaining);
  } else if (elapsed >= 7000) {
    liveNightOverlayShown.set(nightKey, true);
  }

  // إذا منح الملك عفوًا، يظهر بعد نتيجة الليل مباشرة لمدة 7 ثوانٍ أخرى.
  if (!summary.kingPardonGranted) return;

  const pardonKey = `${nightKey}:pardon`;
  if (liveNightPardonOverlayShown.has(pardonKey)) return;

  const pardonStartAt = startedAt ? startedAt + 7000 : now + 7000;
  const pardonEndAt = pardonStartAt + 7000;

  if (now >= pardonEndAt) {
    liveNightPardonOverlayShown.set(pardonKey, true);
    return;
  }

  const showPardon = () => {
    if (liveNightPardonOverlayShown.has(pardonKey)) return;
    liveNightPardonOverlayShown.set(pardonKey, true);
    document.querySelector(".live-night-result-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "live-night-result-overlay live-night-result-overlay--pardon";
    overlay.innerHTML = `<div class="live-night-result-overlay__content">${renderRoyalPardonCard(summary)}</div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("is-visible"));

    const visibleFor = Math.max(0, Math.min(7000, pardonEndAt - Date.now()));
    window.setTimeout(() => {
      overlay.classList.remove("is-visible");
      window.setTimeout(() => overlay.remove(), 420);
    }, visibleFor);
  };

  if (now >= pardonStartAt) showPardon();
  else window.setTimeout(showPardon, Math.max(0, pardonStartAt - now));
}


function stopLiveDayTimerOverlay() {
  if (liveDayTimerOverlayIntervalId) {
    window.clearInterval(liveDayTimerOverlayIntervalId);
    liveDayTimerOverlayIntervalId = null;
  }
  liveDayTimerOverlayKey = null;
  const overlay = document.querySelector(".live-day-timer-overlay");
  if (overlay) {
    overlay.classList.remove("is-visible");
    window.setTimeout(() => overlay.remove(), 320);
  }
}

function showLiveDayTimerOverlay(room) {
  if (room?.phase !== "day") {
    stopLiveDayTimerOverlay();
    return;
  }

  const summary = room.daySummary || {};
  const dayStartedAt = Number(room.dayStartedAt || 0);
  const dayEndsAt = Number(room.dayEndsAt || 0);
  if (!dayStartedAt || !dayEndsAt) return;

  // يبدأ المؤقت الكبير بعد انتهاء عروض نتيجة الليل. إذا وُجد عفو ملكي
  // ينتظر العرض الثاني كذلك، ثم يبقى حتى نهاية وقت النقاش.
  const cinematicDuration = 7000 + (summary.kingPardonGranted ? 7000 : 0);
  const timerStartAt = dayStartedAt + cinematicDuration;
  const now = Date.now();
  if (now < timerStartAt) {
    const delay = timerStartAt - now;
    window.setTimeout(() => showLiveDayTimerOverlay(readRoom(room.code) || room), delay + 20);
    return;
  }
  if (now >= dayEndsAt) {
    stopLiveDayTimerOverlay();
    return;
  }

  const key = `${normalizeRoomCode(room.code)}:${Number(room.matchSequence || 0)}:${Number(room.roundNumber || 1)}:${dayStartedAt}`;
  if (liveDayTimerOverlayKey === key && document.querySelector(".live-day-timer-overlay")) return;
  stopLiveDayTimerOverlay();
  liveDayTimerOverlayKey = key;

  const overlay = document.createElement("div");
  overlay.className = "live-day-timer-overlay";
  overlay.innerHTML = `
    <section class="live-day-timer-overlay__panel" role="timer" aria-live="polite">
      <span class="live-day-timer-overlay__label">وقت النقاش المتبقي</span>
      <strong class="live-day-timer-overlay__clock">${formatOnlineClock(Math.ceil((dayEndsAt - now) / 1000))}</strong>
      <span class="live-day-timer-overlay__status">ناقشوا الأحداث واستعدوا للتصويت</span>
    </section>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("is-visible"));

  const tick = () => {
    const currentRoom = readRoom(room.code);
    if (currentRoom && currentRoom.phase !== "day") {
      stopLiveDayTimerOverlay();
      return;
    }
    const remaining = Math.max(0, Math.ceil((dayEndsAt - Date.now()) / 1000));
    const clock = overlay.querySelector(".live-day-timer-overlay__clock");
    if (clock) clock.textContent = formatOnlineClock(remaining);
    overlay.classList.toggle("timer-warning", remaining > 5 && remaining <= 15);
    overlay.classList.toggle("timer-danger", remaining <= 5);
    if (remaining <= 0) stopLiveDayTimerOverlay();
  };

  tick();
  liveDayTimerOverlayIntervalId = window.setInterval(tick, 250);
}


function renderLiveVotingResultOverlayContent(room) {
  const result = room?.votingResult;
  if (!result || result.outcome === "pardoned") return "";
  const player = result.playerId ? (room.players || []).find(item => item.id === result.playerId) || null : null;

  if (result.outcome === "eliminated") {
    return `
      <section class="live-vote-cinematic live-vote-cinematic--eliminated" aria-label="خروج لاعب بالتصويت">
        <div class="live-vote-cinematic__icon">🗳️</div>
        ${player?.avatar ? `<div class="live-vote-cinematic__avatar"><img src="${player.avatar}" alt="${result.playerName || player.name}" /></div>` : ""}
        <small>قرار المدينة</small>
        <h2>${result.playerName || player?.name || "أحد المتسابقين"}</h2>
        <h3>خرج من اللعبة بعد التصويت</h3>
        <p>حصل على أعلى عدد من الأصوات، وتم تنفيذ قرار التصويت دون كشف دوره.</p>
      </section>`;
  }

  if (result.outcome === "tie") {
    return `
      <section class="live-vote-cinematic live-vote-cinematic--tie" aria-label="تعادل الأصوات">
        <div class="live-vote-cinematic__icon">⚖️</div>
        <small>نتيجة التصويت</small>
        <h2>تعادل في الأصوات</h2>
        <h3>لا أحد يخرج من المدينة</h3>
        <p>تساوت أعلى الأصوات بين أكثر من متسابق، لذلك تستمر المباراة دون إقصاء.</p>
      </section>`;
  }

  if (result.outcome === "abstain" || result.outcome === "no-votes") {
    return `
      <section class="live-vote-cinematic live-vote-cinematic--abstain" aria-label="لا يوجد إقصاء بالتصويت">
        <div class="live-vote-cinematic__icon">✋</div>
        <small>نتيجة التصويت</small>
        <h2>لا يوجد إقصاء</h2>
        <h3>${result.outcome === "abstain" ? "الامتناع حصل على أعلى الأصوات" : "لم تُسجّل أصوات حاسمة"}</h3>
        <p>تستمر المباراة دون خروج أي متسابق في هذه الجولة.</p>
      </section>`;
  }

  return "";
}

function showLiveVotingResultOverlay(room) {
  const result = room?.votingResult;
  if (room?.phase !== "voting-result" || !result || result.outcome === "pardoned") return;
  const resolvedAt = Number(result.resolvedAt || 0);
  const key = `${normalizeRoomCode(room.code)}:${resolvedAt || room.roundNumber || 0}:${result.outcome}:${result.playerId || "none"}`;
  if (liveVotingResultOverlayShown.has(key)) return;

  const elapsed = resolvedAt ? Math.max(0, Date.now() - resolvedAt) : 0;
  const remaining = Math.max(0, 7000 - elapsed);
  if (remaining <= 0) {
    liveVotingResultOverlayShown.set(key, true);
    return;
  }

  const content = renderLiveVotingResultOverlayContent(room);
  if (!content) return;
  liveVotingResultOverlayShown.set(key, true);
  document.querySelector(".live-voting-result-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "live-voting-result-overlay";
  overlay.innerHTML = `<div class="live-voting-result-overlay__content">${content}</div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("is-visible"));
  window.setTimeout(() => {
    overlay.classList.remove("is-visible");
    window.setTimeout(() => overlay.remove(), 420);
  }, remaining);
}

function renderLiveVotingPardonOverlayContent(room) {
  const result = room?.votingResult;
  if (!result || result.outcome !== "pardoned" || !result.playerName) return "";
  const player = (room.players || []).find(item => item.id === result.playerId) || null;
  return `
    <section class="live-voting-pardon-reveal" aria-label="العفو الملكي بعد التصويت">
      <div class="live-voting-pardon-reveal__glow"></div>
      <div class="live-voting-pardon-reveal__crest">👑</div>
      <div class="live-voting-pardon-reveal__scepter">♜</div>
      ${player?.avatar ? `<div class="live-voting-pardon-reveal__avatar"><img src="${player.avatar}" alt="${result.playerName}" /></div>` : ""}
      <small>نتيجة التصويت</small>
      <h2>${result.playerName}</h2>
      <h3>حصل على العفو الملكي</h3>
      <p>تطابق اسمه مع أعلى عدد من الأصوات، لكن وسام العفو الملكي أبقاه داخل اللعبة.</p>
    </section>`;
}

function showLiveVotingPardonOverlay(room) {
  const result = room?.votingResult;
  if (room?.phase !== "voting-result" || result?.outcome !== "pardoned" || !result?.playerName) return;

  const resolvedAt = Number(result.resolvedAt || 0);
  const key = `${normalizeRoomCode(room.code)}:${resolvedAt || room.roundNumber || room.nightNumber || 0}:${result.playerId || result.playerName}`;
  if (liveVotingPardonOverlayShown.has(key)) return;

  const elapsed = resolvedAt ? Math.max(0, Date.now() - resolvedAt) : 0;
  const remaining = Math.max(0, 7000 - elapsed);
  if (remaining <= 0) {
    liveVotingPardonOverlayShown.set(key, true);
    return;
  }

  liveVotingPardonOverlayShown.set(key, true);
  document.querySelector(".live-voting-pardon-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "live-voting-pardon-overlay";
  overlay.innerHTML = `<div class="live-voting-pardon-overlay__content">${renderLiveVotingPardonOverlayContent(room)}</div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("is-visible"));
  window.setTimeout(() => {
    overlay.classList.remove("is-visible");
    window.setTimeout(() => overlay.remove(), 420);
  }, remaining);
}


function renderLiveWinnerCinematic(room) {
  const thievesWon = room?.winner === "thieves";
  const finalRoles = Array.isArray(room?.finalRoles) ? room.finalRoles : [];
  const thieves = finalRoles.filter(player => player.role === "thief");
  const thiefNames = thieves.map(player => player.name).join("، ") || "اللصوص";

  return `
    <section class="live-final-cinematic live-final-cinematic--${thievesWon ? "thieves" : "citizens"}">
      <div class="live-final-cinematic__scene" aria-hidden="true">
        ${thievesWon
          ? `<div class="live-final-cinematic__fire"></div><div class="live-final-cinematic__city"></div>`
          : `<div class="live-final-cinematic__victory-rays"></div><div class="live-final-cinematic__podium">1</div>`}
      </div>
      <div class="live-final-cinematic__badge">${thievesWon ? "🗡️" : "🏆"}</div>
      <small>${thievesWon ? "المدينة سقطت" : "انتصار المواطنين"}</small>
      <h1>${thievesWon ? "سيطر اللصوص على المدينة" : "تم كشف جميع اللصوص"}</h1>
      <p>${thievesWon
        ? `أصبحت المدينة تحت سيطرة اللصوص: <strong>${thiefNames}</strong>`
        : "تم القبض على جميع اللصوص بنجاح، وعاد الأمان إلى المدينة."}</p>
    </section>`;
}

function renderLiveBestPlayerCinematic(room) {
  const best = room?.bestPlayer;
  if (!best?.playerName) return "";
  const player = (room.players || []).find(item => item.id === best.playerId);
  const avatar = best.avatar || player?.avatar || "";
  return `
    <section class="live-best-player-cinematic">
      <div class="live-best-player-cinematic__rays" aria-hidden="true"></div>
      <div class="live-best-player-cinematic__trophy" aria-hidden="true">🏆</div>
      <div class="live-best-player-cinematic__medal" aria-hidden="true">🥇</div>
      ${avatar ? `<div class="live-best-player-cinematic__avatar"><img src="${avatar}" alt="${best.playerName}" /></div>` : ""}
      <small>أفضل لاعب في المباراة</small>
      <h2>${best.playerName}</h2>
      <p>${best.reason || "قدم أفضل أداء في المباراة"}</p>
    </section>`;
}

function showLiveFinalSequenceOverlay(room) {
  if (!room?.winner || !room?.bestPlayer?.playerName) return;

  const resultStamp = Number(room?.votingResult?.resolvedAt || room?.dayStartedAt || room?.roundNumber || room?.nightNumber || 0);
  const key = `${normalizeRoomCode(room.code)}:${room.winner}:${resultStamp}:${room.bestPlayer.playerId || room.bestPlayer.playerName}`;
  if (liveFinalSequenceShown.has(key)) return;
  liveFinalSequenceShown.set(key, true);

  document.querySelector(".live-final-sequence-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "live-final-sequence-overlay";
  overlay.innerHTML = `<div class="live-final-sequence-overlay__content">${renderLiveWinnerCinematic(room)}</div>`;
  document.body.appendChild(overlay);

  const content = overlay.querySelector(".live-final-sequence-overlay__content");
  requestAnimationFrame(() => overlay.classList.add("is-visible"));

  window.setTimeout(() => {
    overlay.classList.remove("is-visible");
    window.setTimeout(() => {
      if (!document.body.contains(overlay)) return;
      content.innerHTML = renderLiveBestPlayerCinematic(room);
      overlay.classList.add("is-best-player");
      requestAnimationFrame(() => overlay.classList.add("is-visible"));
    }, 420);
  }, 7000);

  window.setTimeout(() => {
    overlay.classList.remove("is-visible");
    window.setTimeout(() => overlay.remove(), 420);
  }, 14420);
}

function patchStableLiveDom(target, html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  const nextRoot = template.content.firstElementChild;
  const currentRoot = target.firstElementChild;

  if (!currentRoot || !nextRoot || currentRoot.tagName !== nextRoot.tagName) {
    target.innerHTML = html;
    return;
  }

  const syncNode = (current, next) => {
    if (!current || !next) return;
    if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
      current.replaceWith(next.cloneNode(true));
      return;
    }
    if (current.nodeType === Node.TEXT_NODE) {
      if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
      return;
    }
    if (current.nodeType !== Node.ELEMENT_NODE) return;

    for (const attr of [...current.attributes]) {
      if (!next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
    }
    for (const attr of [...next.attributes]) {
      if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
    }

    const currentChildren = [...current.childNodes];
    const nextChildren = [...next.childNodes];
    const common = Math.min(currentChildren.length, nextChildren.length);
    for (let i = 0; i < common; i += 1) syncNode(currentChildren[i], nextChildren[i]);
    for (let i = currentChildren.length - 1; i >= nextChildren.length; i -= 1) currentChildren[i].remove();
    for (let i = currentChildren.length; i < nextChildren.length; i += 1) current.appendChild(nextChildren[i].cloneNode(true));
  };

  syncNode(currentRoot, nextRoot);
}

function renderLiveBreakingNewsTicker(room) {
  const phase = room?.phase || "waiting";
  const items = [
    "عاجل: فرق الشرطة تكثف دورياتها في أحياء المدينة بحثًا عن أي تحركات مشبوهة.",
    "مصادر المدينة: التحقيقات مستمرة والسلطات تطلب من المواطنين توخي الحذر وعدم الثقة بالمعلومات غير المؤكدة.",
    "غرفة العمليات: فرق البحث تجمع الأدلة وتراجع شهادات المواطنين للوصول إلى اللصوص.",
    "عاجل: الشرطة تؤكد أن القبض على اللصوص يعتمد على دقة الملاحظات وقرارات التصويت القادمة.",
    "مراسل المدينة: حالة من الترقب بين المواطنين مع استمرار التحقيقات السرية خلال الليل.",
    "السلطات: أي معلومة صغيرة قد تساعد في كشف هوية اللصوص وإنهاء حالة الخطر في المدينة.",
    "عاجل: فرق الأمن تنتشر في المداخل الرئيسية وتتابع تحركات المشتبه بهم دون الكشف عن تفاصيل التحقيق.",
    phase === "voting" ? "الآن: المواطنون يتوجهون إلى التصويت وسط ترقب لنتيجة قد تغيّر مسار القضية." : "الشرطة تدعو الجميع إلى التعاون حتى تتم استعادة الأمن بالكامل.",
  ];
  const content = items.map(text => `<span class="live-news-ticker__item"><b>عاجل</b>${text}</span>`).join("");
  return `<div class="live-news-ticker" role="marquee" aria-label="شريط أخبار المدينة"><div class="live-news-ticker__badge">أخبار المدينة</div><div class="live-news-ticker__viewport"><div class="live-news-ticker__track">${content}${content}</div></div></div>`;
}

export function openLiveRoom({ app, onBack, code }) {
  subscribeRoom(code, "public");
  const draw = () => {
    const room = readRoom(code);
    if (!room) {
      fetchRoomFromServer(code).then(foundRoom => foundRoom && draw());
      return;
    }
    const alive = room.players.filter(player => player.alive);
    const out = room.players.filter(player => !player.alive);
    const phaseText = room.phase === "eyes-closed" ? "🌙 أغمضوا أعينكم جميعًا" : room.phase === "night-role" ? "🌙 المرحلة الليلية جارية" : room.phase === "day" ? "☀️ استيقظوا جميعًا، بدأت مرحلة النهار" : room.phase === "voting" ? "🗳️ التصويت جارٍ الآن" : room.phase === "voting-result" ? "📊 ظهرت نتيجة التصويت" : room.status === "waiting" ? "بانتظار بدء المباراة" : "المباراة جارية";
    const visualPhase = getLiveVisualPhase(room);
    const liveMarkup = pageShell(`
      <div class="live-dashboard live-dashboard--${visualPhase}">
        ${renderLiveCinematicBackdrop(room)}
        ${renderLiveBreakingNewsTicker(room)}
        <div class="live-broadcast-layout">
          ${renderLiveParticipantsRail(room)}
          <main class="live-broadcast-main">
            <section class="live-hero"><span class="live-status"><i></i>بث مباشر</span><h2>${room.roomName}</h2><p>${phaseText}</p></section>
            ${room.phase === "day" ? `<div class="persistent-day-results persistent-day-results--live">${renderOnlineNightSummary(room)}</div>${renderOnlineDayTimer(room)}` : ""}
            ${room.phase === "voting" ? renderOnlineVotingStatus(room) : ""}
            ${room.phase === "voting-result" ? renderOnlineVotingResult(room) : ""}
            ${room.winner ? `${renderOnlineWinnerFinal(room, { live: true })}${renderOnlineBestPlayer(room, { live: true })}${renderLiveFinalRoles(room)}` : ""}
            <section class="live-player-section live-events-panel live-chat-panel"><div class="live-chat-panel-heading"><span>💬</span><div><h3>محادثة المدينة</h3><p>رسائل مباشرة من أصحاب الأدوار والمواطنين</p></div></div>${renderLiveRoleChat(room, 12)}</section>
          </main>
        </div>
      </div>`, "مركز المباراة المباشر");
    patchStableLiveDom(app, liveMarkup);
    attachBack(onBack);
    bindOnlineDayTimerTicker();
    showLiveNightResultOverlay(room);
    showLiveDayTimerOverlay(room);
    showLiveVotingResultOverlay(room);
    showLiveVotingPardonOverlay(room);
    showLiveFinalSequenceOverlay(room);
  };
  draw();
  startRoomViewSync({ code, mode: "public", draw, intervalMs: 450 });
}

export function restoreOnlineRoute({ app, onBack }) {
  const params = new URLSearchParams(location.search);
  const liveCode = normalizeRoomCode(params.get("live"));
  const hostCode = normalizeRoomCode(params.get("host"));
  const roomCodeFromUrl = normalizeRoomCode(params.get("room"));
  const playerId = params.get("player");

  if (liveCode) {
    openLiveRoom({ app, onBack, code: liveCode });
    return true;
  }

  if (hostCode) {
    renderHostLobby({ app, onBack, code: hostCode });
    return true;
  }

  if (roomCodeFromUrl && playerId) {
    renderPlayerRoom({
      app,
      onBack,
      code: roomCodeFromUrl,
      playerId,
    });
    return true;
  }

  if (roomCodeFromUrl && params.get("join") === "1") {
    renderJoinRoom({ app, onBack, code: roomCodeFromUrl });
    return true;
  }

  return false;
}
