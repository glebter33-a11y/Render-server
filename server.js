const WebSocket = require('ws');
const port = process.env.PORT || 8080; // Koyeb подставит свой порт

const wss = new WebSocket.Server({ port });
let nextId = 0;
const clients = new Map();

console.log(`WebSocket relay server on port ${port}`);

wss.on('connection', (ws) => {
    const id = nextId++;
    clients.set(id, ws);
    console.log(`Player ${id} connected. Total: ${clients.size}`);

    // Отправляем новому игроку его ID
    ws.send(JSON.stringify({ type: 'welcome', id }));

    ws.on('message', (data) => {
        // Ретранслируем сообщение всем, кроме отправителя
        for (const [otherId, otherWs] of clients) {
            if (otherId !== id && otherWs.readyState === WebSocket.OPEN) {
                otherWs.send(data.toString());
            }
        }
    });

    ws.on('close', () => {
        clients.delete(id);
        console.log(`Player ${id} disconnected. Total: ${clients.size}`);
    });
});
