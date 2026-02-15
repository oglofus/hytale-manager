# Hytale Manager [![GitHub Release](https://img.shields.io/github/v/release/oglofus/hytale-manager)](https://github.com/oglofus/hytale-manager/releases) [![Release and publish package](https://github.com/oglofus/hytale-manager/actions/workflows/release-package.yml/badge.svg)](https://github.com/oglofus/hytale-manager/actions/workflows/release-package.yml)

A Bun-first web dashboard for managing a single Hytale server instance.

## What it supports

- Install Hytale server:
  - Native downloader mode via built-in Bun OAuth flow (OAuth device auth + signed asset URLs).
  - Installs latest version for the configured patchline and exposes update availability.
- Start, stop, and restart the server.
- Runtime settings from dashboard:
  - Port/bind + native backup controls.
  - JVM heap controls (`-Xms`, `-Xmx`) and extra JVM args.
- Live terminal output and command input over WebSocket.
- Live runtime metrics while running:
  - CPU usage over time.
  - Memory usage (RSS/virtual) over time.
  - Network receive/transmit throughput over time.
- Log file browsing (`logs/`) and terminal history view.
- Whitelist management:
  - Toggle whitelist enabled/disabled.
  - Add/remove whitelist entries from the dashboard.
  - Accepts UUID or username input (username resolves to UUID).
  - Displays username labels for UUID entries when available.
- Mod management:
  - Upload `.jar` / `.zip` mods over WebSocket.
  - Sync a local mods folder: only top-level `.jar` / `.zip` files are considered (subfolders and other files are ignored); server mods are reconciled to match.
  - On upload, replaces older files with the same plugin identity (resolved from `manifest.json` when available, otherwise filename parsing like `<name>-<version>.jar|zip`).
  - Reads plugin metadata from archive `manifest.json` to display plugin name/version in the dashboard.
  - Disable/enable (rename with `.disabled`).
  - Delete mods.
- Backup management:
  - Create manual dashboard backups.
  - Configure native Hytale automatic backups (`--backup`, `--backup-frequency`, `--backup-max-count`).
  - List/delete/restore native ZIP backups (including `archive/`) and manual backups.
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

Listen on a specific host/IP and port:

```bash
bunx --package github:oglofus/hytale-manager hytale-manager --listen 100.75.73.157:3000
```

Auto-configure local-network HTTP mode (host, port, public URL, and non-secure session cookie):

```bash
bunx --package github:oglofus/hytale-manager hytale-manager --listen http://100.75.73.157:3000
```

Run from GitHub Packages (requires GitHub Packages auth):

```bash
bunx @oglofus/hytale-manager
```

To use that command, configure `.npmrc`:

```ini
@oglofus:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
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

- `HOST` (default: `127.0.0.1`)
- `PORT` (default: `3000`)
- `DATA_DIR` (default: `./data`)
- `HYTALE_SERVER_DIR` (default: `${DATA_DIR}/hytale-server`)
- `BACKUPS_DIR` (default: `${DATA_DIR}/backups`)
- `UPLOADS_DIR` (default: `${DATA_DIR}/uploads`)
- `TOOLS_DIR` (default: `${DATA_DIR}/tools`)
- `PUBLIC_BASE_URL` (default: `http://<HOST>:<PORT>`; if `HOST` is `0.0.0.0`/`::`, defaults to `http://localhost:<PORT>`)
- `HYTALE_SECRET_KEY` (optional but recommended) - master secret used for dashboard-managed secret encryption.

Auth/session:

- `SESSION_TTL_HOURS` (default: `336`)
- `INVITE_TTL_HOURS` (default: `72`)
- `SESSION_COOKIE_SECURE` (default: `true` when `PUBLIC_BASE_URL` is `https://...`, otherwise `false`) - override cookie security behavior if needed.
  - Automatically set from `--listen http://...` (`false`) or `--listen https://...` (`true`).

Hytale runtime/install:

- `HYTALE_MANAGED_JAVA_DIR` (default: `${TOOLS_DIR}/temurin-jdk-25`)
- `HYTALE_DOWNLOAD_CACHE_DIR` (default: `${TOOLS_DIR}/download-cache`)
- `HYTALE_SERVER_BACKUPS_DIR` (default: `${HYTALE_SERVER_DIR}/backups`) - native Hytale ZIP backup directory used by automatic backup mode.
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
- `HYTALE_METRICS_SAMPLE_INTERVAL_MS` (default: `2000`)
- `HYTALE_METRICS_HISTORY_POINTS` (default: `300`)

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

## GitHub release and package workflow

GitHub Actions workflow: `.github/workflows/release-package.yml`

- Triggers on:
  - tag push `v*` (for example `v0.1.1`)
  - manual `workflow_dispatch` (input tag)
- Validates tag version matches `package.json` version
- Runs `bun run check` + `bun run build`
- Publishes the package to GitHub Packages (`https://npm.pkg.github.com`)
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
- Runtime defaults are `-Xms2048m -Xmx4096m` (editable in dashboard runtime settings).
- Extra JVM flags can be set in dashboard runtime settings (for example GC tuning flags).

Whitelist behavior:

- `whitelist.json` is managed directly in `HYTALE_SERVER_DIR`.
- The file remains UUID-based; dashboard shows usernames as labels.
- Username labels are resolved from local player data (`universe/players`), local cache, and a best-effort remote lookup.

## Security notes

- The dashboard uses HTTP-only session cookies.
- Only authenticated users can open the WebSocket control channel.
- Invite creation/revoke is owner-only.
- For internet-exposed deployments, run behind HTTPS and set `PUBLIC_BASE_URL` accordingly.

## Data layout

Under `DATA_DIR`:

- `app.sqlite` - users/sessions/invites/app settings
- `hytale-server/` - managed server runtime files
- `hytale-server/backups/` - native Hytale ZIP backups (`archive/` for rotated backups)
- `uploads/` - temporary upload chunks
- `backups/` - backup directories + metadata
- `.hytale-manager-secret.key` - generated encryption key for dashboard-stored secrets (unless `HYTALE_SECRET_KEY` is set)

## License

ISC License. See the LICENSE file for details.

## Links

- Repository: https://github.com/oglofus/hytale-manager
- Releases: https://github.com/oglofus/hytale-manager/releases
- GitHub Packages: https://github.com/orgs/oglofus/packages?repo_name=hytale-manager
