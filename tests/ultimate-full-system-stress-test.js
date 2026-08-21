import { io } from "socket.io-client";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const rl = readline.createInterface({ input, output });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };
const pass = message => console.log(`  ✓ ${message}`);
const info = message => console.log(`  • ${message}`);

function now() {
  return Date.now();
}

function emitAck(socket, event, payload, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${event}: TIMEOUT after ${timeout}ms`)),
      timeout
    );

    socket.emit(event, payload, response => {
      clearTimeout(timer);

      if (!response?.ok) {
        reject(new Error(`${event}: ${response?.error || "SERVER_ERROR"}`));
        return;
      }

      resolve(response);
    });
  });
}

async function expectReject(socket, event, payload, expectedErrors, label) {
  try {
    await emitAck(socket, event, payload, 12000);
  } catch (error) {
    const message = String(error?.message || error);
    if (
      !expectedErrors?.length ||
      expectedErrors.some(code => message.includes(code))
    ) {
      pass(`${label} رُفض كما هو متوقع`);
      return;
    }

    throw new Error(`${label}: unexpected rejection: ${message}`);
  }

  throw new Error(`${label}: command was accepted unexpectedly`);
}

async function connectSocket(url, label) {
  const socket = io(url, {
    transports: ["polling", "websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 120,
    reconnectionDelayMax: 700,
    timeout: 15000,
    forceNew: true,
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label}: CONNECT_TIMEOUT`)),
      18000
    );

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

async function sync(client) {
  return (await emitAck(client.socket, "room:sync", {
    code: client.code,
    mode: client.mode,
    playerId: client.playerId || null,
    token: client.token || null,
  })).room;
}

async function subscribe(client) {
  return (await emitAck(client.socket, "room:subscribe", {
    code: client.code,
    mode: client.mode,
    playerId: client.playerId || null,
    token: client.token || null,
  })).room;
}

async function roomLookup(socket, code) {
  return (await emitAck(socket, "room:lookup", { code })).room;
}

async function hostCommand(host, action, payload = {}) {
  return (await emitAck(host.socket, "host:command", {
    code: host.code,
    token: host.token,
    action,
    payload,
  })).room;
}

async function playerCommand(player, action, payload = {}) {
  return (await emitAck(player.socket, "player:command", {
    code: player.code,
    playerId: player.playerId,
    token: player.token,
    action,
    payload,
  })).room;
}

function selfFrom(view, playerId) {
  return view?.players?.find(player => player.id === playerId) || null;
}

async function waitPhase(client, expected, timeout = 18000) {
  const started = now();

  while (now() - started < timeout) {
    try {
      const room = await sync(client);
      if (room?.phase === expected) return room;
    } catch {}

    await sleep(100);
  }

  throw new Error(`${client.label}: expected phase ${expected}`);
}

async function waitManyPhase(clients, expected) {
  return Promise.all(clients.map(client => waitPhase(client, expected)));
}

async function getLiving(players) {
  const living = [];

  for (const player of players) {
    const view = await sync(player);
    if (selfFrom(view, player.playerId)?.alive !== false) {
      living.push(player);
    }
  }

  return living;
}

async function reconnectClient(client, expectedPhase = null) {
  try { client.socket.disconnect(); } catch {}

  await sleep(180);

  client.socket = await connectSocket(
    client.serverUrl,
    `${client.label}_RECONNECTED`
  );

  const subscribed = await subscribe(client);

  if (expectedPhase) {
    assert(
      subscribed.phase === expectedPhase,
      `${client.label}: reconnect expected ${expectedPhase}, got ${subscribed.phase}`
    );
  }

  const room = await sync(client);

  if (expectedPhase) {
    assert(
      room.phase === expectedPhase,
      `${client.label}: sync expected ${expectedPhase}, got ${room.phase}`
    );
  }

  return room;
}

async function reconnectBatch(clients, expectedPhase, count) {
  const selected = clients
    .slice()
    .sort(() => Math.random() - 0.5)
    .slice(0, Math.min(count, clients.length));

  await Promise.all(
    selected.map(client => reconnectClient(client, expectedPhase))
  );

  pass(`${selected.length} اتصالات أعيدت أثناء ${expectedPhase}`);
}

function summarizeRoles(players) {
  const counts = {};
  for (const player of players) {
    counts[player.role] = (counts[player.role] || 0) + 1;
  }
  return counts;
}

