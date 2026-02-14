import { Database } from "bun:sqlite";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { config } from "./config";

export type UserRole = "owner" | "member";

export type UserRecord = {
  id: number;
  email: string;
  password_hash: string;
  role: UserRole;
  created_at: string;
};

export type PublicUser = {
  id: number;
  email: string;
  role: UserRole;
  createdAt: string;
};

export type SessionRecord = {
  id: number;
  token_hash: string;
  user_id: number;
  expires_at: string;
  created_at: string;
};

export type InviteRecord = {
  id: number;
  email: string;
  token: string;
  role: UserRole;
  created_by: number;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
};

export type InviteSummary = {
  id: number;
  email: string;
  role: UserRole;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
};

mkdirSync(path.dirname(config.app.dbPath), { recursive: true });
const db = new Database(config.app.dbPath, { create: true });

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

const countUsersStmt = db.query("SELECT COUNT(*) AS count FROM users");
const createUserStmt = db.query(
  "INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, ?, ?) RETURNING id, email, role, created_at",
);
const getUserByEmailStmt = db.query(
  "SELECT id, email, password_hash, role, created_at FROM users WHERE email = ?",
);
const getUserByIdStmt = db.query("SELECT id, email, password_hash, role, created_at FROM users WHERE id = ?");

const insertSessionStmt = db.query(
  "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
);
const deleteSessionStmt = db.query("DELETE FROM sessions WHERE token_hash = ?");
const deleteExpiredSessionsStmt = db.query("DELETE FROM sessions WHERE expires_at <= ?");
const getSessionWithUserStmt = db.query(`
SELECT
  sessions.id AS session_id,
  sessions.expires_at AS session_expires_at,
  users.id AS user_id,
  users.email AS user_email,
  users.role AS user_role,
  users.created_at AS user_created_at
FROM sessions
JOIN users ON users.id = sessions.user_id
WHERE sessions.token_hash = ?
`);

const createInviteStmt = db.query(
  "INSERT INTO invites (email, token, role, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id, email, token, role, created_by, expires_at, accepted_at, created_at",
);
const listInvitesStmt = db.query(
  "SELECT id, email, role, expires_at, accepted_at, created_at FROM invites ORDER BY id DESC",
);
const getInviteByTokenStmt = db.query(
  "SELECT id, email, token, role, created_by, expires_at, accepted_at, created_at FROM invites WHERE token = ?",
);
const acceptInviteStmt = db.query("UPDATE invites SET accepted_at = ? WHERE id = ?");
const revokeInviteStmt = db.query("DELETE FROM invites WHERE id = ?");
const getSettingStmt = db.query("SELECT value FROM app_settings WHERE key = ?");
const setSettingStmt = db.query(`
INSERT INTO app_settings (key, value, updated_at)
VALUES (?, ?, ?)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = excluded.updated_at
`);
const deleteSettingStmt = db.query("DELETE FROM app_settings WHERE key = ?");

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function usersCount(): number {
  const row = countUsersStmt.get() as { count: number } | null;
  return row?.count ?? 0;
}

export function hasAnyUsers(): boolean {
  return usersCount() > 0;
}

export function createUser(email: string, passwordHash: string, role: UserRole): PublicUser {
  const row = createUserStmt.get(normalizeEmail(email), passwordHash, role, nowIso()) as {
    id: number;
    email: string;
    role: UserRole;
    created_at: string;
  } | null;

  if (!row) {
    throw new Error("Failed to create user.");
  }

  return {
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
  };
}

export function getUserByEmail(email: string): UserRecord | null {
  return (getUserByEmailStmt.get(normalizeEmail(email)) as UserRecord | null) ?? null;
}

export function getUserById(id: number): UserRecord | null {
  return (getUserByIdStmt.get(id) as UserRecord | null) ?? null;
}

export function createSession(tokenHash: string, userId: number, expiresAtIso: string): void {
  insertSessionStmt.run(tokenHash, userId, expiresAtIso, nowIso());
}

export function deleteSession(tokenHash: string): void {
  deleteSessionStmt.run(tokenHash);
}

export function deleteExpiredSessions(): void {
  deleteExpiredSessionsStmt.run(nowIso());
}

export function getSessionUser(tokenHash: string): PublicUser | null {
  const row = getSessionWithUserStmt.get(tokenHash) as {
    session_id: number;
    session_expires_at: string;
    user_id: number;
    user_email: string;
    user_role: UserRole;
    user_created_at: string;
  } | null;

  if (!row) {
    return null;
  }

  if (Date.parse(row.session_expires_at) <= Date.now()) {
    deleteSession(tokenHash);
    return null;
  }

  return {
    id: row.user_id,
    email: row.user_email,
    role: row.user_role,
    createdAt: row.user_created_at,
  };
}

export function createInvite(
  email: string,
  token: string,
  role: UserRole,
  createdBy: number,
  expiresAtIso: string,
): InviteRecord {
  const row = createInviteStmt.get(normalizeEmail(email), token, role, createdBy, expiresAtIso, nowIso()) as InviteRecord | null;

  if (!row) {
    throw new Error("Failed to create invite.");
  }

  return row;
}

export function getInviteByToken(token: string): InviteRecord | null {
  return (getInviteByTokenStmt.get(token) as InviteRecord | null) ?? null;
}

export function acceptInvite(id: number): void {
  acceptInviteStmt.run(nowIso(), id);
}

export function revokeInvite(id: number): void {
  revokeInviteStmt.run(id);
}

export function listInvites(): InviteSummary[] {
  const rows = listInvitesStmt.all() as Array<{
    id: number;
    email: string;
    role: UserRole;
    expires_at: string;
    accepted_at: string | null;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
  }));
}

export function getAppSetting(key: string): string | null {
  const row = getSettingStmt.get(key) as { value: string } | null;
  return row?.value ?? null;
}

export function setAppSetting(key: string, value: string): void {
  setSettingStmt.run(key, value, nowIso());
}

export function deleteAppSetting(key: string): void {
  deleteSettingStmt.run(key);
}
