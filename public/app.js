(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const EMOJIS = ['🦊','🐸','🐙','🦄','🐼','🐯','🐵','🐧','🦉','🐢','🐳','🦖','👽','🤖','👻','🍕','🌵','🍩'];
  const COLORS = ['#ff6b5b','#ffb238','#ffe066','#5ad1a7','#4cc9f0','#7b8cff','#c77dff','#ff7eb6','#9bdb4d','#f4a261'];
  const PALETTE = ['#141a2e','#ffffff','#8a8fa3','#6b4226','#e63946','#ff8c42','#ffd43b','#2bb673','#1fa2ff','#3d5afe','#9d4edd','#ff7eb6','#f6c8a0','#a3e635','#0f766e','#7f1d1d'];
  const SIZES = [4, 8, 16, 32];
  const MODE_META = {
    classic: { icon: '🖍️', desc: 'Write, draw, guess. The original chaos.' },
    speed:   { icon: '⚡', desc: 'Half the time, double the panic.' },
    emoji:   { icon: '🤪', desc: 'Prompts & guesses in emoji only.' },
  };
  const PACES = [[1.5, '🐢 Chill'], [1, '🙂 Normal'], [0.75, '🐇 Hasty']];
  const PROMPTS = [
    'A wizard stuck in traffic','Grandma winning a rap battle','A haunted vending machine','Penguin on its first day of school',
    'A cat running for president','Dinosaur at a job interview','The moon eating spaghetti','A shark afraid of water',
    'Robot learning to ballet','Bigfoot taking a selfie','A sandwich with feelings','Volcano at a spa day',
    'Octopus doing everyone\'s taxes','A snowman on vacation in Hawaii','Ghost who is bad at scaring','Alien buying groceries',
    'Hamster piloting a mech','A cactus giving hugs','Toast that became a superhero','A dragon afraid of the dark',
    'Two pigeons on a first date','Pirate who gets seasick','Banana slipping on a person','A cloud with a day job',
  ];
  const EMOJI_PROMPTS = ['🧙🚗🚦','👵🎤🔥','🐧🏫🎒','🐱🗳️🇺🇸','🦖💼🤝','🌕🍝','🦈😱💧','🤖🩰','🦍🤳','🌋🧖','👻😅','👽🛒🥦','🐹🤖⚔️','🌵🤗','🐉🌑😨','🏴‍☠️🤢🌊'];
  const EMOJI_KEYS = '😀😂🥲😍😎🤔😱😴🤢🥳😈💀👻👽🤖💩🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🐔🐧🐦🦆🦉🐴🦄🐝🐛🦋🐌🐞🐢🐍🦖🐙🦑🦀🐠🐬🐳🦈🐊🦒🐘🌵🌲🌴🍄🌹🌻🌞🌝🌧️⛄🔥🌈⚡💧🌊🍎🍌🍉🍓🍕🍔🍟🌭🌮🍩🍪🎂🍦☕🍺⚽🏀🎸🎮🎲🎨🎤🎬🚗🚀✈️🚲⛵🏠🏫🏥🏰🗽🌋🏝️🎒⏰🧸🎁🪑🛏️🚽💻📱💡💰💎🔪💣🪄📚✏️❤️💔⭐❓❗👑🎩👓💍👶👵🧙🧛🧟🦸🥷👮👨‍🚀🤝👏💪👀👅🦷'.match(/\p{Extended_Pictographic}(\uFE0F|\u200D\p{Extended_Pictographic}\uFE0F?)*/gu);

  // ---------- local identity ----------
  let playerId = sessionStorage.getItem('dd-pid');
  if (!playerId) { playerId = 'p' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); sessionStorage.setItem('dd-pid', playerId); }
  const profile = JSON.parse(localStorage.getItem('dd-profile') || 'null') || {
    name: '', avatar: { emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)], color: COLORS[Math.floor(Math.random() * COLORS.length)] },
  };
  const saveProfile = () => localStorage.setItem('dd-profile', JSON.stringify(profile));

  // ---------- state ----------
  const S = { room: null, you: null, task: null, progress: null, reveal: null, submittedStep: -1, timerRAF: null, lastPhase: null, cancelReplays: [] };
  const socket = io({ transports: ['websocket', 'polling'] });

  // ---------- ui helpers ----------
  function show(id) {
    $$('.screen').forEach(s => s.classList.toggle('hidden', s.id !== id));
    window.scrollTo({ top: 0 });
  }
  let toastT;
  function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
  function curtain(text, sound) {
    const c = $('#curtain'); $('#curtain-text').textContent = text;
    c.classList.remove('hidden'); c.style.animation = 'none'; void c.offsetWidth; c.style.animation = '';
    if (sound) sound();
    clearTimeout(curtain.t); curtain.t = setTimeout(() => c.classList.add('hidden'), 1650);
  }
  function avatarHTML(av, cls = '') { return `<span class="avatar ${cls}" style="background:${esc(av.color)}">${esc(av.emoji)}</span>`; }
  const playerById = (id) => S.room?.players.find(p => p.id === id);
  const isHost = () => S.room && S.room.hostId === S.you;

  // ---------- home ----------
  function renderProfile() {
    const ap = $('#avatar-preview'); ap.textContent = profile.avatar.emoji; ap.style.background = profile.avatar.color;
    $('#emoji-picker').innerHTML = EMOJIS.map(e => `<button type="button" class="${e === profile.avatar.emoji ? 'sel' : ''}" data-e="${e}">${e}</button>`).join('');
    $('#color-picker').innerHTML = COLORS.map(c => `<button type="button" class="${c === profile.avatar.color ? 'sel' : ''}" data-c="${c}" style="background:${c}" aria-label="color ${c}"></button>`).join('');
  }
  $('#emoji-picker').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; profile.avatar.emoji = b.dataset.e; saveProfile(); renderProfile(); Sfx.pop(); });
  $('#color-picker').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; profile.avatar.color = b.dataset.c; saveProfile(); renderProfile(); Sfx.pop(); });
  $('#avatar-preview').addEventListener('click', () => {
    profile.avatar = { emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)], color: COLORS[Math.floor(Math.random() * COLORS.length)] };
    saveProfile(); renderProfile(); Sfx.pop();
  });
  $('#name-input').value = profile.name;
  $('#name-input').addEventListener('input', e => { profile.name = e.target.value; saveProfile(); });

  const urlCode = (location.pathname.match(/^\/r\/([A-Za-z]{4})/) || [])[1];
  if (urlCode) {
    $('#code-input').value = urlCode.toUpperCase();
    $('#create-btn').classList.add('hidden');
    $('.or span').textContent = 'you were invited to room ' + urlCode.toUpperCase();
    $('#join-form button').textContent = 'Join the fun →';
    $('#join-form button').classList.replace('btn-mint', 'btn-primary');
  }

  function needName() {
    const n = $('#name-input').value.trim();
    if (!n) { $('#home-error').textContent = 'Give yourself a doodler name first!'; $('#name-input').focus(); return null; }
    return n;
  }
  $('#create-btn').addEventListener('click', () => {
    Sfx.unlock(); const name = needName(); if (!name) return;
    $('#create-btn').disabled = true;
    socket.emit('create', { name, avatar: profile.avatar, playerId }, (res) => {
      $('#create-btn').disabled = false;
      if (res.error) return ($('#home-error').textContent = res.error);
      onEnteredRoom(res);
    });
  });
  $('#join-form').addEventListener('submit', (e) => {
    e.preventDefault(); Sfx.unlock();
    const name = needName(); if (!name) return;
    const code = $('#code-input').value.trim().toUpperCase();
    if (code.length !== 4) return ($('#home-error').textContent = 'Room codes are 4 letters.');
    socket.emit('join', { code, name, avatar: profile.avatar, playerId }, (res) => {
      if (res.error) return ($('#home-error').textContent = res.error);
      onEnteredRoom(res);
    });
  });
  function onEnteredRoom(res) {
    $('#home-error').textContent = '';
    sessionStorage.setItem('dd-room', res.code);
    if (location.pathname !== '/r/' + res.code) history.replaceState(null, '', '/r/' + res.code);
    Sfx.join();
  }

  // ---------- connection / reconnection ----------
  socket.on('connect', () => {
    const code = sessionStorage.getItem('dd-room');
    if (code && S.room) {
      socket.emit('join', { code, playerId, name: profile.name, avatar: profile.avatar }, (res) => {
        if (res.error) { toast(res.error); leaveToHome(); }
      });
    } else if (code && urlCode && code === urlCode.toUpperCase()) {
      // page refresh: silently rejoin same room if we were in it
      socket.emit('join', { code, playerId }, (res) => { if (res.error) sessionStorage.removeItem('dd-room'); });
    }
  });
  socket.on('disconnect', () => { if (S.room) toast('Connection lost… reconnecting', 4000); });
  socket.on('kicked', ({ reason }) => { toast(reason, 4000); leaveToHome(); });
  function leaveToHome() {
    sessionStorage.removeItem('dd-room'); S.room = null; S.reveal = null; S.task = null;
    document.body.classList.remove('is-host'); $('#room-chip').classList.add('hidden');
    history.replaceState(null, '', '/'); stopTimer(); $('#waiting').classList.add('hidden');
    $('#create-btn').classList.remove('hidden'); show('screen-home');
  }

  socket.on('joined', ({ you, room }) => { S.you = you; applyRoom(room); });
  socket.on('room', applyRoom);

  function applyRoom(room) {
    const prev = S.room;
    S.room = room;
    document.body.classList.toggle('is-host', isHost());
    $('#room-chip').textContent = room.code; $('#room-chip').classList.remove('hidden');
    if (room.phase === 'lobby') {
      if (S.lastPhase && S.lastPhase !== 'lobby') { S.reveal = null; S.task = null; stopTimer(); $('#waiting').classList.add('hidden'); }
      if (prev && prev.phase === 'lobby') {
        const before = new Set(prev.players.map(p => p.id)); const now = new Set(room.players.map(p => p.id));
        if (room.players.some(p => !before.has(p.id))) Sfx.join();
        else if (prev.players.some(p => !now.has(p.id))) Sfx.leave();
      }
      renderLobby();
      if ($('#screen-lobby').classList.contains('hidden')) show('screen-lobby');
    } else if (room.phase === 'playing' && S.lastPhase === 'lobby') {
      curtain('Pencils up! ✏️', Sfx.start);
    }
    if (room.phase === 'reveal') renderRevealControls();
    if (room.phase === 'playing' && S.progress) renderProgress();
    S.lastPhase = room.phase;
  }

  // ---------- lobby ----------
  function renderLobby() {
    const r = S.room; const host = isHost();
    $('#lobby-code').textContent = r.code;
    const n = r.players.filter(p => p.connected).length;
    $('#player-count').textContent = `(${r.players.length}/${r.maxPlayers})`;
    const items = r.players.map(p => `
      <li class="player ${p.id === S.you ? 'me' : ''} ${p.connected ? '' : 'off'}">
        ${p.id === r.hostId ? '<span class="crown" title="Host">👑</span>' : ''}
        ${avatarHTML(p.avatar)}
        <span class="pname">${esc(p.name)}${p.id === S.you ? ' <small class="muted">(you)</small>' : ''}</span>
        ${host && p.id !== S.you ? `<button class="kick" data-kick="${esc(p.id)}" title="Remove">✕</button>` : ''}
      </li>`);
    const empties = Math.max(0, Math.min(r.maxPlayers, Math.max(r.minPlayers, r.players.length + 1)) - r.players.length);
    for (let i = 0; i < empties; i++) items.push(`<li class="player empty">waiting for a friend…</li>`);
    $('#player-list').innerHTML = items.join('');

    $('#mode-list').innerHTML = Object.entries(r.modes).map(([k, m]) => `
      <button class="mode ${r.settings.mode === k ? 'sel' : ''}" data-mode="${k}" ${host ? '' : 'disabled'}>
        <span class="mi">${MODE_META[k].icon}</span><span><b>${esc(m.label)}</b><small>${MODE_META[k].desc} · ${Math.round(m.write * r.settings.timeScale)}s write / ${Math.round(m.draw * r.settings.timeScale)}s draw</small></span>
      </button>`).join('');
    $('#pace-list').innerHTML = PACES.map(([v, l]) => `<button data-pace="${v}" class="${r.settings.timeScale === v ? 'sel' : ''}" ${host ? '' : 'disabled'}>${l}</button>`).join('');
    $('#wildcards-toggle').checked = r.settings.wildcards; $('#wildcards-toggle').disabled = !host;
    $('#settings-note').textContent = host ? 'You\'re the host, so you set the rules.' : `Only the host (${esc(playerById(r.hostId)?.name || '…')}) can change these.`;
    const sb = $('#start-btn');
    sb.classList.toggle('hidden', !host);
    sb.disabled = n < r.minPlayers;
    $('#start-hint').textContent = host
      ? (n < r.minPlayers ? `Need ${r.minPlayers - n} more doodler${r.minPlayers - n > 1 ? 's' : ''} to start. Send them the link!` : `${n} doodlers ready. Let's go!`)
      : `Waiting for ${playerById(r.hostId)?.name || 'the host'} to start…`;
    if (navigator.share) $('#share-link').classList.remove('hidden');
  }
  $('#player-list').addEventListener('click', e => { const b = e.target.closest('[data-kick]'); if (b) socket.emit('kick', b.dataset.kick); });
  $('#mode-list').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b && isHost()) { socket.emit('settings', { mode: b.dataset.mode }); Sfx.pop(); } });
  $('#pace-list').addEventListener('click', e => { const b = e.target.closest('[data-pace]'); if (b && isHost()) { socket.emit('settings', { timeScale: Number(b.dataset.pace) }); Sfx.pop(); } });
  $('#wildcards-toggle').addEventListener('change', e => { socket.emit('settings', { wildcards: e.target.checked }); Sfx.pop(); });
  const inviteLink = () => `${location.origin}/r/${S.room.code}`;
  $('#copy-link').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(inviteLink()); toast('Invite link copied! 📋'); }
    catch { prompt('Copy this link:', inviteLink()); }
  });
  $('#share-link').addEventListener('click', () => navigator.share({ title: 'Roch-a-Doodle', text: `Join my Roch-a-Doodle room ${S.room.code}!`, url: inviteLink() }).catch(() => {}));
  $('#start-btn').addEventListener('click', () => {
    socket.emit('start', null, (res) => { if (res && res.error) $('#lobby-error').textContent = res.error; else $('#lobby-error').textContent = ''; });
  });
  $('#leave-btn').addEventListener('click', () => { socket.emit('leave'); leaveToHome(); });

  // ---------- play ----------
  const pad = DD.Pad($('#draw-canvas'), {
    onChange: (st) => { syncToolbar(st); saveDraft(); },
    onHover: (e, st) => positionCursor(e, st),
    onLeave: () => { $('#brush-cursor').style.display = 'none'; },
  });
  $('#sizes').innerHTML = SIZES.map(s => `<button class="tool" data-size="${s}" title="Brush ${s}"><span class="size-dot" style="width:${Math.max(4, s * 0.7)}px;height:${Math.max(4, s * 0.7)}px"></span></button>`).join('');
  $('#palette').innerHTML = PALETTE.map(c => `<button class="swatch" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');
  function syncToolbar(st) {
    $$('.tool[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === st.tool));
    $$('[data-size]').forEach(b => b.classList.toggle('active', Number(b.dataset.size) === st.size));
    $$('[data-color]').forEach(b => b.classList.toggle('sel', b.dataset.color === st.color && st.tool !== 'eraser'));
    $('#undo-btn').disabled = !st.actions.length; $('#redo-btn').disabled = !st.redo.length;
    $('#draw-canvas').style.cursor = st.tool === 'fill' ? 'crosshair' : 'none';
  }
  syncToolbar(pad.state);
  function positionCursor(e, st) {
    const c = $('#brush-cursor'); const cv = $('#draw-canvas');
    if (st.tool === 'fill' || e.pointerType !== 'mouse') { c.style.display = 'none'; return; }
    const r = cv.getBoundingClientRect(); const scale = r.width / DD.W;
    const d = (st.tool === 'eraser' ? st.size * 2.2 : st.size) * scale;
    c.style.display = 'block'; c.style.width = c.style.height = Math.max(4, d) + 'px';
    c.style.left = (e.clientX - r.left) + 'px'; c.style.top = (e.clientY - r.top) + 'px';
    c.style.background = st.tool === 'eraser' ? 'rgba(255,255,255,.6)' : st.color + '55';
  }
  $('.toolbar').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tool) pad.setTool(b.dataset.tool);
    else if (b.dataset.size) pad.setSize(Number(b.dataset.size));
    else if (b.dataset.color) { pad.setColor(b.dataset.color); if (pad.state.tool === 'eraser') pad.setTool('pen'); }
    else if (b.id === 'undo-btn') pad.undo();
    else if (b.id === 'redo-btn') pad.redo();
    else if (b.id === 'clear-btn') {
      if (!pad.state.actions.length) return;
      if (b.dataset.armed) { delete b.dataset.armed; b.classList.remove('armed'); pad.clear(); return; }
      b.dataset.armed = '1'; b.classList.add('armed'); toast('Tap 🗑️ again to wipe the page');
      setTimeout(() => { delete b.dataset.armed; b.classList.remove('armed'); }, 2500);
    }
  });
  document.addEventListener('keydown', (e) => {
    if ($('#task-draw').classList.contains('hidden') || !$('#waiting').classList.contains('hidden')) return;
    if (e.target.tagName === 'INPUT') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? pad.redo() : pad.undo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); pad.redo(); }
    else if (e.key === 'p') pad.setTool('pen'); else if (e.key === 'e') pad.setTool('eraser'); else if (e.key === 'f') pad.setTool('fill');
    else if (e.key === '[' || e.key === ']') { const i = SIZES.indexOf(pad.state.size) + (e.key === ']' ? 1 : -1); if (SIZES[i]) pad.setSize(SIZES[i]); }
  });

  const draftKey = () => S.room && S.task ? `dd-draft-${S.task.gameId}-${S.task.step}` : null;
  function saveDraft() {
    const k = draftKey(); if (!k || !S.task) return;
    try {
      if (S.task.type === 'drawing') sessionStorage.setItem(k, JSON.stringify({ a: pad.state.actions }));
      else sessionStorage.setItem(k, JSON.stringify({ t: $('#write-input').value }));
    } catch { /* storage full; ignore */ }
  }
  function loadDraft() { const k = draftKey(); try { return k ? JSON.parse(sessionStorage.getItem(k) || 'null') : null; } catch { return null; } }

  socket.on('task', (task) => {
    if (!task) return;
    const isNewStep = !S.task || S.task.step !== task.step || S.task.gameId !== task.gameId || $('#screen-play').classList.contains('hidden');
    S.task = task;
    S.clockSkew = task.serverNow - Date.now();
    show('screen-play');
    if (isNewStep) {
      if (task.step > 0 && S.lastStepSeen !== task.step) Sfx.step();
      S.lastStepSeen = task.step;
      setupTask(task);
    }
    $('#waiting').classList.toggle('hidden', !task.submitted);
    if (task.submitted) S.submittedStep = task.step;
    startTimer();
  });

  function setupTask(t) {
    $('#step-pill').textContent = `Page ${t.step + 1} / ${t.totalSteps}`;
    const draft = loadDraft();
    S.submittedStep = t.submitted ? t.step : -1;
    if (t.type === 'text') {
      $('#task-draw').classList.add('hidden'); $('#task-write').classList.remove('hidden');
      const emoji = t.mode === 'emoji';
      $('#emoji-keys').classList.toggle('hidden', !emoji);
      if (emoji && !$('#emoji-keys').children.length) {
        $('#emoji-keys').innerHTML = EMOJI_KEYS.map(k => `<button type="button" data-k="${k}">${k}</button>`).join('') + '<button type="button" class="bksp" data-k="⌫">⌫</button>';
      }
      const inp = $('#write-input');
      inp.value = draft?.t || '';
      inp.readOnly = false;
      inp.inputMode = emoji ? 'none' : 'text';
      if (t.first) {
        $('#write-prev').classList.add('hidden');
        $('#write-title').textContent = emoji ? 'Start a sketchbook: write a prompt using only emoji 🤪' : 'Start a sketchbook: write something wild to draw ✍️';
        inp.placeholder = emoji ? 'Tap emoji below…' : 'e.g. ' + PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
        $('#dice-btn').classList.remove('hidden');
        $('#write-submit').textContent = 'Pass it on →';
      } else {
        $('#write-prev').classList.remove('hidden');
        $('#write-prev-img').src = t.prev?.image || blankImage();
        $('#write-title').textContent = emoji ? 'What is this? Answer in emoji only 👀' : 'What on earth is this? Describe it 👀';
        inp.placeholder = emoji ? 'Tap emoji below…' : 'Your best guess…';
        $('#dice-btn').classList.add('hidden');
        $('#write-submit').textContent = 'Pass it on →';
      }
      if (!emoji && matchMedia('(pointer:fine)').matches) setTimeout(() => inp.focus(), 50);
    } else {
      $('#task-write').classList.add('hidden'); $('#task-draw').classList.remove('hidden');
      $('#draw-prompt-text').textContent = t.prev?.text || '(something mysterious)';
      $('#wildcard').classList.toggle('hidden', !t.wildcard);
      $('#wildcard-text').textContent = t.wildcard || '';
      pad.reset(draft?.a || []);
      pad.setTool('pen');
      pad.setEnabled(true);
    }
  }
  function blankImage() {
    const c = document.createElement('canvas'); c.width = 400; c.height = 300; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 300); x.fillStyle = '#aaa'; x.font = '20px sans-serif'; x.textAlign = 'center'; x.fillText('(this page was left blank)', 200, 155);
    return c.toDataURL();
  }

  $('#emoji-keys').addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]'); if (!b) return; const inp = $('#write-input');
    if (b.dataset.k === '⌫') { const segs = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(inp.value)].map(s => s.segment); segs.pop(); inp.value = segs.join(''); }
    else if (inp.value.length < 130) inp.value += b.dataset.k;
    saveDraft(); Sfx.pop();
  });
  $('#write-input').addEventListener('input', () => {
    if (S.task?.mode === 'emoji') {
      // strip non-emoji typed on a hardware keyboard
      const segs = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment($('#write-input').value)].map(s => s.segment);
      const cleaned = segs.filter(g => g === ' ' || /\p{Extended_Pictographic}/u.test(g)).join('').replace(/\s{2,}/g, ' ');
      if (cleaned !== $('#write-input').value) $('#write-input').value = cleaned;
    }
    saveDraft();
  });
  $('#dice-btn').addEventListener('click', () => {
    const b = $('#dice-btn'); b.classList.remove('spin'); void b.offsetWidth; b.classList.add('spin');
    const list = S.task?.mode === 'emoji' ? EMOJI_PROMPTS : PROMPTS;
    $('#write-input').value = list[Math.floor(Math.random() * list.length)]; saveDraft(); Sfx.pop();
  });
  $('#write-form').addEventListener('submit', (e) => { e.preventDefault(); submitWrite(false); });
  $('#write-submit').addEventListener('click', () => submitWrite(false));
  $('#draw-submit').addEventListener('click', () => submitDraw(false));

  function submitWrite(auto) {
    if (!S.task || S.task.type !== 'text' || S.submittedStep === S.task.step) return;
    const text = $('#write-input').value.trim();
    if (!text && !auto) { toast(S.task.mode === 'emoji' ? 'Add at least one emoji!' : 'Write something first!'); $('#write-input').focus(); return; }
    doSubmit({ text, auto });
  }
  function submitDraw(auto) {
    if (!S.task || S.task.type !== 'drawing' || S.submittedStep === S.task.step) return;
    if (pad.isBlank() && !auto) { toast('Draw something first! Even a squiggle counts.'); return; }
    doSubmit({ ...pad.export(), auto });
  }
  function doSubmit(payload) {
    const step = S.task.step;
    S.submittedStep = step;
    $('#waiting').classList.remove('hidden');
    renderProgress();
    Sfx.send();
    socket.emit('submit', { ...payload, step }, (res) => {
      if (!res || !res.ok) { if (S.task && S.task.step === step && res && res.error !== 'That step is over.') { S.submittedStep = -1; $('#waiting').classList.add('hidden'); toast('Hmm, that didn\'t go through. Try again?'); } }
    });
  }
  $('#edit-btn').addEventListener('click', () => {
    if (!S.task) return;
    socket.emit('unsubmit'); S.submittedStep = -1; $('#waiting').classList.add('hidden');
  });
  socket.on('force-submit', ({ step }) => {
    if (!S.task || S.task.step !== step || S.submittedStep === step) return;
    if (S.task.type === 'text') submitWrite(true); else submitDraw(true);
  });

  socket.on('progress', (p) => { S.progress = p; renderProgress(); });
  function renderProgress() {
    const p = S.progress; if (!p || !S.room) return;
    const done = new Set(p.done);
    const ids = [...p.done, ...p.waitingOn];
    $('#waiting-mini').innerHTML = ids.map(id => `<span class="dot ${done.has(id) ? 'done' : ''}" title="${esc(playerById(id)?.name || '')}"></span>`).join('');
    $('#waiting-list').innerHTML = ids.map(id => { const pl = playerById(id); if (!pl) return ''; return `<li class="${done.has(id) ? 'done' : 'pending'}" title="${esc(pl.name)}${pl.connected ? '' : ' (offline)'}">${avatarHTML(pl.avatar)}</li>`; }).join('');
    const waiting = p.waitingOn.map(id => playerById(id)).filter(Boolean);
    $('#waiting-text').textContent = waiting.length === 0 ? 'Everyone\'s done! Flipping pages…'
      : waiting.length <= 2 ? `Waiting on ${waiting.map(x => x.name).join(' & ')}…` : `Waiting on ${waiting.length} doodlers…`;
    const canEdit = S.task && Date.now() + (S.clockSkew || 0) < S.task.deadline && waiting.length > 0;
    $('#edit-btn').classList.toggle('hidden', !canEdit);
  }

  function startTimer() {
    stopTimer();
    let lastTick = -1;
    const loop = () => {
      if (!S.task) return;
      const now = Date.now() + (S.clockSkew || 0);
      const left = Math.max(0, S.task.deadline - now);
      const frac = S.task.duration ? left / S.task.duration : 0;
      $('#timer-fill').style.transform = `scaleX(${frac})`;
      const secs = Math.ceil(left / 1000);
      $('#timer-text').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      $('#timer').classList.toggle('warn', frac < 0.35 && secs > 5);
      $('#timer').classList.toggle('danger', secs <= 5 && left > 0 && S.submittedStep !== S.task.step);
      if (secs <= 5 && secs > 0 && secs !== lastTick && S.submittedStep !== S.task.step) { lastTick = secs; Sfx.tick(); }
      if (left <= 0) {
        if (S.submittedStep !== S.task.step) { if (S.task.type === 'text') submitWrite(true); else submitDraw(true); }
        $('#edit-btn').classList.add('hidden');
        return;
      }
      S.timerRAF = requestAnimationFrame(loop);
    };
    loop();
  }
  function stopTimer() { cancelAnimationFrame(S.timerRAF); }

  // ---------- reveal ----------
  socket.on('reveal', (data) => {
    const first = !S.reveal;
    S.reveal = data; S.task = null; stopTimer();
    $('#waiting').classList.add('hidden');
    show('screen-reveal');
    if (first) curtain('Album time! 📖', Sfx.reveal);
    renderRevealBook(true);
  });
  socket.on('reveal:pos', ({ book, shown }) => {
    if (!S.reveal) return;
    const changed = book !== S.reveal.book;
    S.reveal.book = book; S.reveal.shown = shown;
    renderRevealBook(changed);
  });

  function pinfo(id) { return S.reveal.players[id] || playerById(id) || { name: '???', avatar: { emoji: '❔', color: '#ccc' } }; }

  function renderRevealBook(full) {
    const R = S.reveal; const book = R.books[R.book]; const owner = pinfo(book.ownerId);
    $('#reveal-counter').textContent = `Sketchbook ${R.book + 1} of ${R.books.length}`;
    $('#reveal-title').innerHTML = `${avatarHTML(owner.avatar)} ${esc(owner.name)}'s chain`;
    $('#reveal-tabs').innerHTML = R.books.map((b, i) => { const o = pinfo(b.ownerId); return `<button data-book="${i}" class="${i === R.book ? 'cur' : ''}" title="${esc(o.name)}" ${isHost() ? '' : 'disabled'}>${avatarHTML(o.avatar)}</button>`; }).join('');
    const chain = $('#chain');
    if (full) { S.cancelReplays.forEach(f => f()); S.cancelReplays = []; chain.innerHTML = ''; }
    const have = chain.children.length;
    for (let i = have; i < R.shown && i < book.entries.length; i++) {
      chain.appendChild(entryEl(book.entries[i], i, !full || i === R.shown - 1));
    }
    // if we jumped (show all) the last element should scroll into view
    const last = chain.lastElementChild;
    if (last) setTimeout(() => last.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    renderRevealControls();
  }

  function entryEl(e, i, animate) {
    const a = pinfo(e.authorId);
    const div = document.createElement('div'); div.className = 'entry';
    const verb = e.type === 'drawing' ? 'drew' : (i === 0 ? 'started with' : 'guessed');
    div.innerHTML = `${avatarHTML(a.avatar)}<div class="body"><div class="who">${esc(a.name)} ${verb}</div></div>`;
    const body = div.querySelector('.body');
    const bubble = document.createElement('div');
    bubble.className = `bubble ${e.type}${e.auto && (!e.text || /flew the coop|🤷/.test(e.text || '')) && !e.image ? ' auto' : ''}`;
    if (e.type === 'text') { bubble.textContent = e.text; if (animate) Sfx.pop(); }
    else {
      const cv = document.createElement('canvas'); cv.width = DD.W; cv.height = DD.H; bubble.appendChild(cv);
      const run = () => {
        if (e.strokes && e.strokes.length) S.cancelReplays.push(DD.replay(cv, e.strokes, { duration: animate ? 3200 : 1 }));
        else if (e.image) { const img = new Image(); img.onload = () => cv.getContext('2d').drawImage(img, 0, 0, DD.W, DD.H); img.src = e.image; }
        else { const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, DD.W, DD.H); x.fillStyle = '#999'; x.font = 'italic 32px sans-serif'; x.textAlign = 'center'; x.fillText('(the pencil rolled away… blank page)', DD.W / 2, DD.H / 2); }
      };
      run();
      if (e.strokes && e.strokes.length) {
        const rb = document.createElement('button'); rb.className = 'replay'; rb.textContent = '▶ replay';
        rb.onclick = () => { S.cancelReplays.push(DD.replay(cv, e.strokes, { duration: 3200 })); };
        body.appendChild(bubble); body.appendChild(rb); return div;
      }
    }
    body.appendChild(bubble);
    if (!animate) div.style.animation = 'none';
    return div;
  }

  function renderRevealControls() {
    if (!S.reveal || !S.room) return;
    document.body.classList.toggle('is-host', isHost());
    const R = S.reveal; const len = R.books[R.book].entries.length;
    const lastBook = R.book === R.books.length - 1;
    const atEnd = R.shown >= len;
    $('#next-btn').textContent = atEnd ? 'Next sketchbook ▶' : 'Next page ▶';
    $('#next-btn').classList.toggle('hidden', atEnd && lastBook);
    $('#showall-btn').classList.toggle('hidden', atEnd);
    $('#again-btn').classList.toggle('hidden', !(atEnd && lastBook));
    $('#reveal-wait').textContent = atEnd && lastBook ? 'That\'s a wrap! Waiting for the host…' : 'The host is turning the pages…';
    $$('#reveal-tabs button').forEach(b => b.disabled = !isHost());
  }
  $('#next-btn').addEventListener('click', () => socket.emit('reveal:next'));
  $('#showall-btn').addEventListener('click', () => socket.emit('reveal:showall'));
  $('#again-btn').addEventListener('click', () => socket.emit('lobby'));
  $('#reveal-tabs').addEventListener('click', e => { const b = e.target.closest('[data-book]'); if (b && isHost()) socket.emit('reveal:goto', Number(b.dataset.book)); });
  document.addEventListener('keydown', e => {
    if ($('#screen-reveal').classList.contains('hidden') || !isHost()) return;
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); socket.emit('reveal:next'); }
  });

  // reactions
  const REACTS = ['😂','😍','😱','👏','🔥','💀'];
  $('#reactions').innerHTML = REACTS.map(r => `<button data-r="${r}">${r}</button>`).join('');
  $('#reactions').addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) socket.emit('react', b.dataset.r); });
  socket.on('react', ({ emoji, from }) => {
    const f = document.createElement('div'); f.className = 'floater'; f.textContent = emoji;
    f.style.left = (10 + Math.random() * 80) + '%';
    f.style.setProperty('--dx', (Math.random() * 120 - 60) + 'px');
    f.style.setProperty('--rot', (Math.random() * 60 - 30) + 'deg');
    $('#floaters').appendChild(f); setTimeout(() => f.remove(), 2500);
    if (from !== S.you) Sfx.pop();
  });

  // download chain as one tall image
  $('#download-btn').addEventListener('click', async () => {
    const R = S.reveal; if (!R) return;
    const book = R.books[R.book]; const owner = pinfo(book.ownerId);
    const Wd = 900, pad = 40, imgW = Wd - pad * 2 - 70, imgH = imgW * 3 / 4;
    const loadImg = (src) => new Promise(res => { if (!src) return res(null); const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
    const [mascot, ...imgs] = await Promise.all([loadImg('/mascot.svg'), ...book.entries.map(e => e.type === 'drawing' ? loadImg(e.image) : null)]);
    const tmp = document.createElement('canvas').getContext('2d');
    tmp.font = '600 30px Fredoka, sans-serif';
    const wrap = (text, maxW) => { const words = String(text).split(' '); const lines = []; let line = ''; for (const w of words) { const t = line ? line + ' ' + w : w; if (tmp.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; } if (line) lines.push(line); return lines; };
    const blocks = book.entries.map((e, i) => {
      if (e.type === 'text') { const lines = wrap(e.text || '', imgW - 40); return { e, i, lines, h: 34 + lines.length * 40 + 30 }; }
      return { e, i, h: 34 + imgH + 12 };
    });
    const header = 130, footer = 70;
    const H = header + blocks.reduce((s, b) => s + b.h + 26, 0) + footer;
    const c = document.createElement('canvas'); c.width = Wd; c.height = H; const x = c.getContext('2d');
    x.fillStyle = '#16203a'; x.fillRect(0, 0, Wd, H);
    x.fillStyle = '#ffd43b'; x.font = '700 44px Fredoka, sans-serif'; x.fillText(`${owner.name}'s chain`, pad, 70);
    if (mascot) x.drawImage(mascot, Wd - pad - 92, 14, 92, 116);
    x.fillStyle = '#9aa5cc'; x.font = '600 20px Nunito, sans-serif'; x.fillText(`${book.entries.length} pages · Roch-a-Doodle · room ${S.room?.code || ''}`, pad, 104);
    let y = header;
    const rr = (X, Y, w, h, r) => { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); };
    blocks.forEach((b, k) => {
      const a = pinfo(b.e.authorId);
      x.fillStyle = a.avatar.color; x.beginPath(); x.arc(pad + 24, y + 30, 24, 0, Math.PI * 2); x.fill(); x.lineWidth = 3; x.strokeStyle = '#141a2e'; x.stroke();
      x.font = '26px sans-serif'; x.textAlign = 'center'; x.fillStyle = '#000'; x.fillText(a.avatar.emoji, pad + 24, y + 39); x.textAlign = 'left';
      const bx = pad + 70; x.fillStyle = '#c9d0ea'; x.font = '800 18px Nunito, sans-serif';
      x.fillText(`${a.name} ${b.e.type === 'drawing' ? 'drew' : (b.i === 0 ? 'started with' : 'guessed')}`, bx, y + 18);
      const by = y + 30;
      x.fillStyle = '#141a2e'; rr(bx + 5, by + 5, imgW, b.h - 34, 16); x.fill();
      x.fillStyle = b.e.type === 'text' ? '#fff8ec' : '#fff'; rr(bx, by, imgW, b.h - 34, 16); x.fill(); x.lineWidth = 3; x.strokeStyle = '#141a2e'; x.stroke();
      if (b.e.type === 'text') { x.fillStyle = '#141a2e'; x.font = '600 30px Fredoka, sans-serif'; b.lines.forEach((l, j) => x.fillText(l, bx + 20, by + 44 + j * 40)); }
      else if (imgs[k]) { x.save(); rr(bx + 6, by + 6, imgW - 12, imgH - 12, 12); x.clip(); x.drawImage(imgs[k], bx + 6, by + 6, imgW - 12, imgH - 12); x.restore(); }
      else { x.fillStyle = '#999'; x.font = 'italic 24px sans-serif'; x.fillText('(blank page)', bx + 20, by + 50); }
      y += b.h + 26;
    });
    x.fillStyle = '#5ad1a7'; x.font = '700 22px Fredoka, sans-serif'; x.textAlign = 'center'; x.fillText('🐓 made with Roch-a-Doodle · Write it. Draw it. Crow about it.', Wd / 2, H - 30);
    c.toBlob(blob => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `roch-a-doodle-${owner.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Chain saved! 🖼️');
    }, 'image/png');
  });

  // ---------- misc ----------
  $('#mute-btn').textContent = Sfx.muted ? '🔇' : '🔊';
  $('#mute-btn').addEventListener('click', () => { $('#mute-btn').textContent = Sfx.toggle() ? '🔇' : '🔊'; });
  window.addEventListener('beforeunload', (e) => { if (S.room && S.room.phase === 'playing') { e.preventDefault(); e.returnValue = ''; } });
  renderProfile();
  if (!urlCode && sessionStorage.getItem('dd-room')) sessionStorage.removeItem('dd-room');
  show('screen-home');
  // expose for automated tests
  window.__dd = { S, pad, socket };
})();
