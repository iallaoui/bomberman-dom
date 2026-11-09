// Authoritative server-side game simulation.
export const columns = 15;
export const rows = 13;
export const spawns = [[1, 1], [columns - 2, 1], [1, rows - 2], [columns - 2, rows - 2]];

export function createMap(random = Math.random) {
    const safe = new Set();
    for (const [x, y] of spawns) {
        safe.add(`${x},${y}`);
        const horizontal = x === 1 ? 1 : -1;
        const vertical = y === 1 ? 1 : -1;
        for (let step = 1; step <= 3; step += 1) {
            safe.add(`${x + horizontal * step},${y}`);
            safe.add(`${x},${y + vertical * step}`);
        }
    }

    return Array.from({ length: rows }, (_, y) => Array.from({ length: columns }, (_, x) => {
        if (x === 0 || y === 0 || x === columns - 1 || y === rows - 1) return 'wall';
        if (x % 2 === 0 && y % 2 === 0) return 'wall';
        return !safe.has(`${x},${y}`) && random() < .62 ? 'block' : 'floor';
    }));
}

export class GameEngine {
    constructor(roster, options = {}) {
        this.bombDuration = options.bombDuration ?? 2200;
        this.invulnerabilityDuration = options.invulnerabilityDuration ?? 1800;
        this.random = options.random ?? Math.random;
        this.nextId = 1;

        const players = {};
        for (const player of roster) {
            const [x, y] = spawns[player.slot];
            players[player.id] = {
                ...player,
                x, y,
                lives: 3,
                active: true,
                bombLimit: 1,
                range: 2,
                speed: 3.2,
                input: { x: 0, y: 0 },
                invulnerableUntil: 0
            };
        }

        this.state = {
            map: createMap(this.random),
            viewVersion: 0,
            players,
            bombs: [],
            explosions: [],
            powerups: [],
            guaranteedPowerups: ['bomb', 'flame', 'speed'].sort(() => this.random() - .5),
            winner: null,
            startedAt: Date.now()
        };
    }

    hasPlayer(id) {
        return Boolean(this.state.players[id]);
    }

    get finished() {
        return Boolean(this.state.winner);
    }

    touchView() {
        this.state.viewVersion += 1;
    }

    setInput(id, x, y) {
        const player = this.state.players[id];
        if (!player?.active || this.state.winner) return;
        player.input = {
            x: Math.max(-1, Math.min(1, Number(x) || 0)),
            y: Math.max(-1, Math.min(1, Number(y) || 0))
        };
    }

    removePlayer(id) {
        const player = this.state.players[id];
        if (!player) return;
        player.active = false;
        player.input = { x: 0, y: 0 };
        this.touchView();
    }

    placeBomb(id) {
        const player = this.state.players[id];
        if (!player?.active || this.state.winner) return;
        const owned = this.state.bombs.filter((bomb) => bomb.ownerId === id).length;
        const x = Math.floor(player.x + .5);
        const y = Math.floor(player.y + .5);
        if (owned >= player.bombLimit || this.state.bombs.some((bomb) => bomb.x === x && bomb.y === y)) return;
        this.state.bombs.push({
            id: `b${this.nextId++}`,
            ownerId: id,
            x, y,
            range: player.range,
            explodeAt: Date.now() + this.bombDuration,
            ownerCanPass: true
        });
        this.touchView();
    }

    update(delta) {
        const game = this.state;
        if (game.winner) return false;
        const now = Date.now();
        for (const player of Object.values(game.players)) {
            if (player.invulnerableUntil && player.invulnerableUntil <= now) {
                player.invulnerableUntil = 0;
                this.touchView();
            }
        }
        this.movePlayers(delta);
        for (const bomb of [...game.bombs]) {
            if (bomb.explodeAt <= now && game.bombs.includes(bomb)) this.explode(bomb);
        }
        for (const explosion of game.explosions) {
            for (const player of Object.values(game.players)) {
                const px = Math.floor(player.x + .5);
                const py = Math.floor(player.y + .5);
                if (explosion.cells.some((cell) => cell.x === px && cell.y === py)) this.damagePlayer(player, now);
            }
        }
        const visibleExplosions = game.explosions.filter((explosion) => explosion.expiresAt > now);
        if (visibleExplosions.length !== game.explosions.length) this.touchView();
        game.explosions = visibleExplosions;
        return this.checkWinner();
    }

    overlapsBomb(x, y, bomb) {
        return [[x + .18, y + .18], [x + .82, y + .18], [x + .18, y + .82], [x + .82, y + .82]]
            .some(([px, py]) => Math.floor(px) === bomb.x && Math.floor(py) === bomb.y);
    }

    canMove(player, x, y) {
        const points = [[x + .18, y + .18], [x + .82, y + .18], [x + .18, y + .82], [x + .82, y + .82]];
        if (!points.every(([px, py]) => this.state.map[Math.floor(py)]?.[Math.floor(px)] === 'floor')) return false;
        return !this.state.bombs.some((bomb) => (
            this.overlapsBomb(x, y, bomb) && !(bomb.ownerId === player.id && bomb.ownerCanPass)
        ));
    }

