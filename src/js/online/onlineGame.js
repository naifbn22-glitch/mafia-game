import { io } from "socket.io-client";
import { showSuccessToast, showErrorToast, showInfoToast } from "../ui/toast.js";
import { getRoleCardImage } from "../ui/roleCards.js";

const STORAGE_KEY = "mafia_online_rooms_v2";
const PLAYER_SESSION_KEY = "mafia_online_player_session_v2";
const HOST_SESSION_KEY = "mafia_online_host_session_v2";
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

async function fetchRoomFromServer(code, mode = "public", playerId = null) {
  const normalizedCode = normalizeRoomCode(code);
  if (!normalizedCode) return null;

  const token =
    mode === "host"
      ? hostSession(normalizedCode)?.token
      : mode === "player"
        ? playerSession(normalizedCode, playerId)?.token
        : undefined;

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
    try {
      const response = await emitAck("room:lookup", { code: normalizedCode });
      cacheServerRoom(response.room);
      return response.room;
    } catch {
      return null;
    }
  }
}

async function createRoomOnServer(hostName, roomName, maxPlayers, discussionDurationSeconds) {
  const response = await emitAck("room:create", { hostName, roomName, maxPlayers, discussionDurationSeconds });
  localStorage.setItem(HOST_SESSION_KEY, JSON.stringify({ code: response.room.code, token: response.hostToken }));
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

function stopRoomViewSync(syncKey = null) {
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
      ? room.players.map(player => `${player.id}:${player.name}:${player.avatar || ""}:${player.online !== false ? 1 : 0}`).join("|")
      : "";
    return [
      room.code,
      room.version || 0,
      room.updatedAt || 0,
      room.status || "",
      room.phase || "",
      room.activeRole || "",
      players,
    ].join("::");
  };

  const redrawIfNeeded = (room = null, force = false) => {
    if (disposed) return;
    const currentRoom = room || readRoom(normalizedCode);
    if (!currentRoom) return;

    const signature = roomSignature(currentRoom);
    if (!force && signature === lastDrawSignature) return;
    lastDrawSignature = signature;
    draw();
  };

  const onRoomsUpdated = event => {
    const eventRoom = event?.detail?.room;
    if (eventRoom?.code && normalizeRoomCode(eventRoom.code) !== normalizedCode) return;
    redrawIfNeeded(eventRoom || null);
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
        // نتيجة الخادم هي المرجع النهائي. نجبر الرسم بعد كل مزامنة ناجحة،
        // بدون إعادة تحميل الصفحة أو تغيير مسار الغرفة.
        if (room) redrawIfNeeded(room, true);
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

  // ابدأ الاشتراك والجلب فورًا، ثم استمر بتحديث خلفي ثابت حتى لو ضاع حدث WebSocket.
  subscribeRoom(normalizedCode, mode, playerId);
  timerId = window.setTimeout(poll, 120);

  const stop = () => {
    disposed = true;
    if (timerId) window.clearTimeout(timerId);
    window.removeEventListener("mafia-rooms-updated", onRoomsUpdated);
    window.removeEventListener("mafia-server-connected", onConnected);
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
  if (room.status !== "waiting") {
    showInfoToast("المباراة بدأت بالفعل ولا يمكن إضافة لاعب جديد.", "الغرفة مغلقة");
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
        <button class="online-primary-button" type="submit" ${room.status !== "waiting" ? "disabled" : ""}>الانضمام إلى الغرفة</button>
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
    if (!current || current.status !== "waiting") return showErrorToast("الغرفة مغلقة الآن.", "تعذر الانضمام");
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
    <section class="online-day-timer ${compact ? "is-compact" : ""}">
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

function renderOnlineNightSummary(room) {
  const summary = room?.daySummary;
  if (!summary) return "";
  let main = "مرّت الليلة دون خروج أي لاعب.";
  let icon = "🌅";
  if (summary.outcome === "saved") {
    icon = "🛡️";
    main = `نجحت الممرضة في حماية ${summary.victimName || "هدف اللصوص"}، ولم يخرج أحد هذه الليلة.`;
  } else if (summary.outcome === "eliminated") {
    const victim = (room.players || []).find(player => player.id === summary.victimId) || null;
    return `
      ${renderAssassinationScene({
        name: summary.victimName || victim?.name || "أحد اللاعبين",
        avatar: victim?.avatar || "",
      })}
      <section class="online-night-summary online-night-summary--after-assassination">
        <div class="online-night-summary-icon">🕯️</div>
        <div>
          <small>نتيجة الليلة ${summary.nightNumber || room.nightNumber || 1}</small>
          <h3>خرج ${summary.victimName || victim?.name || "أحد اللاعبين"} من اللعبة خلال الليل، دون كشف دوره.</h3>
          <p>${summary.kingPardonGranted ? "👑 تم منح وسام عفو ملكي لأحد اللاعبين لهذه الجولة." : "👑 لم يتم منح وسام عفو ملكي في هذه الجولة."}</p>
          ${summary.investigatorCompleted ? "<p>🕵️ أكمل المحقق تحقيقه بسرية.</p>" : ""}
        </div>
      </section>
    `;
  }
  return `
    <section class="online-night-summary">
      <div class="online-night-summary-icon">${icon}</div>
      <div>
        <small>نتيجة الليلة ${summary.nightNumber || room.nightNumber || 1}</small>
        <h3>${main}</h3>
        <p>${summary.kingPardonGranted ? "👑 تم منح وسام عفو ملكي لأحد اللاعبين لهذه الجولة." : "👑 لم يتم منح وسام عفو ملكي في هذه الجولة."}</p>
        ${summary.investigatorCompleted ? "<p>🕵️ أكمل المحقق تحقيقه بسرية.</p>" : ""}
      </div>
    </section>
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
    title = `${result.playerName} حصل على عفو ملكي`;
    description = `حصل على أعلى عدد من الأصوات (${result.highestVotes})، لكن وسام العفو الملكي أبقاه في اللعبة.`;
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
        return `<button class="role-wake-button ${room.activeRole === role ? "active" : ""} ${room.completedSteps?.includes(`wake-${role}`) ? "is-completed" : ""}" data-role="${role}" ${roleButtonsLocked || absent ? "disabled" : ""}>${labels[role]}${absent ? " · غير موجود" : ""}</button>`;
      }).join("")}
    </div>
    <button id="finishOnlineNight" class="online-primary-button large finish-night-button ${room.nightReady ? "is-ready" : "is-locked"}" type="button" ${room.nightReady ? "" : "disabled"}>
      ☀️ الانتقال إلى مرحلة النهار
    </button>
    <small class="finish-night-hint">${room.nightReady ? "اكتملت جميع مهام الليل. الزر جاهز للانتقال." : "يتفعّل تلقائيًا بعد تأكيد جميع أصحاب الأدوار الليلية لاختياراتهم."}</small>
  `;
}

function renderHostLobby({ app, onBack, code }) {
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
    app.innerHTML = pageShell(`
      <div class="host-dashboard">
        <section class="host-room-hero"><div><span class="live-status"><i></i>${room.status === "waiting" ? "الغرفة مفتوحة" : "المباراة جارية"}</span><h2>${room.roomName}</h2><p>مدير اللعبة: ${room.hostName}</p></div><div class="host-room-code"><small>رمز الغرفة</small><strong>${room.code}</strong></div></section>
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
            <button id="openLiveView" class="online-secondary-button">📡 شاشة البث المباشر</button>
            ${room.status === "playing" && room.phase === "role-reveal" ? renderHostRoleRevealCountdown(room) : ""}
            ${renderHostNightControls(room)}
            ${room.status === "playing" && room.phase === "day" ? `
              <div class="day-stage-banner">
                <strong>☀️ مرحلة النهار</strong>
                <span>استيقظوا جميعًا، انتهت مهام الليل.</span>
              </div>
              ${renderOnlineNightSummary(room)}
              ${renderOnlineDayTimer(room, { compact: true })}
              ${room.dayTimerFinished ? `
                <button id="startOnlineVoting" class="online-primary-button large start-voting-button" type="button">🗳️ الانتقال إلى التصويت</button>
              ` : `<small class="finish-night-hint">سيظهر زر الانتقال إلى التصويت تلقائيًا عند انتهاء المؤقت.</small>`}
            ` : ""}
            ${room.status === "playing" && room.phase === "voting" ? `${renderOnlineVotingStatus(room)}` : ""}
            ${room.status === "playing" && room.phase === "voting-result" ? `
              ${renderOnlineVotingResult(room)}
              ${room.winner ? `<div class="online-winner-banner">🏆 ${room.winner === "citizens" ? "فاز المواطنون" : "فاز اللصوص"}</div>` : `<button id="startNextOnlineNight" class="online-primary-button large" type="button">🌙 بدء الليلة التالية</button>`}
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
    document.querySelector("#openLiveView")?.addEventListener("click", () => window.open(`${location.pathname}?live=${code}`, "_blank"));

    bindHostRoleRevealCountdown(code, room);

    document.querySelector("#skipRoleRevealWait")?.addEventListener("click", async () => {
      try { await hostCommand(code, "skip-role-reveal"); } catch { showErrorToast("تعذر تخطي الانتظار.", "خطأ"); }
    });

    document.querySelector("#nightModeButton")?.addEventListener("click", async () => {
      try { await hostCommand(code, "eyes-closed"); } catch { showErrorToast("تعذر بدء مرحلة الليل.", "خطأ"); }
    });
    document.querySelectorAll("[data-role]").forEach(btn => btn.addEventListener("click", async () => {
      try { await hostCommand(code, "wake-role", { role: btn.dataset.role }); } catch { showErrorToast("تعذر إيقاظ الدور.", "خطأ"); }
    }));
    document.querySelector("#finishOnlineNight")?.addEventListener("click", async () => {
      try {
        await hostCommand(code, "finish-night");
        showSuccessToast("اكتملت مهام الليل وبدأت مرحلة النهار.", "☀️ استيقظوا جميعًا");
      } catch {
        showErrorToast("لا يمكن الانتقال للنهار قبل اكتمال جميع مهام الليل.", "المهام غير مكتملة");
      }
    });
    document.querySelector("#startOnlineVoting")?.addEventListener("click", async () => {
      try {
        await hostCommand(code, "start-voting");
        showSuccessToast("بدأ التصويت السري لجميع اللاعبين الأحياء.", "🗳️ بدأ التصويت");
      } catch {
        showErrorToast("لا يمكن بدء التصويت قبل انتهاء مؤقت النهار.", "المؤقت ما زال يعمل");
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
              <img class="role-card-front-image" src="${image}" alt="بطاقة ${ROLE_LABELS[player.role]}" />
              <span class="role-card-shine"></span>
            </div>
          </div>
        </div>
      </div>
      <div class="role-card-details${settled ? " details-visible" : ""}" id="onlineRoleDetails">
        <h2>${ROLE_LABELS[player.role]}</h2>
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
  subscribeRoom(code, "player", playerId);
  const draw = () => {
    const room = readRoom(code); const player = room?.players.find(p => p.id === playerId);
    if (!room || !player) return renderJoinRoom({ app, onBack, code });
    const revealKey = `${code}:${playerId}`;
    const revealUiState = roleRevealUiState.get(revealKey) || "new";
    const revealStartedLocally = revealUiState === "animating" || revealUiState === "settled";
    let content = "";
    if (room.status === "waiting") content = `<div class="player-wait-screen"><img src="${player.avatar}" alt="${player.name}" /><span class="live-status"><i></i>متصل بالغرفة</span><h2>أهلًا ${player.name}</h2><p>تم تسجيلك في غرفة <strong>${room.roomName}</strong></p><div class="waiting-pulse"><b></b><b></b><b></b></div><small>بانتظار مدير اللعبة لبدء المباراة...</small></div>`;
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
          <div class="role-symbol">
            ${ROLE_ICONS[player.role]}
          </div>

          <h2>
            استيقظ يا ${ROLE_LABELS[player.role]}
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
    else if (room.phase === "day") content = `
      <div class="online-day-player-screen">
        <div class="day-awake-icon">☀️</div>
        <h2>استيقظوا جميعًا</h2>
        <p>انتهت مرحلة الليل وبدأت مرحلة النهار.</p>
        ${renderOnlineNightSummary(room)}
        ${renderOnlineDayTimer(room)}
        <small class="online-day-player-note">عند انتهاء الوقت سيبدأ المدير مرحلة التصويت.</small>
      </div>`;
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
    else if (room.phase === "voting-result") content = `${renderOnlineVotingResult(room)}${room.winner ? `<div class="online-player-winner">🏆 ${room.winner === "citizens" ? "فاز المواطنون" : "فاز اللصوص"}</div>` : `<div class="player-wait-screen compact-result-wait"><p>بانتظار المدير لبدء الليلة التالية...</p></div>`}`;
    else content = `<div class="player-wait-screen"><img src="${player.avatar}" /><h2>${player.name}</h2><p>بانتظار المرحلة التالية...</p></div>`;
    app.innerHTML = pageShell(content, room.roomName);
    attachBack(onBack);
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

          if (updated) {
            showInfoToast(
              "تم تحديد اللاعب. اضغط زر التأكيد لاعتماد المهمة.",
              "اختيار مبدئي",
            );
          }
        }),
      );

    document
      .querySelector("#skipKingPardon")
      ?.addEventListener("click", async () => {
        await skipKingPardon(code, playerId);

        showInfoToast(
          "تم اختيار الاحتفاظ بوسام العفو. اضغط اعتماد القرار.",
          "قرار مبدئي",
        );
      });

    document
      .querySelector("#confirmOnlineNightAction")
      ?.addEventListener("click", async () => {
        const updated = await confirmNightAction(
          code,
          playerId,
        );

        if (updated) {
          showSuccessToast(
            player.role === "investigator"
              ? "تم تأكيد التحقيق وحفظ اللاعب والنتيجة داخل اللعبة."
              : "تم تأكيد الاختيار وحفظه داخل اللعبة.",
            "اكتملت المهمة",
          );
        }
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

export function openLiveRoom({ app, onBack, code }) {
  subscribeRoom(code, "public");
  const draw = () => {
    const room = readRoom(code);
    if (!room) {
      fetchRoomFromServer(code).then(foundRoom => foundRoom && draw());
      return;
    }
    const alive = room.players.filter(p=>p.alive); const out = room.players.filter(p=>!p.alive);
    const phaseText = room.phase === "eyes-closed" ? "🌙 أغمضوا أعينكم جميعًا" : room.phase === "night-role" ? "🌙 المرحلة الليلية جارية" : room.phase === "day" ? "☀️ استيقظوا جميعًا، بدأت مرحلة النهار" : room.phase === "voting" ? "🗳️ التصويت جارٍ الآن" : room.phase === "voting-result" ? "📊 ظهرت نتيجة التصويت" : room.status === "waiting" ? "بانتظار بدء المباراة" : "المباراة جارية";
    app.innerHTML = pageShell(`
      <div class="live-dashboard">
        <section class="live-hero"><span class="live-status"><i></i>بث مباشر</span><h2>${room.roomName}</h2><p>${phaseText}</p></section>
        <div class="live-stats"><div><strong>${alive.length}</strong><span>داخل اللعبة</span></div><div><strong>${out.length}</strong><span>خرجوا</span></div><div><strong>${room.players.filter(p=>p.roleKnown).length}</strong><span>عرفوا أدوارهم</span></div></div>
        ${room.phase === "day" ? `${renderOnlineNightSummary(room)}${renderOnlineDayTimer(room)}` : ""}
        ${room.phase === "voting" ? renderOnlineVotingStatus(room) : ""}
        ${room.phase === "voting-result" ? renderOnlineVotingResult(room) : ""}
        ${room.winner ? `<div class="online-winner-banner live-winner">🏆 ${room.winner === "citizens" ? "فاز المواطنون" : "فاز اللصوص"}</div>` : ""}
        <section class="live-player-section"><h3>المتسابقون</h3><div class="live-player-grid">${alive.map(p=>playerCard(p)).join("")}</div></section>
        ${out.length?`<section class="live-player-section eliminated-section"><h3>اللاعبون الخارجون</h3><div class="live-player-grid">${out.map(p=>playerCard(p)).join("")}</div></section>`:""}
        <section class="live-player-section"><h3>الأحداث المباشرة</h3>${renderOnlineTimeline(room, 12)}</section>
      </div>`, "مركز المباراة المباشر");
    attachBack(onBack);
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
