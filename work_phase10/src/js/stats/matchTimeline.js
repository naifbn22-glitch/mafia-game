function createEventId() {
  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

export function addTimelineEvent(
  gameState,
  {
    type,
    title,
    description = "",
    icon = "•",
    round = null,
    phase = null,
    playerId = null,
    targetId = null,
    metadata = {},
  },
) {
  if (!gameState) {
    console.error("gameState غير موجود.");
    return null;
  }

  if (!Array.isArray(gameState.matchTimeline)) {
    gameState.matchTimeline = [];
  }

  const event = {
    id: createEventId(),
    type,
    title,
    description,
    icon,
    round: round ?? gameState.round ?? 1,
    phase: phase ?? gameState.phase ?? null,
    playerId,
    targetId,
    metadata,
    createdAt: Date.now(),
  };

  gameState.matchTimeline.push(event);

  return event;
}

export function getTimeline(gameState) {
  if (!Array.isArray(gameState?.matchTimeline)) {
    return [];
  }

  return [...gameState.matchTimeline];
}

export function clearTimeline(gameState) {
  if (!gameState) {
    return;
  }

  gameState.matchTimeline = [];
}

export function startMatchTimeline(gameState) {
  clearTimeline(gameState);

  gameState.matchStartedAt = Date.now();
  gameState.matchEndedAt = null;

  addTimelineEvent(gameState, {
    type: "match-start",
    title: "بدأت المباراة",
    description: "تم توزيع الأدوار وبدأت المباراة.",
    icon: "🎭",
    round: 1,
    phase: "start",
  });
}

export function endMatchTimeline(gameState, winner) {
  if (!gameState) {
    return;
  }

  gameState.matchEndedAt = Date.now();

  const winnerName =
    winner === "thieves"
      ? "اللصوص"
      : winner === "citizens"
        ? "المواطنون"
        : "فريق غير معروف";

  addTimelineEvent(gameState, {
    type: "match-end",
    title: `فاز ${winnerName}`,
    description: "انتهت المباراة وتم احتساب النتائج.",
    icon: "🏆",
    phase: "game-over",
  });
}