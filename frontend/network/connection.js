export function createConnection(onMessage, onStatus) {
    const socketUrl = `ws://${location.host}`;
    const storageKey = 'bomberman-session-token';
    let socket;
    let sessionToken;
    try {
        sessionToken = sessionStorage.getItem(storageKey);
    } catch {}

    function receive(message) {
        if (message.type === 'welcome' && message.sessionToken) {
            sessionToken = message.sessionToken;
            try {
                sessionStorage.setItem(storageKey, sessionToken);
            } catch {}
        }
        onMessage(message);
    }

    function connect() {
        if (socket && socket.readyState <= WebSocket.OPEN) return;
        socket = new WebSocket(socketUrl);

        socket.addEventListener('open', () => {
            socket.send(JSON.stringify({ type: 'hello', sessionToken }));
            onStatus(true);
        });
        socket.addEventListener('message', ({ data }) => {
            try {
                receive(JSON.parse(data));
            } catch {
                // Ignore malformed server messages.
            }
        });
        socket.addEventListener('close', () => {
            socket = null;
            onStatus(false);
        });
    }

    connect();

    return {
        send(message) {
            if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
        }
    };
}
