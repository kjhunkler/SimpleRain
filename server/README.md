# Bug Hunt server

A tiny, dependency-free Python server that powers the **Bug Hunt** multiplayer
game in Simple Games. It serves the whole app *and* runs the game over a
WebSocket, so everyone on the same Wi-Fi just opens one URL.

## Run it

You need Python 3.8+ (no `pip install` — it's all standard library).

```bash
cd server
python server.py
```

On startup it prints two addresses, e.g.:

```
On this computer:   http://localhost:8765
On other devices:   http://192.168.1.42:8765
```

## Play — open the app FROM the server

**The recommended way to play is to open the app straight from this server**
(not from a hosted/`https://` copy). The server delivers the whole game, so this
"just works" with no certificates or extra setup.

1. On the computer running the server, open the **"On this computer"** URL
   (`http://localhost:8765`).
2. On phones/tablets/other computers **on the same network**, open the
   **"On other devices"** URL (`http://192.168.0.12:8765`).
   Tip: on a phone you can **Add to Home Screen** for a one-tap icon.
3. Pick a profile, choose **Bug Hunt** from the game list, and tap **Join**.

> The hard-coded server address is `192.168.0.12:8765` (see `SERVER_HOST` in
> `js/games/bughunt.js`). If your PC's IP changes, update it there.

## "It says the connection is blocked / error" (https pages)

A browser will **not** let an `https://` page open an insecure `ws://` socket
("mixed content"). So if you loaded the app from a hosted `https://` copy, the
game can't connect.

**Easiest fix:** open the game over http instead — `http://192.168.0.12:8765`
(see above). Done.

**If you must use the https page**, run the server in secure mode so it speaks
`wss://`, and trust its certificate once per device:

1. Start the server with the `--https` flag:
   ```bash
   python server.py --https
   ```
   The first run creates a self-signed certificate (`cert.pem` / `key.pem`).
   This needs either the `cryptography` package (`pip install cryptography`) or
   `openssl` on your PATH — Git for Windows includes one.
2. On each device, first open **`https://192.168.0.12:8765`** in the browser.
3. You'll see a security warning (it's *your own* certificate) — tap
   **Advanced → Proceed / Visit anyway** to trust it.
4. Now open your https app and tap **Join** — it will connect over `wss://`.

The in-game error screen walks you through these same steps if a connection
fails.

## How to play

- Move with the on-screen arrows (or WASD / arrow keys on a computer).
- Walk up to **logs 🪵, trees 🌳 and tall grass 🌿** to flush out hidden bugs.
- When a bug appears it runs away — corner it and stand close. A bar fills over
  3 seconds; the **first player to fill it** catches the bug.
- Your bag is across the top. Tap a bug in your bag to pick it up, then **tap
  the field** to release it again (handy for re-ordering your catches).
- You can grab any bug, but to **win** you must be holding your 4 target bugs
  **in the listed order**. First to do it wins!
- After a win there's a 10-second countdown to the next round. Everyone can tap
  **I'm ready** to skip the wait.

## Notes

- The port is hardcoded to `8765` in `server.py` (change `PORT` there if needed).
- If it **crashes the instant you run it**, the most common cause is that another
  copy is already running and holding port 8765. The server now prints a clear
  message in that case and keeps the window open so you can read it — just close
  the old window (or `Stop-Process -Name python`) and run it again.
- `--https` mode requires `cryptography` or `openssl` to create the certificate.
  `cert.pem` / `key.pem` are generated next to `server.py` and are gitignored.
- This `server/` folder is in `.gitignore` — it's a local helper, not part of
  the published static app.
