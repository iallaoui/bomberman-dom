export function createConnection(onMessage, onStatus) {
    let channel;

    if ('SharedWorker' in window) {
        const worker = new SharedWorker(new URL('./socket-worker.js', import.meta.url), { name: 'bomberman-connection' });
        channel = worker.port;
        channel.start();
        channel.addEventListener('message', ({ data }) => {
            if (data.type === 'transport') onStatus(data.connected);
            else onMessage(data);
        });
        channel.postMessage({ type: 'connect' });
    } else {
        const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
        const socket = new WebSocket(`${protocol}://${location.host}`);
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
