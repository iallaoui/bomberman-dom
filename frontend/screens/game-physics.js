const movementKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS']);

function positionTransform(position) {
    const x = Math.round(position.x * 1000) / 10;
    const y = Math.round(position.y * 1000) / 10;
    return `translate3d(${x}%, ${y}%, 0)`;
}

export function createGamePhysics({ send, commitGame }) {
    const pressed = new Set();
    const displayPositions = new Map();
    const playerElements = new Map();
    let frameId = null;
    let latestGame;
    let pendingGame;
    let lastMovement = '';

    function reset() {
        if (frameId !== null) cancelAnimationFrame(frameId);
        frameId = null;
        latestGame = null;
        pendingGame = null;
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

    function applySnapshot() {
        const game = pendingGame;
        pendingGame = null;
        latestGame = game;
        for (const player of Object.values(game.players)) {
            const previous = displayPositions.get(player.id);
            const teleport = previous && Math.hypot(player.x - previous.x, player.y - previous.y) > 2;
            displayPositions.set(player.id, {
                x: player.x, y: player.y, lives: player.lives, active: player.active,
                snap: !previous || previous.lives !== player.lives || previous.active !== player.active || Boolean(teleport)
            });
        }

        for (const id of displayPositions.keys()) {
            if (!game.players[id]) displayPositions.delete(id);
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
        if (event.code === 'Space') {
            event.preventDefault();
            if (down && !event.repeat) send({ type: 'bomb' });
        }
    }

    function releaseMovement() {
        pressed.clear();
        sendMovement();
    }

    function requestFocus() {
        document.querySelector('.game-shell')?.focus();
    }

    function refreshMovement() {
        queueFrame();
    }

    function playerStyle(player) {
        const position = displayPositions.get(player.id) || player;
        return {
            transform: positionTransform(position),
            transitionProperty: position.snap ? 'none' : ''
        };
    }

    function collectPlayerElements() {
        playerElements.clear();
        for (const element of document.querySelectorAll('[data-player-id]')) {
            playerElements.set(element.dataset.playerId, element);
        }
    }

    function queueFrame() {
        if (frameId !== null) return;
        frameId = requestAnimationFrame(runFrame);
    }

    function updatePlayerTransforms() {
        for (const [id, position] of displayPositions) {
            const element = playerElements.get(id);
            if (!element) continue;
            const transition = position.snap ? 'none' : '';
            if (element.style.transitionProperty !== transition) element.style.transitionProperty = transition;
            const transform = positionTransform(position);
            if (element.style.transform !== transform) element.style.transform = transform;
        }
    }

    function runFrame() {
        frameId = null;
        if (pendingGame) {
            const entering = !latestGame;
            const renderNeeded = entering || pendingGame.viewVersion !== latestGame.viewVersion;
            applySnapshot();
            if (renderNeeded) {
                commitGame(latestGame);
                collectPlayerElements();
            }
            // Set one target per snapshot; CSS interpolates it on the compositor.
            updatePlayerTransforms();
            if (entering) requestFocus();
        }

        if (latestGame) queueFrame();
    }

    return {
        acceptSnapshot,
        handleKey,
        playerStyle,
        refreshMovement,
        releaseMovement,
        requestFocus,
        reset
    };
}
