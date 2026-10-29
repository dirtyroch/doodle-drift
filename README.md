# 🐓 Roch-a-Doodle

<img src="public/mascot.svg" alt="Roch-a-Doodle mascot: a little Jesus figure with a Jesus loves you banner" width="160" align="right">

**Write it. Draw it. Crow about it.** A multiplayer scribble-and-guess relay for 3–12 friends, played in the browser (phone or desktop).

Everyone writes a silly prompt, then the sketchbooks rotate: the next player draws it, the next guesses the drawing, and so on until every book comes home. Then the whole table watches each chain replay, stroke by stroke.

## Run it

```bash
npm install
npm start               # http://localhost:4747  (PORT=xxxx to change)
./run.sh                # same, but auto-restarts if the process dies
```

Open the URL, enter a name, pick an avatar, hit **Start a room**, and share the invite link (`/r/CODE`) or the 4-letter code. The host starts once 3+ players are in.

To let friends outside your network play, put a tunnel in front of port 4747, e.g. `cloudflared tunnel --url http://localhost:4747` or `npx localtunnel --port 4747`, or deploy to any Node host (Render, Railway, Fly.io). It's a single process with in-memory rooms, so run **one** instance with WebSockets enabled.

## Deploy to Render (free)

The repo includes a `render.yaml` Blueprint. In Render: **New → Blueprint** (or **New → Web Service**) and point it at the repo. Settings if you configure it by hand:

- Runtime: **Node** (Node 20, set via `engines`, `.nvmrc` and `NODE_VERSION`)
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/healthz`
- Instance: Free. WebSockets work out of the box. The server reads `PORT` from the environment.

The free tier sleeps after about 15 minutes idle (the first visit takes ~30–60s to wake up) and rooms are in memory, so a redeploy or sleep ends games in progress.

## What's in the box

- **Lobby:** shareable code/link, nickname plus emoji avatar and color, host crown, host can kick, 3–12 players, host hands off automatically if they leave.
- **Modes:** 🖍️ Classic · ⚡ Speed Round (short timers) · 🤪 Emoji Only (prompts and guesses must be emoji; the server enforces it, and there's a built-in emoji keyboard).
- **Pace:** Chill / Normal / Hasty timer multiplier.
- **🃏 Wildcards (twist):** about a third of drawers each round get a secret challenge card ("draw it upside down", "only one color"…).
- **Drawing:** touch and mouse (pointer events), 16 colors, 4 brush sizes, eraser, paint bucket, undo/redo, clear (tap twice), keyboard shortcuts (P/E/F, Ctrl+Z/Y, [ ]).
- **Timers:** per-step countdown. When time's up, whatever you have is auto-submitted, and anything missing is filled with a placeholder so the game never stalls.
- **Resilience:** refresh or drop mid-game and you rejoin your seat with your in-progress drawing or text restored. If everyone still online is done, offline players are skipped after about 4s instead of waiting out the timer. "Wait, let me fix it" un-submits while others are still working.
- **Album reveal (twist):** the host steps through each sketchbook page by page, with drawings **replaying stroke by stroke**. Everyone can fire floating emoji reactions. Any chain can be downloaded as one tall PNG. Then hit **Play again** for the same room.
- **🎵 Original music + sound, all generated live with the Web Audio API (no audio files, nothing licensed):**
  - Music loops: a chill ukulele loop for home/lobby, an upbeat chiptune party loop while writing/drawing, and a sitcom-style groove for the album reveal. Phases crossfade smoothly.
  - **Suspense shift:** in the last 10 seconds of a step the music crossfades to a tense version (C minor, faster, pulsing bass, an ostinato that climbs a semitone every two bars, a rising whistle), then eases back when the step ends.
  - SFX: countdown ticks for the last 10s (higher and louder for the last 5 and last 3), a time's-up buzzer plus a synthesized rooster crow, submit pop + sparkle, join/leave chimes, page-flip whoosh between rounds, game-start fanfare, drumroll + ta-da for every chain in the reveal, reaction pops, and subtle button clicks.
  - Sound panel (🎵 in the top bar): separate Music and SFX toggles + volume sliders, saved in localStorage. Audio starts on the first tap/keypress (browser autoplay rules), and pauses when the tab is hidden.
  - `npm run record:audio` (server running) records previews of every loop and the SFX reel to `/workspace/game-screens/audio/`.

## Tests

```bash
npm test               # 48 socket-level checks: full games, rotation correctness, timeouts, AFK, disconnect/rejoin, validation, emoji mode
npm run test:browser   # drives 4 headless Chrome players (1 mobile/touch) through a full game via the real UI; screenshots to /workspace/game-screens
```
(`test:browser` needs the server running and Chrome at `/usr/bin/google-chrome`.)

## Layout

```
server.js          Express + Socket.IO game server (rooms, rotation, timers, reveal)
public/index.html  All screens (home, lobby, play, reveal)
public/style.css   Roch-a-Doodle look: midnight + sticker cards
public/mascot.svg  Standalone mascot ("Jesus loves you" figure; also inlined as an SVG sprite in index.html)
public/app.js      Client game logic
public/draw.js     Vector drawing engine (strokes, flood fill, replay)
public/sound.js    Audio engine: synthesized music loops (lookahead step sequencer, crossfades, suspense mode) + SFX
test/              e2e (socket) + browser (puppeteer) tests
```
