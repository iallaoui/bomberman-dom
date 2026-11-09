import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { GameEngine } from './game.js';

const frontendRoot = fileURLToPath(new URL('../frontend/', import.meta.url));
const port = 8086;
const colors = ['#e05252', '#4f8fe8', '#48a868', '#d49b35'];
const waitDuration = 20_000;
const countdownDuration = 10_000;
const resultDuration = 8000;
const tickRate = 1000 / 60;
const gameOptions = {
    bombDuration: 2200,
    invulnerabilityDuration: 1800
};

const players = new Map();
const playerSockets = new Map();
const chatHistory = [];
let phase = 'lobby';
let waitDeadline = 0;
let countdownDeadline = 0;
let game = null;
let nextId = 1;

const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8'
};

const server = http.createServer(async (request, response) => {
    const relative = request.url === '/' ? 'index.html' : request.url.slice(1);
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
    for (const playerId of players.keys()) {
        const socket = playerSockets.get(playerId);
        if (socket?.readyState === WebSocket.OPEN) socket.send(payload);
    }
}

function lobbyMessage() {
    const now = Date.now();
    return {
        type: 'lobby',
        players: [...players.values()],
        waitMs: waitDeadline ? waitDeadline - now : null,
        countdownMs: countdownDeadline ? countdownDeadline - now : null
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
    game = new GameEngine([...players.values()], gameOptions);
    broadcastGame();
}

function broadcastGame() {
    broadcast({
        type: 'game',
        game: { ...game.state, now: Date.now() }
    });
}

function finishGame() {
    broadcastGame();
    setTimeout(resetLobby, resultDuration);
}

function resetLobby() {
    if (phase !== 'game' || !game?.finished) return;
    phase = 'lobby';
    game = null;
    waitDeadline = 0;
    countdownDeadline = 0;
    broadcast({ type: 'lobby', players: [], waitMs: null, countdownMs: null });
    players.clear();
    playerSockets.clear();
}

function updateLobby() {
    if (players.size < 2) {
        waitDeadline = 0;
        countdownDeadline = 0;
        return;
    }

    const now = Date.now();

    if (countdownDeadline) {
        if (now >= countdownDeadline) startGame();
        return;
    }

    if (!waitDeadline) waitDeadline = now + waitDuration;
    if (players.size === 4 || now >= waitDeadline) startCountdown();
}

setInterval(() => {
    if (phase === 'game') {
        if (game.update(1 / 60)) finishGame();
        broadcastGame();
        return;
    }

    updateLobby();
    if (phase === 'lobby') broadcastLobby();
}, tickRate);

sockets.on('connection', (socket) => {
    const connectionId = `u${nextId++}`;
    send(socket, { type: 'welcome', id: connectionId });
    send(socket, { type: 'chatHistory', messages: chatHistory });

    socket.on('message', (raw) => {
        let message;
        try {
            message = JSON.parse(raw.toString());
        } catch {
            return;
        }

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
            const slot = [0, 1, 2, 3].find((value) => {
                return !usedSlots.has(value);
            });

            players.set(connectionId, {
                id: connectionId,
                nickname,
                color: colors[slot],
                slot
            });
            playerSockets.set(connectionId, socket);
            send(socket, { type: 'joined', nickname });
            updateLobby();
            broadcastLobby();
            return;
        }

        if (!current) return;
        if (message.type === 'chat') {
            const text = String(message.text || '').trim().slice(0, 180);
            if (!text) return;

            const chatMessage = { id: `m${nextId++}`, nickname: current.nickname, text };
            chatHistory.push(chatMessage);
            broadcast({ type: 'chat', message: chatMessage });
        }
        if (phase === 'game' && game?.hasPlayer(current.id)) {
            if (message.type === 'move') game.setInput(current.id, message.x, message.y);
            if (message.type === 'bomb') game.placeBomb(current.id);
        }
    });

    socket.on('close', () => {
        const player = players.get(connectionId);
        if (!player) return;
        players.delete(connectionId);
        playerSockets.delete(connectionId);
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
    });
});

server.listen(port, () => console.log(`Bomberman DOM running at http://localhost:${port}`));
