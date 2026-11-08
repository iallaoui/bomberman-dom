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
const store = createStore({
    screen: 'join',
    connected: false,
    id: null,
    lobby: { players: [], waitMs: null, countdownMs: null },
    chat: [],
    game: null,
    error: ''
});
const screenPaths = { join: '/', lobby: '/lobby', game: '/game' };
let connection;
let gameScreen;

function send(message) {
    connection?.send(message);
}

const Chat = createChat({
    send,
    getScreen: () => store.getState().screen,
    requestGameFocus: () => gameScreen.requestFocus()
});

gameScreen = createGameScreen({
    send,
    Chat,
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
    if (message.type === 'joined') store.setState({ screen: 'lobby', error: '' });
    if (message.type === 'chatHistory') store.setState({ chat: message.messages });
    if (message.type === 'chat') {
        store.setState(({ chat }) => ({ chat: [...chat.slice(-59), message.message] }));
    }
    if (message.type === 'lobby') {
        gameScreen.reset();
        store.setState({ screen: 'lobby', lobby: message, game: null });
    }
    if (message.type === 'game') gameScreen.acceptSnapshot(message.game);
    if (message.type === 'error') store.setState({ error: message.message });
}

function App(state) {
    if (state.screen === 'join') return Join(state, send);
    if (state.screen === 'lobby') return Lobby(state, Chat);
    return gameScreen.render(state);
}

store.subscribe((state) => {
    syncRoute(state.screen);
    render(App(state), root);
});

const events = new Events(root);
events.init(['click', 'submit', 'keydown', 'keyup', 'blur']);
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
