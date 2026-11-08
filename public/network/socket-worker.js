// One native WebSocket shared by every tab from the same browser profile.
const ports = new Set();
let socket;
let reconnectTimer;
let welcome;
let joined;
let view;
let joinRequest;
let activePort;
let latestMap;
let socketUrl;
let sessionToken;
const chat = [];

function broadcast(message) {
    for (const port of ports) port.postMessage(message);
}

function remember(message) {
    if (message.type === 'welcome') {
        welcome = message;
        sessionToken = message.sessionToken;
    }
    if (message.type === 'joined') joined = message;
    if (message.type === 'lobby') {
        view = message;
        latestMap = null;
    }
    if (message.type === 'game') {
        if (message.game.map) latestMap = message.game.map;
        view = { ...message, game: { ...message.game, map: message.game.map || latestMap } };
    }
    if (message.type === 'chat') {
        chat.push(message);
        if (chat.length > 60) chat.shift();
    }
    if (message.type === 'chatHistory') {
        chat.length = 0;
        for (const item of message.messages) chat.push({ type: 'chat', message: item });
    }
}

function openSocket() {
    if (!socketUrl) return;
    if (socket && socket.readyState <= WebSocket.OPEN) return;
    clearTimeout(reconnectTimer);
    socket = new WebSocket(socketUrl);

    socket.addEventListener('open', () => {
        broadcast({ type: 'transport', connected: true });
        socket.send(JSON.stringify({ type: 'hello', sessionToken }));
        if (joinRequest) socket.send(JSON.stringify(joinRequest));
    });
    socket.addEventListener('message', ({ data }) => {
        const message = JSON.parse(data);
        remember(message);
        broadcast(message);
    });
    socket.addEventListener('close', () => {
        socket = null;
        welcome = null;
        joined = null;
        view = null;
        if (ports.size) {
            broadcast({ type: 'transport', connected: false });
            reconnectTimer = setTimeout(openSocket, 500);
        } else {
            joinRequest = null;
            latestMap = null;
            chat.length = 0;
        }
    });
}

self.onconnect = ({ ports: [port] }) => {
    ports.add(port);
    activePort ||= port;
    port.start();
    port.postMessage({ type: 'transport', connected: socket?.readyState === WebSocket.OPEN });
    if (welcome) port.postMessage(welcome);
    if (joined) port.postMessage(joined);
    if (view) port.postMessage(view);
    for (const message of chat) port.postMessage(message);

    port.addEventListener('message', ({ data }) => {
        if (data?.type === 'connect') {
            socketUrl = data.socketUrl;
            sessionToken ||= data.sessionToken;
            openSocket();
            return;
        }
        if (data?.type === 'tab-active') {
            if (activePort !== port && socket?.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'move', x: 0, y: 0 }));
            }
            activePort = port;
            return;
        }
        if (data?.type === 'tab-detach') {
            ports.delete(port);
            if (activePort === port) activePort = ports.values().next().value;
            if (!ports.size) {
                clearTimeout(reconnectTimer);
                joinRequest = null;
                latestMap = null;
                chat.length = 0;
                socket?.close();
            }
            return;
        }
        if (data?.type === 'join') {
            if (joined || joinRequest) return;
            joinRequest = data;
        }
        if ((data?.type === 'move' || data?.type === 'bomb') && activePort !== port) return;
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
    });
    openSocket();
};