    moveAxis(player, axis, amount) {
        if (!amount) return false;
        const nextX = player.x + (axis === 'x' ? amount : 0);
        const nextY = player.y + (axis === 'y' ? amount : 0);
        if (!this.canMove(player, nextX, nextY)) return false;
        player[axis] += amount;
        return true;
    }

    tileBlocked(x, y) {
        return this.state.map[Math.floor(y)]?.[Math.floor(x)] !== 'floor';
    }

    moveAxisWithSlide(player, axis, amount) {
        if (!amount || this.moveAxis(player, axis, amount)) return Boolean(amount);

        const slide = Math.abs(amount);
        if (axis === 'x') {
            const leadingX = player.x + (amount > 0 ? .82 : .18) + amount;
            const topBlocked = this.tileBlocked(leadingX, player.y + .18);
            const bottomBlocked = this.tileBlocked(leadingX, player.y + .82);
            if (topBlocked === bottomBlocked) return false;
            return this.moveAxis(player, 'y', topBlocked ? slide : -slide);
        }

        const leadingY = player.y + (amount > 0 ? .82 : .18) + amount;
        const leftBlocked = this.tileBlocked(player.x + .18, leadingY);
        const rightBlocked = this.tileBlocked(player.x + .82, leadingY);
        if (leftBlocked === rightBlocked) return false;
        return this.moveAxis(player, 'x', leftBlocked ? slide : -slide);
    }

    movePlayers(delta) {
        const game = this.state;
        for (const player of Object.values(game.players)) {
            if (!player.active) continue;
            let { x, y } = player.input;
            const diagonal = Boolean(x && y);
            if (diagonal) {
                x *= Math.SQRT1_2;
                y *= Math.SQRT1_2;
            }
            const distance = player.speed * delta;
            if (diagonal) {
                this.moveAxis(player, 'x', x * distance);
                this.moveAxis(player, 'y', y * distance);
            } else {
                this.moveAxisWithSlide(player, 'x', x * distance);
                this.moveAxisWithSlide(player, 'y', y * distance);
            }
            for (const bomb of game.bombs) {
                if (bomb.ownerId === player.id && bomb.ownerCanPass && !this.overlapsBomb(player.x, player.y, bomb)) {
                    bomb.ownerCanPass = false;
                }
            }

            const cellX = Math.floor(player.x + .5);
            const cellY = Math.floor(player.y + .5);
            const powerup = game.powerups.find((item) => item.x === cellX && item.y === cellY);
            if (!powerup) continue;
            if (powerup.type === 'bomb') player.bombLimit += 1;
            if (powerup.type === 'flame') player.range += 1;
            if (powerup.type === 'speed') player.speed = Math.min(5.2, player.speed + .4);
            game.powerups = game.powerups.filter((item) => item.id !== powerup.id);
            this.touchView();
        }
    }

    damagePlayer(player, now) {
        if (!player.active || player.invulnerableUntil > now) return;
        player.lives -= 1;
        player.invulnerableUntil = now + this.invulnerabilityDuration;
        if (player.lives <= 0) {
            player.active = false;
            player.input = { x: 0, y: 0 };
        } else {
            [player.x, player.y] = spawns[player.slot];
        }
        this.touchView();
    }

    explosionCells(bomb) {
        const cells = [{ x: bomb.x, y: bomb.y }];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            for (let step = 1; step <= bomb.range; step += 1) {
                const x = bomb.x + dx * step;
                const y = bomb.y + dy * step;
                const tile = this.state.map[y]?.[x];
                if (!tile || tile === 'wall') break;
                cells.push({ x, y });
                if (tile === 'block') break;
            }
        }
        return cells;
    }

    explode(bomb) {
        const game = this.state;
        game.bombs = game.bombs.filter((item) => item.id !== bomb.id);
        const cells = this.explosionCells(bomb);
        const now = Date.now();
        game.explosions.push({ id: `e${this.nextId++}`, cells, expiresAt: now + 550 });
        this.touchView();

        for (const cell of cells) {
            if (game.map[cell.y][cell.x] === 'block') {
                game.map[cell.y][cell.x] = 'floor';
                const guaranteed = game.guaranteedPowerups.shift();
                if (guaranteed || this.random() < .28) {
                    const types = ['bomb', 'flame', 'speed'];
                    game.powerups.push({
                        id: `p${this.nextId++}`,
                        x: cell.x,
                        y: cell.y,
                        type: guaranteed || types[Math.floor(this.random() * types.length)]
                    });
                }
            }

            for (const player of Object.values(game.players)) {
                const px = Math.floor(player.x + .5);
                const py = Math.floor(player.y + .5);
                if (px === cell.x && py === cell.y) this.damagePlayer(player, now);
            }
        }

        for (const chained of [...game.bombs]) {
            if (game.bombs.includes(chained) && cells.some((cell) => cell.x === chained.x && cell.y === chained.y)) {
                this.explode(chained);
            }
        }
    }

    checkWinner() {
        const game = this.state;
        if (game.winner || Date.now() - game.startedAt < 1500) return false;
        const alive = Object.values(game.players).filter((player) => player.active);
        if (alive.length > 1) return false;
        game.winner = alive[0]?.id || 'draw';
        for (const player of Object.values(game.players)) player.input = { x: 0, y: 0 };
        this.touchView();
        return true;
    }
}
