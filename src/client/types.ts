export type UserRole = "owner" | "member";

export type User = {
  id: number;
  email: string;
  role: UserRole;
  createdAt: string;
};

export type ServerMetricPoint = {
  timestamp: string;
  cpuPercent: number;
  rssBytes: number;
  virtualMemoryBytes: number;
  networkRxBytesPerSec: number | null;
  networkTxBytesPerSec: number | null;
};

export type ServerState = {
  status: "stopped" | "starting" | "running" | "stopping" | "installing";
  startedAt: string | null;
  lastExitCode: number | null;
  installed: boolean;
  javaInstalled: boolean;
  lifecycleReady: boolean;
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  patchline: string;
  command: string;
  serverDir: string;
  bindPort: number;
  autoBackupEnabled: boolean;
  backupFrequencyMinutes: number;
  backupMaxCount: number;
  backupDir: string;
  javaMinHeapMb: number;
  javaMaxHeapMb: number;
  javaExtraArgs: string;
  metricsSampling: boolean;
  metricsSampleIntervalMs: number;
  metricsHistoryLimit: number;
  metrics: ServerMetricPoint[];
  terminal: string[];
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

export type LogFileSummary = {
  name: string;
  size: number;
  modifiedAt: string;
};

export type InviteSummary = {
  id: number;
  email: string;
  role: UserRole;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
};

export type BootstrapPayload = {
  user: User;
  serverState: ServerState;
  mods: ModEntry[];
  backups: BackupEntry[];
  logs: LogFileSummary[];
  invites: InviteSummary[];
};

export type AckMessage = {
  type: "ack";
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  status?: number;
};

export type EventMessage = {
  type: "event";
  event: string;
  payload: unknown;
};
