#!/usr/bin/env python3
"""
Bug Hunt — local-network multiplayer game server.

A single self-contained file with no third-party dependencies. It does two
things:

  1. Serves the Simple Games static app (the folder one level up) over HTTP so
     every player on the same Wi-Fi can just open one URL.
  2. Hosts an authoritative WebSocket game at /ws for the Bug Hunt game.

Run it:

    python server.py

Then point every device's browser at  http://<this-computer-ip>:8765
(the script prints the address on startup). The Bug Hunt game auto-detects the
server because the page and the socket share the same host.

Everything is pure Python stdlib (asyncio), so there is nothing to install.
"""

import asyncio
import base64
import hashlib
import json
import math
import mimetypes
import os
import random
import socket
import ssl
import sys
import time
import traceback
import uuid

# --------------------------------------------------------------------------- #
# Configuration (hardcoded on purpose, per the brief)
# --------------------------------------------------------------------------- #
HOST = "0.0.0.0"
PORT = 8765
TICK_HZ = 20                       # server simulation + broadcast rate
STATIC_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# TLS / secure mode. Only needed if you open the app from an https:// page
# (e.g. a hosted copy), because https pages can't use insecure ws://.
# Turn it on by running:  python server.py --https
USE_TLS = "--https" in sys.argv
CERT_FILE = os.path.join(os.path.dirname(__file__), "cert.pem")
KEY_FILE = os.path.join(os.path.dirname(__file__), "key.pem")
CERT_IP = "192.168.0.12"           # the IP the self-signed cert is issued for

# World / gameplay tuning -------------------------------------------------- #
WORLD_W = 1000
WORLD_H = 700
HORIZON_Y = 120                    # world y above this is sky/mountains backdrop (keep in sync with client)
PLAY_TOP = HORIZON_Y + 14          # players/bugs stay below the horizon
PLAYER_SPEED = 200                 # informational; movement is client-driven
SEARCH_RADIUS = 58                 # how close to a spot to flush out its bug
CAPTURE_RADIUS = 78                # how close to a bug to fill its progress bar
CAPTURE_TIME = 3.0                 # seconds of nearness needed to catch a bug
PROGRESS_DECAY = 1.6               # how fast your bar drains when you step away
FLEE_TRIGGER = 165                 # a bug starts running once a player is this close
FLEE_SPEED = 95                    # px/s while fleeing
WANDER_SPEED = 28                  # px/s idle drift
CORNERED_FACTOR = 0.32             # bugs slow down once someone is capturing them
TARGETS_PER_PLAYER = 4
EXTRA_BUGS = 4                     # decoy bugs beyond everyone's targets
RESET_SECONDS = 10.0              # countdown after a win

# Bug species: (key, emoji). Keys drive logic, emoji is what players see.
# Deliberately limited to older, universally-supported emoji so they render as
# real colour glyphs on every phone (newer bug emoji show as blank/"shadow"
# placeholders on older devices).
SPECIES = [
    ("ladybug", "\U0001F41E"),       # 🐞
    ("ant", "\U0001F41C"),           # 🐜
    ("honeybee", "\U0001F41D"),      # 🐝
    ("butterfly", "\U0001F98B"),     # 🦋
    ("caterpillar", "\U0001F41B"),   # 🐛
    ("snail", "\U0001F40C"),         # 🐌
    ("spider", "\U0001F577️"),  # 🕷️
    ("scorpion", "\U0001F982"),      # 🦂
]
EMOJI = dict(SPECIES)
SPOT_TYPES = ["log", "tree", "grass"]

# --------------------------------------------------------------------------- #
# WebSocket framing (RFC 6455) — just enough for small JSON text messages.
# --------------------------------------------------------------------------- #
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def ws_accept_key(client_key: str) -> str:
    digest = hashlib.sha1((client_key + WS_GUID).encode()).digest()
    return base64.b64encode(digest).decode()


def encode_frame(payload: bytes, opcode: int = 0x1) -> bytes:
    header = bytearray([0x80 | opcode])
    n = len(payload)
    if n < 126:
        header.append(n)
    elif n < 65536:
        header.append(126)
        header += n.to_bytes(2, "big")
    else:
        header.append(127)
        header += n.to_bytes(8, "big")
    return bytes(header) + payload


