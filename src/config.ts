import path from "node:path";
import { mkdirSync } from "node:fs";

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

const cwd = path.resolve(Bun.env.HYTALE_MANAGER_CWD ?? process.cwd());
const resolveFromCwd = (pathname: string): string => {
  return path.isAbsolute(pathname) ? pathname : path.resolve(cwd, pathname);
};
const host = Bun.env.HOST ?? "127.0.0.1";
const port = Number(Bun.env.PORT ?? 3000);
const dataDir = resolveFromCwd(Bun.env.DATA_DIR ?? path.join(cwd, "data"));
const serverDir = resolveFromCwd(Bun.env.HYTALE_SERVER_DIR ?? path.join(dataDir, "hytale-server"));
const backupsDir = resolveFromCwd(Bun.env.BACKUPS_DIR ?? path.join(dataDir, "backups"));
const uploadsDir = resolveFromCwd(Bun.env.UPLOADS_DIR ?? path.join(dataDir, "uploads"));
const toolsDir = resolveFromCwd(Bun.env.TOOLS_DIR ?? path.join(dataDir, "tools"));
const publicHost = host === "0.0.0.0" || host === "::" ? "localhost" : host;
const publicBaseUrl = Bun.env.PUBLIC_BASE_URL ?? `http://${publicHost}:${port}`;
const sessionCookieSecure = Bun.env.SESSION_COOKIE_SECURE
  ? Bun.env.SESSION_COOKIE_SECURE === "true"
  : Bun.env.NODE_ENV === "production";

const smtp = Bun.env.SMTP_HOST && Bun.env.SMTP_USER && Bun.env.SMTP_PASS && Bun.env.SMTP_FROM
  ? {
      host: Bun.env.SMTP_HOST,
      port: Number(Bun.env.SMTP_PORT ?? 587),
      secure: (Bun.env.SMTP_SECURE ?? "false") === "true",
      user: Bun.env.SMTP_USER,
      pass: Bun.env.SMTP_PASS,
      from: Bun.env.SMTP_FROM,
    }
  : null;

