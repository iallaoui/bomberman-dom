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
const tileStyles = new Map();
const tileVNodes = new Map();
const powerupVNodes = new Map();
const bombVNodes = new Map();
const flameVNodes = new Map();
const playerVNodes = new Map();
const hudVNodes = new Map();
const movementKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS']);
const powerupLabels = { bomb: 'B', flame: 'F', speed: 'S' };
const screenPaths = { join: '/', lobby: '/lobby', game: '/game' };
const gameHeaderVNode = h('header', { className: 'game-header' },
    h('div', {}, h('h1', { className: 'game-title' }, 'Bomberman'), h('span', {}, 'Arrows / WASD to move · Space to bomb'))
);
let cachedMap;
let cachedTiles;
let cachedChatMessages;
let cachedChatVNode;
let connection;
let frameQueued = false;
let gameRenderPending = false;
let gameFocusPending = false;
let movementPending = false;
let latestGame;
let pendingGame;
let lastViewVersion = -1;
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

function clearGameVNodeCaches() {
    powerupVNodes.clear();
    bombVNodes.clear();
    playerVNodes.clear();
    hudVNodes.clear();
}

function handleMessage(message) {
    if (message.type === 'welcome') store.setState({ id: message.id });
    if (message.type === 'joined') store.setState({ screen: 'lobby', error: '' });
    if (message.type === 'lobby') {
        latestGame = null;
        pendingGame = null;
        movementPending = false;
        lastViewVersion = -1;
        displayPositions.clear();
        playerElements.clear();
        clearGameVNodeCaches();
        store.setState({ screen: 'lobby', lobby: message, game: null });
    }
    if (message.type === 'chat') {
        store.setState(({ chat }) => ({ chat: [...chat.slice(-59), message.message] }));
    }
    if (message.type === 'game') queueGame(message.game);
    if (message.type === 'error') store.setState({ error: message.message });
}

function queueGame(game) {
    if (!game.map) {
        game.map = pendingGame?.map || latestGame?.map || store.getState().game?.map;
    }
    pendingGame = game;
    queueFrame();
}

