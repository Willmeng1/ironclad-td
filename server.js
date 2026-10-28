import express from "express";
import http from "node:http";
import crypto from "node:crypto";
import { Server } from "socket.io";
import { loadAccounts, persistAccounts, hashPassword, verifyPassword } from "./account-store.js";

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const users = loadAccounts();
const sessions = new Map();
const rooms = new Map();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(process.cwd(), { extensions: ["html"] }));

const freshSave = (username) => ({ username, level: 1, xp: 0, gems: 35, metaCoins: 0, unlockedLevel: 1, towerLevels: {}, equipped: ["dart", "ice", "spark", "sniper", "venom"], discoveredMobs: [], daily: {} });
const tokenFor = (username) => { const token = crypto.randomBytes(24).toString("hex"); sessions.set(token, username); return token; };
const authUser = (req) => sessions.get((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));

app.post("/api/auth/signup", (req, res) => {
  const username = String(req.body?.username || "").trim(); const password = String(req.body?.password || "");
  if (username.length < 3 || password.length < 4) return res.status(400).json({ error: "Username or password is too short." });
  if (users.has(username.toLowerCase())) return res.status(409).json({ error: "That username is already taken." });
  const save = { ...freshSave(username), ...(req.body?.saveData || {}), username };
  const key = username.toLowerCase();
  users.set(key, { credential: hashPassword(password), save });
  try { persistAccounts(users); }
  catch (error) { users.delete(key); console.error("Account save failed:", error); return res.status(500).json({ error: "Could not save your account. Please try again." }); }
  res.json({ username, token: tokenFor(username.toLowerCase()), saveData: save });
});
app.post("/api/auth/login", (req, res) => {
  const key = String(req.body?.username || "").trim().toLowerCase(); const user = users.get(key);
  if (!user || !verifyPassword(String(req.body?.password || ""), user.credential)) return res.status(401).json({ error: "Incorrect username or password." });
  res.json({ username: user.save.username, token: tokenFor(key), saveData: user.save });
});
app.get("/api/auth/me", (req, res) => { const key = authUser(req); const user = users.get(key); if (!user) return res.status(401).json({ error: "Not signed in." }); res.json({ username: user.save.username, saveData: user.save }); });
app.post("/api/auth/save", (req, res) => {
  const key = authUser(req); const user = users.get(key);
  if (!user) return res.status(401).json({ error: "Not signed in." });
  const previous = user.save;
  user.save = { ...previous, ...(req.body?.saveData || req.body?.save || req.body || {}), username: previous.username };
  try { persistAccounts(users); }
  catch (error) { user.save = previous; console.error("Progress save failed:", error); return res.status(500).json({ error: "Could not save your progress. Please try again." }); }
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
});
function snapshot(room) {
  return { code: room.code, hostId: room.hostId, maxStage: Math.min(...[...room.players.values()].map((player) => player.highestStage)), players: [...room.players.values()].map(({ reconnectToken, timer, ...player }) => player) };
}
function currentRoom(socket) { return rooms.get(socket.data.roomCode); }
function sendRoom(room) { io.to(room.code).emit("room:update", snapshot(room)); }
function connectedPlayers(room) { return [...room.players.values()].filter((player) => player.connected); }
function removePlayer(room, id) {
  const player = room.players.get(id);
  if (!player) return;
  clearTimeout(player.timer);
  room.players.delete(id);
  const towerIds = room.game?.towers.filter((tower) => tower.ownerId === id).map((tower) => tower.uid) || [];
  if (room.game) room.game.towers = room.game.towers.filter((tower) => tower.ownerId !== id);
  io.to(room.code).emit("towers:remove", { ownerId: id, towerIds });
  io.to(room.code).emit("player:left", { id });
  if (!room.players.size) { rooms.delete(room.code); return; }
  if (room.hostId === id) {
    room.hostId = connectedPlayers(room)[0]?.id || room.players.keys().next().value;
    io.to(room.code).emit("host:changed", { hostId: room.hostId, message: "A new host has been selected." });
  }
  if (room.game?.simOwnerId === id) {
    room.game.simOwnerId = connectedPlayers(room)[0]?.id || null;
    io.to(room.code).emit("sim:changed", { simOwnerId: room.game.simOwnerId });
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
      if (!room.game.simOwnerId) room.game.simOwnerId = socket.id;
    }
    socket.join(room.code); socket.data.roomCode = room.code;
    socket.emit("room:reconnected", { oldPlayerId: playerId, newPlayerId: socket.id, room: snapshot(room), game: room.game, reconnectToken: player.reconnectToken });
    socket.to(room.code).emit("player:reconnected", { oldPlayerId: playerId, newPlayerId: socket.id });
    sendRoom(room);
  });
  socket.on("room:startStage", ({ stageId } = {}) => {
    const room = currentRoom(socket); stageId = Number(stageId);
    if (!room || room.hostId !== socket.id || room.game || !Number.isInteger(stageId) || stageId < 1 || stageId > snapshot(room).maxStage) return socket.emit("room:error", "The host must choose an available stage.");
    room.game = { stageId, simOwnerId: socket.id, towers: [], wave: 0, waveRunning: false };
    io.to(room.code).emit("game:start", room.game);
  });
  socket.on("tower:place", ({ type, x, y } = {}) => {
    const room = currentRoom(socket); const player = room?.players.get(socket.id);
    if (!room?.game || !player?.loadout.includes(type) || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1000 || y < 0 || y > 650 || room.game.towers.filter((tower) => tower.ownerId === socket.id).length >= 15 || room.game.towers.some((tower) => Math.hypot(tower.x - x, tower.y - y) < 38)) return;
    const tower = { uid: crypto.randomUUID(), type, x, y, level: 1, ownerId: socket.id };
    room.game.towers.push(tower); io.to(room.code).emit("tower:placed", tower);
  });
  socket.on("tower:upgrade", ({ uid } = {}) => {
    const room = currentRoom(socket); const tower = room?.game?.towers.find((item) => item.uid === uid && item.ownerId === socket.id);
    if (!tower || tower.level >= 5) return;
    tower.level += 1; io.to(room.code).emit("tower:upgraded", { uid });
  });
  socket.on("tower:sell", ({ uid } = {}) => {
    const room = currentRoom(socket); const tower = room?.game?.towers.find((item) => item.uid === uid && item.ownerId === socket.id);
    if (!tower) return;
    room.game.towers = room.game.towers.filter((item) => item !== tower); io.to(room.code).emit("tower:sold", { uid });
  });
  socket.on("wave:start", () => {
    const room = currentRoom(socket); if (!room?.game || room.game.waveRunning || !room.game.simOwnerId) return;
    room.game.waveRunning = true; room.game.wave += 1;
    io.to(room.code).emit("wave:start", { wave: room.game.wave, startsAt: Date.now() + 800 });
  });
  socket.on("wave:end", ({ wave } = {}) => {
    const room = currentRoom(socket); if (!room?.game || room.game.simOwnerId !== socket.id || wave !== room.game.wave) return;
    room.game.waveRunning = false;
    socket.to(room.code).emit("wave:ended", { wave });
  });
  socket.on("mobs:sync", (data) => {
    const room = currentRoom(socket); if (!room?.game || room.game.simOwnerId !== socket.id || !data || typeof data !== "object") return;
    room.game.lastSnapshot = data; socket.to(room.code).emit("mobs:sync", data);
  });
  socket.on("coins:reward", (data) => { const room = currentRoom(socket); if (room?.game?.simOwnerId === socket.id) socket.to(room.code).emit("coins:reward", data); });
  socket.on("room:notice", (data) => { const room = currentRoom(socket); if (room?.game?.simOwnerId === socket.id) socket.to(room.code).emit("room:notice", data); });
  socket.on("game:end", ({ result } = {}) => {
    const room = currentRoom(socket); if (!room?.game || room.game.simOwnerId !== socket.id || !["won", "lost"].includes(result)) return;
    socket.to(room.code).emit("game:result", { result });
    io.to(room.code).emit("room:closed", { result });
    for (const player of room.players.values()) { clearTimeout(player.timer); const peer = io.sockets.sockets.get(player.id); if (peer) { peer.data.roomCode = null; peer.leave(room.code); } }
    rooms.delete(room.code);
  });
  socket.on("room:leave", () => { const room = currentRoom(socket); if (!room) return; socket.leave(room.code); socket.data.roomCode = null; removePlayer(room, socket.id); });
  socket.on("disconnect", () => {
    const room = currentRoom(socket); const player = room?.players.get(socket.id); if (!player) return;
    player.connected = false;
    if (room.game?.simOwnerId === socket.id) {
      room.game.simOwnerId = connectedPlayers(room)[0]?.id || null;
      if (room.game.simOwnerId) io.to(room.code).emit("sim:changed", { simOwnerId: room.game.simOwnerId });
    }
    player.timer = setTimeout(() => removePlayer(room, player.id), RECONNECT_MS);
    sendRoom(room);
  });
});


const port = Number(process.env.PORT || 3002);
server.listen(port, "0.0.0.0", () => console.log(`Server is running on port ${port}`));
