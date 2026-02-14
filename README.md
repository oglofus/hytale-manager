# Hytale Manager [![GitHub Release](https://img.shields.io/github/v/release/oglofus/hytale-manager)](https://github.com/oglofus/hytale-manager/releases) [![Build and publish GitHub release](https://github.com/oglofus/hytale-manager/actions/workflows/release-package.yml/badge.svg)](https://github.com/oglofus/hytale-manager/actions/workflows/release-package.yml)

A Bun-first web dashboard for managing a single Hytale server instance.

## What it supports

- Install Hytale server:
  - Native downloader mode via built-in Bun OAuth flow (OAuth device auth + signed asset URLs).
  - Installs latest version for the configured patchline and exposes update availability.
- Start, stop, and restart the server.
- Live terminal output and command input over WebSocket.
- Log file browsing (`logs/`) and terminal history view.
- Mod management:
  - Upload `.jar` / `.zip` mods over WebSocket.
  - Disable/enable (rename with `.disabled`).
  - Delete mods.
  - CurseForge integration (API-key based):
    - Browse/search mods (name or creator style query).
    - Sort by popularity, downloads, updates, name, or author.
    - Install directly from CurseForge.
    - Check for updates and update one/all installed CurseForge mods.
  - Nexus Mods integration:
    - Connect via SSO-ready flow (requires Nexus app id) or API key.
    - Browse/search mods, sort by popularity/downloads/updated/name.
    - Install and update tracked Nexus mods.
- Backup management:
  - Create backups.
  - List and delete backups.
  - Restore backups (server must be stopped).
- Authentication:
  - Owner bootstrap account.
  - Session-based login/logout.
  - Invite by email (SMTP optional) and invite-based account creation.

## Quick start

Run directly (no clone required):

```bash
bunx --package github:oglofus/hytale-manager hytale-manager
```

Pinned to a specific release tag (recommended for stability):

```bash
bunx --package github:oglofus/hytale-manager#v0.1.0 hytale-manager
```

This starts the dashboard on `http://localhost:3000` by default. Use env vars for customization, for example:

```bash
PORT=3210 DATA_DIR=./hytale-data bunx --package github:oglofus/hytale-manager#v0.1.0 hytale-manager
```

Run from source:

1. Install dependencies:

```bash
bun install
```

2. (Optional) create `.env` from the variables below.

3. Start in development:

```bash
bun run dev
```

4. Open `http://localhost:3000`.

## Environment variables

Core:

- `PORT` (default: `3000`)
- `DATA_DIR` (default: `./data`)
- `HYTALE_SERVER_DIR` (default: `${DATA_DIR}/hytale-server`)
- `BACKUPS_DIR` (default: `${DATA_DIR}/backups`)
- `UPLOADS_DIR` (default: `${DATA_DIR}/uploads`)
- `TOOLS_DIR` (default: `${DATA_DIR}/tools`)
- `PUBLIC_BASE_URL` (default: `http://localhost:<PORT>`)
- `HYTALE_SECRET_KEY` (optional but recommended) - master secret used to encrypt dashboard-stored credentials (including CurseForge API key).

Auth/session:

- `SESSION_TTL_HOURS` (default: `336`)
- `INVITE_TTL_HOURS` (default: `72`)

Hytale runtime/install:

