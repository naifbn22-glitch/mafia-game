import test from "node:test";
import assert from "node:assert/strict";
import { finishNight, hostProjection, resetForRematch } from "../server/gameEngine.js";

test("a win resolved immediately after night exposes a valid same-player rematch", () => {
  const players = [
    { id: "thief-1", name: "لص", role: "thief", alive: true, performance: {} },
    { id: "nurse-1", name: "الممرض", role: "nurse", alive: true, performance: {} },
    { id: "citizen-1", name: "مواطن", role: "citizen", alive: true, performance: {} },
    { id: "citizen-2", name: "مواطن خرج سابقًا", role: "citizen", alive: false, performance: {} },
  ];
  const room = {
    code: "WINNOW",
    status: "playing",
    phase: "night-role",
    players,
    nightNumber: 1,
    roundNumber: 1,
    completedSteps: ["wake-thief", "wake-nurse"],
    nightActions: {
      thiefVotes: { "thief-1": "citizen-1" },
      nurseTargetId: "nurse-1",
      confirmedActors: {
        "thief-1": { role: "thief" },
        "nurse-1": { role: "nurse" },
      },
    },
    timeline: [],
    version: 1,
    lastTargets: { thief: null, nurse: null },
    discussionDurationSeconds: 60,
  };

  finishNight(room);
  const view = hostProjection(room);

  assert.equal(room.phase, "day");
  assert.equal(room.winner, "thieves");
  assert.equal(view.winner, "thieves");
  assert.equal(view.players.length, 4);
  assert.throws(() => resetForRematch({ ...room, winner: null }), /ACTION_NOT_ALLOWED/);

  const originalIds = room.players.map(player => player.id);
  resetForRematch(room);
  assert.deepEqual(room.players.map(player => player.id), originalIds);
  assert.equal(room.winner, null);
  assert.equal(room.phase, "lobby");
  assert.equal(room.status, "waiting");
});
