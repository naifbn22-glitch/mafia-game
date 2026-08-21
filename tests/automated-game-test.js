import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  createRoom,
  joinPlayer,
  startGame,
  markRoleKnown,
  beginEyesClosed,
  wakeRole,
  allowedTargets,
  selectNightTarget,
  skipKingPardon,
  confirmNightAction,
  finishNight,
  startVoting,
  castVote,
  beginNextNight,
  hostProjection,
  publicProjection,
  playerProjection,
} from "../server/gameEngine.js";

const rl = readline.createInterface({ input, output });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pass(message) {
  console.log(`  ✓ ${message}`);
}

function getAlive(room, role = null) {
  return room.players.filter(p => p.alive && (!role || p.role === role));
}

function chooseCommonThiefTarget(room, thieves) {
  const first = thieves[0];
  const firstTargets = allowedTargets(room, first);
  for (const candidate of firstTargets) {
    if (thieves.every(thief => allowedTargets(room, thief).some(t => t.id === candidate.id))) {
      return candidate;
    }
  }
  return null;
}

function validatePhaseForAllViews(room, expected) {
  const host = hostProjection(room);
  const live = publicProjection(room);

  assert(host.phase === expected, `Host phase expected ${expected}, got ${host.phase}`);
  assert(live.phase === expected, `Live phase expected ${expected}, got ${live.phase}`);

  for (const player of room.players) {
    const view = playerProjection(room, player);
    assert(
      view.phase === expected,
      `Player ${player.name} phase expected ${expected}, got ${view.phase}`,
    );
  }
}

function executeNight(room) {
  const thieves = getAlive(room, "thief");
  const nurse = getAlive(room, "nurse")[0] || null;
  const king = getAlive(room, "king")[0] || null;
  const investigator = getAlive(room, "investigator")[0] || null;

  assert(thieves.length > 0, "No living thieves available for stress test");

  // اللصوص يختارون نفس الضحية.
  wakeRole(room, "thief");
  const victim = chooseCommonThiefTarget(room, thieves);
  assert(victim, "No common valid thief target");

  for (const thief of thieves) {
    selectNightTarget(room, thief, victim.id);
    confirmNightAction(room, thief);
  }
  pass(`اللصوص أكدوا الضحية: ${victim.name}`);

  // الممرض ينقذ نفس ضحية اللصوص، حتى تستمر المباراة لعشرات الجولات.
  if (nurse) {
    wakeRole(room, "nurse");
    const nurseCanSaveVictim = allowedTargets(room, nurse).some(t => t.id === victim.id);
    assert(nurseCanSaveVictim, `Nurse cannot save current victim ${victim.name}`);
    selectNightTarget(room, nurse, victim.id);
    confirmNightAction(room, nurse);
    pass(`الممرض أنقذ الضحية: ${victim.name}`);
  }

  // الملك يحتفظ بالعفو حتى لا يؤثر على اختبار التصويت.
  if (king) {
    wakeRole(room, "king");
    skipKingPardon(room, king);
    confirmNightAction(room, king);
    pass("الملك أكد عدم استخدام العفو");
  }

  if (investigator) {
    wakeRole(room, "investigator");
    const target = allowedTargets(room, investigator)[0];
    assert(target, "No valid investigator target");
    selectNightTarget(room, investigator, target.id);
    confirmNightAction(room, investigator);
    pass(`المحقق أكمل التحقيق على: ${target.name}`);
  }

  finishNight(room);
  assert(room.phase === "day", `finishNight did not enter day, got ${room.phase}`);
  assert(!room.winner, `Game ended unexpectedly after night. Winner: ${room.winner}`);
  assert(room.daySummary?.outcome === "saved", `Expected saved night outcome, got ${room.daySummary?.outcome}`);
  validatePhaseForAllViews(room, "day");
  pass("الانتقال إلى النهار يعمل لجميع الإسقاطات");
}

