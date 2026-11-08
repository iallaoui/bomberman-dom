import { h } from '../mini-framework/dom.js';

const movementKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS']);
const powerupLabels = { bomb: 'B', flame: 'F', speed: 'S' };
const gameHeaderVNode = h('header', { className: 'game-header' },
    h('div', {}, h('h1', { className: 'game-title' }, 'Bomberman'), h('span', {}, 'Arrows / WASD to move · Space to bomb'))
);

export function createGameScreen({ send, commitGame, Chat }) {
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
    let cachedMap;
    let cachedTiles;
    let tileCells;
    let frameQueued = false;
    let renderPending = false;
    let focusPending = false;
    let movementPending = false;
    let latestGame;
    let pendingGame;
    let lastViewVersion = -1;
    let lastMovement = '';

    function clearCaches() {
        cachedMap = null;
        cachedTiles = null;
        tileCells = null;
        tileVNodes.clear();
        powerupVNodes.clear();
        bombVNodes.clear();
        flameVNodes.clear();
        playerVNodes.clear();
        hudVNodes.clear();
    }

    function reset() {
        latestGame = null;
        pendingGame = null;
        renderPending = false;
        focusPending = false;
        movementPending = false;
        lastViewVersion = -1;
        lastMovement = '';
        pressed.clear();
        displayPositions.clear();
        playerElements.clear();
        clearCaches();
    }

    function acceptSnapshot(game) {
        if (!game.map) game.map = pendingGame?.map || latestGame?.map;
        pendingGame = game;
        queueFrame();
    }

    function applySnapshot() {
        const game = pendingGame;
        pendingGame = null;
        latestGame = game;

        let playerMoved = false;
        for (const player of Object.values(game.players)) {
            if (!displayPositions.has(player.id)) {
                displayPositions.set(player.id, { x: player.x, y: player.y });
                continue;
            }
            const position = displayPositions.get(player.id);
            const dx = player.x - position.x;
            const dy = player.y - position.y;
            if (dx * dx + dy * dy >= 0.000001) playerMoved = true;
        }

        if (playerMoved) movementPending = true;
        const entering = lastViewVersion === -1;
        if (entering || game.viewVersion !== lastViewVersion) {
            lastViewVersion = game.viewVersion;
            renderPending = true;
            focusPending ||= entering;
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

    function handleKey(event, down) {
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

    function releaseMovement() {
        pressed.clear();
        sendMovement();
    }

    function requestFocus() {
        focusPending = true;
        queueFrame();
    }

    function refreshMovement() {
        movementPending = true;
        queueFrame();
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

    function tileVNode(tile, x, y) {
        const key = `${x}-${y}`;
        const cached = tileVNodes.get(key);
        if (cached?.tile === tile) return cached.vnode;
        const vnode = h('div', { key, className: `tile ${tile}`, style: tileStyle(x, y) });
        tileVNodes.set(key, { tile, vnode });
        return vnode;
    }

    function Tiles(map) {
        if (!tileCells) {
            tileCells = map.flatMap((row, y) => row.flatMap((tile, x) => (
                tile === 'floor' ? [] : [{ x, y }]
            )));
        }
        if (map !== cachedMap) {
            cachedMap = map;
            cachedTiles = h('div', { className: 'tiles' }, tileCells.map(({ x, y }) => tileVNode(map[y][x], x, y)));
        }
        return cachedTiles;
    }

    function cachedVNode(cache, key, signature, create) {
        const cached = cache.get(key);
        if (cached?.signature === signature) return cached.vnode;
        const vnode = create();
        cache.set(key, { signature, vnode });
        return vnode;
    }

    function pruneCache(cache, activeKeys) {
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
            vnode = h('div', { key, className: 'entity explosion', style: tileStyle(cell.x, cell.y) });
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
        const powerupKeys = new Set(game.powerups.map((item) => item.id));
        const bombKeys = new Set(game.bombs.map((bomb) => bomb.id));
        const playerKeys = new Set(players.map((player) => player.id));
        pruneCache(powerupVNodes, powerupKeys);
        pruneCache(bombVNodes, bombKeys);
        pruneCache(playerVNodes, playerKeys);
        pruneCache(hudVNodes, playerKeys);

        return h('main', {
            className: 'game-shell',
            tabindex: 0,
            onKeydown: (event) => handleKey(event, true),
            onKeyup: (event) => handleKey(event, false),
            onBlur: releaseMovement
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

    function queueFrame() {
        if (frameQueued) return;
        frameQueued = true;
        requestAnimationFrame(runFrame);
    }

    function runFrame() {
        frameQueued = false;
        let renderedGame = false;
        if (pendingGame) applySnapshot();

        if (renderPending) {
            renderPending = false;
            renderedGame = true;
            commitGame(latestGame);
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
                if (element.style.transform !== transform) element.style.transform = transform;
            }
        }

        if (focusPending && !renderedGame) {
            focusPending = false;
            document.querySelector('.game-shell')?.focus();
        }
        if (pendingGame || renderPending || focusPending || movementPending) queueFrame();
    }

    return { acceptSnapshot, refreshMovement, releaseMovement, render, requestFocus, reset };
}
