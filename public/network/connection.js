export function createConnection(onMessage, onStatus) {
    let channel;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const serverPort = document.querySelector('meta[name="game-server-port"]')?.content || '8086';
    const socketUrl = `${protocol}//${location.hostname}:${serverPort}`;

    if ('SharedWorker' in window) {
        const worker = new SharedWorker(new URL('./socket-worker.js?v=2', import.meta.url), { name: 'bomberman-connection-v2' });
        channel = worker.port;
        channel.start();
        channel.addEventListener('message', ({ data }) => {
            if (data.type === 'transport') onStatus(data.connected);
            else onMessage(data);
        });
        channel.postMessage({ type: 'connect', socketUrl });
    } else {
        const socket = new WebSocket(socketUrl);
        channel = {
            postMessage(message) {
                if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
            }
        };
        socket.addEventListener('open', () => onStatus(true));
        socket.addEventListener('close', () => onStatus(false));
        socket.addEventListener('message', ({ data }) => onMessage(JSON.parse(data)));
    }

    return {
        send: (message) => channel.postMessage(message),
        activate: () => channel.postMessage({ type: 'tab-active' }),
        detach: () => channel.postMessage({ type: 'tab-detach' })
    };
}
