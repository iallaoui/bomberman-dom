export function createConnection(onMessage, onStatus) {
    let channel;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const serverPort = document.querySelector('meta[name="game-server-port"]')?.content || '8086';
    const socketUrl = `${protocol}//${location.hostname}:${serverPort}`;
    const storageKey = 'bomberman-session-token';
    let sessionToken;
    try {
        sessionToken = localStorage.getItem(storageKey);
    } catch {}

    function receive(message) {
        if (message.type === 'welcome' && message.sessionToken) {
            sessionToken = message.sessionToken;
            try {
                localStorage.setItem(storageKey, sessionToken);
            } catch {}
        }
        onMessage(message);
    }

    if ('SharedWorker' in window) {
        const worker = new SharedWorker(new URL('./socket-worker.js?v=3', import.meta.url), { name: 'bomberman-connection-v3' });
        channel = worker.port;
        channel.start();
        channel.addEventListener('message', ({ data }) => {
            if (data.type === 'transport') onStatus(data.connected);
            else receive(data);
        });
        channel.postMessage({ type: 'connect', socketUrl, sessionToken });
    } else {
        const socket = new WebSocket(socketUrl);
        channel = {
            postMessage(message) {
                if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
            }
        };
        socket.addEventListener('open', () => {
            socket.send(JSON.stringify({ type: 'hello', sessionToken }));
            onStatus(true);
        });
        socket.addEventListener('close', () => onStatus(false));
        socket.addEventListener('message', ({ data }) => receive(JSON.parse(data)));
    }

    return {
        send: (message) => channel.postMessage(message),
        activate: () => channel.postMessage({ type: 'tab-active' }),
        detach: () => channel.postMessage({ type: 'tab-detach' })
    };
}
