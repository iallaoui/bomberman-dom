import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { GameEngine } from './game.js';
import { createGameBroadcaster } from './game-sync.js';

const frontendRoot = fileURLToPath(new URL('../frontend/', import.meta.url));
const port = 8086;
const colors = ['#e05252', '#4f8fe8', '#48a868', '#d49b35'];
const waitDuration = 20_000;
const countdownDuration = 10_000;
const resultDuration = 5_000;
const mainRoomId = 'main';
const tickRate = 1000 / 60;
const gameOptions = {
    bombDuration: 2200,
    invulnerabilityDuration: 1800
};

const players = new Map();
const playerSockets = new Map();
const roomChats = new Map();
const playAgainPlayers = new Set();
let phase = 'lobby';
let waitDeadline = 0;
let countdownDeadline = 0;
let game = null;
let nextId = 1;
let lastLobbyBroadcast = 0;
let resultTimer = null;

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
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(message) {
    const payload = JSON.stringify(message);
    for (const playerId of players.keys()) {
        const socket = playerSockets.get(playerId);
        if (socket?.readyState === WebSocket.OPEN) socket.send(payload);
    }
}

function roomChat(roomId) {
    if (!roomChats.has(roomId)) roomChats.set(roomId, []);
    return roomChats.get(roomId);
}

function roomPlayerIds(roomId) {
    return [...players.values()]
        .filter((player) => player.roomId === roomId)
        .map((player) => player.id);
}

function sendToPlayers(playerIds, message, excludedId = null) {
    const payload = JSON.stringify(message);
    for (const playerId of playerIds) {
        if (playerId === excludedId) continue;
        const socket = playerSockets.get(playerId);
        if (socket?.readyState === WebSocket.OPEN) socket.send(payload);
    }
}

function sendRoom(roomId, message, excludedId = null) {
    sendToPlayers(roomPlayerIds(roomId), message, excludedId);
}

function clearRoomChatIfEmpty(roomId) {
    if (!roomPlayerIds(roomId).length) roomChats.delete(roomId);
}

function lobbyMessage() {
    const now = Date.now();
    return {
        type: 'lobby',
        roomId: mainRoomId,
        players: [...players.values()],
        waitMs: waitDeadline ? Math.max(0, waitDeadline - now) : null,
        countdownMs: countdownDeadline ? Math.max(0, countdownDeadline - now) : null
    };
}

function broadcastLobby() {
    broadcast(lobbyMessage());
    lastLobbyBroadcast = performance.now();
}

const sendGameSnapshot = createGameBroadcaster(broadcast);

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
    sendGameSnapshot(game);
}

function finishGame() {
    if (phase !== 'game' || !game?.finished) return;
    broadcastGame();
    phase = 'result';
    playAgainPlayers.clear();
    clearTimeout(resultTimer);
    resultTimer = setTimeout(finalizeResult, resultDuration);
}

function playAgainLobbyMessage() {
    return {
        type: 'lobby',
        roomId: mainRoomId,
        players: [...players.values()].filter((player) => playAgainPlayers.has(player.id)),
        waitMs: null,
        countdownMs: null
    };
}

function broadcastPlayAgainLobby() {
    sendToPlayers(playAgainPlayers, playAgainLobbyMessage());
}

function finalizeResult() {
    if (phase !== 'result') return;
    clearTimeout(resultTimer);
    resultTimer = null;

    for (const [playerId, player] of players) {
        if (playAgainPlayers.has(playerId)) continue;
        send(playerSockets.get(playerId), {
            type: 'logout',
            message: 'You did not choose Play again within 5 seconds.'
        });
        players.delete(playerId);
        playerSockets.delete(playerId);
        clearRoomChatIfEmpty(player.roomId);
    }

    phase = 'lobby';
    game = null;
    waitDeadline = 0;
    countdownDeadline = 0;
    playAgainPlayers.clear();
    clearRoomChatIfEmpty(mainRoomId);
    updateLobby();
    if (players.size) broadcastLobby();
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

    if (phase === 'lobby') {
        updateLobby();
        if (performance.now() - lastLobbyBroadcast >= 250) broadcastLobby();
    }
}, tickRate);

sockets.on('connection', (socket) => {
    const connectionId = `u${nextId++}`;
    send(socket, { type: 'welcome', id: connectionId });

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
                slot,
                roomId: mainRoomId
            });
            playerSockets.set(connectionId, socket);
            const joinMessage = {
                id: `m${nextId++}`,
                system: true,
                text: `${nickname} joined the room.`
            };
            const history = roomChat(mainRoomId);
            history.push(joinMessage);
            if (history.length > 60) history.shift();
            send(socket, { type: 'joined', nickname, roomId: mainRoomId });
            send(socket, { type: 'chatHistory', roomId: mainRoomId, messages: history });
            sendRoom(mainRoomId, { type: 'chat', roomId: mainRoomId, message: joinMessage }, connectionId);
            updateLobby();
            broadcastLobby();
            return;
        }

        if (!current) return;
        if (message.type === 'playAgain' && phase === 'result' && game?.finished) {
            if (playAgainPlayers.has(current.id)) return;
            playAgainPlayers.add(current.id);
            game.setInput(current.id, 0, 0);
            broadcastPlayAgainLobby();
            send(socket, {
                type: 'chatHistory',
                roomId: current.roomId,
                messages: roomChat(current.roomId)
            });
            if (playAgainPlayers.size === players.size) finalizeResult();
            return;
        }

        const canChat = phase === 'lobby' || (phase === 'result' && playAgainPlayers.has(current.id));
        if (message.type === 'chat' && canChat) {
            const text = String(message.text || '').trim().slice(0, 180);
            if (!text) return;

            const chatMessage = { id: `m${nextId++}`, nickname: current.nickname, text };
            const history = roomChat(current.roomId);
            history.push(chatMessage);
            if (history.length > 60) history.shift();
            const recipients = phase === 'lobby' ? roomPlayerIds(current.roomId) : playAgainPlayers;
            sendToPlayers(recipients, { type: 'chat', roomId: current.roomId, message: chatMessage });
        }
        if (phase === 'game' && game?.hasPlayer(current.id)) {
            if (message.type === 'move') game.setInput(current.id, message.x, message.y);
            if (message.type === 'bomb') game.placeBomb(current.id);
        }
    });

    socket.on('close', () => {
        const player = players.get(connectionId);
        if (!player) return;
        playAgainPlayers.delete(connectionId);
        players.delete(connectionId);
        playerSockets.delete(connectionId);
        clearRoomChatIfEmpty(player.roomId);
        game?.removePlayer(connectionId);
        if (phase === 'lobby' && players.size < 2) {
            waitDeadline = 0;
            countdownDeadline = 0;
        }
        if (phase === 'game' && game) {
            if (game.update(0)) finishGame();
            else broadcastGame();
        } else if (phase === 'result') {
            if (!players.size) finalizeResult();
            else if (playAgainPlayers.size === players.size) finalizeResult();
            else broadcastPlayAgainLobby();
        } else {
            broadcastLobby();
        }
    });
});

server.listen(port, () => console.log(`Bomberman DOM running at http://localhost:${port}`));
