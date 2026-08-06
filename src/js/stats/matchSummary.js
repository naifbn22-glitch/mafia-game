function getDurationInSeconds(startedAt, endedAt) {
  if (!startedAt || !endedAt) {
    return 0;
  }

  return Math.max(
    0,
    Math.floor((endedAt - startedAt) / 1000),
  );
}

export function formatMatchDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds} ثانية`;
  }

  return `${minutes} دقيقة و${seconds} ثانية`;
}

export function calculateMatchSummary(gameState, winner) {
  const players = gameState.assignedPlayers ?? [];
  const survivingPlayers = players.filter(
    (player) => player.alive,
  );

  const thieves = players.filter(
    (player) => player.team === "thieves",
  );

  const citizens = players.filter(
    (player) => player.team === "citizens",
  );

  const durationSeconds = getDurationInSeconds(
    gameState.matchStartedAt,
    gameState.matchEndedAt,
  );

  return {
    winner,
    totalPlayers: players.length,
    totalRounds: gameState.round ?? 0,
    survivingPlayers: survivingPlayers.length,
    eliminatedPlayers:
      players.length - survivingPlayers.length,
    totalThieves: thieves.length,
    totalCitizens: citizens.length,
    timelineEvents:
      gameState.matchTimeline?.length ?? 0,
    durationSeconds,
    durationText: formatMatchDuration(
      durationSeconds,
    ),
  };
}