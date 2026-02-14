export type UserRole = "owner" | "member";

export type User = {
  id: number;
  email: string;
  role: UserRole;
  createdAt: string;
};

export type ServerState = {
  status: "stopped" | "starting" | "running" | "stopping" | "installing";
  startedAt: string | null;
  lastExitCode: number | null;
  installed: boolean;
  javaInstalled: boolean;
  lifecycleReady: boolean;
  curseForgeConfigured: boolean;
  curseForgeGameId: number | null;
  curseForgeClassId: number | null;
  curseForgeSource: "env" | "dashboard" | null;
  nexusConfigured: boolean;
  nexusGameDomain: string | null;
  nexusSource: "env" | "dashboard" | null;
  nexusSsoReady: boolean;
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  patchline: string;
  command: string;
  serverDir: string;
  terminal: string[];
};

export type ModEntry = {
  filename: string;
  size: number;
  updatedAt: string;
  disabled: boolean;
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

export type BackupEntry = {
  id: string;
  createdAt: string;
  note: string;
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
  curseForgeInstalled: CurseForgeInstalledMod[];
  nexusInstalled: NexusInstalledMod[];
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
