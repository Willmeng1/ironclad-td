import express from "express";
import http from "node:http";
import crypto from "node:crypto";
import { Server } from "socket.io";
import { createAccountStore, hashPassword, verifyPassword } from "./account-store.js";
import { createSimulation, towerDefinition } from "./server-simulation.js";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { perMessageDeflate: { threshold: 1024 } });
let accounts;
try {
  accounts = await createAccountStore();
  console.log(`Account storage: ${accounts.mode}`);
  if (!process.env.DATABASE_URL) console.warn("DATABASE_URL is not set. Local account files are not durable on Render.");
} catch (error) {
  console.error("Account database could not be initialized. Check DATABASE_URL and database access.");
  // Only print recognized error codes: database errors can contain credentials.
  const hints = {
    ERR_INVALID_URL: "DATABASE_URL is not a valid connection URL.",
    "28P01": "Database authentication failed. Check the database password and session-pooler username.",
    "28000": "Database authentication was rejected. Check the session-pooler connection details.",
    "3D000": "The database name in DATABASE_URL was not found.",
    "42501": "The database user lacks permission to create the account tables.",
    ENOTFOUND: "Database hostname could not be found. Check the session-pooler address.",
    EAI_AGAIN: "Database hostname lookup failed temporarily.",
    ECONNREFUSED: "The database refused the connection. Check the pooler host and port.",
    ECONNRESET: "The database connection was interrupted.",
    ETIMEDOUT: "The database connection timed out.",
    SELF_SIGNED_CERT_IN_CHAIN: "The database TLS certificate chain could not be verified.",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "The database TLS certificate could not be verified.",
    ERR_TLS_CERT_ALTNAME_INVALID: "The database TLS certificate does not match the host.",
  };
  const code = Object.hasOwn(hints, error?.code) ? error.code : "UNKNOWN";
  console.error(`Database error code: ${code}. ${hints[code] || "Check the database settings and connection."}`);
  process.exit(1);
}
const sessions = new Map();
const rooms = new Map();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(process.cwd(), { extensions: ["html"] }));

const freshSave = (username) => ({ username, level: 1, xp: 0, gems: 0, metaCoins: 0, unlockedLevel: 1, towerLevels: {}, equipped: ["dart", "ice", "spark", "sniper", "venom"], discoveredMobs: [], daily: {} });
const tokenFor = (username) => { const token = crypto.randomBytes(24).toString("hex"); sessions.set(token, username); return token; };
const authUser = (req) => sessions.get((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));

app.post("/api/auth/signup", async (req, res) => {
  const username = String(req.body?.username || "").trim(); const password = String(req.body?.password || "");
  if (username.length < 3 || password.length < 4) return res.status(400).json({ error: "Username or password is too short." });
  const save = { ...freshSave(username), ...(req.body?.saveData || {}), username, gems: 0, metaCoins: 0 };
  const key = username.toLowerCase();
  try {
    if (!await accounts.create(key, { credential: hashPassword(password), save })) return res.status(409).json({ error: "That username is already taken." });
  } catch { console.error("Account creation failed."); return res.status(503).json({ error: "Could not save your account. Please try again." }); }
  res.json({ username, token: tokenFor(username.toLowerCase()), saveData: save });
});
app.post("/api/auth/login", async (req, res) => {
  const key = String(req.body?.username || "").trim().toLowerCase();
  let user;
  try { user = await accounts.get(key); }
  catch { console.error("Account lookup failed."); return res.status(503).json({ error: "Account storage is temporarily unavailable." }); }
  if (!user || !verifyPassword(String(req.body?.password || ""), user.credential)) return res.status(401).json({ error: "Incorrect username or password." });
  res.json({ username: user.save.username, token: tokenFor(key), saveData: user.save });
});
app.get("/api/auth/me", async (req, res) => {
  const key = authUser(req);
  if (!key) return res.status(401).json({ error: "Not signed in." });
  try {
    const user = await accounts.get(key);
    if (!user) return res.status(401).json({ error: "Not signed in." });
    res.json({ username: user.save.username, saveData: user.save });
  } catch { console.error("Account lookup failed."); res.status(503).json({ error: "Account storage is temporarily unavailable." }); }
});
app.post("/api/auth/save", async (req, res) => {
  const key = authUser(req);
  if (!key) return res.status(401).json({ error: "Not signed in." });
  let user;
  try { user = await accounts.save(key, req.body?.saveData || req.body?.save || req.body || {}); }
  catch { console.error("Progress save failed."); return res.status(503).json({ error: "Could not save your progress. Please try again." }); }
  if (!user) return res.status(401).json({ error: "Not signed in." });
  res.json({ username: user.save.username, saveData: user.save });
});
app.post("/api/auth/heartbeat", (req, res) => res.json({ ok: Boolean(authUser(req)) }));

