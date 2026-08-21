import { io } from "socket.io-client";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const rl = readline.createInterface({ input, output });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };
const pass = message => console.log(`  ✓ ${message}`);

function emitAck(socket, event, payload, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event}: TIMEOUT`)), timeout);

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

async function connectSocket(url, label) {
  const socket = io(url, {
    transports: ["polling", "websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 150,
    reconnectionDelayMax: 800,
    timeout: 12000,
    forceNew: true,
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label}: CONNECT_TIMEOUT`)),
      15000
    );

    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });

    socket.once("connect_error", error => {
      clearTimeout(timer);
      reject(error);
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

function me(view, playerId) {
  return view?.players?.find(player => player.id === playerId) || null;
}

async function waitPhase(client, expectedPhase, timeout = 15000) {
  const started = Date.now();

  while (Date.now() - started < timeout) {
    try {
      const room = await sync(client);
      if (room?.phase === expectedPhase) return room;
    } catch {}

    await sleep(120);
  }

  throw new Error(`${client.label}: expected phase ${expectedPhase}`);
}

async function reconnectPlayer(player, expectedPhase) {
  try { player.socket.disconnect(); } catch {}

  await sleep(250);

  player.socket = await connectSocket(
    player.serverUrl,
    `${player.label}_RECONNECTED`
  );

  await subscribe(player);

  const room = await sync(player);
  assert(
    room.phase === expectedPhase,
    `${player.label}: expected ${expectedPhase} after reconnect, got ${room.phase}`
  );

  const self = me(room, player.playerId);
  assert(self, `${player.label}: identity lost after reconnect`);

  return room;
}

async function reconnectMany(players, expectedPhase, count) {
  const selected = players.slice(0, Math.min(count, players.length));

  await Promise.all(
    selected.map(player => reconnectPlayer(player, expectedPhase))
  );

  pass(`${selected.length} لاعبين أعادوا الاتصال أثناء ${expectedPhase}`);
}

async function setup(serverUrl, playerCount) {
  const allSockets = [];

  const hostSocket = await connectSocket(serverUrl, "HOST");
  allSockets.push(hostSocket);

  const created = await emitAck(hostSocket, "room:create", {
    hostName: "CONCURRENT_STRESS_HOST",
    roomName: "CONCURRENT STRESS TEST",
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

  for (let i = 1; i <= playerCount; i += 1) {
    const socket = await connectSocket(serverUrl, `PLAYER_${i}`);
    allSockets.push(socket);

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
      role: null,
      serverUrl,
    };

    await subscribe(player);
    players.push(player);
  }

  return { host, players, allSockets };
}

async function prepareGame(host, players) {
  await hostCommand(host, "start-game");

  await Promise.all(
    players.map(player => waitPhase(player, "role-reveal"))
  );

  await Promise.all(
    players.map(player => playerCommand(player, "role-known"))
  );

  for (const player of players) {
    const view = await sync(player);
    player.role = me(view, player.playerId)?.role;
  }

  await hostCommand(host, "eyes-closed");

  await Promise.all(
    players.map(player => waitPhase(player, "eyes-closed"))
  );
}

async function getLiving(players) {
  const living = [];

  for (const player of players) {
    const view = await sync(player);
    if (me(view, player.playerId)?.alive !== false) living.push(player);
  }

  return living;
}

async function performNight(host, players, reconnectCount) {
  const living = await getLiving(players);

  const thieves = living.filter(player => player.role === "thief");
  const nurses = living.filter(player => player.role === "nurse");
  const kings = living.filter(player => player.role === "king");
  const investigators = living.filter(player => player.role === "investigator");

  assert(thieves.length > 0, "No living thief");

  await hostCommand(host, "wake-role", { role: "thief" });
  await sleep(200);

  if (reconnectCount > 0) {
    const candidates = living.filter(player => !thieves.includes(player));
    await reconnectMany(candidates, "night-role", reconnectCount);
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

  assert(victim, "No valid thief target");

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
    await sleep(250);
    await waitPhase(nurses[0], "night-role");

    const view = await sync(nurses[0]);
    const lastNurseTarget = view.lastTargets?.nurse || null;

    const candidates = (view.players || []).filter(target =>
      target.alive && target.id !== lastNurseTarget
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
    await sleep(250);
    await waitPhase(kings[0], "night-role");

    await playerCommand(kings[0], "skip-king-pardon");
    await playerCommand(kings[0], "confirm-night-action");
  }

  if (investigators.length) {
    await hostCommand(host, "wake-role", { role: "investigator" });
    await sleep(250);
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
  assert(dayRoom.phase === "day", `finish-night returned ${dayRoom.phase}`);

  await Promise.all(
    living.map(player => waitPhase(player, "day"))
  );

  pass("مرحلة النهار وصلت لجميع اللاعبين الأحياء");
}

async function performConcurrentVoting(host, players, reconnectCount) {
  const votingRoom = await hostCommand(host, "start-voting");
  assert(votingRoom.phase === "voting", "Voting phase did not start");

  const living = await getLiving(players);

  await Promise.all(
    living.map(player => waitPhase(player, "voting"))
  );

  if (reconnectCount > 0) {
    await reconnectMany(living, "voting", reconnectCount);
  }

  const startedAt = Date.now();

  const results = await Promise.allSettled(
    living.map(player =>
      playerCommand(player, "cast-vote", { targetId: "abstain" })
    )
  );

  const failed = results.filter(result => result.status === "rejected");

  if (failed.length) {
    throw new Error(
      `${failed.length} concurrent votes failed: ${failed
        .map(item => item.reason?.message || "unknown")
        .join(" | ")}`
    );
  }

  const elapsed = Date.now() - startedAt;

  const resultRoom = await waitPhase(host, "voting-result");
  assert(resultRoom.votingResult, "Voting result missing");

  await Promise.all(
    living.map(player => waitPhase(player, "voting-result"))
  );

  pass(`${living.length} تصويتًا متزامنًا نجح خلال ${elapsed}ms`);
}

async function burstSync(players, countPerPlayer) {
  const startedAt = Date.now();

  const jobs = [];

  for (const player of players) {
    for (let i = 0; i < countPerPlayer; i += 1) {
      jobs.push(sync(player));
    }
  }

  const results = await Promise.allSettled(jobs);
  const failures = results.filter(result => result.status === "rejected");

  if (failures.length) {
    throw new Error(
      `Burst sync failed: ${failures.length}/${results.length}`
    );
  }

  pass(
    `${results.length} طلب مزامنة متزامن نجح خلال ${Date.now() - startedAt}ms`
  );
}

async function main() {
  console.log("\n================================================");
  console.log("    MAFIA CONCURRENT ONLINE STRESS TEST");
  console.log("================================================\n");

  const serverInput = (
    await rl.question("رابط الخادم [http://localhost:3000]: ")
  ).trim();

  const serverUrl = serverInput || "http://localhost:3000";

  const playerCount = Number(
    await rl.question("عدد اللاعبين (10 - 20): ")
  );

  const rounds = Number(
    await rl.question("عدد الجولات (1 - 10): ")
  );

  const reconnectCount = Number(
    await rl.question("عدد اللاعبين الذين يفصلون ويعودون بكل جولة (0 - 5): ")
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
    rounds <= 10,
    "عدد الجولات يجب أن يكون من 1 إلى 10"
  );

  assert(
    Number.isInteger(reconnectCount) &&
    reconnectCount >= 0 &&
    reconnectCount <= 5,
    "عدد إعادة الاتصالات يجب أن يكون من 0 إلى 5"
  );

  const startedAt = Date.now();

  const { host, players, allSockets } = await setup(
    serverUrl,
    playerCount
  );

  try {
    pass(`تم إنشاء الغرفة ${host.code}`);
    pass(`اتصل ${players.length} لاعبًا`);

    await prepareGame(host, players);
    pass("بدأت المباراة ووصلت مرحلة الليل للجميع");

    await burstSync(players, 2);

    for (let round = 1; round <= rounds; round += 1) {
      console.log(`\n--- الجولة ${round} من ${rounds} ---`);

      await performNight(
        host,
        players,
        reconnectCount
      );

      await burstSync(
        players.slice(0, Math.min(players.length, 10)),
        2
      );

      await performConcurrentVoting(
        host,
        players,
        reconnectCount
      );

      if (round < rounds) {
        const next = await hostCommand(host, "next-night");

        assert(
          next.phase === "eyes-closed",
          `next-night returned ${next.phase}`
        );

        const living = await getLiving(players);

        await Promise.all(
          living.map(player => waitPhase(player, "eyes-closed"))
        );

        pass("بدأت الجولة التالية بنجاح");
      }
    }

    const duration = ((Date.now() - startedAt) / 1000).toFixed(2);

    console.log("\n================================================");
    console.log("                 TEST PASSED");
    console.log("================================================");
    console.log(`Server             : ${serverUrl}`);
    console.log(`Players tested     : ${playerCount}`);
    console.log(`Rounds tested      : ${rounds}`);
    console.log(`Reconnects/round   : ${reconnectCount}`);
    console.log(`Concurrent voting  : PASS`);
    console.log(`Concurrent sync    : PASS`);
    console.log(`Realtime phases    : PASS`);
    console.log(`Errors             : 0`);
    console.log(`Duration           : ${duration}s`);
    console.log("================================================\n");
  } finally {
    for (const socket of allSockets) {
      try { socket.disconnect(); } catch {}
    }

    for (const player of players) {
      try { player.socket.disconnect(); } catch {}
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
