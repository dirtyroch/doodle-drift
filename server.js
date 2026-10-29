'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 4747;
const MIN_PLAYERS = Number(process.env.MIN_PLAYERS || 3);
const MAX_PLAYERS = 12;
const GRACE_MS = Number(process.env.GRACE_MS || 2000);   // wait after deadline for client auto-submit
const FORCE_MS = Number(process.env.FORCE_MS || 2500);   // then fill anything still missing
const timeScaleEnv = () => Number(process.env.TIME_SCALE || 1);  // tests can speed timers up

const MODES = {
  classic: { label: 'Classic', write: 50, draw: 100 },
  speed:   { label: 'Speed Round', write: 20, draw: 40 },
  emoji:   { label: 'Emoji Only', write: 45, draw: 100 },
};
const WILDCARDS = [
  'Draw it using only ONE color',
  'Draw it without lifting your finger (one stroke!)',
  'Draw it as if it were happening underwater',
  'Make everything in it look surprised',
  'Draw it as a tiny version in the corner',
  'Add a mustache to something',
  'Draw it upside down',
  'Draw it as a 1950s movie poster',
  'No undo allowed. Live dangerously.',
  'Everything must be made of circles',
];
const AVATAR_EMOJI = ['🦊','🐸','🐙','🦄','🐼','🐯','🐵','🐧','🦉','🐢','🐳','🦖','👽','🤖','👻','🍕','🌵','🍩'];
const AVATAR_COLORS = ['#ff6b5b','#ffb238','#ffe066','#5ad1a7','#4cc9f0','#7b8cff','#c77dff','#ff7eb6','#9bdb4d','#f4a261'];

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.get('/r/:code', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 6e6, pingInterval: 10000, pingTimeout: 15000 });

/** @type {Map<string, any>} */
const rooms = new Map();

// ---------- helpers ----------
const CODE_CHARS = 'BCDFGHJKLMNPQRSTVWXZ';
function newCode() {
  let c;
  do { c = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(''); }
  while (rooms.has(c));
  return c;
}
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function cleanName(s) { return String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16); }
const EMOJI_RE = /\p{Extended_Pictographic}/u;
function cleanText(s, mode) {
  let t = String(s || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
  if (mode === 'emoji') {
    // keep only emoji clusters + spaces
    const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
    t = [...seg.segment(t)].map(x => x.segment).filter(g => g === ' ' || EMOJI_RE.test(g)).join('').replace(/\s+/g, ' ').trim();
  }
  return t;
}
function publicPlayer(p) { return { id: p.id, name: p.name, avatar: p.avatar, connected: p.connected }; }
function connectedPlayers(room) { return [...room.players.values()].filter(p => p.connected); }

function roomSummary(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    settings: room.settings,
    modes: MODES,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    players: [...room.players.values()].map(publicPlayer),
  };
}
function broadcastRoom(room) { io.to(room.code).emit('room', roomSummary(room)); }

function stepType(step) { return step % 2 === 0 ? 'text' : 'drawing'; }
function bookIndexFor(room, playerIdx, step) { const n = room.game.order.length; return ((playerIdx - step) % n + n) % n; }

function taskFor(room, playerId) {
  const g = room.game;
  const idx = g.order.indexOf(playerId);
  if (idx < 0) return null;
  const bi = bookIndexFor(room, idx, g.step);
  const book = g.books[bi];
  const prev = g.step > 0 ? book.entries[g.step - 1] : null;
  return {
    gameId: g.id,
    step: g.step,
    totalSteps: g.totalSteps,
    type: stepType(g.step),
    first: g.step === 0,
    prev: prev ? (prev.type === 'text' ? { type: 'text', text: prev.text } : { type: 'drawing', image: prev.image }) : null,
    deadline: g.deadline,
    duration: g.duration,
    serverNow: Date.now(),
    submitted: g.submitted.has(playerId),
    wildcard: g.wildcards[playerId] || null,
    mode: room.settings.mode,
  };
}

