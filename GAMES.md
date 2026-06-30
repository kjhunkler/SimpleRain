# Simple Games — Developer Reference

A touch-friendly PWA pocket arcade. All games run in a shared `<canvas>` hosted by `app.js`. Each game is a self-contained JS file that registers itself onto `window.SGGames`.

---

## File Map

```
index.html          — Shell HTML; loads all game scripts before app.js
manifest.json       — PWA manifest (portrait-primary, standalone)
sw.js               — Service worker; cache name bumped per release (CACHE_NAME)
css/app.css         — All styles; uses CSS custom properties (see Design Tokens below)
js/storage.js       — SGStorage: profiles, scores, kids mode  →  window.SGStorage
js/sound.js         — SGSound: WebAudio FX, no external files  →  window.SGSound
js/app.js           — App shell: screens, categories, game host, score/share flow
js/games/*.js       — One file per game; registers onto window.SGGames
icons/icon.svg      — App icon (SVG, any size)
icons/icon-maskable.svg
server/server.py    — Local Python WS server for Bug Hunt multiplayer only
server/README.md    — Bug Hunt server setup & play instructions
bughunt.html        — Standalone Bug Hunt page served by the Python server
```

---

## Current Games (24)

Games are displayed in the order defined by `GAME_ORDER` in `js/app.js:11`.

### Classic
| ID | Name | Emoji | Score unit | Tag |
|----|------|-------|------------|-----|
| `snake` | Snake | 🐍 | apples | Swipe to steer. Eat, grow, survive. |
| `astro` | Astro Blaster | 🚀 | rocks | Drag to fly. Blast the asteroids. |
| `piestack` | Pie Stack | 🥧 | pies | Tap to drop. Stack pies sky-high. |
| `moles` | Mole Whack | 🐹 | moles | Tap the moles before they hide. |
| `bricks` | Brick Breaker | 🧱 | bricks | Drag the paddle. Smash every brick. |
| `fruit` | Fruit Slice | 🍉 | fruits | Swipe to slice. Dodge the bombs. |
| `stopspin` | Stop Spin | 🎯 | points | Stop the needle in the zone. |
| `sentry` | Sentry Swap | 👾 | points | Sleep darts for aliens, bombs for bots. Switch fast! |
| `bughunt` | Bug Hunt | 🐛 | bugs | Same-Wi-Fi multiplayer. Catch your bugs in order! |
| `catcher` | Star Catcher | ⭐ | stars | Drag the basket to catch falling stars. |

### Puzzle
| ID | Name | Emoji | Score unit | Tag |
|----|------|-------|------------|-----|
| `memory` | Memory Match | 🃏 | points | Flip cards. Match pairs. Build streaks. |
| `echo` | Echo Pads | 🎵 | rounds | Watch the pattern. Tap it back. |
| `tiles` | 2048 | 🔢 | points | Swipe to merge. Reach 2048! |
| `colorrush` | Color Rush | 🎈 | bubbles | Pop only the matching color! |
| `beatloop` | Beat Loop | 🎶 | notes | Paint notes. Hear your loop groove. |

### Learning
| ID | Name | Emoji | Score unit | Tag |
|----|------|-------|------------|-----|
| `abctrace` | ABC Trace | ✏️ | letters | Trace each letter A–Z and hear it spoken. |
| `lettersiege` | Letter Siege | 🤖 | defenses | Spot the letter to blast the robot and save the city! |

### Scroller
| ID | Name | Emoji | Score unit | Tag |
|----|------|-------|------------|-----|
| `flappy` | Bouncy Bird | 🐤 | pipes | Tap to flap through the gaps. |
| `hopper` | Sky Hopper | 🐸 | meters | Bounce up the platforms. Don't fall! |
| `taptiles` | Tap Tiles | 🎹 | notes | Tap the falling tiles. Play the tune. |
| `lanedash` | Lane Dash | 🏎️ | points | Swipe lanes. Dodge traffic. Grab stars. |
| `stormquest` | Storm Quest | ⚡ | points | Aim lightning, roll to dodge & slay the Storm Titan. |
| `digger` | Deep Digger | ⛏️ | coins | Dig for treasure, then upgrade your gear at the shop. |
| `turtlecave` | Shell Knight | 🐢 | treasure | Sword turtle cave-crawl: swipe to move & dash, tap to slash, beat the boss! |

---

## Adding a New Game

**1. Create `js/games/<id>.js`** — wrap everything in an IIFE:

