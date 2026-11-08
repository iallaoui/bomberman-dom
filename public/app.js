import { h, render } from './mini-framework/dom.js';
import { Events } from './mini-framework/event.js';
import Router from './mini-framework/router.js';
import { createStore } from './mini-framework/state.js';
import { createConnection } from './network/connection.js';

const root = document.querySelector('#root');
const store = createStore({
    screen: 'join',
    connected: false,
    id: null,
    lobby: { players: [], waitMs: null, countdownMs: null },
    chat: [],
    game: null,
    error: ''
});

const pressed = new Set();
const displayPositions = new Map();
const playerElements = new Map();
const movementKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS']);
const powerupLabels = { bomb: '💣', flame: '🔥', speed: '⚡' };
const screenPaths = { join: '/', lobby: '/lobby', game: '/game' };
let cachedMap;
let cachedTiles;
let connection;
let frameQueued = false;
let gameRenderPending = false;
let gameFocusPending = false;
let movementPending = false;
let latestGame;
let lastViewVersion = -1;
let lastRafTime = performance.now();
let lastMovement = '';

function syncRoute(screen) {
    const path = screenPaths[screen] || '/';
    const currentPath = window.location.hash.slice(1) || '/';
    if (currentPath !== path) router.navigate(path);
}

const router = new Router({
    '/': () => syncRoute(store.getState().screen),
    '/lobby': () => syncRoute(store.getState().screen),
    '/game': () => syncRoute(store.getState().screen)
});

function send(message) {
    connection?.send(message);
}

function handleMessage(message) {
    if (message.type === 'welcome') store.setState({ id: message.id });
    if (message.type === 'joined') store.setState({ screen: 'lobby', error: '' });
    if (message.type === 'lobby') {
        latestGame = null;
        movementPending = false;
        lastViewVersion = -1;
        displayPositions.clear();
        playerElements.clear();
        store.setState({ screen: 'lobby', lobby: message, game: null });
    }
    if (message.type === 'chat') {
        store.setState(({ chat }) => ({ chat: [...chat.slice(-59), message.message] }));
    }
    if (message.type === 'game') queueGame(message.game);
    if (message.type === 'error') store.setState({ error: message.message });
}

function queueGame(game) {
    if (!game.map) game.map = latestGame?.map || store.getState().game?.map;
    latestGame = game;
    for (const player of Object.values(game.players)) {
        if (!displayPositions.has(player.id)) {
            displayPositions.set(player.id, { x: player.x, y: player.y });
        }
    }
    if (Object.values(game.players).some((player) => {
        const position = displayPositions.get(player.id);
        return Math.hypot(player.x - position.x, player.y - position.y) >= .001;
    })) queueMovementFrame();
    const entering = store.getState().screen !== 'game';
    if (!entering && game.viewVersion === lastViewVersion) return;
    lastViewVersion = game.viewVersion;
    gameRenderPending = true;
    gameFocusPending ||= entering;
    queueFrame();
}

function sendMovement() {
    const left = pressed.has('ArrowLeft') || pressed.has('KeyA');
    const right = pressed.has('ArrowRight') || pressed.has('KeyD');
    const up = pressed.has('ArrowUp') || pressed.has('KeyW');
    const down = pressed.has('ArrowDown') || pressed.has('KeyS');
    const x = Number(right) - Number(left);
    const y = Number(down) - Number(up);
    const movement = `${x},${y}`;
    if (movement === lastMovement) return;
    lastMovement = movement;
    send({ type: 'move', x, y });
}

function gameKey(event, down) {
    if (movementKeys.has(event.code)) {
        event.preventDefault();
        if (down && event.repeat) return;
        down ? pressed.add(event.code) : pressed.delete(event.code);
        sendMovement();
    }
    if (down && event.code === 'Space' && !event.repeat) {
        event.preventDefault();
        send({ type: 'bomb' });
    }
}

function Chat(messages) {
    return h('section', { className: 'chat' },
        h('h2', {}, 'Chat'),
        h('div', { className: 'messages', 'aria-live': 'polite' },
            messages.length
                ? messages.map((message) => h('p', { key: message.id },
                    h('strong', {}, `${message.nickname}: `), message.text
                ))
                : h('p', { className: 'muted' }, 'No messages yet.')
        ),
        h('form', {
            onSubmit: (event) => {
                event.preventDefault();
                const input = event.target.querySelector('input');
                const text = input.value.trim();
                if (!text) return;
                send({ type: 'chat', text });
                input.value = '';
                if (store.getState().screen === 'game') {
                    gameFocusPending = true;
                    queueFrame();
                }
            }
        },
            h('input', {
                maxlength: 180,
                placeholder: 'Write a message',
                'aria-label': 'Chat message',
                onKeydown: () => {},
                onKeyup: () => {}
            }),
            h('button', { type: 'submit' }, 'Send')
        )
    );
}