function progress(room) {
  const g = room.game;
  return { step: g.step, done: [...g.submitted], waitingOn: g.order.filter(id => !g.submitted.has(id)) };
}

function sendTask(room, p) {
  if (!p.socketId) return;
  io.to(p.socketId).emit('task', taskFor(room, p.id));
}

// ---------- game flow ----------
function startGame(room) {
  const ids = connectedPlayers(room).map(p => p.id);
  // drop disconnected lobby players before the game starts
  for (const p of [...room.players.values()]) if (!p.connected) room.players.delete(p.id);
  const order = shuffle(ids);
  room.phase = 'playing';
  room.game = {
    id: Math.random().toString(36).slice(2, 10),
    order,
    totalSteps: order.length,
    books: order.map(id => ({ ownerId: id, entries: [] })),
    step: -1,
    submitted: new Set(),
    deadline: 0, duration: 0,
    timers: [],
    wildcards: {},
  };
  broadcastRoom(room);
  nextStep(room);
}

function clearTimers(room) { if (room.game) { room.game.timers.forEach(clearTimeout); room.game.timers = []; } }

function nextStep(room) {
  const g = room.game;
  clearTimers(room);
  g.step += 1;
  if (g.step >= g.totalSteps) return startReveal(room);
  g.submitted = new Set();
  const m = MODES[room.settings.mode] || MODES.classic;
  const secs = (stepType(g.step) === 'text' ? m.write : m.draw) * (room.settings.timeScale || 1);
  g.duration = Math.round(secs * 1000 * timeScaleEnv());
  g.deadline = Date.now() + g.duration;
  g.wildcards = {};
  if (room.settings.wildcards && stepType(g.step) === 'drawing') {
    // roughly a third of drawers get a wildcard (at least one)
    const picks = shuffle(g.order).slice(0, Math.max(1, Math.round(g.order.length / 3)));
    for (const id of picks) g.wildcards[id] = WILDCARDS[Math.floor(Math.random() * WILDCARDS.length)];
  }
  for (const id of g.order) { const p = room.players.get(id); if (p) sendTask(room, p); }
  io.to(room.code).emit('progress', progress(room));
  const stepNow = g.step;
  g.timers.push(setTimeout(() => {
    if (room.game !== g || g.step !== stepNow) return;
    io.to(room.code).emit('force-submit', { step: stepNow });
    g.timers.push(setTimeout(() => { if (room.game === g && g.step === stepNow) fillMissingAndAdvance(room); }, FORCE_MS));
  }, g.duration + GRACE_MS));
  // a step can already be complete if every remaining player is offline
  maybeAdvanceForOffline(room);
}

function placeholderFor(room, type, playerId) {
  if (type === 'text') return { type: 'text', text: room.settings.mode === 'emoji' ? '🤷' : '…(drifted away)…', authorId: playerId, auto: true };
  return { type: 'drawing', image: null, strokes: [], authorId: playerId, auto: true };
}

function recordSubmission(room, playerId, data, auto) {
  const g = room.game;
  if (!g || g.submitted.has(playerId)) return false;
  const idx = g.order.indexOf(playerId);
  if (idx < 0) return false;
  const type = stepType(g.step);
  const book = g.books[bookIndexFor(room, idx, g.step)];
  let entry;
  if (type === 'text') {
    const text = cleanText(data && data.text, room.settings.mode);
    entry = text ? { type: 'text', text, authorId: playerId, auto: !!auto } : placeholderFor(room, 'text', playerId);
  } else {
    const image = data && typeof data.image === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(data.image) && data.image.length < 3e6 ? data.image : null;
    const strokes = Array.isArray(data && data.strokes) ? data.strokes.slice(0, 4000) : [];
    entry = image ? { type: 'drawing', image, strokes, authorId: playerId, auto: !!auto } : placeholderFor(room, 'drawing', playerId);
  }
  book.entries[g.step] = entry;
  g.submitted.add(playerId);
  return true;
}

