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

export function createRoom({ hostName, roomName, maxPlayers, discussionDurationSeconds }) {
  const now = Date.now();
  return {
    id: randomId("room"),
    code: generateRoomCode(),
    roomName: String(roomName || "").trim().slice(0, 32),
    hostName: String(hostName || "").trim().slice(0, 24),
    maxPlayers: Math.min(22, Math.max(4, Number(maxPlayers) || 10)),
    discussionDurationSeconds: Math.min(300, Math.max(30, Number(discussionDurationSeconds) || 60)),
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
    dayStartedAt: null,
    dayEndsAt: null,
    daySummary: null,
    votes: {},
    votingStartedAt: null,
    votingResult: null,
    currentPardonPlayerId: null,
    roundNumber: 1,
    winner: null,
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
  room.roundNumber = 1;
  room.nightActions = newNightActions();
  room.dayStartedAt = null;
  room.dayEndsAt = null;
  room.daySummary = null;
  room.votes = {};
  room.votingStartedAt = null;
  room.votingResult = null;
  room.currentPardonPlayerId = null;
  room.winner = null;
  addTimeline(room, { type: "game_started", publicText: "بدأت المباراة وتم توزيع الأدوار", hostText: "بدأت المباراة وتم توزيع الأدوار" });
  touch(room);
}

export function markRoleKnown(room, player) {
  // العملية idempotent حتى تكون إعادة المحاولة آمنة إذا انقطع ACK بعد نجاح الحفظ.
  if (player.roleKnown) return;
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


const ONLINE_NIGHT_ROLES = ["thief", "nurse", "king", "investigator"];

export function canFinishNight(room) {
  if (room?.status !== "playing" || room?.phase !== "night-role") return false;

  const requiredActors = (room.players || []).filter(
    player => player.alive && ONLINE_NIGHT_ROLES.includes(player.role),
  );

  if (!requiredActors.length) return false;

  const confirmedActors = room.nightActions?.confirmedActors || {};
  const completedSteps = new Set(room.completedSteps || []);

  const everyRequiredRoleWasWoken = [...new Set(requiredActors.map(player => player.role))]
    .every(role => completedSteps.has(`wake-${role}`));

  const everyRequiredActorConfirmed = requiredActors.every(
    player => Boolean(confirmedActors[player.id]),
  );

  return everyRequiredRoleWasWoken && everyRequiredActorConfirmed;
}

function resolveThiefVictimId(room) {
  const votes = Object.values(room.nightActions?.thiefVotes || {}).filter(Boolean);
  if (!votes.length) return null;
  const counts = new Map();
  for (const targetId of votes) counts.set(targetId, (counts.get(targetId) || 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null;
  return ranked[0][0];
}

function checkWinner(room) {
  const alive = room.players.filter(player => player.alive);
  const thieves = alive.filter(player => player.role === "thief").length;
  const citizens = alive.length - thieves;
  if (thieves === 0) return "citizens";
  if (thieves >= citizens) return "thieves";
  return null;
}

export function finishNight(room) {
  if (!canFinishNight(room)) throw new Error("NIGHT_NOT_COMPLETE");

  const victimId = resolveThiefVictimId(room);
  const victim = victimId ? room.players.find(player => player.id === victimId && player.alive) : null;
  const nurseTargetId = room.nightActions?.nurseTargetId || null;
  const wasSaved = Boolean(victim && nurseTargetId && victim.id === nurseTargetId);
  const kingTargetId = room.nightActions?.kingPardonFinalized && !room.nightActions?.kingSkipped
    ? room.nightActions?.kingTargetId || null
    : null;

  room.currentPardonPlayerId = kingTargetId;
  room.lastTargets = {
    thief: victimId || null,
    nurse: nurseTargetId || null,
  };

  let outcome = "peace";
  if (victim && wasSaved) {
    outcome = "saved";
  } else if (victim) {
    outcome = "eliminated";
    victim.alive = false;
  }

  room.daySummary = {
    outcome,
    victimId: victim?.id || null,
    victimName: victim?.name || null,
    nurseSavedVictim: wasSaved,
    kingPardonGranted: Boolean(kingTargetId),
    investigatorCompleted: room.players.some(player => player.alive && player.role === "investigator")
      ? room.players.filter(player => player.alive && player.role === "investigator").every(player => Boolean(room.nightActions?.confirmedActors?.[player.id]))
      : false,
    nightNumber: room.nightNumber,
  };

  room.phase = "day";
  room.activeRole = null;
  room.completedSteps ||= [];
  if (!room.completedSteps.includes("night-complete")) room.completedSteps.push("night-complete");
  room.dayStartedAt = Date.now();
  room.dayEndsAt = room.dayStartedAt + Math.min(300, Math.max(30, Number(room.discussionDurationSeconds) || 60)) * 1000;
  room.timerEndsAt = room.dayEndsAt;
  room.votes = {};
  room.votingStartedAt = null;
  room.votingResult = null;

  const nightText = outcome === "saved"
    ? `نجحت الممرضة في حماية ${victim.name} ولم يخرج أحد هذه الليلة`
    : outcome === "eliminated"
      ? `خرج ${victim.name} من اللعبة خلال الليل`
      : "مرّت الليلة دون خروج أي لاعب";

  addTimeline(room, {
    type: "night_result",
    publicText: nightText,
    hostText: nightText,
  });
  addTimeline(room, {
    type: "day_started",
    publicText: "استيقظوا جميعًا، بدأت مرحلة النهار",
    hostText: "اكتملت جميع مهام الليل وتم الانتقال إلى مرحلة النهار",
  });

  room.winner = checkWinner(room);
  touch(room);
}

export function startVoting(room) {
  if (room.status !== "playing" || room.phase !== "day" || room.winner) throw new Error("ACTION_NOT_ALLOWED");
  if (Date.now() < Number(room.dayEndsAt || 0)) throw new Error("DAY_TIMER_ACTIVE");
  room.phase = "voting";
  room.votingStartedAt = Date.now();
  room.votes = {};
  room.votingResult = null;
  addTimeline(room, {
    type: "voting_started",
    publicText: "بدأ التصويت السري",
    hostText: "بدأ التصويت السري",
  });
  touch(room);
}

function calculateVotingResult(room) {
  const counts = new Map();
  for (const vote of Object.values(room.votes || {})) {
    const targetId = vote?.targetId;
    if (!targetId) continue;
    counts.set(targetId, (counts.get(targetId) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return { outcome: "no-votes", highestVotes: 0, playerId: null, playerName: null };
  const highestVotes = ranked[0][1];
  const top = ranked.filter(([, count]) => count === highestVotes).map(([id]) => id);
  if (top.length > 1) return { outcome: "tie", highestVotes, playerId: null, playerName: null };
  if (top[0] === "abstain") return { outcome: "abstain", highestVotes, playerId: null, playerName: null };
  const player = room.players.find(item => item.id === top[0] && item.alive);
  if (!player) return { outcome: "no-votes", highestVotes, playerId: null, playerName: null };
  if (room.currentPardonPlayerId === player.id) {
    return { outcome: "pardoned", highestVotes, playerId: player.id, playerName: player.name };
  }
  return { outcome: "eliminated", highestVotes, playerId: player.id, playerName: player.name };
}

function resolveVoting(room) {
  const result = calculateVotingResult(room);
  if (result.outcome === "eliminated" && result.playerId) {
    const player = room.players.find(item => item.id === result.playerId);
    if (player) player.alive = false;
  }
  room.votingResult = { ...result, resolvedAt: Date.now() };
  room.phase = "voting-result";
  room.winner = checkWinner(room);
  const text = result.outcome === "eliminated"
    ? `خرج ${result.playerName} بعد حصوله على أعلى عدد من الأصوات`
    : result.outcome === "pardoned"
      ? `حصل ${result.playerName} على وسام عفو ملكي وبقي في اللعبة`
      : result.outcome === "tie"
        ? "تعادل التصويت ولم يخرج أحد"
        : result.outcome === "abstain"
          ? "حصل الامتناع على أعلى عدد من الأصوات ولم يخرج أحد"
          : "انتهى التصويت دون خروج أي لاعب";
  addTimeline(room, { type: "voting_result", publicText: text, hostText: text });
  touch(room);
}

export function castVote(room, player, targetId) {
  if (room.status !== "playing" || room.phase !== "voting" || !player.alive) throw new Error("ACTION_NOT_ALLOWED");
  room.votes ||= {};
  if (room.votes[player.id]) throw new Error("VOTE_ALREADY_CAST");
  const normalizedTarget = targetId === "abstain" ? "abstain" : String(targetId || "");
  if (normalizedTarget !== "abstain") {
    const target = room.players.find(item => item.id === normalizedTarget && item.alive && item.id !== player.id);
    if (!target) throw new Error("INVALID_TARGET");
  }
  room.votes[player.id] = { targetId: normalizedTarget, castAt: Date.now() };
  addTimeline(room, {
    type: "vote_cast",
    playerId: player.id,
    publicText: `${player.name} أدلى بصوته`,
    hostText: `${player.name} أدلى بصوته`,
  });
  const alivePlayers = room.players.filter(item => item.alive);
  if (alivePlayers.every(item => Boolean(room.votes[item.id]))) resolveVoting(room);
  else touch(room);
}

export function beginNextNight(room) {
  if (room.status !== "playing" || room.phase !== "voting-result" || room.winner) throw new Error("ACTION_NOT_ALLOWED");
  room.roundNumber = Number(room.roundNumber || 1) + 1;
  room.currentPardonPlayerId = null;
  room.daySummary = null;
  room.dayStartedAt = null;
  room.dayEndsAt = null;
  room.timerEndsAt = null;
  room.votes = {};
  room.votingStartedAt = null;
  room.votingResult = null;
  beginEyesClosed(room);
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
    updatedAt: room.updatedAt, version: room.version, nightNumber: room.nightNumber, roundNumber: room.roundNumber || 1,
    roleRevealStartedAt: room.roleRevealStartedAt, roleRevealEndsAt: room.roleRevealEndsAt,
    discussionDurationSeconds: room.discussionDurationSeconds || 60, dayStartedAt: room.dayStartedAt || null, dayEndsAt: room.dayEndsAt || null,
    daySummary: room.daySummary || null, votingStartedAt: room.votingStartedAt || null, votingResult: room.votingResult || null, winner: room.winner || null,
    votingStatus: { votedPlayerIds: Object.keys(room.votes || {}), totalAlive: room.players.filter(p => p.alive).length },
    players: room.players.map(p => ({ id: p.id, name: p.name, gender: p.gender, avatar: p.avatar, online: p.online, alive: p.alive, roleKnown: p.roleKnown, joinedAt: p.joinedAt })),
    timeline: (room.timeline || []).map(e => ({ id: e.id, at: e.at, type: e.type, text: e.publicText })).filter(e => e.text),
  };
}

export function hostProjection(room) {
  const safe = structuredClone(room);
  safe._view = "host";
  safe.nightReady = canFinishNight(room);
  safe.dayTimerFinished = room.phase === "day" && Date.now() >= Number(room.dayEndsAt || 0);
  safe.votingStatus = { votedPlayerIds: Object.keys(room.votes || {}), totalAlive: room.players.filter(p => p.alive).length };
  delete safe.votes;
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
  base.myVote = room.votes?.[player.id]?.targetId || null;
  if (player.role === "investigator" && isConfirmed(room, player.id)) {
    const targetId = room.nightActions.confirmedActors[player.id]?.targetId;
    const target = room.players.find(p => p.id === targetId);
    base.investigationResult = target ? { targetId, actualRole: target.role } : null;
  }
  return base;
}
