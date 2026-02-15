import path from "node:path";
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createWriteStream, WriteStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { config, parseArgs } from "./config";
import { getAppSetting, setAppSetting } from "./db";
import { decryptSecret, encryptSecret } from "./secrets";
import { AppError, pathExists, sanitizeFilename, sleep, timestampId } from "./utils";

export type ServerStatus = "stopped" | "starting" | "running" | "stopping" | "installing";

type BroadcastFn = (event: string, payload: unknown) => void;
type StreamType = "stdout" | "stderr" | "system";

type UploadSession = {
  id: string;
  filename: string;
  tempPath: string;
  size: number;
  received: number;
  stream: WriteStream;
};

type ModIdentity = {
  pluginKey: string | null;
  pluginName: string;
  pluginVersion: string | null;
  metadataSource: "manifest" | "filename" | "unknown";
};

type ModMetadataCacheEntry = {
  size: number;
  mtimeMs: number;
  identity: ModIdentity;
};

type NetworkCounterSample = {
  atMs: number;
  rxBytes: number;
  txBytes: number;
};

type InstallAvailability = {
  patchline: string;
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
};

export type ModEntry = {
  filename: string;
  size: number;
  updatedAt: string;
  disabled: boolean;
  pluginName: string;
  pluginVersion: string | null;
  metadataSource: "manifest" | "filename" | "unknown";
};

export type ServerMetricPoint = {
  timestamp: string;
  cpuPercent: number;
  rssBytes: number;
  virtualMemoryBytes: number;
  networkRxBytesPerSec: number | null;
  networkTxBytesPerSec: number | null;
};

export type CurseForgeSearchSort = "popularity" | "lastUpdated" | "name" | "author" | "totalDownloads";

export type CurseForgeSearchMod = {
  id: number;
  name: string;
  summary: string;
  authors: string[];
  downloadCount: number;
  dateModified: string;
  dateReleased: string;
  logoUrl: string | null;
  websiteUrl: string | null;
};

export type CurseForgeSearchResult = {
  mods: CurseForgeSearchMod[];
  page: number;
  pageSize: number;
  totalCount: number;
  sort: CurseForgeSearchSort;
  query: string;
};

export type CurseForgeInstalledMod = {
  modId: number;
  modName: string;
  authorNames: string[];
  fileId: number;
  fileName: string;
  localFilename: string;
  installedAt: string;
  dateModified: string;
  websiteUrl: string | null;
  updateAvailable: boolean;
  latestFileId: number | null;
  latestFileName: string | null;
  localFileMissing: boolean;
};

export type NexusSearchSort = "popularity" | "downloads" | "lastUpdated" | "name";

export type NexusSearchMod = {
  modId: number;
  uid: string;
  name: string;
  summary: string;
  author: string;
  downloads: number;
  endorsements: number;
  updatedAt: string;
  createdAt: string;
  thumbnailUrl: string | null;
  version: string;
};

export type NexusSearchResult = {
  mods: NexusSearchMod[];
  page: number;
  pageSize: number;
  totalCount: number;
  sort: NexusSearchSort;
  query: string;
};

export type NexusInstalledMod = {
  modId: number;
  modUid: string;
  modName: string;
  author: string;
  fileId: number;
  fileUid: string;
  fileName: string;
  fileVersion: string;
  localFilename: string;
  installedAt: string;
  updatedAt: string;
  pageUrl: string;
  updateAvailable: boolean;
  latestFileId: number | null;
  latestFileName: string | null;
  localFileMissing: boolean;
};

export type LogFileSummary = {
  name: string;
  size: number;
  modifiedAt: string;
};

export type BackupEntry = {
  id: string;
  name: string;
  createdAt: string;
  note: string;
  size: number;
  archived: boolean;
  source: "manual" | "native";
  format: "directory" | "zip";
  itemCount: number;
};

export type WhitelistEntry = {
  uuid: string;
  username: string | null;
  lastSeenAt: string | null;
  source: "local-player" | "cache" | "remote" | "unknown";
};

export type WhitelistState = {
  enabled: boolean;
  entries: WhitelistEntry[];
};

type BackupMetadata = {
  id: string;
  createdAt: string;
  note: string;
  items: string[];
};

type WhitelistFileData = {
  enabled: boolean;
  list: string[];
};

type PlayerNameCacheEntry = {
  username: string;
  updatedAt: string;
};

type PlayerNameCacheData = {
  byUuid: Record<string, PlayerNameCacheEntry>;
};

type InstalledServerMetadata = {
  patchline: string;
  version: string;
  installedAt: string;
};

type JavaRuntimeInstallResult = {
  javaCommand: string;
  javaHome: string;
  releaseName: string;
};

type DownloaderCredentials = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  environment: string;
};

type OAuthDeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
};

type OAuthTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type VersionManifest = {
  version: string;
  download_url: string;
  sha256: string;
};

type AdoptiumBinaryPackage = {
  name?: string;
  link?: string;
  checksum?: string | null;
  size?: number;
};

type AdoptiumAsset = {
  release_name?: string;
  binary?: {
    package?: AdoptiumBinaryPackage;
  };
};

type DownloadRequestOptions = {
  cacheKey?: string;
  expectedSha256?: string | null;
};

type RangeProbeResult = {
  totalBytes: number;
};

type CurseForgeStoredMod = {
  modId: number;
  modName: string;
  authorNames: string[];
  fileId: number;
  fileName: string;
  localFilename: string;
  installedAt: string;
  dateModified: string;
  websiteUrl: string | null;
};

type CurseForgeStore = {
  version: number;
  mods: CurseForgeStoredMod[];
};

type NexusStoredMod = {
  modId: number;
  modUid: string;
  modName: string;
  author: string;
  fileId: number;
  fileUid: string;
  fileName: string;
  fileVersion: string;
  localFilename: string;
  installedAt: string;
  updatedAt: string;
  pageUrl: string;
};

type NexusStore = {
  version: number;
  mods: NexusStoredMod[];
};

type CurseForgeApiPagination = {
  index: number;
  pageSize: number;
  resultCount: number;
  totalCount: number;
};

type CurseForgeApiResponse<T> = {
  data: T;
  pagination?: CurseForgeApiPagination;
};

type CurseForgeApiAuthor = {
  id: number;
  name: string;
  url?: string;
};

type CurseForgeApiAsset = {
  url?: string;
  thumbnailUrl?: string;
};

type CurseForgeApiLinks = {
  websiteUrl?: string;
};

type CurseForgeApiFileHash = {
  value?: string;
  algo?: number;
};

type CurseForgeApiFile = {
  id?: number;
  modId?: number;
  fileName?: string;
  displayName?: string;
  fileDate?: string;
  downloadUrl?: string | null;
  isAvailable?: boolean;
  hashes?: CurseForgeApiFileHash[];
};

type CurseForgeApiMod = {
  id?: number;
  name?: string;
  summary?: string;
  authors?: CurseForgeApiAuthor[];
  downloadCount?: number;
  dateModified?: string;
  dateReleased?: string;
  logo?: CurseForgeApiAsset | null;
  links?: CurseForgeApiLinks | null;
  latestFiles?: CurseForgeApiFile[];
};

type NexusRuntimeConfig = {
  apiHost: string;
  webHost: string;
  ssoWsUrl: string;
  apiKey: string;
  gameDomain: string;
  appId: string;
  appName: string;
  appVersion: string;
  protocolVersion: string;
  pageSize: number;
  source: "env" | "dashboard";
  premium: boolean;
  userName: string;
};

type NexusApiKeyValidation = {
  user_id?: number;
  key?: string | null;
  name?: string;
  is_premium?: boolean;
  is_supporter?: boolean;
  email?: string;
  profile_url?: string;
};

type NexusGraphQlResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type NexusGraphQlModNode = {
  modId: number;
  uid: string;
  name: string;
  summary: string;
  author: string | null;
  downloads: number;
  endorsements: number;
  updatedAt: string;
  createdAt: string;
  thumbnailUrl: string | null;
  pictureUrl: string | null;
  version: string;
};

type NexusGraphQlModsPage = {
  mods: {
    nodes: NexusGraphQlModNode[];
    totalCount: number;
  };
};

type NexusRestModInfo = {
  mod_id?: number;
  uid?: number | string;
  name?: string;
  summary?: string;
  author?: string;
  version?: string;
  picture_url?: string;
};

type NexusRestFileInfo = {
  file_id?: number;
  uid?: number | string;
  name?: string;
  version?: string;
  uploaded_timestamp?: number;
  is_primary?: boolean;
  category_name?: string;
  category_id?: number;
  size?: number;
  file_name?: string;
  uploaded_time?: string;
  mod_version?: string;
};

type NexusRestModFiles = {
  files?: NexusRestFileInfo[];
  file_updates?: Array<{
    new_file_id?: number;
    old_file_id?: number;
    uploaded_timestamp?: number;
  }>;
};

type NexusRestDownloadUrl = {
  URI?: string;
  name?: string;
  short_name?: string;
};

type NexusResolvedFile = {
  fileId: number;
  fileUid: string;
  fileName: string;
  fileVersion: string;
  uploadedTimestamp: number;
  rawFileName: string;
  isPrimary: boolean;
};

type CurseForgeRuntimeConfig = {
  apiHost: string;
  apiKey: string;
  gameId: number;
  classId: number;
  pageSize: number;
  source: "env" | "dashboard";
};

type ServerRuntimeSettings = {
  bindPort: number;
  autoBackupEnabled: boolean;
  backupFrequencyMinutes: number;
  backupMaxCount: number;
  backupDirectory: string;
  javaMinHeapMb: number;
  javaMaxHeapMb: number;
  javaExtraArgs: string;
};

const CURSEFORGE_SETTING_API_KEY = "curseforge.api_key.encrypted";
const CURSEFORGE_SETTING_GAME_ID = "curseforge.game_id";
const CURSEFORGE_SETTING_CLASS_ID = "curseforge.class_id";
const NEXUS_SETTING_API_KEY = "nexus.api_key.encrypted";
const NEXUS_SETTING_GAME_DOMAIN = "nexus.game_domain";
const NEXUS_SETTING_IS_PREMIUM = "nexus.is_premium";
const NEXUS_SETTING_USER_NAME = "nexus.user_name";
const SERVER_BIND_PORT_SETTING = "server.bind_port";
const SERVER_AUTO_BACKUP_ENABLED_SETTING = "server.auto_backup_enabled";
const SERVER_BACKUP_FREQUENCY_MINUTES_SETTING = "server.backup_frequency_minutes";
const SERVER_BACKUP_MAX_COUNT_SETTING = "server.backup_max_count";
const SERVER_JAVA_MIN_HEAP_MB_SETTING = "server.java_min_heap_mb";
const SERVER_JAVA_MAX_HEAP_MB_SETTING = "server.java_max_heap_mb";
const SERVER_JAVA_EXTRA_ARGS_SETTING = "server.java_extra_args";
const DEFAULT_SERVER_BIND_PORT = 25565;
const DEFAULT_BACKUP_FREQUENCY_MINUTES = 30;
const DEFAULT_BACKUP_MAX_COUNT = 12;
const DEFAULT_SERVER_JAVA_MIN_HEAP_MB = 2048;
const DEFAULT_SERVER_JAVA_MAX_HEAP_MB = 4096;

export class HytaleManager {
  private process: Bun.Subprocess<"pipe", "pipe", "pipe"> | null = null;
  private status: ServerStatus = "stopped";
  private startedAt: string | null = null;
  private lastExitCode: number | null = null;
  private readonly terminalBuffer: string[] = [];
  private readonly modMetadataCache = new Map<string, ModMetadataCacheEntry>();
  private metricsTimer: Timer | null = null;
  private metricsCollecting = false;
  private metricsHistory: ServerMetricPoint[] = [];
  private previousNetworkSample: NetworkCounterSample | null = null;
  private readonly uploads = new Map<string, UploadSession>();
  private javaInstallPromise: Promise<JavaRuntimeInstallResult> | null = null;
  private initializationPromise: Promise<void> | null = null;
  private latestVersionCache: { patchline: string; manifest: VersionManifest; fetchedAt: number } | null = null;
  private broadcast: BroadcastFn;

  constructor(broadcast: BroadcastFn) {
    this.broadcast = broadcast;
  }

  setBroadcast(fn: BroadcastFn): void {
    this.broadcast = fn;
  }

  async snapshot() {
    const managedJavaCommand = await this.getManagedJavaCommandIfInstalled();
    const installed = await this.isInstalled();
    const installAvailability = await this.getInstallAvailability();
    const runtimeSettings = await this.getServerRuntimeSettings();
    const startArgs = this.buildStartArguments(runtimeSettings);
    const command = managedJavaCommand
      ? [managedJavaCommand, ...startArgs].join(" ")
      : `Install Adoptium JDK 25 first, then run: <managed-java> ${startArgs.join(" ")}`;
    return {
      status: this.status,
      startedAt: this.startedAt,
      lastExitCode: this.lastExitCode,
      installed,
      javaInstalled: !!managedJavaCommand,
      lifecycleReady: installed && !!managedJavaCommand,
      installedVersion: installAvailability.installedVersion,
      latestVersion: installAvailability.latestVersion,
      updateAvailable: installAvailability.updateAvailable,
      patchline: installAvailability.patchline,
      command,
      serverDir: config.hytale.serverDir,
      bindPort: runtimeSettings.bindPort,
      autoBackupEnabled: runtimeSettings.autoBackupEnabled,
      backupFrequencyMinutes: runtimeSettings.backupFrequencyMinutes,
      backupMaxCount: runtimeSettings.backupMaxCount,
      backupDir: runtimeSettings.backupDirectory,
      javaMinHeapMb: runtimeSettings.javaMinHeapMb,
      javaMaxHeapMb: runtimeSettings.javaMaxHeapMb,
      javaExtraArgs: runtimeSettings.javaExtraArgs,
      metricsSampling: this.status === "running" || this.status === "starting",
      metricsSampleIntervalMs: this.getMetricsSampleIntervalMs(),
      metricsHistoryLimit: this.getMetricsHistoryLimit(),
      metrics: this.metricsHistory,
      terminal: this.terminalBuffer,
    };
  }

  async updateServerRuntimeSettings(input: {
    bindPort?: number;
    autoBackupEnabled?: boolean;
    backupFrequencyMinutes?: number;
    backupMaxCount?: number;
    javaMinHeapMb?: number;
    javaMaxHeapMb?: number;
    javaExtraArgs?: string;
  }): Promise<Awaited<ReturnType<HytaleManager["snapshot"]>>> {
    const current = await this.getServerRuntimeSettings();
    const next: ServerRuntimeSettings = { ...current };

    if (input.bindPort !== undefined) {
      if (!Number.isInteger(input.bindPort) || input.bindPort < 1 || input.bindPort > 65535) {
        throw new AppError(400, "bindPort must be an integer between 1 and 65535.");
      }
      next.bindPort = input.bindPort;
    }

    if (input.autoBackupEnabled !== undefined) {
      next.autoBackupEnabled = input.autoBackupEnabled;
    }

    if (input.backupFrequencyMinutes !== undefined) {
      if (
        !Number.isInteger(input.backupFrequencyMinutes) ||
        input.backupFrequencyMinutes < 1 ||
        input.backupFrequencyMinutes > 24 * 60
      ) {
        throw new AppError(400, "backupFrequencyMinutes must be an integer between 1 and 1440.");
      }
      next.backupFrequencyMinutes = input.backupFrequencyMinutes;
    }

    if (input.backupMaxCount !== undefined) {
      if (!Number.isInteger(input.backupMaxCount) || input.backupMaxCount < 1 || input.backupMaxCount > 500) {
        throw new AppError(400, "backupMaxCount must be an integer between 1 and 500.");
      }
      next.backupMaxCount = input.backupMaxCount;
    }

    if (input.javaMinHeapMb !== undefined) {
      if (!Number.isInteger(input.javaMinHeapMb) || input.javaMinHeapMb < 256 || input.javaMinHeapMb > 1024 * 1024) {
        throw new AppError(400, "javaMinHeapMb must be an integer between 256 and 1048576.");
      }
      next.javaMinHeapMb = input.javaMinHeapMb;
    }

    if (input.javaMaxHeapMb !== undefined) {
      if (!Number.isInteger(input.javaMaxHeapMb) || input.javaMaxHeapMb < 256 || input.javaMaxHeapMb > 1024 * 1024) {
        throw new AppError(400, "javaMaxHeapMb must be an integer between 256 and 1048576.");
      }
      next.javaMaxHeapMb = input.javaMaxHeapMb;
    }

    if (next.javaMinHeapMb > next.javaMaxHeapMb) {
      throw new AppError(400, "javaMinHeapMb cannot be greater than javaMaxHeapMb.");
    }

    if (input.javaExtraArgs !== undefined) {
      const candidate = String(input.javaExtraArgs ?? "").trim();
      if (candidate.length > 2000) {
        throw new AppError(400, "javaExtraArgs is too long (maximum 2000 characters).");
      }

      const parsedArgs = parseArgs(candidate);
      if (parsedArgs.some((token) => token.toLowerCase() === "-jar")) {
        throw new AppError(400, "javaExtraArgs cannot include '-jar'.");
      }
      if (parsedArgs.some((token) => this.isManagedJavaRuntimeArgument(token))) {
        throw new AppError(
          400,
          "javaExtraArgs cannot include -Xms/-Xmx. Use javaMinHeapMb and javaMaxHeapMb instead.",
        );
      }
      next.javaExtraArgs = candidate;
    }

    setAppSetting(SERVER_BIND_PORT_SETTING, String(next.bindPort));
    setAppSetting(SERVER_AUTO_BACKUP_ENABLED_SETTING, next.autoBackupEnabled ? "1" : "0");
    setAppSetting(SERVER_BACKUP_FREQUENCY_MINUTES_SETTING, String(next.backupFrequencyMinutes));
    setAppSetting(SERVER_BACKUP_MAX_COUNT_SETTING, String(next.backupMaxCount));
    setAppSetting(SERVER_JAVA_MIN_HEAP_MB_SETTING, String(next.javaMinHeapMb));
    setAppSetting(SERVER_JAVA_MAX_HEAP_MB_SETTING, String(next.javaMaxHeapMb));
    setAppSetting(SERVER_JAVA_EXTRA_ARGS_SETTING, next.javaExtraArgs);

    await mkdir(next.backupDirectory, { recursive: true });

    this.pushTerminal(
      `Runtime settings updated: bind=0.0.0.0:${next.bindPort}, autoBackup=${next.autoBackupEnabled ? "on" : "off"}, backupFrequency=${next.backupFrequencyMinutes}m, backupMaxCount=${next.backupMaxCount}, javaHeap=${next.javaMinHeapMb}m-${next.javaMaxHeapMb}m.`,
      "system",
    );

    if (this.status === "running" || this.status === "starting") {
      this.pushTerminal("Runtime settings will apply fully on the next server restart.", "system");
    }

    return await this.snapshot();
  }

