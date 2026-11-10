import { render } from './mini-framework/dom.js';
import { Events } from './mini-framework/event.js';
import Router from './mini-framework/router.js';
import { createStore } from './mini-framework/state.js';
import { createConnection } from './network/connection.js';
import { createChat } from './components/chat.js';
import { Join } from './screens/join.js';
import { Lobby } from './screens/lobby.js';
import { createGameScreen } from './screens/game.js';

const root = document.querySelector('#root');
const chatRoot = document.querySelector('#chat-root');
const appLayout = document.querySelector('#app-layout');
const store = createStore({
    screen: 'join',
    connected: false,
    id: null,
    roomId: null,
    lobby: { players: [], waitMs: null, countdownMs: null },
    game: null,
    error: ''
});
const screenPaths = { join: '/', lobby: '/lobby', game: '/game' };
let connection;
let gameScreen;
let chatMessages = [];

function send(message) {
    connection?.send(message);
}

const Chat = createChat({ send });

function renderChatNow() {
    render(Chat(chatMessages), chatRoot);
}

function clearChat() {
    chatMessages = [];
    chatRoot.replaceChildren();
}

gameScreen = createGameScreen({
    send,
    commitGame: (game) => store.setState({ screen: 'game', game })
});

function syncRoute(screen) {
    const path = screenPaths[screen] || '/';
    const currentPath = window.location.hash.slice(1) || '/';
    if (currentPath !== path) router.navigate(path);
}

const router = new Router({
    '/': () => syncRoute(store.getState().screen),
    '/lobby': () => syncRoute(store.getState().screen),
    '/game': () => syncRoute(store.getState().screen)
});

function handleMessage(message) {
    if (message.type === 'welcome') store.setState({ id: message.id });
    if (message.type === 'joined') {
        store.setState({ screen: 'lobby', roomId: message.roomId, error: '' });
    }
    if (message.type === 'chatHistory') {
        const state = store.getState();
        if ((state.screen === 'lobby' || state.screen === 'game') && state.roomId === message.roomId) {
            chatMessages = message.messages.slice(-60);
            renderChatNow();
        }
        return;
    }
    if (message.type === 'chat') {
        const state = store.getState();
        if ((state.screen !== 'lobby' && state.screen !== 'game') || state.roomId !== message.roomId) return;
        chatMessages = [...chatMessages.slice(-59), message.message];
        renderChatNow();
        return;
    }
    if (message.type === 'lobby') {
        gameScreen.reset();
        const screen = message.players.length ? 'lobby' : 'join';
        store.setState({ screen, roomId: message.roomId, lobby: message, game: null });
    }
    if (message.type === 'game') {
        gameScreen.acceptSnapshot(message.game);
        return;
    }
    if (message.type === 'error') store.setState({ error: message.message });
    if (message.type === 'logout') {
        gameScreen.reset();
        clearChat();
        store.setState({
            screen: 'join',
            roomId: null,
            lobby: { players: [], waitMs: null, countdownMs: null },
            game: null,
            error: message.message || 'Play again time expired.'
        });
    }
}

function App(state) {
    if (state.screen === 'join') return Join(state, send);
    if (state.screen === 'lobby') return Lobby(state);
    return gameScreen.render(state);
}

store.subscribe((state) => {
    syncRoute(state.screen);
    appLayout.className = `screen-${state.screen}`;
    render(App(state), root);
    if (state.screen === 'lobby' && !chatRoot.firstChild) renderChatNow();
    if (state.screen === 'join' && chatRoot.firstChild) clearChat();
});

const events = new Events(root);
events.init(['click', 'submit', 'keydown', 'keyup', 'blur']);
const chatEvents = new Events(chatRoot);
chatEvents.init(['submit']);
events.listen(window, 'blur', gameScreen.releaseMovement);
events.listen(document, 'visibilitychange', () => {
    if (document.hidden) {
        gameScreen.releaseMovement();
        return;
    }
    if (store.getState().game) gameScreen.refreshMovement();
});

render(App(store.getState()), root);
router.start();
connection = createConnection(
    handleMessage,
    (connected) => store.setState({ connected, error: connected ? '' : 'Disconnected.' })
);