function Join(state) {
    return h('main', { className: 'center-page' },
        h('section', { className: 'join-panel' },
            h('h1', {}, 'Bomberman'),
            h('p', {}, 'Enter a nickname to join the next match.'),
            h('form', {
                onSubmit: (event) => {
                    event.preventDefault();
                    const nickname = event.target.querySelector('input').value.trim();
                    if (nickname) send({ type: 'join', nickname });
                }
            },
                h('label', { htmlFor: 'nickname' }, 'Nickname'),
                h('input', { id: 'nickname', minlength: 2, maxlength: 18, autofocus: true, autocomplete: 'off' }),
                h('button', { type: 'submit', disabled: !state.connected }, state.connected ? 'Join game' : 'Connecting…')
            ),
            state.error && h('p', { className: 'error', role: 'alert' }, state.error)
        )
    );
}

function Lobby(state) {
    const { players, waitMs, countdownMs } = state.lobby;
    let status = 'Waiting for at least 2 players';
    if (waitMs !== null) status = `Waiting period: ${Math.ceil(waitMs / 1000)}s`;
    if (countdownMs !== null) status = `Match starts in ${Math.ceil(countdownMs / 1000)}s`;

    return h('main', { className: 'lobby-page' },
        h('section', { className: 'lobby-panel' },
            h('h1', { className: 'bomberman-title' }, 'Bomberman'),
            h('h2', { className: 'lobby-count' }, `${players.length} / 4 players`),
            h('p', { className: countdownMs !== null ? 'countdown' : 'muted' }, status),
            h('ul', { className: 'player-list' }, players.map((player) => h('li', { key: player.id },
                h('span', { className: 'player-dot', style: { backgroundColor: player.color } }),
                player.nickname,
                player.id === state.id && h('small', {}, 'you')
            )))
        ),
        Chat(state.chat)
    );
}

function playerStyle(player) {
    const position = displayPositions.get(player.id) || player;
    return { transform: `translate3d(${position.x * 100}%, ${position.y * 100}%, 0)` };
}

function tileStyle(x, y) {
    return { left: `${x * 100 / 15}%`, top: `${y * 100 / 13}%` };
}

function Tiles(map) {
    if (map !== cachedMap) {
        cachedMap = map;
        cachedTiles = h('div', { className: 'tiles' }, map.flatMap((row, y) => row.flatMap((tile, x) => (
            tile === 'floor' ? [] : [h('div', {
                key: `${x}-${y}`,
                className: `tile ${tile}`,
                style: tileStyle(x, y)
            })]
        ))));
    }
    return cachedTiles;
}