const newToken = () => crypto.randomBytes(32).toString("hex");
const RECONNECT_MS = 30000;
const TOWER_IDS = new Set(["dart", "ice", "spark", "sniper", "venom", "bank", "tesla", "ember", "haste", "power", "barracks", "void", "ranger", "rail", "orbital"]);
const profileFor = (socket, profile = {}) => ({
  id: socket.id,
  name: String(profile.username || "Player").trim().slice(0, 32) || "Player",
  loadout: Array.isArray(profile.loadout) ? [...new Set(profile.loadout.filter((id) => TOWER_IDS.has(id)))].slice(0, 5) : [],
  highestStage: Math.min(15, Math.max(1, Math.floor(Number(profile.highestStage) || 1))),
  connected: true,
  reconnectToken: newToken(),
  towerLevels: Object.fromEntries(Object.entries(profile.towerLevels || {}).filter(([id]) => TOWER_IDS.has(id)).map(([id, level]) => [id, Math.max(1, Math.min(10, Math.floor(Number(level) || 1)))])),
});
function snapshot(room) {
  return { code: room.code, hostId: room.hostId, maxStage: Math.min(...[...room.players.values()].map((player) => player.highestStage)), players: [...room.players.values()].map(({ reconnectToken, timer, coins, ...player }) => player) };
}
function currentRoom(socket) { return rooms.get(socket.data.roomCode); }
function sendRoom(room) { io.to(room.code).emit("room:update", snapshot(room)); }
function connectedPlayers(room) { return [...room.players.values()].filter((player) => player.connected); }
function removePlayer(room, id) {
  const player = room.players.get(id);
  if (!player) return;
  clearTimeout(player.timer);
  room.players.delete(id);
  io.to(room.code).emit("player:left", { id });
  if (!room.players.size) { rooms.delete(room.code); return; }
  if (room.hostId === id) {
    room.hostId = connectedPlayers(room)[0]?.id || room.players.keys().next().value;
    io.to(room.code).emit("host:changed", { hostId: room.hostId, message: "A new host has been selected." });
  }
  sendRoom(room);
}