async def read_frame(reader: asyncio.StreamReader):
    """Return (opcode, data_bytes) for one client frame, or None on close/EOF."""
    try:
        first = await reader.readexactly(1)
        second = await reader.readexactly(1)
    except asyncio.IncompleteReadError:
        return None
    opcode = first[0] & 0x0F
    masked = second[0] & 0x80
    length = second[0] & 0x7F
    if length == 126:
        length = int.from_bytes(await reader.readexactly(2), "big")
    elif length == 127:
        length = int.from_bytes(await reader.readexactly(8), "big")
    mask = await reader.readexactly(4) if masked else b"\x00\x00\x00\x00"
    data = await reader.readexactly(length) if length else b""
    if masked:
        data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
    return opcode, data


class Conn:
    """One connected browser. Owns its writer and serializes writes."""

    def __init__(self, reader, writer):
        self.reader = reader
        self.writer = writer
        self.lock = asyncio.Lock()
        self.id = uuid.uuid4().hex[:8]
        self.open = True

    async def send(self, text: str):
        if not self.open:
            return
        frame = encode_frame(text.encode("utf-8"), 0x1)
        async with self.lock:
            try:
                self.writer.write(frame)
                await self.writer.drain()
            except Exception:
                self.open = False

    async def send_json(self, obj):
        await self.send(json.dumps(obj))

    async def close(self):
        self.open = False
        try:
            self.writer.write(encode_frame(b"", 0x8))
            await self.writer.drain()
        except Exception:
            pass
        try:
            self.writer.close()
        except Exception:
            pass