```js
(function () {
    "use strict";

    function create(host) {
        // host.canvas   — the shared <canvas> element
        // host.kids     — boolean, true when Kids Mode is on
        // host.setScore(n)  — update the header score display
        // host.gameOver(n)  — end the run, record & show overlay
        // host.vibrate([ms])— haptic feedback

        return {
            start()   { /* begin or resume */ },
            restart() { /* replay without re-creating */ },
            destroy() { /* cancel rAF, remove listeners */ }
        };
    }

    window.SGGames = window.SGGames || {};
    window.SGGames["<id>"] = {
        id:         "<id>",
        name:       "Display Name",
        emoji:      "🎮",
        tag:        "One-line description shown on the game card.",
        scoreLabel: "points",   // unit shown on game-over overlay
        create:     create
    };
})();
```

**2. Add a `<script>` tag to `index.html`** before `<script src="js/app.js">`.

**3. Add to `sw.js` ASSETS array** — bump `CACHE_NAME` version number.

**4. Register in `js/app.js`:**
- Add the ID to `GAME_ORDER` (`app.js:11`) at the desired position.
- Add the ID → category mapping to `GAME_CATEGORY` (`app.js:26`). Available categories: `classic`, `puzzle`, `learning`, `scroller`. Omitting it falls back to `classic`.

**Kids Mode note:** read `host.kids` in `create()` and use it to scale difficulty (slower speeds, wider gaps, extra lives). See `snake.js` for a simple example, `flappy.js` for physics constants.

---

## Game Host API (`host` object passed to `create`)

| Member | Type | Description |
|--------|------|-------------|
| `host.canvas` | `HTMLCanvasElement` | Shared canvas; measure via `clientWidth/clientHeight` |
| `host.kids` | `boolean` | True when the active profile has Kids Mode enabled |
| `host.setScore(n)` | `function` | Updates the in-header score counter |
| `host.gameOver(n)` | `function` | Ends the run: saves score, plays sound, shows overlay |
| `host.vibrate(pattern)` | `function` | Calls `navigator.vibrate` if available |

**Canvas sizing pattern** (copy from any existing game):
```js
function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = canvas.clientWidth  * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);
resize();
```

---

## SGStorage — `js/storage.js`

Persists profiles and high scores to `localStorage` under the key `simple-games-data-v1`.

```js
SGStorage.getProfiles()                       // → Profile[]
SGStorage.getProfile(id)                      // → Profile | null
SGStorage.getActiveProfile()                  // → Profile | null
SGStorage.setActiveProfile(id)
SGStorage.clearActiveProfile()
SGStorage.createProfile(name, avatar, kids)   // → Profile
SGStorage.updateProfile(id, name, avatar, kids)
SGStorage.deleteProfile(id)
SGStorage.isKidsMode(id)                      // → boolean
SGStorage.setKidsMode(id, on)
SGStorage.getBestScore(profileId, gameId)     // → number
SGStorage.getScores(profileId)                // → { [gameId]: number }
SGStorage.submitScore(profileId, gameId, score) // → boolean (true = new best)
```

**Profile shape:**
```js
{ id, name, avatar, kids, scores: {}, kidsScores: {}, createdAt }
```
Kids Mode uses a separate `kidsScores` map so normal and kids records are independent.

---

## SGSound — `js/sound.js`

Pure WebAudio synthesis — no audio files needed. Sounds are synthesized from oscillators and noise buffers, so they work completely offline.

```js
SGSound.play("name")          // play a named effect (see table below)
SGSound.note(freq, dur, vol)  // play an arbitrary tone (triangle wave)
SGSound.unlock()              // call on first user gesture to unblock mobile audio
SGSound.isEnabled()           // → boolean
SGSound.toggle()              // → boolean (new state)
SGSound.setEnabled(on)
```

### Available Sound Effects

| Name | Character | Typical use |
|------|-----------|-------------|
| `tap` | Short sine blip | Button press, menu interaction |
| `flip` | Bright sine blip | Card flip |
| `eat` | Two-note crunch | Collecting food / power-up |
| `score` | Rising triangle duo | Point scored |
| `match` | Two-note chime | Pair matched |
| `perfect` | Four-note rising chime | Perfect sequence / bonus |
| `flap` | Rising sine blip | Wing flap (Bouncy Bird) |
| `jump` | Square pitch-rise | Character jump |
| `bounce` | Short sine bounce | Ball/paddle contact |
| `note0` | C4 triangle | Musical note (Echo Pads) |
| `note1` | E4 triangle | Musical note |
| `note2` | G4 triangle | Musical note |
| `note3` | C5 triangle | Musical note |
| `kick` | Bass drum thump | Beat Loop kick |
| `hat` | High-pass noise tick | Beat Loop hi-hat |
| `shoot` | Sawtooth whoosh-up | Projectile fire |
| `hit` | Mid noise burst | Hit/impact |
| `explode` | Low boom + rumble | Explosion |
| `drop` | Falling tone + thud | Object dropped |
| `whack` | Crack + low tone | Mole whack |
| `wrong` | Descending sour tone | Wrong answer |
| `miss` | Sawtooth fall | Miss / near-death |
| `gameover` | Four-note descending | End of run |
| `highscore` | Five-note fanfare | New personal best |
| `bossroar` | Gritty low rumble | Boss encounter |
| `bosscharge` | Rising whine | Boss charging attack |
| `bossslam` | Deep boom + crunch | Boss ground slam |
| `bosslaser` | Sustained buzzing beam | Boss laser attack |
| `missile` | Quick whoosh | Projectile salvo |
| `bossswoop` | Falling whoosh | Flying boss dive |
| `bosszap` | Electric crack | Lightning attack |