function fillMissingAndAdvance(room) {
  const g = room.game;
  for (const id of g.order) if (!g.submitted.has(id)) recordSubmission(room, id, null, true);
  nextStep(room);
}

function maybeAdvance(room) {
  const g = room.game;
  io.to(room.code).emit('progress', progress(room));
  if (g.order.every(id => g.submitted.has(id))) {
    clearTimers(room);
    g.timers.push(setTimeout(() => nextStep(room), 900)); // brief beat so the last submit animation is seen
    return;
  }
  maybeAdvanceForOffline(room);
}

// If everyone still online has submitted, don't make them wait the full timer for offline players.
function maybeAdvanceForOffline(room) {
  const g = room.game;
  if (!g || room.phase !== 'playing') return;
  const online = g.order.filter(id => room.players.get(id)?.connected);
  if (online.length === 0) return; // nobody around; timers will handle it / room cleanup
  if (online.every(id => g.submitted.has(id)) && g.order.some(id => !g.submitted.has(id))) {
    if (g.offlineTimer) return;
    const stepNow = g.step;
    g.offlineTimer = setTimeout(() => {
      g.offlineTimer = null;
      if (room.game !== g || g.step !== stepNow) return;
      const stillOnline = g.order.filter(id => room.players.get(id)?.connected);
      if (stillOnline.every(id => g.submitted.has(id))) fillMissingAndAdvance(room);
    }, 4000);
    g.timers.push(g.offlineTimer);
  }
}

function startReveal(room) {
  clearTimers(room);
  room.phase = 'reveal';
  room.reveal = { book: 0, shown: 1 };
  broadcastRoom(room);
  io.to(room.code).emit('reveal', revealPayload(room));
}

function revealPayload(room) {
  const g = room.game;
  return {
    books: g.books.map(b => ({ ownerId: b.ownerId, entries: b.entries.map(e => ({ type: e.type, text: e.text, image: e.image, strokes: e.strokes, authorId: e.authorId, auto: e.auto })) })),
    players: Object.fromEntries([...room.players.values()].map(p => [p.id, { name: p.name, avatar: p.avatar }])),
    book: room.reveal.book,
    shown: room.reveal.shown,
  };
}