# --------------------------------------------------------------------------- #
# Game state (single event loop = single thread, so no locks needed)
# --------------------------------------------------------------------------- #
class Game:
    def __init__(self):
        self.conns = {}        # conn.id -> Conn
        self.players = {}      # id -> player dict
        self.bugs = []         # list of bug dicts (hidden / fleeing only kept live)
        self.spots = []        # list of spot dicts
        self.phase = "playing"  # "playing" | "won"
        self.reset_timer = 0.0
        self.winner_id = None
        self.winner_name = ""
        self._bug_seq = 0
        self.new_round()

    # ---- helpers --------------------------------------------------------- #
    def next_bug_id(self):
        self._bug_seq += 1
        return "b%d" % self._bug_seq

    def random_pos(self, margin=70):
        return (
            random.uniform(margin, WORLD_W - margin),
            random.uniform(PLAY_TOP + margin, WORLD_H - margin),
        )

    def spaced_pos(self, others, min_dist=90, margin=70):
        for _ in range(40):
            x, y = self.random_pos(margin)
            if all((x - o["x"]) ** 2 + (y - o["y"]) ** 2 >= min_dist * min_dist
                   for o in others):
                return x, y
        return self.random_pos(margin)

    def assign_targets(self):
        keys = [k for k, _ in SPECIES]
        return random.sample(keys, TARGETS_PER_PLAYER)

    def spawn_hidden_bug(self, species):
        """Create a bug tucked under a fresh hiding spot."""
        sx, sy = self.spaced_pos(self.spots, min_dist=85)
        spot = {
            "id": "s%d" % len(self.spots),
            "type": random.choice(SPOT_TYPES),
            "x": sx, "y": sy,
            "rustle": 0.0,
        }
        self.spots.append(spot)
        bug = {
            "id": self.next_bug_id(),
            "species": species,
            "emoji": EMOJI[species],
            "state": "hidden",          # hidden | fleeing | captured
            "x": sx, "y": sy,
            "spot": spot["id"],
            "heading": random.uniform(0, math.tau),
            "progress": {},             # player_id -> seconds of capture progress
        }
        self.bugs.append(bug)
        return bug

    def spawn_fleeing_bug(self, species, x, y):
        bug = {
            "id": self.next_bug_id(),
            "species": species,
            "emoji": EMOJI[species],
            "state": "fleeing",
            "x": max(20, min(WORLD_W - 20, x)),
            "y": max(PLAY_TOP + 4, min(WORLD_H - 20, y)),
            "spot": None,
            "heading": random.uniform(0, math.tau),
            "progress": {},
        }
        self.bugs.append(bug)
        return bug

    # ---- round lifecycle ------------------------------------------------- #
    def new_round(self):
        self.phase = "playing"
        self.reset_timer = 0.0
        self.winner_id = None
        self.winner_name = ""
        self.bugs = []
        self.spots = []
        self._bug_seq = 0

        # Every player gets a fresh ordered target list, and we guarantee one
        # findable bug per target so the round is always winnable.
        for p in self.players.values():
            p["targets"] = self.assign_targets()
            p["inventory"] = []
            p["ready"] = False
            p["won"] = False
            p["x"], p["y"] = self.random_pos()
            for species in p["targets"]:
                self.spawn_hidden_bug(species)

        # A few decoy bugs add clutter and choices.
        for _ in range(EXTRA_BUGS):
            self.spawn_hidden_bug(random.choice([k for k, _ in SPECIES]))

        # Add a handful of empty spots so searching isn't always rewarding.
        for _ in range(4):
            sx, sy = self.spaced_pos(self.spots, min_dist=85)
            self.spots.append({
                "id": "s%d" % len(self.spots),
                "type": random.choice(SPOT_TYPES),
                "x": sx, "y": sy, "rustle": 0.0,
            })

    def add_player(self, pid, name, avatar):
        p = {
            "id": pid, "name": name or "Player", "avatar": avatar or "\U0001F642",
            "x": 0, "y": 0,
            "targets": [], "inventory": [], "ready": False, "won": False,
        }
        self.players[pid] = p
        if self.phase == "playing":
            p["targets"] = self.assign_targets()
            p["x"], p["y"] = self.random_pos()
            # Guarantee this latecomer's bugs exist.
            for species in p["targets"]:
                self.spawn_hidden_bug(species)
        else:
            # During the reset countdown, give them targets for the next round.
            p["targets"] = self.assign_targets()
            p["x"], p["y"] = self.random_pos()
        return p

    def remove_player(self, pid):
        p = self.players.pop(pid, None)
        if not p:
            return
        # Drop everything they were carrying back into the world.
        for item in p["inventory"]:
            self.spawn_fleeing_bug(item["species"], *self.random_pos())
        # Clean their capture progress off any live bug.
        for bug in self.bugs:
            bug["progress"].pop(pid, None)

    # ---- player actions -------------------------------------------------- #
    def move(self, pid, x, y):
        p = self.players.get(pid)
        if not p:
            return
        p["x"] = max(16, min(WORLD_W - 16, float(x)))
        p["y"] = max(PLAY_TOP, min(WORLD_H - 16, float(y)))

    def release(self, pid, bug_id, x, y):
        p = self.players.get(pid)
        if not p:
            return
        for i, item in enumerate(p["inventory"]):
            if item["bugId"] == bug_id:
                p["inventory"].pop(i)
                self.spawn_fleeing_bug(item["species"], float(x), float(y))
                return

    def set_ready(self, pid, value):
        p = self.players.get(pid)
        if p:
            p["ready"] = bool(value)
        if self.phase == "won" and self.players and \
                all(pl["ready"] for pl in self.players.values()):
            self.new_round()

    # ---- win logic ------------------------------------------------------- #
    def target_progress(self, p):
        """Longest in-order prefix of the player's targets they currently hold."""
        held = [it["species"] for it in p["inventory"] if it["species"] in p["targets"]]
        k = 0
        for t in p["targets"]:
            if k < len(held) and held[k] == t:
                k += 1
            else:
                break
        # The held list must match the target order exactly to count fully.
        if held == p["targets"]:
            return len(p["targets"])
        return k

    def check_win(self, p):
        held = [it["species"] for it in p["inventory"] if it["species"] in p["targets"]]
        return held == p["targets"]

    def capture(self, bug, pid):
        p = self.players.get(pid)
        if not p:
            return
        bug["state"] = "captured"
        p["inventory"].append({
            "bugId": bug["id"], "species": bug["species"], "emoji": bug["emoji"],
        })
        if self.phase == "playing" and self.check_win(p):
            self.phase = "won"
            self.winner_id = pid
            self.winner_name = p["name"]
            self.reset_timer = RESET_SECONDS
            for pl in self.players.values():
                pl["ready"] = False
                pl["won"] = (pl["id"] == pid)

    # ---- simulation ------------------------------------------------------ #
    def update(self, dt):
        if self.phase == "won":
            self.reset_timer -= dt
            if self.reset_timer <= 0:
                self.new_round()
            return

        for spot in self.spots:
            spot["rustle"] = max(0.0, spot["rustle"] - dt)

        spot_by_id = {s["id"]: s for s in self.spots}
        captured_now = []

        for bug in self.bugs:
            if bug["state"] == "captured":
                continue

            if bug["state"] == "hidden":
                spot = spot_by_id.get(bug["spot"])
                for p in self.players.values():
                    if (p["x"] - bug["x"]) ** 2 + (p["y"] - bug["y"]) ** 2 <= SEARCH_RADIUS ** 2:
                        bug["state"] = "fleeing"
                        if spot:
                            spot["rustle"] = 0.5
                        break
                continue

            # --- fleeing: capture progress + flee AI ---------------------- #
            leader_pid, leader_val = None, 0.0
            being_captured = False
            for p in self.players.values():
                pid = p["id"]
                d2 = (p["x"] - bug["x"]) ** 2 + (p["y"] - bug["y"]) ** 2
                if d2 <= CAPTURE_RADIUS ** 2:
                    bug["progress"][pid] = bug["progress"].get(pid, 0.0) + dt
                    being_captured = True
                elif pid in bug["progress"]:
                    bug["progress"][pid] -= PROGRESS_DECAY * dt
                    if bug["progress"][pid] <= 0:
                        del bug["progress"][pid]
                val = bug["progress"].get(pid, 0.0)
                if val > leader_val:
                    leader_val, leader_pid = val, pid

            if leader_val >= CAPTURE_TIME and leader_pid is not None:
                self.capture(bug, leader_pid)
                captured_now.append(bug)
                continue

            bug["_cap"] = (leader_pid, min(1.0, leader_val / CAPTURE_TIME)) if leader_pid else None

            # Flee from the nearest player; otherwise drift.
            nearest, nd2 = None, 1e18
            for p in self.players.values():
                d2 = (p["x"] - bug["x"]) ** 2 + (p["y"] - bug["y"]) ** 2
                if d2 < nd2:
                    nd2, nearest = d2, p
            speed = WANDER_SPEED
            if nearest and nd2 < FLEE_TRIGGER ** 2:
                bug["heading"] = math.atan2(bug["y"] - nearest["y"], bug["x"] - nearest["x"])
                speed = FLEE_SPEED
            else:
                bug["heading"] += random.uniform(-1.5, 1.5) * dt
            if being_captured:
                speed *= CORNERED_FACTOR

            bug["x"] += math.cos(bug["heading"]) * speed * dt
            bug["y"] += math.sin(bug["heading"]) * speed * dt
            # Bounce off the edges of the field (top edge is the horizon).
            if bug["x"] < 18 or bug["x"] > WORLD_W - 18:
                bug["heading"] = math.pi - bug["heading"]
            if bug["y"] < PLAY_TOP + 4 or bug["y"] > WORLD_H - 18:
                bug["heading"] = -bug["heading"]
            bug["x"] = max(18, min(WORLD_W - 18, bug["x"]))
            bug["y"] = max(PLAY_TOP + 4, min(WORLD_H - 18, bug["y"]))

        # Drop captured bugs from the live list.
        if captured_now:
            self.bugs = [b for b in self.bugs if b["state"] != "captured"]

    # ---- serialization --------------------------------------------------- #
    def shared_state(self):
        return {
            "phase": self.phase,
            "resetTimer": round(max(0.0, self.reset_timer), 1),
            "winnerName": self.winner_name,
            "world": {"w": WORLD_W, "h": WORLD_H},
            "captureTime": CAPTURE_TIME,
            "players": [
                {"id": p["id"], "name": p["name"], "avatar": p["avatar"],
                 "x": round(p["x"], 1), "y": round(p["y"], 1),
                 "ready": p["ready"], "won": p["won"]}
                for p in self.players.values()
            ],
            "spots": [
                {"id": s["id"], "type": s["type"],
                 "x": round(s["x"], 1), "y": round(s["y"], 1),
                 "rustle": round(s["rustle"], 2)}
                for s in self.spots
            ],
            "bugs": [
                {"id": b["id"], "emoji": b["emoji"],
                 "x": round(b["x"], 1), "y": round(b["y"], 1),
                 "cap": ({"by": b["_cap"][0], "p": round(b["_cap"][1], 2)}
                         if b.get("_cap") else None)}
                for b in self.bugs if b["state"] == "fleeing"
            ],
        }

    def personal_state(self, pid):
        p = self.players.get(pid)
        if not p:
            return {}
        return {
            "id": pid,
            "ready": p["ready"],
            "targets": [{"species": s, "emoji": EMOJI[s]} for s in p["targets"]],
            "progress": self.target_progress(p),
            "inventory": [
                {"bugId": it["bugId"], "species": it["species"], "emoji": it["emoji"],
                 "isTarget": it["species"] in p["targets"]}
                for it in p["inventory"]
            ],
        }


