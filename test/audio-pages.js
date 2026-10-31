// Checks the right music is really playing on every screen, against any deployment:
//   BASE=https://doodle-drift.onrender.com node test/audio-pages.js
// Chrome runs with its NORMAL autoplay rules. For each screen we check: AudioContext running, the
// music bus gain > 0, the expected track name, and that the scheduler keeps creating new notes.
const puppeteer = require('puppeteer-core');
const BASE = process.env.BASE || 'http://localhost:4747';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const IPHONE = { viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
const results = [];
// count oscillators/buffer sources (each scheduled note makes some) and keep the gain nodes: in sound.js
// the first three gains created are duckGain, musicBus, sfxBus.
const INSTRUMENT = () => {
  window.__notes = 0; window.__gains = [];
  const P = (window.BaseAudioContext || window.AudioContext).prototype;
  const co = P.createOscillator, cb = P.createBufferSource, cg = P.createGain;
  P.createOscillator = function () { window.__notes++; return co.call(this); };
  P.createBufferSource = function () { window.__notes++; return cb.call(this); };
  P.createGain = function () { const g = cg.call(this); if (window.__gains.length < 3) window.__gains.push(g); return g; };
};
async function probe(page, ms = 1200) {
  return page.evaluate(async (ms) => {
    const n0 = window.__notes; const lv = [];
    for (let t = 0; t < ms; t += 60) { lv.push(Sfx.level()); await new Promise(r => setTimeout(r, 60)); }
    const st = Sfx.state(); const bus = window.__gains[1];
    return { running: st.running, track: st.track, musicGain: bus ? bus.gain.value : 0, notesPerSec: (window.__notes - n0) / (ms / 1000), level: Math.max(...lv) };
  }, ms);
}
async function check(label, page, track, ms) {
  const a = await probe(page, ms);
  const ok = a.running && a.track === track && a.musicGain > 0.05 && a.notesPerSec >= 3 && a.level > 0.0005;
  results.push({ label, ok, ...a });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(44)} track=${a.track} running=${a.running} musicGain=${a.musicGain.toFixed(2)} notes/s=${a.notesPerSec.toFixed(1)} level=${a.level.toFixed(4)}`);
  return ok;
}
(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const errors = [];
  const mk = async (name, mobile) => {
    const c = await browser.createBrowserContext(); const p = await c.newPage();
    if (mobile) await p.emulate(IPHONE); else await p.setViewport({ width: 1200, height: 820 });
    await p.evaluateOnNewDocument(INSTRUMENT);
    p.on('pageerror', e => errors.push(`${name}: ${e.message}`)); p.name = name; p.mobile = mobile;
    p.tapEl = (sel) => (mobile ? p.tap(sel) : p.click(sel));
    return p;
  };
  try {
    const host = await mk('host', false);
    await host.goto(BASE, { waitUntil: 'networkidle2', timeout: 90000 });
    if ((await host.evaluate(() => Sfx.state().running))) console.log('note: audio running before any gesture');
    await host.click('#name-input'); await sleep(800); // first gesture on the home screen
    await check('home screen (desktop, after 1st tap)', host, 'lobby');
    const phoneHome = await mk('phone-home', true);
    await phoneHome.goto(BASE, { waitUntil: 'networkidle2' }); await phoneHome.tap('#name-input'); await sleep(800);
    await check('home screen (phone, after 1st tap)', phoneHome, 'lobby');
    await phoneHome.browserContext().close();

    await host.type('#name-input', 'AudioBot'); await host.click('#create-btn');
    await host.waitForSelector('#screen-lobby:not(.hidden)'); const code = await host.$eval('#lobby-code', e => e.textContent);
    console.log('room', code);
    const p2 = await mk('phone', true), p3 = await mk('laptop', false);
    for (const [p, n] of [[p2, 'PhoneBot'], [p3, 'LaptopBot']]) {
      await p.goto(`${BASE}/r/${code}`, { waitUntil: 'networkidle2' });
      await p.tapEl('#name-input'); await p.type('#name-input', n); await p.tapEl('#join-form button');
      await p.waitForSelector('#screen-lobby:not(.hidden)');
    }
    await sleep(1000);
    await check('lobby: host (desktop)', host, 'lobby');
    await check('lobby: joiner via /r/CODE (phone)', p2, 'lobby');
    await check('lobby: joiner via /r/CODE (desktop)', p3, 'lobby');
    const players = [host, p2, p3];

    await host.click('[data-mode="speed"]'); await host.click('[data-pace="0.75"]'); await sleep(400);
    await host.click('#start-btn');
    const phaseName = ['write', 'draw', 'describe'];
    for (let step = 0; step < 3; step++) {
      await Promise.all(players.map(p => p.waitForFunction(s => window.__dd.S.task && window.__dd.S.task.step === s, { timeout: 30000 }, step)));
      await sleep(2000); // curtain + fanfare
      const type = await host.evaluate(() => window.__dd.S.task.type);
      await check(`play/${phaseName[step]} (${type}): host`, host, 'play');
      await check(`play/${phaseName[step]} (${type}): phone`, p2, 'play', 800);
      // everyone but the host submits now
      for (const p of [p2, p3]) {
        const t = await p.evaluate(() => window.__dd.S.task.type);
        if (t === 'text') { await p.tapEl('#write-input'); await p.type('#write-input', `${p.name} step ${step}`); await p.tapEl('#write-submit'); }
        else {
          const box = await (await p.$('#draw-canvas')).boundingBox();
          if (p.mobile) { await p.touchscreen.touchStart(box.x + 40, box.y + 40); for (let k = 1; k < 15; k++) await p.touchscreen.touchMove(box.x + 40 + k * 12, box.y + 40 + k * 8); await p.touchscreen.touchEnd(); }
          else { await p.mouse.move(box.x + 40, box.y + 40); await p.mouse.down(); for (let k = 1; k < 15; k++) await p.mouse.move(box.x + 40 + k * 12, box.y + 40 + k * 6); await p.mouse.up(); }
          await p.tapEl('#draw-submit');
        }
      }
      if (step === 1) { // hide/show the phone tab mid-round, then one tap
        await p2.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
        await sleep(700);
        const hid = await p2.evaluate(() => Sfx.state().running);
        console.log(`  phone tab hidden -> audio running=${hid} (expected false)`);
        await p2.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
        await sleep(300); await p2.tap('#timer'); await sleep(900);
        results.push({ label: 'phone hidden while playing', ok: hid === false }); if (hid !== false) console.log('FAIL  audio kept running while hidden');
        await check('recovery after tab hide/show + tap (phone, play)', p2, 'play');
      }
      // host waits for the last 10 seconds -> suspense track
      await host.waitForFunction(() => { const t = window.__dd.S.task; return t && t.deadline - Date.now() < 8000; }, { timeout: 40000 });
      await sleep(400);
      await check(`tense last-10s (${phaseName[step]}): host`, host, 'tense', 1000);
      if (type === 'text') { await host.click('#write-input'); await host.type('#write-input', 'host ' + step); await host.click('#write-submit'); }
      else { const box = await (await host.$('#draw-canvas')).boundingBox(); await host.mouse.move(box.x + 50, box.y + 50); await host.mouse.down(); await host.mouse.move(box.x + 200, box.y + 150, { steps: 10 }); await host.mouse.up(); await host.click('#draw-submit'); }
      await sleep(600);
      const after = await host.evaluate(() => Sfx.state().track);
      console.log(`  host after submitting: track=${after}`);
    }
    await Promise.all(players.map(p => p.waitForSelector('#screen-reveal:not(.hidden)', { timeout: 30000 })));
    await sleep(2500);
    await check('reveal: host', host, 'reveal');
    await check('reveal: phone', p2, 'reveal');
    await check('reveal: laptop', p3, 'reveal');
    // hide/show + tap on the reveal (host, desktop)
    await host.evaluate(() => Sfx._debug.ctx().suspend()); await sleep(300);
    await host.click('#chain'); await sleep(900);
    await check('recovery after suspend + tap (host, reveal)', host, 'reveal');
    // back to the lobby
    for (let k = 0; k < 40; k++) { if (!(await host.$eval('#next-btn', b => !b.classList.contains('hidden')))) break; await host.click('#next-btn'); await sleep(150); }
    await host.waitForSelector('#again-btn:not(.hidden)', { timeout: 10000 });
    await host.click('#again-btn');
    await Promise.all(players.map(p => p.waitForSelector('#screen-lobby:not(.hidden)', { timeout: 10000 })));
    await sleep(1600);
    await check('play again -> lobby (host)', host, 'lobby');
    await check('play again -> lobby (phone)', p2, 'lobby');
  } catch (e) { console.error('ERROR', e.message); results.push({ label: 'script', ok: false }); }
  if (errors.length) { console.log('page errors:', errors); results.push({ label: 'page errors', ok: false }); }
  const bad = results.filter(r => !r.ok);
  console.log(bad.length ? `\n${bad.length} FAILED: ${bad.map(b => b.label).join(', ')}` : `\nALL ${results.length} CHECKS PASSED`);
  await browser.close(); process.exit(bad.length ? 1 : 0);
})();
