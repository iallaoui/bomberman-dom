import { h } from '../mini-framework/dom.js';
import { createGamePhysics } from './game-physics.js';

const powerupLabels = { bomb: 'B', flame: 'F', speed: 'S' };
const gameHeader = h('header', { className: 'game-header' },
    h('div', {},
        h('h1', { className: 'game-title' }, 'Bomberman'),
        h('span', {}, 'Arrows / WASD to move · Space to bomb')
    ),
    h('span', {
        className: 'frame-indicator',
        'aria-hidden': 'true',
        title: 'Animation running'
    })
);

export function createGameScreen({ send, commitGame, Chat }) {
    const physics = createGamePhysics({ send, commitGame });
    let cachedMap;
    let cachedTiles;

    function tileStyle(x, y) {
        return { left: `${x * 100 / 15}%`, top: `${y * 100 / 13}%` };
    }

    function Tiles(map) {
        if (map === cachedMap) return cachedTiles;
        if (cachedMap && map.length === cachedMap.length && map.every((row, y) => (
            row.length === cachedMap[y].length && row.every((tile, x) => tile === cachedMap[y][x])
        ))) {
            cachedMap = map;
            return cachedTiles;
        }

        const previousTiles = cachedTiles?.children || [];
        let index = 0;
        cachedMap = map;
        cachedTiles = h('div', { className: 'tiles' }, map.flatMap((row, y) => row.map((tile, x) => {
            const previous = previousTiles[index++];
            const key = `${x}-${y}`;
            const className = `tile ${tile}`;
            if (previous?.attrs.key === key && previous.attrs.className === className) return previous;
            return h('div', {
                key,
                className,
                style: previous?.attrs.key === key ? previous.attrs.style : tileStyle(x, y)
            });
        })));
        return cachedTiles;
    }

    function Powerup(item) {
        return h('div', {
            key: item.id,
            className: `entity powerup powerup-${item.type}`,
            style: tileStyle(item.x, item.y)
        }, powerupLabels[item.type]);
    }

    function Bomb(bomb) {
        return h('div', {
            key: bomb.id,
            className: 'entity bomb-wrap',
            style: tileStyle(bomb.x, bomb.y)
        }, h('span', { className: 'bomb' }));
    }

    function Flame(key, cell) {
        return h('div', { key, className: 'entity explosion', style: tileStyle(cell.x, cell.y) });
    }

    function Player(player, now) {
        const invulnerable = player.invulnerableUntil > now;
        return h('div', {
            key: player.id,
            'data-player-id': player.id,
            className: `entity player ${player.active ? '' : 'eliminated'} ${invulnerable ? 'invulnerable' : ''}`,
            style: physics.playerStyle(player)
        }, h('span', { style: { backgroundColor: player.color } }, player.nickname.slice(0, 2).toUpperCase()));
    }

    function HudPlayer(player, currentPlayerId) {
        const isCurrentPlayer = player.id === currentPlayerId;
        return h('article', {
            key: player.id,
            className: isCurrentPlayer ? 'is-you' : ''
        },
            h('span', { className: 'player-dot', style: { backgroundColor: player.color } }),
            h('strong', {}, player.nickname),
            h('span', {}, player.active ? `${'♥'.repeat(player.lives)}${'♡'.repeat(3 - player.lives)}` : 'OUT'),
            h('small', {}, `B${player.bombLimit} · F${player.range} · S${player.speed.toFixed(1)}`)
        );
    }

    function render(state) {
        const game = state.game;
        if (!game) return h('main', { className: 'center-page' }, h('p', {}, 'Loading match…'));
        const me = game.players[state.id];
        const winner = game.winner === 'draw' ? null : game.players[game.winner];
        const flameCells = new Map();
        for (const explosion of game.explosions) {
            for (const cell of explosion.cells) flameCells.set(`${cell.x}-${cell.y}`, cell);
        }
        const players = Object.values(game.players);

        return h('main', {
            className: 'game-shell',
            tabindex: 0,
            onKeydown: (event) => physics.handleKey(event, true),
            onKeyup: (event) => physics.handleKey(event, false),
            onBlur: physics.releaseMovement
        },
            h('section', { className: 'play-column' },
                gameHeader,
                h('div', {
                    className: 'board',
                    onClick: () => document.querySelector('.game-shell')?.focus(),
                    role: 'application',
                    'aria-label': 'Bomberman game board'
                },
                    Tiles(game.map),
                    h('div', { className: 'entities' },
                        game.powerups.map(Powerup),
                        game.bombs.map(Bomb),
                        [...flameCells].map(([key, cell]) => Flame(key, cell)),
                        players.map((player) => Player(player, game.now))
                    )
                ),
                h('div', { className: 'hud' }, players.map((player) => HudPlayer(player, state.id))),
                me && !me.active && h('p', { className: 'notice' }, 'You are out. You can still use the chat.'),
                game.winner && h('div', { className: 'result', role: 'status' },
                    h('h2', {}, winner ? `${winner.nickname} wins` : 'Draw'),
                    h('p', {}, 'Returning to the waiting room…')
                )
            ),
            Chat(state.chat)
        );
    }

    return {
        acceptSnapshot: physics.acceptSnapshot,
        refreshMovement: physics.refreshMovement,
        releaseMovement: physics.releaseMovement,
        render,
        requestFocus: physics.requestFocus,
        reset: physics.reset
    };
}
