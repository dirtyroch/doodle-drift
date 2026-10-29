const puppeteer = require('puppeteer-core');
// Records short previews of each music loop + the sfx reel from the real engine (headless Chrome).
// Usage: server running, then `npm run record:audio` -> $OUT/audio/*.webm (convert with ffmpeg if you like).
const fs = require('fs');
const OUT = (process.env.OUT || '/workspace/game-screens') + '/audio';
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage(); await p.goto('' + (process.env.BASE || 'http://localhost:4747') + '/', { waitUntil: 'networkidle0' });
  await p.click('body');
  const plan = (process.env.PLAN || 'lobby:12,play:12,tense:8,reveal:12,sfx:14').split(',').map(x => { const [a, b] = x.split(':'); return [a, +b]; });
  for (const [name, secs] of plan) {
    const b64 = await p.evaluate(async (name, secs) => {
      const ctx = Sfx._debug.ctx(); const dest = ctx.createMediaStreamDestination(); Sfx._debug.master().connect(dest);
      const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 }); const chunks = [];
      rec.ondataavailable = e => chunks.push(e.data);
      const wait = ms => new Promise(r => setTimeout(r, ms));
      Sfx.music(null); await wait(1600);
      rec.start();
      if (name === 'tense') { Sfx.music('play'); await wait(2500); Sfx.tension(true); await wait(secs * 1000 - 5000); Sfx.tension(false); await wait(2500); }
      else if (name === 'sfx') {
        const seq = [['click'], ['pop'], ['join'], ['leave'], ['send'], ['step'], ['start'], ['react'], ['react']];
        for (const [f] of seq) { Sfx[f](); await wait(700); }
        for (let n = 10; n >= 1; n--) { Sfx.tick(n); await wait(250); }
        Sfx.timesUp(); await wait(2300); Sfx.chain(); await wait(2600);
      } else { Sfx.music(name); await wait(secs * 1000); }
      Sfx.music(null); await wait(name === 'sfx' ? 300 : 1500);
      rec.stop(); await new Promise(r => rec.onstop = r); dest.disconnect && Sfx._debug.master().disconnect(dest);
      const buf = await new Blob(chunks).arrayBuffer(); let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s);
    }, name, secs);
    fs.writeFileSync(`${OUT}/${name}.webm`, Buffer.from(b64, 'base64')); console.log('saved', name);
  }
  await b.close();
})();