- `HYTALE_MANAGED_JAVA_DIR` (default: `${TOOLS_DIR}/temurin-jdk-25`)
- `HYTALE_DOWNLOAD_CACHE_DIR` (default: `${TOOLS_DIR}/download-cache`)
- `HYTALE_CURSEFORGE_STATE_PATH` (default: `${DATA_DIR}/curseforge-mods.json`)
- `HYTALE_CURSEFORGE_API_HOST` (default: `api.curseforge.com`)
- `HYTALE_CURSEFORGE_API_KEY` (or `CURSEFORGE_API_KEY`) - optional if you use the dashboard "Connect CurseForge" flow.
- `HYTALE_CURSEFORGE_GAME_ID` (or `CURSEFORGE_GAME_ID`, default: `70216` for Hytale) - optional if you use the dashboard "Connect CurseForge" flow.
- `HYTALE_CURSEFORGE_CLASS_ID` (or `CURSEFORGE_CLASS_ID`) - optional category/class filter.
- `HYTALE_CURSEFORGE_PAGE_SIZE` (default: `20`)
- `HYTALE_NEXUS_STATE_PATH` (default: `${DATA_DIR}/nexus-mods.json`)
- `HYTALE_NEXUS_API_HOST` (default: `api.nexusmods.com`)
- `HYTALE_NEXUS_WEB_HOST` (default: `www.nexusmods.com`)
- `HYTALE_NEXUS_SSO_WS_URL` (default: `wss://sso.nexusmods.com`)
- `HYTALE_NEXUS_API_KEY` (or `NEXUS_API_KEY`) - optional if you use dashboard connect flow.
- `HYTALE_NEXUS_GAME_DOMAIN` (or `NEXUS_GAME_DOMAIN`, default: `hytale`)
- `HYTALE_NEXUS_APP_ID` (or `NEXUS_APP_ID`) - required for SSO connect flow.
- `HYTALE_NEXUS_APPLICATION_NAME` (default: `hytale-manager`)
- `HYTALE_NEXUS_APPLICATION_VERSION` (default: `1.0.0`)
- `HYTALE_NEXUS_PROTOCOL_VERSION` (default: `1.0.0`)
- `HYTALE_NEXUS_PAGE_SIZE` (default: `20`)
- `HYTALE_DOWNLOAD_CONCURRENCY` (default: `6`)
- `HYTALE_DOWNLOAD_PROGRESS_INTERVAL_MS` (default: `2000`)
- `HYTALE_ADOPTIUM_API_HOST` (default: `api.adoptium.net`)
- `HYTALE_ADOPTIUM_FEATURE_VERSION` (default: `25`)
- `HYTALE_JAVA_DOWNLOAD_TIMEOUT_MS` (default: `3600000`)
- `HYTALE_JAVA_EXTRACT_TIMEOUT_MS` (default: `900000`)
- `HYTALE_START_ARGS` (default: `-XX:AOTCache=HytaleServer.aot -jar HytaleServer.jar --assets Assets.zip`)
- `HYTALE_STOP_COMMAND` (default: `/stop`)
- `HYTALE_DOWNLOADER_CREDENTIALS_PATH` (default: `${DATA_DIR}/.hytale-downloader-credentials.json`)
- `HYTALE_DOWNLOADER_ENVIRONMENT` (default: `release`)
- `HYTALE_OAUTH_HOST` (default: `oauth.accounts.hytale.com`)
- `HYTALE_OAUTH_AUTO_OPEN_BROWSER` (default: `true`) - auto-open device auth URL on host/browser when possible.
- `HYTALE_ACCOUNT_DATA_HOST` (default: `account-data.hytale.com`)
- `HYTALE_DOWNLOADER_CLIENT_ID` (default: `hytale-downloader`)
- `HYTALE_DOWNLOADER_SCOPE` (default: `auth:downloader`)
- `HYTALE_DOWNLOADER_API_TIMEOUT_MS` (default: `30000`)
- `HYTALE_DOWNLOADER_DOWNLOAD_TIMEOUT_MS` (default: `3600000`)
- `HYTALE_DOWNLOADER_EXTRACT_TIMEOUT_MS` (default: `1800000`)
- `HYTALE_OAUTH_DEVICE_POLL_TIMEOUT_MS` (default: `600000`)
- `HYTALE_PATCHLINE` (default: `release`)
- `HYTALE_STARTUP_TIMEOUT_MS` (default: `120000`)
- `HYTALE_SHUTDOWN_TIMEOUT_MS` (default: `15000`)
- `TERMINAL_BUFFER_LINES` (default: `4000`)

Optional SMTP for invite emails:

- `SMTP_HOST`
- `SMTP_PORT` (default: `587`)
- `SMTP_SECURE` (`true`/`false`, default: `false`)
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

If SMTP is not configured, invite links are still created and shown in the dashboard so you can share them manually.

