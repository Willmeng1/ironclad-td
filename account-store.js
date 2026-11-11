import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import pg from "pg";

// Outside the public game folder: account records must never be served as assets.
export const accountFile = process.env.IRONCLAD_ACCOUNT_FILE || path.join(os.homedir(), ".ironclad-td", "accounts.json");

export function loadAccounts() {
  if (!fs.existsSync(accountFile)) return new Map();
  const data = JSON.parse(fs.readFileSync(accountFile, "utf8"));
  if (data.version !== 1 || !Array.isArray(data.users)) throw new Error("Invalid account database; refusing to overwrite it.");
  return new Map(data.users);
}

export function persistAccounts(users) {
  fs.mkdirSync(path.dirname(accountFile), { recursive: true, mode: 0o700 });
  const temporary = `${accountFile}.${process.pid}.tmp`;
  const fd = fs.openSync(temporary, "w", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify({ version: 1, users: [...users] }));
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  if (fs.existsSync(accountFile)) fs.copyFileSync(accountFile, `${accountFile}.bak`);
  fs.renameSync(temporary, accountFile);
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString("hex") };
}

export function verifyPassword(password, credential) {
  if (!credential?.salt || !credential?.hash) return false;
  const actual = crypto.scryptSync(password, credential.salt, 64);
  const expected = Buffer.from(credential.hash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// Database credentials are read only by the server. The private schema is not
// exposed through Supabase's default public Data API.
export async function createAccountStore(databaseUrl = process.env.DATABASE_URL, createPool = (options) => new pg.Pool(options)) {
  if (!databaseUrl) {
    const users = loadAccounts();
    return {
      mode: "local file",
      async get(key) { return users.get(key); },
      async create(key, user) {
        if (users.has(key)) return false;
        users.set(key, user);
        try { persistAccounts(users); } catch (error) { users.delete(key); throw error; }
        return true;
      },
      async save(key, saveData) {
        const user = users.get(key);
        if (!user) return null;
        const previous = user.save;
        user.save = { ...previous, ...saveData, username: previous.username };
        try { persistAccounts(users); } catch (error) { user.save = previous; throw error; }
        return user;
      },
    };
  }

  const pool = createPool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: true }, max: 5 });
  pool.on("error", () => console.error("An idle database connection was lost."));
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS ironclad_private");
    await pool.query("REVOKE ALL ON SCHEMA ironclad_private FROM PUBLIC");
    await pool.query(`CREATE TABLE IF NOT EXISTS ironclad_private.accounts (
      username_key TEXT PRIMARY KEY,
      credential JSONB NOT NULL,
      save_data JSONB NOT NULL
    )`);
    await pool.query("REVOKE ALL ON TABLE ironclad_private.accounts FROM PUBLIC");
  } catch (error) {
    await pool.end();
    throw error;
  }
  return {
    mode: "PostgreSQL",
    async get(key) {
      const { rows } = await pool.query("SELECT credential, save_data FROM ironclad_private.accounts WHERE username_key = $1", [key]);
      return rows[0] ? { credential: rows[0].credential, save: rows[0].save_data } : null;
    },
    async create(key, user) {
      const result = await pool.query("INSERT INTO ironclad_private.accounts (username_key, credential, save_data) VALUES ($1, $2, $3) ON CONFLICT (username_key) DO NOTHING", [key, user.credential, user.save]);
      return result.rowCount === 1;
    },
    async save(key, saveData) {
      const { rows } = await pool.query(`UPDATE ironclad_private.accounts
        SET save_data = (save_data || $2::jsonb) || jsonb_build_object('username', save_data->'username')
        WHERE username_key = $1 RETURNING credential, save_data`, [key, JSON.stringify(saveData)]);
      return rows[0] ? { credential: rows[0].credential, save: rows[0].save_data } : null;
    },
  };
}
