/* SimpleRain app shell: auto host/join, profile editing, host-owned game state. */

const APP_VERSION = "1.1.0";
const AUTO_CHANNEL = "simple-rain";
const GAME_SAVE_KEY = "simplerain-host-cache";
const MUSIC_MUTED_KEY = "simplerain-music-muted";
const LOBBY_PARAM = "lobby";
const LOBBY_SCAN_TIMEOUT_MS = 2600;
const PLAYER_HEARTBEAT_MS = 15000;
const HOST_WATCHDOG_MS = Math.max(45000, PLAYER_HEARTBEAT_MS * 3);
const CLIENT_WELCOME_TIMEOUT_MS = 10000;
const COLORS = ["#ff5d5d", "#ff9d4d", "#ffd24d", "#7CFC9B", "#33ddaa", "#4dd2ff", "#4d8bff", "#7766ff", "#c98cff", "#ff6fd0", "#22cc88", "#ff6600"];
const ICONS = ["🐸", "🐢", "🐟", "🦆", "🦋", "🐞", "🐝", "🦗", "🦎", "🐌", "🦀", "🦊", "🐰", "🦝", "🦉", "🐿️"];
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const FLOWER_LOBBIES = [
  { key: "lotus", name: "Lotus", icon: "🪷", color: "#f4a6cf" },
  { key: "iris", name: "Iris", icon: "💜", color: "#a993ff" },
  { key: "lily", name: "Lily", icon: "🌸", color: "#f7f0bd" },
  { key: "clover", name: "Clover", icon: "☘️", color: "#8ce8bc" },
  { key: "anemone", name: "Anemone", icon: "🌼", color: "#8ed8ff" },
  { key: "poppy", name: "Poppy", icon: "🌺", color: "#ff9a76" },
  { key: "aster", name: "Aster", icon: "🌷", color: "#d9a6ff" },
  { key: "orchid", name: "Orchid", icon: "🌻", color: "#94d78d" },
];

const $ = (sel) => document.querySelector(sel);
const screens = { loading: $("#screen-loading"), play: $("#screen-play") };
const canvas = $("#stage");
const ctx = canvas.getContext("2d");

let net = new PeerNet();
let activeGame = null;
let hostLoopTimer = null;
let hostWatchdogTimer = null;
let handoffTimer = null;
let clientWelcomeTimer = null;
let lastPlayersBroadcastAt = 0;
let lastHostMessageAt = 0;
let lastState = [];
let lastHostOrder = [];
let pendingGameState = null;
let migratingFromHostId = null;
let handoffInProgress = false;
let statusText = "Starting SimpleRain...";
let myColor = "";
let nameTimer = null;
let musicMuted = localStorage.getItem(MUSIC_MUTED_KEY) === "1";
let sessionChannel = initialLobbyChannel();
let showInviteAfterReady = false;
let inLobby = false;
let soloMode = false;
let lobbyScanToken = 0;

const players = new Map();
const peerMap = new Map();
const profiles = new Map();
let usedColors = new Set();

