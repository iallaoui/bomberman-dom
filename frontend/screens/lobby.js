import { h } from '../mini-framework/dom.js';

export function Lobby(state) {
    const { players, waitMs, countdownMs } = state.lobby;
    let status = 'Waiting for at least 2 players';
    if (waitMs !== null) status = `Waiting period: ${Math.ceil(waitMs / 1000)}s`;
    if (countdownMs !== null) status = `Match starts in ${Math.ceil(countdownMs / 1000)}s`;

    return h('main', { className: 'lobby-page' },
        h('section', { className: 'lobby-panel' },
            h('h1', { className: 'game-title' }, 'Bomberman'),
            h('h2', { className: 'lobby-count' }, `${players.length} / 4 players`),
            h('p', { className: countdownMs !== null ? 'countdown' : 'muted' }, status),
            h('ul', { className: 'player-list' }, players.map((player) => h('li', { key: player.id },
                h('span', { className: 'player-dot', style: { backgroundColor: player.color } }),
                player.nickname,
                player.id === state.id && h('small', {}, 'you')
            )))
        )
    );
}
