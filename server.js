const WebSocket = require('ws');
const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });

let nextId = 0;
const clients = new Map(); // id -> { ws, room, team, hp, x, y, alive, name }
const rooms = new Map();   // roomId -> { mode, players: [ids], started }

// --- Утилиты ---
function send(ws, obj) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function broadcast(roomId, obj, excludeId = -1) {
    const room = rooms.get(roomId);
    if (!room) return;
    for (const pid of room.players) {
        if (pid === excludeId) continue;
        const c = clients.get(pid);
        if (c) send(c.ws, obj);
    }
}

function roomSnapshot(roomId) {
    const room = rooms.get(roomId);
    if (!room) return null;
    return {
        type: 'room',
        room: roomId,
        mode: room.mode,
        started: room.started,
        players: room.players.map(pid => {
            const c = clients.get(pid);
            return { id: pid, team: c.team, hp: c.hp, alive: c.alive, name: c.name };
        })
    };
}

function findOrCreateRoom(mode) {
    for (const [id, room] of rooms) {
        if (room.mode === mode && !room.started && room.players.length < mode * 2) {
            return id;
        }
    }
    const id = `room_${rooms.size}_${Date.now()}`;
    rooms.set(id, { mode, players: [], started: false });
    return id;
}

function tryStart(roomId) {
    const room = rooms.get(roomId);
    if (!room || room.started) return;
    if (room.players.length === room.mode * 2) {
        room.started = true;
        // Сброс HP и позиций
        for (const pid of room.players) {
            const c = clients.get(pid);
            c.hp = 100;
            c.alive = true;
            c.x = 0;
            c.y = 0;
        }
        broadcast(roomId, { type: 'start', room: roomId, mode: room.mode });
        broadcast(roomId, roomSnapshot(roomId));
    }
}

function checkWin(roomId) {
    const room = rooms.get(roomId);
    if (!room || !room.started) return;
    const aliveTeams = new Set();
    for (const pid of room.players) {
        const c = clients.get(pid);
        if (c.alive) aliveTeams.add(c.team);
    }
    if (aliveTeams.size <= 1) {
        const winner = aliveTeams.size === 1 ? [...aliveTeams][0] : -1;
        broadcast(roomId, { type: 'win', team: winner });
        room.started = false;
        // Сброс для следующего раунда
        for (const pid of room.players) {
            const c = clients.get(pid);
            c.hp = 100;
            c.alive = true;
        }
    }
}

// --- Подключение ---
wss.on('connection', (ws) => {
    const id = nextId++;
    clients.set(id, { ws, room: null, team: 0, hp: 100, x: 0, y: 0, alive: true, name: `Player${id}` });
    send(ws, { type: 'welcome', id });
    console.log(`Player ${id} connected. Total: ${clients.size}`);

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        const me = clients.get(id);
        if (!me) return;

        switch (msg.type) {
            case 'join': {
                // msg.mode: 1 = 1v1, 2 = 2v2
                const mode = (msg.mode === 2) ? 2 : 1;
                if (me.room) return; // уже в комнате
                const roomId = findOrCreateRoom(mode);
                const room = rooms.get(roomId);
                me.room = roomId;
                me.team = room.players.length % 2;
                if (msg.name) me.name = String(msg.name).slice(0, 16);
                room.players.push(id);
                broadcast(roomId, roomSnapshot(roomId));
                tryStart(roomId);
                break;
            }
            case 'pos': {
                if (!me.room) break;
                me.x = Number(msg.x) || 0;
                me.y = Number(msg.y) || 0;
                broadcast(me.room, { type: 'pos', id, x: me.x, y: me.y }, id);
                break;
            }
            case 'shoot': {
                if (!me.room || !me.alive) break;
                broadcast(me.room, {
                    type: 'shoot', id,
                    x: Number(msg.x) || 0, y: Number(msg.y) || 0,
                    dx: Number(msg.dx) || 0, dy: Number(msg.dy) || 0
                }, id);
                break;
            }
            case 'hit': {
                // msg.target — id жертвы, msg.damage — урон
                if (!me.room) break;
                const target = clients.get(msg.target);
                if (!target || target.room !== me.room || !target.alive) break;
                const dmg = Math.max(1, Math.min(100, Number(msg.damage) || 12));
                target.hp -= dmg;
                if (target.hp <= 0) {
                    target.hp = 0;
                    target.alive = false;
                    broadcast(me.room, { type: 'death', id: msg.target });
                    checkWin(me.room);
                }
                broadcast(me.room, { type: 'hp', id: msg.target, hp: target.hp });
                break;
            }
            case 'leave': {
                if (me.room) {
                    const room = rooms.get(me.room);
                    if (room) {
                        room.players = room.players.filter(p => p !== id);
                        if (room.players.length === 0) rooms.delete(me.room);
                        else broadcast(me.room, roomSnapshot(me.room));
                    }
                    me.room = null;
                }
                break;
            }
        }
    });

    ws.on('close', () => {
        const me = clients.get(id);
        if (me && me.room) {
            const room = rooms.get(me.room);
            if (room) {
                room.players = room.players.filter(p => p !== id);
                if (room.players.length === 0) rooms.delete(me.room);
                else broadcast(me.room, roomSnapshot(me.room));
            }
        }
        clients.delete(id);
        console.log(`Player ${id} disconnected. Total: ${clients.size}`);
    });
});

console.log(`WebSocket server on port ${port}`);
