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
