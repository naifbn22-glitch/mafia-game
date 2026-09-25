export const gameState = {
  currentPhase: "home",
  currentScreen: "home",

  matchTimeline: [],
  matchStartedAt: null,
  matchEndedAt: null,

  players: [],
  assignedPlayers: [],
  playerProfiles: [],
  currentRevealIndex: 0,

  roundNumber: 1,
  currentPardonPlayerId: null,

  roundHistory: {
    lastVictimId: null,
    lastSavedPlayerId: null,
  },

  nightAction: {
    victimId: null,
    savedPlayerId: null,
    kingTargetId: null,
    kingSkipped: false,
    investigatorTargetId: null,
  },

  nightSequence: {
    roleIds: [],
    currentIndex: 0,
  },

  timer: {
    intervalId: null,
    remainingSeconds: 0,
    isPaused: false,
  },

  voting: {
    voterIndex: 0,
    votes: [],
  },

  matchStats: {
    votes: [],
    successfulNurseSaves: [],
    investigatorThiefFinds: [],
    kingPardonsUsed: [],
    eliminationRounds: {},
    finalResults: null,
    applied: false,
  },

  soundEnabled: true,

  settings: {
    nightDuration: 45,
    discussionDuration: 180,
    votingDuration: 45,
    showTimer: true,
    vibrationEnabled: true,

    advancedRules: {
      preventRepeatVictim: true,
      preventRepeatSave: true,
    },
  },
};

export function resetGameState() {
  gameState.currentPhase = "home";
  gameState.currentScreen = "home";

  gameState.matchTimeline = [];
  gameState.matchStartedAt = null;
  gameState.matchEndedAt = null;

  gameState.players = [];
  gameState.assignedPlayers = [];
  gameState.currentRevealIndex = 0;

  gameState.roundNumber = 1;
  gameState.currentPardonPlayerId = null;

  gameState.matchStats = {
    votes: [],
    successfulNurseSaves: [],
    investigatorThiefFinds: [],
    kingPardonsUsed: [],
    eliminationRounds: {},
    finalResults: null,
    applied: false,
  };

  gameState.roundHistory = {
    lastVictimId: null,
    lastSavedPlayerId: null,
  };

  gameState.nightAction = {
    victimId: null,
    savedPlayerId: null,
    kingTargetId: null,
    kingSkipped: false,
    investigatorTargetId: null,
  };

  gameState.nightSequence = {
    roleIds: [],
    currentIndex: 0,
  };

  gameState.timer = {
    intervalId: null,
    remainingSeconds: 0,
    isPaused: false,
  };

  gameState.voting = {
    voterIndex: 0,
    votes: [],
  };
}