// ---------- sockets ----------
io.on('connection', (socket) => {
  let room = null; let me = null;

  function bind(r, p) {
    room = r; me = p;
    p.socketId = socket.id; p.connected = true;
    if (p.dropTimer) { clearTimeout(p.dropTimer); p.dropTimer = null; }
    socket.join(r.code);
    fixHost(r);
  }

  function sendFullState() {
    socket.emit('joined', { you: me.id, room: roomSummary(room) });
    if (room.phase === 'playing') {
      socket.emit('task', taskFor(room, me.id));
      socket.emit('progress', progress(room));
    } else if (room.phase === 'reveal') {
      socket.emit('reveal', revealPayload(room));
    }
  }

  socket.on('create', (data, ack) => {
    if (typeof ack !== 'function') return;
    const name = cleanName(data && data.name);
    if (!name) return ack({ error: 'Pick a nickname first.' });
    const code = newCode();
    const r = { code, hostId: null, phase: 'lobby', players: new Map(), settings: { mode: 'classic', wildcards: true, timeScale: 1 }, game: null, reveal: null, created: Date.now() };
    rooms.set(code, r);
    const p = makePlayer(data);
    r.players.set(p.id, p); r.hostId = p.id;
    bind(r, p);
    ack({ ok: true, code, you: p.id });
    sendFullState();
    broadcastRoom(r);
  });

  socket.on('join', (data, ack) => {
    if (typeof ack !== 'function') return;
    const code = String(data && data.code || '').toUpperCase().trim();
    const r = rooms.get(code);
    if (!r) return ack({ error: 'No room with that code. Double-check it?' });
    const pid = String(data && data.playerId || '');
    const existing = pid && r.players.get(pid);
    if (existing) {
      // reconnect / rejoin
      if (existing.connected && existing.socketId && existing.socketId !== socket.id) {
        const old = io.sockets.sockets.get(existing.socketId);
        if (old) { old.emit('kicked', { reason: 'You opened this game in another tab.' }); old.leave(r.code); }
      }
      if (data.name && r.phase === 'lobby') existing.name = cleanName(data.name) || existing.name;
      bind(r, existing);
      ack({ ok: true, code, you: existing.id, rejoined: true });
      sendFullState();
      broadcastRoom(r);
      if (r.phase === 'playing') maybeAdvance(r);
      return;
    }
    if (r.phase !== 'lobby') return ack({ error: 'That game already started. Ask the host to start a new one after this round!' });
    if (r.players.size >= MAX_PLAYERS) return ack({ error: 'Room is full (12 players max).' });
    const name = cleanName(data && data.name);
    if (!name) return ack({ error: 'Pick a nickname first.' });
    const p = makePlayer(data);
    // avoid duplicate names
    const names = new Set([...r.players.values()].map(x => x.name.toLowerCase()));
    let n = p.name, k = 2; while (names.has(n.toLowerCase())) n = `${p.name.slice(0, 13)} ${k++}`; p.name = n;
    r.players.set(p.id, p);
    if (!r.hostId || !r.players.get(r.hostId)?.connected) r.hostId = p.id;
    bind(r, p);
    ack({ ok: true, code, you: p.id });
    sendFullState();
    broadcastRoom(r);
  });

  function makePlayer(data) {
    const id = (data && typeof data.playerId === 'string' && /^[a-z0-9-]{8,40}$/i.test(data.playerId)) ? data.playerId : Math.random().toString(36).slice(2) + Date.now().toString(36);
    const av = data && data.avatar || {};
    return {
      id, name: cleanName(data && data.name) || 'Doodler',
      avatar: { emoji: AVATAR_EMOJI.includes(av.emoji) ? av.emoji : AVATAR_EMOJI[0], color: AVATAR_COLORS.includes(av.color) ? av.color : AVATAR_COLORS[0] },
      socketId: null, connected: false, dropTimer: null,
    };
  }

  socket.on('settings', (s) => {
    if (!room || !me || room.hostId !== me.id || room.phase !== 'lobby' || !s) return;
    if (s.mode && MODES[s.mode]) room.settings.mode = s.mode;
    if (typeof s.wildcards === 'boolean') room.settings.wildcards = s.wildcards;
    if ([0.75, 1, 1.5].includes(s.timeScale)) room.settings.timeScale = s.timeScale;
    broadcastRoom(room);
  });

  socket.on('kick', (id) => {
    if (!room || !me || room.hostId !== me.id || room.phase !== 'lobby' || id === me.id) return;
    const p = room.players.get(id); if (!p) return;
    if (p.socketId) { const s = io.sockets.sockets.get(p.socketId); if (s) { s.emit('kicked', { reason: 'The host removed you from the room.' }); s.leave(room.code); } }
    room.players.delete(id);
    broadcastRoom(room);
  });

  socket.on('start', (_d, ack) => {
    const cb = typeof ack === 'function' ? ack : () => {};
    if (!room || !me) return cb({ error: 'Not in a room.' });
    if (room.hostId !== me.id) return cb({ error: 'Only the host can start.' });
    if (room.phase !== 'lobby') return cb({ error: 'Already started.' });
    const n = connectedPlayers(room).length;
    if (n < MIN_PLAYERS) return cb({ error: `Need at least ${MIN_PLAYERS} players (you have ${n}).` });
    if (n > MAX_PLAYERS) return cb({ error: 'Too many players.' });
    cb({ ok: true });
    startGame(room);
  });

  socket.on('submit', (data, ack) => {
    const cb = typeof ack === 'function' ? ack : () => {};
    if (!room || !me || room.phase !== 'playing') return cb({ error: 'Not playing.' });
    if (data && typeof data.step === 'number' && data.step !== room.game.step) return cb({ error: 'That step is over.' });
    const ok = recordSubmission(room, me.id, data, data && data.auto);
    cb({ ok });
    if (ok) maybeAdvance(room);
  });

  socket.on('unsubmit', () => { // "wait, let me edit" while others are still going
    if (!room || !me || room.phase !== 'playing') return;
    const g = room.game;
    if (!g.submitted.has(me.id) || Date.now() > g.deadline) return;
    g.submitted.delete(me.id);
    io.to(room.code).emit('progress', progress(room));
  });

  socket.on('reveal:next', () => {
    if (!room || !me || room.phase !== 'reveal' || room.hostId !== me.id) return;
    const rv = room.reveal; const g = room.game;
    const len = g.books[rv.book].entries.length;
    if (rv.shown < len) rv.shown++;
    else if (rv.book < g.books.length - 1) { rv.book++; rv.shown = 1; }
    else return;
    io.to(room.code).emit('reveal:pos', { book: rv.book, shown: rv.shown });
  });
  socket.on('reveal:showall', () => {
    if (!room || !me || room.phase !== 'reveal' || room.hostId !== me.id) return;
    room.reveal.shown = room.game.books[room.reveal.book].entries.length;
    io.to(room.code).emit('reveal:pos', { book: room.reveal.book, shown: room.reveal.shown });
  });
  socket.on('reveal:goto', (b) => {
    if (!room || !me || room.phase !== 'reveal' || room.hostId !== me.id) return;
    if (!Number.isInteger(b) || b < 0 || b >= room.game.books.length) return;
    room.reveal.book = b; room.reveal.shown = 1;
    io.to(room.code).emit('reveal:pos', { book: b, shown: 1 });
  });

  socket.on('react', (emoji) => {
    if (!room || !me || typeof emoji !== 'string' || !['😂','😍','😱','👏','🔥','💀'].includes(emoji)) return;
    const now = Date.now(); if (me.lastReact && now - me.lastReact < 250) return; me.lastReact = now;
    io.to(room.code).emit('react', { emoji, from: me.id });
  });

  socket.on('lobby', () => { // play again
    if (!room || !me || room.hostId !== me.id || room.phase !== 'reveal') return;
    clearTimers(room);
    room.phase = 'lobby'; room.game = null; room.reveal = null;
    for (const p of [...room.players.values()]) if (!p.connected) room.players.delete(p.id);
    broadcastRoom(room);
  });

  socket.on('leave', () => { if (room && me) dropPlayer(true); });

  socket.on('disconnect', () => { if (room && me && me.socketId === socket.id) dropPlayer(false); });

  function dropPlayer(intentional) {
    const r = room, p = me;
    socket.leave(r.code);
    room = null; me = null;
    p.connected = false; p.socketId = null;
    if (r.phase === 'lobby') {
      const remove = () => { if (!p.connected && r.phase === 'lobby') { r.players.delete(p.id); fixHost(r); broadcastRoom(r); cleanupMaybe(r); } };
      if (intentional) remove(); else p.dropTimer = setTimeout(remove, 15000); // allow refresh/reconnect
    }
    fixHost(r);
    broadcastRoom(r);
    if (r.phase === 'playing') maybeAdvanceForOffline(r);
    cleanupMaybe(r);
  }
});

function fixHost(r) {
  const host = r.players.get(r.hostId);
  if (host && host.connected) return;
  const next = connectedPlayers(r)[0];
  if (next) r.hostId = next.id; else if (!host) r.hostId = null;
}
function cleanupMaybe(r) {
  if (connectedPlayers(r).length) return;
  setTimeout(() => {
    if (rooms.get(r.code) === r && connectedPlayers(r).length === 0) { clearTimers(r); rooms.delete(r.code); }
  }, 10 * 60 * 1000);
}

if (require.main === module) {
  server.listen(PORT, () => console.log(`Doodle Drift running on http://localhost:${PORT}`));
}
module.exports = { server, rooms };
