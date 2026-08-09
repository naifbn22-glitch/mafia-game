import crypto from "node:crypto";

const ROLES = ["thief", "nurse", "king", "investigator", "citizen"];

export function normalizeRoomCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function randomId(prefix = "id") {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) code += alphabet[crypto.randomInt(0, alphabet.length)];
  return code;
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function distributeRoles(count) {
  const thiefCount = count <= 6 ? 1 : count <= 10 ? 2 : Math.max(3, Math.floor(count / 4));
  const roles = [...Array(thiefCount).fill("thief"), "nurse", "king"];
  if (count >= 6) roles.push("investigator");
  while (roles.length < count) roles.push("citizen");
  return shuffle(roles);
}

export function newNightActions() {
  return {
    thiefVotes: {},
    nurseTargetId: null,
    kingTargetId: null,
    kingSkipped: false,
    kingPardonFinalized: false,
    investigatorTargetId: null,
    confirmedActors: {},
  };
}

export function createRoom({ hostName, roomName, maxPlayers }) {
  const now = Date.now();
  return {
    id: randomId("room"),
    code: generateRoomCode(),
    roomName: String(roomName || "").trim().slice(0, 32),
    hostName: String(hostName || "").trim().slice(0, 24),
    maxPlayers: Math.min(22, Math.max(4, Number(maxPlayers) || 10)),
    status: "waiting",
    phase: "lobby",
    activeRole: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
    players: [],
    nightNumber: 0,
    nightActions: newNightActions(),
    lastTargets: { thief: null, nurse: null },
    hostToken: randomToken(),
    timeline: [],
    roleRevealStartedAt: null,
    roleRevealEndsAt: null,
    timerEndsAt: null,
    completedSteps: [],
  };
}

export function addTimeline(room, event) {
  room.timeline ||= [];
  room.timeline.push({ id: randomId("evt"), at: Date.now(), ...event });
  if (room.timeline.length > 120) room.timeline.splice(0, room.timeline.length - 120);
}

export function joinPlayer(room, { name, gender, avatar }) {
  if (room.status !== "waiting") throw new Error("ROOM_CLOSED");
  if (room.players.length >= room.maxPlayers) throw new Error("ROOM_FULL");
  const cleanName = String(name || "").trim().slice(0, 24);
  if (!cleanName) throw new Error("INVALID_NAME");
  if (room.players.some(p => p.name.toLocaleLowerCase("ar") === cleanName.toLocaleLowerCase("ar"))) throw new Error("NAME_TAKEN");
  const player = {
    id: randomId("player"),
    sessionToken: randomToken(),
    name: cleanName,
    gender: gender === "female" ? "female" : "male",
    avatar: String(avatar || "").slice(0, 256),
    online: true,
    alive: true,
    role: null,
    roleKnown: false,
    royalPardonsRemaining: 0,
    joinedAt: Date.now(),
    lastSeenAt: Date.now(),
  };
  room.players.push(player);
  addTimeline(room, { type: "player_joined", playerId: player.id, publicText: `انضم ${player.name} إلى الغرفة`, hostText: `انضم ${player.name} إلى الغرفة` });
  touch(room);
  return player;
}

export function touch(room) {
  room.updatedAt = Date.now();
  room.version = Number(room.version || 0) + 1;
}

export function requireHost(room, token) {
  if (!token || token !== room.hostToken) throw new Error("HOST_UNAUTHORIZED");
}

export function requirePlayer(room, playerId, token) {
  const player = room.players.find(p => p.id === playerId);
  if (!player || !token || player.sessionToken !== token) throw new Error("PLAYER_UNAUTHORIZED");
  return player;
}

export function startGame(room) {
  if (room.players.length < 4) throw new Error("NOT_ENOUGH_PLAYERS");
  if (room.status !== "waiting") throw new Error("GAME_ALREADY_STARTED");
  const roles = distributeRoles(room.players.length);
  room.players = shuffle(room.players).map((p, i) => ({
    ...p,
    role: roles[i],
    roleKnown: false,
    alive: true,
    royalPardonsRemaining: roles[i] === "king" ? 3 : 0,
  }));
  room.status = "playing";
  room.phase = "role-reveal";
  room.activeRole = null;
  room.roleRevealStartedAt = Date.now();
  room.roleRevealEndsAt = Date.now() + 30_000;
  room.nightNumber = 0;
  room.nightActions = newNightActions();
  addTimeline(room, { type: "game_started", publicText: "بدأت المباراة وتم توزيع الأدوار", hostText: "بدأت المباراة وتم توزيع الأدوار" });
  touch(room);
}

