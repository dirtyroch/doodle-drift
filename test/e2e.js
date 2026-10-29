// End-to-end test: spins up the server in-process and drives it with many simulated socket clients.
process.env.TIME_SCALE = process.env.TIME_SCALE || '0.02'; // 100s draw -> 2s
process.env.GRACE_MS = '300'; process.env.FORCE_MS = '400';
const assert = require('assert');
const { io } = require('socket.io-client');
const { server, rooms } = require('../server');

const PORT = 4799; const URL = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const DOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✔', msg); };

function client(name, opts = {}) {
  const s = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false });
  const c = { s, name, pid: opts.pid || ('t' + Math.random().toString(36).slice(2, 12)), tasks: [], room: null, reveal: null, pos: null, kicked: null, auto: opts.auto !== false, silent: !!opts.silent, reacts: 0 };
  s.on('room', r => { c.room = r; });
  s.on('joined', ({ room }) => { c.room = room; });
  s.on('kicked', k => { c.kicked = k; });
  s.on('react', () => c.reacts++);
  s.on('reveal', r => { c.reveal = r; });
  s.on('reveal:pos', p => { c.pos = p; if (c.reveal) { c.reveal.book = p.book; c.reveal.shown = p.shown; } });
  s.on('task', t => {
    c.tasks.push(t);
    if (c.silent || !c.auto || t.submitted) return;
    setTimeout(() => submitFor(c, t), 20 + Math.random() * 80);
  });
  s.on('force-submit', ({ step }) => { c.forced = (c.forced || 0) + 1; });
  return c;
}
function submitFor(c, t) {
  if (t.type === 'text') {
    const text = t.first ? `${c.name}'s prompt` : `${c.name} guesses step ${t.step}`;
    c.s.emit('submit', { step: t.step, text });
  } else {
    c.s.emit('submit', { step: t.step, image: DOT, strokes: [{ t: 's', c: '#000', w: 8, p: [1, 2, 3, 4] }] });
  }
}
const emitAck = (c, ev, data) => new Promise(r => c.s.emit(ev, data, r));
async function waitFor(fn, ms = 8000, label = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return; await sleep(25); }
  throw new Error('Timed out waiting for ' + label);
}
async function connect(c) { await new Promise(r => c.s.on('connect', r)); return c; }

async function makeRoom(n, mode, extra = {}) {
  const host = await connect(client('Host', extra.host));
  const res = await emitAck(host, 'create', { name: 'Host', avatar: { emoji: '🦊', color: '#ff6b5b' }, playerId: host.pid });
  assert.ok(res.ok, 'create ok');
  const others = [];
  for (let i = 1; i < n; i++) {
    const c = await connect(client('P' + i, (extra.players || {})[i]));
    const r = await emitAck(c, 'join', { code: res.code, name: 'P' + i, avatar: { emoji: '🐸', color: '#5ad1a7' }, playerId: c.pid });
    assert.ok(r.ok, 'join ok ' + r.error);
    others.push(c);
  }
  if (mode) host.s.emit('settings', { mode });
  await waitFor(() => host.room && host.room.players.length === n && (!mode || host.room.settings.mode === mode), 3000, 'all joined');
  return { code: res.code, host, others, all: [host, ...others] };
}
const closeAll = (all) => all.forEach(c => c.s.close());