function executeVoting(room, roundIndex) {
  // نختبر نصف الجولات قبل انتهاء المؤقت، والنصف الآخر بعد انتهائه.
  const simulateExpiredTimer = roundIndex % 2 === 0;

  if (simulateExpiredTimer) {
    room.dayEndsAt = Date.now() - 5_000;
    room.timerEndsAt = room.dayEndsAt;
    pass("اختبار التصويت بعد انتهاء المؤقت");
  } else {
    room.dayEndsAt = Date.now() + 60_000;
    room.timerEndsAt = room.dayEndsAt;
    pass("اختبار التصويت قبل انتهاء المؤقت");
  }

  startVoting(room);

  assert(room.phase === "voting", `startVoting failed. Current phase: ${room.phase}`);
  validatePhaseForAllViews(room, "voting");
  pass("صفحة التصويت متاحة للمدير والبث وجميع اللاعبين");

  const alive = getAlive(room);
  assert(alive.length >= 3, `Too few alive players: ${alive.length}`);

  // الجميع يمتنع، فتظهر نتيجة بدون إخراج أي لاعب.
  for (const player of alive) {
    castVote(room, player, "abstain");
  }

  assert(room.phase === "voting-result", `Voting did not resolve. Current phase: ${room.phase}`);
  assert(room.votingResult?.outcome === "abstain", `Expected abstain result, got ${room.votingResult?.outcome}`);
  assert(!room.winner, `Game ended unexpectedly after voting. Winner: ${room.winner}`);
  validatePhaseForAllViews(room, "voting-result");
  pass("التصويت والنتيجة اكتملتا بدون إخراج لاعب");
}

async function main() {
  console.log("\n========================================");
  console.log("   MAFIA AUTOMATED ROUND STRESS TEST");
  console.log("========================================\n");

  const playerCount = Number(await rl.question("عدد اللاعبين للاختبار (4 - 20): "));
  const rounds = Number(await rl.question("عدد الجولات للاختبار (10 - 20): "));

  assert(Number.isInteger(playerCount) && playerCount >= 4 && playerCount <= 20, "عدد اللاعبين يجب أن يكون من 4 إلى 20");
  assert(Number.isInteger(rounds) && rounds >= 10 && rounds <= 20, "عدد الجولات يجب أن يكون من 10 إلى 20");

  const room = createRoom({
    hostName: "AUTO_TEST_HOST",
    roomName: "AUTOMATED TEST ROOM",
    maxPlayers: playerCount,
    discussionDurationSeconds: 30,
  });

  pass(`تم إنشاء الغرفة ${room.code}`);

  for (let i = 1; i <= playerCount; i += 1) {
    joinPlayer(room, {
      name: `Player ${i}`,
      gender: i % 2 === 0 ? "female" : "male",
      avatar: `/avatars/avatar-${String(((i - 1) % 12) + 1).padStart(2, "0")}.png`,
    });
  }

  assert(room.players.length === playerCount, "Player join count mismatch");
  pass(`تمت إضافة ${playerCount} لاعبًا`);

  startGame(room);
  assert(room.phase === "role-reveal", "Game did not enter role-reveal");
  pass("بدأت المباراة وتم توزيع الأدوار");

  for (const player of room.players) markRoleKnown(room, player);
  assert(room.players.every(p => p.roleKnown), "Not all roles marked known");
  pass("جميع اللاعبين كشفوا أدوارهم");

  beginEyesClosed(room);
  assert(room.phase === "eyes-closed", "Game did not enter eyes-closed");
  pass("بدأت الليلة الأولى");

  const startedAt = Date.now();

  for (let round = 1; round <= rounds; round += 1) {
    console.log(`\n----------------------------------------`);
    console.log(`الجولة ${round} من ${rounds}`);
    console.log(`----------------------------------------`);

    assert(room.roundNumber === round, `Expected roundNumber ${round}, got ${room.roundNumber}`);
    assert(room.phase === "eyes-closed", `Round ${round} must start at eyes-closed, got ${room.phase}`);

    executeNight(room);
    executeVoting(room, round);

    if (round < rounds) {
      beginNextNight(room);
      assert(room.phase === "eyes-closed", `beginNextNight failed after round ${round}`);
      assert(room.roundNumber === round + 1, `Round number did not advance after round ${round}`);
      pass(`تم تجهيز الجولة ${round + 1}`);
    }
  }

  const duration = ((Date.now() - startedAt) / 1000).toFixed(2);

  console.log("\n========================================");
  console.log("             TEST PASSED");
  console.log("========================================");
  console.log(`Players tested : ${playerCount}`);
  console.log(`Rounds tested  : ${rounds}`);
  console.log(`Final phase    : ${room.phase}`);
  console.log(`Winner         : ${room.winner || "none (stress mode)"}`);
  console.log(`Errors         : 0`);
  console.log(`Duration       : ${duration}s`);
  console.log("========================================\n");
}

main()
  .catch(error => {
    console.error("\n========================================");
    console.error("             TEST FAILED");
    console.error("========================================");
    console.error(error?.stack || error?.message || error);
    console.error("========================================\n");
    process.exitCode = 1;
  })
  .finally(() => rl.close());