export function markRoleKnown(room, player) {
  player.roleKnown = true;
  addTimeline(room, { type: "role_seen", playerId: player.id, publicText: `${player.name} اطّلع على دوره`, hostText: `${player.name} اطّلع على دوره` });
  touch(room);
}

export function beginEyesClosed(room) {
  room.phase = "eyes-closed";
  room.activeRole = null;
  room.nightNumber = Number(room.nightNumber || 0) + 1;
  room.nightActions = newNightActions();
  room.completedSteps = ["eyes-closed"];
  addTimeline(room, { type: "eyes_closed", publicText: "أغمضوا أعينكم جميعًا", hostText: "تم بدء مرحلة إغماض الأعين" });
  touch(room);
}

export function wakeRole(room, role) {
  if (!["thief", "nurse", "king", "investigator"].includes(role)) throw new Error("INVALID_ROLE");
  room.phase = "night-role";
  room.activeRole = role;
  room.completedSteps ||= [];
  if (!room.completedSteps.includes(`wake-${role}`)) room.completedSteps.push(`wake-${role}`);
  addTimeline(room, { type: "role_wake", role, publicText: `بدأ دور ${roleLabel(role)}`, hostText: `تم إيقاظ ${roleLabel(role)}` });
  touch(room);
}

function roleLabel(role) {
  return ({ thief: "اللصوص", nurse: "الممرض", king: "الملك", investigator: "المحقق" })[role] || role;
}

function isConfirmed(room, playerId) {
  return Boolean(room.nightActions?.confirmedActors?.[playerId]);
}

function selectedTargetId(room, player) {
  if (player.role === "thief") return room.nightActions?.thiefVotes?.[player.id] || null;
  if (player.role === "nurse") return room.nightActions?.nurseTargetId || null;
  if (player.role === "king") return room.nightActions?.kingTargetId || null;
  if (player.role === "investigator") return room.nightActions?.investigatorTargetId || null;
  return null;
}

export function allowedTargets(room, player) {
  if (isConfirmed(room, player.id)) return [];
  return room.players.filter(target => {
    if (!target.alive) return false;
    if (player.role === "thief") return target.role !== "thief" && target.id !== room.lastTargets?.thief;
    if (player.role === "nurse") return target.id !== room.lastTargets?.nurse;
    if (player.role === "king") return Number(player.royalPardonsRemaining || 0) > 0 && !room.nightActions?.kingPardonFinalized && target.id !== player.id;
    if (player.role === "investigator") return target.id !== player.id;
    return false;
  });
}

export function selectNightTarget(room, player, targetId) {
  if (room.phase !== "night-role" || room.activeRole !== player.role || isConfirmed(room, player.id)) throw new Error("ACTION_NOT_ALLOWED");
  const target = allowedTargets(room, player).find(item => item.id === targetId);
  if (!target) throw new Error("INVALID_TARGET");
  room.nightActions ||= newNightActions();
  if (player.role === "thief") room.nightActions.thiefVotes[player.id] = target.id;
  if (player.role === "nurse") room.nightActions.nurseTargetId = target.id;
  if (player.role === "king") { room.nightActions.kingTargetId = target.id; room.nightActions.kingSkipped = false; }
  if (player.role === "investigator") room.nightActions.investigatorTargetId = target.id;
  touch(room);
}

export function skipKingPardon(room, player) {
  if (player.role !== "king" || room.phase !== "night-role" || room.activeRole !== "king" || isConfirmed(room, player.id)) throw new Error("ACTION_NOT_ALLOWED");
  room.nightActions.kingTargetId = null;
  room.nightActions.kingSkipped = true;
  touch(room);
}

