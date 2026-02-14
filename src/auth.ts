import { createHash, randomBytes } from "node:crypto";
import { config } from "./config";
import {
  acceptInvite,
  createSession,
  createUser,
  deleteExpiredSessions,
  deleteSession,
  getInviteByToken,
  getSessionUser,
  getUserByEmail,
  hasAnyUsers,
  PublicUser,
  UserRole,
} from "./db";
import {
  AppError,
  cookieString,
  normalizeEmail,
  readCookie,
  validateEmail,
  validatePassword,
} from "./utils";

export const SESSION_COOKIE = "hytale_sid";

export type SessionEnvelope = {
  user: PublicUser;
  cookie: string;
};

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function sessionCookie(token: string): string {
  return cookieString(SESSION_COOKIE, token, {
    maxAge: config.app.sessionTtlHours * 60 * 60,
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: config.app.sessionCookieSecure,
  });
}

export function clearSessionCookie(): string {
  return cookieString(SESSION_COOKIE, "", {
    maxAge: 0,
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: config.app.sessionCookieSecure,
  });
}

function validateCredentials(email: string, password: string): void {
  if (!validateEmail(email)) {
    throw new AppError(400, "A valid email address is required.");
  }

  if (!validatePassword(password)) {
    throw new AppError(400, "Password must contain at least 8 characters.");
  }
}

async function createSessionEnvelope(user: PublicUser): Promise<SessionEnvelope> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + config.app.sessionTtlHours * 60 * 60 * 1000).toISOString();
  createSession(tokenHash(token), user.id, expiresAt);

  return {
    user,
    cookie: sessionCookie(token),
  };
}

export function bootstrapRequired(): boolean {
  return !hasAnyUsers();
}

export async function setupOwner(email: string, password: string): Promise<SessionEnvelope> {
  if (hasAnyUsers()) {
    throw new AppError(409, "Owner has already been configured.");
  }

  validateCredentials(email, password);
  const passwordHash = await Bun.password.hash(password, "argon2id");
  const user = createUser(email, passwordHash, "owner");
  return await createSessionEnvelope(user);
}

export async function login(email: string, password: string): Promise<SessionEnvelope> {
  validateCredentials(email, password);
  deleteExpiredSessions();

  const user = getUserByEmail(email);
  if (!user) {
    throw new AppError(401, "Invalid email or password.");
  }

  const isValidPassword = await Bun.password.verify(password, user.password_hash);
  if (!isValidPassword) {
    throw new AppError(401, "Invalid email or password.");
  }

  return await createSessionEnvelope({
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.created_at,
  });
}

export async function registerFromInvite(token: string, password: string): Promise<SessionEnvelope> {
  if (!token) {
    throw new AppError(400, "Invite token is missing.");
  }

  if (!validatePassword(password)) {
    throw new AppError(400, "Password must contain at least 8 characters.");
  }

  const invite = getInviteByToken(token);
  if (!invite) {
    throw new AppError(404, "Invite not found.");
  }

  if (invite.accepted_at) {
    throw new AppError(409, "Invite has already been used.");
  }

  if (Date.parse(invite.expires_at) <= Date.now()) {
    throw new AppError(410, "Invite has expired.");
  }

  const normalizedEmail = normalizeEmail(invite.email);
  if (getUserByEmail(normalizedEmail)) {
    throw new AppError(409, "A user with this email already exists.");
  }

  const passwordHash = await Bun.password.hash(password, "argon2id");
  const user = createUser(normalizedEmail, passwordHash, invite.role as UserRole);
  acceptInvite(invite.id);
  return await createSessionEnvelope(user);
}

export function getSessionUserFromRequest(request: Request): PublicUser | null {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) {
    return null;
  }

  return getSessionUser(tokenHash(token));
}

export function logoutFromRequest(request: Request): void {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) {
    return;
  }

  deleteSession(tokenHash(token));
}
