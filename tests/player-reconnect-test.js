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
    code: c.code, mode: c.mode, playerId: c.playerId || null, token: c.token || null
  })).room;
}

async function subscribe(c) {
  return (await emitAck(c.socket, "room:subscribe", {
    code: c.code, mode: c.mode, playerId: c.playerId || null, token: c.token || null
  })).room;
}

async function hostCommand(h, action, payload = {}) {
  return (await emitAck(h.socket, "host:command", {
    code: h.code, token: h.token, action, payload
  })).room;
}

async function playerCommand(p, action, payload = {}) {
  try {
    return (await emitAck(p.socket, "player:command", {
      code: p.code,
      playerId: p.playerId,
      token: p.token,
      action,
      payload
    })).room;
  } catch (error) {
    console.error("");
    console.error("FAILED PLAYER COMMAND");
    console.error("Player :", p.label);
    console.error("Role   :", p.role || "unknown");
    console.error("Action :", action);
    console.error("Payload:", payload);
    throw error;
  }
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

function me(view, id) {
  return view?.players?.find(p => p.id === id);
}

async function reconnectPlayer(p, expectedPhase) {
  try { p.socket.disconnect(); } catch {}
  await sleep(400);
  p.socket = await connectSocket(p.serverUrl, `${p.label}_RECONNECTED`);
  await subscribe(p);
  const room = await sync(p);
  assert(room.phase === expectedPhase, `${p.label}: expected ${expectedPhase}, got ${room.phase}`);
  assert(me(room, p.playerId), `${p.label}: player missing after reconnect`);
  pass(`${p.label} عاد بنجاح في مرحلة ${expectedPhase}`);
}

async function main() {
  console.log("\n=== MAFIA PLAYER RECONNECT TEST ===\n");
  const serverInput = (await rl.question("رابط الخادم [http://localhost:3000]: ")).trim();
  const serverUrl = serverInput || "http://localhost:3000";
  const playerCount = Number(await rl.question("عدد اللاعبين (4 - 20): "));
  const rounds = Number(await rl.question("عدد الجولات (1 - 10): "));

  assert(Number.isInteger(playerCount) && playerCount >= 4 && playerCount <= 20, "عدد اللاعبين غير صحيح");
  assert(Number.isInteger(rounds) && rounds >= 1 && rounds <= 10, "عدد الجولات غير صحيح");

  const sockets = [];
  const hostSocket = await connectSocket(serverUrl, "HOST");
  sockets.push(hostSocket);

  const created = await emitAck(hostSocket, "room:create", {
    hostName: "RECONNECT_TEST_HOST",
    roomName: "RECONNECT TEST",
    maxPlayers: playerCount,
    discussionDurationSeconds: 30,
  });

  const host = { label: "HOST", mode: "host", socket: hostSocket, code: created.room.code, token: created.hostToken, serverUrl };
  await subscribe(host);
  pass(`تم إنشاء الغرفة ${host.code}`);

  const players = [];
  for (let i = 1; i <= playerCount; i++) {
    const s = await connectSocket(serverUrl, `PLAYER_${i}`);
    sockets.push(s);
    const joined = await emitAck(s, "player:join", {
      code: host.code,
      name: `Player ${i}`,
      gender: i % 2 === 0 ? "female" : "male",
      avatar: `/avatars/avatar-${String(((i - 1) % 12) + 1).padStart(2, "0")}.png`,
    });
    const p = { label: `PLAYER_${i}`, mode: "player", socket: s, code: host.code, playerId: joined.player.id, token: joined.player.sessionToken, serverUrl };
    await subscribe(p);
    players.push(p);
  }
  pass(`اتصل ${players.length} لاعبًا`);

  await hostCommand(host, "start-game");
  for (const p of players) await waitPhase(p, "role-reveal");
  await reconnectPlayer(players[0], "role-reveal");

  for (const p of players) await playerCommand(p, "role-known");
  for (const p of players) {
    const view = await sync(p);
    p.role = me(view, p.playerId)?.role;
  }

  await hostCommand(host, "eyes-closed");
  for (const p of players) await waitPhase(p, "eyes-closed");

  for (let round = 1; round <= rounds; round++) {
    console.log(`\n--- الجولة ${round} ---`);
    const testPlayer = players[(round - 1) % players.length];

    await reconnectPlayer(testPlayer, "eyes-closed");

    const living = [];
    for (const p of players) {
      const view = await sync(p);
      if (me(view, p.playerId)?.alive !== false) living.push(p);
    }

    const thieves = living.filter(p => p.role === "thief");
    const nurses = living.filter(p => p.role === "nurse");
    const kings = living.filter(p => p.role === "king");
    const investigators = living.filter(p => p.role === "investigator");

    await hostCommand(host, "wake-role", { role: "thief" });
    await waitPhase(testPlayer, "night-role");
    await reconnectPlayer(testPlayer, "night-role");

    const thiefView = await sync(thieves[0]);
    const thiefLastTarget = thiefView.lastTargets?.thief || null;
    const thiefCandidates = (thiefView.players || []).filter(target => {
      if (!target.alive) return false;
      const visibleAsThief = target.id === thieves[0].playerId || target.role === "thief";
      if (visibleAsThief) return false;
      if (target.id === thiefLastTarget) return false;
      return true;
    });
    const victim = thiefCandidates[0];
    assert(victim, "لا توجد ضحية صالحة للص");

    for (const t of thieves) {
      await playerCommand(t, "select-night-target", { targetId: victim.id });
      await playerCommand(t, "confirm-night-action");
    }

    if (nurses.length) {
      await hostCommand(host, "wake-role", { role: "nurse" });
      await sleep(300);
      await waitPhase(nurses[0], "night-role");

      const nurseView = await sync(nurses[0]);
      const nurseLastTarget = nurseView.lastTargets?.nurse || null;
      const nurseTarget = (nurseView.players || []).find(target => {
        if (!target.alive) return false;
        if (target.id === nurseLastTarget) return false;
        return true;
      });

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

      const investigatorView = await sync(investigators[0]);
      const investigatorTarget = (investigatorView.players || []).find(target => {
        if (!target.alive) return false;
        if (target.id === investigators[0].playerId) return false;
        return true;
      });

      assert(investigatorTarget, "لا يوجد هدف صالح للمحقق");
      await playerCommand(investigators[0], "select-night-target", { targetId: investigatorTarget.id });
      await playerCommand(investigators[0], "confirm-night-action");
    }

    await hostCommand(host, "finish-night");
    await waitPhase(testPlayer, "day");
    await reconnectPlayer(testPlayer, "day");

    await hostCommand(host, "start-voting");
    await waitPhase(testPlayer, "voting");
    await reconnectPlayer(testPlayer, "voting");

    const aliveNow = [];
    for (const p of players) {
      const view = await sync(p);
      if (me(view, p.playerId)?.alive !== false) aliveNow.push(p);
    }
    for (const p of aliveNow) await playerCommand(p, "cast-vote", { targetId: "abstain" });

    await waitPhase(host, "voting-result");
    await waitPhase(testPlayer, "voting-result");
    await reconnectPlayer(testPlayer, "voting-result");

    if (round < rounds) {
      await hostCommand(host, "next-night");
      for (const p of players) await waitPhase(p, "eyes-closed");
    }
  }

  console.log("\n=== TEST PASSED ===");
  console.log(`Server: ${serverUrl}`);
  console.log(`Players: ${playerCount}`);
  console.log(`Rounds: ${rounds}`);
  console.log("Reconnect phases: role-reveal, eyes-closed, night-role, day, voting, voting-result");
  console.log("Errors: 0\n");

  for (const s of sockets) { try { s.disconnect(); } catch {} }
}

main()
  .catch(e => {
    console.error("\n=== TEST FAILED ===");
    console.error(e?.stack || e);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
