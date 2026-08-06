import { showSuccessToast, showErrorToast, showInfoToast } from "../ui/toast.js";
import { getRoleCardImage } from "../ui/roleCards.js";

const STORAGE_KEY = "mafia_online_rooms_v1";
const PLAYER_SESSION_KEY = "mafia_online_player_session_v1";
const CHANNEL_NAME = "mafia-online-sync";
const channel = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL_NAME) : null;
let hostRoleRevealIntervalId = null;
let serverSyncReady = false;
let serverSaveTimer = null;

function applyServerRooms(rooms) {
  const safeRooms = rooms && typeof rooms === "object" ? rooms : {};
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safeRooms));
  serverSyncReady = true;
  channel?.postMessage({ type: "rooms-updated" });
  window.dispatchEvent(new CustomEvent("mafia-rooms-updated"));
}

async function fetchServerRooms() {
  try {
    const response = await fetch("/api/rooms", { cache: "no-store" });
    if (!response.ok) throw new Error("ROOMS_FETCH_FAILED");
    applyServerRooms(await response.json());
  } catch {
    serverSyncReady = false;
  }
}

function pushRoomsToServer(rooms) {
  clearTimeout(serverSaveTimer);
  serverSaveTimer = setTimeout(async () => {
    try {
      const response = await fetch("/api/rooms", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rooms),
      });
      if (!response.ok) throw new Error("ROOMS_SAVE_FAILED");
      serverSyncReady = true;
    } catch {
      serverSyncReady = false;
    }
  }, 40);
}

function connectServerEvents() {
  if (!("EventSource" in window)) return;
  const events = new EventSource("/api/events");
  events.addEventListener("rooms", event => {
    try {
      applyServerRooms(JSON.parse(event.data));
    } catch {
      // تجاهل أي رسالة غير مكتملة ثم انتظار الرسالة التالية.
    }
  });
  events.onerror = () => {
    serverSyncReady = false;
  };
}

fetchServerRooms();
connectServerEvents();

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
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function saveRooms(rooms) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
  pushRoomsToServer(rooms);
  channel?.postMessage({ type: "rooms-updated" });
  window.dispatchEvent(new CustomEvent("mafia-rooms-updated"));
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
  document.querySelector("#onlineBackButton")?.addEventListener("click", onBack);
}