function normalizeLobbyChannel(value) {
  try {
    const url = new URL(String(value || ""));
    value = url.searchParams.get(LOBBY_PARAM) || value;
  } catch {}
  const text = String(value || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return text || AUTO_CHANNEL;
}

function initialLobbyChannel() {
  try {
    const params = new URLSearchParams(location.search);
    return normalizeLobbyChannel(params.get(LOBBY_PARAM) || "");
  } catch {
    return "";
  }
}

function flowerLobbyChannel(lobby) {
  return `${AUTO_CHANNEL}-${lobby.key}`;
}

function randomLobbyCode() {
  let code = "";
  for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

function inviteUrl() {
  const url = new URL(location.href);
  if (!sessionChannel || soloMode) url.searchParams.delete(LOBBY_PARAM);
  else url.searchParams.set(LOBBY_PARAM, sessionChannel);
  url.hash = "";
  return url.toString();
}

function updateLobbyUrl() {
  const url = new URL(location.href);
  if (!sessionChannel || soloMode) url.searchParams.delete(LOBBY_PARAM);
  else url.searchParams.set(LOBBY_PARAM, sessionChannel);
  history.replaceState(null, "", url.toString());
}

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

function displayIcon(icon) {
  return icon || "🐸";
}

function firstEmoji(value) {
  const text = String(value || "").trim();
  const match = text.match(/\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*/u);
  return match ? match[0] : "";
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

function getVisiblePlayers() {
  return soloMode || net.isHost ? [...players.values()] : lastState;
}

function renderPlayers() {
  const list = $("#player-list");
  if (!list) return;
  const visible = getVisiblePlayers();
  const hostId = soloMode || net.isHost ? MY_ID : lastHostOrder[0];
  list.innerHTML = "";
  for (const player of visible) {
    const li = document.createElement("li");
    const crown = player.id === hostId ? `<span class="host-crown" aria-hidden="true">♛</span>` : "";
    li.classList.toggle("host-player", player.id === hostId);
    li.innerHTML = `<span class="swatch" style="background:${player.color}">${crown}${esc(displayIcon(player.icon))}</span>${esc(player.name)}`;
    list.appendChild(li);
  }
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
    isHost: () => soloMode || net.isHost,
    getPlayers: () => getVisiblePlayers(),
    getProfile: (id) => profiles.get(id),
    isSpeaking: () => false,
    isMusicMuted: () => musicMuted,
    sendInput: (input) => {
      if (soloMode) activeGame?.onPeerInput?.(MY_ID, input);
      else net.send({ t: "game-input", input });
    },
    broadcastState: (state) => {
      if (soloMode) return;
      if (!net.isHost) return;
      saveCachedGameState(state);
      broadcastGameState(state);
    },
  };
}

function updateMusicButton() {
  const button = $("#btn-music");
  if (!button) return;
  button.classList.toggle("muted", musicMuted);
  button.textContent = musicMuted ? "Music Off" : "Music On";
  button.setAttribute("aria-label", musicMuted ? "Unmute music" : "Mute music");
  button.setAttribute("aria-pressed", String(musicMuted));
}

function toggleMusicMute() {
  musicMuted = !musicMuted;
  localStorage.setItem(MUSIC_MUTED_KEY, musicMuted ? "1" : "0");
  updateMusicButton();
  activeGame?.setMusicMuted?.(musicMuted);
}

function updateInvitePanel() {
  const url = inviteUrl();
  const invitePanel = document.querySelector(".invite-panel");
  invitePanel?.classList.toggle("hidden", soloMode);
  const code = $("#invite-code");
  if (code) code.textContent = sessionChannel || "solo";
  const link = $("#invite-link");
  if (link) link.value = url;
  const qr = $("#invite-qr");
  if (qr) qr.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&data=${encodeURIComponent(url)}`;
}

function updateLobbyControls() {
  const playing = inLobby || soloMode;
  $("#lobby-active-controls")?.classList.toggle("hidden", !playing);
  $("#lobby-left-controls")?.classList.toggle("hidden", playing);
  $("#home-lobby-controls")?.classList.toggle("hidden", false);
  const code = $("#input-lobby-code");
  if (code && !code.value) code.value = sessionChannel;
  const homeCode = $("#input-home-lobby-code");
  if (homeCode && !homeCode.value && sessionChannel) homeCode.value = sessionChannel;
}

function lobbyInfoPayload() {
  const visible = getVisiblePlayers();
  return {
    t: "lobby-info",
    channel: sessionChannel,
    name: FLOWER_LOBBIES.find((lobby) => flowerLobbyChannel(lobby) === sessionChannel)?.name || sessionChannel,
    hostName: profile.name,
    hostId: MY_ID,
    playerCount: visible.length || players.size || 1,
    players: visible.map((player) => ({ id: player.id, name: player.name, icon: player.icon, color: player.color })),
    isHost: net.isHost,
    version: APP_VERSION,
  };
}

function lobbyStatusText(info) {
  if (!info) return "Checking - available if empty";
  if (!info.active) return "Open - become host";
  const count = Number(info.playerCount || info.players?.length || 1);
  return `Active - ${count} ${count === 1 ? "player" : "players"}`;
}

function lobbyCardMeta(info) {
  if (info?.active) return lobbyInfoSummary(info);
  if (info) return "No host found. Tap to host this flower lobby.";
  return "Tap anytime. If no host answers, you become host.";
}

function renderFlowerLobbies(results = new Map()) {
  const list = $("#flower-lobby-list");
  if (!list) return;
  list.innerHTML = "";
  for (const lobby of FLOWER_LOBBIES) {
    const channel = flowerLobbyChannel(lobby);
    const info = results.get(channel);
    const button = document.createElement("button");
    button.className = "flower-lobby-card";
    button.type = "button";
    button.style.setProperty("--flower", lobby.color);
    button.dataset.channel = channel;
    button.innerHTML = `
      <span class="flower-art" aria-hidden="true">${esc(lobby.icon)}</span>
      <span class="flower-lobby-content">
        <span class="flower-lobby-name">${esc(lobby.name)}</span>
        <span class="flower-lobby-status">${esc(lobbyStatusText(info))}</span>
        <span class="flower-lobby-meta">${esc(lobbyCardMeta(info))}</span>
      </span>
    `;
    button.onclick = () => joinFlowerLobby(lobby);
    list.appendChild(button);
  }
}

function lobbyInfoSummary(info) {
  const names = (info.players || []).map((player) => player.name).filter(Boolean).slice(0, 3);
  if (names.length) return `Host: ${info.hostName || names[0]} · ${names.join(", ")}`;
  return info.hostName ? `Host: ${info.hostName}` : `Version ${info.version || "unknown"}`;
}

async function refreshFlowerLobbies() {
  const token = ++lobbyScanToken;
  const refresh = $("#btn-refresh-lobbies");
  refresh?.setAttribute("disabled", "disabled");
  setStatus("Checking flower lobbies...");
  const results = new Map();
  renderFlowerLobbies(results);
  for (const lobby of FLOWER_LOBBIES) {
    if (token !== lobbyScanToken) return;
    const channel = flowerLobbyChannel(lobby);
    const info = await net.probe(channel, LOBBY_SCAN_TIMEOUT_MS);
    if (token !== lobbyScanToken) return;
    results.set(channel, info);
    renderFlowerLobbies(results);
  }
  refresh?.removeAttribute("disabled");
  setStatus("Choose how to play.");
}

async function copyInviteLink() {
  const url = inviteUrl();
  try {
    await navigator.clipboard?.writeText(url);
  } catch {
    const input = $("#invite-link");
    input?.select?.();
    document.execCommand?.("copy");
  }
}

async function shareInviteLink() {
  const url = inviteUrl();
  const text = `Join my SimpleRain lobby: ${url}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: "SimpleRain lobby", text, url });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  location.href = `sms:?&body=${encodeURIComponent(text)}`;
}