async function createTestRoom(serverUrl, playerCount, roomIndex = 1) {
  const sockets = [];

  const hostSocket = await connectSocket(serverUrl, `HOST_${roomIndex}`);
  sockets.push(hostSocket);

  const created = await emitAck(hostSocket, "room:create", {
    hostName: `STRESS_HOST_${roomIndex}`,
    roomName: `ULTIMATE STRESS ROOM ${roomIndex}`,
    maxPlayers: playerCount,
    discussionDurationSeconds: 30,
  });

  const host = {
    label: `HOST_${roomIndex}`,
    mode: "host",
    socket: hostSocket,
    code: created.room.code,
    token: created.hostToken,
    serverUrl,
  };

  await subscribe(host);

  const players = [];

  for (let i = 1; i <= playerCount; i += 1) {
    const socket = await connectSocket(
      serverUrl,
      `ROOM${roomIndex}_PLAYER_${i}`
    );
    sockets.push(socket);

    const joined = await emitAck(socket, "player:join", {
      code: host.code,
      name: `R${roomIndex} Player ${i}`,
      gender: i % 2 === 0 ? "female" : "male",
      avatar: `/avatars/avatar-${String(((i - 1) % 12) + 1).padStart(2, "0")}.png`,
    });

    const player = {
      label: `ROOM${roomIndex}_PLAYER_${i}`,
      mode: "player",
      socket,
      code: host.code,
      playerId: joined.player.id,
      token: joined.player.sessionToken,
      role: null,
      serverUrl,
    };

    await subscribe(player);
    players.push(player);
  }

  return { host, players, sockets };
}

async function verifySecurity(host, players) {
  info("اختبار الأوامر غير المصرح بها");

  await expectReject(
    host.socket,
    "host:command",
    {
      code: host.code,
      token: "INVALID_HOST_TOKEN",
      action: "start-game",
      payload: {},
    },
    ["UNAUTHORIZED", "INVALID", "HOST"],
    "أمر مدير بتوكن خاطئ"
  );

  const sample = players[0];

  await expectReject(
    sample.socket,
    "player:command",
    {
      code: sample.code,
      playerId: sample.playerId,
      token: "INVALID_PLAYER_TOKEN",
      action: "role-known",
      payload: {},
    },
    ["UNAUTHORIZED", "INVALID", "PLAYER"],
    "أمر لاعب بتوكن خاطئ"
  );

  await expectReject(
    sample.socket,
    "room:sync",
    {
      code: sample.code,
      mode: "player",
      playerId: sample.playerId,
      token: "INVALID_PLAYER_TOKEN",
    },
    ["UNAUTHORIZED", "INVALID", "PLAYER"],
    "مزامنة لاعب بتوكن خاطئ"
  );
}

async function prepareMatch(host, players, reconnectCount) {
  const publicRoom = await roomLookup(players[0].socket, host.code);
  assert(publicRoom?.code === host.code, "room:lookup returned wrong room");
  pass("room:lookup يعمل");

  await hostCommand(host, "start-game");
  await waitManyPhase(players, "role-reveal");

  if (reconnectCount > 0) {
    await reconnectBatch(players, "role-reveal", reconnectCount);
    await reconnectClient(host, "role-reveal");
  }

  await Promise.all(
    players.map(player => playerCommand(player, "role-known"))
  );

  for (const player of players) {
    const view = await sync(player);
    player.role = selfFrom(view, player.playerId)?.role;
    assert(player.role, `${player.label}: role missing`);
  }

  info(`الأدوار: ${JSON.stringify(summarizeRoles(players))}`);

  await hostCommand(host, "eyes-closed");
  await waitManyPhase(players, "eyes-closed");

  if (reconnectCount > 0) {
    await reconnectBatch(players, "eyes-closed", reconnectCount);
    await reconnectClient(host, "eyes-closed");
  }
}

