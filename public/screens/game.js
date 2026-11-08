import { h } from '../mini-framework/dom.js';

const movementKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS']);
const powerupLabels = { bomb: 'B', flame: 'F', speed: 'S' };

export function createGameScreen({ send, commitGame, Chat }) {
    const pressed = new Set();
    const displayPositions = new Map();
    const playerElements = new Map();
    let frameQueued = false;
    let renderPending = false;
    let focusPending = false;
    let movementPending = false;
    let latestGame;
    let pendingGame;
    let lastSnapshotAt = 0;
    let lastViewVersion = -1;
    let lastMovement = '';

    function reset() {
        latestGame = null;
        pendingGame = null;
        renderPending = false;
        focusPending = false;
        movementPending = false;
        lastSnapshotAt = 0;
        lastViewVersion = -1;
        lastMovement = '';
        pressed.clear();
        displayPositions.clear();
        playerElements.clear();
    }

    function acceptSnapshot(game) {
        if (!game.map) game.map = pendingGame?.map || latestGame?.map;
        pendingGame = game;
        queueFrame();
    }

    function applySnapshot(now) {
        const game = pendingGame;
        pendingGame = null;
        latestGame = game;
        const interpolationDuration = lastSnapshotAt
            ? Math.max(40, Math.min(150, now - lastSnapshotAt))
            : 50;
        lastSnapshotAt = now;

        for (const player of Object.values(game.players)) {
            let position = displayPositions.get(player.id);
            if (!position) {
                position = { x: player.x, y: player.y };
                displayPositions.set(player.id, position);
            }
            position.fromX = position.x;
            position.fromY = position.y;
            position.targetX = player.x;
            position.targetY = player.y;
            position.startedAt = now;
            position.duration = interpolationDuration;
            const dx = position.targetX - position.x;
            const dy = position.targetY - position.y;
            if (dx * dx + dy * dy >= 0.000001) movementPending = true;
        }

        for (const id of displayPositions.keys()) {
            if (!game.players[id]) displayPositions.delete(id);
        }

        const entering = lastViewVersion === -1;
        if (entering || game.viewVersion !== lastViewVersion) {
            lastViewVersion = game.viewVersion;
            renderPending = true;
            focusPending ||= entering;
        }
    }

    function collectPlayerElements() {
        playerElements.clear();
        for (const element of document.querySelectorAll('[data-player-id]')) {
            playerElements.set(element.dataset.playerId, element);
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
        return { transform: positionTransform(position) };
    }

    function positionTransform(position) {
        const x = Math.round(position.x * 1000) / 10;
        const y = Math.round(position.y * 1000) / 10;
        return `translate3d(${x}%, ${y}%, 0)`;
    }

    function tileStyle(x, y) {
        return { left: `${x * 100 / 15}%`, top: `${y * 100 / 13}%` };
    }

    function Tiles(map) {
        return h('div', { className: 'tiles' }, map.flatMap((row, y) => row.flatMap((tile, x) => (
            tile === 'floor' ? [] : [h('div', {
                key: `${x}-${y}`,
                className: `tile ${tile}`,
                style: tileStyle(x, y)
            })]
        ))));
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
            style: playerStyle(player)
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
            onKeydown: (event) => handleKey(event, true),
            onKeyup: (event) => handleKey(event, false),
            onBlur: releaseMovement
        },
            h('section', { className: 'play-column' },
                h('header', { className: 'game-header' },
                    h('div', {},
                        h('h1', { className: 'game-title' }, 'Bomberman'),
                        h('span', {}, 'Arrows / WASD to move · Space to bomb')
                    ),
                    h('span', {
                        className: 'frame-indicator',
                        'aria-hidden': 'true',
                        title: 'Animation running'
                    })
                ),
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

    function animatePlayers(now) {
        movementPending = false;
        for (const player of Object.values(latestGame.players)) {
            const position = displayPositions.get(player.id);
            if (!position) continue;
            const progress = Math.min(1, (now - position.startedAt) / position.duration);
            position.x = position.fromX + (position.targetX - position.fromX) * progress;
            position.y = position.fromY + (position.targetY - position.fromY) * progress;
            if (progress < 1) movementPending = true;
            const element = playerElements.get(player.id);
            if (!element) continue;
            const transform = positionTransform(position);
            if (element.style.transform !== transform) element.style.transform = transform;
        }
    }

    function runFrame(now) {
        frameQueued = false;
        let renderedGame = false;
        if (pendingGame) applySnapshot(now);

        if (renderPending) {
            renderPending = false;
            renderedGame = true;
            commitGame(latestGame);
            collectPlayerElements();
        }

        if (latestGame && movementPending) animatePlayers(now);

        if (focusPending && !renderedGame) {
            focusPending = false;
            document.querySelector('.game-shell')?.focus();
        }

        if (pendingGame || renderPending || focusPending || movementPending) {
            queueFrame();
        }
    }

    return { acceptSnapshot, refreshMovement, releaseMovement, render, requestFocus, reset };
}
