# Bomberman DOM

A real-time, 2–4 player Bomberman game built with standard DOM elements, a small custom frontend framework, Node.js, and WebSockets.

The project does not use React, Vue, Canvas, or WebGL. The included mini-framework provides virtual DOM rendering, keyed diffing, state, delegated events, and hash routing. The only external dependency is [`ws`](https://www.npmjs.com/package/ws) on the server.

## Start the game

Requirements:

- Node.js
- npm
- A modern browser

Install and start:

```sh
npm install
npm start
```

Open:

```text
http://localhost:8086
```

Open the address in two to four browser tabs or windows. Every connection represents one player and must use a unique nickname.

To play from another computer on the same network, replace `localhost` with the server computer's IP address:

```text
http://SERVER_IP:8086
```

The client builds its WebSocket URL from the page hostname, so LAN clients automatically connect to the same server. Port `8086` must be reachable through the server computer's firewall.

After changing frontend code, use a hard refresh (`Ctrl+Shift+R`) so the browser does not keep an older JavaScript file.

## Controls

| Action | Control |
|---|---|
| Move | Arrow keys or `WASD` |
| Place a bomb | `Space` |
| Chat | Chat input in the lobby or during the match |

## Complete game flow

### 1. Connection and joining

1. The browser opens a WebSocket connection to port `8086`.
2. The server assigns the connection an ID.
3. The player submits a nickname.
4. The server rejects empty or duplicate nicknames, a full room, or joining while a match is starting/running.
5. A successful player enters the main room and receives its chat history.
6. The room receives a system message such as `Alice joined the room.`

The room supports two to four players. Nicknames are compared case-insensitively.

### 2. Waiting and countdown

- With fewer than two players, the lobby waits without starting a timer.
- At two or three players, the server starts a **20-second waiting period**.
- If four players join, the waiting period ends immediately.
- The waiting period is followed by a **10-second countdown**.
- New players cannot join after the countdown begins.
- If the population falls below two before the match, the timers are cancelled.

Both timers are owned by the server. Lobby clients only display the remaining time sent by the server.

### 3. Match

The server creates the map and places every player in a different corner. Every player begins with:

- Three lives
- One simultaneous bomb
- Flame range of two tiles
- Base movement speed

The client sends only player intentions:

```text
move { x, y }
bomb
```

The server is authoritative. It validates movement, places bombs, calculates explosions and damage, awards power-ups, and decides the winner.

### 4. Result and Play again

The last active player wins. If nobody remains active, the result is a draw.

After the result:

1. Every player sees a **Play again** button.
2. Clicking it immediately returns that player to the lobby.
3. Players have **5 seconds** to click it.
4. Players who do not click it are logged out of the room.
5. If every remaining player clicks early, the result phase finishes immediately.
6. Retained players start the normal lobby flow again when at least two are present.

The WebSocket remains open after a logical logout, so the user can enter a nickname and join again.

## Game rules

- Gray walls are permanent.
- Brown blocks can be destroyed.
- Bombs explode after approximately 2.2 seconds.
- Flames travel in four directions.
- A wall stops a flame immediately.
- A destructible block receives the flame and stops it from travelling farther.
- A blast removes one life.
- A surviving damaged player returns to their spawn with approximately 1.8 seconds of invulnerability.
- A player is eliminated after losing all three lives.

Destroyed blocks may reveal:

| Power-up | Effect |
|---|---|
| `B` | Adds one simultaneous bomb |
| `F` | Adds one tile of flame range |
| `S` | Increases movement speed |

## Rendering and frame performance

The server simulation and browser presentation run at different rates intentionally:

```text
Server simulation: about 60 ticks/second
Movement snapshots: at most about 20 updates/second
Structural changes: sent immediately
Browser presentation: requestAnimationFrame
```

### Movement path

Normal movement does not rebuild the game virtual DOM:

```text
WebSocket game snapshot
        ↓
coalesced until requestAnimationFrame
        ↓
update player translate3d transform directly
        ↓
CSS interpolates the target with a 75 ms linear transition
```

The animation-frame loop remains active throughout the match. Player position changes write only the necessary inline transform. Respawns and large position jumps disable interpolation for that update so the player does not slide across the board.

### Structural changes

The game virtual DOM is rendered only when `viewVersion` changes, including:

- Bomb placement or removal
- Explosions
- Blocks and power-ups
- Damage, elimination, or invulnerability changes
- Winner/result UI

The tile VNodes and complete play column are cached. Keyed diffing preserves unchanged real DOM elements. The server sends the map at match start and again only after the map changes.

The small `LIVE` indicator uses a continuous opacity-only CSS animation. It provides continuous visual rendering without changing game state or rebuilding the DOM. It does not by itself guarantee a particular frame rate.

### Chat isolation

Game and chat packets take independent paths:

```text
WebSocket message
├── game packet → gameScreen.acceptSnapshot() → game component
└── chat packet → render(Chat, chatRoot)       → chat component
```

Chat has its own VDOM root and delegated submit handler. A chat message:

- Does not enter the game store
- Does not call the main `App()` renderer
- Does not build or compare the board VDOM
- Does not touch movement or animation-frame logic
- Updates only the contained chat panel

The browser displays the latest 60 messages. The server stores room history in memory, adds join messages, and clears the history when the room becomes empty or the server restarts.

Chat rendering still requires a small DOM update and paint, but it cannot invoke the game component's rendering path.

## Architecture

```text
Browser
├── game root
│   ├── join/lobby/game screens
│   ├── game state
│   └── requestAnimationFrame movement presentation
├── chat root
│   ├── independent message state
│   └── independent VDOM rendering
└── WebSocket connection
        ↓
Node server
├── HTTP static files
├── lobby and timers
├── room chat/history
├── 60 Hz authoritative simulation
└── snapshot synchronization
```

Important files:

```text
frontend/
  index.html                    game and chat mount points
  app.js                        WebSocket packet routing and screen coordination
  components/chat.js            isolated chat component
  screens/join.js               nickname screen
  screens/lobby.js              players and server timers
  screens/game.js               board, entities, HUD and result VDOM
  screens/game-physics.js       input, snapshot coalescing and transforms
  mini-framework/dom.js         VDOM creation and keyed patching
  mini-framework/state.js       application store
  mini-framework/event.js       delegated event system
  mini-framework/router.js      hash router
  network/connection.js         browser WebSocket connection
  style.css                     layout, containment and game presentation

backend/
  index.js                      HTTP/WebSocket server, lobby, chat and match phases
  game.js                       authoritative game rules and simulation
  game-sync.js                  snapshot rate and structural synchronization
```

## WebSocket message routing

Client to server:

| Type | Purpose |
|---|---|
| `join` | Enter the room with a nickname |
| `move` | Change the current movement direction |
| `bomb` | Request bomb placement |
| `chat` | Send a room message |
| `playAgain` | Return to the lobby after a result |

Server to client:

| Type | Purpose |
|---|---|
| `welcome` | Assign the connection ID |
| `joined` | Confirm room membership |
| `lobby` | Send players and timer state |
| `game` | Send an authoritative presentation snapshot |
| `chatHistory` | Initialize the room chat component |
| `chat` | Deliver one room message |
| `logout` | Remove a result-phase non-voter from the room |
| `error` | Explain a rejected action |