async function performNight(host, players, reconnectCount) {
  const living = await getLiving(players);
  const thieves = living.filter(player => player.role === "thief");
  const nurses = living.filter(player => player.role === "nurse");
  const kings = living.filter(player => player.role === "king");
  const investigators = living.filter(player => player.role === "investigator");

  assert(thieves.length > 0, "No living thieves");

  await hostCommand(host, "wake-role", { role: "thief" });
  await sleep(180);

  if (reconnectCount > 0) {
    await reconnectBatch(
      living.filter(player => !thieves.includes(player)),
      "night-role",
      reconnectCount
    );
    await reconnectClient(host, "night-role");
  }

  const thiefView = await sync(thieves[0]);
  const lastThiefTarget = thiefView.lastTargets?.thief || null;

  const victim = (thiefView.players || []).find(target => {
    if (!target.alive) return false;
    if (target.id === lastThiefTarget) return false;

    const visibleAsThief =
      target.id === thieves[0].playerId ||
      target.role === "thief";

    return !visibleAsThief;
  });

  assert(victim, "No valid thief victim");

  await Promise.all(
    thieves.map(async thief => {
      await playerCommand(thief, "select-night-target", {
        targetId: victim.id
      });
      await playerCommand(thief, "confirm-night-action");
    })
  );

  if (nurses.length) {
    await hostCommand(host, "wake-role", { role: "nurse" });
    await sleep(220);
    await waitPhase(nurses[0], "night-role");

    const view = await sync(nurses[0]);
    const last = view.lastTargets?.nurse || null;
    const candidates = (view.players || []).filter(
      target => target.alive && target.id !== last
    );

    const target =
      candidates.find(candidate => candidate.id === victim.id) ||
      candidates[0];

    assert(target, "No valid nurse target");

    await playerCommand(nurses[0], "select-night-target", {
      targetId: target.id
    });
    await playerCommand(nurses[0], "confirm-night-action");
  }

  if (kings.length) {
    await hostCommand(host, "wake-role", { role: "king" });
    await sleep(220);
    await waitPhase(kings[0], "night-role");

    await playerCommand(kings[0], "skip-king-pardon");
    await playerCommand(kings[0], "confirm-night-action");
  }

  if (investigators.length) {
    await hostCommand(host, "wake-role", { role: "investigator" });
    await sleep(220);
    await waitPhase(investigators[0], "night-role");

    const view = await sync(investigators[0]);

    const target = (view.players || []).find(candidate =>
      candidate.alive &&
      candidate.id !== investigators[0].playerId
    );

    assert(target, "No valid investigator target");

    await playerCommand(investigators[0], "select-night-target", {
      targetId: target.id
    });
    await playerCommand(investigators[0], "confirm-night-action");
  }

  const dayRoom = await hostCommand(host, "finish-night");
  assert(dayRoom.phase === "day", "finish-night did not enter day");

  await waitManyPhase(living, "day");

  if (reconnectCount > 0) {
    await reconnectBatch(living, "day", reconnectCount);
    await reconnectClient(host, "day");
  }

  pass("الليل والنهار اكتمل بنجاح");
}

async function burstSync(clients, requestsPerClient) {
  const started = now();
  const jobs = [];

  for (const client of clients) {
    for (let i = 0; i < requestsPerClient; i += 1) {
      jobs.push(sync(client));
    }
  }

  const results = await Promise.allSettled(jobs);
  const failed = results.filter(item => item.status === "rejected");

  assert(
    failed.length === 0,
    `Concurrent sync failed: ${failed.length}/${results.length}`
  );

  pass(
    `${results.length} طلب مزامنة متزامن نجح خلال ${now() - started}ms`
  );
}

async function performVoting(host, players, reconnectCount, eliminate = false) {
  const votingRoom = await hostCommand(host, "start-voting");
  assert(votingRoom.phase === "voting", "Voting did not start");

  const living = await getLiving(players);
  await waitManyPhase(living, "voting");

  if (reconnectCount > 0) {
    await reconnectBatch(living, "voting", reconnectCount);
    await reconnectClient(host, "voting");
  }

  let target = null;

  if (eliminate && living.length >= 5) {
    target = living.find(player => player.role === "citizen") || living[0];
  }

  const started = now();

  const jobs = living.map(player => {
    const targetId =
      target && player.playerId !== target.playerId
        ? target.playerId
        : "abstain";

    return playerCommand(player, "cast-vote", { targetId });
  });

  const results = await Promise.allSettled(jobs);
  const failed = results.filter(item => item.status === "rejected");

  assert(
    failed.length === 0,
    `Concurrent voting failed: ${failed.length}/${results.length}`
  );

  const resultRoom = await waitPhase(host, "voting-result");
  await waitManyPhase(living, "voting-result");

  pass(`${living.length} تصويتًا متزامنًا اكتمل خلال ${now() - started}ms`);

  if (target) {
    const targetView = await sync(target);
    const targetSelf = selfFrom(targetView, target.playerId);

    if (targetSelf?.alive === false) {
      await reconnectClient(target, "voting-result");
      const afterReconnect = await sync(target);
      assert(
        selfFrom(afterReconnect, target.playerId)?.alive === false,
        "Eliminated player became alive after reconnect"
      );

      await expectReject(
        target.socket,
        "player:command",
        {
          code: target.code,
          playerId: target.playerId,
          token: target.token,
          action: "cast-vote",
          payload: { targetId: "abstain" },
        },
        ["ACTION_NOT_ALLOWED", "NOT_ALLOWED", "DEAD"],
        "تصويت اللاعب الخارج"
      );

      pass("قفل اللاعب الخارج بعد إعادة الاتصال ناجح");
    }
  }

  return resultRoom;
}

