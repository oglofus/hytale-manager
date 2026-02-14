#!/usr/bin/env bun

// bunx entrypoint: default to production-like runtime unless explicitly overridden.
process.env.NODE_ENV ??= "production";

type ListenConfig = {
  host?: string;
  port?: string;
};

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
  console.log("Usage: hytale-manager [--listen <host:port>] [--host <host>] [--port <port>]");
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
      const parsed = parseListen(value);
      if (parsed.host !== undefined) {
        process.env.HOST = parsed.host;
      }
      if (parsed.port !== undefined) {
        process.env.PORT = parsed.port;
      }
      i += 1;
      continue;
    }

    if (arg.startsWith("--listen=")) {
      const parsed = parseListen(arg.slice("--listen=".length));
      if (parsed.host !== undefined) {
        process.env.HOST = parsed.host;
      }
      if (parsed.port !== undefined) {
        process.env.PORT = parsed.port;
      }
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

await import("../src/server.ts");
