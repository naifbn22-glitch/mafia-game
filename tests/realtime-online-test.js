import { io } from "socket.io-client";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const rl = readline.createInterface({ input, output });

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function logPass(message) {
  console.log(`  ✓ ${message}`);
}

function emitAck(socket, eventName, payload, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${eventName}: TIMEOUT`)), timeoutMs);
    socket.emit(eventName, payload, response => {
      clearTimeout(timer);
      if (!response?.ok) {
        reject(new Error(`${eventName}: ${response?.error || "SERVER_ERROR"}`));
        return;
      }
      resolve(response);
    });
  });
}

async function connectClient(serverUrl, label) {
  const socket = io(serverUrl, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 200,
    timeout: 10000,
    forceNew: true,
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: CONNECT_TIMEOUT`)), 12000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", error => {
      clearTimeout(timer);
      reject(new Error(`${label}: ${error?.message || "CONNECT_ERROR"}`));
    });
  });

  return socket;
}

async function syncRoom(socket, code, mode, playerId = null, token = null) {
  const response = await emitAck(socket, "room:sync", {
    code,
    mode,
    playerId,
    token,
  });
  return response.room;
}

async function subscribe(socket, code, mode, playerId = null, token = null) {
  const response = await emitAck(socket, "room:subscribe", {
    code,
    mode,
    playerId,
    token,
  });
  return response.room;
}

function alivePlayers(room) {
  return (room?.players || []).filter(player => player.alive !== false);
}

function findSelf(room, playerId) {
  return room?.players?.find(player => player.id === playerId) || null;
}

async function waitForPhase(client, expectedPhase, timeoutMs = 9000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const room = await syncRoom(
      client.socket,
      client.code,
      client.mode,
      client.playerId,
      client.token,
    );

    if (room?.phase === expectedPhase) return room;
    await sleep(120);
  }

  throw new Error(`${client.label}: expected phase ${expectedPhase}`);
}

async function waitAllPlayersPhase(players, expectedPhase) {
  const views = [];
  for (const player of players) {
    views.push(await waitForPhase(player, expectedPhase));
  }
  return views;
}

async function hostCommand(host, action, payload = {}) {
  const response = await emitAck(host.socket, "host:command", {
    code: host.code,
    token: host.token,
    action,
    payload,
  });
  return response.room;
}

async function playerCommand(player, action, payload = {}) {
  const response = await emitAck(player.socket, "player:command", {
    code: player.code,
    playerId: player.playerId,
    token: player.token,
    action,
    payload,
  });
  return response.room;
}

async function freshPlayerView(player) {
  return syncRoom(
    player.socket,
    player.code,
    "player",
    player.playerId,
    player.token,
  );
}

async function roleMap(players) {
  const result = new Map();

  for (const player of players) {
    const view = await freshPlayerView(player);
    const me = findSelf(view, player.playerId);
    assert(me?.role, `${player.label}: own role missing from player projection`);
    player.role = me.role;
    player.gender = me.gender;
    result.set(player.playerId, me.role);
  }

  return result;
}

function chooseDifferentTarget(candidates, previousId = null) {
  const different = candidates.find(item => item.id !== previousId);
  return different || candidates[0] || null;
}

