#!/usr/bin/env bun

// bunx entrypoint: default to production-like runtime unless explicitly overridden.
process.env.NODE_ENV ??= "production";

await import("../src/server.ts");