GAME = Game()


# --------------------------------------------------------------------------- #
# Connection handling
# --------------------------------------------------------------------------- #
async def handle_ws_messages(conn: Conn):
    while conn.open:
        frame = await read_frame(conn.reader)
        if frame is None:
            break
        opcode, data = frame
        if opcode == 0x8:                       # close
            break
        if opcode == 0x9:                       # ping -> pong
            async with conn.lock:
                conn.writer.write(encode_frame(data, 0xA))
                await conn.writer.drain()
            continue
        if opcode != 0x1:                       # ignore binary / pong
            continue
        try:
            msg = json.loads(data.decode("utf-8"))
        except Exception:
            continue
        await handle_message(conn, msg)


async def handle_message(conn: Conn, msg):
    t = msg.get("type")
    pid = conn.id
    if t == "join":
        GAME.add_player(pid, msg.get("name", ""), msg.get("avatar", ""))
        await conn.send_json({"type": "welcome", "id": pid,
                              "world": {"w": WORLD_W, "h": WORLD_H}})
    elif t == "move":
        GAME.move(pid, msg.get("x", 0), msg.get("y", 0))
    elif t == "release":
        GAME.release(pid, msg.get("bugId"), msg.get("x", 0), msg.get("y", 0))
    elif t == "ready":
        GAME.set_ready(pid, msg.get("value", True))