function Game(state) {
    const game = state.game;
    if (!game) return h('main', { className: 'center-page' }, h('p', {}, 'Loading match…'));
    const me = game.players[state.id];
    const winner = game.winner === 'draw' ? null : game.players[game.winner];
    const flameCells = new Map();
    for (const explosion of game.explosions) {
        for (const cell of explosion.cells) flameCells.set(`${cell.x}-${cell.y}`, cell);
    }

    return h('main', {
        className: 'game-shell',
        tabindex: 0,
        onKeydown: (event) => gameKey(event, true),
        onKeyup: (event) => gameKey(event, false),
        onBlur: () => { pressed.clear(); sendMovement(); }
    },
        h('section', { className: 'play-column' },
            h('header', { className: 'game-header' },
                h('div', {}, h('h1', { className: 'bomberman-title' }, 'Bomberman'), h('span', {}, 'Arrows / WASD to move · Space to bomb'))
            ),
            h('div', {
                className: 'board',
                onClick: () => document.querySelector('.game-shell')?.focus(),
                role: 'application',
                'aria-label': 'Bomberman game board'
            },
                Tiles(game.map),
                h('div', { className: 'entities' },
                    game.powerups.map((item) => h('div', {
                        key: item.id,
                        className: `entity powerup powerup-${item.type}`,
                        style: tileStyle(item.x, item.y)
                    }, powerupLabels[item.type])),
                    game.bombs.map((bomb) => h('div', {
                        key: bomb.id,
                        className: 'entity bomb-wrap',
                        style: tileStyle(bomb.x, bomb.y)
                    }, h('span', { className: 'bomb' }))),
                    [...flameCells].map(([key, cell]) => h('div', {
                        key,
                        className: 'entity explosion',
                        style: tileStyle(cell.x, cell.y)
                    })),
                    Object.values(game.players).map((player) => h('div', {
                        key: player.id,
                        'data-player-id': player.id,
                        className: `entity player ${player.active ? '' : 'eliminated'} ${player.invulnerableUntil > game.now ? 'invulnerable' : ''}`,
                        style: playerStyle(player)
                    }, h('span', { style: { backgroundColor: player.color } }, player.nickname.slice(0, 2).toUpperCase())))
                )
            ),
            h('div', { className: 'hud' }, Object.values(game.players).map((player) => h('article', {
                key: player.id,
                className: player.id === state.id ? 'is-you' : ''
            },
                h('span', { className: 'player-dot', style: { backgroundColor: player.color } }),
                h('strong', {}, player.nickname),
                h('span', {}, player.active ? `${'♥'.repeat(player.lives)}${'♡'.repeat(3 - player.lives)}` : 'OUT'),
                h('small', {}, `B${player.bombLimit} · F${player.range} · S${player.speed.toFixed(1)}`)
            ))),
            me && !me.active && h('p', { className: 'notice' }, 'You are out. You can still use the chat.'),
            game.winner && h('div', { className: 'result', role: 'status' },
                h('h2', {}, winner ? `${winner.nickname} wins` : 'Draw'),
                h('p', {}, 'Returning to the waiting room…')
            )
        ),
        Chat(state.chat)
    );
}

function App(state) {
    if (state.screen === 'join') return Join(state);
    if (state.screen === 'lobby') return Lobby(state);
    return Game(state);
}

store.subscribe((state) => {
    syncRoute(state.screen);
    render(App(state), root);
});
const events = new Events(root);
events.init(['click', 'submit', 'keydown', 'keyup', 'blur']);
const releaseMovement = () => {
    pressed.clear();
    sendMovement();
};
events.listen(window, 'blur', releaseMovement);
events.listen(window, 'focus', () => connection?.activate());
events.listen(window, 'pagehide', () => connection?.detach());
events.listen(document, 'visibilitychange', () => {
    if (document.hidden) {
        releaseMovement();
        return;
    }
    connection?.activate();
    lastRafTime = performance.now();
    if (latestGame) queueMovementFrame();
});
render(App(store.getState()), root);
router.start();
connection = createConnection(
    handleMessage,
    (connected) => store.setState({ connected, error: connected ? '' : 'Reconnecting…' })
);
if (!document.hidden) connection.activate();

function queueMovementFrame() {
    movementPending = true;
    queueFrame();
}

function queueFrame() {
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(runFrame);
}

function runFrame(now) {
    frameQueued = false;
    if (gameRenderPending) {
        gameRenderPending = false;
        store.setState({ screen: 'game', game: latestGame });
        playerElements.clear();
        for (const element of document.querySelectorAll('[data-player-id]')) {
            playerElements.set(element.dataset.playerId, element);
        }
    }

    const elapsed = Math.min(50, Math.max(0, now - lastRafTime));
    lastRafTime = now;
    let keepAnimating = false;
    if (movementPending) {
        movementPending = false;
    }
    if (latestGame) {
        const blend = 1 - Math.exp(-elapsed / 35);
        for (const player of Object.values(latestGame.players)) {
            const position = displayPositions.get(player.id) || { x: player.x, y: player.y };
            const distance = Math.hypot(player.x - position.x, player.y - position.y);
            if (distance < .001 || distance > 2) {
                position.x = player.x;
                position.y = player.y;
            } else {
                position.x += (player.x - position.x) * blend;
                position.y += (player.y - position.y) * blend;
                if (Math.hypot(player.x - position.x, player.y - position.y) < .001) {
                    position.x = player.x;
                    position.y = player.y;
                } else {
                    keepAnimating = true;
                }
            }
            displayPositions.set(player.id, position);
            const element = playerElements.get(player.id);
            const transform = `translate3d(${position.x * 100}%, ${position.y * 100}%, 0)`;
            if (element && element.style.transform !== transform) element.style.transform = transform;
        }
    }
    movementPending ||= keepAnimating;

    if (gameFocusPending) {
        gameFocusPending = false;
        document.querySelector('.game-shell')?.focus();
    }
    if (gameRenderPending || gameFocusPending || movementPending) queueFrame();
}
