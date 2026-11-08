export function createConnection(onMessage, onStatus) {
    const socket = new WebSocket(`ws://${location.host}`);
    socket.addEventListener('open', () => onStatus(true));
    socket.addEventListener('message', ({ data }) => onMessage(JSON.parse(data)));
    socket.addEventListener('close', () => onStatus(false));

    return {
        send(message) {
            if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
        }
    };
}
