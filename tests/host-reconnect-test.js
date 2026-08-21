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

async function reconnectHost(host, expectedPhase) {
  try { host.socket.disconnect(); } catch {}
  await sleep(500);

  host.socket = await connectSocket(host.serverUrl, "HOST_RECONNECTED");
  const subscribed = await subscribe(host);
  assert(subscribed?.phase === expectedPhase, `Host subscribe expected ${expectedPhase}, got ${subscribed?.phase}`);

  const room = await sync(host);
  assert(room?.phase === expectedPhase, `Host sync expected ${expectedPhase}, got ${room?.phase}`);
  assert(room?.code === host.code, "Host returned to a different room");

  pass(`المدير عاد بنجاح في مرحلة ${expectedPhase}`);
  return room;
}

async function setupRoom(serverUrl, playerCount) {
  const sockets = [];

  const hostSocket = await connectSocket(serverUrl, "HOST");
  sockets.push(hostSocket);

  const created = await emitAck(hostSocket, "room:create", {
    hostName: "HOST_RECONNECT_TEST",
    roomName: "HOST RECONNECT TEST",
    maxPlayers: playerCount,
    discussionDurationSeconds: 30,
  });

  const host = {
    label: "HOST",
    mode: "host",
    socket: hostSocket,
    code: created.room.code,
    token: created.hostToken,
    playerId: null,
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

  return { host, players, sockets };
}

async function executeNight(host, players) {
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
    const isThief = target.id === thieves[0].playerId || target.role === "thief";
    return !isThief;
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

    const view = await sync(nurses[0]);
    const lastNurseTarget = view.lastTargets?.nurse || null;

    const candidates = (view.players || []).filter(target =>
      target.alive && target.id !== lastNurseTarget
    );

    const target = candidates.find(x => x.id === victim.id) || candidates[0];
    assert(target, "لا يوجد هدف صالح للممرض");

    await playerCommand(nurses[0], "select-night-target", { targetId: target.id });
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

async function executeVoting(host, players) {
  const voting = await hostCommand(host, "start-voting");
  assert(voting.phase === "voting", `start-voting returned ${voting.phase}`);

  const living = [];
  for (const p of players) {
    const view = await sync(p);
    if (me(view, p.playerId)?.alive !== false) living.push(p);
  }

  for (const p of living) {
    await playerCommand(p, "cast-vote", { targetId: "abstain" });
  }

  const result = await waitPhase(host, "voting-result");
  assert(result.votingResult, "نتيجة التصويت غير موجودة");
}

async function main() {
  console.log("\n================================================");
  console.log("      MAFIA HOST RECONNECT STRESS TEST");
  console.log("================================================\n");

  const serverInput = (await rl.question("رابط الخادم [http://localhost:3000]: ")).trim();
  const serverUrl = serverInput || "http://localhost:3000";

  const playerCount = Number(await rl.question("عدد اللاعبين (8 - 20): "));
  const rounds = Number(await rl.question("عدد الجولات (1 - 10): "));

  assert(Number.isInteger(playerCount) && playerCount >= 8 && playerCount <= 20, "عدد اللاعبين يجب أن يكون من 8 إلى 20");
  assert(Number.isInteger(rounds) && rounds >= 1 && rounds <= 10, "عدد الجولات يجب أن يكون من 1 إلى 10");

  const { host, players, sockets } = await setupRoom(serverUrl, playerCount);

  try {
    pass(`تم إنشاء الغرفة ${host.code}`);
    pass(`تمت إضافة ${players.length} لاعبًا`);

    // إعادة اتصال المدير في كشف الأدوار.
    await reconnectHost(host, "role-reveal");

    await hostCommand(host, "eyes-closed");
    await reconnectHost(host, "eyes-closed");

    for (let round = 1; round <= rounds; round++) {
      console.log(`\n--- الجولة ${round} من ${rounds} ---`);

      // إعادة اتصال المدير قبل بدء أوامر الليل.
      await reconnectHost(host, "eyes-closed");

      // يبدأ دور اللص، ثم ينقطع المدير ويعود أثناء night-role.
      await hostCommand(host, "wake-role", { role: "thief" });
      await sleep(200);
      await reconnectHost(host, "night-role");

      // نرجع إلى بداية الجولة الليلية عبر تنفيذ الأدوار من الحالة الحالية.
      // اللصوص الآن مستيقظون، فننفذ بقية الليلة يدويًا من نفس المرحلة.
      const living = [];
      for (const p of players) {
        const view = await sync(p);
        if (me(view, p.playerId)?.alive !== false) living.push(p);
      }

      const thieves = living.filter(p => p.role === "thief");
      const nurses = living.filter(p => p.role === "nurse");
      const kings = living.filter(p => p.role === "king");
      const investigators = living.filter(p => p.role === "investigator");

      const thiefView = await sync(thieves[0]);
      const lastThiefTarget = thiefView.lastTargets?.thief || null;
      const victim = (thiefView.players || []).find(target => {
        if (!target.alive) return false;
        if (target.id === lastThiefTarget) return false;
        const isThief = target.id === thieves[0].playerId || target.role === "thief";
        return !isThief;
      });

      assert(victim, "لا توجد ضحية صالحة للصوص");

      for (const thief of thieves) {
        await playerCommand(thief, "select-night-target", { targetId: victim.id });
        await playerCommand(thief, "confirm-night-action");
      }

      if (nurses.length) {
        await hostCommand(host, "wake-role", { role: "nurse" });
        await sleep(300);
        const view = await sync(nurses[0]);
        const last = view.lastTargets?.nurse || null;
        const candidates = (view.players || []).filter(x => x.alive && x.id !== last);
        const target = candidates.find(x => x.id === victim.id) || candidates[0];
        assert(target, "لا يوجد هدف صالح للممرض");
        await playerCommand(nurses[0], "select-night-target", { targetId: target.id });
        await playerCommand(nurses[0], "confirm-night-action");
      }

      if (kings.length) {
        await hostCommand(host, "wake-role", { role: "king" });
        await sleep(300);
        await playerCommand(kings[0], "skip-king-pardon");
        await playerCommand(kings[0], "confirm-night-action");
      }

      if (investigators.length) {
        await hostCommand(host, "wake-role", { role: "investigator" });
        await sleep(300);
        const view = await sync(investigators[0]);
        const target = (view.players || []).find(x =>
          x.alive && x.id !== investigators[0].playerId
        );
        assert(target, "لا يوجد هدف صالح للمحقق");
        await playerCommand(investigators[0], "select-night-target", { targetId: target.id });
        await playerCommand(investigators[0], "confirm-night-action");
      }

      await hostCommand(host, "finish-night");
      await reconnectHost(host, "day");

      await hostCommand(host, "start-voting");
      await reconnectHost(host, "voting");

      const aliveNow = [];
      for (const p of players) {
        const view = await sync(p);
        if (me(view, p.playerId)?.alive !== false) aliveNow.push(p);
      }

      for (const p of aliveNow) {
        await playerCommand(p, "cast-vote", { targetId: "abstain" });
      }

      await waitPhase(host, "voting-result");
      await reconnectHost(host, "voting-result");

      if (round < rounds) {
        const next = await hostCommand(host, "next-night");
        assert(next.phase === "eyes-closed", `next-night returned ${next.phase}`);
        await reconnectHost(host, "eyes-closed");
      }
    }

    console.log("\n================================================");
    console.log("                 TEST PASSED");
    console.log("================================================");
    console.log(`Server          : ${serverUrl}`);
    console.log(`Players tested  : ${playerCount}`);
    console.log(`Rounds tested   : ${rounds}`);
    console.log("Host reconnects : role-reveal, eyes-closed, night-role, day, voting, voting-result");
    console.log("Host token      : preserved");
    console.log("Room control    : preserved");
    console.log("Errors          : 0");
    console.log("================================================\n");
  } finally {
    for (const socket of sockets) {
      try { socket.disconnect(); } catch {}
    }
    try { host.socket.disconnect(); } catch {}
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
