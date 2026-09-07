import express from "express";
import http from "node:http";
import crypto from "node:crypto";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const users = new Map();
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
  users.set(username.toLowerCase(), { password, save });
  res.json({ username, token: tokenFor(username.toLowerCase()), saveData: save });
});
app.post("/api/auth/login", (req, res) => {
  const key = String(req.body?.username || "").trim().toLowerCase(); const user = users.get(key);
  if (!user || user.password !== String(req.body?.password || "")) return res.status(401).json({ error: "Incorrect username or password." });
  res.json({ username: user.save.username, token: tokenFor(key), saveData: user.save });
});
app.get("/api/auth/me", (req, res) => { const key = authUser(req); const user = users.get(key); if (!user) return res.status(401).json({ error: "Not signed in." }); res.json({ username: user.save.username, saveData: user.save }); });
app.post("/api/auth/save", (req, res) => { const key = authUser(req); const user = users.get(key); if (!user) return res.status(401).json({ error: "Not signed in." }); user.save = { ...user.save, ...(req.body?.saveData || req.body?.save || req.body || {}), username: user.save.username }; res.json({ username: user.save.username, saveData: user.save }); });
app.post("/api/auth/heartbeat", (req, res) => res.json({ ok: Boolean(authUser(req)) }));

function snapshot(room) { return { code: room.code, hostId: room.hostId, players: [...room.players.values()], stageId: room.stageId || 1 }; }
io.on("connection", (socket) => {
  socket.on("room:create", (profile = {}) => { let code; do code = Math.random().toString(36).slice(2, 7).toUpperCase(); while (rooms.has(code)); const room = { code, hostId: socket.id, players: new Map([[socket.id, { id: socket.id, name: profile.username || "Player", ready: true }]]) }; rooms.set(code, room); socket.join(code); socket.data.roomCode = code; socket.emit("room:created", snapshot(room)); io.to(code).emit("room:update", snapshot(room)); });
  socket.on("room:join", ({ code, username } = {}) => { const room = rooms.get(String(code || "").toUpperCase()); if (!room) return socket.emit("room:error", "Room not found."); room.players.set(socket.id, { id: socket.id, name: username || "Player", ready: true }); socket.join(room.code); socket.data.roomCode = room.code; socket.emit("room:joined", snapshot(room)); io.to(room.code).emit("room:update", snapshot(room)); });
  ["room:startStage", "wave:start", "wave:end", "coins:reward", "mobs:sync", "tower:place", "tower:upgrade", "tower:sell", "room:notice", "game:end"].forEach((event) => socket.on(event, (data) => { const code = socket.data.roomCode; if (code) socket.to(code).emit(event === "room:startStage" ? "game:start" : event, data); }));
  const leave = () => { const code = socket.data.roomCode; const room = rooms.get(code); if (!room) return; room.players.delete(socket.id); socket.leave(code); if (!room.players.size) rooms.delete(code); else { if (room.hostId === socket.id) room.hostId = room.players.keys().next().value; io.to(code).emit("room:update", snapshot(room)); } socket.data.roomCode = null; };
  socket.on("room:leave", leave); socket.on("disconnect", leave);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});