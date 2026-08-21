import { io } from "socket.io-client";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const rl = readline.createInterface({ input, output });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (v, m) => { if (!v) throw new Error(m); };
const pass = m => console.log(`  ✓ ${m}`);

function emitAck(socket, event, payload, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event}: TIMEOUT`)), timeout);
    socket.emit(event, payload, res => {
      clearTimeout(timer);
      if (!res?.ok) reject(new Error(`${event}: ${res?.error || "SERVER_ERROR"}`));
      else resolve(res);
    });
  });
}

async function expectCommandRejected(socket, event, payload, label) {
  try {
    await emitAck(socket, event, payload, 12000);
  } catch (error) {
    pass(`${label} مرفوض كما هو متوقع: ${error.message}`);
    return;
  }
  throw new Error(`${label}: الخادم قبل أمرًا من لاعب خارج اللعبة`);
}

async function connectSocket(url, label) {
  const socket = io(url, {
    transports: ["polling", "websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 250,
    timeout: 12000,
    forceNew: true,
  });

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: CONNECT_TIMEOUT`)), 15000);
    socket.once("connect", () => { clearTimeout(t); resolve(); });
    socket.once("connect_error", e => { clearTimeout(t); reject(e); });
  });

  return socket;
}

async function sync(c) {
  return (await emitAck(c.socket, "room:sync", {
    code: c.code,
    mode: c.mode,
    playerId: c.playerId || null,
    token: c.token || null,
  })).room;
}

async function subscribe(c) {
  return (await emitAck(c.socket, "room:subscribe", {
    code: c.code,
    mode: c.mode,
    playerId: c.playerId || null,
    token: c.token || null,
  })).room;
}

async function hostCommand(h, action, payload = {}) {
  return (await emitAck(h.socket, "host:command", {
    code: h.code,
    token: h.token,
    action,
    payload,
  })).room;
}

async function playerCommand(p, action, payload = {}) {
  return (await emitAck(p.socket, "player:command", {
    code: p.code,
    playerId: p.playerId,
    token: p.token,
    action,
    payload,
  })).room;
}

function me(view, id) {
  return view?.players?.find(p => p.id === id);
}

async function waitPhase(c, phase, timeout = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const room = await sync(c);
      if (room?.phase === phase) return room;
    } catch {}
    await sleep(150);
  }
  throw new Error(`${c.label}: expected ${phase}`);
}

async function reconnectPlayer(p) {
  try { p.socket.disconnect(); } catch {}
  await sleep(400);

  p.socket = await connectSocket(p.serverUrl, `${p.label}_RECONNECTED`);
  await subscribe(p);

  const room = await sync(p);
  const self = me(room, p.playerId);

  assert(self, `${p.label}: اللاعب اختفى بعد إعادة الاتصال`);
  assert(self.alive === false, `${p.label}: اللاعب عاد حيًا بعد إعادة الاتصال`);

  pass(`${p.label} عاد بنفس الهوية وبقي خارج اللعبة`);
  return room;
}

async function setupRoom(serverUrl, playerCount) {
  const sockets = [];

  const hostSocket = await connectSocket(serverUrl, "HOST");
  sockets.push(hostSocket);

  const created = await emitAck(hostSocket, "room:create", {
    hostName: "ELIMINATION_TEST_HOST",
    roomName: "ELIMINATED PLAYER TEST",
    maxPlayers: playerCount,
    discussionDurationSeconds: 30,
  });

  const host = {
    label: "HOST",
    mode: "host",
    socket: hostSocket,
    code: created.room.code,
    token: created.hostToken,
    serverUrl,
  };

  await subscribe(host);

  const players = [];

  for (let i = 1; i <= playerCount; i++) {
    const socket = await connectSocket(serverUrl, `PLAYER_${i}`);
    sockets.push(socket);

    const joined = await emitAck(socket, "player:join", {
      code: host.code,
      name: `Player ${i}`,
      gender: i % 2 === 0 ? "female" : "male",
      avatar: `/avatars/avatar-${String(((i - 1) % 12) + 1).padStart(2, "0")}.png`,
    });

    const player = {
      label: `PLAYER_${i}`,
      mode: "player",
      socket,
      code: host.code,
      playerId: joined.player.id,
      token: joined.player.sessionToken,
      serverUrl,
      role: null,
    };

    await subscribe(player);
    players.push(player);
  }

  await hostCommand(host, "start-game");

  for (const p of players) {
    await waitPhase(p, "role-reveal");
    await playerCommand(p, "role-known");
  }

  for (const p of players) {
    const view = await sync(p);
    p.role = me(view, p.playerId)?.role;
  }

  await hostCommand(host, "eyes-closed");
  for (const p of players) await waitPhase(p, "eyes-closed");

  return { host, players, sockets };
}

