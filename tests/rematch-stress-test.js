import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createRoom, joinPlayer, startGame, resetForRematch } from "../server/gameEngine.js";

const rl = readline.createInterface({ input, output });
const assert = (v, m) => { if (!v) throw new Error(m); };
const pass = m => console.log(`  ✓ ${m}`);

const ids = room => [...room.players.map(p => p.id)].sort();

function assertClean(room, expectedIds) {
  assert(room.status === "waiting", `status=${room.status}`);
  assert(room.phase === "lobby", `phase=${room.phase}`);
  assert(room.activeRole === null, "activeRole not cleared");
  assert(room.nightNumber === 0, "nightNumber not reset");
  assert(room.roundNumber === 1, "roundNumber not reset");
  assert(room.roleRevealStartedAt === null, "roleRevealStartedAt not cleared");
  assert(room.roleRevealEndsAt === null, "roleRevealEndsAt not cleared");
  assert(room.timerEndsAt === null, "timerEndsAt not cleared");
  assert(room.dayStartedAt === null, "dayStartedAt not cleared");
  assert(room.dayEndsAt === null, "dayEndsAt not cleared");
  assert(room.daySummary === null, "daySummary not cleared");
  assert(Object.keys(room.votes || {}).length === 0, "votes not cleared");
  assert(Object.keys(room.votingReady || {}).length === 0, "votingReady not cleared");
  assert(room.votingStartedAt === null, "votingStartedAt not cleared");
  assert(room.votingResult === null, "votingResult not cleared");
  assert(room.currentPardonPlayerId === null, "currentPardonPlayerId not cleared");
  assert(room.winner === null, "winner not cleared");
  assert(room.bestPlayer === null, "bestPlayer not cleared");
  assert((room.completedSteps || []).length === 0, "completedSteps not cleared");
  assert(room.lastTargets?.thief === null, "last thief target not cleared");
  assert(room.lastTargets?.nurse === null, "last nurse target not cleared");
  assert(JSON.stringify(ids(room)) === JSON.stringify(expectedIds), "Player IDs changed");

  for (const p of room.players) {
    assert(p.role === null, `${p.name}: role not cleared`);
    assert(p.roleKnown === false, `${p.name}: roleKnown not reset`);
    assert(p.alive === true, `${p.name}: alive not reset`);
    assert(p.royalPardonsRemaining === 0, `${p.name}: pardons not reset`);
    assert(p.performance?.nurseCorrectSaves === 0, `${p.name}: nurse stats not reset`);
    assert(p.performance?.investigatorThiefFinds === 0, `${p.name}: investigator stats not reset`);
    assert(p.performance?.kingPardonsUsed === 0, `${p.name}: king stats not reset`);
    assert(p.performance?.roundsSurvived === 0, `${p.name}: survival stats not reset`);
  }
}

function dirty(room, n) {
  room.roundNumber = 7 + n;
  room.nightNumber = 6 + n;
  room.phase = "voting-result";
  room.activeRole = "investigator";
  room.roleRevealStartedAt = Date.now() - 10000;
  room.roleRevealEndsAt = Date.now() - 5000;
  room.timerEndsAt = Date.now() - 1000;
  room.dayStartedAt = Date.now() - 5000;
  room.dayEndsAt = Date.now() - 1000;
  room.daySummary = { outcome: "saved" };
  room.votes = { fake: "abstain" };
  room.votingReady = { fake: true };
  room.votingStartedAt = Date.now() - 500;
  room.votingResult = { outcome: "abstain" };
  room.currentPardonPlayerId = room.players[0]?.id || null;
  room.bestPlayer = { playerId: room.players[0]?.id || null };
  room.completedSteps = ["thief", "nurse", "king", "investigator"];
  room.lastTargets = { thief: room.players[1]?.id || null, nurse: room.players[2]?.id || null };

  for (const [i, p] of room.players.entries()) {
    p.roleKnown = true;
    p.alive = i % 2 === 0;
    p.royalPardonsRemaining = 2;
    p.performance = {
      nurseCorrectSaves: 2,
      investigatorThiefFinds: 1,
      kingPardonsUsed: 1,
      roundsSurvived: 5,
    };
  }

  room.winner = n % 2 === 0 ? "citizens" : "thieves";
}

async function main() {
  console.log("\n=== MAFIA REMATCH STRESS TEST ===\n");
  const playerCount = Number(await rl.question("عدد اللاعبين (4 - 20): "));
  const rematches = Number(await rl.question("عدد مرات إعادة اللعبة (1 - 20): "));

  assert(Number.isInteger(playerCount) && playerCount >= 4 && playerCount <= 20, "عدد اللاعبين غير صحيح");
  assert(Number.isInteger(rematches) && rematches >= 1 && rematches <= 20, "عدد مرات الإعادة غير صحيح");

  const room = createRoom({
    hostName: "REMATCH_TEST_HOST",
    roomName: "REMATCH STRESS TEST",
    maxPlayers: playerCount,
    discussionDurationSeconds: 30,
  });

  const originalCode = room.code;

  for (let i = 1; i <= playerCount; i++) {
    joinPlayer(room, {
      name: `Player ${i}`,
      gender: i % 2 === 0 ? "female" : "male",
      avatar: `/avatars/avatar-${String(((i - 1) % 12) + 1).padStart(2, "0")}.png`,
    });
  }

  const originalIds = ids(room);
  let previousSequence = Number(room.matchSequence || 0);

  pass(`الغرفة: ${originalCode}`);
  pass(`اللاعبون: ${playerCount}`);

  for (let match = 1; match <= rematches; match++) {
    console.log(`\n--- المباراة ${match} من ${rematches} ---`);

    startGame(room);

    assert(room.code === originalCode, "Room code changed");
    assert(room.status === "playing", "Game did not start");
    assert(room.phase === "role-reveal", "Wrong start phase");
    assert(room.matchSequence === previousSequence + 1, "matchSequence did not increment");
    assert(room.roundNumber === 1, "New match did not start at round 1");
    assert(room.players.every(p => p.role), "A role was not assigned");
    assert(room.players.every(p => p.alive), "A player started dead");

    previousSequence = room.matchSequence;
    pass(`بدأت المباراة، matchSequence=${room.matchSequence}`);

    dirty(room, match);
    resetForRematch(room);

    assert(room.code === originalCode, "Room code changed after rematch");
    assertClean(room, originalIds);

    pass("تم تنظيف حالة المباراة بالكامل");
    pass("نفس الغرفة ونفس اللاعبين محفوظون");
  }

  console.log("\n=== TEST PASSED ===");
  console.log(`Room code: ${originalCode}`);
  console.log(`Players: ${playerCount}`);
  console.log(`Rematches: ${rematches}`);
  console.log(`Final matchSequence: ${room.matchSequence}`);
  console.log("Errors: 0\n");
}

main()
  .catch(e => {
    console.error("\n=== TEST FAILED ===");
    console.error(e?.stack || e);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