  async install(): Promise<{ installed: boolean; version: string; updated: boolean; applied: boolean }> {
    if (this.status !== "stopped") {
      throw new AppError(409, "Server must be stopped before installation.");
    }

    this.status = "installing";
    this.emitState();

    try {
      const installedMeta = await this.readInstalledServerMetadata();
      const latest = await this.resolveLatestReleaseManifest(true);
      const wasInstalled = await this.isInstalled();

      if (
        wasInstalled &&
        installedMeta &&
        installedMeta.patchline === latest.patchline &&
        installedMeta.version === latest.manifest.version
      ) {
        this.pushTerminal(
          `Server is already on latest patchline ${latest.patchline} version ${latest.manifest.version}; skipping install.`,
          "system",
        );
        return {
          installed: true,
          version: latest.manifest.version,
          updated: false,
          applied: false,
        };
      }

      await this.installFromDownloader(latest.patchline, latest.manifest);
      this.pushTerminal(`Installation completed in ${config.hytale.serverDir}`, "system");

      await this.writeInstalledServerMetadata({
        patchline: latest.patchline,
        version: latest.manifest.version,
        installedAt: new Date().toISOString(),
      });

      return {
        installed: await this.isInstalled(),
        version: latest.manifest.version,
        updated: wasInstalled,
        applied: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pushTerminal(`Installation failed: ${message}`, "system");
      throw error;
    } finally {
      this.status = "stopped";
      this.emitState();
    }
  }

  startInitializationAfterOwnerSetup(): void {
    if (this.initializationPromise) {
      this.pushTerminal("Initialization is already running; duplicate trigger ignored.", "system");
      return;
    }

    const run = (async () => {
      this.pushTerminal("Owner account created. Starting automatic initialization (server + Adoptium JDK 25).", "system");

      try {
        await this.install();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.pushTerminal(`Automatic server installation failed: ${message}`, "system");
      }

      try {
        const javaCommand = await this.getManagedJavaCommandIfInstalled();
        if (javaCommand) {
          this.pushTerminal("Adoptium JDK 25 is already installed; skipping Java download.", "system");
        } else {
          await this.installManagedJavaRuntime();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.pushTerminal(`Automatic Java installation failed: ${message}`, "system");
      }

      const prerequisites = await this.getLifecyclePrerequisites();
      if (prerequisites.serverInstalled && prerequisites.javaCommand) {
        this.pushTerminal("Automatic initialization complete. Server is ready to start.", "system");
      } else {
        this.pushTerminal(
          "Automatic initialization completed with missing prerequisites. Review terminal logs and retry failed steps.",
          "system",
        );
      }
    })();

    this.initializationPromise = run.finally(() => {
      this.initializationPromise = null;
    });
  }

  async connectCurseForge(options: { apiKey: string; gameId: number; classId?: number }): Promise<{
    configured: boolean;
    gameId: number;
    classId: number;
  }> {
    const apiKey = options.apiKey.trim();
    const gameId = Math.trunc(options.gameId);
    const classId = Math.max(0, Math.trunc(options.classId ?? 0));

    if (!apiKey) {
      throw new AppError(400, "CurseForge API key is required.");
    }
    if (gameId <= 0) {
      throw new AppError(400, "CurseForge game ID must be a positive integer.");
    }

    const candidate: CurseForgeRuntimeConfig = {
      apiHost: config.hytale.curseForgeApiHost,
      apiKey,
      gameId,
      classId,
      pageSize: config.hytale.curseForgeDefaultPageSize,
      source: "dashboard",
    };

    await this.fetchCurseForgeApi<{ id?: number; name?: string }>(
      candidate,
      `https://${candidate.apiHost}/v1/games/${candidate.gameId}`,
      { method: "GET" },
    );

    const encryptedApiKey = await encryptSecret(apiKey);
    setAppSetting(CURSEFORGE_SETTING_API_KEY, encryptedApiKey);
    setAppSetting(CURSEFORGE_SETTING_GAME_ID, String(gameId));
    setAppSetting(CURSEFORGE_SETTING_CLASS_ID, String(classId));

    this.pushTerminal(`CurseForge connected and stored securely for gameId ${gameId}.`, "system");
    return {
      configured: true,
      gameId,
      classId,
    };
  }

  createNexusSsoChallenge(): { id: string; appId: string; url: string; wsUrl: string } {
    const appId = config.hytale.nexusAppId.trim();
    if (!appId) {
      throw new AppError(400, "Nexus SSO is not configured. Set HYTALE_NEXUS_APP_ID first.");
    }

    const id = randomUUID();
    return {
      id,
      appId,
      url: `https://${config.hytale.nexusWebHost}/sso?id=${encodeURIComponent(id)}`,
      wsUrl: config.hytale.nexusSsoWsUrl,
    };
  }

  async connectNexus(options: { apiKey: string; gameDomain?: string }): Promise<{
    configured: boolean;
    gameDomain: string;
    premium: boolean;
    userName: string;
  }> {
    const apiKey = options.apiKey.trim();
    const gameDomain = this.normalizeNexusDomain(options.gameDomain ?? config.hytale.nexusGameDomain);

    if (!apiKey) {
      throw new AppError(400, "Nexus API key is required.");
    }
    if (!gameDomain) {
      throw new AppError(400, "Nexus game domain is required and must be alphanumeric/hyphen (e.g. hytale).");
    }

    const candidate: NexusRuntimeConfig = {
      apiHost: config.hytale.nexusApiHost,
      webHost: config.hytale.nexusWebHost,
      ssoWsUrl: config.hytale.nexusSsoWsUrl,
      apiKey,
      gameDomain,
      appId: config.hytale.nexusAppId.trim(),
      appName: config.hytale.nexusApplicationName,
      appVersion: config.hytale.nexusApplicationVersion,
      protocolVersion: config.hytale.nexusProtocolVersion,
      pageSize: config.hytale.nexusDefaultPageSize,
      source: "dashboard",
      premium: false,
      userName: "",
    };

    const validation = await this.validateNexusApiKey(candidate);
    candidate.premium = !!validation.is_premium;
    candidate.userName = (validation.name ?? "").trim();
    await this.ensureNexusGameExists(candidate);

    const encryptedApiKey = await encryptSecret(apiKey);
    setAppSetting(NEXUS_SETTING_API_KEY, encryptedApiKey);
    setAppSetting(NEXUS_SETTING_GAME_DOMAIN, gameDomain);
    setAppSetting(NEXUS_SETTING_IS_PREMIUM, String(candidate.premium));
    setAppSetting(NEXUS_SETTING_USER_NAME, candidate.userName);

    this.pushTerminal(
      `Nexus connected (${gameDomain}) as ${candidate.userName || "user"}${candidate.premium ? ", premium" : ""}.`,
      "system",
    );

    return {
      configured: true,
      gameDomain,
      premium: candidate.premium,
      userName: candidate.userName || "Unknown",
    };
  }

  async searchNexusMods(options?: {
    query?: string;
    sort?: NexusSearchSort;
    page?: number;
    pageSize?: number;
  }): Promise<NexusSearchResult> {
    const nexus = await this.getNexusConfigOrThrow();
    const query = String(options?.query ?? "").trim();
    const sort = this.normalizeNexusSort(options?.sort ?? "popularity");
    const page = Math.max(1, Math.trunc(options?.page ?? 1));
    const pageSize = Math.max(1, Math.min(50, Math.trunc(options?.pageSize ?? nexus.pageSize)));
    const offset = (page - 1) * pageSize;

    const filter = this.buildNexusModsFilter(nexus.gameDomain, query);
    const sortInput = this.buildNexusModsSort(sort);

    const payload = await this.requestNexusGraphQl<NexusGraphQlModsPage>(
      nexus,
      `
      query SearchMods($filter: ModsFilter, $sort: [ModsSort!], $offset: Int, $count: Int) {
        mods(filter: $filter, sort: $sort, offset: $offset, count: $count) {
          totalCount
          nodes {
            modId
            uid
            name
            summary
            author
            downloads
            endorsements
            updatedAt
            createdAt
            thumbnailUrl
            pictureUrl
            version
          }
        }
      }
      `,
      {
        filter,
        sort: sortInput,
        offset,
        count: pageSize,
      },
    );

    const nodes = payload.mods?.nodes ?? [];
    const mods = nodes.map((item) => this.toNexusSearchMod(item));
    return {
      mods,
      page,
      pageSize,
      totalCount: payload.mods?.totalCount ?? mods.length,
      sort,
      query,
    };
  }

  async listNexusInstalledMods(checkUpdates = false): Promise<NexusInstalledMod[]> {
    const store = await this.readNexusStore();
    const modsDir = path.join(config.hytale.serverDir, "mods");

    const installed = await Promise.all(
      store.mods.map(async (item) => {
        const localPath = path.join(modsDir, item.localFilename);
        const localFileMissing = !(await pathExists(localPath));
        return {
          modId: item.modId,
          modUid: item.modUid,
          modName: item.modName,
          author: item.author,
          fileId: item.fileId,
          fileUid: item.fileUid,
          fileName: item.fileName,
          fileVersion: item.fileVersion,
          localFilename: item.localFilename,
          installedAt: item.installedAt,
          updatedAt: item.updatedAt,
          pageUrl: item.pageUrl,
          updateAvailable: false,
          latestFileId: null,
          latestFileName: null,
          localFileMissing,
        } as NexusInstalledMod;
      }),
    );

    const nexus = checkUpdates ? await this.getNexusConfig() : null;
    if (!checkUpdates || !nexus || installed.length === 0) {
      return installed.sort((a, b) => a.modName.localeCompare(b.modName));
    }

    let storeChanged = false;
    const byModId = new Map<number, NexusStoredMod>();
    for (const item of store.mods) {
      byModId.set(item.modId, item);
    }

    for (const item of installed) {
      try {
        const latestFile = await this.resolveLatestNexusFile(nexus, item.modId);
        if (!latestFile) {
          continue;
        }

        item.latestFileId = latestFile.fileId;
        item.latestFileName = latestFile.fileName;
        item.updateAvailable = latestFile.fileId !== item.fileId;

        const current = byModId.get(item.modId);
        if (!current) {
          continue;
        }

        const next: NexusStoredMod = {
          ...current,
          modName: current.modName,
          author: current.author,
        };

        if (JSON.stringify(current) !== JSON.stringify(next)) {
          byModId.set(item.modId, next);
          storeChanged = true;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.pushTerminal(`Nexus update check skipped for mod ${item.modId}: ${message}`, "system");
      }
    }

    if (storeChanged) {
      await this.writeNexusStore({
        version: 1,
        mods: Array.from(byModId.values()),
      });
    }

    return installed.sort((a, b) => a.modName.localeCompare(b.modName));
  }

  async installNexusMod(modId: number): Promise<{
    installedMod: NexusInstalledMod | null;
    mods: ModEntry[];
    installed: NexusInstalledMod[];
    alreadyInstalled: boolean;
  }> {
    const nexus = await this.getNexusConfigOrThrow();
    const safeModId = Math.trunc(modId);
    if (!Number.isFinite(safeModId) || safeModId <= 0) {
      throw new AppError(400, "modId must be a positive integer.");
    }

    const mod = await this.fetchNexusModById(nexus, safeModId);
    const latestFile = await this.resolveLatestNexusFile(nexus, safeModId);
    if (!latestFile) {
      throw new AppError(404, `No downloadable file found for Nexus mod ${safeModId}.`);
    }

    const installResult = await this.installNexusFile(nexus, mod, latestFile);
    const installed = await this.listNexusInstalledMods(true);
    return {
      installedMod: installed.find((item) => item.modId === safeModId) ?? null,
      mods: await this.listMods(),
      installed,
      alreadyInstalled: installResult.alreadyInstalled,
    };
  }

  async checkNexusUpdates(): Promise<NexusInstalledMod[]> {
    return await this.listNexusInstalledMods(true);
  }

  async updateNexusMod(modId: number): Promise<{
    updated: boolean;
    installedMod: NexusInstalledMod | null;
    installed: NexusInstalledMod[];
    mods: ModEntry[];
  }> {
    const nexus = await this.getNexusConfigOrThrow();
    const safeModId = Math.trunc(modId);
    if (!Number.isFinite(safeModId) || safeModId <= 0) {
      throw new AppError(400, "modId must be a positive integer.");
    }

    const store = await this.readNexusStore();
    const tracked = store.mods.find((item) => item.modId === safeModId);
    if (!tracked) {
      throw new AppError(404, "Mod is not installed from Nexus.");
    }

    const mod = await this.fetchNexusModById(nexus, safeModId);
    const latestFile = await this.resolveLatestNexusFile(nexus, safeModId);
    if (!latestFile) {
      throw new AppError(404, `No downloadable file found for Nexus mod ${safeModId}.`);
    }

    const result = await this.installNexusFile(nexus, mod, latestFile, tracked);
    const installed = await this.listNexusInstalledMods(true);
    return {
      updated: !result.alreadyInstalled,
      installedMod: installed.find((item) => item.modId === safeModId) ?? null,
      installed,
      mods: await this.listMods(),
    };
  }

  async updateAllNexusMods(): Promise<{
    updated: number;
    skipped: number;
    installed: NexusInstalledMod[];
    mods: ModEntry[];
  }> {
    const nexus = await this.getNexusConfigOrThrow();
    const store = await this.readNexusStore();

    let updated = 0;
    let skipped = 0;
    for (const tracked of store.mods) {
      try {
        const mod = await this.fetchNexusModById(nexus, tracked.modId);
        const latestFile = await this.resolveLatestNexusFile(nexus, tracked.modId);
        if (!latestFile) {
          skipped += 1;
          continue;
        }

        const result = await this.installNexusFile(nexus, mod, latestFile, tracked);
        if (result.alreadyInstalled) {
          skipped += 1;
        } else {
          updated += 1;
        }
      } catch (error) {
        skipped += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.pushTerminal(`Nexus update skipped for mod ${tracked.modId}: ${message}`, "system");
      }
    }

    return {
      updated,
      skipped,
      installed: await this.listNexusInstalledMods(true),
      mods: await this.listMods(),
    };
  }

  private async getServerRuntimeSettings(): Promise<ServerRuntimeSettings> {
    const javaHeapDefaults = this.resolveDefaultJavaHeapSettings();
    const bindPort = this.readIntegerSetting(SERVER_BIND_PORT_SETTING, DEFAULT_SERVER_BIND_PORT, 1, 65535);
    const autoBackupEnabled = this.readBooleanSetting(SERVER_AUTO_BACKUP_ENABLED_SETTING, true);
    const backupFrequencyMinutes = this.readIntegerSetting(
      SERVER_BACKUP_FREQUENCY_MINUTES_SETTING,
      DEFAULT_BACKUP_FREQUENCY_MINUTES,
      1,
      24 * 60,
    );
    const backupMaxCount = this.readIntegerSetting(SERVER_BACKUP_MAX_COUNT_SETTING, DEFAULT_BACKUP_MAX_COUNT, 1, 500);
    let javaMinHeapMb = this.readIntegerSetting(
      SERVER_JAVA_MIN_HEAP_MB_SETTING,
      javaHeapDefaults.minHeapMb,
      256,
      1024 * 1024,
    );
    let javaMaxHeapMb = this.readIntegerSetting(
      SERVER_JAVA_MAX_HEAP_MB_SETTING,
      javaHeapDefaults.maxHeapMb,
      256,
      1024 * 1024,
    );
    const javaExtraArgs = (getAppSetting(SERVER_JAVA_EXTRA_ARGS_SETTING) ?? "").trim();

    if (javaMinHeapMb > javaMaxHeapMb) {
      const fixedMin = Math.min(javaMinHeapMb, javaMaxHeapMb);
      const fixedMax = Math.max(javaMinHeapMb, javaMaxHeapMb);
      javaMinHeapMb = fixedMin;
      javaMaxHeapMb = fixedMax;
    }

    await mkdir(config.hytale.backupsDir, { recursive: true });

    return {
      bindPort,
      autoBackupEnabled,
      backupFrequencyMinutes,
      backupMaxCount,
      backupDirectory: config.hytale.backupsDir,
      javaMinHeapMb,
      javaMaxHeapMb,
      javaExtraArgs,
    };
  }

  private resolveDefaultJavaHeapSettings(): { minHeapMb: number; maxHeapMb: number } {
    const startArgs = parseArgs(config.hytale.startArgs);
    const configuredMin = this.extractJvmHeapOptionMb(startArgs, "-Xms");
    const configuredMax = this.extractJvmHeapOptionMb(startArgs, "-Xmx");

    const maxHeapMb = configuredMax ?? DEFAULT_SERVER_JAVA_MAX_HEAP_MB;
    const minHeapFallback = Math.min(DEFAULT_SERVER_JAVA_MIN_HEAP_MB, maxHeapMb);
    const minHeapMb = configuredMin ?? minHeapFallback;

    return {
      minHeapMb: Math.max(256, Math.min(minHeapMb, 1024 * 1024)),
      maxHeapMb: Math.max(256, Math.min(Math.max(maxHeapMb, minHeapMb), 1024 * 1024)),
    };
  }

  private extractJvmHeapOptionMb(args: string[], flag: "-Xms" | "-Xmx"): number | null {
    for (let index = 0; index < args.length; index += 1) {
      const token = args[index];
      if (token === flag) {
        const parsedNext = this.parseHeapSizeToMb(args[index + 1] ?? "");
        if (parsedNext !== null) {
          return parsedNext;
        }
        continue;
      }

      if (token.startsWith(flag)) {
        const parsedInline = this.parseHeapSizeToMb(token.slice(flag.length));
        if (parsedInline !== null) {
          return parsedInline;
        }
      }
    }

    return null;
  }

  private parseHeapSizeToMb(rawValue: string): number | null {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return null;
    }

    const match = /^([0-9]+)([kKmMgG]?)$/.exec(trimmed);
    if (!match) {
      return null;
    }

    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) {
      return null;
    }

    const unit = (match[2] ?? "").toLowerCase();
    if (unit === "g") {
      return amount * 1024;
    }
    if (unit === "k") {
      return Math.max(1, Math.round(amount / 1024));
    }
    return amount;
  }

  private readIntegerSetting(settingKey: string, fallback: number, min: number, max: number): number {
    const raw = getAppSetting(settingKey);
    const parsed = raw === null ? NaN : Number(raw);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      return fallback;
    }
    return parsed;
  }