async function executeSafeNight(host, players) {
  const living = [];

  for (const p of players) {
    const view = await sync(p);
    if (me(view, p.playerId)?.alive !== false) living.push(p);
  }

  const thieves = living.filter(p => p.role === "thief");
  const nurses = living.filter(p => p.role === "nurse");
  const kings = living.filter(p => p.role === "king");
  const investigators = living.filter(p => p.role === "investigator");

  assert(thieves.length, "لا يوجد لص حي");

  await hostCommand(host, "wake-role", { role: "thief" });
  await sleep(250);

  const thiefView = await sync(thieves[0]);
  const lastThiefTarget = thiefView.lastTargets?.thief || null;

  const victim = (thiefView.players || []).find(target => {
    if (!target.alive) return false;
    if (target.id === lastThiefTarget) return false;
    const isVisibleThief = target.id === thieves[0].playerId || target.role === "thief";
    return !isVisibleThief;
  });

  assert(victim, "لا توجد ضحية صالحة للصوص");

  for (const thief of thieves) {
    await playerCommand(thief, "select-night-target", { targetId: victim.id });
    await playerCommand(thief, "confirm-night-action");
  }

  if (nurses.length) {
    await hostCommand(host, "wake-role", { role: "nurse" });
    await sleep(300);
    await waitPhase(nurses[0], "night-role");

    const nurseView = await sync(nurses[0]);
    const lastNurseTarget = nurseView.lastTargets?.nurse || null;

    // نحاول إنقاذ ضحية اللص إذا كانت مسموحة، وإلا نختار أول هدف صالح.
    const candidates = (nurseView.players || []).filter(target =>
      target.alive && target.id !== lastNurseTarget
    );

    const nurseTarget = candidates.find(target => target.id === victim.id) || candidates[0];
    assert(nurseTarget, "لا يوجد هدف صالح للممرض");

    await playerCommand(nurses[0], "select-night-target", { targetId: nurseTarget.id });
    await playerCommand(nurses[0], "confirm-night-action");
  }

  if (kings.length) {
    await hostCommand(host, "wake-role", { role: "king" });
    await sleep(300);
    await waitPhase(kings[0], "night-role");
    await playerCommand(kings[0], "skip-king-pardon");
    await playerCommand(kings[0], "confirm-night-action");
  }

  if (investigators.length) {
    await hostCommand(host, "wake-role", { role: "investigator" });
    await sleep(300);
    await waitPhase(investigators[0], "night-role");

    const view = await sync(investigators[0]);
    const target = (view.players || []).find(x =>
      x.alive && x.id !== investigators[0].playerId
    );

    assert(target, "لا يوجد هدف صالح للمحقق");

    await playerCommand(investigators[0], "select-night-target", { targetId: target.id });
    await playerCommand(investigators[0], "confirm-night-action");
  }

  const day = await hostCommand(host, "finish-night");
  assert(day.phase === "day", `finish-night returned ${day.phase}`);
}

