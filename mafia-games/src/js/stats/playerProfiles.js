function generateProfileId() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }

    return `profile-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`;
}

export function createPlayerProfile(player) {
    return {
        profileId: generateProfileId(),

        name: player.name,
        gender: player.gender,

        totalPoints: 0,
    };
}

export function syncPlayersWithProfiles(gameState) {

    gameState.playerProfiles = [];

    gameState.players.forEach((player) => {

        const profile = createPlayerProfile(player);

        gameState.playerProfiles.push(profile);

        player.profileId = profile.profileId;

    });

}

export function findProfile(gameState, profileId) {

    return gameState.playerProfiles.find(
        (profile) => profile.profileId === profileId
    );

}

export function addPoints(gameState, profileId, points) {

    const profile = findProfile(gameState, profileId);

    if (!profile) {
        return;
    }

    profile.totalPoints += points;

}

export function getLeaderboard(gameState) {

    return [...gameState.playerProfiles].sort(
        (a, b) => b.totalPoints - a.totalPoints
    );

}