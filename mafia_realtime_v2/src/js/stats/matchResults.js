import { SCORING_RULES } from "./scoringRules";
import {
    addPoints,
    findProfile,
} from "./playerProfiles";

function calculateCitizenPoints(player, totalRounds) {

    if (player.alive) {
        return SCORING_RULES.CITIZEN.SURVIVED;
    }

    const round = player.eliminatedRound ?? 1;

    if (round <= 1) {
        return SCORING_RULES.CITIZEN.ROUND_1;
    }

    if (round <= 3) {
        return SCORING_RULES.CITIZEN.ROUND_2_3;
    }

    return SCORING_RULES.CITIZEN.ROUND_4_AND_AFTER;
}

function calculateThiefPoints(player, totalRounds) {

    if (player.isAlive) {
        return SCORING_RULES.THIEF.SURVIVED;
    }

    const eliminatedRound = player.eliminatedRound ?? 1;

    const roundsBeforeEnd =
        totalRounds - eliminatedRound;

    if (eliminatedRound === 1) {
        return SCORING_RULES.THIEF.EARLY_ELIMINATION;
    }

    if (roundsBeforeEnd <= 1) {
        return SCORING_RULES.THIEF.ONE_ROUND_BEFORE_END;
    }

    if (roundsBeforeEnd <= 2) {
        return SCORING_RULES.THIEF.TWO_ROUNDS_BEFORE_END;
    }

    return SCORING_RULES.THIEF.EARLY_ELIMINATION;
}

function calculateBasePoints(player, totalRounds) {

    switch (player.role) {

        case "thief":
            return calculateThiefPoints(player, totalRounds);

        case "citizen":
        case "king":
        case "nurse":
            return calculateCitizenPoints(player, totalRounds);

        default:
            return 0;

    }

}
function calculateNurseBonus(gameState, player) {
    if (player.role !== "nurse") {
        return 0;
    }

    const saves =
        gameState.matchStats?.successfulNurseSaves ?? [];

    const successfulSavesCount = saves.filter((save) => {
        if (typeof save === "string") {
            return save === player.id;
        }

        return (
            save.nurseId === player.id ||
            save.playerId === player.id
        );
    }).length;

    return (
        successfulSavesCount *
        SCORING_RULES.BONUS.NURSE_SUCCESSFUL_SAVE
    );
}

function calculateKingBonus(gameState, player) {
    if (player.role !== "king") {
        return 0;
    }

    const reveals =
        gameState.matchStats?.kingThiefReveals ?? [];

    const revealedThiefIds = reveals
        .filter((reveal) => {
            if (typeof reveal === "string") {
                return true;
            }

            return (
                reveal.kingId === player.id ||
                reveal.playerId === player.id
            );
        })
        .map((reveal) => {
            if (typeof reveal === "string") {
                return reveal;
            }

            return (
                reveal.thiefId ??
                reveal.targetId ??
                reveal.revealedPlayerId
            );
        })
        .filter(Boolean);

    const differentThievesCount =
        new Set(revealedThiefIds).size;

    return (
        differentThievesCount *
        SCORING_RULES.BONUS.KING_REVEAL_THIEF
    );
}
function calculateVoteBonus(gameState, playerId) {

    return gameState.matchStats.votes
        .filter(
            (vote) =>
                vote.voterId === playerId &&
                vote.pointsAwarded === true,
        )
        .length;

}
export function calculateMatchResults(gameState) {

    if (gameState.matchStats?.applied) {
        return gameState.matchStats.finalResults;
    }

    const ranking = [];

    gameState.assignedPlayers.forEach((player) => {

        const basePoints = calculateBasePoints(
            player,
            gameState.round
        );

        const voteBonus = calculateVoteBonus(
            gameState,
            player.id
        );

        const nurseBonus = calculateNurseBonus(
            gameState,
            player
        );

        const kingBonus = calculateKingBonus(
            gameState,
            player
        );

        const matchPoints =
            basePoints +
            voteBonus +
            nurseBonus +
            kingBonus;

        addPoints(
            gameState,
            player.profileId,
            matchPoints
        );

        const profile = findProfile(
            gameState,
            player.profileId
        );

        ranking.push({
            playerId: player.id,
            profileId: player.profileId,
            name: player.name,
            role: player.role,

            matchPoints,

            totalPoints:
                profile?.totalPoints ?? matchPoints,
        });

    });

    ranking.sort((a, b) => {

        if (b.matchPoints !== a.matchPoints) {
            return b.matchPoints - a.matchPoints;
        }

        return b.totalPoints - a.totalPoints;

    });

    const highestPoints =
        ranking[0]?.matchPoints ?? 0;

    const bestPlayers = ranking.filter(
        (player) =>
            player.matchPoints === highestPoints
    );

    const results = {
        ranking,
        bestPlayers,
    };

    gameState.matchStats.finalResults = results;
    gameState.matchStats.applied = true;

    return results;
}