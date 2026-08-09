const createEmptyMatchStats = () => ({
  votes: [],
  successfulNurseSaves: [],
  kingThiefReveals: [],
  eliminationRounds: {},
  finalResults: null,
  applied: false,
});

/**
 * يتأكد من وجود بيانات الإحصائيات الخاصة بالمباراة الحالية.
 */
export function ensureMatchStats(gameState) {
  if (!gameState.matchStats) {
    gameState.matchStats = createEmptyMatchStats();
  }

  if (!Array.isArray(gameState.matchStats.votes)) {
    gameState.matchStats.votes = [];
  }

  if (!Array.isArray(gameState.matchStats.successfulNurseSaves)) {
    gameState.matchStats.successfulNurseSaves = [];
  }

  if (!Array.isArray(gameState.matchStats.kingThiefReveals)) {
    gameState.matchStats.kingThiefReveals = [];
  }

  if (
    !gameState.matchStats.eliminationRounds ||
    typeof gameState.matchStats.eliminationRounds !== "object"
  ) {
    gameState.matchStats.eliminationRounds = {};
  }

  return gameState.matchStats;
}

/**
 * يعيد إحصائيات المباراة إلى حالتها الأساسية.
 * تُستخدم عند بدء مباراة جديدة أو إعادة اللعب.
 */
export function resetMatchStats(gameState) {
  gameState.matchStats = createEmptyMatchStats();

  return gameState.matchStats;
}

/**
 * يسجل التصويت بعد تأكيد اللاعب لاختياره.
 *
 * النقطة تُسجل بصورة صامتة إذا كان الهدف لصًا،
 * حتى لو لم يخرج اللص من المباراة.
 */
export function recordPlayerVote({
  gameState,
  round,
  voterId,
  targetId,
  targetRole,
}) {
  const matchStats = ensureMatchStats(gameState);

  if (!voterId || !targetId) {
    return {
      recorded: false,
      reason: "missing-player-id",
      pointsAwarded: 0,
    };
  }

  const normalizedRound = Number(round) || 1;

  const existingVote = matchStats.votes.find(
    (vote) =>
      vote.round === normalizedRound &&
      vote.voterId === voterId,
  );

  if (existingVote) {
    return {
      recorded: false,
      reason: "vote-already-recorded",
      pointsAwarded: existingVote.pointsAwarded,
      vote: existingVote,
    };
  }

  const isCorrectThiefVote = targetRole === "thief";

  const voteRecord = {
    round: normalizedRound,
    voterId,
    targetId,
    isCorrectThiefVote,
    pointsAwarded: isCorrectThiefVote ? 1 : 0,
  };

  matchStats.votes.push(voteRecord);

  return {
    recorded: true,
    reason: null,
    pointsAwarded: voteRecord.pointsAwarded,
    vote: voteRecord,
  };
}

/**
 * يعيد عدد نقاط التصويت الصحيح للاعب في المباراة الحالية.
 */
export function getPlayerCorrectVotePoints(gameState, playerId) {
  const matchStats = ensureMatchStats(gameState);

  return matchStats.votes.reduce((total, vote) => {
    if (
      vote.voterId === playerId &&
      vote.isCorrectThiefVote
    ) {
      return total + 1;
    }

    return total;
  }, 0);
}

/**
 * يعيد جميع التصويتات الخاصة بلاعب معين.
 */
export function getPlayerVoteHistory(gameState, playerId) {
  const matchStats = ensureMatchStats(gameState);

  return matchStats.votes.filter(
    (vote) => vote.voterId === playerId,
  );
}

/**
 * يعيد نسخة من إحصائيات المباراة دون السماح بتعديل الأصل مباشرة.
 */
export function getMatchStatsSnapshot(gameState) {
  const matchStats = ensureMatchStats(gameState);

  return structuredClone(matchStats);
}