async def broadcast_loop():
    last = time.monotonic()
    while True:
        await asyncio.sleep(1.0 / TICK_HZ)
        now = time.monotonic()
        dt = min(now - last, 0.1)
        last = now
        GAME.update(dt)

        if not GAME.conns:
            continue
        shared = GAME.shared_state()
        dead = []
        for cid, conn in list(GAME.conns.items()):
            if not conn.open:
                dead.append(cid)
                continue
            payload = dict(shared)
            payload["type"] = "state"
            payload["you"] = GAME.personal_state(cid)
            await conn.send_json(payload)
        for cid in dead:
            await drop_conn(cid)


async def drop_conn(cid):
    conn = GAME.conns.pop(cid, None)
    GAME.remove_player(cid)
    if conn:
        await conn.close()


# --------------------------------------------------------------------------- #
# Static file serving (so the whole app comes off this one server)
# --------------------------------------------------------------------------- #
def build_http_response(status, body: bytes, content_type="text/plain"):
    head = (
        "HTTP/1.1 %s\r\n"
        "Content-Type: %s\r\n"
        "Content-Length: %d\r\n"
        "Cache-Control: no-store, must-revalidate\r\n"
        "Connection: close\r\n"
        "\r\n" % (status, content_type, len(body))
    )
    return head.encode("latin1") + body


def serve_static(path):
    rel = path.split("?", 1)[0].lstrip("/")
    if rel == "":
        rel = "index.html"
    full = os.path.abspath(os.path.join(STATIC_ROOT, rel))
    if not full.startswith(STATIC_ROOT) or not os.path.isfile(full):
        return build_http_response("404 Not Found", b"Not found")
    ctype, _ = mimetypes.guess_type(full)
    with open(full, "rb") as f:
        body = f.read()
    return build_http_response("200 OK", body, ctype or "application/octet-stream")


async def connection(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    try:
        request = await reader.readuntil(b"\r\n\r\n")
    except (asyncio.IncompleteReadError, asyncio.LimitOverrunError):
        writer.close()
        return

    text = request.decode("latin1")
    lines = text.split("\r\n")
    try:
        method, path, _ = lines[0].split(" ", 2)
    except ValueError:
        writer.close()
        return
    headers = {}
    for line in lines[1:]:
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k.strip().lower()] = v.strip()

    # WebSocket upgrade?
    if headers.get("upgrade", "").lower() == "websocket" and "sec-websocket-key" in headers:
        accept = ws_accept_key(headers["sec-websocket-key"])
        handshake = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            "Sec-WebSocket-Accept: %s\r\n\r\n" % accept
        )
        writer.write(handshake.encode("latin1"))
        await writer.drain()

        conn = Conn(reader, writer)
        GAME.conns[conn.id] = conn
        try:
            await handle_ws_messages(conn)
        except (asyncio.IncompleteReadError, ConnectionResetError):
            pass
        finally:
            await drop_conn(conn.id)
        return

    # Otherwise a plain HTTP GET for a static file.
    writer.write(serve_static(path))
    await writer.drain()
    writer.close()


def local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


