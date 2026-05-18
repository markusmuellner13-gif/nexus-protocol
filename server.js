'use strict';

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout:   60000,
  pingInterval:  25000
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── In-memory save cache ─────────────────────────────────────────────────────
// Saves are primarily held in the client's localStorage.
// This cache provides a server-side backup for the current server session only.
// Nothing is written to disk — no ephemeral-filesystem errors on any host.
const saveCache = new Map();

// ── Room Management ──────────────────────────────────────────────────────────
class GameRoom {
  constructor(id, hostId) {
    this.id        = id;
    this.hostId    = hostId;
    this.players   = new Map();
    this.gameState = {
      chapter:      0,
      started:      false,
      cutscene:     null,
      checkpoints:  {},
      storyChoices: {},
      enemyStates:  {},
      puzzleStates: {},
      collectibles: new Set()
    };
    this.created      = Date.now();
    this.lastActivity = Date.now();
  }

  addPlayer(socketId, data = {}) {
    const idx = this.players.size;
    const p = {
      id:        socketId,
      index:     idx,
      character: idx === 0 ? 'nova' : 'rook',
      name:      data.name || `Player ${idx + 1}`,
      x: idx === 0 ? 160 : 320,
      y: 400,
      velX: 0, velY: 0,
      hp: 100, maxHp: 100,
      state:  'idle',
      facing: 'right',
      abilities: { primary: { cd: 0 }, secondary: { cd: 0 } },
      stats: { kills: 0, deaths: 0, revives: 0 },
      ready: false
    };
    this.players.set(socketId, p);
    this.lastActivity = Date.now();
    return p;
  }

  removePlayer(id)  { this.players.delete(id); this.lastActivity = Date.now(); }
  isFull()          { return this.players.size >= 2; }
  isEmpty()         { return this.players.size === 0; }
  getOthers(id)     { return Array.from(this.players.values()).filter(p => p.id !== id); }

  publicData() {
    return {
      id:          this.id,
      playerCount: this.players.size,
      started:     this.gameState.started,
      players: Array.from(this.players.values()).map(p => ({
        id: p.id, character: p.character, name: p.name, index: p.index, ready: p.ready
      }))
    };
  }
}

const rooms = new Map();

// Prune stale rooms every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, room] of rooms) {
    if (room.lastActivity < cutoff || room.isEmpty()) rooms.delete(id);
  }
}, 10 * 60 * 1000);

// ── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id.slice(0, 8)} connected`);

  // Create room
  socket.on('create_room', (data) => {
    const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
    const room   = new GameRoom(roomId, socket.id);
    rooms.set(roomId, room);
    socket.join(roomId);
    socket.roomId = roomId;
    const player = room.addPlayer(socket.id, data);
    socket.emit('room_created', { roomId, player, playerIndex: player.index });
    console.log(`[R] Room ${roomId} created by ${socket.id.slice(0, 8)}`);
  });

  // Join room
  socket.on('join_room', (data) => {
    const roomId = (data.roomId || '').trim().toUpperCase();
    const room   = rooms.get(roomId);
    if (!room)        return socket.emit('join_error', { message: 'Room not found. Check the code and try again.' });
    if (room.isFull()) return socket.emit('join_error', { message: 'Room is full (2/2 players).' });

    socket.join(roomId);
    socket.roomId = roomId;
    const player = room.addPlayer(socket.id, data);

    socket.emit('room_joined', {
      roomId, player,
      playerIndex:  player.index,
      gameState:    room.gameState,
      otherPlayers: room.getOthers(socket.id)
    });
    socket.to(roomId).emit('player_joined', { player });

    if (room.isFull()) {
      io.to(roomId).emit('room_full', { players: Array.from(room.players.values()) });
    }
    console.log(`[J] ${socket.id.slice(0, 8)} joined room ${roomId}`);
  });

  // Ready toggle
  socket.on('player_ready', () => {
    if (!socket.roomId) return;
    const room = rooms.get(socket.roomId);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p) return;
    p.ready = !p.ready;
    io.to(socket.roomId).emit('player_ready_update', { id: socket.id, ready: p.ready });
    if (Array.from(room.players.values()).every(pl => pl.ready) && room.players.size === 2) {
      io.to(socket.roomId).emit('all_ready');
    }
  });

  // High-frequency position updates
  socket.on('player_update', (data) => {
    if (!socket.roomId) return;
    const room = rooms.get(socket.roomId);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p) return;
    Object.assign(p, {
      x: data.x, y: data.y,
      velX: data.velX, velY: data.velY,
      state: data.state, facing: data.facing, hp: data.hp
    });
    room.lastActivity = Date.now();
    socket.to(socket.roomId).emit('player_updated', {
      id: socket.id,
      x: data.x, y: data.y,
      velX: data.velX, velY: data.velY,
      state: data.state, facing: data.facing, hp: data.hp, anim: data.anim
    });
  });

  // Game events
  socket.on('game_event', (event) => {
    if (!socket.roomId) return;
    const room = rooms.get(socket.roomId);
    if (!room) return;
    room.lastActivity = Date.now();

    switch (event.type) {
      case 'start_game':
        room.gameState.started = true;
        io.to(socket.roomId).emit('game_event', { type: 'start_game' });
        break;

      case 'chapter_complete':
        room.gameState.chapter = (event.chapter || 0) + 1;
        room.gameState.checkpoints = {};
        io.to(socket.roomId).emit('game_event', {
          type: 'load_chapter', chapter: room.gameState.chapter
        });
        break;

      case 'story_choice':
        room.gameState.storyChoices[event.choiceId] = event.value;
        io.to(socket.roomId).emit('game_event', event);
        break;

      case 'checkpoint':
        room.gameState.checkpoints[event.id] = true;
        io.to(socket.roomId).emit('game_event', event);
        break;

      case 'enemy_killed': {
        room.gameState.enemyStates[event.enemyId] = 'dead';
        const pk = room.players.get(socket.id);
        if (pk) pk.stats.kills++;
        io.to(socket.roomId).emit('game_event', event);
        break;
      }

      case 'puzzle_solved':
        room.gameState.puzzleStates[event.puzzleId] = true;
        io.to(socket.roomId).emit('game_event', event);
        break;

      case 'collectible_picked':
        room.gameState.collectibles.add(event.id);
        socket.to(socket.roomId).emit('game_event', event);
        break;

      case 'player_died': {
        const dp = room.players.get(socket.id);
        if (dp) dp.stats.deaths++;
        io.to(socket.roomId).emit('game_event', event);
        break;
      }

      case 'player_revived': {
        const target   = room.players.get(event.targetId);
        if (target) { target.hp = 50; target.state = 'idle'; }
        const reviver  = room.players.get(socket.id);
        if (reviver) reviver.stats.revives++;
        io.to(socket.roomId).emit('game_event', event);
        break;
      }

      case 'cutscene_advance':
        socket.to(socket.roomId).emit('game_event', event);
        break;

      default:
        socket.to(socket.roomId).emit('game_event', event);
    }
  });

  // Ability broadcast
  socket.on('ability_used', (data) => {
    if (!socket.roomId) return;
    socket.to(socket.roomId).emit('ability_used', { id: socket.id, ...data });
  });

  // Chat
  socket.on('chat', (data) => {
    if (!socket.roomId) return;
    const room = rooms.get(socket.roomId);
    if (!room) return;
    const p = room.players.get(socket.id);
    io.to(socket.roomId).emit('chat', {
      from: p ? p.name : 'Unknown',
      msg:  String(data.msg || '').slice(0, 120),
      ts:   Date.now()
    });
  });

  // Save — store in memory cache (client localStorage is the primary store)
  socket.on('save_game', (data) => {
    const key = data.saveKey || socket.id;
    saveCache.set(key, { ...data, savedAt: Date.now() });
    socket.emit('game_saved', { saveKey: key, savedAt: saveCache.get(key).savedAt });
  });

  // Load from memory cache
  socket.on('load_game', (data) => {
    const save = saveCache.get(data.saveKey);
    if (save) socket.emit('game_loaded', save);
    else      socket.emit('load_error', { message: 'No server-side save found. Use your local save.' });
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id.slice(0, 8)} disconnected`);
    if (!socket.roomId) return;
    const room = rooms.get(socket.roomId);
    if (!room) return;
    room.removePlayer(socket.id);
    socket.to(socket.roomId).emit('player_left', { id: socket.id });
    if (room.isEmpty()) {
      rooms.delete(socket.roomId);
      console.log(`[R] Room ${socket.roomId} deleted`);
    }
  });
});

// ── REST API ─────────────────────────────────────────────────────────────────
app.get('/api/rooms', (_, res) => {
  const list = Array.from(rooms.values())
    .filter(r => !r.isFull() && !r.gameState.started)
    .map(r => r.publicData());
  res.json(list);
});

app.get('/api/health', (_, res) =>
  res.json({ status: 'ok', rooms: rooms.size, uptime: Math.floor(process.uptime()) })
);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 NEXUS Protocol server running on port ${PORT}\n`);

  // Keep Render free tier awake — self-ping every 14 min so the dyno never sleeps.
  // RENDER_EXTERNAL_URL is set automatically by Render; does nothing on other hosts.
  if (process.env.RENDER_EXTERNAL_URL) {
    const url = `${process.env.RENDER_EXTERNAL_URL}/api/health`;
    setInterval(() => {
      http.get(url, () => {}).on('error', () => {});
    }, 14 * 60 * 1000);
    console.log(`[keep-alive] Pinging ${url} every 14 min`);
  }
});
