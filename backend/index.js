import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { GameEngine } from './game.js';

const frontendRoot = fileURLToPath(new URL('../frontend/', import.meta.url));
const port = Number(process.env.PORT) || 8086;
const colors = ['#e05252', '#4f8fe8', '#48a868', '#d49b35'];
const waitDuration = Number(process.env.WAIT_MS) || 20_000;
const countdownDuration = Number(process.env.COUNTDOWN_MS) || 10_000;
const resultDuration = Number(process.env.RESULT_MS) || 8000;
const reconnectDuration = Number(process.env.RECONNECT_MS) || 10_000;
const gameOptions = {
    bombDuration: Number(process.env.BOMB_MS) || 2200,
    invulnerabilityDuration: Number(process.env.INVULNERABLE_MS) || 1800
};

const players = new Map();
const sessions = new Map();
const chatHistory = [];
let phase = 'lobby';
let waitDeadline = 0;
let countdownDeadline = 0;
let game = null;
let sentMapVersion = -1;
let nextId = 1;
let lastTick = performance.now();
let lastBroadcast = 0;

const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8'
};

const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    const filename = resolve(frontendRoot, relative);
    if (!filename.startsWith(frontendRoot)) return response.writeHead(403).end('Forbidden');

    try {
        const file = await readFile(filename);
        response.writeHead(200, { 'Content-Type': types[extname(filename)] || 'application/octet-stream' });
        response.end(file);
    } catch {
        response.writeHead(404).end('Not found');
    }
});

const sockets = new WebSocketServer({ server });

function send(socket, message) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(message) {
    const payload = JSON.stringify(message);
    for (const player of players.values()) {
        if (player.socket?.readyState === WebSocket.OPEN) player.socket.send(payload);
    }
}

function publicPlayers() {
    return [...players.values()].map(({ id, nickname, color, slot }) => ({ id, nickname, color, slot }));
}

function lobbyMessage() {
    const now = Date.now();
    return {
        type: 'lobby',
        players: publicPlayers(),
        waitMs: waitDeadline ? Math.max(0, waitDeadline - now) : null,
        countdownMs: countdownDeadline ? Math.max(0, countdownDeadline - now) : null
    };
}

function broadcastLobby() {
    broadcast(lobbyMessage());
}

function startCountdown() {
    if (phase !== 'lobby' || countdownDeadline || players.size < 2) return;
    waitDeadline = 0;
    countdownDeadline = Date.now() + countdownDuration;
    broadcastLobby();
}

function startGame() {
    if (players.size < 2) return;
    phase = 'game';
    countdownDeadline = 0;
    waitDeadline = 0;
    game = new GameEngine(publicPlayers(), gameOptions);
    sentMapVersion = -1;
    broadcastGame();
}

function broadcastGame() {
    const includeMap = game.mapVersion !== sentMapVersion;
    const snapshot = game.snapshot(includeMap);
    if (includeMap) sentMapVersion = game.mapVersion;
    broadcast({ type: 'game', game: snapshot });
}

function sendCurrentView(socket) {
    send(socket, { type: 'chatHistory', messages: chatHistory });
    if (phase === 'game' && game) send(socket, { type: 'game', game: game.snapshot(true) });
    else send(socket, lobbyMessage());
}

function finishGame() {
    broadcastGame();
    setTimeout(resetLobby, resultDuration);
}

function resetLobby() {
    if (phase !== 'game' || !game?.finished) return;
    phase = 'lobby';
    game = null;
    sentMapVersion = -1;
    waitDeadline = players.size >= 2 ? Date.now() + waitDuration : 0;
    countdownDeadline = 0;
    broadcastLobby();
}

function updateLobby() {
    if (players.size < 2) {
        waitDeadline = 0;
        countdownDeadline = 0;
        return;
    }
    if (players.size === 4 && !countdownDeadline) startCountdown();
    else if (!waitDeadline && !countdownDeadline) waitDeadline = Date.now() + waitDuration;
    else if (waitDeadline && Date.now() >= waitDeadline) startCountdown();
    if (countdownDeadline && Date.now() >= countdownDeadline) startGame();
}

setInterval(() => {
    const now = performance.now();
    const delta = Math.min(.05, (now - lastTick) / 1000);
    lastTick = now;
    if (phase === 'game' && game) {
        if (game.update(delta)) finishGame();
    } else {
        updateLobby();
    }

    const broadcastInterval = phase === 'game' ? 50 : 250;
    if (now - lastBroadcast >= broadcastInterval) {
        lastBroadcast += broadcastInterval;
        if (now - lastBroadcast > broadcastInterval) lastBroadcast = now;
        if (phase === 'game' && game) broadcastGame();
        else broadcast(lobbyMessage());
    }
}, 1000 / 60);