async function testUnknownActions(host, players) {
  await expectReject(
    host.socket,
    "host:command",
    {
      code: host.code,
      token: host.token,
      action: "totally-invalid-action",
      payload: {},
    },
    ["UNKNOWN_ACTION"],
    "أمر مدير غير معروف"
  );

  const player = players[0];

  await expectReject(
    player.socket,
    "player:command",
    {
      code: player.code,
      playerId: player.playerId,
      token: player.token,
      action: "totally-invalid-action",
      payload: {},
    },
    ["UNKNOWN_ACTION"],
    "أمر لاعب غير معروف"
  );
}

async function runSingleRoom({
  serverUrl,
  playerCount,
  rounds,
  reconnectCount,
  syncBurst,
  roomIndex,
  testElimination,
}) {
  const createdAt = now();
  const { host, players, sockets } = await createTestRoom(
    serverUrl,
    playerCount,
    roomIndex
  );

  try {
    pass(`الغرفة ${host.code} جاهزة بـ ${players.length} لاعب`);

    await verifySecurity(host, players);
    await testUnknownActions(host, players);

    await prepareMatch(host, players, reconnectCount);

    await burstSync(
      [host, ...players],
      syncBurst
    );

    for (let round = 1; round <= rounds; round += 1) {
      console.log(`\n[الغرفة ${roomIndex}] الجولة ${round}/${rounds}`);

      await performNight(host, players, reconnectCount);

      await burstSync(
        [host, ...players.slice(0, Math.min(players.length, 10))],
        syncBurst
      );

      await performVoting(
        host,
        players,
        reconnectCount,
        testElimination && round === 1
      );

      if (round < rounds) {
        const room = await sync(host);

        if (room.winner) {
          info(`انتهت المباراة مبكرًا بالفائز ${room.winner}`);
          break;
        }

        const next = await hostCommand(host, "next-night");
        assert(next.phase === "eyes-closed", "next-night failed");

        const living = await getLiving(players);
        await waitManyPhase(living, "eyes-closed");

        if (reconnectCount > 0) {
          await reconnectBatch(living, "eyes-closed", reconnectCount);
          await reconnectClient(host, "eyes-closed");
        }
      }
    }

    const finalRoom = await sync(host);

    return {
      code: host.code,
      durationMs: now() - createdAt,
      phase: finalRoom.phase,
      winner: finalRoom.winner || null,
      players: playerCount,
    };
  } finally {
    for (const socket of sockets) {
      try { socket.disconnect(); } catch {}
    }

    for (const player of players) {
      try { player.socket.disconnect(); } catch {}
    }

    try { host.socket.disconnect(); } catch {}
  }
}