async function performNight(host, players, state) {
  const living = [];

  for (const p of players) {
    const view = await freshPlayerView(p);
    const me = findSelf(view, p.playerId);
    if (me?.alive !== false) living.push(p);
  }

  const thieves = living.filter(p => p.role === "thief");
  const nurses = living.filter(p => p.role === "nurse");
  const kings = living.filter(p => p.role === "king");
  const investigators = living.filter(p => p.role === "investigator");

  assert(thieves.length > 0, "No living thief for stress test");

  await hostCommand(host, "wake-role", { role: "thief" });
  await waitAllPlayersPhase(living, "night-role");

  const thiefView = await freshPlayerView(thieves[0]);
  const thiefSelf = findSelf(thiefView, thieves[0].playerId);
  assert(thiefSelf?.role === "thief", "Thief role projection mismatch");

  const nonThieves = alivePlayers(thiefView).filter(
    target => !thieves.some(thief => thief.playerId === target.id),
  );
  const victim = chooseDifferentTarget(nonThieves, state.lastVictimId);
  assert(victim, "No valid thief victim");
  state.lastVictimId = victim.id;

  for (const thief of thieves) {
    await playerCommand(thief, "select-night-target", { targetId: victim.id });
    await playerCommand(thief, "confirm-night-action");
  }
  logPass(`اللصوص أكدوا الضحية: ${victim.name}`);

  if (nurses.length) {
    await hostCommand(host, "wake-role", { role: "nurse" });
    await waitAllPlayersPhase(living, "night-role");

    const nurse = nurses[0];
    await playerCommand(nurse, "select-night-target", { targetId: victim.id });
    await playerCommand(nurse, "confirm-night-action");
    logPass(`الممرض/الممرضة أنقذ الضحية: ${victim.name}`);
  }

  if (kings.length) {
    await hostCommand(host, "wake-role", { role: "king" });
    await waitAllPlayersPhase(living, "night-role");

    const king = kings[0];
    await playerCommand(king, "skip-king-pardon");
    await playerCommand(king, "confirm-night-action");
    logPass("الملك/الملكة أكد عدم استخدام العفو");
  }

  if (investigators.length) {
    await hostCommand(host, "wake-role", { role: "investigator" });
    await waitAllPlayersPhase(living, "night-role");

    const investigator = investigators[0];
    const view = await freshPlayerView(investigator);
    const target = alivePlayers(view).find(item => item.id !== investigator.playerId);
    assert(target, "No investigator target");

    await playerCommand(investigator, "select-night-target", { targetId: target.id });
    await playerCommand(investigator, "confirm-night-action");
    logPass(`المحقق/المحققة أنهى التحقيق على: ${target.name}`);
  }

  const dayRoom = await hostCommand(host, "finish-night");
  assert(dayRoom.phase === "day", `finish-night returned ${dayRoom.phase}`);

  const playerDayViews = await waitAllPlayersPhase(living, "day");
  for (const view of playerDayViews) {
    assert(view.phase === "day", "A player did not receive day phase");
  }

  logPass("مرحلة النهار وصلت لجميع اللاعبين");
}

async function performVoting(host, players, roundNumber) {
  const livingPlayers = [];

  for (const p of players) {
    const view = await freshPlayerView(p);
    const me = findSelf(view, p.playerId);
    if (me?.alive !== false) livingPlayers.push(p);
  }

  const hostDay = await syncRoom(host.socket, host.code, "host", null, host.token);
  assert(hostDay.phase === "day", `Host expected day before voting, got ${hostDay.phase}`);

  if (roundNumber % 2 === 0) {
    // ننتظر قليلًا لمحاكاة جولة متأخرة. لا نغير بيانات الخادم مباشرة.
    await sleep(700);
    logPass("محاكاة ضغط زر التصويت بعد انتظار أثناء النهار");
  } else {
    logPass("محاكاة ضغط زر التصويت مباشرة أثناء النهار");
  }

  const votingRoom = await hostCommand(host, "start-voting");
  assert(votingRoom.phase === "voting", `Host command did not enter voting: ${votingRoom.phase}`);

  const playerVotingViews = await waitAllPlayersPhase(livingPlayers, "voting");
  for (let i = 0; i < playerVotingViews.length; i += 1) {
    const view = playerVotingViews[i];
    const me = findSelf(view, livingPlayers[i].playerId);
    assert(me, `${livingPlayers[i].label}: player missing in voting projection`);
    assert(view.phase === "voting", `${livingPlayers[i].label}: voting page phase missing`);
  }

  logPass(`صفحة التصويت وصلت إلى ${livingPlayers.length}/${livingPlayers.length} لاعب`);

  // الامتناع يحافظ على عدد اللاعبين ويتيح اختبار عشرات الجولات.
  for (const player of livingPlayers) {
    await playerCommand(player, "cast-vote", { targetId: "abstain" });
  }

  const hostResult = await waitForPhase(host, "voting-result");
  assert(hostResult.votingResult, "Voting result missing");

  for (const player of livingPlayers) {
    const resultView = await waitForPhase(player, "voting-result");
    assert(resultView.votingResult, `${player.label}: voting result missing`);
  }

  logPass(`نتيجة التصويت ظهرت للجميع: ${hostResult.votingResult?.outcome || "unknown"}`);
}

