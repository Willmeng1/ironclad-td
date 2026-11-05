import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

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
