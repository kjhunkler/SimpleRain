/* SimpleRain app shell: auto host/join, profile editing, host-owned game state. */

const APP_VERSION = "1.0.1";
const AUTO_CHANNEL = "simple-rain";
const GAME_SAVE_KEY = "simplerain-host-cache";
const PLAYER_HEARTBEAT_MS = 15000;
const COLORS = ["#ff5d5d", "#ff9d4d", "#ffd24d", "#7CFC9B", "#33ddaa", "#4dd2ff", "#4d8bff", "#7766ff", "#c98cff", "#ff6fd0", "#22cc88", "#ff6600"];
const ICONS = ["Rain", "Frog", "Lotus", "Turtle", "Koi", "Duck", "Bug", "Sky", "Star", "Moon"];

const $ = (sel) => document.querySelector(sel);
const screens = { loading: $("#screen-loading"), play: $("#screen-play") };
const canvas = $("#stage");
const ctx = canvas.getContext("2d");

let net = new PeerNet();
let activeGame = null;
let hostLoopTimer = null;
let lastPlayersBroadcastAt = 0;
let lastState = [];
let lastHostOrder = [];
let pendingGameState = null;
let migratingFromHostId = null;
let statusText = "Starting SimpleRain...";
let myColor = "";
let nameTimer = null;

const players = new Map();
const peerMap = new Map();
const profiles = new Map();
let usedColors = new Set();

function clientId() {
  let id = localStorage.getItem("simplerain-client-id");
  if (!id) {
    id = "p-" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("simplerain-client-id", id);
  }
  return id;
}

function broadcastPlayers(force = false) {
  if (!net.isHost) return;
  const now = Date.now();
  if (!force && now - lastPlayersBroadcastAt < PLAYER_HEARTBEAT_MS) return;
  const state = [...players.values()];
  const hostOrder = [...players.keys()];
  lastState = state;
  lastHostOrder = hostOrder;
  lastPlayersBroadcastAt = now;
  net.broadcast({ t: "players", players: state, hostOrder });
  renderPlayers();
}

function randomIcon() {
  return ICONS[Math.floor(Math.random() * ICONS.length)];
}

function storedOrRandomIcon() {
  let icon = localStorage.getItem("simplerain-icon");
  if (!icon) {
    icon = randomIcon();
    localStorage.setItem("simplerain-icon", icon);
  }
  return icon;
}

const MY_ID = clientId();
const DEFAULT_NAME = "Player " + MY_ID.slice(2, 5).toUpperCase();
const profile = {
  name: localStorage.getItem("simplerain-name") || DEFAULT_NAME,
  icon: storedOrRandomIcon(),
  color: localStorage.getItem("simplerain-color") || "",
};
myColor = profile.color || COLORS[0];
profiles.set(MY_ID, { name: profile.name, icon: profile.icon, color: myColor });

function show(name) {
  for (const key in screens) screens[key].classList.toggle("active", key === name);
}

function setStatus(text) {
  statusText = text;
  const el = $("#connection-status");
  if (el) el.textContent = text;
}

function iconInitial(icon) {
  return String(icon || "Rain").slice(0, 1).toUpperCase();
}

