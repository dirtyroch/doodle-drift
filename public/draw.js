// Drawing engine: vector actions on an 800x600 logical canvas.
// Actions: {t:'s', c:color, w:width, p:[x0,y0,x1,y1,...]}  |  {t:'f', c:color, x, y}
window.DD = window.DD || {};
(() => {
  const W = 800, H = 600;
  const BG = '#ffffff';

  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

  function strokePath(ctx, a, upto) {
    const p = a.p; const n = Math.min(upto == null ? p.length : upto, p.length);
    ctx.strokeStyle = a.c; ctx.fillStyle = a.c; ctx.lineWidth = a.w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (n <= 2) { ctx.beginPath(); ctx.arc(p[0], p[1], a.w / 2, 0, Math.PI * 2); ctx.fill(); return; }
    ctx.beginPath(); ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < n - 2; i += 2) {
      const mx = (p[i] + p[i + 2]) / 2, my = (p[i + 1] + p[i + 3]) / 2;
      ctx.quadraticCurveTo(p[i], p[i + 1], mx, my);
    }
    ctx.lineTo(p[n - 2], p[n - 1]);
    ctx.stroke();
  }

  function floodFill(ctx, x, y, color) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const img = ctx.getImageData(0, 0, W, H); const d = img.data;
    const i0 = (y * W + x) * 4;
    const sr = d[i0], sg = d[i0 + 1], sb = d[i0 + 2];
    const [fr, fg, fb] = hexToRgb(color);
    if (Math.abs(sr - fr) + Math.abs(sg - fg) + Math.abs(sb - fb) < 6) return;
    const TOL = 90;
    const match = (i) => Math.abs(d[i] - sr) + Math.abs(d[i + 1] - sg) + Math.abs(d[i + 2] - sb) <= TOL;
    const seen = new Uint8Array(W * H);
    const stack = [x, y];
    while (stack.length) {
      const cy = stack.pop(); let cx = stack.pop();
      let i = cy * W + cx;
      while (cx >= 0 && !seen[i] && match(i * 4)) { cx--; i--; }
      cx++; i++;
      let up = false, down = false;
      while (cx < W && !seen[i] && match(i * 4)) {
        const k = i * 4; d[k] = fr; d[k + 1] = fg; d[k + 2] = fb; d[k + 3] = 255; seen[i] = 1;
        if (cy > 0) { const u = i - W; if (!seen[u] && match(u * 4)) { if (!up) { stack.push(cx, cy - 1); up = true; } } else up = false; }
        if (cy < H - 1) { const dn = i + W; if (!seen[dn] && match(dn * 4)) { if (!down) { stack.push(cx, cy + 1); down = true; } } else down = false; }
        cx++; i++;
      }
    }
    // grow fill by 1px into anti-aliased edges so no white halo remains
    ctx.putImageData(img, 0, 0);
  }

  function clearCtx(ctx) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H); ctx.restore(); }

  function renderAll(ctx, actions) { clearCtx(ctx); for (const a of actions) applyAction(ctx, a); }
  function applyAction(ctx, a) {
    if (a.t === 's') strokePath(ctx, a);
    else if (a.t === 'f') floodFill(ctx, a.x, a.y, a.c);
    else if (a.t === 'clear') clearCtx(ctx);
  }

  // Animated replay of actions on a canvas. Returns a cancel function.
  function replay(canvas, actions, { duration = 3200, onDone } = {}) {
    const ctx = canvas.getContext('2d');
    clearCtx(ctx);
    if (!actions || !actions.length) { onDone && onDone(); return () => {}; }
    const weights = actions.map(a => a.t === 's' ? Math.max(1, a.p.length / 2) : 12);
    const total = weights.reduce((x, y) => x + y, 0);
    const dur = Math.min(duration, 400 + total * 6);
    let start = null, idx = 0, cancelled = false;
    let doneW = 0; // weight of fully drawn actions
    function frame(ts) {
      if (cancelled) return;
      if (start == null) start = ts;
      const target = Math.min(1, (ts - start) / dur) * total;
      // finish complete actions
      while (idx < actions.length && doneW + weights[idx] <= target) { applyAction(ctx, actions[idx]); doneW += weights[idx]; idx++; }
      if (idx < actions.length) {
        const a = actions[idx];
        if (a.t === 's') {
          // redraw from snapshot: draw partial stroke on top of a snapshot of finished state
          if (!frame.snap || frame.snapIdx !== idx) { frame.snap = ctx.getImageData(0, 0, W, H); frame.snapIdx = idx; }
          ctx.putImageData(frame.snap, 0, 0);
          const pts = Math.max(1, Math.floor(target - doneW)) * 2;
          strokePath(ctx, a, pts);
        }
        requestAnimationFrame(frame);
      } else { onDone && onDone(); }
    }
    requestAnimationFrame(frame);
    return () => { cancelled = true; };
  }

  // Interactive pad
  function Pad(canvas, opts = {}) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const st = { tool: 'pen', color: '#141a2e', size: 8, actions: [], redo: [], cur: null, enabled: true };
    clearCtx(ctx);
    const emit = () => opts.onChange && opts.onChange(st);

    function toLocal(e) {
      const r = canvas.getBoundingClientRect();
      return [Math.round((e.clientX - r.left) * W / r.width), Math.round((e.clientY - r.top) * H / r.height)];
    }
    let pointerId = null;
    let lastSound = 0;
    canvas.addEventListener('pointerdown', (e) => {
      if (!st.enabled || pointerId !== null) return;
      if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      const [x, y] = toLocal(e);
      if (st.tool === 'fill') {
        const a = { t: 'f', c: st.color, x, y }; st.actions.push(a); st.redo = []; applyAction(ctx, a); emit(); return;
      }
      pointerId = e.pointerId; canvas.setPointerCapture(e.pointerId);
      st.cur = { t: 's', c: st.tool === 'eraser' ? BG : st.color, w: st.tool === 'eraser' ? st.size * 2.2 : st.size, p: [x, y] };
      st.snap = ctx.getImageData(0, 0, W, H);
      strokePath(ctx, st.cur);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (opts.onHover) opts.onHover(e, st);
      if (e.pointerId !== pointerId || !st.cur) return;
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of (evs.length ? evs : [e])) {
        const [x, y] = toLocal(ev); const p = st.cur.p;
        const dx = x - p[p.length - 2], dy = y - p[p.length - 1];
        if (dx * dx + dy * dy < 4) continue;
        p.push(x, y);
      }
      ctx.putImageData(st.snap, 0, 0); strokePath(ctx, st.cur);
      const now = performance.now(); if (now - lastSound > 90) { lastSound = now; window.Sfx && Sfx.scribble(); }
    });
    const end = (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      if (st.cur) { if (st.cur.p.length > 4000) st.cur.p.length = 4000; st.actions.push(st.cur); st.redo = []; st.cur = null; st.snap = null; emit(); }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', (e) => opts.onLeave && opts.onLeave(e));

    return {
      state: st,
      setTool(t) { st.tool = t; emit(); },
      setColor(c) { st.color = c; if (st.tool === 'eraser') st.tool = 'pen'; emit(); },
      setSize(s) { st.size = s; emit(); },
      undo() { if (!st.actions.length) return; st.redo.push(st.actions.pop()); renderAll(ctx, st.actions); emit(); },
      redo() { if (!st.redo.length) return; const a = st.redo.pop(); st.actions.push(a); applyAction(ctx, a); emit(); },
      clear() { if (!st.actions.length) return; st.actions.push({ t: 'clear' }); st.redo = []; clearCtx(ctx); emit(); },
      reset(actions) { st.actions = actions ? actions.slice() : []; st.redo = []; st.cur = null; pointerId = null; renderAll(ctx, st.actions); emit(); },
      isBlank() { return !st.actions.some(a => a.t !== 'clear') || st.actions[st.actions.length - 1]?.t === 'clear'; },
      export() {
        // drop actions before the last clear to keep payload small
        let start = 0; st.actions.forEach((a, i) => { if (a.t === 'clear') start = i + 1; });
        const acts = st.actions.slice(start);
        if (st.cur) acts.push(st.cur);
        return { image: canvas.toDataURL('image/png'), strokes: acts };
      },
      setEnabled(v) { st.enabled = v; },
    };
  }

  Object.assign(window.DD, { Pad, replay, renderAll, W, H });
})();
