// Tiny synthesized sound kit (no audio files). All sounds are generated live with WebAudio.
window.Sfx = (() => {
  let ctx = null;
  let muted = localStorage.getItem('dd-muted') === '1';
  function ac() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, dur, { type = 'sine', vol = 0.15, slide = 0, delay = 0 } = {}) {
    if (muted) return; const c = ac(); if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  const api = {
    get muted() { return muted; },
    toggle() { muted = !muted; localStorage.setItem('dd-muted', muted ? '1' : '0'); if (!muted) api.pop(); return muted; },
    unlock() { ac(); },
    pop() { tone(520, 0.09, { type: 'triangle', slide: 300 }); },
    join() { tone(440, 0.1, { type: 'triangle' }); tone(660, 0.14, { type: 'triangle', delay: 0.08 }); },
    leave() { tone(500, 0.12, { type: 'triangle', slide: -250 }); },
    send() { tone(300, 0.25, { type: 'sine', slide: 900, vol: 0.12 }); },
    tick() { tone(1100, 0.04, { type: 'square', vol: 0.05 }); },
    start() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, { type: 'triangle', delay: i * 0.09 })); },
    step() { tone(392, 0.12, { type: 'triangle' }); tone(587, 0.18, { type: 'triangle', delay: 0.1 }); },
    reveal() { [784, 988, 1175].forEach((f, i) => tone(f, 0.3, { type: 'sine', delay: i * 0.07, vol: 0.1 })); },
    scribble() { tone(180 + Math.random() * 80, 0.05, { type: 'sawtooth', vol: 0.015 }); },
  };
  return api;
})();