async function eliminateByVote(host, players, targetPlayer) {
  const voting = await hostCommand(host, "start-voting");
  assert(voting.phase === "voting", `start-voting returned ${voting.phase}`);

  const living = [];
  for (const p of players) {
    const view = await sync(p);
    if (me(view, p.playerId)?.alive !== false) living.push(p);
  }

  for (const p of living) {
    if (p.playerId === targetPlayer.playerId) {
      await playerCommand(p, "cast-vote", { targetId: "abstain" });
    } else {
      await playerCommand(p, "cast-vote", { targetId: targetPlayer.playerId });
    }
  }

  const result = await waitPhase(host, "voting-result");
  assert(result.votingResult, "نتيجة التصويت غير موجودة");

  const targetView = await sync(targetPlayer);
  const targetSelf = me(targetView, targetPlayer.playerId);

  assert(targetSelf, "اللاعب المستهدف غير موجود");
  assert(targetSelf.alive === false, "اللاعب لم يخرج بعد التصويت");

  pass(`${targetPlayer.label} خرج من اللعبة عبر التصويت`);
}

async function main() {
  console.log("\n================================================");
  console.log("   MAFIA ELIMINATED PLAYER LOCK TEST");
  console.log("================================================\n");

  const serverInput = (await rl.question("رابط الخادم [http://localhost:3000]: ")).trim();
  const serverUrl = serverInput || "http://localhost:3000";

  const playerCount = Number(await rl.question("عدد اللاعبين (8 - 20): "));
  assert(
    Number.isInteger(playerCount) && playerCount >= 8 && playerCount <= 20,
    "استخدم من 8 إلى 20 لاعبًا لهذا الاختبار"
  );

  const { host, players, sockets } = await setupRoom(serverUrl, playerCount);

  try {
    pass(`تم إنشاء الغرفة ${host.code}`);
    pass(`تمت إضافة ${players.length} لاعبًا`);

    // نختار مواطنًا عاديًا لتجنب تعطيل أدوار الليل في الجولة التالية.
    const targetPlayer = players.find(p => p.role === "citizen");
    assert(targetPlayer, "لم يتم العثور على مواطن عادي للاختبار");

    pass(`اللاعب المستهدف للخروج: ${targetPlayer.label}`);

    await executeSafeNight(host, players);
    await eliminateByVote(host, players, targetPlayer);

    // 1. إعادة الاتصال يجب ألا تعيد إحياء اللاعب.
    await reconnectPlayer(targetPlayer);

    // 2. نبدأ جولة جديدة، ثم نصل إلى التصويت مرة أخرى.
    const next = await hostCommand(host, "next-night");
    assert(next.phase === "eyes-closed", `next-night returned ${next.phase}`);

    await executeSafeNight(host, players);

    const voting = await hostCommand(host, "start-voting");
    assert(voting.phase === "voting", "لم تبدأ مرحلة التصويت الثانية");

    await waitPhase(targetPlayer, "voting");

    // 3. اللاعب الخارج يحاول التصويت، ويجب على الخادم رفضه.
    await expectCommandRejected(
      targetPlayer.socket,
      "player:command",
      {
        code: targetPlayer.code,
        playerId: targetPlayer.playerId,
        token: targetPlayer.token,
        action: "cast-vote",
        payload: { targetId: "abstain" },
      },
      "تصويت اللاعب الخارج"
    );

    // 4. نتأكد مرة أخرى أنه ما زال خارج اللعبة بعد محاولة الأمر.
    const finalView = await sync(targetPlayer);
    const finalSelf = me(finalView, targetPlayer.playerId);

    assert(finalSelf?.alive === false, "حالة اللاعب الخارج تغيرت بعد محاولة التصويت");

    console.log("\n================================================");
    console.log("                 TEST PASSED");
    console.log("================================================");
    console.log(`Server          : ${serverUrl}`);
    console.log(`Players tested  : ${playerCount}`);
    console.log(`Eliminated      : ${targetPlayer.label}`);
    console.log(`Reconnect lock  : PASS`);
    console.log(`Vote rejection  : PASS`);
    console.log(`Still eliminated: PASS`);
    console.log(`Errors          : 0`);
    console.log("================================================\n");
  } finally {
    for (const socket of sockets) {
      try { socket.disconnect(); } catch {}
    }
  }
}

main()
  .catch(error => {
    console.error("\n================================================");
    console.error("                 TEST FAILED");
    console.error("================================================");
    console.error(error?.stack || error?.message || error);
    console.error("================================================\n");
    process.exitCode = 1;
  })
  .finally(() => rl.close());