## Tech stack

- Runtime/server: `Bun.serve` + native WebSocket handlers.
- Auth + crypto: `Bun.password`.
- Database: `bun:sqlite`.
- Frontend: React (`react`, `react-dom`).
- UI: shadcn/ui components + Tailwind CSS.
- Bundling: Bun bundler + HTML imports.

## Project scripts

- `bun run dev` - dev server (`--hot`) with Bun fullstack dev pipeline.
- `bun run check` - TypeScript checks.
- `bun run build` - production build to `dist/`.
- `bun run start` - run built server.
- `bun run start:bin` - run the publishable CLI entrypoint (`bin/hytale-manager.ts`).

## GitHub release workflow

GitHub Actions workflow: `.github/workflows/release-package.yml`

- Triggers on:
  - tag push `v*` (for example `v0.1.1`)
  - manual `workflow_dispatch` (input tag)
- Validates tag version matches `package.json` version
- Runs `bun run check` + `bun run build`
- Creates a GitHub Release with:
  - packed artifact (`*.tgz`) from `bun pm pack`
  - `SHA256SUMS.txt`

## Hytale install notes

Downloader mode behavior:

- Uses the same OAuth2 device flow as the official downloader (`client_id=hytale-downloader`, `scope=auth:downloader`).
- Saves credentials to `HYTALE_DOWNLOADER_CREDENTIALS_PATH` and refreshes them automatically.
- Requests signed asset URLs from `https://<HYTALE_ACCOUNT_DATA_HOST>/game-assets/<path>`.
- Downloads and validates SHA256 from the manifest before extraction.
- Always installs the latest manifest version for `HYTALE_PATCHLINE`.
- Stores installed version metadata in `hytale-server/.hytale-manager-install.json`.
- Dashboard only shows install/update action when server is missing or a newer version is detected.
- Downloader uses a local archive cache and parallel range downloads when supported by the source.
- On first owner setup, initialization automatically starts server installation + managed Adoptium JDK 25 installation in the background.

Java runtime behavior:

- You can install Adoptium Temurin JDK 25 from the dashboard (`Install Adoptium JDK 25`).
- Start/stop/restart are blocked until both server files and managed Adoptium JDK 25 are installed.
- Managed runtime is stored under `HYTALE_MANAGED_JAVA_DIR`.

CurseForge behavior:

- Requires a CurseForge API key and game ID (via environment variables or dashboard connect flow).
- Alternatively, owner can configure CurseForge once in the dashboard; credentials are encrypted at rest and stored in `app.sqlite`.
- Tracks CurseForge-installed mods in `HYTALE_CURSEFORGE_STATE_PATH`.
- Mod disable/enable/delete actions keep CurseForge tracking metadata in sync.
- Updates are detected by comparing installed file IDs to the latest available file per mod.

Nexus behavior:

- Owner can connect Nexus from the dashboard using SSO-ready flow or direct API key.
- API key is encrypted at rest and stored in `app.sqlite` when dashboard connect is used.
- Tracks Nexus-installed mods in `HYTALE_NEXUS_STATE_PATH`.
- Mod disable/enable/delete actions keep Nexus tracking metadata in sync.
- Download/install behavior depends on Nexus account permissions (premium/direct-download constraints may apply).

## Security notes

- The dashboard uses HTTP-only session cookies.
- Only authenticated users can open the WebSocket control channel.
- Invite creation/revoke is owner-only.
- For internet-exposed deployments, run behind HTTPS and set `PUBLIC_BASE_URL` accordingly.

## Data layout

Under `DATA_DIR`:

- `app.sqlite` - users/sessions/invites/app settings
- `hytale-server/` - managed server runtime files
- `uploads/` - temporary upload chunks
- `backups/` - backup directories + metadata
- `.hytale-manager-secret.key` - generated encryption key for dashboard-stored secrets (unless `HYTALE_SECRET_KEY` is set)

## License

ISC License. See the LICENSE file for details.

## Links

- Repository: https://github.com/oglofus/hytale-manager
- Releases: https://github.com/oglofus/hytale-manager/releases