export function confirmNightAction(room, player) {
  if (room.phase !== "night-role" || room.activeRole !== player.role || isConfirmed(room, player.id)) throw new Error("ACTION_NOT_ALLOWED");
  const selected = selectedTargetId(room, player);
  const kingSkipped = Boolean(room.nightActions?.kingSkipped);
  if (player.role === "king") {
    if (!selected && !kingSkipped) throw new Error("NO_SELECTION");
    if (selected) {
      const remaining = Number(player.royalPardonsRemaining || 0);
      if (remaining <= 0) throw new Error("NO_PARDONS_LEFT");
      player.royalPardonsRemaining = remaining - 1;
      room.nightActions.kingPardonFinalized = true;
    }
  } else if (!selected) throw new Error("NO_SELECTION");
  room.nightActions.confirmedActors[player.id] = { role: player.role, targetId: selected, skipped: player.role === "king" && kingSkipped, confirmedAt: new Date().toISOString() };
  const target = selected ? room.players.find(p => p.id === selected) : null;
  const roleText = roleLabel(player.role);
  addTimeline(room, {
    type: "night_action_confirmed",
    role: player.role,
    playerId: player.id,
    targetId: selected,
    publicText: player.role === "thief" ? "اختار اللصوص ضحيتهم" : player.role === "nurse" ? "اختار الممرض الشخص الذي سيحميه" : player.role === "king" ? (kingSkipped ? "احتفظ الملك بوسام العفو" : "منح الملك عفوًا ملكيًا") : "أنهى المحقق تحقيقه",
    hostText: `${player.name} (${roleText}) ${kingSkipped ? "احتفظ بوسام العفو" : target ? `أكد اختياره: ${target.name}` : "أكد قراره"}`,
  });
  touch(room);
}

export function publicProjection(room) {
  return {
    _view: "public",
    code: room.code, roomName: room.roomName, hostName: room.hostName, maxPlayers: room.maxPlayers,
    status: room.status, phase: room.phase, activeRole: room.activeRole, createdAt: room.createdAt,
    updatedAt: room.updatedAt, version: room.version, nightNumber: room.nightNumber,
    roleRevealStartedAt: room.roleRevealStartedAt, roleRevealEndsAt: room.roleRevealEndsAt,
    players: room.players.map(p => ({ id: p.id, name: p.name, gender: p.gender, avatar: p.avatar, online: p.online, alive: p.alive, roleKnown: p.roleKnown, joinedAt: p.joinedAt })),
    timeline: (room.timeline || []).map(e => ({ id: e.id, at: e.at, type: e.type, text: e.publicText })).filter(e => e.text),
  };
}

export function hostProjection(room) {
  const safe = structuredClone(room);
  safe._view = "host";
  delete safe.hostToken;
  safe.players = safe.players.map(p => { delete p.sessionToken; return p; });
  safe.timeline = (room.timeline || []).map(e => ({ ...e, text: e.hostText || e.publicText })).filter(e => e.text);
  return safe;
}

export function playerProjection(room, player) {
  const base = publicProjection(room);
  base._view = "player";
  base.players = room.players.map(p => {
    const visibleRole = p.id === player.id || (player.role === "thief" && p.role === "thief") ? p.role : null;
    return { id: p.id, name: p.name, gender: p.gender, avatar: p.avatar, online: p.online, alive: p.alive, roleKnown: p.roleKnown, joinedAt: p.joinedAt, role: visibleRole, royalPardonsRemaining: p.id === player.id ? p.royalPardonsRemaining : undefined };
  });
  base.nightActions = {
    thiefVotes: player.role === "thief" ? { [player.id]: room.nightActions?.thiefVotes?.[player.id] || null } : {},
    nurseTargetId: player.role === "nurse" ? room.nightActions?.nurseTargetId || null : null,
    kingTargetId: player.role === "king" ? room.nightActions?.kingTargetId || null : null,
    kingSkipped: player.role === "king" ? Boolean(room.nightActions?.kingSkipped) : false,
    kingPardonFinalized: player.role === "king" ? Boolean(room.nightActions?.kingPardonFinalized) : false,
    investigatorTargetId: player.role === "investigator" ? room.nightActions?.investigatorTargetId || null : null,
    confirmedActors: isConfirmed(room, player.id) ? { [player.id]: room.nightActions.confirmedActors[player.id] } : {},
  };
  base.lastTargets = player.role === "thief" ? { thief: room.lastTargets?.thief || null } : player.role === "nurse" ? { nurse: room.lastTargets?.nurse || null } : {};
  if (player.role === "investigator" && isConfirmed(room, player.id)) {
    const targetId = room.nightActions.confirmedActors[player.id]?.targetId;
    const target = room.players.find(p => p.id === targetId);
    const revealedRole = target && ["king", "nurse"].includes(target.role) ? "citizen" : target?.role;
    base.investigationResult = target ? { targetId, actualRole: revealedRole } : null;
  }
  return base;
}