function applyPendingGame() {
    const game = pendingGame;
    pendingGame = null;
    latestGame = game;

    let playerMoved = false;
    for (const player of Object.values(game.players)) {
        if (!displayPositions.has(player.id)) {
            displayPositions.set(player.id, {
                x: player.x,
                y: player.y
            });
            continue;
        }
        const position = displayPositions.get(player.id);
        const dx = player.x - position.x;
        const dy = player.y - position.y;
        if (dx * dx + dy * dy >= 0.000001) playerMoved = true;
    }

    if (playerMoved) movementPending = true;

    const entering = store.getState().screen !== 'game';

    if (entering || game.viewVersion !== lastViewVersion) {
        lastViewVersion = game.viewVersion;
        gameRenderPending = true;
        gameFocusPending ||= entering;
    }
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
    if (messages === cachedChatMessages) return cachedChatVNode;
    cachedChatMessages = messages;
    cachedChatVNode = h('section', { className: 'chat' },
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
    return cachedChatVNode;
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
            h('h1', { className: 'game-title' }, 'Bomberman'),
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
    const x = Math.round(position.x * 1000) / 10;
    const y = Math.round(position.y * 1000) / 10;
    return { transform: `translate3d(${x}%, ${y}%, 0)` };
}

function tileStyle(x, y) {
    const key = `${x}-${y}`;
    let style = tileStyles.get(key);
    if (!style) {
        style = { left: `${x * 100 / 15}%`, top: `${y * 100 / 13}%` };
        tileStyles.set(key, style);
    }
    return style;
}

function Tiles(map) {
    if (map !== cachedMap) {
        cachedMap = map;
        cachedTiles = h('div', { className: 'tiles' }, map.flatMap((row, y) => row.flatMap((tile, x) => (
            tile === 'floor' ? [] : [tileVNode(tile, x, y)]
        ))));
    }
    return cachedTiles;
}

function tileVNode(tile, x, y) {
    const key = `${x}-${y}`;
    const cached = tileVNodes.get(key);
    if (cached?.tile === tile) return cached.vnode;
    const vnode = h('div', {
        key,
        className: `tile ${tile}`,
        style: tileStyle(x, y)
    });
    tileVNodes.set(key, { tile, vnode });
    return vnode;
}

function cachedVNode(cache, key, signature, create) {
    const cached = cache.get(key);
    if (cached?.signature === signature) return cached.vnode;
    const vnode = create();
    cache.set(key, { signature, vnode });
    return vnode;
}

function pruneVNodeCache(cache, activeKeys) {
    for (const key of cache.keys()) {
        if (!activeKeys.has(key)) cache.delete(key);
    }
}

function Powerup(item) {
    const signature = `${item.type}|${item.x}|${item.y}`;
    return cachedVNode(powerupVNodes, item.id, signature, () => h('div', {
        key: item.id,
        className: `entity powerup powerup-${item.type}`,
        style: tileStyle(item.x, item.y)
    }, powerupLabels[item.type]));
}

function Bomb(bomb) {
    const signature = `${bomb.x}|${bomb.y}`;
    return cachedVNode(bombVNodes, bomb.id, signature, () => h('div', {
        key: bomb.id,
        className: 'entity bomb-wrap',
        style: tileStyle(bomb.x, bomb.y)
    }, h('span', { className: 'bomb' })));
}

function Flame(key, cell) {
    let vnode = flameVNodes.get(key);
    if (!vnode) {
        vnode = h('div', {
            key,
            className: 'entity explosion',
            style: tileStyle(cell.x, cell.y)
        });
        flameVNodes.set(key, vnode);
    }
    return vnode;
}

function Player(player, now) {
    const invulnerable = player.invulnerableUntil > now;
    const signature = `${player.active}|${invulnerable}|${player.color}|${player.nickname}`;
    return cachedVNode(playerVNodes, player.id, signature, () => h('div', {
        key: player.id,
        'data-player-id': player.id,
        className: `entity player ${player.active ? '' : 'eliminated'} ${invulnerable ? 'invulnerable' : ''}`,
        style: playerStyle(player)
    }, h('span', { style: { backgroundColor: player.color } }, player.nickname.slice(0, 2).toUpperCase())));
}

function HudPlayer(player, currentPlayerId) {
    const isCurrentPlayer = player.id === currentPlayerId;
    const signature = `${isCurrentPlayer}|${player.active}|${player.lives}|${player.bombLimit}|${player.range}|${player.speed}|${player.color}|${player.nickname}`;
    return cachedVNode(hudVNodes, player.id, signature, () => h('article', {
        key: player.id,
        className: isCurrentPlayer ? 'is-you' : ''
    },
        h('span', { className: 'player-dot', style: { backgroundColor: player.color } }),
        h('strong', {}, player.nickname),
        h('span', {}, player.active ? `${'♥'.repeat(player.lives)}${'♡'.repeat(3 - player.lives)}` : 'OUT'),
        h('small', {}, `B${player.bombLimit} · F${player.range} · S${player.speed.toFixed(1)}`)
    ));
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
    const players = Object.values(game.players);
    const powerupKeys = new Set(game.powerups.map((item) => item.id));
    const bombKeys = new Set(game.bombs.map((bomb) => bomb.id));
    const playerKeys = new Set(players.map((player) => player.id));
    pruneVNodeCache(powerupVNodes, powerupKeys);
    pruneVNodeCache(bombVNodes, bombKeys);
    pruneVNodeCache(playerVNodes, playerKeys);
    pruneVNodeCache(hudVNodes, playerKeys);

    return h('main', {
        className: 'game-shell',
        tabindex: 0,
        onKeydown: (event) => gameKey(event, true),
        onKeyup: (event) => gameKey(event, false),
        onBlur: () => { pressed.clear(); sendMovement(); }
    },
        h('section', { className: 'play-column' },
            gameHeaderVNode,
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

function runFrame() {
    frameQueued = false;

    if (pendingGame) applyPendingGame();

    if (gameRenderPending) {
        gameRenderPending = false;

        store.setState({
            screen: 'game',
            game: latestGame
        });

        playerElements.clear();

        for (const element of document.querySelectorAll('[data-player-id]')) {
            playerElements.set(element.dataset.playerId, element);
        }
    }

    const animateMovement = movementPending;
    movementPending = false;

    if (latestGame && animateMovement) {
        for (const player of Object.values(latestGame.players)) {
            let position = displayPositions.get(player.id);

            if (!position) {
                position = { x: player.x, y: player.y };
                displayPositions.set(player.id, position);
            }

            position.x = player.x;
            position.y = player.y;

            const element = playerElements.get(player.id);

            if (!element) continue;

            const x = Math.round(position.x * 1000) / 10;
            const y = Math.round(position.y * 1000) / 10;

            const transform = `translate3d(${x}%, ${y}%, 0)`;

            if (element.style.transform !== transform) {
                element.style.transform = transform;
            }
        }
    }

    if (gameFocusPending) {
        gameFocusPending = false;
        document.querySelector('.game-shell')?.focus();
    }

    if (pendingGame || gameRenderPending || gameFocusPending || movementPending) {
        queueFrame();
    }
}