# --------------------------------------------------------------------------- #
# Optional TLS: generate a self-signed cert so https pages can use wss://
# --------------------------------------------------------------------------- #
def generate_cert_with_cryptography():
    """Returns True if it created the cert files, False if cryptography missing."""
    try:
        import datetime
        import ipaddress
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
    except ImportError:
        return False

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, CERT_IP)])
    san = x509.SubjectAlternativeName([
        x509.IPAddress(ipaddress.ip_address(CERT_IP)),
        x509.DNSName("localhost"),
    ])
    now = datetime.datetime.utcnow()
    cert = (
        x509.CertificateBuilder()
        .subject_name(name).issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=3650))
        .add_extension(san, critical=False)
        .sign(key, hashes.SHA256())
    )
    with open(KEY_FILE, "wb") as f:
        f.write(key.private_bytes(serialization.Encoding.PEM,
                                  serialization.PrivateFormat.TraditionalOpenSSL,
                                  serialization.NoEncryption()))
    with open(CERT_FILE, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    return True


def generate_cert_with_openssl():
    """Returns True if an openssl on PATH produced the cert files."""
    import shutil
    import subprocess
    openssl = shutil.which("openssl")
    if not openssl:
        return False
    try:
        subprocess.run([
            openssl, "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", KEY_FILE, "-out", CERT_FILE, "-days", "3650",
            "-subj", "/CN=" + CERT_IP,
            "-addext", "subjectAltName=IP:%s,DNS:localhost" % CERT_IP,
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except Exception:
        return False


def ensure_cert():
    """Make sure cert.pem/key.pem exist; create them on first --https run."""
    if os.path.isfile(CERT_FILE) and os.path.isfile(KEY_FILE):
        return True
    print("  Creating a self-signed certificate for %s ..." % CERT_IP)
    if generate_cert_with_cryptography() or generate_cert_with_openssl():
        print("  Certificate created (cert.pem / key.pem).")
        return True
    print("\n" + "!" * 56)
    print("  Couldn't create a certificate automatically.")
    print("  Install one of these once, then run again:")
    print("     pip install cryptography")
    print("  ...or install OpenSSL so 'openssl' is on your PATH.")
    print("  (Or just skip --https and open the app from")
    print("   http://%s:%d instead.)" % (CERT_IP, PORT))
    print("!" * 56)
    return False


def make_ssl_context():
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(CERT_FILE, KEY_FILE)
    return ctx


async def main():
    ssl_ctx = None
    if USE_TLS:
        if not ensure_cert():
            wait_before_closing()
            sys.exit(1)
        ssl_ctx = make_ssl_context()

    server = await asyncio.start_server(connection, HOST, PORT, ssl=ssl_ctx)
    asyncio.ensure_future(broadcast_loop())
    ip = local_ip()
    scheme = "https" if USE_TLS else "http"
    print("=" * 56)
    print("  Bug Hunt server is running!  (%s)" % ("secure / wss" if USE_TLS else "plain / ws"))
    print("  On this computer:   %s://localhost:%d" % (scheme, PORT))
    print("  On other devices:   %s://%s:%d" % (scheme, ip, PORT))
    print("  (everyone must be on the same Wi-Fi / network)")
    if USE_TLS:
        print("  -")
        print("  First time on each device: open  %s://%s:%d" % (scheme, ip, PORT))
        print("  in the browser and ACCEPT the security warning (it's your")
        print("  own self-signed certificate) so the game is allowed to connect.")
    print("  Press Ctrl+C to stop.")
    print("=" * 56)
    async with server:
        await server.serve_forever()


def wait_before_closing():
    """Keep a double-clicked console window open so errors can be read."""
    try:
        if sys.stdin and sys.stdin.isatty():
            input("\nPress Enter to close this window...")
    except Exception:
        pass


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nServer stopped.")
    except OSError as e:
        # Port already taken: WinError/errno 10048 (Windows), 48 (mac), 98 (Linux).
        if getattr(e, "winerror", None) == 10048 or e.errno in (48, 98, 10048):
            print("\n" + "!" * 56)
            print("  Could not start: port %d is already in use." % PORT)
            print("  Another copy of the server is probably already running.")
            print("  Close it first (look for a python window), or change")
            print("  PORT near the top of server.py, then run this again.")
            print("!" * 56)
        else:
            print("\nCould not start the server:\n")
            traceback.print_exc()
        wait_before_closing()
        sys.exit(1)
    except Exception:
        print("\nThe server stopped because of an unexpected error:\n")
        traceback.print_exc()
        wait_before_closing()
        sys.exit(1)