io.on("connection", (socket) => {
  socket.on("room:create", (profile = {}) => {
    if (currentRoom(socket)) return socket.emit("room:error", "Leave your current room first.");
    let code; do { code = crypto.randomBytes(4).toString("hex").slice(0, 5).toUpperCase(); } while (rooms.has(code));
    const player = profileFor(socket, profile);
    const room = { code, hostId: socket.id, players: new Map([[socket.id, player]]), game: null };
    rooms.set(code, room); socket.join(code); socket.data.roomCode = code;
    socket.emit("room:created", snapshot(room), player.reconnectToken);
    sendRoom(room);
  });
  socket.on("room:join", (profile = {}) => {
    if (currentRoom(socket)) return socket.emit("room:error", "Leave your current room first.");
    const room = rooms.get(String(profile.code || "").toUpperCase());
    if (!room) return socket.emit("room:error", "Room not found.");
    if (room.game) return socket.emit("room:error", "This match has already started.");
    if (room.players.size >= 4) return socket.emit("room:error", "This room is full.");
    const player = profileFor(socket, profile);
    room.players.set(socket.id, player); socket.join(room.code); socket.data.roomCode = room.code;
    socket.emit("room:joined", snapshot(room), player.reconnectToken); sendRoom(room);
  });
  socket.on("room:reconnect", ({ code, playerId, reconnectToken } = {}) => {
    const room = rooms.get(String(code || "").toUpperCase());
    const player = room?.players.get(playerId);
    if (!player || player.connected || !reconnectToken || player.reconnectToken !== reconnectToken) return socket.emit("room:reconnectFailed", "Could not rejoin the room. Please create or join a new room.");
    clearTimeout(player.timer); room.players.delete(playerId); player.id = socket.id; player.connected = true; player.reconnectToken = newToken(); room.players.set(socket.id, player);
    if (room.hostId === playerId) room.hostId = socket.id;
    if (room.game) {
      room.game.towers.forEach((tower) => { if (tower.ownerId === playerId) tower.ownerId = socket.id; });
      room.game.simulation.state.placed.forEach((tower) => { if (tower.ownerId === playerId) tower.ownerId = socket.id; });
      room.game.simulation.state.mobs.forEach((mob) => {
        if (mob.dotOwnerId === playerId) mob.dotOwnerId = socket.id;
        if (mob.killOwnerId === playerId) mob.killOwnerId = socket.id;
      });
    }
    socket.join(room.code); socket.data.roomCode = room.code;
    socket.emit("room:reconnected", { oldPlayerId: playerId, newPlayerId: socket.id, room: snapshot(room), game: room.game, coins: player.coins, discoveries: room.game ? [...room.game.discoveries.values()] : [], reconnectToken: player.reconnectToken });
    socket.to(room.code).emit("player:reconnected", { oldPlayerId: playerId, newPlayerId: socket.id });
    sendRoom(room);
  });
  socket.on("room:startStage", ({ stageId } = {}) => {
    const room = currentRoom(socket); stageId = Number(stageId);
    if (!room || room.hostId !== socket.id || room.game || !Number.isInteger(stageId) || stageId < 1 || stageId > snapshot(room).maxStage) return socket.emit("room:error", "The host must choose an available stage.");
    const hostLevels = room.players.get(socket.id).towerLevels;
    room.game = { stageId, simOwnerId: "server", towers: [], wave: 0, waveRunning: false, pendingWaveAt: 0, lastSnapshot: null };
    const events = [];
    const simulation = createSimulation(stageId, {
      playerCount: room.players.size,
      playerMeta: (_ownerId, towerId) => hostLevels[towerId] || 1,
      emit: (name, data) => events.push({ name, data }),
    });
    room.players.forEach((player) => { player.coins = simulation.state.currentLevel.startCoins; });
    Object.defineProperties(room.game, {
      simulation: { value: simulation },
      events: { value: events },
      discoveries: { value: new Map() },
      lastTick: { value: performance.now(), writable: true },
      nextSnapshot: { value: 0, writable: true },
    });
    room.game.lastSnapshot = simulation.snapshot();
    io.to(room.code).emit("game:start", room.game);
  });
  socket.on("tower:place", ({ type, x, y } = {}) => {
    const room = currentRoom(socket); const player = room?.players.get(socket.id);
    const definition = towerDefinition(type);
    if (!room?.game || !definition || !player?.loadout.includes(type) || player.coins < definition.cost || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1000 || y < 0 || y > 650 || room.game.towers.filter((tower) => tower.ownerId === socket.id).length >= 15 || room.game.towers.some((tower) => Math.hypot(tower.x - x, tower.y - y) < 38)) return;
    player.coins -= definition.cost;
    const tower = { uid: crypto.randomUUID(), type, x, y, level: 1, ownerId: socket.id };
    room.game.towers.push(tower);
    room.game.simulation.placeTower(tower);
    io.to(room.code).emit("tower:placed", tower);
  });
  socket.on("tower:upgrade", ({ uid } = {}) => {
    const room = currentRoom(socket); const tower = room?.game?.towers.find((item) => item.uid === uid && item.ownerId === socket.id);
    if (!tower || tower.level >= 5) return;
    const player = room.players.get(socket.id);
    const definition = towerDefinition(tower.type);
    const baseCost = definition.cost * (1.05 + tower.level * 0.9);
    const cost = Math.floor(tower.type === "barracks" ? baseCost * 0.84 : tower.type === "bank" ? baseCost * 1.22 : baseCost);
    if (player.coins < cost) return;
    player.coins -= cost;
    tower.level += 1;
    const simulated = room.game.simulation.state.placed.find((item) => item.uid === uid);
    if (simulated) simulated.level = tower.level;
    io.to(room.code).emit("tower:upgraded", { uid });
  });
  socket.on("tower:sell", ({ uid } = {}) => {
    const room = currentRoom(socket); const tower = room?.game?.towers.find((item) => item.uid === uid && item.ownerId === socket.id);
    if (!tower) return;
    room.players.get(socket.id).coins += Math.floor(towerDefinition(tower.type).cost * (0.48 + tower.level * 0.2));
    room.game.towers = room.game.towers.filter((item) => item !== tower); io.to(room.code).emit("tower:sold", { uid });
    const simulated = room.game.simulation.state.placed.find((item) => item.uid === uid);
    room.game.simulation.state.placed = room.game.simulation.state.placed.filter((item) => item !== simulated);
    room.game.simulation.state.soldiers = room.game.simulation.state.soldiers.filter((soldier) => soldier.owner !== simulated);
  });
  socket.on("wave:start", () => {
    const room = currentRoom(socket); if (!room?.game || room.game.waveRunning || room.game.simulation.state.ended || room.game.wave >= room.game.simulation.state.currentLevel.waves) return;
    room.game.waveRunning = true; room.game.wave += 1;
    room.game.pendingWaveAt = Date.now() + 800;
    io.to(room.code).emit("wave:start", { wave: room.game.wave, startsAt: room.game.pendingWaveAt });
  });
  socket.on("room:leave", () => { const room = currentRoom(socket); if (!room) return; socket.leave(room.code); socket.data.roomCode = null; removePlayer(room, socket.id); });
  socket.on("disconnect", () => {
    const room = currentRoom(socket); const player = room?.players.get(socket.id); if (!player) return;
    player.connected = false;
    player.timer = setTimeout(() => removePlayer(room, player.id), RECONNECT_MS);
    sendRoom(room);
  });
});