  private readBooleanSetting(settingKey: string, fallback: boolean): boolean {
    const raw = getAppSetting(settingKey);
    if (raw === null) {
      return fallback;
    }

    const normalized = raw.trim().toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
      return false;
    }
    return fallback;
  }

  private buildStartArguments(runtimeSettings: ServerRuntimeSettings): string[] {
    const baseArgs = parseArgs(config.hytale.startArgs);
    const args = this.stripManagedRuntimeArgs(baseArgs);
    const jarIndex = args.indexOf("-jar");
    const preJarArgs = jarIndex >= 0 ? args.slice(0, jarIndex) : args.slice();
    const jarAndServerArgs = jarIndex >= 0 ? args.slice(jarIndex) : [];
    const javaRuntimeArgs = this.buildJavaRuntimeArgs(runtimeSettings);

    const composed = [...preJarArgs, ...javaRuntimeArgs, ...jarAndServerArgs];
    composed.push("--bind", `0.0.0.0:${runtimeSettings.bindPort}`);

    if (runtimeSettings.autoBackupEnabled) {
      composed.push(
        "--backup",
        "--backup-dir",
        runtimeSettings.backupDirectory,
        "--backup-frequency",
        String(runtimeSettings.backupFrequencyMinutes),
        "--backup-max-count",
        String(runtimeSettings.backupMaxCount),
      );
    }

    return composed;
  }

  private buildJavaRuntimeArgs(runtimeSettings: ServerRuntimeSettings): string[] {
    const args = [`-Xms${runtimeSettings.javaMinHeapMb}m`, `-Xmx${runtimeSettings.javaMaxHeapMb}m`];
    if (!runtimeSettings.javaExtraArgs) {
      return args;
    }

    const parsed = parseArgs(runtimeSettings.javaExtraArgs).filter(
      (arg) => !this.isManagedJavaRuntimeArgument(arg) && arg.toLowerCase() !== "-jar",
    );
    return [...args, ...parsed];
  }

  private isManagedJavaRuntimeArgument(value: string): boolean {
    const normalized = value.toLowerCase();
    if (normalized === "-xms" || normalized === "-xmx") {
      return true;
    }
    return /^-xms/i.test(value) || /^-xmx/i.test(value);
  }

  private stripManagedRuntimeArgs(args: string[]): string[] {
    const result: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
      const current = args[index];

      if (current === "--backup") {
        continue;
      }

      if (
        current === "--bind" ||
        current === "-b" ||
        current === "--backup-dir" ||
        current === "--backup-frequency" ||
        current === "--backup-max-count"
      ) {
        index += 1;
        continue;
      }

      if (current.toLowerCase() === "-xms" || current.toLowerCase() === "-xmx") {
        index += 1;
        continue;
      }

      if (this.isManagedJavaRuntimeArgument(current)) {
        continue;
      }

      result.push(current);
    }

    return result;
  }

  private getMetricsSampleIntervalMs(): number {
    const configured = Math.trunc(config.hytale.metricsSampleIntervalMs);
    if (!Number.isFinite(configured) || configured < 250) {
      return 2_000;
    }
    return configured;
  }

  private getMetricsHistoryLimit(): number {
    const configured = Math.trunc(config.hytale.metricsHistoryPoints);
    if (!Number.isFinite(configured) || configured < 10) {
      return 300;
    }
    return Math.min(10_000, configured);
  }

  private startMetricsCollection(pid: number): void {
    this.stopMetricsCollection();
    this.metricsHistory = [];
    this.previousNetworkSample = null;

    const sampleIntervalMs = this.getMetricsSampleIntervalMs();
    void this.collectAndBroadcastMetrics(pid);
    this.metricsTimer = setInterval(() => {
      void this.collectAndBroadcastMetrics(pid);
    }, sampleIntervalMs);
  }

  private stopMetricsCollection(): void {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
    this.metricsCollecting = false;
    this.previousNetworkSample = null;
  }

  private async collectAndBroadcastMetrics(pid: number): Promise<void> {
    if (this.metricsCollecting) {
      return;
    }

    if (!this.process || this.process.pid !== pid || this.status === "stopped") {
      return;
    }

    this.metricsCollecting = true;
    try {
      const processStats = await this.readProcessMetrics(pid);
      if (!processStats) {
        return;
      }

      const networkStats = await this.readSystemNetworkThroughput();
      const point: ServerMetricPoint = {
        timestamp: new Date().toISOString(),
        cpuPercent: processStats.cpuPercent,
        rssBytes: processStats.rssBytes,
        virtualMemoryBytes: processStats.virtualMemoryBytes,
        networkRxBytesPerSec: networkStats?.rxBytesPerSec ?? null,
        networkTxBytesPerSec: networkStats?.txBytesPerSec ?? null,
      };

      this.metricsHistory.push(point);
      const limit = this.getMetricsHistoryLimit();
      if (this.metricsHistory.length > limit) {
        this.metricsHistory.splice(0, this.metricsHistory.length - limit);
      }

      this.broadcast("server.metrics", {
        point,
      });
    } finally {
      this.metricsCollecting = false;
    }
  }

  private async readProcessMetrics(
    pid: number,
  ): Promise<{ cpuPercent: number; rssBytes: number; virtualMemoryBytes: number } | null> {
    const psBin = Bun.which("ps");
    if (!psBin) {
      return null;
    }

    const result = await this.runCommandCapture([psBin, "-p", String(pid), "-o", "pcpu=,rss=,vsz="]);
    if (result.code !== 0) {
      return null;
    }

    const line = result.stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0)[0];
    if (!line) {
      return null;
    }

    const parts = line.split(/\s+/);
    const cpuPercent = Number(parts[0] ?? NaN);
    const rssKb = Number(parts[1] ?? NaN);
    const vmsKb = Number(parts[2] ?? NaN);
    if (!Number.isFinite(cpuPercent) || !Number.isFinite(rssKb) || !Number.isFinite(vmsKb)) {
      return null;
    }

    return {
      cpuPercent: Math.max(0, cpuPercent),
      rssBytes: Math.max(0, rssKb) * 1024,
      virtualMemoryBytes: Math.max(0, vmsKb) * 1024,
    };
  }

  private async readSystemNetworkThroughput(): Promise<{ rxBytesPerSec: number; txBytesPerSec: number } | null> {
    const counters = await this.readSystemNetworkCounters();
    if (!counters) {
      this.previousNetworkSample = null;
      return null;
    }

    const now = Date.now();
    const previous = this.previousNetworkSample;
    this.previousNetworkSample = {
      atMs: now,
      rxBytes: counters.rxBytes,
      txBytes: counters.txBytes,
    };

    if (!previous) {
      return null;
    }

    const deltaMs = now - previous.atMs;
    if (deltaMs <= 0) {
      return null;
    }

    const elapsedSeconds = deltaMs / 1000;
    const rxBytesPerSec = Math.max(0, (counters.rxBytes - previous.rxBytes) / elapsedSeconds);
    const txBytesPerSec = Math.max(0, (counters.txBytes - previous.txBytes) / elapsedSeconds);
    return {
      rxBytesPerSec,
      txBytesPerSec,
    };
  }

  private async readSystemNetworkCounters(): Promise<{ rxBytes: number; txBytes: number } | null> {
    if (process.platform === "linux") {
      return await this.readLinuxNetworkCounters();
    }

    if (process.platform === "darwin") {
      return await this.readDarwinNetworkCounters();
    }

    return null;
  }

  private async readLinuxNetworkCounters(): Promise<{ rxBytes: number; txBytes: number } | null> {
    const procPath = "/proc/net/dev";
    if (!(await pathExists(procPath))) {
      return null;
    }

    try {
      const raw = await readFile(procPath, "utf8");
      const lines = raw.split(/\r?\n/).slice(2);
      let rxBytes = 0;
      let txBytes = 0;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        const [ifaceRaw, countersRaw] = trimmed.split(":");
        if (!ifaceRaw || !countersRaw) {
          continue;
        }

        const iface = ifaceRaw.trim();
        if (iface === "lo" || iface.startsWith("lo")) {
          continue;
        }

        const counters = countersRaw.trim().split(/\s+/);
        const rx = Number(counters[0] ?? NaN);
        const tx = Number(counters[8] ?? NaN);
        if (!Number.isFinite(rx) || !Number.isFinite(tx)) {
          continue;
        }

        rxBytes += rx;
        txBytes += tx;
      }

      return { rxBytes, txBytes };
    } catch {
      return null;
    }
  }

  private async readDarwinNetworkCounters(): Promise<{ rxBytes: number; txBytes: number } | null> {
    const netstatBin = Bun.which("netstat");
    if (!netstatBin) {
      return null;
    }

    const result = await this.runCommandCapture([netstatBin, "-ibn"]);
    if (result.code !== 0 || result.stdout.trim().length === 0) {
      return null;
    }

    const lines = result.stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const headerLine = lines.find((line) => line.includes("Ibytes") && line.includes("Obytes"));
    if (!headerLine) {
      return null;
    }

    const headers = headerLine.trim().split(/\s+/);
    const rxIndex = headers.indexOf("Ibytes");
    const txIndex = headers.indexOf("Obytes");
    if (rxIndex < 0 || txIndex < 0) {
      return null;
    }

    const perInterface = new Map<string, { rx: number; tx: number }>();

    for (const line of lines) {
      if (line === headerLine) {
        continue;
      }

      const parts = line.trim().split(/\s+/);
      if (parts.length <= Math.max(rxIndex, txIndex)) {
        continue;
      }

      const iface = parts[0] ?? "";
      if (!iface || iface === "Name" || iface.startsWith("lo")) {
        continue;
      }

      const rx = Number(parts[rxIndex] ?? NaN);
      const tx = Number(parts[txIndex] ?? NaN);
      if (!Number.isFinite(rx) || !Number.isFinite(tx)) {
        continue;
      }

      const previous = perInterface.get(iface);
      if (!previous || rx + tx > previous.rx + previous.tx) {
        perInterface.set(iface, { rx, tx });
      }
    }

    let rxBytes = 0;
    let txBytes = 0;
    for (const entry of perInterface.values()) {
      rxBytes += entry.rx;
      txBytes += entry.tx;
    }

    return { rxBytes, txBytes };
  }

  async start(): Promise<void> {
    if (this.status === "running" || this.status === "starting") {
      throw new AppError(409, "Server is already running.");
    }

    const prerequisites = await this.getLifecyclePrerequisites();
    this.assertLifecycleReadiness(prerequisites, "start");

    this.status = "starting";
    this.emitState();

    try {
      const javaCommand = prerequisites.javaCommand;
      if (!javaCommand) {
        throw new AppError(500, "Java command is unavailable.");
      }

      const runtimeSettings = await this.getServerRuntimeSettings();
      const command = [javaCommand, ...this.buildStartArguments(runtimeSettings)];
      this.pushTerminal(`Starting server: ${command.join(" ")}`, "system");

      this.process = Bun.spawn(command, {
        cwd: config.hytale.serverDir,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: process.env,
      });

      this.startedAt = new Date().toISOString();
      this.status = "running";
      this.emitState();
      this.startMetricsCollection(this.process.pid);

      this.consumeStream(this.process.stdout, "stdout");
      this.consumeStream(this.process.stderr, "stderr");

      this.process.exited.then((code) => {
        this.stopMetricsCollection();
        this.lastExitCode = code;
        this.pushTerminal(`Server exited with code ${code}`, "system");
        this.process = null;
        this.status = "stopped";
        this.startedAt = null;
        this.emitState();
      });
    } catch (error) {
      this.stopMetricsCollection();
      this.status = "stopped";
      this.startedAt = null;
      this.emitState();
      throw error;
    }
  }

  async stop(force = false): Promise<void> {
    const prerequisites = await this.getLifecyclePrerequisites();

    if (!this.process || this.status === "stopped") {
      this.assertLifecycleReadiness(prerequisites, "stop");
      return;
    }

    const proc = this.process;
    this.status = "stopping";
    this.emitState();

    if (!force) {
      this.sendCommand(config.hytale.stopCommand);
      this.pushTerminal(`Stop signal sent: ${config.hytale.stopCommand}`, "system");
    }

    const graceful = await Promise.race([
      proc.exited.then(() => true),
      sleep(config.hytale.shutdownTimeoutMs).then(() => false),
    ]);

    if (!graceful) {
      this.pushTerminal("Graceful shutdown timed out, sending SIGTERM", "system");
      proc.kill();

      const terminated = await Promise.race([
        proc.exited.then(() => true),
        sleep(5_000).then(() => false),
      ]);

      if (!terminated) {
        this.pushTerminal("SIGTERM timed out, sending SIGKILL", "system");
        proc.kill("SIGKILL");
      }
    }
  }

  async restart(): Promise<void> {
    const prerequisites = await this.getLifecyclePrerequisites();
    this.assertLifecycleReadiness(prerequisites, "restart");

    await this.stop();
    await this.start();
  }

  async installManagedJavaRuntime(): Promise<JavaRuntimeInstallResult> {
    if (this.process || this.status !== "stopped") {
      throw new AppError(409, "Server must be stopped before installing Java.");
    }

    this.status = "installing";
    this.emitState();

    try {
      return await this.installAdoptiumJdk25();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pushTerminal(`Java installation failed: ${message}`, "system");
      throw error;
    } finally {
      this.status = "stopped";
      this.emitState();
    }
  }

  sendCommand(command: string): void {
    if (!this.process || this.status === "stopped") {
      throw new AppError(409, "Server is not running.");
    }

    const trimmed = command.trim();
    if (!trimmed) {
      throw new AppError(400, "Command cannot be empty.");
    }

    this.process.stdin.write(`${trimmed}\n`);
    this.pushTerminal(`> ${trimmed}`, "system");
  }

  async listMods(): Promise<ModEntry[]> {
    const modsDir = path.join(config.hytale.serverDir, "mods");
    await mkdir(modsDir, { recursive: true });

    const entries = await readdir(modsDir, { withFileTypes: true });
    const fileEntries = entries.filter((entry) => entry.isFile());
    const activePaths = new Set(fileEntries.map((entry) => path.join(modsDir, entry.name)));
    for (const cachedPath of this.modMetadataCache.keys()) {
      if (cachedPath.startsWith(`${modsDir}${path.sep}`) && !activePaths.has(cachedPath)) {
        this.modMetadataCache.delete(cachedPath);
      }
    }

    const mods = await Promise.all(
      fileEntries.map(async (entry) => await this.readModEntry(modsDir, entry.name)),
    );

    mods.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return mods;
  }

  async disableMod(filename: string): Promise<void> {
    const safeName = sanitizeFilename(filename);
    if (safeName.endsWith(".disabled")) {
      return;
    }

    await this.renameModFile(safeName, `${safeName}.disabled`);
  }

  async enableMod(filename: string): Promise<void> {
    const safeName = sanitizeFilename(filename);
    if (!safeName.endsWith(".disabled")) {
      return;
    }

    const restored = safeName.replace(/\.disabled$/, "");
    await this.renameModFile(safeName, restored);
  }

  async deleteMod(filename: string): Promise<void> {
    const safeName = sanitizeFilename(filename);
    const target = path.join(config.hytale.serverDir, "mods", safeName);
    if (!(await pathExists(target))) {
      throw new AppError(404, "Mod file not found.");
    }

    await rm(target, { force: true });
    this.invalidateModMetadataCacheEntry(target);
  }

  async listWhitelist(): Promise<WhitelistState> {
    const whitelist = await this.readWhitelistFile();
    const localProfiles = await this.readLocalPlayerProfileIndex();
    const cache = await this.readPlayerNameCache();
    let cacheChanged = false;

    const entries: WhitelistEntry[] = [];
    let remoteLookupBudget = 3;

    for (const uuid of whitelist.list) {
      const local = localProfiles.get(uuid);
      if (local) {
        const cached = cache.get(uuid);
        if (!cached || cached.username !== local.username) {
          cache.set(uuid, {
            username: local.username,
            updatedAt: new Date().toISOString(),
          });
          cacheChanged = true;
        }

        entries.push({
          uuid,
          username: local.username,
          lastSeenAt: local.lastSeenAt,
          source: "local-player",
        });
        continue;
      }

      const cached = cache.get(uuid);
      if (cached) {
        entries.push({
          uuid,
          username: cached.username,
          lastSeenAt: cached.updatedAt,
          source: "cache",
        });
        continue;
      }

      if (remoteLookupBudget > 0) {
        remoteLookupBudget -= 1;
        const resolved = await this.lookupHytalePlayerIdentity(uuid);
        if (resolved && resolved.uuid === uuid) {
          cache.set(uuid, {
            username: resolved.username,
            updatedAt: new Date().toISOString(),
          });
          cacheChanged = true;
          entries.push({
            uuid,
            username: resolved.username,
            lastSeenAt: null,
            source: "remote",
          });
          continue;
        }
      }

      entries.push({
        uuid,
        username: null,
        lastSeenAt: null,
        source: "unknown",
      });
    }

    if (cacheChanged) {
      await this.writePlayerNameCache(cache);
    }

    return {
      enabled: whitelist.enabled,
      entries,
    };
  }

  async setWhitelistEnabled(enabled: boolean): Promise<WhitelistState> {
    if (typeof enabled !== "boolean") {
      throw new AppError(400, "enabled must be a boolean.");
    }

    const whitelist = await this.readWhitelistFile();
    whitelist.enabled = enabled;
    await this.writeWhitelistFile(whitelist);

    this.pushTerminal(`Whitelist ${enabled ? "enabled" : "disabled"}.`, "system");
    const next = await this.listWhitelist();
    this.broadcast("whitelist.state", { whitelist: next });
    return next;
  }

  async addWhitelistEntry(value: string): Promise<WhitelistState> {
    const input = value.trim();
    if (!input) {
      throw new AppError(400, "username or UUID is required.");
    }

    const resolved = await this.resolveUuidFromWhitelistInput(input);
    const whitelist = await this.readWhitelistFile();

    if (!whitelist.list.includes(resolved.uuid)) {
      whitelist.list.push(resolved.uuid);
      await this.writeWhitelistFile(whitelist);
      this.pushTerminal(
        resolved.username
          ? `Whitelist added: ${resolved.username} (${resolved.uuid})`
          : `Whitelist added: ${resolved.uuid}`,
        "system",
      );
    }

    const next = await this.listWhitelist();
    this.broadcast("whitelist.state", { whitelist: next });
    return next;
  }

  async removeWhitelistEntry(uuidInput: string): Promise<WhitelistState> {
    const normalizedUuid = this.normalizeUuid(uuidInput);
    if (!normalizedUuid) {
      throw new AppError(400, "uuid must be a valid UUID.");
    }

    const whitelist = await this.readWhitelistFile();
    const before = whitelist.list.length;
    whitelist.list = whitelist.list.filter((uuid) => uuid !== normalizedUuid);
    if (whitelist.list.length === before) {
      throw new AppError(404, "Whitelist entry not found.");
    }

    await this.writeWhitelistFile(whitelist);
    this.pushTerminal(`Whitelist removed: ${normalizedUuid}`, "system");

    const next = await this.listWhitelist();
    this.broadcast("whitelist.state", { whitelist: next });
    return next;
  }

  private getWhitelistFilePath(): string {
    return path.join(config.hytale.serverDir, "whitelist.json");
  }

  private getPlayerNameCachePath(): string {
    return path.join(config.app.dataDir, ".hytale-player-name-cache.json");
  }

  private async readWhitelistFile(): Promise<WhitelistFileData> {
    const filePath = this.getWhitelistFilePath();
    if (!(await pathExists(filePath))) {
      const initial: WhitelistFileData = { enabled: false, list: [] };
      await this.writeWhitelistFile(initial);
      return initial;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(filePath, "utf8"));
    } catch {
      throw new AppError(500, "whitelist.json is not valid JSON.");
    }

    const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    const enabled = typeof record.enabled === "boolean" ? record.enabled : false;
    const rawList = Array.isArray(record.list) ? record.list : [];
    const list: string[] = [];
    const seen = new Set<string>();

    for (const item of rawList) {
      if (typeof item !== "string") {
        continue;
      }
      const uuid = this.normalizeUuid(item);
      if (!uuid || seen.has(uuid)) {
        continue;
      }
      seen.add(uuid);
      list.push(uuid);
    }

    return { enabled, list };
  }

  private async writeWhitelistFile(value: WhitelistFileData): Promise<void> {
    const data = {
      enabled: value.enabled,
      list: value.list,
    };
    await writeFile(this.getWhitelistFilePath(), JSON.stringify(data), "utf8");
  }

  private async readLocalPlayerProfileIndex(): Promise<Map<string, { username: string; lastSeenAt: string | null }>> {
    const index = new Map<string, { username: string; lastSeenAt: string | null }>();
    const playersDir = path.join(config.hytale.serverDir, "universe", "players");
    if (!(await pathExists(playersDir))) {
      return index;
    }

    const entries = await readdir(playersDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) {
        continue;
      }

      const uuid = this.normalizeUuid(entry.name.slice(0, -".json".length));
      if (!uuid) {
        continue;
      }

      const profilePath = path.join(playersDir, entry.name);
      try {
        const parsed = JSON.parse(await readFile(profilePath, "utf8")) as unknown;
        const username = this.extractUsernameFromPlayerProfile(parsed);
        if (!username) {
          continue;
        }

        const profileStat = await stat(profilePath);
        index.set(uuid, {
          username,
          lastSeenAt: profileStat.mtime.toISOString(),
        });
      } catch {
        continue;
      }
    }

    return index;
  }

  private extractUsernameFromPlayerProfile(payload: unknown): string | null {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }

    const root = payload as Record<string, unknown>;
    const directCandidates: unknown[] = [
      root.Username,
      root.username,
      root.PlayerName,
      root.playerName,
      root.DisplayName,
      root.displayName,
      root.Name,
      root.name,
      this.readNestedValue(root, ["Nameplate", "Text"]),
      this.readNestedValue(root, ["Nameplate", "text"]),
      this.readNestedValue(root, ["Nameplate", "Name"]),
      this.readNestedValue(root, ["Nameplate", "name"]),
      this.readNestedValue(root, ["DisplayName", "Text"]),
      this.readNestedValue(root, ["DisplayName", "text"]),
      this.readNestedValue(root, ["DisplayName", "Name"]),
      this.readNestedValue(root, ["DisplayName", "name"]),
    ];

    for (const candidate of directCandidates) {
      const username = this.normalizePlayerUsername(candidate);
      if (username) {
        return username;
      }
    }

    return this.findUsernameInNestedProfile(payload, 0);
  }

  private findUsernameInNestedProfile(payload: unknown, depth: number): string | null {
    if (depth > 5 || payload === null || payload === undefined) {
      return null;
    }

    if (typeof payload === "string") {
      return this.normalizePlayerUsername(payload);
    }

    if (Array.isArray(payload)) {
      for (const value of payload) {
        const resolved = this.findUsernameInNestedProfile(value, depth + 1);
        if (resolved) {
          return resolved;
        }
      }
      return null;
    }

    if (typeof payload !== "object") {
      return null;
    }

    const record = payload as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      const lower = key.toLowerCase();
      if (
        lower === "username" ||
        lower === "playername" ||
        lower === "displayname" ||
        lower === "nameplate" ||
        lower === "name"
      ) {
        const resolved = this.findUsernameInNestedProfile(value, depth + 1);
        if (resolved) {
          return resolved;
        }
      }
    }

    return null;
  }

  private readNestedValue(record: Record<string, unknown>, pathSegments: string[]): unknown {
    let current: unknown = record;
    for (const segment of pathSegments) {
      if (!current || typeof current !== "object" || Array.isArray(current)) {
        return null;
      }

      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }

  private normalizePlayerUsername(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 32) {
      return null;
    }
    if (this.normalizeUuid(trimmed)) {
      return null;
    }
    if (!/^[a-zA-Z0-9_]{2,32}$/.test(trimmed)) {
      return null;
    }
    return trimmed;
  }

  private normalizeUuid(value: string): string | null {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) {
      return null;
    }

    if (/^[0-9a-f]{32}$/.test(trimmed)) {
      return `${trimmed.slice(0, 8)}-${trimmed.slice(8, 12)}-${trimmed.slice(12, 16)}-${trimmed.slice(16, 20)}-${trimmed.slice(20)}`;
    }

    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(trimmed)) {
      return trimmed;
    }

    return null;
  }

  private async readPlayerNameCache(): Promise<Map<string, PlayerNameCacheEntry>> {
    const cachePath = this.getPlayerNameCachePath();
    if (!(await pathExists(cachePath))) {
      return new Map();
    }

    try {
      const parsed = JSON.parse(await readFile(cachePath, "utf8")) as PlayerNameCacheData;
      const byUuid = parsed && typeof parsed === "object" && parsed.byUuid && typeof parsed.byUuid === "object"
        ? parsed.byUuid
        : {};

      const cache = new Map<string, PlayerNameCacheEntry>();
      for (const [rawUuid, rawEntry] of Object.entries(byUuid)) {
        const uuid = this.normalizeUuid(rawUuid);
        const username = this.normalizePlayerUsername(rawEntry?.username);
        if (!uuid || !username) {
          continue;
        }

        const updatedAt = typeof rawEntry?.updatedAt === "string" && rawEntry.updatedAt.trim()
          ? rawEntry.updatedAt.trim()
          : new Date().toISOString();

        cache.set(uuid, {
          username,
          updatedAt,
        });
      }

      return cache;
    } catch {
      return new Map();
    }
  }

  private async writePlayerNameCache(cache: Map<string, PlayerNameCacheEntry>): Promise<void> {
    const payload: PlayerNameCacheData = {
      byUuid: {},
    };

    const sortedEntries = [...cache.entries()].sort((left, right) => left[0].localeCompare(right[0]));
    for (const [uuid, entry] of sortedEntries) {
      payload.byUuid[uuid] = {
        username: entry.username,
        updatedAt: entry.updatedAt,
      };
    }

    await writeFile(this.getPlayerNameCachePath(), JSON.stringify(payload, null, 2), "utf8");
  }

  private async resolveUuidFromWhitelistInput(input: string): Promise<{ uuid: string; username: string | null }> {
    const uuidInput = this.normalizeUuid(input);
    if (uuidInput) {
      return {
        uuid: uuidInput,
        username: null,
      };
    }

    const usernameInput = this.normalizePlayerUsername(input);
    if (!usernameInput) {
      throw new AppError(400, "Provide a valid username or UUID.");
    }

    const lower = usernameInput.toLowerCase();
    const localProfiles = await this.readLocalPlayerProfileIndex();
    for (const [uuid, profile] of localProfiles) {
      if (profile.username.toLowerCase() === lower) {
        const cache = await this.readPlayerNameCache();
        cache.set(uuid, {
          username: profile.username,
          updatedAt: new Date().toISOString(),
        });
        await this.writePlayerNameCache(cache);
        return {
          uuid,
          username: profile.username,
        };
      }
    }

    const cache = await this.readPlayerNameCache();
    for (const [uuid, entry] of cache) {
      if (entry.username.toLowerCase() === lower) {
        return {
          uuid,
          username: entry.username,
        };
      }
    }

    const remote = await this.lookupHytalePlayerIdentity(usernameInput);
    if (remote) {
      cache.set(remote.uuid, {
        username: remote.username,
        updatedAt: new Date().toISOString(),
      });
      await this.writePlayerNameCache(cache);
      return {
        uuid: remote.uuid,
        username: remote.username,
      };
    }

    const serverResolved = await this.tryResolveWhitelistUsernameViaServerCommand(usernameInput);
    if (serverResolved) {
      cache.set(serverResolved.uuid, {
        username: serverResolved.username,
        updatedAt: new Date().toISOString(),
      });
      await this.writePlayerNameCache(cache);
      return serverResolved;
    }

    if (this.status === "running" || this.status === "starting") {
      throw new AppError(
        404,
        `Could not resolve Hytale username '${usernameInput}'. Try adding the player's UUID directly.`,
      );
    }

    throw new AppError(
      404,
      `Could not resolve Hytale username '${usernameInput}'. Start the server and try again, or add the UUID directly.`,
    );
  }

  private async lookupHytalePlayerIdentity(identifier: string): Promise<{ uuid: string; username: string } | null> {
    const endpoint = `https://playerdb.co/api/player/hytale/${encodeURIComponent(identifier)}`;

    try {
      const response = await this.fetchWithTimeout(
        endpoint,
        { method: "GET" },
        Math.max(1_000, Math.min(config.hytale.downloaderApiTimeoutMs, 2_500)),
      );
      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as {
        data?: {
          player?: {
            id?: string;
            username?: string;
          };
        };
      };

      const uuid = this.normalizeUuid(payload.data?.player?.id ?? "");
      const username = this.normalizePlayerUsername(payload.data?.player?.username ?? "");
      if (!uuid || !username) {
        return null;
      }

      return { uuid, username };
    } catch {
      return null;
    }
  }

  private async tryResolveWhitelistUsernameViaServerCommand(
    username: string,
  ): Promise<{ uuid: string; username: string } | null> {
    if (!this.process || (this.status !== "running" && this.status !== "starting")) {
      return null;
    }

    const before = await this.readWhitelistFile();
    const beforeSet = new Set(before.list);

    try {
      this.sendCommand(`/whitelist add ${username}`);
    } catch {
      return null;
    }

    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      await sleep(300);
      const current = await this.readWhitelistFile();
      for (const uuid of current.list) {
        if (!beforeSet.has(uuid)) {
          return { uuid, username };
        }
      }
    }

    return null;
  }

  async searchCurseForgeMods(options?: {
    query?: string;
    sort?: CurseForgeSearchSort;
    page?: number;
    pageSize?: number;
  }): Promise<CurseForgeSearchResult> {
    const curseForge = await this.getCurseForgeConfigOrThrow();

    const query = String(options?.query ?? "").trim();
    const requestedSort = options?.sort ?? "popularity";
    const sort = this.normalizeCurseForgeSort(requestedSort);
    const page = Math.max(1, Math.trunc(options?.page ?? 1));
    const pageSize = Math.max(1, Math.min(50, Math.trunc(options?.pageSize ?? curseForge.pageSize)));
    const index = (page - 1) * pageSize;

    const sortFieldMap: Record<CurseForgeSearchSort, number> = {
      popularity: 2,
      lastUpdated: 3,
      name: 4,
      author: 5,
      totalDownloads: 6,
    };
    const sortOrder = sort === "name" || sort === "author" ? "asc" : "desc";

    const endpoint = new URL(`https://${curseForge.apiHost}/v1/mods/search`);
    endpoint.searchParams.set("gameId", String(curseForge.gameId));
    if (curseForge.classId > 0) {
      endpoint.searchParams.set("classId", String(curseForge.classId));
    }
    if (query) {
      endpoint.searchParams.set("searchFilter", query);
    }
    endpoint.searchParams.set("sortField", String(sortFieldMap[sort]));
    endpoint.searchParams.set("sortOrder", sortOrder);
    endpoint.searchParams.set("index", String(index));
    endpoint.searchParams.set("pageSize", String(pageSize));

    const response = await this.fetchCurseForgeApi<CurseForgeApiMod[]>(curseForge, endpoint.toString(), {
      method: "GET",
    });

    const mods = Array.isArray(response.data)
      ? response.data.map((mod) => this.toCurseForgeSearchMod(mod)).filter((mod): mod is CurseForgeSearchMod => !!mod)
      : [];

    return {
      mods,
      page,
      pageSize,
      totalCount: response.pagination?.totalCount ?? mods.length,
      sort,
      query,
    };
  }

  async listCurseForgeInstalledMods(checkUpdates = false): Promise<CurseForgeInstalledMod[]> {
    const store = await this.readCurseForgeStore();
    const modsDir = path.join(config.hytale.serverDir, "mods");

    const installed = await Promise.all(
      store.mods.map(async (item) => {
        const localPath = path.join(modsDir, item.localFilename);
        const localFileMissing = !(await pathExists(localPath));
        return {
          modId: item.modId,
          modName: item.modName,
          authorNames: [...item.authorNames],
          fileId: item.fileId,
          fileName: item.fileName,
          localFilename: item.localFilename,
          installedAt: item.installedAt,
          dateModified: item.dateModified,
          websiteUrl: item.websiteUrl,
          updateAvailable: false,
          latestFileId: null,
          latestFileName: null,
          localFileMissing,
        } as CurseForgeInstalledMod;
      }),
    );

    const curseForge = checkUpdates ? await this.getCurseForgeConfig() : null;
    if (!checkUpdates || installed.length === 0 || !curseForge) {
      return installed.sort((a, b) => a.modName.localeCompare(b.modName));
    }

    const refreshedStore = await this.readCurseForgeStore();
    const byId = new Map<number, CurseForgeStoredMod>();
    for (const item of refreshedStore.mods) {
      byId.set(item.modId, item);
    }

    const remoteMods = await this.fetchCurseForgeModsByIds(curseForge, installed.map((item) => item.modId));
    let storeChanged = false;

    for (const item of installed) {
      const remoteMod = remoteMods.get(item.modId);
      if (!remoteMod) {
        continue;
      }

      const remoteName = (remoteMod.name ?? "").trim();
      if (remoteName.length > 0) {
        item.modName = remoteName;
      }
      item.authorNames = this.extractCurseForgeAuthorNames(remoteMod.authors);
      item.dateModified = this.normalizeDateString(remoteMod.dateModified, item.dateModified);
      item.websiteUrl = this.normalizeStringOrNull(remoteMod.links?.websiteUrl);

      const latestFile = await this.resolveLatestCurseForgeFile(curseForge, item.modId, remoteMod.latestFiles);
      if (latestFile && typeof latestFile.id === "number") {
        item.latestFileId = latestFile.id;
        item.latestFileName = this.getCurseForgeFileDisplayName(latestFile);
        item.updateAvailable = item.latestFileId !== item.fileId;
      }

      const stored = byId.get(item.modId);
      if (!stored) {
        continue;
      }

      const nextStored: CurseForgeStoredMod = {
        ...stored,
        modName: item.modName,
        authorNames: [...item.authorNames],
        dateModified: item.dateModified,
        websiteUrl: item.websiteUrl,
      };

      if (JSON.stringify(stored) !== JSON.stringify(nextStored)) {
        byId.set(item.modId, nextStored);
        storeChanged = true;
      }
    }

    if (storeChanged) {
      await this.writeCurseForgeStore({
        version: 1,
        mods: Array.from(byId.values()),
      });
    }

    installed.sort((a, b) => a.modName.localeCompare(b.modName));
    return installed;
  }

  async installCurseForgeMod(modId: number): Promise<{
    installedMod: CurseForgeInstalledMod | null;
    mods: ModEntry[];
    installed: CurseForgeInstalledMod[];
    alreadyInstalled: boolean;
  }> {
    const curseForge = await this.getCurseForgeConfigOrThrow();

    const safeModId = Math.trunc(modId);
    if (!Number.isFinite(safeModId) || safeModId <= 0) {
      throw new AppError(400, "modId must be a positive integer.");
    }

    const mod = await this.fetchCurseForgeMod(curseForge, safeModId);
    const latestFile = await this.resolveLatestCurseForgeFile(curseForge, safeModId, mod.latestFiles);
    if (!latestFile || typeof latestFile.id !== "number") {
      throw new AppError(404, `No downloadable file is available for CurseForge mod ${safeModId}.`);
    }

    const result = await this.installCurseForgeFile(curseForge, mod, latestFile);
    const installed = await this.listCurseForgeInstalledMods(true);
    const installedMod = installed.find((item) => item.modId === safeModId) ?? null;

    return {
      installedMod,
      mods: await this.listMods(),
      installed,
      alreadyInstalled: result.alreadyInstalled,
    };
  }

  async checkCurseForgeUpdates(): Promise<CurseForgeInstalledMod[]> {
    return await this.listCurseForgeInstalledMods(true);
  }

  async updateCurseForgeMod(modId: number): Promise<{
    updated: boolean;
    installedMod: CurseForgeInstalledMod | null;
    installed: CurseForgeInstalledMod[];
    mods: ModEntry[];
  }> {
    const curseForge = await this.getCurseForgeConfigOrThrow();

    const safeModId = Math.trunc(modId);
    if (!Number.isFinite(safeModId) || safeModId <= 0) {
      throw new AppError(400, "modId must be a positive integer.");
    }

    const store = await this.readCurseForgeStore();
    const tracked = store.mods.find((item) => item.modId === safeModId);
    if (!tracked) {
      throw new AppError(404, "Mod is not installed from CurseForge.");
    }

    const mod = await this.fetchCurseForgeMod(curseForge, safeModId);
    const latestFile = await this.resolveLatestCurseForgeFile(curseForge, safeModId, mod.latestFiles);
    if (!latestFile || typeof latestFile.id !== "number") {
      throw new AppError(404, `No downloadable file is available for CurseForge mod ${safeModId}.`);
    }

    const result = await this.installCurseForgeFile(curseForge, mod, latestFile, tracked);
    const installed = await this.listCurseForgeInstalledMods(true);
    const installedMod = installed.find((item) => item.modId === safeModId) ?? null;

    return {
      updated: !result.alreadyInstalled,
      installedMod,
      installed,
      mods: await this.listMods(),
    };
  }

  async updateAllCurseForgeMods(): Promise<{
    updated: number;
    skipped: number;
    installed: CurseForgeInstalledMod[];
    mods: ModEntry[];
  }> {
    const curseForge = await this.getCurseForgeConfigOrThrow();

    const store = await this.readCurseForgeStore();
    if (store.mods.length === 0) {
      return {
        updated: 0,
        skipped: 0,
        installed: [],
        mods: await this.listMods(),
      };
    }

    let updated = 0;
    let skipped = 0;

    for (const tracked of store.mods) {
      try {
        const mod = await this.fetchCurseForgeMod(curseForge, tracked.modId);
        const latestFile = await this.resolveLatestCurseForgeFile(curseForge, tracked.modId, mod.latestFiles);
        if (!latestFile || typeof latestFile.id !== "number") {
          skipped += 1;
          continue;
        }

        const result = await this.installCurseForgeFile(curseForge, mod, latestFile, tracked);
        if (result.alreadyInstalled) {
          skipped += 1;
        } else {
          updated += 1;
        }
      } catch (error) {
        skipped += 1;
        const reason = error instanceof Error ? error.message : String(error);
        this.pushTerminal(`CurseForge update skipped for mod ${tracked.modId}: ${reason}`, "system");
      }
    }

    return {
      updated,
      skipped,
      installed: await this.listCurseForgeInstalledMods(true),
      mods: await this.listMods(),
    };
  }

  async startModUpload(filename: string, size: number): Promise<{ uploadId: string }> {
    const safeName = sanitizeFilename(filename);
    const lowerName = safeName.toLowerCase();
    if (!lowerName.endsWith(".jar") && !lowerName.endsWith(".zip")) {
      throw new AppError(400, "Only .jar and .zip mods are supported.");
    }

    if (size <= 0) {
      throw new AppError(400, "Upload size must be greater than zero.");
    }

    await mkdir(config.app.uploadsDir, { recursive: true });
    const uploadId = randomUUID();
    const tempPath = path.join(config.app.uploadsDir, `${uploadId}.part`);
    const stream = createWriteStream(tempPath, { flags: "w" });

    this.uploads.set(uploadId, {
      id: uploadId,
      filename: safeName,
      tempPath,
      size,
      received: 0,
      stream,
    });

    return { uploadId };
  }

  async appendModUpload(uploadId: string, chunkBase64: string): Promise<{ received: number; size: number }> {
    const upload = this.uploads.get(uploadId);
    if (!upload) {
      throw new AppError(404, "Upload session not found.");
    }

    const chunk = Buffer.from(chunkBase64, "base64");
    if (chunk.length === 0) {
      throw new AppError(400, "Upload chunk is empty.");
    }

    await new Promise<void>((resolve, reject) => {
      upload.stream.write(chunk, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    upload.received += chunk.length;
    return {
      received: upload.received,
      size: upload.size,
    };
  }

  async finishModUpload(uploadId: string): Promise<ModEntry> {
    const upload = this.uploads.get(uploadId);
    if (!upload) {
      throw new AppError(404, "Upload session not found.");
    }

    await new Promise<void>((resolve, reject) => {
      upload.stream.end((error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    const modsDir = path.join(config.hytale.serverDir, "mods");
    await mkdir(modsDir, { recursive: true });

    try {
      const uploadIdentity = await this.resolveModIdentity(upload.tempPath, upload.filename);
      if (uploadIdentity.pluginKey) {
        await this.removeExistingModsForPluginKey(modsDir, uploadIdentity.pluginKey);
      }

      const destination = path.join(modsDir, upload.filename);
      if (await pathExists(destination)) {
        await rm(destination, { force: true });
        this.invalidateModMetadataCacheEntry(destination);
      }

      await rename(upload.tempPath, destination);
      this.invalidateModMetadataCacheEntry(destination);
      this.pushTerminal(`Uploaded mod ${path.basename(destination)}.`, "system");
      return await this.readModEntry(modsDir, path.basename(destination), uploadIdentity);
    } finally {
      this.uploads.delete(uploadId);
      await rm(upload.tempPath, { force: true });
    }
  }

  async cancelModUpload(uploadId: string): Promise<void> {
    const upload = this.uploads.get(uploadId);
    if (!upload) {
      return;
    }

    upload.stream.destroy();
    await rm(upload.tempPath, { force: true });
    this.uploads.delete(uploadId);
  }

  private async readModEntry(modsDir: string, filename: string, identityOverride?: ModIdentity): Promise<ModEntry> {
    const fullPath = path.join(modsDir, filename);
    const fileStats = await stat(fullPath);

    let identity: ModIdentity;
    if (identityOverride) {
      identity = identityOverride;
      this.modMetadataCache.set(fullPath, {
        size: fileStats.size,
        mtimeMs: fileStats.mtimeMs,
        identity,
      });
    } else {
      identity = await this.resolveCachedModIdentity(fullPath, filename, fileStats.size, fileStats.mtimeMs);
    }

    return {
      filename,
      size: fileStats.size,
      updatedAt: fileStats.mtime.toISOString(),
      disabled: filename.endsWith(".disabled"),
      pluginName: identity.pluginName,
      pluginVersion: identity.pluginVersion,
      metadataSource: identity.metadataSource,
    };
  }

  private async resolveCachedModIdentity(
    fullPath: string,
    filename: string,
    size: number,
    mtimeMs: number,
  ): Promise<ModIdentity> {
    const cached = this.modMetadataCache.get(fullPath);
    if (cached && cached.size === size && cached.mtimeMs === mtimeMs) {
      return cached.identity;
    }

    const identity = await this.resolveModIdentity(fullPath, filename);
    this.modMetadataCache.set(fullPath, {
      size,
      mtimeMs,
      identity,
    });
    return identity;
  }

  private invalidateModMetadataCacheEntry(fullPath: string): void {
    this.modMetadataCache.delete(fullPath);
  }

  private async removeExistingModsForPluginKey(modsDir: string, pluginKey: string): Promise<void> {
    const entries = await readdir(modsDir, { withFileTypes: true });
    const removed: string[] = [];

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const fullPath = path.join(modsDir, entry.name);
      const fileStats = await stat(fullPath);
      const identity = await this.resolveCachedModIdentity(fullPath, entry.name, fileStats.size, fileStats.mtimeMs);
      if (identity.pluginKey !== pluginKey) {
        continue;
      }

      await rm(fullPath, { force: true });
      this.invalidateModMetadataCacheEntry(fullPath);
      removed.push(entry.name);
    }

    if (removed.length > 0) {
      this.pushTerminal(
        `Removed older mod builds with the same plugin name: ${removed.join(", ")}`,
        "system",
      );
    }
  }

  private async resolveModIdentity(archivePath: string, fallbackFilename: string): Promise<ModIdentity> {
    const fromManifest = await this.readPluginManifestFromArchive(archivePath, fallbackFilename);
    if (fromManifest?.name) {
      return {
        pluginKey: this.normalizePluginKey(fromManifest.name),
        pluginName: fromManifest.name,
        pluginVersion: fromManifest.version,
        metadataSource: "manifest",
      };
    }

    const fromFilename = this.parsePluginIdentityFromFilename(fallbackFilename);
    if (fromFilename) {
      return {
        pluginKey: this.normalizePluginKey(fromFilename.pluginName),
        pluginName: fromFilename.pluginName,
        pluginVersion: fromFilename.pluginVersion,
        metadataSource: "filename",
      };
    }

    const baseName = this.stripModArtifactExtensions(fallbackFilename) || sanitizeFilename(fallbackFilename);
    return {
      pluginKey: this.normalizePluginKey(baseName),
      pluginName: baseName,
      pluginVersion: null,
      metadataSource: "unknown",
    };
  }

  private normalizePluginKey(value: string): string | null {
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
    return normalized.length > 0 ? normalized : null;
  }

  private stripModArtifactExtensions(filename: string): string {
    let baseName = sanitizeFilename(filename);
    if (baseName.toLowerCase().endsWith(".disabled")) {
      baseName = baseName.slice(0, -".disabled".length);
    }
    if (baseName.toLowerCase().endsWith(".jar")) {
      baseName = baseName.slice(0, -".jar".length);
    } else if (baseName.toLowerCase().endsWith(".zip")) {
      baseName = baseName.slice(0, -".zip".length);
    }
    return baseName;
  }

  private parsePluginIdentityFromFilename(
    filename: string,
  ): { pluginName: string; pluginVersion: string | null } | null {
    const baseName = this.stripModArtifactExtensions(filename);
    if (!baseName) {
      return null;
    }

    const underscoreMatch = /^(.+?)_([0-9][a-zA-Z0-9._-]*)$/.exec(baseName);
    if (underscoreMatch) {
      return {
        pluginName: underscoreMatch[1] ?? baseName,
        pluginVersion: underscoreMatch[2] ?? null,
      };
    }

    const parts = baseName.split("-");
    let versionIndex = -1;
    for (let index = 1; index < parts.length; index += 1) {
      if (/^[0-9]/.test(parts[index] ?? "")) {
        versionIndex = index;
        break;
      }
    }

    if (versionIndex > 0) {
      return {
        pluginName: parts.slice(0, versionIndex).join("-"),
        pluginVersion: parts.slice(versionIndex).join("-"),
      };
    }

    return {
      pluginName: baseName,
      pluginVersion: null,
    };
  }

  private async readPluginManifestFromArchive(
    archivePath: string,
    fallbackFilename?: string,
  ): Promise<{ name: string; version: string | null } | null> {
    const nameForTypeCheck = sanitizeFilename(fallbackFilename ?? path.basename(archivePath)).toLowerCase();
    if (
      !nameForTypeCheck.endsWith(".jar") &&
      !nameForTypeCheck.endsWith(".zip") &&
      !nameForTypeCheck.endsWith(".jar.disabled") &&
      !nameForTypeCheck.endsWith(".zip.disabled")
    ) {
      return null;
    }

    const unzipBin = Bun.which("unzip");
    if (!unzipBin) {
      return null;
    }

    const listingResult = await this.runCommandCapture([unzipBin, "-Z1", archivePath]);
    if (listingResult.code !== 0) {
      return null;
    }

    const manifestCandidates = listingResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => path.basename(line).toLowerCase() === "manifest.json")
      .sort((left, right) => {
        const leftDepth = left.split("/").length;
        const rightDepth = right.split("/").length;
        if (leftDepth !== rightDepth) {
          return leftDepth - rightDepth;
        }
        return left.length - right.length;
      });

    for (const manifestPath of manifestCandidates) {
      const contentResult = await this.runCommandCapture([unzipBin, "-p", archivePath, manifestPath]);
      if (contentResult.code !== 0 || contentResult.stdout.trim().length === 0) {
        continue;
      }

      try {
        const parsed = JSON.parse(contentResult.stdout) as Record<string, unknown>;
        const name = this.normalizeStringOrNull(parsed.Name) ?? this.normalizeStringOrNull(parsed.name);
        if (!name) {
          continue;
        }

        const version = this.normalizeStringOrNull(parsed.Version) ?? this.normalizeStringOrNull(parsed.version);
        return {
          name,
          version,
        };
      } catch {
        continue;
      }
    }

    return null;
  }

  private async runCommandCapture(command: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const proc = Bun.spawn(command, {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });

    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
      proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
    ]);

    return {
      code,
      stdout,
      stderr,
    };
  }

  async listLogFiles(): Promise<LogFileSummary[]> {
    const logsDir = path.join(config.hytale.serverDir, "logs");
    await mkdir(logsDir, { recursive: true });

    const entries = await readdir(logsDir, { withFileTypes: true });
    const files: LogFileSummary[] = [];

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const filePath = path.join(logsDir, entry.name);
      const fileStats = await stat(filePath);
      files.push({
        name: entry.name,
        size: fileStats.size,
        modifiedAt: fileStats.mtime.toISOString(),
      });
    }

    files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    return files;
  }

  async readLogFile(name: string, tailLines = 300): Promise<string> {
    if (name === "__terminal__") {
      return this.terminalBuffer.join("\n");
    }

    const safeName = sanitizeFilename(name);
    const logsDir = path.join(config.hytale.serverDir, "logs");
    const fullPath = path.join(logsDir, safeName);

    if (!(await pathExists(fullPath))) {
      throw new AppError(404, "Log file not found.");
    }

    const text = await readFile(fullPath, "utf8");
    const lines = text.split(/\r?\n/);
    return lines.slice(-tailLines).join("\n");
  }

  async createBackup(note = ""): Promise<BackupEntry> {
    const backupId = timestampId();
    const destination = path.join(config.app.backupsDir, backupId);
    await mkdir(destination, { recursive: true });

    const copiedItems: string[] = [];
    for (const item of [
      "universe",
      "mods",
      "config.json",
      "permissions.json",
      "whitelist.json",
      "bans.json",
      "ops.json",
      "server.properties",
    ]) {
      const source = path.join(config.hytale.serverDir, item);
      if (!(await pathExists(source))) {
        continue;
      }

      const destinationPath = path.join(destination, item);
      const sourceStats = await stat(source);
      if (sourceStats.isDirectory()) {
        await cp(source, destinationPath, { recursive: true, force: true });
      } else {
        await copyFile(source, destinationPath);
      }

      copiedItems.push(item);
    }

    const metadata: BackupMetadata = {
      id: backupId,
      createdAt: new Date().toISOString(),
      note,
      items: copiedItems,
    };

    await writeFile(path.join(destination, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");

    return {
      id: this.encodeManualBackupId(backupId),
      name: backupId,
      createdAt: metadata.createdAt,
      note,
      size: 0,
      archived: false,
      source: "manual",
      format: "directory",
      itemCount: copiedItems.length,
    };
  }

  async listBackups(): Promise<BackupEntry[]> {
    await mkdir(config.app.backupsDir, { recursive: true });
    await mkdir(config.hytale.backupsDir, { recursive: true });

    const entries = await readdir(config.app.backupsDir, { withFileTypes: true });
    const backups: BackupEntry[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const metadataPath = path.join(config.app.backupsDir, entry.name, "metadata.json");
      if (await pathExists(metadataPath)) {
        const metadataRaw = await readFile(metadataPath, "utf8");
        const metadata = JSON.parse(metadataRaw) as BackupMetadata;
        const backupPath = path.join(config.app.backupsDir, entry.name);
        const directoryStats = await stat(backupPath);
        backups.push({
          id: this.encodeManualBackupId(metadata.id),
          name: metadata.id,
          createdAt: metadata.createdAt,
          note: metadata.note || "Manual dashboard backup",
          size: directoryStats.size,
          archived: false,
          source: "manual",
          format: "directory",
          itemCount: metadata.items.length,
        });
      } else {
        const dirStats = await stat(path.join(config.app.backupsDir, entry.name));
        backups.push({
          id: this.encodeManualBackupId(entry.name),
          name: entry.name,
          createdAt: dirStats.mtime.toISOString(),
          note: "Manual dashboard backup",
          size: dirStats.size,
          archived: false,
          source: "manual",
          format: "directory",
          itemCount: 0,
        });
      }
    }

    const nativeRootEntries = await readdir(config.hytale.backupsDir, { withFileTypes: true });
    for (const entry of nativeRootEntries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".zip")) {
        continue;
      }

      const fullPath = path.join(config.hytale.backupsDir, entry.name);
      const fileStats = await stat(fullPath);
      backups.push({
        id: this.encodeNativeBackupId(entry.name),
        name: entry.name,
        createdAt: fileStats.mtime.toISOString(),
        note: "Native Hytale backup",
        size: fileStats.size,
        archived: false,
        source: "native",
        format: "zip",
        itemCount: 1,
      });
    }

    const archiveDir = path.join(config.hytale.backupsDir, "archive");
    if (await pathExists(archiveDir)) {
      const archiveEntries = await readdir(archiveDir, { withFileTypes: true });
      for (const entry of archiveEntries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".zip")) {
          continue;
        }

        const fullPath = path.join(archiveDir, entry.name);
        const fileStats = await stat(fullPath);
        backups.push({
          id: this.encodeNativeBackupId(`archive/${entry.name}`),
          name: entry.name,
          createdAt: fileStats.mtime.toISOString(),
          note: "Archived native Hytale backup",
          size: fileStats.size,
          archived: true,
          source: "native",
          format: "zip",
          itemCount: 1,
        });
      }
    }

    backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return backups;
  }

  async deleteBackup(id: string): Promise<void> {
    const reference = await this.resolveBackupReference(id);
    if (reference.kind === "manual") {
      await rm(reference.path, { recursive: true, force: true });
      return;
    }

    await rm(reference.path, { force: true });
  }

  async restoreBackup(id: string): Promise<void> {
    if (this.status !== "stopped") {
      throw new AppError(409, "Server must be stopped before restoring backup.");
    }

    const reference = await this.resolveBackupReference(id);

    if (reference.kind === "manual") {
      const entries = await readdir(reference.path, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === "metadata.json") {
          continue;
        }

        const sourcePath = path.join(reference.path, entry.name);
        const destinationPath = path.join(config.hytale.serverDir, entry.name);
        await rm(destinationPath, { recursive: true, force: true });

        if (entry.isDirectory()) {
          await cp(sourcePath, destinationPath, { recursive: true, force: true });
        } else {
          await copyFile(sourcePath, destinationPath);
        }
      }

      this.pushTerminal(`Manual backup restored: ${reference.name}`, "system");
      return;
    }

    const restoreWorkspace = path.join(config.app.dataDir, `restore-${timestampId()}-${randomUUID()}`);
    await mkdir(restoreWorkspace, { recursive: true });

    try {
      this.pushTerminal(`Restoring native backup: ${reference.name}`, "system");
      await this.extractZipFile(reference.path, restoreWorkspace);

      const universeSource = await this.resolveUniverseDirectoryFromBackupExtract(restoreWorkspace);
      if (!universeSource) {
        throw new AppError(
          500,
          "Unable to locate a universe directory in the backup archive. Restore expects a backup ZIP with universe data.",
        );
      }

      const universeDestination = path.join(config.hytale.serverDir, "universe");
      await rm(universeDestination, { recursive: true, force: true });
      await cp(universeSource, universeDestination, { recursive: true, force: true });
      this.pushTerminal(`Native backup restored into ${universeDestination}`, "system");
    } finally {
      await rm(restoreWorkspace, { recursive: true, force: true });
    }
  }

  private encodeManualBackupId(name: string): string {
    return `manual:${name}`;
  }

  private encodeNativeBackupId(relativePath: string): string {
    return `native:${relativePath.replace(/\\/g, "/")}`;
  }

  private async resolveBackupReference(id: string): Promise<
    | { kind: "manual"; name: string; path: string }
    | { kind: "native"; name: string; path: string; archived: boolean }
  > {
    const value = id.trim();
    if (!value) {
      throw new AppError(400, "Backup id is required.");
    }

    if (value.startsWith("manual:")) {
      const name = sanitizeFilename(value.slice("manual:".length));
      const backupPath = path.join(config.app.backupsDir, name);
      if (!(await pathExists(backupPath))) {
        throw new AppError(404, "Backup not found.");
      }
      return { kind: "manual", name, path: backupPath };
    }

    if (value.startsWith("native:")) {
      const relativePath = value.slice("native:".length).trim();
      const parsed = this.resolveNativeBackupPath(relativePath);
      if (!(await pathExists(parsed.path))) {
        throw new AppError(404, "Backup not found.");
      }
      return parsed;
    }

    const legacyManualName = sanitizeFilename(value);
    const legacyManualPath = path.join(config.app.backupsDir, legacyManualName);
    if (await pathExists(legacyManualPath)) {
      return { kind: "manual", name: legacyManualName, path: legacyManualPath };
    }

    try {
      const legacyNative = this.resolveNativeBackupPath(legacyManualName);
      if (await pathExists(legacyNative.path)) {
        return legacyNative;
      }
    } catch {
      // Ignore and continue to other legacy id patterns.
    }

    try {
      const legacyArchived = this.resolveNativeBackupPath(`archive/${legacyManualName}`);
      if (await pathExists(legacyArchived.path)) {
        return legacyArchived;
      }
    } catch {
      // Ignore and finish with a not found error below.
    }

    throw new AppError(404, "Backup not found.");
  }

  private resolveNativeBackupPath(relativePath: string): { kind: "native"; name: string; path: string; archived: boolean } {
    const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalized || normalized.includes("..")) {
      throw new AppError(400, "Invalid backup id.");
    }

    const segments = normalized
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (segments.length === 0 || segments.length > 2) {
      throw new AppError(400, "Invalid backup id.");
    }

    const isArchived = segments[0] === "archive";
    if (segments.length === 2 && !isArchived) {
      throw new AppError(400, "Invalid backup id.");
    }

    if (segments.some((segment) => !/^[a-zA-Z0-9._-]+$/.test(segment))) {
      throw new AppError(400, "Invalid backup id.");
    }

    const name = segments[segments.length - 1];
    if (!name.toLowerCase().endsWith(".zip")) {
      throw new AppError(400, "Only ZIP backups are supported for native backups.");
    }

    const targetPath = path.resolve(config.hytale.backupsDir, ...segments);
    const relative = path.relative(config.hytale.backupsDir, targetPath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new AppError(400, "Invalid backup id.");
    }

    return {
      kind: "native",
      name,
      path: targetPath,
      archived: isArchived,
    };
  }

  private async resolveUniverseDirectoryFromBackupExtract(restoreWorkspace: string): Promise<string | null> {
    const directUniverse = path.join(restoreWorkspace, "universe");
    if (await this.isDirectory(directUniverse)) {
      return directUniverse;
    }

    if (await this.looksLikeUniverseDirectory(restoreWorkspace)) {
      return restoreWorkspace;
    }

    const entries = await readdir(restoreWorkspace, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const childPath = path.join(restoreWorkspace, entry.name);
      const childUniverse = path.join(childPath, "universe");
      if (await this.isDirectory(childUniverse)) {
        return childUniverse;
      }

      if (await this.looksLikeUniverseDirectory(childPath)) {
        return childPath;
      }
    }

    return null;
  }

  private async looksLikeUniverseDirectory(directoryPath: string): Promise<boolean> {
    if (!(await this.isDirectory(directoryPath))) {
      return false;
    }

    const entries = await readdir(directoryPath, { withFileTypes: true });
    if (entries.some((entry) => entry.isDirectory() && entry.name === "worlds")) {
      return true;
    }

    return entries.some((entry) => entry.isFile() && entry.name === "memories.json");
  }

  private async isDirectory(directoryPath: string): Promise<boolean> {
    if (!(await pathExists(directoryPath))) {
      return false;
    }

    try {
      const details = await stat(directoryPath);
      return details.isDirectory();
    } catch {
      return false;
    }
  }

  private async installFromDownloader(patchline: string, manifest: VersionManifest): Promise<void> {
    const installWorkspace = path.join(config.app.dataDir, `install-${timestampId()}`);
    await mkdir(installWorkspace, { recursive: true });

    const patchlineValue = patchline.trim();
    this.pushTerminal(
      `Native downloader mode enabled (patchline: ${patchlineValue}, version: ${manifest.version})`,
      "system",
    );

    const archiveSignedUrl = await this.withDownloaderToken((accessToken) =>
      this.getSignedAssetUrl(accessToken, manifest.download_url),
    );

    const archiveName = sanitizeFilename(`${patchlineValue}-${manifest.version}.zip`);
    const archivePath = path.join(installWorkspace, archiveName);
    await this.downloadFileWithProgress(archiveSignedUrl, archivePath, config.hytale.downloaderDownloadTimeoutMs, {
      cacheKey: `hytale-${patchlineValue}-${manifest.version}`,
      expectedSha256: manifest.sha256,
    });

    this.pushTerminal("Validating checksum...", "system");
    await this.validateSha256(archivePath, manifest.sha256);
    this.pushTerminal("Checksum valid.", "system");

    await this.extractZipFile(archivePath, installWorkspace);
    await rm(archivePath, { force: true });

    const layout = await this.locateDownloadedLayout(installWorkspace);
    if (!layout) {
      throw new AppError(500, "Downloaded archive extracted, but server layout was not found.");
    }

    await cp(layout.serverDir, config.hytale.serverDir, { recursive: true, force: true });
    await copyFile(layout.assetsPath, path.join(config.hytale.serverDir, "Assets.zip"));
    await mkdir(path.join(config.hytale.serverDir, "mods"), { recursive: true });
    await mkdir(path.join(config.hytale.serverDir, "logs"), { recursive: true });
  }

  private async getInstallAvailability(): Promise<InstallAvailability> {
    const patchline = config.hytale.defaultPatchline.trim() || "release";
    const installed = await this.isInstalled();
    const metadata = installed ? await this.readInstalledServerMetadata() : null;
    const installedVersion = metadata?.version ?? null;

    const latest = await this.tryResolveLatestReleaseManifestNonInteractive();
    const latestVersion = latest?.manifest.version ?? null;

    return {
      patchline,
      installedVersion,
      latestVersion,
      updateAvailable: !installed || (latestVersion !== null && installedVersion !== latestVersion),
    };
  }

  private async resolveLatestReleaseManifest(
    forceRefresh: boolean,
  ): Promise<{ patchline: string; manifest: VersionManifest }> {
    const patchline = config.hytale.defaultPatchline.trim() || "release";
    const now = Date.now();

    if (
      !forceRefresh &&
      this.latestVersionCache &&
      this.latestVersionCache.patchline === patchline &&
      now - this.latestVersionCache.fetchedAt < 60_000
    ) {
      return {
        patchline,
        manifest: this.latestVersionCache.manifest,
      };
    }

    const manifest = await this.withDownloaderToken((accessToken) =>
      this.fetchManifestWithAccessToken(accessToken, patchline, true),
    );
    this.latestVersionCache = {
      patchline,
      manifest,
      fetchedAt: now,
    };

    return { patchline, manifest };
  }

  private async tryResolveLatestReleaseManifestNonInteractive(): Promise<{ patchline: string; manifest: VersionManifest } | null> {
    const patchline = config.hytale.defaultPatchline.trim() || "release";
    const now = Date.now();

    if (
      this.latestVersionCache &&
      this.latestVersionCache.patchline === patchline &&
      now - this.latestVersionCache.fetchedAt < 60_000
    ) {
      return {
        patchline,
        manifest: this.latestVersionCache.manifest,
      };
    }

    const stored = await this.readDownloaderCredentials();
    if (!stored || stored.environment !== config.hytale.downloaderEnvironment || !stored.access_token.trim()) {
      return null;
    }

    let active = stored;
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (active.expires_at <= nowSeconds + 60) {
      if (!active.refresh_token.trim()) {
        return null;
      }

      const refreshed = await this.refreshDownloaderCredentials(active.refresh_token);
      if (!refreshed) {
        return null;
      }

      active = refreshed;
    }

    try {
      const manifest = await this.fetchManifestWithAccessToken(active.access_token, patchline, false);
      this.latestVersionCache = {
        patchline,
        manifest,
        fetchedAt: now,
      };
      return { patchline, manifest };
    } catch {
      return null;
    }
  }

  private async fetchManifestWithAccessToken(
    accessToken: string,
    patchline: string,
    logToTerminal: boolean,
  ): Promise<VersionManifest> {
    const manifestPath = `version/${patchline}.json`;
    if (logToTerminal) {
      this.pushTerminal(`Fetching manifest: ${manifestPath}`, "system");
    }

    const manifestSignedUrl = await this.getSignedAssetUrl(accessToken, manifestPath);
    const manifestResponse = await this.fetchWithTimeout(
      manifestSignedUrl,
      { method: "GET", headers: { accept: "application/json" } },
      config.hytale.downloaderApiTimeoutMs,
    );
    if (!manifestResponse.ok) {
      throw new AppError(
        manifestResponse.status,
        `Manifest request failed: ${manifestResponse.status} ${manifestResponse.statusText}`,
      );
    }

    const manifest = (await manifestResponse.json()) as VersionManifest;
    if (!manifest.version || !manifest.download_url || !manifest.sha256) {
      throw new AppError(500, "Malformed manifest response from account-data endpoint.");
    }

    if (logToTerminal) {
      this.pushTerminal(`Resolved patchline ${patchline} to version ${manifest.version}`, "system");
    }

    return manifest;
  }

  private installMetadataPath(): string {
    return path.join(config.hytale.serverDir, ".hytale-manager-install.json");
  }

  private async readInstalledServerMetadata(): Promise<InstalledServerMetadata | null> {
    const metadataPath = this.installMetadataPath();
    if (!(await pathExists(metadataPath))) {
      return null;
    }

    try {
      const raw = await readFile(metadataPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<InstalledServerMetadata>;
      if (
        typeof parsed.patchline !== "string" ||
        parsed.patchline.trim().length === 0 ||
        typeof parsed.version !== "string" ||
        parsed.version.trim().length === 0 ||
        typeof parsed.installedAt !== "string" ||
        parsed.installedAt.trim().length === 0
      ) {
        return null;
      }

      return {
        patchline: parsed.patchline,
        version: parsed.version,
        installedAt: parsed.installedAt,
      };
    } catch {
      return null;
    }
  }

  private async writeInstalledServerMetadata(metadata: InstalledServerMetadata): Promise<void> {
    await writeFile(this.installMetadataPath(), JSON.stringify(metadata, null, 2), "utf8");
  }

  private async getLifecyclePrerequisites(): Promise<{ serverInstalled: boolean; javaCommand: string | null }> {
    return {
      serverInstalled: await this.isInstalled(),
      javaCommand: await this.getManagedJavaCommandIfInstalled(),
    };
  }

  private assertLifecycleReadiness(
    prerequisites: { serverInstalled: boolean; javaCommand: string | null },
    action: "start" | "stop" | "restart",
  ): void {
    const missing: string[] = [];
    if (!prerequisites.serverInstalled) {
      missing.push("server files");
    }
    if (!prerequisites.javaCommand) {
      missing.push("Adoptium JDK 25");
    }

    if (missing.length === 0) {
      return;
    }

    throw new AppError(
      409,
      `Cannot ${action}: ${missing.join(" and ")} not installed. Install latest server and Adoptium JDK 25 first.`,
    );
  }

  private async getManagedJavaCommandIfInstalled(): Promise<string | null> {
    const command = path.join(config.hytale.managedJavaDir, "bin", process.platform === "win32" ? "java.exe" : "java");
    if (!(await pathExists(command))) {
      return null;
    }

    return command;
  }

  private async installAdoptiumJdk25(): Promise<JavaRuntimeInstallResult> {
    if (this.javaInstallPromise) {
      this.pushTerminal("Java installation already in progress; waiting for it to finish...", "system");
      return await this.javaInstallPromise;
    }

    const run = (async (): Promise<JavaRuntimeInstallResult> => {
      const platform = this.resolveAdoptiumPlatform();
      const workspace = path.join(config.app.dataDir, `java-install-${timestampId()}`);
      await rm(workspace, { recursive: true, force: true });
      await mkdir(workspace, { recursive: true });

      try {
        this.pushTerminal(
          `Resolving Adoptium Temurin JDK ${config.hytale.adoptiumFeatureVersion} for ${platform.os}/${platform.arch}...`,
          "system",
        );

        const release = await this.fetchAdoptiumRelease(platform.os, platform.arch);
        this.pushTerminal(`Selected release ${release.releaseName} (${release.packageName})`, "system");

        const archivePath = path.join(workspace, sanitizeFilename(release.packageName));
        await this.downloadFileWithProgress(release.downloadUrl, archivePath, config.hytale.javaDownloadTimeoutMs, {
          cacheKey: `adoptium-${release.releaseName}-${release.packageName}`,
          expectedSha256: release.checksum,
        });

        if (release.checksum) {
          this.pushTerminal("Validating Java archive checksum...", "system");
          await this.validateSha256(archivePath, release.checksum);
          this.pushTerminal("Java archive checksum valid.", "system");
        } else {
          this.pushTerminal("Java archive checksum not provided by API; skipping validation.", "system");
        }

        const extractDir = path.join(workspace, "extract");
        await mkdir(extractDir, { recursive: true });
        await this.extractArchiveFile(archivePath, extractDir, config.hytale.javaExtractTimeoutMs);

        const extractedJavaHome = await this.findJavaHome(extractDir);
        if (!extractedJavaHome) {
          throw new AppError(500, "Could not locate extracted Java home directory.");
        }

        await rm(config.hytale.managedJavaDir, { recursive: true, force: true });
        await mkdir(path.dirname(config.hytale.managedJavaDir), { recursive: true });

        await rename(extractedJavaHome, config.hytale.managedJavaDir).catch(async () => {
          await cp(extractedJavaHome, config.hytale.managedJavaDir, { recursive: true, force: true });
        });

        const javaCommand = await this.getManagedJavaCommandIfInstalled();
        if (!javaCommand) {
          throw new AppError(500, "Java installation completed, but java binary was not found.");
        }

        if (process.platform !== "win32") {
          await chmod(javaCommand, 0o755).catch(() => {});
        }

        const metadata = {
          installedAt: new Date().toISOString(),
          releaseName: release.releaseName,
          packageName: release.packageName,
          downloadUrl: release.downloadUrl,
          os: platform.os,
          arch: platform.arch,
          featureVersion: config.hytale.adoptiumFeatureVersion,
        };

        await writeFile(
          path.join(config.hytale.managedJavaDir, ".metadata.json"),
          JSON.stringify(metadata, null, 2),
          "utf8",
        );

        this.pushTerminal(`Installed Java runtime at ${config.hytale.managedJavaDir}`, "system");
        return {
          javaCommand,
          javaHome: config.hytale.managedJavaDir,
          releaseName: release.releaseName,
        };
      } finally {
        await rm(workspace, { recursive: true, force: true });
      }
    })();

    this.javaInstallPromise = run;
    try {
      return await run;
    } finally {
      this.javaInstallPromise = null;
    }
  }

  private resolveAdoptiumPlatform(): { os: "linux" | "mac" | "windows"; arch: "x64" | "x86" | "aarch64" } {
    const osMap: Record<string, "linux" | "mac" | "windows"> = {
      linux: "linux",
      darwin: "mac",
      win32: "windows",
    };

    const archMap: Record<string, "x64" | "x86" | "aarch64"> = {
      x64: "x64",
      ia32: "x86",
      arm64: "aarch64",
    };

    const os = osMap[process.platform];
    const arch = archMap[process.arch];

    if (!os) {
      throw new AppError(400, `Unsupported platform for Adoptium download: ${process.platform}`);
    }

    if (!arch) {
      throw new AppError(400, `Unsupported architecture for Adoptium download: ${process.arch}`);
    }

    return { os, arch };
  }

  private async fetchAdoptiumRelease(
    os: "linux" | "mac" | "windows",
    arch: "x64" | "x86" | "aarch64",
  ): Promise<{ releaseName: string; packageName: string; downloadUrl: string; checksum: string | null }> {
    const endpoint = new URL(
      `https://${config.hytale.adoptiumApiHost}/v3/assets/latest/${config.hytale.adoptiumFeatureVersion}/hotspot`,
    );
    endpoint.searchParams.set("architecture", arch);
    endpoint.searchParams.set("os", os);
    endpoint.searchParams.set("image_type", "jdk");
    endpoint.searchParams.set("vendor", "eclipse");

    const response = await this.fetchWithTimeout(
      endpoint.toString(),
      {
        method: "GET",
        headers: {
          accept: "application/json",
        },
      },
      config.hytale.downloaderApiTimeoutMs,
    );

    if (!response.ok) {
      throw new AppError(response.status, `Adoptium API request failed: ${response.status} ${response.statusText}`);
    }

    const assets = (await response.json()) as AdoptiumAsset[];
    const selected = assets.find((asset) => {
      const pkg = asset.binary?.package;
      return typeof pkg?.name === "string" && typeof pkg.link === "string";
    });

    if (!selected || !selected.binary?.package?.name || !selected.binary.package.link) {
      throw new AppError(
        404,
        `No Adoptium JDK package found for ${os}/${arch} and feature version ${config.hytale.adoptiumFeatureVersion}.`,
      );
    }

    return {
      releaseName: selected.release_name?.trim() || `jdk-${config.hytale.adoptiumFeatureVersion}`,
      packageName: selected.binary.package.name,
      downloadUrl: selected.binary.package.link,
      checksum: typeof selected.binary.package.checksum === "string" ? selected.binary.package.checksum : null,
    };
  }

  private async extractArchiveFile(archivePath: string, destinationDir: string, timeoutMs: number): Promise<void> {
    const lower = archivePath.toLowerCase();

    if (lower.endsWith(".zip")) {
      await this.extractZipFile(archivePath, destinationDir, timeoutMs);
      return;
    }

    if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
      await this.extractTarGzFile(archivePath, destinationDir, timeoutMs);
      return;
    }

    throw new AppError(400, `Unsupported archive type for Java runtime: ${path.basename(archivePath)}`);
  }

  private async extractTarGzFile(archivePath: string, destinationDir: string, timeoutMs: number): Promise<void> {
    const tarBin = Bun.which("tar");
    if (!tarBin) {
      throw new AppError(500, "System tar command is required for .tar.gz extraction.");
    }

    this.pushTerminal(`Extracting archive with ${tarBin}...`, "system");
    const proc = Bun.spawn([tarBin, "-xzf", archivePath, "-C", destinationDir], {
      cwd: destinationDir,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });

    this.consumeStream(proc.stdout, "stdout");
    this.consumeStream(proc.stderr, "stderr");

    const exited = await Promise.race([
      proc.exited.then((code) => ({ timeout: false as const, code })),
      sleep(timeoutMs).then(() => ({ timeout: true as const, code: -1 })),
    ]);

    if (exited.timeout) {
      proc.kill();
      throw new AppError(504, `Archive extraction timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }

    if (exited.code !== 0) {
      throw new AppError(500, `Archive extraction failed with exit code ${exited.code}.`);
    }

    this.pushTerminal("Archive extraction complete.", "system");
  }

  private async findJavaHome(root: string): Promise<string | null> {
    const javaName = process.platform === "win32" ? "java.exe" : "java";

    const queue = [root];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        break;
      }

      const directJava = path.join(current, "bin", javaName);
      if (await pathExists(directJava)) {
        return current;
      }

      const macHome = path.join(current, "Contents", "Home");
      if (await pathExists(path.join(macHome, "bin", javaName))) {
        return macHome;
      }

      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        queue.push(path.join(current, entry.name));
      }
    }

    return null;
  }

  private async withDownloaderToken<T>(operation: (accessToken: string) => Promise<T>): Promise<T> {
    let credentials = await this.getActiveDownloaderCredentials();

    try {
      return await operation(credentials.access_token);
    } catch (error) {
      if (!(error instanceof AppError) || (error.status !== 401 && error.status !== 403)) {
        throw error;
      }
    }

    this.pushTerminal("Stored downloader token was rejected; re-authentication is required.", "system");
    credentials = await this.requestNewDeviceCredentials();
    return await operation(credentials.access_token);
  }

  private async getActiveDownloaderCredentials(): Promise<DownloaderCredentials> {
    const now = Math.floor(Date.now() / 1000);
    const stored = await this.readDownloaderCredentials();

    if (stored && stored.environment === config.hytale.downloaderEnvironment) {
      if (stored.expires_at > now + 60 && stored.access_token.trim()) {
        return stored;
      }

      if (stored.refresh_token.trim()) {
        const refreshed = await this.refreshDownloaderCredentials(stored.refresh_token);
        if (refreshed) {
          return refreshed;
        }
      }
    } else if (stored && stored.environment !== config.hytale.downloaderEnvironment) {
      this.pushTerminal(
        `Stored credentials environment mismatch (${stored.environment} != ${config.hytale.downloaderEnvironment}); re-authenticating.`,
        "system",
      );
    }

    return await this.requestNewDeviceCredentials();
  }

  private async readDownloaderCredentials(): Promise<DownloaderCredentials | null> {
    const credentialsPath = config.hytale.downloaderCredentialsPath;
    if (!(await pathExists(credentialsPath))) {
      return null;
    }

    try {
      const raw = await readFile(credentialsPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<DownloaderCredentials>;
      if (
        typeof parsed.access_token !== "string" ||
        typeof parsed.refresh_token !== "string" ||
        typeof parsed.expires_at !== "number" ||
        typeof parsed.environment !== "string"
      ) {
        this.pushTerminal("Stored downloader credentials are malformed; re-authentication required.", "system");
        return null;
      }

      return {
        access_token: parsed.access_token,
        refresh_token: parsed.refresh_token,
        expires_at: parsed.expires_at,
        environment: parsed.environment,
      };
    } catch {
      this.pushTerminal("Stored downloader credentials could not be read; re-authentication required.", "system");
      return null;
    }
  }

  private async writeDownloaderCredentials(credentials: DownloaderCredentials): Promise<void> {
    const serialized = JSON.stringify(credentials, null, 2);
    await writeFile(config.hytale.downloaderCredentialsPath, serialized, { encoding: "utf8", mode: 0o600 });
  }

  private async requestNewDeviceCredentials(): Promise<DownloaderCredentials> {
    this.pushTerminal("Requesting downloader authorization device code...", "system");

    const body = new URLSearchParams({
      client_id: config.hytale.downloaderClientId,
      scope: config.hytale.downloaderScope,
    });

    const deviceResponse = await this.fetchWithTimeout(
      `https://${config.hytale.oauthHost}/oauth2/device/auth`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      },
      config.hytale.downloaderApiTimeoutMs,
    );

    const devicePayload = (await deviceResponse.json()) as OAuthDeviceCodeResponse & OAuthTokenResponse;
    if (!deviceResponse.ok || devicePayload.error || !devicePayload.device_code || !devicePayload.user_code) {
      const details = devicePayload.error_description ?? devicePayload.error ?? `${deviceResponse.status} ${deviceResponse.statusText}`;
      throw new AppError(401, `Failed to initialize device authorization: ${details}`);
    }

    const verificationUrl = devicePayload.verification_uri_complete ?? devicePayload.verification_uri;
    if (!verificationUrl) {
      throw new AppError(500, "Device authorization response did not include a verification URL.");
    }

    this.pushTerminal("Please visit the following URL to authenticate:", "system");
    this.pushTerminal(verificationUrl, "system");
    this.pushTerminal(`Authorization code: ${devicePayload.user_code}`, "system");

    let openedByServer = false;
    if (config.hytale.oauthAutoOpenBrowser) {
      openedByServer = this.tryOpenExternalUrl(verificationUrl);
      if (openedByServer) {
        this.pushTerminal("Opened authorization URL in your default browser.", "system");
      } else {
        this.pushTerminal("Could not open browser automatically. Open the URL manually.", "system");
      }
    }

    this.broadcast("auth.device", {
      url: verificationUrl,
      code: devicePayload.user_code,
      openedByServer,
    });

    const pollDeadline = Date.now() + Math.min(
      devicePayload.expires_in * 1000,
      config.hytale.oauthDevicePollTimeoutMs,
    );
    let intervalSeconds = Math.max(1, devicePayload.interval ?? 5);
    let lastPendingLog = 0;

    while (Date.now() < pollDeadline) {
      await sleep(intervalSeconds * 1000);
      const tokenPayload = await this.requestToken({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: devicePayload.device_code,
      });

      if (tokenPayload.access_token) {
        const credentials = this.tokenPayloadToCredentials(tokenPayload, "");
        await this.writeDownloaderCredentials(credentials);
        this.pushTerminal("Downloader authorization completed.", "system");
        return credentials;
      }

      if (tokenPayload.error === "authorization_pending") {
        if (Date.now() - lastPendingLog >= 15_000) {
          this.pushTerminal("Waiting for authorization confirmation...", "system");
          lastPendingLog = Date.now();
        }
        continue;
      }

      if (tokenPayload.error === "slow_down") {
        intervalSeconds += 5;
        continue;
      }

      const details = tokenPayload.error_description ?? tokenPayload.error ?? "unknown error";
      throw new AppError(401, `Authorization failed: ${details}`);
    }

    throw new AppError(504, "Authorization timed out before completion.");
  }

  private async refreshDownloaderCredentials(refreshToken: string): Promise<DownloaderCredentials | null> {
    this.pushTerminal("Refreshing downloader credentials...", "system");

    const tokenPayload = await this.requestToken({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    if (!tokenPayload.access_token) {
      const details = tokenPayload.error_description ?? tokenPayload.error ?? "unknown error";
      this.pushTerminal(`Credential refresh failed: ${details}`, "system");
      return null;
    }

    const credentials = this.tokenPayloadToCredentials(tokenPayload, refreshToken);
    await this.writeDownloaderCredentials(credentials);
    this.pushTerminal("Downloader credentials refreshed.", "system");
    return credentials;
  }

  private async requestToken(fields: Record<string, string>): Promise<OAuthTokenResponse> {
    const body = new URLSearchParams({
      ...fields,
      client_id: config.hytale.downloaderClientId,
    });

    const response = await this.fetchWithTimeout(
      `https://${config.hytale.oauthHost}/oauth2/token`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      },
      config.hytale.downloaderApiTimeoutMs,
    );

    let payload: OAuthTokenResponse = {};
    try {
      payload = (await response.json()) as OAuthTokenResponse;
    } catch {
      if (!response.ok) {
        throw new AppError(response.status, `Token endpoint returned ${response.status} ${response.statusText}.`);
      }
    }

    if (!response.ok && !payload.error) {
      throw new AppError(response.status, `Token request failed: ${response.status} ${response.statusText}`);
    }

    return payload;
  }

  private tryOpenExternalUrl(url: string): boolean {
    const commandCandidates: string[][] = [];

    if (process.platform === "darwin") {
      commandCandidates.push(["open", url]);
    } else if (process.platform === "win32") {
      commandCandidates.push(["cmd", "/c", "start", "", url]);
    } else {
      commandCandidates.push(["xdg-open", url]);
    }

    for (const command of commandCandidates) {
      const executable = command[0];
      if (executable !== "cmd" && !Bun.which(executable)) {
        continue;
      }

      try {
        Bun.spawn(command, {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
          env: process.env,
        });
        return true;
      } catch {
        continue;
      }
    }

    return false;
  }

  private tokenPayloadToCredentials(payload: OAuthTokenResponse, fallbackRefreshToken: string): DownloaderCredentials {
    const accessToken = payload.access_token?.trim();
    if (!accessToken) {
      throw new AppError(500, "OAuth token response did not include access_token.");
    }

    const refreshToken = payload.refresh_token?.trim() || fallbackRefreshToken;
    const expiresIn = Math.max(60, Number(payload.expires_in ?? 3600));

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      environment: config.hytale.downloaderEnvironment,
    };
  }

  private async getSignedAssetUrl(accessToken: string, assetPath: string): Promise<string> {
    const normalizedPath = assetPath.replace(/^\/+/, "");
    const endpoint = `https://${config.hytale.accountDataHost}/game-assets/${normalizedPath}`;

    const response = await this.fetchWithTimeout(
      endpoint,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
        },
      },
      config.hytale.downloaderApiTimeoutMs,
    );

    if (!response.ok) {
      const details = (await response.text()).trim();
      const suffix = details || `${response.status} ${response.statusText}`;
      throw new AppError(response.status, `Failed to resolve signed URL for ${normalizedPath}: ${suffix}`);
    }

    const payload = (await response.json()) as { url?: string };
    if (typeof payload.url !== "string" || payload.url.length === 0) {
      throw new AppError(500, `Signed URL response for ${normalizedPath} is missing url.`);
    }

    return payload.url;
  }

  private async downloadFileWithProgress(
    url: string,
    destinationPath: string,
    timeoutMs: number,
    options: DownloadRequestOptions = {},
  ): Promise<void> {
    const downloadConcurrency = Math.max(1, Math.min(16, Math.trunc(config.hytale.downloadConcurrency) || 1));
    const progressIntervalMs = Math.max(250, config.hytale.downloadProgressIntervalMs);
    const cachePath = options.cacheKey ? this.resolveDownloadCachePath(options.cacheKey) : null;

    if (cachePath && (await pathExists(cachePath))) {
      if (options.expectedSha256) {
        try {
          await this.validateSha256(cachePath, options.expectedSha256);
        } catch {
          this.pushTerminal("Cached download checksum mismatch; re-downloading artifact.", "system");
          await rm(cachePath, { force: true });
        }
      }

      if (await pathExists(cachePath)) {
        await rm(destinationPath, { force: true });
        await copyFile(cachePath, destinationPath);
        const cachedSize = (await stat(destinationPath)).size;
        this.pushTerminal(`Using cached download (${this.formatBytes(cachedSize)}).`, "system");
        return;
      }
    }

    await rm(destinationPath, { force: true });

    const rangeProbe = downloadConcurrency > 1 ? await this.probeRangeSupport(url, timeoutMs) : null;
    const minimumParallelBytes = 8 * 1024 * 1024;
    const canUseParallel = !!rangeProbe && rangeProbe.totalBytes >= minimumParallelBytes;

    if (canUseParallel) {
      try {
        await this.downloadFileWithParallelRanges(
          url,
          destinationPath,
          rangeProbe.totalBytes,
          downloadConcurrency,
          timeoutMs,
          progressIntervalMs,
        );
      } catch (error) {
        this.pushTerminal("Parallel download failed, retrying with single stream...", "system");
        await rm(destinationPath, { force: true });
        await this.downloadFileSingleStream(url, destinationPath, timeoutMs, progressIntervalMs);
      }
    } else {
      await this.downloadFileSingleStream(url, destinationPath, timeoutMs, progressIntervalMs);
    }

    if (cachePath) {
      await this.saveDownloadToCache(destinationPath, cachePath);
    }
  }

  private async probeRangeSupport(url: string, timeoutMs: number): Promise<RangeProbeResult | null> {
    const response = await this.fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: {
          Range: "bytes=0-0",
        },
      },
      timeoutMs,
    );

    try {
      if (response.status !== 206) {
        return null;
      }

      const contentRange = response.headers.get("content-range") ?? "";
      const match = contentRange.match(/^bytes\s+\d+-\d+\/(\d+)$/i);
      if (!match) {
        return null;
      }

      const totalBytes = Number(match[1] ?? 0);
      if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
        return null;
      }

      return { totalBytes };
    } finally {
      if (response.body) {
        await response.body.cancel().catch(() => {});
      }
    }
  }

  private async downloadFileSingleStream(
    url: string,
    destinationPath: string,
    timeoutMs: number,
    progressIntervalMs: number,
  ): Promise<void> {
    const response = await this.fetchWithTimeout(url, { method: "GET" }, timeoutMs);
    if (!response.ok) {
      throw new AppError(response.status, `Download request failed: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new AppError(500, "Download response body is empty.");
    }

    const writer = createWriteStream(destinationPath, { flags: "w" });
    const reader = response.body.getReader();
    const contentLengthHeader = response.headers.get("content-length");
    const totalBytes = contentLengthHeader ? Number(contentLengthHeader) : 0;
    let downloadedBytes = 0;
    let lastLogMs = Date.now();

    const logProgress = (force = false): void => {
      const now = Date.now();
      if (!force && now - lastLogMs < progressIntervalMs) {
        return;
      }

      if (totalBytes > 0) {
        const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
        this.pushTerminal(
          `Download progress: ${this.formatBytes(downloadedBytes)} / ${this.formatBytes(totalBytes)} (${percent}%)`,
          "system",
        );
      } else {
        this.pushTerminal(`Download progress: ${this.formatBytes(downloadedBytes)}`, "system");
      }
      lastLogMs = now;
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        if (!value) {
          continue;
        }

        await this.writeToStream(writer, value);
        downloadedBytes += value.length;
        logProgress(false);
      }

      await this.endStream(writer);
      logProgress(true);
    } catch (error) {
      writer.destroy();
      await rm(destinationPath, { force: true });
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  private async downloadFileWithParallelRanges(
    url: string,
    destinationPath: string,
    totalBytes: number,
    configuredConcurrency: number,
    timeoutMs: number,
    progressIntervalMs: number,
  ): Promise<void> {
    const minimumPartBytes = 4 * 1024 * 1024;
    const recommendedWorkers = Math.max(1, Math.floor(totalBytes / minimumPartBytes));
    const workerCount = Math.max(2, Math.min(configuredConcurrency, recommendedWorkers));
    if (workerCount < 2) {
      await this.downloadFileSingleStream(url, destinationPath, timeoutMs, progressIntervalMs);
      return;
    }

    this.pushTerminal(`Starting parallel download with ${workerCount} workers...`, "system");

    const partDir = `${destinationPath}.parts-${randomUUID()}`;
    await mkdir(partDir, { recursive: true });

    const partSize = Math.ceil(totalBytes / workerCount);
    const parts: { partPath: string; start: number; end: number }[] = [];
    for (let index = 0; index < workerCount; index += 1) {
      const start = index * partSize;
      if (start >= totalBytes) {
        break;
      }

      const end = Math.min(totalBytes - 1, start + partSize - 1);
      parts.push({
        partPath: path.join(partDir, `${index}.part`),
        start,
        end,
      });
    }

    let downloadedBytes = 0;
    let lastLogMs = Date.now();
    const logProgress = (force = false): void => {
      const now = Date.now();
      if (!force && now - lastLogMs < progressIntervalMs) {
        return;
      }

      const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
      this.pushTerminal(
        `Download progress: ${this.formatBytes(downloadedBytes)} / ${this.formatBytes(totalBytes)} (${percent}%)`,
        "system",
      );
      lastLogMs = now;
    };

    try {
      await Promise.all(
        parts.map(async (part) => {
          const response = await this.fetchWithTimeout(
            url,
            {
              method: "GET",
              headers: {
                Range: `bytes=${part.start}-${part.end}`,
              },
            },
            timeoutMs,
          );
          if (response.status !== 206) {
            throw new AppError(response.status, `Range download failed with status ${response.status}.`);
          }

          if (!response.body) {
            throw new AppError(500, "Range download response body is empty.");
          }

          const writer = createWriteStream(part.partPath, { flags: "w" });
          const reader = response.body.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                break;
              }

              if (!value) {
                continue;
              }

              await this.writeToStream(writer, value);
              downloadedBytes += value.length;
              logProgress(false);
            }

            await this.endStream(writer);
          } catch (error) {
            writer.destroy();
            await rm(part.partPath, { force: true });
            throw error;
          } finally {
            reader.releaseLock();
          }
        }),
      );

      const orderedPaths = parts
        .sort((a, b) => a.start - b.start)
        .map((part) => part.partPath);
      await this.mergeFiles(orderedPaths, destinationPath);
      logProgress(true);
    } finally {
      await rm(partDir, { recursive: true, force: true });
    }
  }

  private async mergeFiles(sourcePaths: string[], destinationPath: string): Promise<void> {
    const writer = createWriteStream(destinationPath, { flags: "w" });

    try {
      for (const sourcePath of sourcePaths) {
        const reader = Bun.file(sourcePath).stream().getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            if (value) {
              await this.writeToStream(writer, value);
            }
          }
        } finally {
          reader.releaseLock();
        }
      }

      await this.endStream(writer);
    } catch (error) {
      writer.destroy();
      await rm(destinationPath, { force: true });
      throw error;
    }
  }

  private async writeToStream(writer: WriteStream, chunk: Uint8Array): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      writer.write(chunk, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async endStream(writer: WriteStream): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      writer.end((error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private resolveDownloadCachePath(cacheKey: string): string {
    const hash = createHash("sha256").update(cacheKey).digest("hex");
    return path.join(config.hytale.downloadCacheDir, `${hash}.bin`);
  }

  private async saveDownloadToCache(sourcePath: string, cachePath: string): Promise<void> {
    const tempPath = `${cachePath}.${randomUUID()}.tmp`;
    await copyFile(sourcePath, tempPath);
    await rename(tempPath, cachePath).catch(async () => {
      await rm(tempPath, { force: true });
      await copyFile(sourcePath, cachePath);
    });
  }

  private async validateSha256(filePath: string, expectedHash: string): Promise<void> {
    const normalizedExpected = expectedHash.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalizedExpected)) {
      throw new AppError(400, "Manifest checksum is not a valid SHA256 hex string.");
    }

    const hash = createHash("sha256");
    const reader = Bun.file(filePath).stream().getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value) {
          hash.update(value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    const actualHash = hash.digest("hex").toLowerCase();
    if (actualHash !== normalizedExpected) {
      throw new AppError(
        400,
        `Checksum mismatch for ${path.basename(filePath)} (expected ${normalizedExpected}, got ${actualHash}).`,
      );
    }
  }

  private async extractZipFile(
    archivePath: string,
    destinationDir: string,
    timeoutMs = config.hytale.downloaderExtractTimeoutMs,
  ): Promise<void> {
    const unzipBin = Bun.which("unzip");
    const tarBin = Bun.which("tar");

    let command: string[];
    if (unzipBin) {
      command = [unzipBin, "-oq", archivePath, "-d", destinationDir];
    } else if (tarBin) {
      command = [tarBin, "-xf", archivePath, "-C", destinationDir];
      this.pushTerminal(`System unzip not found; falling back to ${tarBin} for ZIP extraction.`, "system");
    } else {
      throw new AppError(500, "ZIP extraction requires either unzip or tar on the host system.");
    }

    this.pushTerminal(`Extracting archive with ${command[0]}...`, "system");
    const proc = Bun.spawn(command, {
      cwd: destinationDir,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });

    this.consumeStream(proc.stdout, "stdout");
    this.consumeStream(proc.stderr, "stderr");

    const exited = await Promise.race([
      proc.exited.then((code) => ({ timeout: false as const, code })),
      sleep(timeoutMs).then(() => ({ timeout: true as const, code: -1 })),
    ]);

    if (exited.timeout) {
      proc.kill();
      throw new AppError(
        504,
        `Archive extraction timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
      );
    }

    if (exited.code !== 0) {
      throw new AppError(500, `Archive extraction failed with exit code ${exited.code}.`);
    }

    this.pushTerminal("Archive extraction complete.", "system");
  }

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new AppError(504, `Request timed out after ${Math.round(timeoutMs / 1000)} seconds: ${url}`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }

    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }

    return `${value.toFixed(1)} ${units[unitIndex]}`;
  }

  private async locateDownloadedLayout(root: string): Promise<{ serverDir: string; assetsPath: string } | null> {
    const directServer = path.join(root, "Server");
    const directAssets = path.join(root, "Assets.zip");

    if ((await pathExists(path.join(directServer, "HytaleServer.jar"))) && (await pathExists(directAssets))) {
      return {
        serverDir: directServer,
        assetsPath: directAssets,
      };
    }

    const found = await this.scanForInstallArtifacts(root);
    if (!found.jarPath || !found.assetsPath) {
      return null;
    }

    return {
      serverDir: path.dirname(found.jarPath),
      assetsPath: found.assetsPath,
    };
  }

  private async scanForInstallArtifacts(root: string): Promise<{ jarPath: string | null; assetsPath: string | null }> {
    const result = {
      jarPath: null as string | null,
      assetsPath: null as string | null,
    };

    const queue: string[] = [root];
    while (queue.length > 0 && (!result.jarPath || !result.assetsPath)) {
      const current = queue.shift();
      if (!current) {
        break;
      }

      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);

        if (entry.isDirectory()) {
          queue.push(fullPath);
          continue;
        }

        if (!result.jarPath && entry.name === "HytaleServer.jar") {
          result.jarPath = fullPath;
        }

        if (!result.assetsPath && entry.name === "Assets.zip") {
          result.assetsPath = fullPath;
        }
      }
    }

    return result;
  }

  private async resolveUniquePath(initialPath: string): Promise<string> {
    if (!(await pathExists(initialPath))) {
      return initialPath;
    }

    const ext = path.extname(initialPath);
    const base = initialPath.slice(0, -ext.length);
    let suffix = 1;

    while (suffix < 10_000) {
      const candidate = `${base}-${suffix}${ext}`;
      if (!(await pathExists(candidate))) {
        return candidate;
      }
      suffix += 1;
    }

    throw new AppError(500, "Could not find unique path for uploaded mod.");
  }

  private async renameModFile(from: string, to: string): Promise<void> {
    const modsDir = path.join(config.hytale.serverDir, "mods");
    const sourcePath = path.join(modsDir, from);
    const targetPath = path.join(modsDir, to);

    if (!(await pathExists(sourcePath))) {
      throw new AppError(404, `Mod not found: ${from}`);
    }

    if (await pathExists(targetPath)) {
      throw new AppError(409, `Target mod file already exists: ${to}`);
    }

    await rename(sourcePath, targetPath);
    this.invalidateModMetadataCacheEntry(sourcePath);
    this.invalidateModMetadataCacheEntry(targetPath);
  }

  private async getCurseForgeConfig(): Promise<CurseForgeRuntimeConfig | null> {
    const envApiKey = config.hytale.curseForgeApiKey.trim();
    const envGameId = Math.trunc(config.hytale.curseForgeGameId);
    const envClassId = Math.max(0, Math.trunc(config.hytale.curseForgeClassId));
    if (envApiKey.length > 0 && envGameId > 0) {
      return {
        apiHost: config.hytale.curseForgeApiHost,
        apiKey: envApiKey,
        gameId: envGameId,
        classId: envClassId,
        pageSize: config.hytale.curseForgeDefaultPageSize,
        source: "env",
      };
    }

    const encryptedApiKey = getAppSetting(CURSEFORGE_SETTING_API_KEY);
    const storedGameIdRaw = getAppSetting(CURSEFORGE_SETTING_GAME_ID);
    if (!encryptedApiKey || !storedGameIdRaw) {
      return null;
    }

    const apiKey = await decryptSecret(encryptedApiKey);
    if (!apiKey) {
      return null;
    }

    const gameId = Math.trunc(Number(storedGameIdRaw));
    if (!Number.isFinite(gameId) || gameId <= 0) {
      return null;
    }

    const storedClassIdRaw = getAppSetting(CURSEFORGE_SETTING_CLASS_ID);
    const classId = Math.max(0, Math.trunc(Number(storedClassIdRaw ?? 0)));
    return {
      apiHost: config.hytale.curseForgeApiHost,
      apiKey,
      gameId,
      classId: Number.isFinite(classId) ? classId : 0,
      pageSize: config.hytale.curseForgeDefaultPageSize,
      source: "dashboard",
    };
  }

  private async getCurseForgeConfigOrThrow(): Promise<CurseForgeRuntimeConfig> {
    const curseForge = await this.getCurseForgeConfig();
    if (curseForge) {
      return curseForge;
    }

    throw new AppError(
      400,
      "CurseForge is not configured. Use the dashboard Connect form or set HYTALE_CURSEFORGE_API_KEY and HYTALE_CURSEFORGE_GAME_ID.",
    );
  }

  private normalizeCurseForgeSort(value: string): CurseForgeSearchSort {
    const allowed = new Set<CurseForgeSearchSort>(["popularity", "lastUpdated", "name", "author", "totalDownloads"]);
    if (allowed.has(value as CurseForgeSearchSort)) {
      return value as CurseForgeSearchSort;
    }
    return "popularity";
  }

  private async fetchCurseForgeApi<T>(
    curseForge: CurseForgeRuntimeConfig,
    url: string,
    init: RequestInit,
  ): Promise<CurseForgeApiResponse<T>> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("x-api-key", curseForge.apiKey);
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await this.fetchWithTimeout(
      url,
      {
        ...init,
        headers,
      },
      config.hytale.downloaderApiTimeoutMs,
    );

    const raw = await response.text();
    let payload: unknown = null;
    if (raw.trim().length > 0) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const details = typeof payload === "object" && payload !== null && "error" in payload
        ? String((payload as { error?: unknown }).error ?? `${response.status} ${response.statusText}`)
        : raw.trim() || `${response.status} ${response.statusText}`;
      throw new AppError(response.status, `CurseForge API request failed: ${details}`);
    }

    if (!payload || typeof payload !== "object" || !("data" in payload)) {
      throw new AppError(500, "CurseForge API returned an invalid response.");
    }

    return payload as CurseForgeApiResponse<T>;
  }

  private async fetchCurseForgeMod(curseForge: CurseForgeRuntimeConfig, modId: number): Promise<CurseForgeApiMod> {
    const response = await this.fetchCurseForgeApi<CurseForgeApiMod>(
      curseForge,
      `https://${curseForge.apiHost}/v1/mods/${modId}`,
      { method: "GET" },
    );

    if (!response.data || typeof response.data !== "object") {
      throw new AppError(404, `CurseForge mod ${modId} was not found.`);
    }

    return response.data;
  }

  private async fetchCurseForgeModsByIds(
    curseForge: CurseForgeRuntimeConfig,
    modIds: number[],
  ): Promise<Map<number, CurseForgeApiMod>> {
    const uniqueIds = Array.from(new Set(modIds.map((value) => Math.trunc(value)).filter((value) => value > 0)));
    const byId = new Map<number, CurseForgeApiMod>();

    for (let index = 0; index < uniqueIds.length; index += 50) {
      const chunk = uniqueIds.slice(index, index + 50);
      const response = await this.fetchCurseForgeApi<CurseForgeApiMod[]>(
        curseForge,
        `https://${curseForge.apiHost}/v1/mods`,
        {
          method: "POST",
          body: JSON.stringify({ modIds: chunk }),
        },
      );

      const mods = Array.isArray(response.data) ? response.data : [];
      for (const item of mods) {
        const id = Number(item.id ?? 0);
        if (id > 0) {
          byId.set(id, item);
        }
      }
    }

    return byId;
  }

  private async resolveLatestCurseForgeFile(
    curseForge: CurseForgeRuntimeConfig,
    modId: number,
    latestFiles?: CurseForgeApiFile[],
  ): Promise<CurseForgeApiFile | null> {
    const fromLatest = this.selectCurseForgePreferredFile(latestFiles ?? []);
    if (fromLatest) {
      return fromLatest;
    }

    return await this.fetchLatestCurseForgeFileFromIndex(curseForge, modId);
  }

  private async fetchLatestCurseForgeFileFromIndex(
    curseForge: CurseForgeRuntimeConfig,
    modId: number,
  ): Promise<CurseForgeApiFile | null> {
    const endpoint = new URL(`https://${curseForge.apiHost}/v1/mods/${modId}/files`);
    endpoint.searchParams.set("index", "0");
    endpoint.searchParams.set("pageSize", "25");
    endpoint.searchParams.set("sortField", "2");
    endpoint.searchParams.set("sortOrder", "desc");

    const response = await this.fetchCurseForgeApi<CurseForgeApiFile[]>(curseForge, endpoint.toString(), {
      method: "GET",
    });

    const files = Array.isArray(response.data) ? response.data : [];
    return this.selectCurseForgePreferredFile(files);
  }

  private selectCurseForgePreferredFile(files: CurseForgeApiFile[]): CurseForgeApiFile | null {
    const candidates = files.filter((file) => {
      if (typeof file.id !== "number" || file.id <= 0) {
        return false;
      }
      if (file.isAvailable === false) {
        return false;
      }

      const name = this.getCurseForgeFileDisplayName(file);
      return !!name;
    });

    candidates.sort((left, right) => {
      const leftDate = Date.parse(left.fileDate ?? "");
      const rightDate = Date.parse(right.fileDate ?? "");
      const leftTimestamp = Number.isFinite(leftDate) ? leftDate : 0;
      const rightTimestamp = Number.isFinite(rightDate) ? rightDate : 0;
      if (rightTimestamp !== leftTimestamp) {
        return rightTimestamp - leftTimestamp;
      }
      return (Number(right.id ?? 0) || 0) - (Number(left.id ?? 0) || 0);
    });

    return candidates[0] ?? null;
  }

  private async installCurseForgeFile(
    curseForge: CurseForgeRuntimeConfig,
    mod: CurseForgeApiMod,
    file: CurseForgeApiFile,
    trackedOverride?: CurseForgeStoredMod,
  ): Promise<{ stored: CurseForgeStoredMod; alreadyInstalled: boolean }> {
    const modId = Number(mod.id ?? file.modId ?? 0);
    if (!Number.isFinite(modId) || modId <= 0) {
      throw new AppError(400, "CurseForge payload did not include a valid mod id.");
    }

    const fileId = Number(file.id ?? 0);
    if (!Number.isFinite(fileId) || fileId <= 0) {
      throw new AppError(400, "CurseForge payload did not include a valid file id.");
    }

    const store = await this.readCurseForgeStore();
    const tracked = trackedOverride ?? store.mods.find((item) => item.modId === modId);

    const modsDir = path.join(config.hytale.serverDir, "mods");
    await mkdir(modsDir, { recursive: true });
    await mkdir(config.app.uploadsDir, { recursive: true });

    if (tracked && tracked.fileId === fileId) {
      const trackedPath = path.join(modsDir, tracked.localFilename);
      if (await pathExists(trackedPath)) {
        return {
          stored: tracked,
          alreadyInstalled: true,
        };
      }
    }

    const modName = this.normalizeStringOrNull(mod.name) ?? `Mod ${modId}`;
    const authorNames = this.extractCurseForgeAuthorNames(mod.authors);
    const remoteFileName = this.getCurseForgeFileDisplayName(file) ?? `${sanitizeFilename(modName)}-${fileId}.jar`;
    const keepDisabled = tracked?.localFilename.endsWith(".disabled") ?? false;
    const targetName = this.normalizeCurseForgeFilename(remoteFileName, keepDisabled);
    const downloadUrl = await this.resolveCurseForgeDownloadUrl(curseForge, modId, file);

    this.pushTerminal(`Downloading CurseForge mod ${modName} (${remoteFileName})...`, "system");

    const tempPath = path.join(config.app.uploadsDir, `curseforge-${modId}-${fileId}-${randomUUID()}.part`);
    try {
      await this.downloadFileWithProgress(downloadUrl, tempPath, config.hytale.downloaderDownloadTimeoutMs, {
        cacheKey: `curseforge-${modId}-${fileId}`,
      });

      let targetPath = path.join(modsDir, targetName);
      if (await pathExists(targetPath)) {
        if (tracked && tracked.localFilename === path.basename(targetPath)) {
          await rm(targetPath, { force: true });
        } else {
          targetPath = await this.resolveUniquePath(targetPath);
        }
      }

      await rename(tempPath, targetPath);

      if (tracked && tracked.localFilename !== path.basename(targetPath)) {
        await rm(path.join(modsDir, tracked.localFilename), { force: true });
      }

      const stored: CurseForgeStoredMod = {
        modId,
        modName,
        authorNames,
        fileId,
        fileName: remoteFileName,
        localFilename: path.basename(targetPath),
        installedAt: new Date().toISOString(),
        dateModified: this.normalizeDateString(mod.dateModified, new Date().toISOString()),
        websiteUrl: this.normalizeStringOrNull(mod.links?.websiteUrl),
      };

      const nextMods = store.mods.filter((item) => item.modId !== modId);
      nextMods.push(stored);
      nextMods.sort((a, b) => a.modName.localeCompare(b.modName));
      await this.writeCurseForgeStore({
        version: 1,
        mods: nextMods,
      });

      this.pushTerminal(`Installed CurseForge mod ${modName} as ${path.basename(targetPath)}.`, "system");
      return {
        stored,
        alreadyInstalled: false,
      };
    } finally {
      await rm(tempPath, { force: true });
    }
  }

  private async resolveCurseForgeDownloadUrl(
    curseForge: CurseForgeRuntimeConfig,
    modId: number,
    file: CurseForgeApiFile,
  ): Promise<string> {
    const fromFile = this.normalizeStringOrNull(file.downloadUrl);
    if (fromFile) {
      return fromFile;
    }

    const fileId = Number(file.id ?? 0);
    if (fileId <= 0) {
      throw new AppError(400, "Cannot resolve CurseForge download URL without a file id.");
    }

    const response = await this.fetchCurseForgeApi<string>(
      curseForge,
      `https://${curseForge.apiHost}/v1/mods/${modId}/files/${fileId}/download-url`,
      { method: "GET" },
    );

    if (typeof response.data !== "string" || response.data.trim().length === 0) {
      throw new AppError(500, "CurseForge did not return a valid download URL.");
    }

    return response.data.trim();
  }

  private getCurseForgeFileDisplayName(file: CurseForgeApiFile): string | null {
    const fileName = this.normalizeStringOrNull(file.fileName);
    if (fileName) {
      return fileName;
    }

    const displayName = this.normalizeStringOrNull(file.displayName);
    if (displayName) {
      return displayName;
    }

    return null;
  }

  private normalizeCurseForgeFilename(rawName: string, disabled: boolean): string {
    const sanitized = sanitizeFilename(rawName);
    const hasExtension = /\.[a-z0-9]+$/i.test(sanitized);
    const baseName = hasExtension ? sanitized : `${sanitized}.jar`;
    if (!disabled) {
      return baseName;
    }
    return baseName.endsWith(".disabled") ? baseName : `${baseName}.disabled`;
  }

  private toCurseForgeSearchMod(mod: CurseForgeApiMod): CurseForgeSearchMod | null {
    const id = Number(mod.id ?? 0);
    if (!Number.isFinite(id) || id <= 0) {
      return null;
    }

    const name = this.normalizeStringOrNull(mod.name);
    if (!name) {
      return null;
    }

    return {
      id,
      name,
      summary: this.normalizeStringOrNull(mod.summary) ?? "",
      authors: this.extractCurseForgeAuthorNames(mod.authors),
      downloadCount: Number(mod.downloadCount ?? 0) || 0,
      dateModified: this.normalizeDateString(mod.dateModified, new Date(0).toISOString()),
      dateReleased: this.normalizeDateString(mod.dateReleased, new Date(0).toISOString()),
      logoUrl: this.normalizeStringOrNull(mod.logo?.thumbnailUrl) ?? this.normalizeStringOrNull(mod.logo?.url),
      websiteUrl: this.normalizeStringOrNull(mod.links?.websiteUrl),
    };
  }

  private extractCurseForgeAuthorNames(authors: CurseForgeApiAuthor[] | undefined): string[] {
    if (!Array.isArray(authors)) {
      return [];
    }

    const names = authors
      .map((author) => this.normalizeStringOrNull(author.name))
      .filter((name): name is string => !!name);

    return Array.from(new Set(names));
  }

  private normalizeDateString(value: string | undefined, fallback: string): string {
    const raw = this.normalizeStringOrNull(value);
    if (!raw) {
      return fallback;
    }

    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    return new Date(parsed).toISOString();
  }

  private normalizeStringOrNull(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private async readCurseForgeStore(): Promise<CurseForgeStore> {
    const statePath = config.hytale.curseForgeStatePath;
    if (!(await pathExists(statePath))) {
      return {
        version: 1,
        mods: [],
      };
    }

    try {
      const raw = await readFile(statePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<CurseForgeStore>;
      return this.normalizeCurseForgeStore(parsed);
    } catch {
      this.pushTerminal("CurseForge mod state file is invalid; starting from an empty tracked set.", "system");
      return {
        version: 1,
        mods: [],
      };
    }
  }

  private normalizeCurseForgeStore(input: Partial<CurseForgeStore> | null | undefined): CurseForgeStore {
    if (!input || typeof input !== "object") {
      return {
        version: 1,
        mods: [],
      };
    }

    const mods = Array.isArray(input.mods)
      ? input.mods
          .map((item) => this.normalizeCurseForgeStoredMod(item as Partial<CurseForgeStoredMod>))
          .filter((item): item is CurseForgeStoredMod => !!item)
      : [];

    const dedup = new Map<number, CurseForgeStoredMod>();
    for (const item of mods) {
      dedup.set(item.modId, item);
    }

    return {
      version: 1,
      mods: Array.from(dedup.values()).sort((a, b) => a.modName.localeCompare(b.modName)),
    };
  }

  private normalizeCurseForgeStoredMod(input: Partial<CurseForgeStoredMod>): CurseForgeStoredMod | null {
    const modId = Number(input.modId ?? 0);
    const fileId = Number(input.fileId ?? 0);
    const modName = this.normalizeStringOrNull(input.modName);
    const fileName = this.normalizeStringOrNull(input.fileName);
    const localFilename = this.normalizeStringOrNull(input.localFilename);
    const installedAt = this.normalizeStringOrNull(input.installedAt);

    if (modId <= 0 || fileId <= 0 || !modName || !fileName || !localFilename || !installedAt) {
      return null;
    }

    const authorNames = Array.isArray(input.authorNames)
      ? input.authorNames
          .map((value) => this.normalizeStringOrNull(value))
          .filter((value): value is string => !!value)
      : [];

    return {
      modId,
      modName,
      authorNames: Array.from(new Set(authorNames)),
      fileId,
      fileName,
      localFilename: sanitizeFilename(localFilename),
      installedAt: this.normalizeDateString(installedAt, new Date().toISOString()),
      dateModified: this.normalizeDateString(input.dateModified, new Date(0).toISOString()),
      websiteUrl: this.normalizeStringOrNull(input.websiteUrl),
    };
  }

  private async writeCurseForgeStore(store: CurseForgeStore): Promise<void> {
    const normalized = this.normalizeCurseForgeStore(store);
    await writeFile(config.hytale.curseForgeStatePath, JSON.stringify(normalized, null, 2), "utf8");
  }

  private async removeCurseForgeTrackingForFilename(filename: string): Promise<void> {
    const safe = sanitizeFilename(filename);
    const store = await this.readCurseForgeStore();
    const nextMods = store.mods.filter((item) => item.localFilename !== safe);
    if (nextMods.length === store.mods.length) {
      return;
    }

    await this.writeCurseForgeStore({
      version: 1,
      mods: nextMods,
    });
  }

  private async renameCurseForgeTrackedFilename(from: string, to: string): Promise<void> {
    const safeFrom = sanitizeFilename(from);
    const safeTo = sanitizeFilename(to);
    if (safeFrom === safeTo) {
      return;
    }

    const store = await this.readCurseForgeStore();
    let changed = false;
    const nextMods = store.mods.map((item) => {
      if (item.localFilename !== safeFrom) {
        return item;
      }

      changed = true;
      return {
        ...item,
        localFilename: safeTo,
      };
    });

    if (!changed) {
      return;
    }

    await this.writeCurseForgeStore({
      version: 1,
      mods: nextMods,
    });
  }

  private async getNexusConfig(): Promise<NexusRuntimeConfig | null> {
    const envApiKey = config.hytale.nexusApiKey.trim();
    const envDomain = this.normalizeNexusDomain(config.hytale.nexusGameDomain);
    if (envApiKey && envDomain) {
      return {
        apiHost: config.hytale.nexusApiHost,
        webHost: config.hytale.nexusWebHost,
        ssoWsUrl: config.hytale.nexusSsoWsUrl,
        apiKey: envApiKey,
        gameDomain: envDomain,
        appId: config.hytale.nexusAppId.trim(),
        appName: config.hytale.nexusApplicationName,
        appVersion: config.hytale.nexusApplicationVersion,
        protocolVersion: config.hytale.nexusProtocolVersion,
        pageSize: config.hytale.nexusDefaultPageSize,
        source: "env",
        premium: false,
        userName: "",
      };
    }

    const encryptedApiKey = getAppSetting(NEXUS_SETTING_API_KEY);
    const storedDomain = this.normalizeNexusDomain(getAppSetting(NEXUS_SETTING_GAME_DOMAIN) ?? "");
    if (!encryptedApiKey || !storedDomain) {
      return null;
    }

    const apiKey = await decryptSecret(encryptedApiKey);
    if (!apiKey) {
      return null;
    }

    return {
      apiHost: config.hytale.nexusApiHost,
      webHost: config.hytale.nexusWebHost,
      ssoWsUrl: config.hytale.nexusSsoWsUrl,
      apiKey,
      gameDomain: storedDomain,
      appId: config.hytale.nexusAppId.trim(),
      appName: config.hytale.nexusApplicationName,
      appVersion: config.hytale.nexusApplicationVersion,
      protocolVersion: config.hytale.nexusProtocolVersion,
      pageSize: config.hytale.nexusDefaultPageSize,
      source: "dashboard",
      premium: getAppSetting(NEXUS_SETTING_IS_PREMIUM) === "true",
      userName: getAppSetting(NEXUS_SETTING_USER_NAME) ?? "",
    };
  }

  private async getNexusConfigOrThrow(): Promise<NexusRuntimeConfig> {
    const nexus = await this.getNexusConfig();
    if (nexus) {
      return nexus;
    }

    throw new AppError(
      400,
      "Nexus is not configured. Use the dashboard Connect flow or set HYTALE_NEXUS_API_KEY and HYTALE_NEXUS_GAME_DOMAIN.",
    );
  }

  private normalizeNexusDomain(value: string): string | null {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(normalized)) {
      return null;
    }
    return normalized;
  }

  private async validateNexusApiKey(nexus: NexusRuntimeConfig): Promise<NexusApiKeyValidation> {
    return await this.requestNexusRest<NexusApiKeyValidation>(nexus, "/v1/users/validate", {
      method: "GET",
    });
  }

  private async ensureNexusGameExists(nexus: NexusRuntimeConfig): Promise<void> {
    await this.requestNexusRest<Record<string, unknown>>(nexus, `/v1/games/${encodeURIComponent(nexus.gameDomain)}`, {
      method: "GET",
    });
  }

  private async requestNexusRest<T>(nexus: NexusRuntimeConfig, endpoint: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("APIKEY", nexus.apiKey);
    headers.set("Application-Name", nexus.appName);
    headers.set("Application-Version", nexus.appVersion);
    headers.set("Protocol-Version", nexus.protocolVersion);
    headers.set("User-Agent", `${nexus.appName}/${nexus.appVersion}`);
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const url = `https://${nexus.apiHost}${endpoint}`;
    const response = await this.fetchWithTimeout(
      url,
      {
        ...init,
        headers,
      },
      config.hytale.downloaderApiTimeoutMs,
    );

    const raw = await response.text();
    if (!response.ok) {
      const details = raw.trim() || `${response.status} ${response.statusText}`;
      throw new AppError(response.status, `Nexus API request failed: ${details}`);
    }

    if (!raw.trim()) {
      return {} as T;
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new AppError(500, "Nexus API returned invalid JSON.");
    }
  }

  private async requestNexusGraphQl<T>(
    nexus: NexusRuntimeConfig,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const headers = new Headers();
    headers.set("accept", "application/json");
    headers.set("content-type", "application/json");
    headers.set("APIKEY", nexus.apiKey);
    headers.set("Application-Name", nexus.appName);
    headers.set("Application-Version", nexus.appVersion);
    headers.set("Protocol-Version", nexus.protocolVersion);
    headers.set("User-Agent", `${nexus.appName}/${nexus.appVersion}`);

    const response = await this.fetchWithTimeout(
      `https://${nexus.apiHost}/v2/graphql`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          query,
          variables,
        }),
      },
      config.hytale.downloaderApiTimeoutMs,
    );

    const raw = await response.text();
    let payload: NexusGraphQlResponse<T> = {};
    try {
      payload = JSON.parse(raw) as NexusGraphQlResponse<T>;
    } catch {
      payload = {};
    }

    if (!response.ok) {
      const message = (payload.errors?.[0]?.message ?? raw.trim()) || `${response.status} ${response.statusText}`;
      throw new AppError(response.status, `Nexus GraphQL request failed: ${message}`);
    }

    if (payload.errors && payload.errors.length > 0) {
      const message = payload.errors[0]?.message ?? "Unknown Nexus GraphQL error";
      throw new AppError(400, `Nexus GraphQL error: ${message}`);
    }

    if (!payload.data) {
      throw new AppError(500, "Nexus GraphQL response was empty.");
    }

    return payload.data;
  }

  private normalizeNexusSort(value: string): NexusSearchSort {
    const allowed = new Set<NexusSearchSort>(["popularity", "downloads", "lastUpdated", "name"]);
    if (allowed.has(value as NexusSearchSort)) {
      return value as NexusSearchSort;
    }
    return "popularity";
  }

  private buildNexusModsFilter(gameDomain: string, query: string): Record<string, unknown> {
    const gameFilter = {
      gameDomainName: [{ value: gameDomain, op: "EQUALS" }],
    };

    if (!query) {
      return gameFilter;
    }

    const wildcardValue = `*${query}*`;

    return {
      op: "AND",
      filter: [
        gameFilter,
        {
          op: "OR",
          filter: [
            { name: [{ value: wildcardValue, op: "WILDCARD" }] },
            { author: [{ value: wildcardValue, op: "WILDCARD" }] },
            { uploader: [{ value: wildcardValue, op: "WILDCARD" }] },
          ],
        },
      ],
    };
  }

  private buildNexusModsSort(sort: NexusSearchSort): Array<Record<string, unknown>> {
    switch (sort) {
      case "downloads":
        return [{ downloads: { direction: "DESC" } }];
      case "lastUpdated":
        return [{ updatedAt: { direction: "DESC" } }];
      case "name":
        return [{ name: { direction: "ASC" } }];
      case "popularity":
      default:
        return [{ endorsements: { direction: "DESC" } }];
    }
  }

  private toNexusSearchMod(node: NexusGraphQlModNode): NexusSearchMod {
    return {
      modId: node.modId,
      uid: String(node.uid),
      name: node.name,
      summary: node.summary ?? "",
      author: (node.author ?? "").trim() || "Unknown",
      downloads: node.downloads ?? 0,
      endorsements: node.endorsements ?? 0,
      updatedAt: this.normalizeDateString(node.updatedAt, new Date().toISOString()),
      createdAt: this.normalizeDateString(node.createdAt, new Date().toISOString()),
      thumbnailUrl: node.thumbnailUrl ?? node.pictureUrl ?? null,
      version: node.version ?? "",
    };
  }

  private async fetchNexusModById(nexus: NexusRuntimeConfig, modId: number): Promise<NexusRestModInfo> {
    const mod = await this.requestNexusRest<NexusRestModInfo>(
      nexus,
      `/v1/games/${encodeURIComponent(nexus.gameDomain)}/mods/${modId}`,
      {
        method: "GET",
      },
    );

    const id = Number(mod.mod_id ?? 0);
    if (id <= 0) {
      throw new AppError(404, `Nexus mod ${modId} was not found.`);
    }

    return mod;
  }

  private async fetchNexusModFiles(nexus: NexusRuntimeConfig, modId: number): Promise<NexusRestFileInfo[]> {
    const payload = await this.requestNexusRest<NexusRestModFiles>(
      nexus,
      `/v1/games/${encodeURIComponent(nexus.gameDomain)}/mods/${modId}/files`,
      {
        method: "GET",
      },
    );

    return Array.isArray(payload.files) ? payload.files : [];
  }

  private async resolveLatestNexusFile(nexus: NexusRuntimeConfig, modId: number): Promise<NexusResolvedFile | null> {
    const files = await this.fetchNexusModFiles(nexus, modId);
    return this.selectNexusPreferredFile(files);
  }

  private selectNexusPreferredFile(files: NexusRestFileInfo[]): NexusResolvedFile | null {
    const normalized = files
      .map((file) => this.normalizeNexusFile(file))
      .filter((file): file is NexusResolvedFile => !!file);

    normalized.sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) {
        return left.isPrimary ? -1 : 1;
      }
      if (right.uploadedTimestamp !== left.uploadedTimestamp) {
        return right.uploadedTimestamp - left.uploadedTimestamp;
      }
      return right.fileId - left.fileId;
    });

    return normalized[0] ?? null;
  }

  private normalizeNexusFile(input: NexusRestFileInfo): NexusResolvedFile | null {
    const fileId = Math.trunc(Number(input.file_id ?? 0));
    if (fileId <= 0) {
      return null;
    }

    const category = (input.category_name ?? "").toUpperCase();
    if (category === "REMOVED" || category === "ARCHIVED") {
      return null;
    }

    const rawFileName = this.normalizeStringOrNull(input.file_name) ?? this.normalizeStringOrNull(input.name);
    const fileName = this.normalizeStringOrNull(input.name) ?? rawFileName;
    if (!fileName || !rawFileName) {
      return null;
    }

    return {
      fileId,
      fileUid: String(input.uid ?? fileId),
      fileName,
      fileVersion: this.normalizeStringOrNull(input.version) ?? this.normalizeStringOrNull(input.mod_version) ?? "",
      uploadedTimestamp: Math.max(0, Math.trunc(Number(input.uploaded_timestamp ?? 0))),
      rawFileName,
      isPrimary: !!input.is_primary || category === "MAIN",
    };
  }

  private async installNexusFile(
    nexus: NexusRuntimeConfig,
    mod: NexusRestModInfo,
    file: NexusResolvedFile,
    trackedOverride?: NexusStoredMod,
  ): Promise<{ stored: NexusStoredMod; alreadyInstalled: boolean }> {
    const modId = Math.trunc(Number(mod.mod_id ?? 0));
    if (modId <= 0) {
      throw new AppError(400, "Nexus mod payload did not include a valid mod id.");
    }

    const store = await this.readNexusStore();
    const tracked = trackedOverride ?? store.mods.find((item) => item.modId === modId);
    const modsDir = path.join(config.hytale.serverDir, "mods");
    await mkdir(modsDir, { recursive: true });
    await mkdir(config.app.uploadsDir, { recursive: true });

    if (tracked && tracked.fileId === file.fileId) {
      const trackedPath = path.join(modsDir, tracked.localFilename);
      if (await pathExists(trackedPath)) {
        return {
          stored: tracked,
          alreadyInstalled: true,
        };
      }
    }

    const modName = this.normalizeStringOrNull(mod.name) ?? `Nexus Mod ${modId}`;
    const keepDisabled = tracked?.localFilename.endsWith(".disabled") ?? false;
    const targetName = this.normalizeNexusFilename(file.rawFileName, keepDisabled);
    const downloadUrl = await this.resolveNexusDownloadUrl(nexus, modId, file.fileId);
    this.pushTerminal(`Downloading Nexus mod ${modName} (${file.fileName})...`, "system");

    const tempPath = path.join(config.app.uploadsDir, `nexus-${modId}-${file.fileId}-${randomUUID()}.part`);
    try {
      await this.downloadFileWithProgress(downloadUrl, tempPath, config.hytale.downloaderDownloadTimeoutMs, {
        cacheKey: `nexus-${nexus.gameDomain}-${modId}-${file.fileId}`,
      });

      let targetPath = path.join(modsDir, targetName);
      if (await pathExists(targetPath)) {
        if (tracked && tracked.localFilename === path.basename(targetPath)) {
          await rm(targetPath, { force: true });
        } else {
          targetPath = await this.resolveUniquePath(targetPath);
        }
      }

      await rename(tempPath, targetPath);

      if (tracked && tracked.localFilename !== path.basename(targetPath)) {
        await rm(path.join(modsDir, tracked.localFilename), { force: true });
      }

      const stored: NexusStoredMod = {
        modId,
        modUid: String(mod.uid ?? modId),
        modName,
        author: this.normalizeStringOrNull(mod.author) ?? "Unknown",
        fileId: file.fileId,
        fileUid: file.fileUid,
        fileName: file.fileName,
        fileVersion: file.fileVersion,
        localFilename: path.basename(targetPath),
        installedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        pageUrl: `https://${nexus.webHost}/${nexus.gameDomain}/mods/${modId}`,
      };

      const nextMods = store.mods.filter((item) => item.modId !== modId);
      nextMods.push(stored);
      nextMods.sort((a, b) => a.modName.localeCompare(b.modName));
      await this.writeNexusStore({
        version: 1,
        mods: nextMods,
      });

      this.pushTerminal(`Installed Nexus mod ${modName} as ${path.basename(targetPath)}.`, "system");
      return {
        stored,
        alreadyInstalled: false,
      };
    } finally {
      await rm(tempPath, { force: true });
    }
  }

  private async resolveNexusDownloadUrl(nexus: NexusRuntimeConfig, modId: number, fileId: number): Promise<string> {
    try {
      const mirrors = await this.requestNexusRest<NexusRestDownloadUrl[]>(
        nexus,
        `/v1/games/${encodeURIComponent(nexus.gameDomain)}/mods/${modId}/files/${fileId}/download_link`,
        {
          method: "GET",
        },
      );

      const urls = Array.isArray(mirrors) ? mirrors : [];
      const candidate = urls.find((item) => typeof item.URI === "string" && item.URI.trim().length > 0);
      if (!candidate || !candidate.URI) {
        throw new AppError(500, "Nexus did not return a direct download URL.");
      }
      return candidate.URI.trim();
    } catch (error) {
      if (error instanceof AppError && (error.status === 401 || error.status === 403 || error.status === 400)) {
        throw new AppError(
          409,
          "Nexus direct download failed. This account may require Premium or a temporary key/expires from an NXM manager link.",
        );
      }
      throw error;
    }
  }

  private normalizeNexusFilename(rawName: string, disabled: boolean): string {
    const sanitized = sanitizeFilename(rawName);
    const hasExtension = /\.[a-z0-9]+$/i.test(sanitized);
    const baseName = hasExtension ? sanitized : `${sanitized}.zip`;
    if (!disabled) {
      return baseName;
    }
    return baseName.endsWith(".disabled") ? baseName : `${baseName}.disabled`;
  }

  private async readNexusStore(): Promise<NexusStore> {
    const statePath = config.hytale.nexusStatePath;
    if (!(await pathExists(statePath))) {
      return {
        version: 1,
        mods: [],
      };
    }

    try {
      const raw = await readFile(statePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<NexusStore>;
      return this.normalizeNexusStore(parsed);
    } catch {
      this.pushTerminal("Nexus mod state file is invalid; starting from an empty tracked set.", "system");
      return {
        version: 1,
        mods: [],
      };
    }
  }

  private normalizeNexusStore(input: Partial<NexusStore> | null | undefined): NexusStore {
    if (!input || typeof input !== "object") {
      return {
        version: 1,
        mods: [],
      };
    }

    const mods = Array.isArray(input.mods)
      ? input.mods
          .map((item) => this.normalizeNexusStoredMod(item as Partial<NexusStoredMod>))
          .filter((item): item is NexusStoredMod => !!item)
      : [];

    const dedup = new Map<number, NexusStoredMod>();
    for (const item of mods) {
      dedup.set(item.modId, item);
    }

    return {
      version: 1,
      mods: Array.from(dedup.values()).sort((a, b) => a.modName.localeCompare(b.modName)),
    };
  }

  private normalizeNexusStoredMod(input: Partial<NexusStoredMod>): NexusStoredMod | null {
    const modId = Math.trunc(Number(input.modId ?? 0));
    const fileId = Math.trunc(Number(input.fileId ?? 0));
    const modName = this.normalizeStringOrNull(input.modName);
    const localFilename = this.normalizeStringOrNull(input.localFilename);
    const fileName = this.normalizeStringOrNull(input.fileName);
    const installedAt = this.normalizeStringOrNull(input.installedAt);
    const pageUrl = this.normalizeStringOrNull(input.pageUrl);
    if (modId <= 0 || fileId <= 0 || !modName || !localFilename || !fileName || !installedAt || !pageUrl) {
      return null;
    }

    return {
      modId,
      modUid: this.normalizeStringOrNull(input.modUid) ?? String(modId),
      modName,
      author: this.normalizeStringOrNull(input.author) ?? "Unknown",
      fileId,
      fileUid: this.normalizeStringOrNull(input.fileUid) ?? String(fileId),
      fileName,
      fileVersion: this.normalizeStringOrNull(input.fileVersion) ?? "",
      localFilename: sanitizeFilename(localFilename),
      installedAt: this.normalizeDateString(installedAt, new Date().toISOString()),
      updatedAt: this.normalizeDateString(input.updatedAt, new Date().toISOString()),
      pageUrl,
    };
  }

  private async writeNexusStore(store: NexusStore): Promise<void> {
    const normalized = this.normalizeNexusStore(store);
    await writeFile(config.hytale.nexusStatePath, JSON.stringify(normalized, null, 2), "utf8");
  }

  private async removeNexusTrackingForFilename(filename: string): Promise<void> {
    const safe = sanitizeFilename(filename);
    const store = await this.readNexusStore();
    const nextMods = store.mods.filter((item) => item.localFilename !== safe);
    if (nextMods.length === store.mods.length) {
      return;
    }

    await this.writeNexusStore({
      version: 1,
      mods: nextMods,
    });
  }

  private async renameNexusTrackedFilename(from: string, to: string): Promise<void> {
    const safeFrom = sanitizeFilename(from);
    const safeTo = sanitizeFilename(to);
    if (safeFrom === safeTo) {
      return;
    }

    const store = await this.readNexusStore();
    let changed = false;
    const nextMods = store.mods.map((item) => {
      if (item.localFilename !== safeFrom) {
        return item;
      }

      changed = true;
      return {
        ...item,
        localFilename: safeTo,
      };
    });

    if (!changed) {
      return;
    }

    await this.writeNexusStore({
      version: 1,
      mods: nextMods,
    });
  }

  private async isInstalled(): Promise<boolean> {
    const jarPath = path.join(config.hytale.serverDir, "HytaleServer.jar");
    const assetsPath = path.join(config.hytale.serverDir, "Assets.zip");
    return (await pathExists(jarPath)) && (await pathExists(assetsPath));
  }

  private async consumeStream(stream: ReadableStream<Uint8Array> | null, type: StreamType): Promise<void> {
    if (!stream) {
      return;
    }

    const decoder = new TextDecoder();
    const reader = stream.getReader();
    let pending = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        pending += decoder.decode(value, { stream: true });
        const lines = pending.split(/(?:\r\n|\n|\r)/);
        pending = lines.pop() ?? "";

        for (const line of lines) {
          if (line.length === 0) {
            continue;
          }
          this.pushTerminal(line, type);
        }
      }

      if (pending.length > 0) {
        this.pushTerminal(pending, type);
      }
    } finally {
      reader.releaseLock();
    }
  }

  private pushTerminal(line: string, source: StreamType): void {
    const stamped = `${new Date().toISOString()} [${source}] ${line}`;
    this.terminalBuffer.push(stamped);

    if (this.terminalBuffer.length > config.hytale.terminalBufferLines) {
      this.terminalBuffer.splice(0, this.terminalBuffer.length - config.hytale.terminalBufferLines);
    }

    this.broadcast("server.output", {
      line: stamped,
      source,
    });
  }

  private emitState(): void {
    this.broadcast("server.state", {
      status: this.status,
      startedAt: this.startedAt,
      lastExitCode: this.lastExitCode,
      metricsSampling: this.status === "running" || this.status === "starting",
    });
  }
}