function pickColor() {
  for (const color of COLORS) {
    if (!usedColors.has(color)) {
      usedColors.add(color);
      return color;
    }
  }
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

function addPlayer(id, name, peerId, icon, preferredColor) {
  if (players.has(id)) {
    if (peerId) peerMap.set(peerId, id);
    return players.get(id);
  }
  const color = preferredColor && !usedColors.has(preferredColor) ? preferredColor : pickColor();
  usedColors.add(color);
  const player = { id, name, color, icon: icon || randomIcon() };
  players.set(id, player);
  profiles.set(id, { name: player.name, color: player.color, icon: player.icon });
  if (peerId) peerMap.set(peerId, id);
  return player;
}

function currentHostId() {
  if (lastHostOrder[0]) return lastHostOrder[0];
  return net.isHost ? MY_ID : null;
}

function hostCrown(id) {
  return id && id === currentHostId() ? "Host " : "";
}

function getVisiblePlayers() {
  return net.isHost ? [...players.values()] : lastState;
}

function renderPlayers() {
  const list = $("#player-list");
  if (!list) return;
  const visible = getVisiblePlayers();
  list.innerHTML = "";
  for (const player of visible) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="swatch" style="background:${player.color}">${esc(iconInitial(player.icon))}</span>${hostCrown(player.id)}${esc(player.name)}`;
    list.appendChild(li);
  }
  $("#player-count").textContent = String(visible.length);
  $("#role-label").textContent = net.isHost ? "Hosting" : "Joined";
}

function loadCachedGameState() {
  try { return JSON.parse(localStorage.getItem(GAME_SAVE_KEY) || "null")?.state || null; } catch { return null; }
}

function saveCachedGameState(state) {
  if (!state) return;
  try { localStorage.setItem(GAME_SAVE_KEY, JSON.stringify({ savedAt: Date.now(), state })); } catch {}
}

function clearCachedGameState() {
  try { localStorage.removeItem(GAME_SAVE_KEY); } catch {}
}

function snapshotGame() {
  return activeGame?.getSnapshot ? activeGame.getSnapshot() : null;
}

function broadcastGameState(state, peerId = null) {
  if (!net.isHost || !state) return;
  const msg = { t: "game-state", state };
  if (peerId) net.sendTo(peerId, msg);
  else net.broadcast(msg);
}

function gameHostApi() {
  return {
    canvas,
    myId: MY_ID,
    isHost: () => net.isHost,
    getPlayers: () => getVisiblePlayers(),
    getProfile: (id) => profiles.get(id),
    isSpeaking: () => false,
    isCurrentHost: (id) => id && id === currentHostId(),
    hostCrown,
    sendInput: (input) => net.send({ t: "game-input", input }),
    broadcastState: (state) => {
      if (!net.isHost) return;
      saveCachedGameState(state);
      broadcastGameState(state);
    },
  };
}

function startGame(initialState = null) {
  activeGame?.destroy?.();
  activeGame = window.SimpleRainGame.create(gameHostApi(), initialState);
  activeGame.start?.();
  if (pendingGameState) {
    activeGame.onState?.(pendingGameState);
    pendingGameState = null;
  }
  if (net.isHost) {
    const state = snapshotGame();
    saveCachedGameState(state);
    broadcastGameState(state);
  }
}

function ensureGameStarted(initialState = null) {
  if (!activeGame) startGame(initialState);
  else if (initialState) activeGame.onState?.(initialState);
}

function resetGame() {
  if (!confirm("Reset the current SimpleRain game for everyone?")) return;
  clearCachedGameState();
  if (net.isHost) {
    activeGame?.restart?.();
    const state = snapshotGame();
    saveCachedGameState(state);
    broadcastGameState(state);
  } else {
    net.send({ t: "reset-game" });
  }
}

function openProfileSheet() {
  const input = $("#input-name");
  if (input) input.value = profile.name;
  buildColorPicker();
  buildIconPicker();
  updateProfilePreview();
  $("#sheet-profile")?.classList.add("open");
}

function closeProfileSheet() {
  $("#sheet-profile")?.classList.remove("open");
}

function updateProfilePreview() {
  const color = myColor || profile.color || COLORS[0];
  const dot = $("#preview-dot");
  if (dot) {
    dot.style.background = color;
    dot.textContent = iconInitial(profile.icon);
    dot.title = profile.icon;
  }
  const name = $("#preview-name");
  if (name) name.textContent = profile.name;
}

function buildColorPicker() {
  const grid = $("#picker-color");
  if (!grid) return;
  grid.innerHTML = "";
  for (const color of COLORS) {
    const btn = document.createElement("button");
    btn.className = "swatch-opt" + (color === (profile.color || myColor) ? " selected" : "");
    btn.style.background = color;
    btn.type = "button";
    btn.setAttribute("aria-label", color);
    btn.addEventListener("click", () => {
      profile.color = color;
      localStorage.setItem("simplerain-color", color);
      broadcastProfile();
      buildColorPicker();
      updateProfilePreview();
    });
    grid.appendChild(btn);
  }
}

function buildIconPicker() {
  const grid = $("#picker-icon");
  if (!grid) return;
  grid.innerHTML = "";
  for (const icon of ICONS) {
    const btn = document.createElement("button");
    btn.className = "icon-opt" + (icon === profile.icon ? " selected" : "");
    btn.type = "button";
    btn.textContent = iconInitial(icon);
    btn.title = icon;
    btn.setAttribute("aria-label", icon);
    btn.addEventListener("click", () => {
      profile.icon = icon;
      localStorage.setItem("simplerain-icon", icon);
      profiles.set(MY_ID, { ...profiles.get(MY_ID), icon });
      broadcastProfile();
      buildIconPicker();
      updateProfilePreview();
    });
    grid.appendChild(btn);
  }
}

function broadcastProfile() {
  if (net.isHost) {
    const me = players.get(MY_ID);
    if (!me) return;
    usedColors.delete(me.color);
    me.name = profile.name;
    me.icon = profile.icon;
    if (profile.color && (!usedColors.has(profile.color) || me.color === profile.color)) me.color = profile.color;
    usedColors.add(me.color);
    myColor = me.color;
    profiles.set(MY_ID, { name: me.name, color: me.color, icon: me.icon });
    net.broadcast({ t: "profile", id: MY_ID, name: me.name, color: me.color, icon: me.icon });
    broadcastPlayers(true);
    activeGame?.onPlayerList?.();
    renderPlayers();
  } else {
    net.send({ t: "profile", name: profile.name, icon: profile.icon, preferredColor: profile.color });
  }
}

function handleGameInput(id, input) {
  if (!net.isHost || !activeGame) return;
  activeGame.onPeerInput?.(id, input);
}

function handleGameState(state) {
  if (!activeGame) pendingGameState = state;
  else activeGame.onState?.(state);
  saveCachedGameState(state);
}

function startHostLoop() {
  clearInterval(hostLoopTimer);
  hostLoopTimer = setInterval(() => {
    broadcastPlayers(false);
  }, PLAYER_HEARTBEAT_MS);
}

function stopHostLoop() {
  clearInterval(hostLoopTimer);
  hostLoopTimer = null;
}

function queueStateForPeer(peerId) {
  let attempts = 0;
  const send = () => {
    const state = snapshotGame();
    if (state) broadcastGameState(state, peerId);
    else if (attempts++ < 10) setTimeout(send, 250);
  };
  setTimeout(send, 0);
}

function wireNetEvents() {
  net.on("ready", () => {
    setStatus("Hosting SimpleRain");
    players.clear();
    peerMap.clear();
    usedColors.clear();
    if (lastState.length) {
      for (const player of lastState) {
        if (player.id === migratingFromHostId) continue;
        players.set(player.id, player);
        usedColors.add(player.color);
        profiles.set(player.id, { name: player.name, color: player.color, icon: player.icon });
      }
    }
    addPlayer(MY_ID, profile.name, null, profile.icon, profile.color);
    migratingFromHostId = null;
    lastState = [...players.values()];
    lastHostOrder = [...players.keys()];
    startHostLoop();
    ensureGameStarted(pendingGameState || loadCachedGameState());
    renderPlayers();
    show("play");
  });

  net.on("connected", () => {
    setStatus("Joined SimpleRain");
    net.send({ t: "hello", id: MY_ID, name: profile.name, icon: profile.icon, preferredColor: profile.color });
    ensureGameStarted(loadCachedGameState());
    show("play");
  });

  net.on("peer-join", () => renderPlayers());

  net.on("peer-leave", (peerId) => {
    const id = peerMap.get(peerId);
    const player = id && players.get(id);
    if (player) usedColors.delete(player.color);
    if (id) players.delete(id);
    peerMap.delete(peerId);
    activeGame?.onPlayerList?.();
    const state = snapshotGame();
    if (state) {
      saveCachedGameState(state);
      broadcastGameState(state);
    }
    broadcastPlayers(true);
    renderPlayers();
  });

  net.on("host-closed", () => {
    setStatus("Host left. Rejoining...");
    migratingFromHostId = lastHostOrder[0] || null;
    pendingGameState = snapshotGame() || loadCachedGameState();
    const remainingOrder = migratingFromHostId ? lastHostOrder.filter((id) => id !== migratingFromHostId) : [MY_ID];
    const myIndex = remainingOrder.indexOf(MY_ID);
    const preferHost = myIndex === 0;
    const delay = myIndex < 0 ? 300 : myIndex * 700;
    stopHostLoop();
    setTimeout(() => net.migrate(AUTO_CHANNEL, preferHost), delay);
  });

  net.on("message", ({ from, data }) => {
    if (net.isHost) handleHostMessage(from, data);
    else handleClientMessage(data);
  });

  net.on("error", (err) => {
    console.error(err);
    setStatus("Connection issue. Retrying...");
    setTimeout(() => net.migrate(AUTO_CHANNEL, false), 1200);
  });
}

function handleHostMessage(peerId, msg) {
  if (msg.t === "hello") {
    const player = addPlayer(msg.id, msg.name, peerId, msg.icon, msg.preferredColor);
    net.sendTo(peerId, { t: "welcome", color: player.color });
    net.sendTo(peerId, { t: "players", players: [...players.values()], hostOrder: [...players.keys()] });
    queueStateForPeer(peerId);
    activeGame?.onPlayerList?.();
    broadcastPlayers(true);
    renderPlayers();
  } else if (msg.t === "game-input") {
    const id = peerMap.get(peerId);
    if (id) handleGameInput(id, msg.input);
  } else if (msg.t === "profile") {
    const id = peerMap.get(peerId);
    const player = id && players.get(id);
    if (!player) return;
    usedColors.delete(player.color);
    player.name = msg.name || player.name;
    player.icon = msg.icon || player.icon;
    if (msg.preferredColor && !usedColors.has(msg.preferredColor)) player.color = msg.preferredColor;
    usedColors.add(player.color);
    profiles.set(id, { name: player.name, color: player.color, icon: player.icon });
    net.sendTo(peerId, { t: "profile", id, name: player.name, color: player.color, icon: player.icon });
    net.broadcast({ t: "profile", id, name: player.name, color: player.color, icon: player.icon });
    broadcastPlayers(true);
    activeGame?.onPlayerList?.();
    renderPlayers();
  } else if (msg.t === "reset-game") {
    clearCachedGameState();
    activeGame?.restart?.();
    const state = snapshotGame();
    saveCachedGameState(state);
    broadcastGameState(state);
  }
}

function handleClientMessage(msg) {
  if (msg.t === "welcome") {
    myColor = msg.color;
    profile.color = msg.color;
    profiles.set(MY_ID, { ...profiles.get(MY_ID), color: myColor });
    updateProfilePreview();
  } else if (msg.t === "players") {
    lastState = msg.players || [];
    lastHostOrder = msg.hostOrder || [];
    for (const player of lastState) profiles.set(player.id, { name: player.name, color: player.color, icon: player.icon });
    renderPlayers();
  } else if (msg.t === "profile") {
    profiles.set(msg.id, { name: msg.name, color: msg.color, icon: msg.icon });
    if (msg.id === MY_ID) {
      myColor = msg.color;
      profile.color = msg.color;
      localStorage.setItem("simplerain-color", msg.color);
      updateProfilePreview();
      buildColorPicker();
    }
    const player = lastState.find((p) => p.id === msg.id);
    if (player) {
      player.name = msg.name;
      player.color = msg.color;
      player.icon = msg.icon;
    }
    renderPlayers();
  } else if (msg.t === "game-state") {
    handleGameState(msg.state);
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) worker.postMessage({ type: "SKIP_WAITING" });
      });
    });
  } catch (error) {
    console.warn("Service worker unavailable", error);
  }
}

navigator.serviceWorker?.addEventListener("controllerchange", () => location.reload());

function syncCanvasSize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return rect;
}

function drawLoadingFrame() {
  const rect = syncCanvasSize();
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (activeGame) return;
  ctx.fillStyle = "#12121f";
  ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = "#eef0ff";
  ctx.font = "700 18px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(statusText, rect.width / 2, rect.height / 2);
}

function render() {
  drawLoadingFrame();
  requestAnimationFrame(render);
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

$("#btn-reset")?.addEventListener("click", resetGame);
$("#btn-profile")?.addEventListener("click", openProfileSheet);
$("#btn-close-profile")?.addEventListener("click", closeProfileSheet);
$("#input-name")?.addEventListener("input", (event) => {
  profile.name = event.target.value.trim() || DEFAULT_NAME;
  localStorage.setItem("simplerain-name", profile.name);
  profiles.set(MY_ID, { ...profiles.get(MY_ID), name: profile.name });
  updateProfilePreview();
  clearTimeout(nameTimer);
  nameTimer = setTimeout(broadcastProfile, 350);
});
$("#menu-version").textContent = `Version ${APP_VERSION}`;

wireNetEvents();
registerServiceWorker();
show("loading");
setStatus("Finding a SimpleRain session...");
net.auto(AUTO_CHANNEL);
render();
