import path from "node:path";

export class AppError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}

export async function parseJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new AppError(400, "Invalid JSON payload.");
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateEmail(email: string): boolean {
  return /^\S+@\S+\.\S+$/.test(email);
}

export function validatePassword(password: string): boolean {
  return password.length >= 8;
}

export function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) {
      return decodeURIComponent(rest.join("="));
    }
  }

  return null;
}

export function cookieString(name: string, value: string, options?: {
  maxAge?: number;
  path?: string;
  httpOnly?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  secure?: boolean;
}): string {
  const attrs = [`${name}=${encodeURIComponent(value)}`];
  attrs.push(`Path=${options?.path ?? "/"}`);
  attrs.push(`SameSite=${options?.sameSite ?? "Lax"}`);

  if (options?.maxAge !== undefined) {
    attrs.push(`Max-Age=${options.maxAge}`);
  }

  if (options?.httpOnly ?? true) {
    attrs.push("HttpOnly");
  }

  if (options?.secure ?? false) {
    attrs.push("Secure");
  }

  return attrs.join("; ");
}

export function sanitizeFilename(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.basename(cleaned);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function timestampId(date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "T",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    "Z",
  ].join("");
}

export async function pathExists(pathname: string): Promise<boolean> {
  return await Bun.file(pathname).exists();
}