async function main() {
  console.log("\n================================================");
  console.log("     MAFIA REALTIME SOCKET.IO STRESS TEST");
  console.log("================================================\n");

  const serverInput = (await rl.question("رابط الخادم [http://localhost:3000]: ")).trim();
  const serverUrl = serverInput || "http://localhost:3000";

  const playerCount = Number(await rl.question("عدد اللاعبين (4 - 20): "));
  const rounds = Number(await rl.question("عدد الجولات (1 - 20): "));

  assert(Number.isInteger(playerCount) && playerCount >= 4 && playerCount <= 20, "عدد اللاعبين يجب أن يكون من 4 إلى 20");
  assert(Number.isInteger(rounds) && rounds >= 1 && rounds <= 20, "عدد الجولات يجب أن يكون من 1 إلى 20");

  const socketsToClose = [];
  const startedAt = Date.now();

  try {
    const hostSocket = await connectClient(serverUrl, "HOST");
    socketsToClose.push(hostSocket);

    const createResponse = await emitAck(hostSocket, "room:create", {
      hostName: "AUTO_SOCKET_HOST",
      roomName: "SOCKET.IO STRESS TEST",
      maxPlayers: playerCount,
      discussionDurationSeconds: 30,
    });

    const code = createResponse.room.code;
    const host = {
      label: "HOST",
      mode: "host",
      socket: hostSocket,
      code,
      token: createResponse.hostToken,
      playerId: null,
    };

    await subscribe(host.socket, code, "host", null, host.token);
    logPass(`تم إنشاء الغرفة ${code}`);

    const players = [];

    for (let i = 1; i <= playerCount; i += 1) {
      const socket = await connectClient(serverUrl, `PLAYER_${i}`);
      socketsToClose.push(socket);

      const join = await emitAck(socket, "player:join", {
        code,
        name: `Player ${i}`,
        gender: i % 2 === 0 ? "female" : "male",
        avatar: `/avatars/avatar-${String(((i - 1) % 12) + 1).padStart(2, "0")}.png`,
      });

      const player = {
        label: `PLAYER_${i}`,
        mode: "player",
        socket,
        code,
        playerId: join.player.id,
        token: join.player.sessionToken,
      };

      await subscribe(socket, code, "player", player.playerId, player.token);
      players.push(player);
    }

    logPass(`اتصل ${players.length} لاعبًا فعليًا عبر Socket.IO`);

    await hostCommand(host, "start-game");
    await waitAllPlayersPhase(players, "role-reveal");
    logPass("مرحلة كشف الأدوار وصلت لجميع اللاعبين");

    for (const player of players) {
      await playerCommand(player, "role-known");
    }
    logPass("جميع اللاعبين أكدوا مشاهدة الدور");

    await roleMap(players);

    const roleCounts = {};
    for (const player of players) roleCounts[player.role] = (roleCounts[player.role] || 0) + 1;
    console.log("  الأدوار:", roleCounts);

    await hostCommand(host, "eyes-closed");
    await waitAllPlayersPhase(players, "eyes-closed");
    logPass("بدأت مرحلة الليل ووصلت للجميع");

    const state = { lastVictimId: null };

    for (let round = 1; round <= rounds; round += 1) {
      console.log(`\n------------------------------------------------`);
      console.log(`الجولة ${round} من ${rounds}`);
      console.log(`------------------------------------------------`);

      await performNight(host, players, state);
      await performVoting(host, players, round);

      if (round < rounds) {
        const next = await hostCommand(host, "next-night");
        assert(next.phase === "eyes-closed", `next-night returned ${next.phase}`);
        await waitAllPlayersPhase(players, "eyes-closed");
        logPass(`بدأت الجولة التالية بنجاح`);
      }
    }

    const duration = ((Date.now() - startedAt) / 1000).toFixed(2);

    console.log("\n================================================");
    console.log("                 TEST PASSED");
    console.log("================================================");
    console.log(`Server          : ${serverUrl}`);
    console.log(`Players tested  : ${playerCount}`);
    console.log(`Rounds tested   : ${rounds}`);
    console.log(`Socket clients  : ${playerCount + 1}`);
    console.log(`Errors          : 0`);
    console.log(`Duration        : ${duration}s`);
    console.log("================================================\n");
  } finally {
    for (const socket of socketsToClose) {
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