function wireManageControls() {
  const reset = $("#btn-reset");
  if (reset) reset.onclick = resetGame;
  const music = $("#btn-music");
  if (music) music.onclick = toggleMusicMute;
  const leave = $("#btn-leave-lobby");
  if (leave) leave.onclick = leaveLobby;
  const copy = $("#btn-copy-invite");
  if (copy) copy.onclick = copyInviteLink;
  const share = $("#btn-share-invite");
  if (share) share.onclick = shareInviteLink;
  const host = $("#btn-host-lobby");
  if (host) host.onclick = hostNewLobby;
  const homeHost = $("#btn-home-host-lobby");
  if (homeHost) homeHost.onclick = hostNewLobby;
  const solo = $("#btn-play-solo");
  if (solo) solo.onclick = startSoloGame;
  const refresh = $("#btn-refresh-lobbies");
  if (refresh) refresh.onclick = refreshFlowerLobbies;
  const global = $("#btn-rejoin-global");
  if (global) global.onclick = rejoinGlobalLobby;
  const join = $("#btn-join-lobby");
  if (join) join.onclick = joinLobbyFromCode;
  const homeJoin = $("#btn-home-join-lobby");
  if (homeJoin) homeJoin.onclick = joinLobbyFromHomeCode;
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

function newLobbyChannel() {
  return randomLobbyCode().toLowerCase();
}

function startSoloGame() {
  stopHostLoop();
  stopHostWatchdog();
  clearHandoffTimer();
  clearClientWelcomeTimer();
  net.destroy();
  soloMode = true;
  inLobby = false;
  sessionChannel = "";
  players.clear();
  peerMap.clear();
  usedColors.clear();
  lastState = [];
  lastHostOrder = [];
  pendingGameState = null;
  addPlayer(MY_ID, profile.name, null, profile.icon, profile.color);
  lastState = [...players.values()];
  lastHostOrder = [MY_ID];
  updateLobbyUrl();
  updateLobbyControls();
  clearCachedGameState();
  startGame(null);
  renderPlayers();
  show("play");
  setStatus("Playing solo");
}

function leaveLobby() {
  if (!confirm("Leave this lobby? Other players will stay in the current lobby.")) return;
  stopHostLoop();
  stopHostWatchdog();
  clearHandoffTimer();
  clearClientWelcomeTimer();
  players.clear();
  peerMap.clear();
  usedColors.clear();
  lastState = [];
  lastHostOrder = [];
  lastPlayersBroadcastAt = 0;
  pendingGameState = null;
  migratingFromHostId = null;
  activeGame?.destroy?.();
  activeGame = null;
  net.destroy();
  inLobby = false;
  soloMode = false;
  sessionChannel = "";
  showInviteAfterReady = false;
  updateLobbyUrl();
  setStatus("Choose how to play.");
  show("loading");
  updateLobbyControls();
  closeProfileSheet();
}

function connectToLobby(channel, preferHost = false, openInviteWhenReady = false) {
  sessionChannel = normalizeLobbyChannel(channel);
  soloMode = false;
  inLobby = true;
  handoffInProgress = false;
  clearHandoffTimer();
  clearClientWelcomeTimer();
  stopHostWatchdog();
  showInviteAfterReady = openInviteWhenReady;
  updateLobbyUrl();
  updateInvitePanel();
  updateLobbyControls();
  show("loading");
  setStatus(preferHost ? "Hosting a new SimpleRain lobby..." : "Finding a SimpleRain session...");
  net.migrate(sessionChannel, preferHost);
}

function hostNewLobby() {
  clearCachedGameState();
  pendingGameState = null;
  activeGame?.destroy?.();
  activeGame = null;
  const channel = newLobbyChannel();
  const input = $("#input-home-lobby-code");
  if (input) input.value = channel.toUpperCase();
  connectToLobby(channel, true, true);
}

function rejoinGlobalLobby() {
  connectToLobby(AUTO_CHANNEL, false, false);
}

function joinFlowerLobby(lobby) {
  clearCachedGameState();
  pendingGameState = null;
  activeGame?.destroy?.();
  activeGame = null;
  connectToLobby(flowerLobbyChannel(lobby), false, false);
}

function joinLobbyFromCode() {
  const code = $("#input-lobby-code")?.value;
  connectToLobby(code || AUTO_CHANNEL, false, false);
}

function joinLobbyFromHomeCode() {
  const code = $("#input-home-lobby-code")?.value;
  connectToLobby(code || AUTO_CHANNEL, false, false);
}

function ensureGameStarted(initialState = null) {
  if (!activeGame) startGame(initialState);
  else if (initialState) activeGame.onState?.(initialState);
}

function resetGame() {
  if (!confirm("Reset the current SimpleRain game for everyone?")) return;
  closeProfileSheet();
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
  const color = $("#input-color");
  if (color) color.value = profile.color || myColor || COLORS[0];
  const icon = $("#input-icon");
  if (icon) icon.value = profile.icon;
  updateProfilePreview();
  updateMusicButton();
  updateInvitePanel();
  updateLobbyControls();
  wireManageControls();
  $("#sheet-profile")?.classList.add("open");
}

function closeProfileSheet() {
  $("#sheet-profile")?.classList.remove("open");
}

function updateProfilePreview() {
  const color = profile.color || myColor || COLORS[0];
  const dot = $("#preview-dot");
  if (dot) {
    dot.style.background = color;
    dot.textContent = displayIcon(profile.icon);
    dot.title = profile.icon;
  }
  const name = $("#preview-name");
  if (name) name.textContent = profile.name;
  const menuDot = $("#menu-profile-dot");
  if (menuDot) {
    menuDot.style.background = color;
    menuDot.textContent = displayIcon(profile.icon);
    menuDot.title = profile.name;
  }
  const homeDot = $("#home-profile-dot");
  if (homeDot) {
    homeDot.style.background = color;
    homeDot.textContent = displayIcon(profile.icon);
    homeDot.title = profile.name;
  }
}

function broadcastProfile() {
  if (soloMode) {
    const me = players.get(MY_ID);
    if (!me) return;
    usedColors.delete(me.color);
    me.name = profile.name;
    me.icon = profile.icon;
    if (profile.color) me.color = profile.color;
    usedColors.add(me.color);
    myColor = me.color;
    profiles.set(MY_ID, { name: me.name, color: me.color, icon: me.icon });
    activeGame?.onPlayerList?.();
    renderPlayers();
    return;
  }
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

function clearHandoffTimer() {
  clearTimeout(handoffTimer);
  handoffTimer = null;
}

function clearClientWelcomeTimer() {
  clearTimeout(clientWelcomeTimer);
  clientWelcomeTimer = null;
}

function markHostAlive() {
  lastHostMessageAt = Date.now();
}

function startHostWatchdog() {
  stopHostWatchdog();
  markHostAlive();
  hostWatchdogTimer = setInterval(() => {
    if (!inLobby || net.isHost || !lastHostMessageAt) return;
    if (Date.now() - lastHostMessageAt >= HOST_WATCHDOG_MS) beginHostHandoff("Host timed out. Rejoining...");
  }, 5000);
}

function stopHostWatchdog() {
  clearInterval(hostWatchdogTimer);
  hostWatchdogTimer = null;
  lastHostMessageAt = 0;
}

function beginHostHandoff(message) {
  if (handoffInProgress || !inLobby) return;
  handoffInProgress = true;
  clearClientWelcomeTimer();
  setStatus(message);
  migratingFromHostId = lastHostOrder[0] || null;
  pendingGameState = snapshotGame() || loadCachedGameState();
  const remainingOrder = migratingFromHostId ? lastHostOrder.filter((id) => id !== migratingFromHostId) : [MY_ID];
  const myIndex = remainingOrder.indexOf(MY_ID);
  const preferHost = myIndex === 0;
  const delay = myIndex < 0 ? 300 : myIndex * 700;
  stopHostLoop();
  stopHostWatchdog();
  clearHandoffTimer();
  handoffTimer = setTimeout(() => net.migrate(sessionChannel, preferHost), delay);
}

function startClientWelcomeTimer() {
  clearClientWelcomeTimer();
  clientWelcomeTimer = setTimeout(() => {
    if (net.isHost || handoffInProgress || lastState.some((player) => player.id === MY_ID)) return;
    beginHostHandoff("Host did not answer. Rejoining...");
  }, CLIENT_WELCOME_TIMEOUT_MS);
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
    if (soloMode) return;
    inLobby = true;
    handoffInProgress = false;
    clearHandoffTimer();
    clearClientWelcomeTimer();
    stopHostWatchdog();
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
    updateInvitePanel();
    updateLobbyControls();
    if (showInviteAfterReady) {
      showInviteAfterReady = false;
      openProfileSheet();
    }
  });

  net.on("connected", () => {
    if (soloMode) return;
    inLobby = true;
    handoffInProgress = false;
    clearHandoffTimer();
    clearClientWelcomeTimer();
    setStatus("Joining SimpleRain...");
    net.send({ t: "hello", id: MY_ID, name: profile.name, icon: profile.icon, preferredColor: profile.color });
    startHostWatchdog();
    startClientWelcomeTimer();
    updateInvitePanel();
    updateLobbyControls();
  });

  net.on("lobby-probe", ({ reply, close }) => {
    reply(lobbyInfoPayload());
    setTimeout(close, 60);
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
    if (soloMode) return;
    beginHostHandoff("Host left. Rejoining...");
  });

  net.on("message", ({ from, data }) => {
    if (from === "host") markHostAlive();
    if (net.isHost) handleHostMessage(from, data);
    else handleClientMessage(data);
  });

  net.on("error", (err) => {
    console.error(err);
    if (soloMode) return;
    if (!inLobby || handoffInProgress) return;
    setStatus("Connection issue. Retrying...");
    beginHostHandoff("Connection issue. Rejoining...");
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
    if (lastState.some((player) => player.id === MY_ID)) {
      clearClientWelcomeTimer();
      setStatus("Joined SimpleRain");
      ensureGameStarted(loadCachedGameState());
      show("play");
      updateLobbyControls();
    }
    renderPlayers();
  } else if (msg.t === "profile") {
    profiles.set(msg.id, { name: msg.name, color: msg.color, icon: msg.icon });
    if (msg.id === MY_ID) {
      myColor = msg.color;
      profile.color = msg.color;
      localStorage.setItem("simplerain-color", msg.color);
      updateProfilePreview();
      const color = $("#input-color");
      if (color) color.value = msg.color;
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

$("#btn-profile")?.addEventListener("click", openProfileSheet);
$("#btn-home-profile")?.addEventListener("click", openProfileSheet);
$("#btn-close-profile")?.addEventListener("click", closeProfileSheet);
$("#input-name")?.addEventListener("input", (event) => {
  profile.name = event.target.value.trim() || DEFAULT_NAME;
  localStorage.setItem("simplerain-name", profile.name);
  profiles.set(MY_ID, { ...profiles.get(MY_ID), name: profile.name });
  updateProfilePreview();
  clearTimeout(nameTimer);
  nameTimer = setTimeout(broadcastProfile, 350);
});
$("#input-color")?.addEventListener("input", (event) => {
  profile.color = event.target.value || COLORS[0];
  if (!inLobby) myColor = profile.color;
  localStorage.setItem("simplerain-color", profile.color);
  profiles.set(MY_ID, { ...profiles.get(MY_ID), color: profile.color });
  updateProfilePreview();
  broadcastProfile();
});
$("#input-icon")?.addEventListener("input", (event) => {
  const emoji = firstEmoji(event.target.value);
  if (!emoji) {
    event.target.value = "";
    return;
  }
  event.target.value = emoji;
  profile.icon = emoji;
  localStorage.setItem("simplerain-icon", emoji);
  profiles.set(MY_ID, { ...profiles.get(MY_ID), icon: emoji });
  updateProfilePreview();
  broadcastProfile();
});
$("#menu-version").textContent = `Version ${APP_VERSION}`;
updateProfilePreview();
updateMusicButton();
updateLobbyUrl();
updateInvitePanel();
updateLobbyControls();
wireManageControls();

wireNetEvents();
registerServiceWorker();
show("loading");
renderFlowerLobbies();
if (sessionChannel) {
  setStatus("Finding a SimpleRain session...");
  connectToLobby(sessionChannel, false, false);
} else {
  setStatus("Choose how to play.");
  refreshFlowerLobbies();
}
render();
