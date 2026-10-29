# ✏️ Doodle Drift

**Write it. Draw it. Watch it drift.** A multiplayer scribble-and-guess relay for 3–12 friends, played in the browser (phone or desktop).

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
- Original synthesized sound effects (WebAudio, no audio files) with a mute toggle.

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
public/style.css   Doodle Drift look: midnight + sticker cards
public/app.js      Client game logic
public/draw.js     Vector drawing engine (strokes, flood fill, replay)
public/sound.js    Synthesized SFX
test/              e2e (socket) + browser (puppeteer) tests
```
