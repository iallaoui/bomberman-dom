// Simulation continues at 60 Hz; only changed presentation state is broadcast.
export function createGameBroadcaster(broadcast) {
    let previousGame;
    let lastRevision = -1;
    let lastViewVersion = -1;
    let lastMapVersion = -1;
    let lastBroadcastAt = 0;

    return function broadcastGame(game, now = performance.now()) {
        const entering = game !== previousGame;
        const structuralChange = entering || game.state.viewVersion !== lastViewVersion;
        if (!structuralChange) {
            if (game.revision === lastRevision || now - lastBroadcastAt < 50) return;
        }

        const includeMap = entering || game.mapVersion !== lastMapVersion;
        broadcast({ type: 'game', game: game.snapshot(includeMap) });
        previousGame = game;
        lastRevision = game.revision;
        lastViewVersion = game.state.viewVersion;
        lastMapVersion = game.mapVersion;
        // Keep the 50 ms cadence despite the server's roughly 16 ms ticks.
        lastBroadcastAt = structuralChange ? now : lastBroadcastAt + 50;
        if (now - lastBroadcastAt >= 50) lastBroadcastAt = now;
    };
}