export const config = {
  app: {
    host,
    port,
    sessionCookieSecure,
    sessionTtlHours: Number(Bun.env.SESSION_TTL_HOURS ?? 24 * 14),
    inviteTtlHours: Number(Bun.env.INVITE_TTL_HOURS ?? 72),
    publicBaseUrl,
    dataDir,
    dbPath: path.join(dataDir, "app.sqlite"),
    uploadsDir,
    backupsDir,
    toolsDir,
  },
  hytale: {
    serverDir,
    managedJavaDir: resolveFromCwd(Bun.env.HYTALE_MANAGED_JAVA_DIR ?? path.join(toolsDir, "temurin-jdk-25")),
    downloadCacheDir: resolveFromCwd(Bun.env.HYTALE_DOWNLOAD_CACHE_DIR ?? path.join(toolsDir, "download-cache")),
    curseForgeStatePath: resolveFromCwd(Bun.env.HYTALE_CURSEFORGE_STATE_PATH ?? path.join(dataDir, "curseforge-mods.json")),
    curseForgeApiHost: Bun.env.HYTALE_CURSEFORGE_API_HOST ?? "api.curseforge.com",
    curseForgeApiKey: Bun.env.HYTALE_CURSEFORGE_API_KEY ?? Bun.env.CURSEFORGE_API_KEY ?? "",
    curseForgeGameId: Number(Bun.env.HYTALE_CURSEFORGE_GAME_ID ?? Bun.env.CURSEFORGE_GAME_ID ?? 70216),
    curseForgeClassId: Number(Bun.env.HYTALE_CURSEFORGE_CLASS_ID ?? Bun.env.CURSEFORGE_CLASS_ID ?? 0),
    curseForgeDefaultPageSize: Number(Bun.env.HYTALE_CURSEFORGE_PAGE_SIZE ?? 20),
    nexusStatePath: resolveFromCwd(Bun.env.HYTALE_NEXUS_STATE_PATH ?? path.join(dataDir, "nexus-mods.json")),
    nexusApiHost: Bun.env.HYTALE_NEXUS_API_HOST ?? "api.nexusmods.com",
    nexusWebHost: Bun.env.HYTALE_NEXUS_WEB_HOST ?? "www.nexusmods.com",
    nexusSsoWsUrl: Bun.env.HYTALE_NEXUS_SSO_WS_URL ?? "wss://sso.nexusmods.com",
    nexusApiKey: Bun.env.HYTALE_NEXUS_API_KEY ?? Bun.env.NEXUS_API_KEY ?? "",
    nexusGameDomain: Bun.env.HYTALE_NEXUS_GAME_DOMAIN ?? Bun.env.NEXUS_GAME_DOMAIN ?? "hytale",
    nexusAppId: Bun.env.HYTALE_NEXUS_APP_ID ?? Bun.env.NEXUS_APP_ID ?? "",
    nexusApplicationName: Bun.env.HYTALE_NEXUS_APPLICATION_NAME ?? "hytale-manager",
    nexusApplicationVersion: Bun.env.HYTALE_NEXUS_APPLICATION_VERSION ?? "1.0.0",
    nexusProtocolVersion: Bun.env.HYTALE_NEXUS_PROTOCOL_VERSION ?? "1.0.0",
    nexusDefaultPageSize: Number(Bun.env.HYTALE_NEXUS_PAGE_SIZE ?? 20),
    downloadConcurrency: Number(Bun.env.HYTALE_DOWNLOAD_CONCURRENCY ?? 6),
    downloadProgressIntervalMs: Number(Bun.env.HYTALE_DOWNLOAD_PROGRESS_INTERVAL_MS ?? 2_000),
    adoptiumApiHost: Bun.env.HYTALE_ADOPTIUM_API_HOST ?? "api.adoptium.net",
    adoptiumFeatureVersion: Number(Bun.env.HYTALE_ADOPTIUM_FEATURE_VERSION ?? 25),
    javaDownloadTimeoutMs: Number(Bun.env.HYTALE_JAVA_DOWNLOAD_TIMEOUT_MS ?? 3_600_000),
    javaExtractTimeoutMs: Number(Bun.env.HYTALE_JAVA_EXTRACT_TIMEOUT_MS ?? 900_000),
    startArgs: Bun.env.HYTALE_START_ARGS ?? "-XX:AOTCache=HytaleServer.aot -jar HytaleServer.jar --assets Assets.zip",
    stopCommand: Bun.env.HYTALE_STOP_COMMAND ?? "/stop",
    downloaderCredentialsPath: resolveFromCwd(
      Bun.env.HYTALE_DOWNLOADER_CREDENTIALS_PATH ?? path.join(dataDir, ".hytale-downloader-credentials.json"),
    ),
    downloaderEnvironment: Bun.env.HYTALE_DOWNLOADER_ENVIRONMENT ?? "release",
    oauthHost: Bun.env.HYTALE_OAUTH_HOST ?? "oauth.accounts.hytale.com",
    oauthAutoOpenBrowser: (Bun.env.HYTALE_OAUTH_AUTO_OPEN_BROWSER ?? "true") === "true",
    accountDataHost: Bun.env.HYTALE_ACCOUNT_DATA_HOST ?? "account-data.hytale.com",
    downloaderClientId: Bun.env.HYTALE_DOWNLOADER_CLIENT_ID ?? "hytale-downloader",
    downloaderScope: Bun.env.HYTALE_DOWNLOADER_SCOPE ?? "auth:downloader",
    downloaderApiTimeoutMs: Number(Bun.env.HYTALE_DOWNLOADER_API_TIMEOUT_MS ?? 30_000),
    downloaderDownloadTimeoutMs: Number(Bun.env.HYTALE_DOWNLOADER_DOWNLOAD_TIMEOUT_MS ?? 3_600_000),
    downloaderExtractTimeoutMs: Number(Bun.env.HYTALE_DOWNLOADER_EXTRACT_TIMEOUT_MS ?? 1_800_000),
    oauthDevicePollTimeoutMs: Number(Bun.env.HYTALE_OAUTH_DEVICE_POLL_TIMEOUT_MS ?? 600_000),
    defaultPatchline: Bun.env.HYTALE_PATCHLINE ?? "release",
    startupTimeoutMs: Number(Bun.env.HYTALE_STARTUP_TIMEOUT_MS ?? 120_000),
    shutdownTimeoutMs: Number(Bun.env.HYTALE_SHUTDOWN_TIMEOUT_MS ?? 15_000),
    terminalBufferLines: Number(Bun.env.TERMINAL_BUFFER_LINES ?? 4_000),
  },
  smtp: smtp as SmtpConfig | null,
} as const;

export function ensureDirectories(): void {
  mkdirSync(config.app.dataDir, { recursive: true });
  mkdirSync(config.app.uploadsDir, { recursive: true });
  mkdirSync(config.app.backupsDir, { recursive: true });
  mkdirSync(config.app.toolsDir, { recursive: true });
  mkdirSync(path.dirname(config.hytale.managedJavaDir), { recursive: true });
  mkdirSync(config.hytale.downloadCacheDir, { recursive: true });
  mkdirSync(path.dirname(config.hytale.curseForgeStatePath), { recursive: true });
  mkdirSync(path.dirname(config.hytale.nexusStatePath), { recursive: true });
  mkdirSync(path.dirname(config.hytale.downloaderCredentialsPath), { recursive: true });
  mkdirSync(config.hytale.serverDir, { recursive: true });
  mkdirSync(path.join(config.hytale.serverDir, "mods"), { recursive: true });
  mkdirSync(path.join(config.hytale.serverDir, "logs"), { recursive: true });
}

export function parseArgs(raw: string): string[] {
  const result: string[] = [];
  const re = /\"([^\"]*)\"|'([^']*)'|([^\s]+)/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(raw)) !== null) {
    result.push(match[1] ?? match[2] ?? match[3] ?? "");
  }

  return result;
}