---

## App Shell — `js/app.js`

### Screens
The shell manages four screens by toggling the `.hidden` class:

| Key | Element ID | Purpose |
|-----|-----------|---------|
| `profiles` | `#screen-profiles` | Profile picker / landing |
| `profileEdit` | `#screen-profile-edit` | Create or edit a player |
| `home` | `#screen-home` | Game picker with category filters |
| `game` | `#screen-game` | Canvas host + score header + overlays |

### Category System (`app.js:20–34`)
```js
const CATEGORIES = [
    { key: "classic",  label: "Classic",  emoji: "🕹️" },
    { key: "puzzle",   label: "Puzzle",   emoji: "🧩" },
    { key: "learning", label: "Learning", emoji: "🎓" },
    { key: "scroller", label: "Scroller", emoji: "🏃" }
];
```
Games not in `GAME_CATEGORY` fall back to `"classic"` automatically.

### Game Card Fields
Each card renders from the `SGGames[id]` definition: `emoji`, `name`, `tag`, and the stored best score. A share button (📲) appears automatically once a score is recorded.

### Score Share (`app.js:204`)
`SHARE_LINK` points to the hosted URL. `shareScore(def, best)` opens `sms:?&body=...` with a pre-filled brag message — no extra work needed per game.

### Game Lifecycle
```
startGame(id)
  → def.create(gameHost)   returns { start, restart, destroy }
  → currentGame.start()

gameHost.gameOver(score)   called by the game
  → SGStorage.submitScore()
  → shows overlay (retry / home)

btn-overlay-retry
  → currentGame.restart()  (no re-create)

exitToHome / confirmExit
  → currentGame.destroy()
  → SGStorage.submitScore() (saves partial score on manual quit)
```

---

## Design Tokens — `css/app.css`

```css
--bg:        #12121f   /* page background */
--bg-2:      #1b1b30   /* secondary background */
--card:      #232342   /* card surface */
--card-2:    #2c2c52   /* elevated card */
--text:      #f2f3ff   /* primary text */
--muted:     #9aa0c3   /* secondary / label text */
--accent:    #ff4d8d   /* primary accent (pink) */
--accent-2:  #39d0ff   /* secondary accent (cyan) */
--gold:      #ffd166   /* high-score / star highlights */
--danger:    #ff5d5d   /* destructive actions */
--radius:    18px      /* standard border-radius */

/* Safe-area insets (notch / home bar) */
--safe-top:    env(safe-area-inset-top,    0px)
--safe-bottom: env(safe-area-inset-bottom, 0px)
--safe-left:   env(safe-area-inset-left,   0px)
--safe-right:  env(safe-area-inset-right,  0px)
```

Max app width: `520px` (`#app`), centered, portrait-locked via the PWA manifest.

---

## Bug Hunt Multiplayer Server

Bug Hunt is the only game that requires a backend. All other games run fully client-side.

- **Server:** `server/server.py` — Python 3.8+, stdlib only, no pip install
- **Protocol:** WebSocket on port `8765`
- **Hardcoded host:** `SERVER_HOST` in `js/games/bughunt.js` — update this if the server machine's IP changes
- **Launch URL:** `bughunt.html` — served directly by the Python server, not the PWA shell

See `server/README.md` for full setup, HTTPS mode (for mixed-content scenarios), and gameplay rules.

---

## PWA / Offline Notes

- Service worker: `sw.js`. Cache version: `CACHE_NAME = "simple-games-v35"` — **increment this string every release** to push updates to users.
- Update flow: when a new SW is waiting, the app shows a banner (`#update-banner`). User taps "Refresh" → SW gets `SKIP_WAITING` → `controllerchange` event reloads the page.
- All game JS files must be listed in `sw.js ASSETS` to work offline.
- Bug Hunt's WebSocket (`ws://`) won't work from an `https://` origin — see `server/README.md` for the `--https` workaround.