async function testFullGame() {
  console.log('\n▶ Full game, 5 players, everyone plays');
  const { code, host, others, all } = await makeRoom(5);
  ok(host.room.hostId === host.room.players[0].id, 'creator is host');
  const nh = await emitAck(others[0], 'start');
  ok(nh.error && /host/i.test(nh.error), 'non-host cannot start');
  const st = await emitAck(host, 'start');
  ok(st.ok, 'host starts game');
  const late = await connect(client('Late'));
  const lr = await emitAck(late, 'join', { code, name: 'Late', playerId: late.pid });
  ok(lr.error && /started/.test(lr.error), 'late joiner rejected while game in progress'); late.s.close();
  await waitFor(() => all.every(c => c.reveal), 15000, 'reveal');
  ok(all.every(c => c.tasks.filter(t => !t.submitted).length === 5), 'each player got 5 tasks (one per step)');
  ok(all.every(c => c.tasks.map(t => t.type).join() === 'text,drawing,text,drawing,text'), 'steps alternate write/draw');
  const R = host.reveal;
  ok(R.books.length === 5, '5 sketchbooks');
  ok(R.books.every(b => b.entries.length === 5), 'each sketchbook has 5 pages');
  ok(R.books.every(b => b.entries[0].authorId === b.ownerId), 'owner wrote first page of own book');
  ok(R.books.every(b => new Set(b.entries.map(e => e.authorId)).size === 5), 'every page of a book is by a different player');
  for (let s = 0; s < 5; s++) ok(new Set(R.books.map(b => b.entries[s].authorId)).size === 5, `step ${s}: each player authored exactly one page`);
  ok(R.books.every(b => b.entries.every(e => !e.auto)), 'no auto-filled pages when everyone submits');
  // Each text page that follows a drawing was written by the person who saw that drawing; check chain continuity
  const p0 = R.books[0].entries;
  ok(p0[1].type === 'drawing' && p0[1].image === DOT && Array.isArray(p0[1].strokes), 'drawing pages keep image + strokes for replay');
  // reveal navigation
  others[0].s.emit('reveal:next'); await sleep(150);
  ok(host.reveal.shown === 1, 'guests cannot advance the reveal');
  let guard = 0;
  while (!(host.reveal.book === 4 && host.reveal.shown === 5) && guard++ < 40) { host.s.emit('reveal:next'); await sleep(40); }
  ok(host.reveal.book === 4 && host.reveal.shown === 5, 'host stepped through all 25 pages');
  await waitFor(() => others.every(c => c.reveal.book === 4 && c.reveal.shown === 5), 2000, 'guests synced');
  ok(true, 'reveal position synced to all guests');
  host.s.emit('reveal:goto', 2); await waitFor(() => others[2].pos && others[2].pos.book === 2, 2000, 'goto');
  ok(true, 'host can jump to a specific sketchbook');
  host.s.emit('react', '😂'); others[1].s.emit('react', '🔥'); others[1].s.emit('react', 'not-an-emoji');
  await sleep(200);
  ok(others[3].reacts === 2, 'reactions broadcast (invalid ones ignored)');
  host.s.emit('lobby');
  await waitFor(() => all.every(c => c.room.phase === 'lobby'), 2000, 'back to lobby');
  ok(all.every(c => c.room.players.length === 5), 'play again returns everyone to the lobby');
  // second game works in same room
  all.forEach(c => { c.tasks = []; c.reveal = null; });
  await emitAck(host, 'start');
  await waitFor(() => all.every(c => c.reveal), 15000, 'second reveal');
  ok(true, 'second game in the same room completes');
  closeAll(all);
}

async function testTimeoutAndDisconnect() {
  console.log('\n▶ Timeouts, AFK player, disconnect + reconnect');
  const { host, others, all, code } = await makeRoom(4, null, { players: { 3: { silent: true } } });
  const afk = others[2]; // silent: never submits, stays connected
  await emitAck(host, 'start');
  await waitFor(() => host.tasks.length >= 1, 2000, 'first task');
  const d = host.tasks[0].duration;
  ok(d > 0 && d < 3000, `timers scaled for test (${d}ms write)`);
  // wait for step 1 to begin (requires timeout because afk never submits)
  const t0 = Date.now();
  await waitFor(() => host.tasks.some(t => t.step === 1), 6000, 'step 1 after timeout');
  ok(Date.now() - t0 >= d, 'step advanced only after timer + grace expired');
  ok(afk.forced >= 1, 'server asked stragglers to force-submit at timeout');
  // P1 disconnects during the drawing step
  const p1 = others[0]; const p1pid = p1.pid;
  p1.auto = false; // don't auto-submit this step; disconnect instead
  await sleep(50);
  p1.s.close();
  await waitFor(() => host.room.players.find(p => p.id === p1pid && !p.connected), 2000, 'p1 shown offline');
  ok(true, 'disconnected player marked offline (not removed) mid-game');
  // reconnect with same playerId
  const p1b = await connect(client('P1', { pid: p1pid }));
  const rj = await emitAck(p1b, 'join', { code, playerId: p1pid });
  ok(rj.ok && rj.rejoined, 'player can rejoin mid-game with same id');
  await waitFor(() => p1b.tasks.length >= 1, 2000, 'task resent');
  ok(p1b.tasks[0].step >= 1, 'rejoined player gets their current task back');
  all[1] = p1b;
  await waitFor(() => host.reveal, 20000, 'reveal');
  const R = host.reveal;
  const afkId = host.room.players.find(p => p.name === 'P3').id;
  const afkEntries = R.books.flatMap(b => b.entries).filter(e => e.authorId === afkId);
  ok(afkEntries.length === 4 && afkEntries.every(e => e.auto), 'AFK player\'s pages were auto-filled');
  ok(R.books.every(b => b.entries.length === 4), 'all books complete despite AFK + disconnect');
  closeAll([host, p1b, others[1], afk]);
}

async function testOfflineSkip() {
  console.log('\n▶ Offline players don\'t stall the table');
  process.env.TIME_SCALE = '1'; // long timers: proves we advance early
  const { host, others, all } = await makeRoom(3);
  host.s.emit('settings', { timeScale: 1.5 });
  await sleep(100);
  others[1].auto = false;
  await emitAck(host, 'start');
  await waitFor(() => others[1].tasks.length === 1, 2000, 'task');
  others[1].s.close(); // leaves during step 0 without submitting
  const t0 = Date.now();
  await waitFor(() => host.tasks.some(t => t.step === 1), 8000, 'advance w/o offline player');
  ok(host.tasks[0].duration >= 70000 && Date.now() - t0 < 6000, `advanced ~${Date.now() - t0}ms after remaining players finished (timer was ${host.tasks[0].duration}ms)`);
  closeAll(all);
}

