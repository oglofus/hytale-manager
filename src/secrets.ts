import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { pathExists } from "./utils";

const SECRET_KEY_FILE = path.join(config.app.dataDir, ".hytale-manager-secret.key");
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

async function resolveMasterSecret(): Promise<string> {
  const envSecret = Bun.env.HYTALE_SECRET_KEY?.trim() ?? "";
  if (envSecret.length > 0) {
    return envSecret;
  }

  if (await pathExists(SECRET_KEY_FILE)) {
    const existing = (await readFile(SECRET_KEY_FILE, "utf8")).trim();
    if (existing.length > 0) {
      return existing;
    }
  }

  const generated = randomBytes(48).toString("base64url");
  await writeFile(SECRET_KEY_FILE, generated, { encoding: "utf8", mode: 0o600 });
  return generated;
}

async function deriveKey(): Promise<Buffer> {
  const master = await resolveMasterSecret();
  return createHash("sha256").update(master).digest().subarray(0, KEY_LENGTH);
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const normalized = plaintext.trim();
  if (!normalized) {
    throw new Error("Cannot encrypt empty secret.");
  }

  const key = await deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${authTag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export async function decryptSecret(ciphertext: string): Promise<string | null> {
  const [ivRaw, tagRaw, payloadRaw] = ciphertext.split(".");
  if (!ivRaw || !tagRaw || !payloadRaw) {
    return null;
  }

  try {
    const key = await deriveKey();
    const iv = Buffer.from(ivRaw, "base64url");
    const authTag = Buffer.from(tagRaw, "base64url");
    const payload = Buffer.from(payloadRaw, "base64url");

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8").trim();
    return decrypted.length > 0 ? decrypted : null;
  } catch {
    return null;
  }
}