setInterval(() => {
  const now = performance.now();
  for (const room of rooms.values()) {
    const game = room.game;
    if (!game?.simulation) continue;
    let elapsed = Math.min(0.25, Math.max(0, (now - game.lastTick) / 1000));
    game.lastTick = now;
    if (game.pendingWaveAt && Date.now() >= game.pendingWaveAt) {
      game.pendingWaveAt = 0;
      game.simulation.state.playerCount = room.players.size;
      game.simulation.startWave();
      if (game.simulation.state.wave === game.simulation.state.currentLevel.waves) {
        const boss = game.simulation.state.spawns.find((spawn) => spawn.boss);
        if (boss) {
          const message = game.simulation.state.currentLevel.paths.length > 1
            ? `${boss.bossName} is coming - Lane ${boss.pathIndex + 1}`
            : `${boss.bossName} is coming`;
          io.to(room.code).emit("room:notice", { message, kind: "boss" });
        }
      }
    }
    while (elapsed > 0) {
      const dt = Math.min(0.05, elapsed);
      game.simulation.step(dt);
      elapsed -= dt;
    }
    if (now >= game.nextSnapshot || game.events.length) {
      game.lastSnapshot = game.simulation.snapshot();
      game.nextSnapshot = now + 40;
      io.to(room.code).emit("mobs:sync", game.lastSnapshot);
    }
    for (const event of game.events.splice(0)) {
      if (event.name === "kill") {
        if (event.data.ownerId && room.players.has(event.data.ownerId)) {
          room.players.get(event.data.ownerId).coins += event.data.amount;
          io.to(event.data.ownerId).emit("coins:reward", { amount: event.data.amount, kind: "kill" });
        }
        const discovery = { boss: event.data.mob.boss, bossName: event.data.mob.bossName, monsterName: event.data.mob.monsterName };
        const discoveryKey = discovery.boss ? discovery.bossName : discovery.monsterName;
        if (discoveryKey && !game.discoveries.has(discoveryKey)) {
          game.discoveries.set(discoveryKey, discovery);
          io.to(room.code).emit("mob:discovered", discovery);
        }
      } else if (event.name === "income") {
        if (event.data.ownerId && room.players.has(event.data.ownerId)) {
          room.players.get(event.data.ownerId).coins += event.data.amount;
          io.to(event.data.ownerId).emit("coins:reward", { amount: event.data.amount, kind: "income" });
        }
      } else if (event.name === "waveEnd") {
        game.waveRunning = false;
        room.players.forEach((player) => { player.coins += event.data.bonus; });
        io.to(room.code).emit("wave:ended", { wave: event.data.wave });
        io.to(room.code).emit("coins:reward", { amount: event.data.bonus, kind: "waveBonus" });
      } else if (event.name === "result") {
        io.to(room.code).emit("game:result", event.data);
        io.to(room.code).emit("room:closed", event.data);
        for (const player of room.players.values()) {
          clearTimeout(player.timer);
          const peer = io.sockets.sockets.get(player.id);
          if (peer) { peer.data.roomCode = null; peer.leave(room.code); }
        }
        rooms.delete(room.code);
      }
    }
  }
}, 20).unref();


const port = Number(process.env.PORT || 3002);
server.listen(port, "0.0.0.0", () => console.log(`Server is running on port ${port}`));

export { server, rooms };