export function openOnlinePortal({ app, onBack }) {
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
    <div class="online-notice">الغرف متصلة بالخادم وتعمل لحظيًا بين الأجهزة عبر الإنترنت.</div>
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
        <button class="online-primary-button" type="submit">إنشاء الغرفة الخاصة</button>
      </form>
    </div>
  `, "إنشاء غرفة");
  attachBack(() => openOnlinePortal({ app, onBack }));
  document.querySelector("#createRoomForm")?.addEventListener("submit", event => {
    event.preventDefault();
    const hostName = document.querySelector("#hostNameInput").value.trim();
    const roomName = document.querySelector("#roomNameInput").value.trim();
    const maxPlayers = Number(document.querySelector("#maxPlayersInput").value);
    if (!hostName || !roomName) return showErrorToast("أكمل اسم المدير واسم الغرفة.", "بيانات ناقصة");
    const room = createRoomRecord(hostName, roomName, maxPlayers);
    history.replaceState({}, "", `?host=${room.code}`);
    showSuccessToast("تم إنشاء الغرفة بنجاح.", "الغرفة جاهزة");
    renderHostLobby({ app, onBack, code: room.code });
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
  document.querySelector("#joinCodeForm")?.addEventListener("submit", event => {
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

    const room = readRoom(code);

    if (!room) {
      return showErrorToast(
        "لم يتم العثور على الغرفة على هذا الجهاز. تأكد من الرمز ومن أن الغرفة ما زالت مفتوحة.",
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
  const room = readRoom(code);
  if (!room) {
    app.innerHTML = pageShell(`<div class="online-empty"><div>⚠️</div><h2>الغرفة غير موجودة</h2><p>قد يكون الرابط منتهيًا أو تم إغلاق الغرفة.</p><button id="returnPortal" class="online-primary-button">العودة</button></div>`);
    attachBack(onBack);
    document.querySelector("#returnPortal")?.addEventListener("click", () => openOnlinePortal({ app, onBack }));
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
  document.querySelector("#playerJoinForm")?.addEventListener("submit", event => {
    event.preventDefault();
    const current = readRoom(code);
    if (!current || current.status !== "waiting") return showErrorToast("الغرفة مغلقة الآن.", "تعذر الانضمام");
    if (current.players.length >= current.maxPlayers) return showErrorToast("اكتمل عدد اللاعبين.", "الغرفة ممتلئة");
    const name = document.querySelector("#playerNameInput").value.trim();
    if (current.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return showErrorToast("هذا الاسم مستخدم داخل الغرفة.", "اختر اسمًا آخر");
    const player = { id: uid("player"), name, gender: document.querySelector('input[name="gender"]:checked').value, avatar: document.querySelector("#selectedAvatar").value, online: true, alive: true, role: null, roleKnown: false, joinedAt: Date.now() };
    updateRoom(code, r => { r.players.push(player); return r; });
    localStorage.setItem(PLAYER_SESSION_KEY, JSON.stringify({ code, playerId: player.id }));
    history.replaceState({}, "", `?room=${code}&player=${player.id}`);
    renderPlayerRoom({ app, onBack, code, playerId: player.id });
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

function renderHostLobby({ app, onBack, code }) {
  const draw = () => {
    const room = readRoom(code);
    if (!room) return openOnlinePortal({ app, onBack });
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
            ${room.status === "playing" && room.phase === "eyes-closed" ? `
              <div class="role-control-grid">
                ${["thief","nurse","king","investigator"].map(role => `<button class="role-wake-button" data-role="${role}">${({thief:"🗡️ استيقاظ اللصوص",nurse:"🏥 استيقاظ الممرضة",king:"👑 استيقاظ الملك",investigator:"🕵️ استيقاظ المحقق"})[role]}</button>`).join("")}
              </div>
            ` : ""}
            ${room.status === "playing" && room.phase === "night-role" ? `
              <div class="role-control-grid">
                ${["thief","nurse","king","investigator"].map(role => `<button class="role-wake-button ${room.activeRole === role ? "active" : ""}" data-role="${role}">${({thief:"🗡️ استيقاظ اللصوص",nurse:"🏥 استيقاظ الممرضة",king:"👑 استيقاظ الملك",investigator:"🕵️ استيقاظ المحقق"})[role]}</button>`).join("")}
              </div>
            ` : ""}
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
    document.querySelectorAll("[data-remove-player]").forEach(btn => btn.addEventListener("click", () => updateRoom(code, r => { r.players = r.players.filter(p => p.id !== btn.dataset.removePlayer); return r; })));
    document.querySelector("#startOnlineGame")?.addEventListener("click", () => {
      updateRoom(code, r => {
        const roles = distributeRoles(r.players.length);
        r.players = shuffle(r.players).map((p, i) => ({ ...p, role: roles[i], roleKnown: false, royalPardonsRemaining: roles[i] === "king" ? 3 : 0 }));
        r.status = "playing";
        r.phase = "role-reveal";
        r.activeRole = null;
        r.roleRevealStartedAt = Date.now();
        r.roleRevealEndsAt = Date.now() + 30000;
        return r;
      });
      showSuccessToast("تم توزيع الأدوار وإرسالها للاعبين.", "بدأت المباراة");
    });
    document.querySelector("#openLiveView")?.addEventListener("click", () => window.open(`${location.pathname}?live=${code}`, "_blank"));

    bindHostRoleRevealCountdown(code, room);

    document.querySelector("#skipRoleRevealWait")?.addEventListener("click", () => {
      updateRoom(code, r => {
        r.roleRevealEndsAt = Date.now();
        return r;
      });
    });

    document.querySelector("#nightModeButton")?.addEventListener("click", () => updateRoom(code, r => {
      if (getRoleRevealRemainingSeconds(r) > 0) return r;
      r.phase = "eyes-closed";
      r.activeRole = null;
      r.nightNumber = (r.nightNumber || 0) + 1;
      r.nightActions = {
        thiefVotes: {},
        nurseTargetId: null,
        kingTargetId: null,
        kingSkipped: false,
        kingPardonFinalized: false,
        investigatorTargetId: null,
        confirmedActors: {},
      };
      return r;
    }));
    document.querySelectorAll("[data-role]").forEach(btn => btn.addEventListener("click", () => updateRoom(code, r => {
      finalizeActiveNightRole(r);
      r.phase = "night-role";
      r.activeRole = btn.dataset.role;
      return r;
    })));
  };
  draw();
  const refresh = () => draw();
  channel?.addEventListener("message", refresh, { once: true });
  window.addEventListener("mafia-rooms-updated", refresh, { once: true });
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

function onlineRoleCard(player) {
  const image = getRoleCardImage(player.role, player.gender || "male");
  if (!image) return "";
  return `
    <section class="online-role-reveal-wrap">
      <p class="role-card-secret-label">دورك السري</p>
      <h2 class="role-card-player-name">${player.name}</h2>
      <div class="role-card-stage">
        <div class="role-playing-card" id="onlineRoleCard">
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
      <div class="role-card-details" id="onlineRoleDetails">
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

function saveNightTarget(code, playerId, targetId) {
  return updateRoom(code, room => {
    const player = room.players.find(
      item => item.id === playerId,
    );

    const target = room.players.find(
      item => item.id === targetId,
    );

    if (
      !player ||
      !target ||
      room.phase !== "night-role" ||
      room.activeRole !== player.role ||
      isNightActionConfirmed(room, playerId)
    ) {
      return room;
    }

    const valid = allowedTargets(room, player).some(
      item => item.id === targetId,
    );

    if (!valid) return room;

    room.nightActions ||= {
      thiefVotes: {},
      nurseTargetId: null,
      kingTargetId: null,
      kingSkipped: false,
      kingPardonFinalized: false,
      investigatorTargetId: null,
      confirmedActors: {},
    };

    room.nightActions.confirmedActors ||= {};

    if (player.role === "thief") {
      room.nightActions.thiefVotes[player.id] = targetId;
    }

    if (player.role === "nurse") {
      room.nightActions.nurseTargetId = targetId;
    }

    if (player.role === "king") {
      room.nightActions.kingTargetId = targetId;
      room.nightActions.kingSkipped = false;
    }

    if (player.role === "investigator") {
      room.nightActions.investigatorTargetId = targetId;
    }

    return room;
  });
}

function confirmNightAction(code, playerId) {
  return updateRoom(code, room => {
    const player = room.players.find(
      item => item.id === playerId,
    );

    if (
      !player ||
      room.phase !== "night-role" ||
      room.activeRole !== player.role ||
      isNightActionConfirmed(room, playerId)
    ) {
      return room;
    }

    room.nightActions ||= {};
    room.nightActions.confirmedActors ||= {};

    const selected = selectedTargetId(room, player);
    const kingSkipped = Boolean(
      room.nightActions.kingSkipped,
    );

    if (player.role === "king") {
      if (!selected && !kingSkipped) return room;

      if (selected) {
        const remaining = Number(
          player.royalPardonsRemaining || 0,
        );

        if (remaining <= 0) return room;

        player.royalPardonsRemaining = Math.max(
          0,
          remaining - 1,
        );

        room.nightActions.kingPardonFinalized = true;
      }
    } else if (!selected) {
      return room;
    }

    room.nightActions.confirmedActors[playerId] = {
      role: player.role,
      targetId: selected,
      skipped: player.role === "king" && kingSkipped,
      confirmedAt: new Date().toISOString(),
    };

    return room;
  });
}

function skipKingPardon(code, playerId) {
  return updateRoom(code, room => {
    const player = room.players.find(
      item => item.id === playerId,
    );

    if (
      !player ||
      player.role !== "king" ||
      room.activeRole !== "king" ||
      room.phase !== "night-role" ||
      isNightActionConfirmed(room, playerId)
    ) {
      return room;
    }

    room.nightActions ||= {};
    room.nightActions.kingTargetId = null;
    room.nightActions.kingSkipped = true;

    return room;
  });
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
  const draw = () => {
    const room = readRoom(code); const player = room?.players.find(p => p.id === playerId);
    if (!room || !player) return renderJoinRoom({ app, onBack, code });
    let content = "";
    if (room.status === "waiting") content = `<div class="player-wait-screen"><img src="${player.avatar}" alt="${player.name}" /><span class="live-status"><i></i>متصل بالغرفة</span><h2>أهلًا ${player.name}</h2><p>تم تسجيلك في غرفة <strong>${room.roomName}</strong></p><div class="waiting-pulse"><b></b><b></b><b></b></div><small>بانتظار مدير اللعبة لبدء المباراة...</small></div>`;
    else if (room.phase === "role-reveal" && !player.roleKnown) content = `
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
    else if (room.phase === "role-reveal") content = onlineRoleCard(player);
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
          ? getInvestigationResult(selectedPlayer)
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
    else content = `<div class="player-wait-screen"><img src="${player.avatar}" /><h2>${player.name}</h2><p>بانتظار المرحلة التالية...</p></div>`;
    app.innerHTML = pageShell(content, room.roomName);
    attachBack(onBack);
    document.querySelector("#revealMyRole")?.addEventListener("click", () => updateRoom(code, r => { const p=r.players.find(x=>x.id===playerId); if(p) p.roleKnown=true; return r; }));
    document.querySelector("#hideMyRole")?.addEventListener("click", () => { app.innerHTML = pageShell(`<div class="role-hidden-confirmation"><div>✅</div><h2>تمت معرفة الدور</h2><p>بانتظار بقية اللاعبين ومدير اللعبة.</p></div>`, room.roomName); attachBack(onBack); });
    document
      .querySelectorAll("[data-target-id]")
      .forEach(button =>
        button.addEventListener("click", () => {
          const targetId = button.dataset.targetId;
          const updated = saveNightTarget(
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
      ?.addEventListener("click", () => {
        skipKingPardon(code, playerId);

        showInfoToast(
          "تم اختيار الاحتفاظ بوسام العفو. اضغط اعتماد القرار.",
          "قرار مبدئي",
        );
      });

    document
      .querySelector("#confirmOnlineNightAction")
      ?.addEventListener("click", () => {
        const updated = confirmNightAction(
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
    const card = document.querySelector("#onlineRoleCard");
    if (card) {
      requestAnimationFrame(() => card.classList.add("card-entered"));
      setTimeout(() => { card.classList.add("card-flipped"); document.querySelector("#onlineRoleDetails")?.classList.add("details-visible"); }, 650);
    }
  };
  draw();
  const refresh = () => draw();
  channel?.addEventListener("message", refresh, { once: true });
  window.addEventListener("mafia-rooms-updated", refresh, { once: true });
}

export function openLiveRoom({ app, onBack, code }) {
  const draw = () => {
    const room = readRoom(code);
    if (!room) return;
    const alive = room.players.filter(p=>p.alive); const out = room.players.filter(p=>!p.alive);
    app.innerHTML = pageShell(`<div class="live-dashboard"><section class="live-hero"><span class="live-status"><i></i>بث مباشر</span><h2>${room.roomName}</h2><p>${room.phase === "eyes-closed" ? "🌙 أغمضوا أعينكم جميعًا" : room.phase === "night-role" ? "🌙 المرحلة الليلية جارية" : room.status === "waiting" ? "بانتظار بدء المباراة" : "المباراة جارية"}</p></section><div class="live-stats"><div><strong>${alive.length}</strong><span>داخل اللعبة</span></div><div><strong>${out.length}</strong><span>خرجوا</span></div><div><strong>${room.players.filter(p=>p.roleKnown).length}</strong><span>عرفوا أدوارهم</span></div></div><section class="live-player-section"><h3>المتسابقون</h3><div class="live-player-grid">${alive.map(p=>playerCard(p)).join("")}</div></section>${out.length?`<section class="live-player-section eliminated-section"><h3>اللاعبون الخارجون</h3><div class="live-player-grid">${out.map(p=>playerCard(p)).join("")}</div></section>`:""}</div>`, "مركز المباراة المباشر");
    attachBack(onBack);
  };
  draw();
  const refresh=()=>draw(); channel?.addEventListener("message", refresh, {once:true}); window.addEventListener("mafia-rooms-updated", refresh, {once:true});
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