sockets.on('connection', (socket) => {
    let connectionId;
    let sessionToken;
    let initialized = false;

    function initialize(requestedToken) {
        if (initialized) return;
        initialized = true;
        const resumedId = requestedToken && sessions.get(requestedToken);
        const resumedPlayer = resumedId && players.get(resumedId);

        if (resumedPlayer) {
            connectionId = resumedPlayer.id;
            sessionToken = requestedToken;
            clearTimeout(resumedPlayer.disconnectTimer);
            if (resumedPlayer.socket && resumedPlayer.socket !== socket) resumedPlayer.socket.close();
            resumedPlayer.socket = socket;
            resumedPlayer.disconnectTimer = null;
            send(socket, { type: 'welcome', id: connectionId, sessionToken, resumed: true });
            send(socket, { type: 'joined', nickname: resumedPlayer.nickname, resumed: true });
            sendCurrentView(socket);
            if (phase === 'lobby') broadcastLobby();
            return;
        }

        if (requestedToken) sessions.delete(requestedToken);
        connectionId = `u${nextId++}`;
        sessionToken = randomUUID();
        send(socket, { type: 'welcome', id: connectionId, sessionToken, resumed: false });
        send(socket, { type: 'chatHistory', messages: chatHistory });
    }

    socket.on('message', (raw) => {
        let message;
        try {
            message = JSON.parse(raw.toString());
        } catch {
            return;
        }

        if (message.type === 'hello') {
            initialize(typeof message.sessionToken === 'string' ? message.sessionToken : null);
            return;
        }
        if (!initialized) return;

        const current = players.get(connectionId);
        if (message.type === 'join') {
            const nickname = String(message.nickname || '').trim().slice(0, 18);
            if (current || !nickname) return;
            if (phase !== 'lobby') {
                send(socket, { type: 'error', message: 'A match is already running.' });
                return;
            }
            if (countdownDeadline) {
                send(socket, { type: 'error', message: 'The match is starting.' });
                return;
            }
            if (players.size >= 4) {
                send(socket, { type: 'error', message: 'The room is full.' });
                return;
            }
            if ([...players.values()].some((player) => player.nickname.toLowerCase() === nickname.toLowerCase())) {
                send(socket, { type: 'error', message: 'That nickname is already in use.' });
                return;
            }
            const usedSlots = new Set([...players.values()].map((player) => player.slot));
            const slot = [0, 1, 2, 3].find((value) => !usedSlots.has(value));
            players.set(connectionId, {
                id: connectionId,
                nickname,
                color: colors[slot],
                slot,
                socket,
                sessionToken,
                disconnectTimer: null,
                lastChatAt: 0
            });
            sessions.set(sessionToken, connectionId);
            send(socket, { type: 'joined', nickname });
            updateLobby();
            broadcastLobby();
            return;
        }

        if (!current) return;
        if (message.type === 'chat') {
            const text = String(message.text || '').trim().slice(0, 180);
            const now = Date.now();
            if (text && now - current.lastChatAt >= 250) {
                const chatMessage = { id: `m${nextId++}`, nickname: current.nickname, text };
                chatHistory.push(chatMessage);
                if (chatHistory.length > 60) chatHistory.shift();
                broadcast({ type: 'chat', message: chatMessage });
                current.lastChatAt = now;
            }
        }
        if (phase === 'game' && game?.hasPlayer(current.id)) {
            if (message.type === 'move') game.setInput(current.id, message.x, message.y);
            if (message.type === 'bomb') game.placeBomb(current.id);
        }
    });

    socket.on('close', () => {
        const player = players.get(connectionId);
        if (!player || player.socket !== socket) return;
        player.socket = null;
        game?.setInput(connectionId, 0, 0);
        player.disconnectTimer = setTimeout(() => {
            if (player.socket || players.get(connectionId) !== player) return;
            players.delete(connectionId);
            sessions.delete(player.sessionToken);
            game?.removePlayer(connectionId);
            if (phase === 'lobby' && players.size < 2) {
                waitDeadline = 0;
                countdownDeadline = 0;
            }
            if (phase === 'game' && game) {
                if (game.update(0)) finishGame();
                else broadcastGame();
            } else {
                broadcastLobby();
            }
        }, reconnectDuration);
    });
});

server.listen(port, () => console.log(`Bomberman DOM running at http://localhost:${port}`));
