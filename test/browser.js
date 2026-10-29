// Drives real headless Chrome tabs through a full game via the actual UI, and captures screenshots.
const puppeteer = require('puppeteer-core');
const fs = require('fs'); const path = require('path');
const BASE = process.env.BASE || 'http://localhost:4747';
const OUT = process.env.OUT || '/workspace/game-screens';
const DL = path.join(OUT, 'downloads');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
fs.rmSync(DL, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  async function newPlayer(name, mobile) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    if (mobile) await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
    else await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 });
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
    page.on('dialog', d => d.accept().catch(() => {}));
    page.name = name; page.mobile = mobile;
    return page;
  }
  const host = await newPlayer('Mike', false);
  await host.goto(BASE, { waitUntil: 'networkidle2' });
  await sleep(400);
  await host.screenshot({ path: `${OUT}/home.png` });
  await host.type('#name-input', 'Mike');
  await host.click('#emoji-picker button:nth-child(12)');
  await host.click('#create-btn');
  await host.waitForSelector('#screen-lobby:not(.hidden)');
  const code = await host.$eval('#lobby-code', e => e.textContent);
  console.log('room', code);

  const players = [host];
  const extra = [['Ava', true], ['Leo', false], ['Zoe', false]];
  for (const [n, mob] of extra) {
    const p = await newPlayer(n, mob);
    await p.goto(`${BASE}/r/${code}`, { waitUntil: 'networkidle2' });
    await p.type('#name-input', n);
    await p.click(`#emoji-picker button:nth-child(${2 + players.length * 3})`);
    await p.click(`#color-picker button:nth-child(${2 + players.length * 2})`);
    await p.click('#join-form button');
    await p.waitForSelector('#screen-lobby:not(.hidden)');
    players.push(p);
  }
  await host.click('[data-mode="classic"]');
  await sleep(700);
  await host.screenshot({ path: `${OUT}/lobby.png` });
  await players[1].screenshot({ path: `${OUT}/lobby-mobile.png` });
  console.log('lobby screenshots saved');
  await host.click('#start-btn');

  const prompts = ['A wizard stuck in traffic', 'Grandma winning a rap battle', 'A haunted vending machine', 'Penguin on its first day of school'];
  const colors = ['#e63946', '#1fa2ff', '#2bb673', '#9d4edd'];
  for (let step = 0; step < 4; step++) {
    await Promise.all(players.map(p => p.waitForFunction(s => window.__dd.S.task && window.__dd.S.task.step === s, { timeout: 15000 }, step)));
    await sleep(1800); // curtain animation
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const type = await p.evaluate(() => window.__dd.S.task.type);
      if (type === 'text') {
        const guess = step === 0 ? prompts[i] : `${p.name}'s guess #${step}`;
        await p.click('#write-input', { clickCount: 3 });
        await p.type('#write-input', guess);
        if (step === 2 && i === 0) await host.screenshot({ path: `${OUT}/guess.png` });
        await p.click('#write-submit');
      } else {
        await p.click('[data-tool="pen"]');
        await p.click(`[data-color="${colors[i]}"]`);
        await p.click('[data-size="16"]');
        const box = await (await p.$('#draw-canvas')).boundingBox();
        const pts = [];
        for (let k = 0; k <= 40; k++) { const a = (k / 40) * Math.PI * 2; pts.push([box.x + box.width * (0.5 + 0.3 * Math.cos(a)), box.y + box.height * (0.5 + 0.3 * Math.sin(a))]); }
        const smile = []; for (let k = 0; k <= 20; k++) { const a = Math.PI * (0.15 + 0.7 * k / 20); smile.push([box.x + box.width * (0.5 + 0.17 * Math.cos(a)), box.y + box.height * (0.5 + 0.17 * Math.sin(a))]); }
        if (p.mobile) {
          for (const path of [pts, smile]) {
            await p.touchscreen.touchStart(path[0][0], path[0][1]);
            for (const [x, y] of path.slice(1)) await p.touchscreen.touchMove(x, y);
            await p.touchscreen.touchEnd();
          }
        } else {
          for (const path of [pts, smile]) {
            await p.mouse.move(path[0][0], path[0][1]); await p.mouse.down();
            for (const [x, y] of path.slice(1)) await p.mouse.move(x, y, { steps: 2 });
            await p.mouse.up();
          }
          // eyes + bucket fill the face
          await p.click('[data-size="32"]');
          for (const ex of [0.42, 0.58]) { await p.mouse.click(box.x + box.width * ex, box.y + box.height * 0.42); }
          await p.click('[data-tool="fill"]'); await p.click('[data-color="#ffd43b"]');
          await p.click('[data-tool="fill"]');
          await p.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
          // undo + redo round-trip
          await p.click('#undo-btn'); await p.click('#redo-btn');
        }
        if (step === 1 && p.name === 'Leo') {
          // refresh mid-drawing: should rejoin the same game and restore the in-progress drawing
          const before = await p.evaluate(() => window.__dd.pad.state.actions.length);
          await p.reload({ waitUntil: 'networkidle2' });
          await p.waitForFunction(() => window.__dd.S.task && window.__dd.S.task.type === 'drawing', { timeout: 8000 });
          const after = await p.evaluate(() => window.__dd.pad.state.actions.length);
          console.log(`  Leo refreshed mid-drawing: ${before} actions before, ${after} restored`);
          if (after !== before) throw new Error('draft not restored after refresh');
        }
        const n = await p.evaluate(() => window.__dd.pad.state.actions.length);
        if (!n) throw new Error(`${p.name} drew nothing (step ${step})`);
        if (i === 0 && step === 1) await host.screenshot({ path: `${OUT}/draw.png` });
        if (p.mobile && step === 1) await p.screenshot({ path: `${OUT}/draw-mobile.png` });
        await p.click('#draw-submit');
      }
      if (i === 0) { await sleep(150); await host.screenshot({ path: `${OUT}/waiting-step${step}.png` }); }
    }
    console.log('step', step, 'done');
  }

  await Promise.all(players.map(p => p.waitForSelector('#screen-reveal:not(.hidden)', { timeout: 15000 })));
  await sleep(2000);
  for (let k = 0; k < 3; k++) { await host.click('#next-btn'); await sleep(900); }
  await players[2].click('#reactions [data-r="😂"]');
  await host.click('#reactions [data-r="🔥"]');
  await sleep(2500);
  await host.screenshot({ path: `${OUT}/reveal.png` });
  await players[1].screenshot({ path: `${OUT}/reveal-mobile.png` });
  const shown = await players[3].evaluate(() => document.querySelectorAll('#chain .entry').length);
  console.log('guest sees entries:', shown);
  if (shown !== 4) throw new Error('guest reveal not synced');

  // download
  fs.writeFileSync(path.join(OUT, 'reveal-data.json'), JSON.stringify(await host.evaluate(() => window.__dd.S.reveal)));
  const cdp = await browser.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, browserContextId: host.browserContext().id, eventsEnabled: true });
  await host.click('#download-btn');
  await sleep(2500);
  const files = fs.readdirSync(DL).filter(f => f.endsWith('.png'));
  console.log('downloaded:', files);
  if (!files.length) throw new Error('download failed');

  // step through the rest of the reveal
  for (let k = 0; k < 40; k++) {
    const vis = await host.$eval('#next-btn', b => !b.classList.contains('hidden'));
    if (!vis) break; await host.click('#next-btn'); await sleep(120);
  }
  await sleep(500);
  const againVisible = await host.$eval('#again-btn', b => !b.classList.contains('hidden'));
  console.log('play-again visible at end:', againVisible);
  await host.click('#again-btn');
  await Promise.all(players.map(p => p.waitForSelector('#screen-lobby:not(.hidden)', { timeout: 5000 })));
  console.log('everyone back in lobby');

  // refresh resilience: reload a guest page in lobby -> should rejoin
  await players[2].reload({ waitUntil: 'networkidle2' });
  await players[2].waitForSelector('#screen-lobby:not(.hidden)', { timeout: 5000 });
  console.log('guest refresh -> rejoined lobby');

  // emoji-only mode peek
  await host.click('[data-mode="emoji"]'); await sleep(300);
  await host.click('#start-btn');
  await players[1].waitForFunction(() => window.__dd.S.task && window.__dd.S.task.step === 0, { timeout: 8000 });
  await sleep(1900);
  await players[1].click('#emoji-keys [data-k="🐧"]'); await players[1].click('#emoji-keys [data-k="🏫"]'); await players[1].click('#emoji-keys [data-k="🎒"]');
  await players[1].screenshot({ path: `${OUT}/emoji-mode-mobile.png` });
  const val = await players[1].$eval('#write-input', e => e.value);
  console.log('emoji input value:', val);
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close();
  process.exit(errors.length ? 2 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