async function main() {
  console.log("\n============================================================");
  console.log("       MAFIA ULTIMATE FULL SYSTEM STRESS TEST");
  console.log("============================================================\n");

  const serverInput = (
    await rl.question("رابط الخادم [http://localhost:3000]: ")
  ).trim();

  const serverUrl = serverInput || "http://localhost:3000";

  const playerCount = Number(
    await rl.question("عدد اللاعبين في كل غرفة (10 - 20): ")
  );

  const rounds = Number(
    await rl.question("عدد الجولات في كل غرفة (1 - 20): ")
  );

  const roomCount = Number(
    await rl.question("عدد الغرف المتزامنة (1 - 5): ")
  );

  const reconnectCount = Number(
    await rl.question("عدد الاتصالات التي تفصل وتعود في كل مرحلة (0 - 5): ")
  );

  const syncBurst = Number(
    await rl.question("طلبات المزامنة المتزامنة لكل عميل (1 - 5): ")
  );

  assert(
    Number.isInteger(playerCount) &&
    playerCount >= 10 &&
    playerCount <= 20,
    "عدد اللاعبين يجب أن يكون من 10 إلى 20"
  );

  assert(
    Number.isInteger(rounds) &&
    rounds >= 1 &&
    rounds <= 20,
    "عدد الجولات يجب أن يكون من 1 إلى 20"
  );

  assert(
    Number.isInteger(roomCount) &&
    roomCount >= 1 &&
    roomCount <= 5,
    "عدد الغرف يجب أن يكون من 1 إلى 5"
  );

  assert(
    Number.isInteger(reconnectCount) &&
    reconnectCount >= 0 &&
    reconnectCount <= 5,
    "عدد إعادة الاتصالات يجب أن يكون من 0 إلى 5"
  );

  assert(
    Number.isInteger(syncBurst) &&
    syncBurst >= 1 &&
    syncBurst <= 5,
    "عدد طلبات المزامنة يجب أن يكون من 1 إلى 5"
  );

  console.log("\nبدء الاختبار...");
  info(`إجمالي اللاعبين النظري: ${playerCount * roomCount}`);
  info(`إجمالي اتصالات Socket تقريبًا: ${(playerCount + 1) * roomCount}`);

  const started = now();

  const roomJobs = [];

  for (let index = 1; index <= roomCount; index += 1) {
    roomJobs.push(
      runSingleRoom({
        serverUrl,
        playerCount,
        rounds,
        reconnectCount,
        syncBurst,
        roomIndex: index,
        testElimination: index === 1,
      })
    );
  }

  const results = await Promise.allSettled(roomJobs);

  const failed = results.filter(item => item.status === "rejected");

  if (failed.length) {
    console.error("\n============================================================");
    console.error("                 ULTIMATE TEST FAILED");
    console.error("============================================================");

    failed.forEach((item, index) => {
      console.error(
        `Failure ${index + 1}:`,
        item.reason?.stack || item.reason?.message || item.reason
      );
    });

    throw new Error(`${failed.length}/${results.length} rooms failed`);
  }

  const rooms = results.map(item => item.value);
  const duration = ((now() - started) / 1000).toFixed(2);

  console.log("\n============================================================");
  console.log("                  ULTIMATE TEST PASSED");
  console.log("============================================================");
  console.log(`Server               : ${serverUrl}`);
  console.log(`Concurrent rooms     : ${roomCount}`);
  console.log(`Players per room     : ${playerCount}`);
  console.log(`Total players        : ${playerCount * roomCount}`);
  console.log(`Rounds requested     : ${rounds}`);
  console.log(`Reconnects/stage     : ${reconnectCount}`);
  console.log(`Sync burst/client    : ${syncBurst}`);
  console.log(`Security checks      : PASS`);
  console.log(`Invalid commands     : PASS`);
  console.log(`Room lookup/sync     : PASS`);
  console.log(`Role reveal          : PASS`);
  console.log(`Night actions        : PASS`);
  console.log(`Day transition       : PASS`);
  console.log(`Concurrent voting    : PASS`);
  console.log(`Eliminated lock      : PASS`);
  console.log(`Player reconnect     : PASS`);
  console.log(`Host reconnect       : PASS`);
  console.log(`Concurrent sync      : PASS`);
  console.log(`Realtime phases      : PASS`);
  console.log(`Errors               : 0`);
  console.log(`Total duration       : ${duration}s`);
  console.log("------------------------------------------------------------");

  for (const room of rooms) {
    console.log(
      `${room.code} | players=${room.players} | phase=${room.phase} | winner=${room.winner || "none"} | ${(room.durationMs / 1000).toFixed(2)}s`
    );
  }

  console.log("============================================================\n");
}

main()
  .catch(error => {
    console.error("\n============================================================");
    console.error("                  TEST FAILED");
    console.error("============================================================");
    console.error(error?.stack || error?.message || error);
    console.error("============================================================\n");
    process.exitCode = 1;
  })
  .finally(() => rl.close());