async function testLobbyRules() {
  console.log('\n▶ Lobby rules & validation');
  const bad = await connect(client('X'));
  const r1 = await emitAck(bad, 'join', { code: 'ZZZZ', name: 'X', playerId: bad.pid });
  ok(r1.error, 'unknown room code rejected');
  const r2 = await emitAck(bad, 'create', { name: '   ' });
  ok(r2.error, 'blank nickname rejected');
  bad.s.close();
  const { host, others, all, code } = await makeRoom(2);
  const st = await emitAck(host, 'start');
  ok(st.error && /at least 3/.test(st.error), 'cannot start with fewer than 3 players');
  const dup = await connect(client('P1'));
  await emitAck(dup, 'join', { code, name: 'P1', playerId: dup.pid });
  await sleep(100);
  ok(host.room.players.some(p => p.name === 'P1 2'), 'duplicate nickname gets de-duplicated');
  const xss = await connect(client('x'));
  await emitAck(xss, 'join', { code, name: '<img src=x>', playerId: xss.pid });
  await sleep(100);
  ok(!host.room.players.some(p => /[<>]/.test(p.name)), 'angle brackets stripped from names');
  // fill to 12
  const extra = [];
  while (host.room.players.length < 12) {
    const c = await connect(client('F'));
    await emitAck(c, 'join', { code, name: 'F' + extra.length, playerId: c.pid }); extra.push(c); await sleep(10);
  }
  const over = await connect(client('Over'));
  const ro = await emitAck(over, 'join', { code, name: 'Over', playerId: over.pid });
  ok(ro.error && /full/.test(ro.error), '13th player rejected (12 max)');
  // kick
  const victim = extra[0];
  const vid = host.room.players.find(p => p.name === 'F0').id;
  host.s.emit('kick', vid); await sleep(150);
  ok(victim.kicked && !host.room.players.some(p => p.id === vid), 'host can kick a player');
  others[0].s.emit('settings', { mode: 'speed' }); await sleep(100);
  ok(host.room.settings.mode === 'classic', 'guests cannot change settings');
  host.s.emit('settings', { mode: 'emoji', wildcards: false, timeScale: 0.75 }); await sleep(100);
  ok(host.room.settings.mode === 'emoji' && host.room.settings.wildcards === false && host.room.settings.timeScale === 0.75, 'host changes mode/wildcards/pace');
  // host leaves -> host passes on
  host.s.emit('leave'); await sleep(150);
  ok(others[0].room.hostId && others[0].room.hostId !== host.room.players[0].id && !others[0].room.players.some(p => p.name === 'Host'), 'host leaving hands the crown to someone else');
  closeAll([host, ...others, dup, xss, ...extra, over]);
}

async function testEmojiAndWildcards() {
  console.log('\n▶ Emoji-only mode + wildcards');
  const { host, all } = await makeRoom(3, 'emoji');
  all.forEach(c => { c.auto = false; });
  await emitAck(host, 'start');
  await waitFor(() => all.every(c => c.tasks.length === 1), 2000, 'tasks');
  ok(all.every(c => c.tasks[0].mode === 'emoji'), 'clients told mode is emoji');
  await emitAck(all[0], 'submit', { step: 0, text: 'cat 🐱 on a 🚀 hello' });
  await emitAck(all[1], 'submit', { step: 0, text: 'no emoji here' });
  await emitAck(all[2], 'submit', { step: 0, text: '🏴‍☠️🦜' });
  await waitFor(() => all.every(c => c.tasks.length === 2), 3000, 'draw step');
  const prompts = all.map(c => c.tasks[1].prev.text).sort();
  ok(prompts.includes('🐱 🚀') || prompts.includes('🐱🚀'), `letters stripped from emoji prompt (${JSON.stringify(prompts)})`);
  ok(prompts.includes('🤷'), 'all-text prompt in emoji mode becomes 🤷 placeholder');
  ok(prompts.includes('🏴‍☠️🦜'), 'multi-codepoint emoji survive');
  ok(all.some(c => c.tasks[1].wildcard), 'at least one drawer got a wildcard card');
  closeAll(all);
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  try {
    await testLobbyRules();
    await testFullGame();
    await testTimeoutAndDisconnect();
    await testEmojiAndWildcards();
    await testOfflineSkip();
    console.log(`\n✅ All ${passed} checks passed`);
    process.exit(0);
  } catch (e) {
    console.error('\n❌ FAILED:', e && e.stack || e);
    process.exit(1);
  }
})();
