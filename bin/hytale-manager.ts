#!/usr/bin/env bun

import tailwind from "bun-plugin-tailwind";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Preserve the user's launch directory for runtime data defaults.
const launchCwd = process.cwd();
process.env.HYTALE_MANAGER_CWD ??= launchCwd;

// bunx entrypoint: default to production-like runtime unless explicitly overridden.
process.env.NODE_ENV ??= "production";

type ListenConfig = {
  host?: string;
  port?: string;
  publicBaseUrl?: string;
  sessionCookieSecure?: string;
};

async function ensureProductionBundle(packageRoot: string): Promise<void> {
  const distServerPath = path.join(packageRoot, "dist", "server.js");
  if (await Bun.file(distServerPath).exists()) {
    return;
  }

  console.log("Preparing production bundle...");
  await rm(path.join(packageRoot, "dist"), { recursive: true, force: true });
  const result = await Bun.build({
    entrypoints: [path.join(packageRoot, "src", "server.ts")],
    outdir: path.join(packageRoot, "dist"),
    target: "bun",
    minify: true,
    publicPath: "/",
    plugins: [tailwind],
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }
    throw new Error("Failed to build production bundle.");
  }
}

function parsePort(raw: string): string {
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 1 || num > 65535) {
    throw new Error(`Invalid port: ${raw}`);
  }
  return String(num);
}

function parseListen(raw: string): ListenConfig {
  const value = raw.trim();
  if (!value) {
    throw new Error("Listen value cannot be empty.");
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`Invalid --listen protocol: ${url.protocol}`);
    }
    if (url.username || url.password) {
      throw new Error("Invalid --listen URL: userinfo is not supported.");
    }
    if (url.pathname !== "/" || url.search || url.hash) {
      throw new Error("Invalid --listen URL: path, query, and hash are not supported.");
    }
    if (!url.hostname) {
      throw new Error("Invalid --listen URL: missing hostname.");
    }

    const host = url.hostname;
    const port = parsePort(url.port || (url.protocol === "https:" ? "443" : "80"));
    const hostForUrl = host.includes(":") ? `[${host}]` : host;
    return {
      host,
      port,
      publicBaseUrl: `${url.protocol}//${hostForUrl}:${port}`,
      sessionCookieSecure: url.protocol === "https:" ? "true" : "false",
    };
  }

  if (/^\d+$/.test(value)) {
    return { port: parsePort(value) };
  }

  const ipv6Match = value.match(/^\[([^\]]+)\]:(\d+)$/);
  if (ipv6Match) {
    return {
      host: ipv6Match[1],
      port: parsePort(ipv6Match[2]),
    };
  }

  const ipv4OrHostMatch = value.match(/^([^:]+):(\d+)$/);
  if (ipv4OrHostMatch) {
    return {
      host: ipv4OrHostMatch[1],
      port: parsePort(ipv4OrHostMatch[2]),
    };
  }

  throw new Error(`Invalid --listen value: ${raw}. Expected host:port or port.`);
}

function printUsage(): void {
  console.log("Usage: hytale-manager [--listen <host:port|http(s)://host:port>] [--host <host>] [--port <port>]");
}

function applyListen(parsed: ListenConfig): void {
  if (parsed.host !== undefined) {
    process.env.HOST = parsed.host;
  }
  if (parsed.port !== undefined) {
    process.env.PORT = parsed.port;
  }
  if (parsed.publicBaseUrl !== undefined) {
    process.env.PUBLIC_BASE_URL = parsed.publicBaseUrl;
  }
  if (parsed.sessionCookieSecure !== undefined) {
    process.env.SESSION_COOKIE_SECURE = parsed.sessionCookieSecure;
  }
}

function applyCliArgs(argv: string[]): void {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--listen") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Missing value for --listen.");
      }
      applyListen(parseListen(value));
      i += 1;
      continue;
    }

    if (arg.startsWith("--listen=")) {
      applyListen(parseListen(arg.slice("--listen=".length)));
      continue;
    }

    if (arg === "--host") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Missing value for --host.");
      }
      process.env.HOST = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--host=")) {
      process.env.HOST = arg.slice("--host=".length);
      continue;
    }

    if (arg === "--port") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Missing value for --port.");
      }
      process.env.PORT = parsePort(value);
      i += 1;
      continue;
    }

    if (arg.startsWith("--port=")) {
      process.env.PORT = parsePort(arg.slice("--port=".length));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }
}

try {
  applyCliArgs(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : "Invalid arguments.";
  console.error(message);
  printUsage();
  process.exit(1);
}

// Run from the package root to avoid Bun HTML asset URL resolution quirks when
// bunx is launched inside another project directory.
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(packageRoot);

if (process.env.NODE_ENV === "development") {
  await import("../src/server.ts");
} else {
  await ensureProductionBundle(packageRoot);
  process.chdir(path.join(packageRoot, "dist"));
  await import(pathToFileURL(path.join(packageRoot, "dist", "server.js")).href);
}
