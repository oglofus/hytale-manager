import {
  FormEvent,
  UIEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Separator } from "./components/ui/separator";
import {
  BackupEntry,
  BootstrapPayload,
  InviteSummary,
  LogFileSummary,
  ModEntry,
  ServerMetricPoint,
  ServerState,
  User,
  WhitelistState,
} from "./types";
import { DashboardSocket } from "./ws";

const TERMINAL_LIMIT = 4_000;
const LONG_OPERATION_TIMEOUT_MS = 20 * 60 * 1000;

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function formatBytes(size: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatRate(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null || !Number.isFinite(bytesPerSecond)) {
    return "-";
  }
  return `${formatBytes(Math.max(0, bytesPerSecond))}/s`;
}

function formatWhitelistSource(
  source: WhitelistState["entries"][number]["source"],
): string {
  if (source === "local-player") {
    return "From local player data";
  }
  if (source === "cache") {
    return "From cached lookup";
  }
  if (source === "remote") {
    return "From remote lookup";
  }
  return "Username unresolved";
}

function normalizePluginKey(value: string): string | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return normalized.length > 0 ? normalized : null;
}

function stripModArtifactExtensions(filename: string): string {
  let baseName = filename.trim();
  if (baseName.toLowerCase().endsWith(".disabled")) {
    baseName = baseName.slice(0, -".disabled".length);
  }
  if (baseName.toLowerCase().endsWith(".jar")) {
    return baseName.slice(0, -".jar".length);
  }
  if (baseName.toLowerCase().endsWith(".zip")) {
    return baseName.slice(0, -".zip".length);
  }
  return baseName;
}

function parsePluginKeyFromFilename(filename: string): string | null {
  const baseName = stripModArtifactExtensions(filename);
  if (!baseName) {
    return null;
  }

  const underscoreMatch = /^(.+?)_([0-9][a-zA-Z0-9._-]*)$/.exec(baseName);
  if (underscoreMatch) {
    return normalizePluginKey(underscoreMatch[1] ?? baseName);
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
    return normalizePluginKey(parts.slice(0, versionIndex).join("-"));
  }

  return normalizePluginKey(baseName);
}

function pluginKeyFromModEntry(mod: ModEntry): string | null {
  return (
    normalizePluginKey(mod.pluginName) ??
    parsePluginKeyFromFilename(mod.filename)
  );
}

function isTopLevelFolderFile(file: File): boolean {
  const relativePath = (file as File & { webkitRelativePath?: string })
    .webkitRelativePath;
  if (!relativePath) {
    return true;
  }

  const segments = relativePath
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment.length > 0);

  return segments.length === 2;
}

function isModArchiveFilename(filename: string): boolean {
  return /\.(jar|zip)$/i.test(filename);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const body = (await response.json()) as T & { ok?: boolean; error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return body;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  // Chunked conversion avoids call stack limits on large uploads.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    const chunk = bytes.subarray(i, i + 0x8000);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export function App() {
  const socket = useMemo(() => new DashboardSocket(), []);
  const terminalRef = useRef<HTMLPreElement | null>(null);
  const shouldFollowTerminalRef = useRef(true);

  const [initialized, setInitialized] = useState(false);
  const [bootstrapRequired, setBootstrapRequired] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const [serverState, setServerState] = useState<ServerState | null>(null);
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [terminalScrollLock, setTerminalScrollLock] = useState(false);
  const [commandInput, setCommandInput] = useState("");

  const [mods, setMods] = useState<ModEntry[]>([]);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [logs, setLogs] = useState<LogFileSummary[]>([]);
  const [whitelist, setWhitelist] = useState<WhitelistState | null>(null);
  const [selectedLog, setSelectedLog] = useState<string>("__terminal__");
  const [logContent, setLogContent] = useState("");

  const [invites, setInvites] = useState<InviteSummary[]>([]);
  const [lastInviteUrl, setLastInviteUrl] = useState("");

  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [setupEmail, setSetupEmail] = useState("");
  const [setupPassword, setSetupPassword] = useState("");

  const [invitePassword, setInvitePassword] = useState("");

  const [inviteEmail, setInviteEmail] = useState("");
  const [whitelistInput, setWhitelistInput] = useState("");
  const [backupNote, setBackupNote] = useState("");
  const [bindPortInput, setBindPortInput] = useState("25565");
  const [autoBackupEnabledInput, setAutoBackupEnabledInput] = useState(true);
  const [backupFrequencyMinutesInput, setBackupFrequencyMinutesInput] =
    useState("30");
  const [backupMaxCountInput, setBackupMaxCountInput] = useState("12");
  const [javaMinHeapInput, setJavaMinHeapInput] = useState("2048");
  const [javaMaxHeapInput, setJavaMaxHeapInput] = useState("4096");
  const [javaExtraArgsInput, setJavaExtraArgsInput] = useState("");

  const inviteToken = useMemo(() => {
    const query = new URLSearchParams(location.search);
    return query.get("invite") ?? "";
  }, []);

  const isRunning = serverState?.status === "running";
  const lifecycleReady = !!serverState?.lifecycleReady;
  const canStart =
    !!serverState &&
    lifecycleReady &&
    !busy &&
    !isRunning &&
    serverState.status !== "starting";
  const canStop =
    !!serverState &&
    !busy &&
    (isRunning || lifecycleReady) &&
    serverState.status !== "stopping";
  const canRestart =
    !!serverState &&
    lifecycleReady &&
    !busy &&
    serverState.status !== "starting" &&
    serverState.status !== "stopping";
  const downloadsLocked = busy || serverState?.status === "installing";
  const metrics = serverState?.metrics ?? [];

  const metricsChartData = useMemo(() => {
    return metrics.map((point) => ({
      ...point,
      time: new Date(point.timestamp).toLocaleTimeString([], {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      rssMiB: point.rssBytes / (1024 * 1024),
      virtualMemoryMiB: point.virtualMemoryBytes / (1024 * 1024),
      rxKiBps:
        point.networkRxBytesPerSec === null
          ? null
          : point.networkRxBytesPerSec / 1024,
      txKiBps:
        point.networkTxBytesPerSec === null
          ? null
          : point.networkTxBytesPerSec / 1024,
    }));
  }, [metrics]);

  const metricsSummary = useMemo(() => {
    if (metrics.length === 0) {
      return null;
    }

    const latest = metrics[metrics.length - 1] ?? null;
    if (!latest) {
      return null;
    }

    let cpuPeak = latest.cpuPercent;
    let rssPeak = latest.rssBytes;
    let rxPeak = latest.networkRxBytesPerSec ?? 0;
    let txPeak = latest.networkTxBytesPerSec ?? 0;

    for (const point of metrics) {
      cpuPeak = Math.max(cpuPeak, point.cpuPercent);
      rssPeak = Math.max(rssPeak, point.rssBytes);
      rxPeak = Math.max(rxPeak, point.networkRxBytesPerSec ?? 0);
      txPeak = Math.max(txPeak, point.networkTxBytesPerSec ?? 0);
    }

    return {
      latest,
      cpuPeak,
      rssPeak,
      rxPeak,
      txPeak,
    };
  }, [metrics]);

  useEffect(() => {
    const unsubscribeEvents = socket.onEvent((event, payload) => {
      if (event === "bootstrap") {
        const data = payload as BootstrapPayload;
        setUser(data.user);
        setServerState(data.serverState);
        setTerminalLines(data.serverState.terminal ?? []);
        setMods(data.mods);
        setBackups(data.backups);
        setLogs(data.logs);
        setWhitelist(data.whitelist);
        setInvites(data.invites);
        setStatus("Realtime connected.");
        return;
      }

      if (event === "server.output") {
        const line = String((payload as { line?: string }).line ?? "");
        if (!line) {
          return;
        }

        setTerminalLines((prev) => {
          const next = [...prev, line];
          if (next.length > TERMINAL_LIMIT) {
            return next.slice(next.length - TERMINAL_LIMIT);
          }
          return next;
        });
        return;
      }

      if (event === "server.metrics") {
        const point = (payload as { point?: ServerMetricPoint }).point;
        if (!point) {
          return;
        }

        setServerState((prev) => {
          if (!prev) {
            return null;
          }

          const nextMetrics = [...(prev.metrics ?? []), point];
          const limit = Math.max(10, prev.metricsHistoryLimit || 300);
          if (nextMetrics.length > limit) {
            nextMetrics.splice(0, nextMetrics.length - limit);
          }

          return {
            ...prev,
            metrics: nextMetrics,
          };
        });
        return;
      }

      if (event === "auth.device") {
        const authPayload = payload as {
          url?: string;
          code?: string;
          openedByServer?: boolean;
        };
        const url = (authPayload.url ?? "").trim();
        const code = (authPayload.code ?? "").trim();
        if (!url) {
          return;
        }

        if (authPayload.openedByServer === true) {
          setStatus(
            "Opened auth page in your default browser. Complete sign-in to continue.",
          );
          return;
        }

        const opened = window.open(url, "_blank", "noopener,noreferrer");
        if (opened) {
          setStatus(
            "Opened auth page in a new tab. Complete sign-in to continue.",
          );
        } else {
          setStatus(
            code
              ? `Open auth URL: ${url} (code: ${code})`
              : `Open auth URL: ${url}`,
          );
        }
        return;
      }

      if (event === "server.state") {
        const partial = payload as Partial<ServerState>;
        setServerState((prev) => {
          if (!prev) {
            return null;
          }
          return {
            ...prev,
            ...partial,
          };
        });
        return;
      }

      if (event === "whitelist.state") {
        const nextWhitelist = (payload as { whitelist?: WhitelistState })
          .whitelist;
        if (nextWhitelist) {
          setWhitelist(nextWhitelist);
        }
      }
    });

    const unsubscribeConnection = socket.onConnection((state) => {
      setConnected(state);
      if (!state) {
        setError("Realtime channel disconnected.");
      }
    });

    return () => {
      unsubscribeEvents();
      unsubscribeConnection();
      socket.disconnect();
    };
  }, [socket]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const response = await fetchJson<{
          ok: boolean;
          user: User | null;
          bootstrapRequired: boolean;
          error?: string;
        }>("/api/auth/me", { method: "GET" }).catch(async () => {
          return await fetchJson<{
            ok: boolean;
            user: User | null;
            bootstrapRequired: boolean;
          }>("/api/auth/bootstrap", {
            method: "GET",
          }).then((bootstrap) => ({
            ok: false,
            user: null,
            bootstrapRequired: bootstrap.bootstrapRequired,
          }));
        });

        if (cancelled) {
          return;
        }

        setBootstrapRequired(response.bootstrapRequired);
        setUser(response.user);

        if (response.user) {
          await socket.connect();
        }
      } catch (initError) {
        if (!cancelled) {
          setError((initError as Error).message);
        }
      } finally {
        if (!cancelled) {
          setInitialized(true);
        }
      }
    }

    void init();

    return () => {
      cancelled = true;
    };
  }, [socket]);

  useEffect(() => {
    if (!selectedLog || selectedLog === "__terminal__") {
      setLogContent(terminalLines.join("\n"));
    }
  }, [selectedLog, terminalLines]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    if (!terminalScrollLock && !shouldFollowTerminalRef.current) {
      return;
    }

    terminal.scrollTop = terminal.scrollHeight;
  }, [terminalLines, terminalScrollLock]);

  useEffect(() => {
    if (!terminalScrollLock) {
      return;
    }

    shouldFollowTerminalRef.current = true;
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.scrollTop = terminal.scrollHeight;
  }, [terminalScrollLock]);

  useEffect(() => {
    if (!user || !connected) {
      return;
    }

    const status = serverState?.status;
    if (
      status !== "installing" &&
      status !== "starting" &&
      status !== "stopping"
    ) {
      return;
    }

    let disposed = false;
    const refresh = async () => {
      try {
        const snapshot = await socket.request<ServerState>(
          "server.status",
          undefined,
          10_000,
        );
        if (disposed) {
          return;
        }

        setServerState(snapshot);
        setTerminalLines(snapshot.terminal ?? []);
      } catch {
        // Ignore polling errors; websocket events are still primary.
      }
    };

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 1500);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [socket, user, connected, serverState?.status]);

  useEffect(() => {
    if (!serverState) {
      return;
    }

    if (serverState.bindPort) {
      setBindPortInput(String(serverState.bindPort));
    }

    setAutoBackupEnabledInput(serverState.autoBackupEnabled);
    setBackupFrequencyMinutesInput(String(serverState.backupFrequencyMinutes));
    setBackupMaxCountInput(String(serverState.backupMaxCount));
    setJavaMinHeapInput(String(serverState.javaMinHeapMb));
    setJavaMaxHeapInput(String(serverState.javaMaxHeapMb));
    setJavaExtraArgsInput(serverState.javaExtraArgs ?? "");
  }, [
    serverState?.bindPort,
    serverState?.autoBackupEnabled,
    serverState?.backupFrequencyMinutes,
    serverState?.backupMaxCount,
    serverState?.javaMinHeapMb,
    serverState?.javaMaxHeapMb,
    serverState?.javaExtraArgs,
  ]);

  function handleTerminalScroll(event: UIEvent<HTMLPreElement>) {
    const element = event.currentTarget;
    if (terminalScrollLock) {
      shouldFollowTerminalRef.current = true;
      element.scrollTop = element.scrollHeight;
      return;
    }

    const delta =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    shouldFollowTerminalRef.current = delta <= 12;
  }

  async function request<T = unknown>(
    action: string,
    payload?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T> {
    setError("");
    return await socket.request<T>(action, payload, timeoutMs);
  }

  async function refreshLogs(): Promise<void> {
    const items = await request<LogFileSummary[]>("logs.list");
    setLogs(items);
  }

  async function refreshBackups(): Promise<void> {
    const items = await request<BackupEntry[]>("backups.list");
    setBackups(items);
  }

  async function refreshMods(): Promise<void> {
    const items = await request<ModEntry[]>("mods.list");
    setMods(items);
  }

  async function refreshWhitelist(): Promise<void> {
    const next = await request<WhitelistState>("whitelist.list");
    setWhitelist(next);
  }

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const body = await fetchJson<{ ok: boolean; user: User }>(
        "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ email: loginEmail, password: loginPassword }),
        },
      );

      setUser(body.user);
      setBootstrapRequired(false);
      await socket.connect();
      setStatus("Logged in.");
    } catch (loginError) {
      setError((loginError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSetup(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const body = await fetchJson<{ ok: boolean; user: User }>(
        "/api/auth/setup",
        {
          method: "POST",
          body: JSON.stringify({ email: setupEmail, password: setupPassword }),
        },
      );

      setUser(body.user);
      setBootstrapRequired(false);
      await socket.connect();
      setStatus("Owner account created.");
    } catch (setupError) {
      setError((setupError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleInviteRegistration(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const body = await fetchJson<{ ok: boolean; user: User }>(
        "/api/auth/register-invite",
        {
          method: "POST",
          body: JSON.stringify({
            token: inviteToken,
            password: invitePassword,
          }),
        },
      );

      setUser(body.user);
      setBootstrapRequired(false);
      await socket.connect();
      setStatus("Invite accepted.");
      const cleanUrl = new URL(location.href);
      cleanUrl.searchParams.delete("invite");
      history.replaceState(null, "", cleanUrl.toString());
    } catch (registerError) {
      setError((registerError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    setError("");

    try {
      await fetchJson<{ ok: boolean }>("/api/auth/logout", {
        method: "POST",
      });

      socket.disconnect();
      setUser(null);
      setServerState(null);
      setTerminalLines([]);
      setMods([]);
      setBackups([]);
      setLogs([]);
      setWhitelist(null);
      setInvites([]);
      setStatus("Logged out.");
    } catch (logoutError) {
      setError((logoutError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleInstall() {
    setBusy(true);
    setError("");
    setStatus("Installation started...");

    try {
      const result = await request<{
        version: string;
        updated: boolean;
        applied: boolean;
      }>("server.install", undefined, LONG_OPERATION_TIMEOUT_MS);

      const snapshot = await request<ServerState>("server.status");
      setServerState(snapshot);
      if (!result.applied) {
        setStatus(`Already up to date (${result.version}).`);
      } else {
        setStatus(
          result.updated
            ? `Updated to ${result.version}.`
            : `Installed ${result.version}.`,
        );
      }
    } catch (installError) {
      setError((installError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runServerAction(
    action: "server.start" | "server.stop" | "server.restart",
  ) {
    if (!serverState) {
      return;
    }

    if (action === "server.stop") {
      if (serverState.status !== "running" && !serverState.lifecycleReady) {
        setError(
          "Install latest server and Adoptium JDK 25 before using lifecycle actions.",
        );
        return;
      }
    } else if (!serverState.lifecycleReady) {
      setError(
        "Install latest server and Adoptium JDK 25 before starting or restarting.",
      );
      return;
    }

    setBusy(true);
    setError("");

    try {
      const timeoutMs =
        action === "server.stop" ? undefined : LONG_OPERATION_TIMEOUT_MS;
      await request(action, undefined, timeoutMs);
      const snapshot = await request<ServerState>("server.status");
      setServerState(snapshot);
      setStatus(`${action} completed.`);
    } catch (actionError) {
      setError((actionError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveRuntimeSettings(event: FormEvent) {
    event.preventDefault();
    if (user?.role !== "owner") {
      setError("Only the owner can update server runtime settings.");
      return;
    }

    const bindPort = Number(bindPortInput.trim());
    const backupFrequencyMinutes = Number(backupFrequencyMinutesInput.trim());
    const backupMaxCount = Number(backupMaxCountInput.trim());
    const javaMinHeapMb = Number(javaMinHeapInput.trim());
    const javaMaxHeapMb = Number(javaMaxHeapInput.trim());
    const javaExtraArgs = javaExtraArgsInput.trim();

    if (!Number.isInteger(bindPort) || bindPort < 1 || bindPort > 65535) {
      setError("Server bind port must be an integer between 1 and 65535.");
      return;
    }

    if (
      !Number.isInteger(backupFrequencyMinutes) ||
      backupFrequencyMinutes < 1 ||
      backupFrequencyMinutes > 1440
    ) {
      setError("Backup frequency must be an integer between 1 and 1440.");
      return;
    }

    if (!Number.isInteger(backupMaxCount) || backupMaxCount < 1) {
      setError("Backup max count must be a positive integer.");
      return;
    }

    if (!Number.isInteger(javaMinHeapMb) || javaMinHeapMb < 256) {
      setError("Java min heap must be an integer of at least 256 MB.");
      return;
    }

    if (!Number.isInteger(javaMaxHeapMb) || javaMaxHeapMb < 256) {
      setError("Java max heap must be an integer of at least 256 MB.");
      return;
    }

    if (javaMinHeapMb > javaMaxHeapMb) {
      setError("Java min heap cannot be greater than Java max heap.");
      return;
    }

    if (javaExtraArgs.length > 2000) {
      setError("Extra JVM args are too long (maximum 2000 characters).");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const snapshot = await request<ServerState>("server.runtime.update", {
        bindPort,
        autoBackupEnabled: autoBackupEnabledInput,
        backupFrequencyMinutes,
        backupMaxCount,
        javaMinHeapMb,
        javaMaxHeapMb,
        javaExtraArgs,
      });
      setServerState(snapshot);
      setStatus(
        serverState?.status === "running"
          ? "Runtime settings saved. Restart server to apply fully."
          : "Runtime settings saved.",
      );
    } catch (settingsError) {
      setError((settingsError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sendTerminalCommand(event: FormEvent) {
    event.preventDefault();
    const value = commandInput.trim();
    if (!value) {
      return;
    }

    setCommandInput("");
    try {
      await request("server.command", { value });
    } catch (commandError) {
      setError((commandError as Error).message);
    }
  }

  async function handleLogSelection(name: string) {
    setSelectedLog(name);
    if (name === "__terminal__") {
      setLogContent(terminalLines.join("\n"));
      return;
    }

    try {
      const response = await request<{ name: string; content: string }>(
        "logs.read",
        { name, tail: 700 },
      );
      setLogContent(response.content);
    } catch (logError) {
      setError((logError as Error).message);
    }
  }

  async function uploadModFile(file: File): Promise<ModEntry> {
    const session = await request<{ uploadId: string }>("mod.upload.start", {
      filename: file.name,
      size: file.size,
    });

    const chunkSize = 128 * 1024;
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const chunk = file.slice(offset, offset + chunkSize);
      const base64 = toBase64(await chunk.arrayBuffer());
      await request("mod.upload.chunk", {
        uploadId: session.uploadId,
        chunk: base64,
      });
    }

    const result = await request<{ mod: ModEntry; mods: ModEntry[] }>(
      "mod.upload.finish",
      {
        uploadId: session.uploadId,
      },
    );

    return result.mod;
  }

  async function handleModUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem(
      "mod-file",
    ) as HTMLInputElement | null;
    const files = input?.files;

    if (!files || files.length === 0) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      for (const file of files) {
        await uploadModFile(file);
      }

      await refreshMods();
      setStatus("Mod upload complete.");
      if (input) {
        input.value = "";
      }
    } catch (uploadError) {
      setError((uploadError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleModFolderSync(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem(
      "mod-sync-folder",
    ) as HTMLInputElement | null;
    const files = input?.files;
    if (!files || files.length === 0) {
      return;
    }

    const allFiles = Array.from(files);
    const selected = allFiles
      .filter((file) => isTopLevelFolderFile(file))
      .filter((file) => isModArchiveFilename(file.name))
      .sort((left, right) => left.name.localeCompare(right.name));

    if (selected.length === 0) {
      setError(
        "Selected folder has no top-level .jar or .zip files. Subfolders are ignored.",
      );
      return;
    }

    const ignoredCount = allFiles.length - selected.length;

    setBusy(true);
    setError("");
    setStatus(`Syncing folder (${selected.length} mods)...`);

    try {
      const uploadedPluginKeys = new Set<string>();
      for (const file of selected) {
        const mod = await uploadModFile(file);
        const pluginKey = pluginKeyFromModEntry(mod);
        if (pluginKey) {
          uploadedPluginKeys.add(pluginKey);
        }
      }

      const currentMods = await request<ModEntry[]>("mods.list");
      let removed = 0;

      for (const mod of currentMods) {
        const pluginKey = pluginKeyFromModEntry(mod);
        if (!pluginKey || uploadedPluginKeys.has(pluginKey)) {
          continue;
        }

        await request<ModEntry[]>("mod.delete", { filename: mod.filename });
        removed += 1;
      }

      const finalMods = await request<ModEntry[]>("mods.list");
      setMods(finalMods);
      setStatus(
        `Folder sync complete. Added/updated: ${selected.length}, removed: ${removed}, ignored: ${ignoredCount}.`,
      );
      if (input) {
        input.value = "";
      }
    } catch (syncError) {
      setError((syncError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setModState(filename: string, disabled: boolean) {
    try {
      const next = await request<ModEntry[]>(
        disabled ? "mod.disable" : "mod.enable",
        {
          filename,
        },
      );
      setMods(next);
    } catch (modError) {
      setError((modError as Error).message);
    }
  }

  async function deleteMod(filename: string) {
    try {
      const next = await request<ModEntry[]>("mod.delete", { filename });
      setMods(next);
    } catch (modError) {
      setError((modError as Error).message);
    }
  }

  async function updateWhitelistEnabled(enabled: boolean) {
    if (user?.role !== "owner") {
      setError("Only the owner can change whitelist settings.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const next = await request<WhitelistState>("whitelist.setEnabled", {
        enabled,
      });
      setWhitelist(next);
      setStatus(`Whitelist ${next.enabled ? "enabled" : "disabled"}.`);
    } catch (whitelistError) {
      setError((whitelistError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addWhitelistEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (user?.role !== "owner") {
      setError("Only the owner can add whitelist entries.");
      return;
    }

    const value = whitelistInput.trim();
    if (!value) {
      return;
    }

    setBusy(true);
    setError("");
    try {
      const next = await request<WhitelistState>("whitelist.add", { value });
      setWhitelist(next);
      setWhitelistInput("");
      setStatus("Whitelist entry added.");
    } catch (whitelistError) {
      setError((whitelistError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeWhitelistEntry(uuid: string) {
    if (user?.role !== "owner") {
      setError("Only the owner can remove whitelist entries.");
      return;
    }

    try {
      const next = await request<WhitelistState>("whitelist.remove", { uuid });
      setWhitelist(next);
      setStatus("Whitelist entry removed.");
    } catch (whitelistError) {
      setError((whitelistError as Error).message);
    }
  }

  async function createBackup() {
    setBusy(true);
    setError("");

    try {
      const data = await request<{ backups: BackupEntry[] }>("backup.create", {
        note: backupNote,
      });
      setBackups(data.backups);
      setBackupNote("");
      setStatus("Backup created.");
    } catch (backupError) {
      setError((backupError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteBackup(id: string) {
    try {
      const next = await request<BackupEntry[]>("backup.delete", { id });
      setBackups(next);
    } catch (deleteError) {
      setError((deleteError as Error).message);
    }
  }

  async function restoreBackup(id: string) {
    setBusy(true);
    setError("");

    try {
      await request("backup.restore", { id });
      setStatus(`Backup ${id} restored.`);
    } catch (restoreError) {
      setError((restoreError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createInvite() {
    if (!inviteEmail.trim()) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const data = await request<{
        invite: { inviteUrl: string; emailDispatched: boolean };
        invites: InviteSummary[];
      }>("invite.create", { email: inviteEmail.trim(), role: "member" });

      setInvites(data.invites);
      setLastInviteUrl(data.invite.inviteUrl);
      setInviteEmail("");
      setStatus(
        data.invite.emailDispatched
          ? "Invite email sent."
          : "Invite created (SMTP not configured). Copy the link.",
      );
    } catch (inviteError) {
      setError((inviteError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function installJavaRuntime() {
    setBusy(true);
    setError("");
    setStatus("Installing Adoptium JDK 25...");

    try {
      const result = await request<{
        javaCommand: string;
        releaseName: string;
      }>("java.install", undefined, LONG_OPERATION_TIMEOUT_MS);
      const snapshot = await request<ServerState>("server.status");
      setServerState(snapshot);
      setStatus(
        `Java installed (${result.releaseName}) at ${result.javaCommand}`,
      );
    } catch (installError) {
      setError((installError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revokeInvite(id: number) {
    try {
      const next = await request<InviteSummary[]>("invite.revoke", { id });
      setInvites(next);
    } catch (revokeError) {
      setError((revokeError as Error).message);
    }
  }

  if (!initialized) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Hytale Manager</CardTitle>
            <CardDescription>Loading dashboard...</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,var(--color-accent)_0%,transparent_55%)] p-4 sm:p-8">
        <div className="mx-auto flex min-h-[80vh] w-full max-w-md items-center">
          <Card className="w-full backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-2xl">Hytale Manager</CardTitle>
              <CardDescription>
                Single server control dashboard with live WebSocket operations.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {inviteToken ? (
                <form onSubmit={handleInviteRegistration} className="space-y-4">
                  <div>
                    <h2 className="text-lg font-semibold">Accept invite</h2>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invite-password">Password</Label>
                    <Input
                      id="invite-password"
                      type="password"
                      value={invitePassword}
                      onChange={(event) =>
                        setInvitePassword(event.target.value)
                      }
                      placeholder="Minimum 8 characters"
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? "Creating account..." : "Create account"}
                  </Button>
                </form>
              ) : bootstrapRequired ? (
                <form onSubmit={handleSetup} className="space-y-4">
                  <div>
                    <h2 className="text-lg font-semibold">
                      Create owner account
                    </h2>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="setup-email">Email</Label>
                    <Input
                      id="setup-email"
                      type="email"
                      value={setupEmail}
                      onChange={(event) => setSetupEmail(event.target.value)}
                      placeholder="owner@example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="setup-password">Password</Label>
                    <Input
                      id="setup-password"
                      type="password"
                      value={setupPassword}
                      onChange={(event) => setSetupPassword(event.target.value)}
                      placeholder="Minimum 8 characters"
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? "Creating..." : "Create owner"}
                  </Button>
                </form>
              ) : (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <h2 className="text-lg font-semibold">Sign in</h2>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email</Label>
                    <Input
                      id="login-email"
                      type="email"
                      value={loginEmail}
                      onChange={(event) => setLoginEmail(event.target.value)}
                      placeholder="user@example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Password</Label>
                    <Input
                      id="login-password"
                      type="password"
                      value={loginPassword}
                      onChange={(event) => setLoginPassword(event.target.value)}
                      placeholder="Password"
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? "Signing in..." : "Sign in"}
                  </Button>
                </form>
              )}

              {error && (
                <p className="rounded-none border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,var(--color-accent)_0%,transparent_42%),radial-gradient(circle_at_bottom_right,var(--color-secondary)_0%,transparent_48%)] p-3 sm:p-6">
      <div className="mx-auto flex w-full max-w-375 flex-col gap-4">
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Hytale Manager
              </h1>
              <p className="text-sm text-muted-foreground">
                Logged in as <strong>{user.email}</strong> ({user.role})
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={connected ? "secondary" : "destructive"}>
                {connected ? "Realtime connected" : "Realtime offline"}
              </Badge>
              <Badge variant="outline">
                Status: {serverState?.status ?? "unknown"}
              </Badge>
              <Button
                size="sm"
                onClick={() => void runServerAction("server.start")}
                disabled={!canStart}
              >
                Start
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void runServerAction("server.stop")}
                disabled={!canStop}
              >
                Stop
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void runServerAction("server.restart")}
                disabled={!canRestart}
              >
                Restart
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => void handleLogout()}
                disabled={busy}
              >
                Logout
              </Button>
            </div>
          </CardContent>
        </Card>

        <section className="grid gap-4 xl:grid-cols-12 @container">
          <Card className="xl:col-span-3 block h-full">
            <CardContent className="space-y-3 h-full flex flex-col gap-2">
              {!serverState?.installed || serverState?.updateAvailable ? (
                <Button
                  onClick={() => void handleInstall()}
                  disabled={downloadsLocked}
                  className="w-full"
                >
                  {downloadsLocked
                    ? "Working..."
                    : serverState?.installed
                      ? `Update server${serverState.latestVersion ? ` to ${serverState.latestVersion}` : ""}`
                      : `Install latest${serverState?.latestVersion ? ` (${serverState.latestVersion})` : ""}`}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Server is up to date.
                </p>
              )}
              {!serverState?.javaInstalled && (
                <Button
                  onClick={() => void installJavaRuntime()}
                  disabled={downloadsLocked}
                  variant="secondary"
                  className="w-full"
                >
                  {downloadsLocked ? "Working..." : "Install Adoptium JDK 25"}
                </Button>
              )}
              <Separator />
              <div className="space-y-1 text-sm text-muted-foreground">
                <p>Patchline: {serverState?.patchline ?? "-"}</p>
                {!serverState?.javaInstalled && (
                  <p>Java runtime: Not installed</p>
                )}
                <p>
                  Java heap: {serverState?.javaMinHeapMb ?? "-"} MB /{" "}
                  {serverState?.javaMaxHeapMb ?? "-"} MB
                </p>
                <p>Installed version: {serverState?.installedVersion ?? "-"}</p>
                <p>Latest version: {serverState?.latestVersion ?? "-"}</p>
                {!serverState?.lifecycleReady && (
                  <p>
                    Start/stop/restart require both server files and Adoptium
                    JDK 25 installed.
                  </p>
                )}
                <p className="truncate">
                  Server directory: {serverState?.serverDir ?? "-"}
                </p>
                <p>Last start: {formatDate(serverState?.startedAt ?? null)}</p>
              </div>
              {user.role === "owner" && (
                <>
                  <Separator />
                  <form
                    onSubmit={saveRuntimeSettings}
                    className="space-y-3 mt-auto"
                  >
                    <h3 className="text-sm font-semibold">Runtime settings</h3>
                    <div className="space-y-2">
                      <Label htmlFor="server-bind-port">Game port</Label>
                      <Input
                        id="server-bind-port"
                        type="number"
                        min={1}
                        max={65535}
                        step={1}
                        value={bindPortInput}
                        onChange={(event) =>
                          setBindPortInput(event.target.value)
                        }
                        placeholder="25565"
                        disabled={busy}
                      />
                    </div>
                    <label className="flex items-center justify-between gap-3 rounded-none border p-2 text-sm">
                      <span>Enable automatic backups</span>
                      <input
                        type="checkbox"
                        checked={autoBackupEnabledInput}
                        onChange={(event) =>
                          setAutoBackupEnabledInput(event.target.checked)
                        }
                        disabled={busy}
                      />
                    </label>
                    <div className="space-y-2">
                      <Label htmlFor="backup-frequency-minutes">
                        Backup frequency (minutes)
                      </Label>
                      <Input
                        id="backup-frequency-minutes"
                        type="number"
                        min={1}
                        max={1440}
                        step={1}
                        value={backupFrequencyMinutesInput}
                        onChange={(event) =>
                          setBackupFrequencyMinutesInput(event.target.value)
                        }
                        disabled={busy || !autoBackupEnabledInput}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="backup-max-count">
                        Active backup ZIP files to keep
                      </Label>
                      <Input
                        id="backup-max-count"
                        type="number"
                        min={1}
                        step={1}
                        value={backupMaxCountInput}
                        onChange={(event) =>
                          setBackupMaxCountInput(event.target.value)
                        }
                        disabled={busy || !autoBackupEnabledInput}
                      />
                    </div>
                    <Separator />
                    <div className="space-y-2">
                      <Label htmlFor="java-min-heap">Java min heap (MB)</Label>
                      <Input
                        id="java-min-heap"
                        type="number"
                        min={256}
                        step={256}
                        value={javaMinHeapInput}
                        onChange={(event) =>
                          setJavaMinHeapInput(event.target.value)
                        }
                        disabled={busy}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="java-max-heap">Java max heap (MB)</Label>
                      <Input
                        id="java-max-heap"
                        type="number"
                        min={256}
                        step={256}
                        value={javaMaxHeapInput}
                        onChange={(event) =>
                          setJavaMaxHeapInput(event.target.value)
                        }
                        disabled={busy}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="java-extra-args">
                        Extra JVM args (optional)
                      </Label>
                      <Input
                        id="java-extra-args"
                        type="text"
                        value={javaExtraArgsInput}
                        onChange={(event) =>
                          setJavaExtraArgsInput(event.target.value)
                        }
                        placeholder="-XX:+UseG1GC -XX:+HeapDumpOnOutOfMemoryError"
                        disabled={busy}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Default profile follows Hytale guidance for at least 4 GB
                      server memory and JVM sizing best practices:
                      <span className="block">
                        Min heap 2048 MB, max heap 4096 MB.
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Native backups are stored in{" "}
                      {serverState?.backupDir ?? "-"}
                      {". "}Older backups are moved to the archive folder by
                      Hytale when max count is reached.
                    </p>
                    <Button
                      type="submit"
                      size="sm"
                      className="w-full"
                      disabled={busy}
                    >
                      Save runtime settings
                    </Button>
                  </form>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="xl:col-span-9">
            <CardContent className="space-y-3">
              <div className="group/terminal relative overflow-hidden">
                <pre
                  ref={terminalRef}
                  onScroll={handleTerminalScroll}
                  className="overflow-auto h-[calc(100vh-200px)] rounded-none border bg-zinc-950 p-3 pr-24 text-xs leading-relaxed text-zinc-100"
                >
                  {terminalLines.join("\n")}
                </pre>
                <Button
                  type="button"
                  size="sm"
                  variant={terminalScrollLock ? "default" : "secondary"}
                  className="pointer-events-none absolute right-2 bottom-2 opacity-0 transition-opacity group-hover/terminal:pointer-events-auto group-hover/terminal:opacity-100 group-focus-within/terminal:pointer-events-auto group-focus-within/terminal:opacity-100"
                  onClick={() => setTerminalScrollLock((current) => !current)}
                >
                  {terminalScrollLock
                    ? "Auto-scroll locked"
                    : "Lock auto-scroll"}
                </Button>
              </div>
              <form onSubmit={sendTerminalCommand} className="flex gap-2">
                <Input
                  type="text"
                  value={commandInput}
                  onChange={(event) => setCommandInput(event.target.value)}
                  placeholder="Type Hytale command, e.g. /save"
                />
                <Button type="submit" disabled={busy}>
                  Send
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="xl:col-span-12">
            <CardHeader>
              <CardTitle>Runtime Metrics</CardTitle>
              <CardDescription>
                Live server metrics sampled every{" "}
                {Math.max(
                  1,
                  Math.round(
                    (serverState?.metricsSampleIntervalMs ?? 2000) / 1000,
                  ),
                )}
                s while running.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {metricsSummary ? (
                <div className="grid gap-3 md:grid-cols-5">
                  <div className="rounded-none border p-3">
                    <p className="text-xs text-muted-foreground">CPU now</p>
                    <p className="text-lg font-semibold">
                      {metricsSummary.latest.cpuPercent.toFixed(1)}%
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Peak {metricsSummary.cpuPeak.toFixed(1)}%
                    </p>
                  </div>
                  <div className="rounded-none border p-3">
                    <p className="text-xs text-muted-foreground">Memory RSS</p>
                    <p className="text-lg font-semibold">
                      {formatBytes(metricsSummary.latest.rssBytes)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Peak {formatBytes(metricsSummary.rssPeak)}
                    </p>
                  </div>
                  <div className="rounded-none border p-3">
                    <p className="text-xs text-muted-foreground">
                      Virtual memory
                    </p>
                    <p className="text-lg font-semibold">
                      {formatBytes(metricsSummary.latest.virtualMemoryBytes)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Java process space
                    </p>
                  </div>
                  <div className="rounded-none border p-3">
                    <p className="text-xs text-muted-foreground">Network RX</p>
                    <p className="text-lg font-semibold">
                      {formatRate(metricsSummary.latest.networkRxBytesPerSec)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Peak {formatRate(metricsSummary.rxPeak)}
                    </p>
                  </div>
                  <div className="rounded-none border p-3">
                    <p className="text-xs text-muted-foreground">Network TX</p>
                    <p className="text-lg font-semibold">
                      {formatRate(metricsSummary.latest.networkTxBytesPerSec)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Peak {formatRate(metricsSummary.txPeak)}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="rounded-none border p-3 text-sm text-muted-foreground">
                  Start the server to collect runtime metrics.
                </p>
              )}

              {metricsChartData.length > 0 && (
                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="h-56 rounded-none border p-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={metricsChartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="time" minTickGap={28} />
                        <YAxis
                          yAxisId="cpu"
                          width={45}
                          tickFormatter={(value) =>
                            `${Number(value).toFixed(0)}%`
                          }
                        />
                        <YAxis
                          yAxisId="mem"
                          orientation="right"
                          width={58}
                          tickFormatter={(value) =>
                            `${Number(value).toFixed(0)}M`
                          }
                        />
                        <Tooltip
                          formatter={(value: number, name: string) => {
                            if (name === "cpuPercent") {
                              return [`${Number(value).toFixed(1)}%`, "CPU"];
                            }
                            if (name === "rssMiB") {
                              return [
                                `${Number(value).toFixed(1)} MiB`,
                                "RSS Memory",
                              ];
                            }
                            return [value, name];
                          }}
                        />
                        <Line
                          yAxisId="cpu"
                          type="monotone"
                          dataKey="cpuPercent"
                          stroke="#e11d48"
                          strokeWidth={2}
                          dot={false}
                          name="cpuPercent"
                        />
                        <Line
                          yAxisId="mem"
                          type="monotone"
                          dataKey="rssMiB"
                          stroke="#0369a1"
                          strokeWidth={2}
                          dot={false}
                          name="rssMiB"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="h-56 rounded-none border p-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={metricsChartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="time" minTickGap={28} />
                        <YAxis
                          width={62}
                          tickFormatter={(value) =>
                            `${Number(value).toFixed(0)} KiB/s`
                          }
                        />
                        <Tooltip
                          formatter={(value: number, name: string) => {
                            if (name === "rxKiBps") {
                              return [
                                `${Number(value).toFixed(1)} KiB/s`,
                                "Network RX",
                              ];
                            }
                            if (name === "txKiBps") {
                              return [
                                `${Number(value).toFixed(1)} KiB/s`,
                                "Network TX",
                              ];
                            }
                            return [value, name];
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="rxKiBps"
                          stroke="#16a34a"
                          strokeWidth={2}
                          dot={false}
                          name="rxKiBps"
                        />
                        <Line
                          type="monotone"
                          dataKey="txKiBps"
                          stroke="#ca8a04"
                          strokeWidth={2}
                          dot={false}
                          name="txKiBps"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="xl:col-span-6">
            <CardHeader>
              <CardTitle>Logs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void refreshLogs()}
                  disabled={busy}
                >
                  Refresh logs
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleLogSelection("__terminal__")}
                >
                  Live terminal
                </Button>
              </div>
              <ul className="max-h-44 space-y-1 overflow-auto rounded-none border p-2">
                {logs.map((log) => (
                  <li key={log.name}>
                    <Button
                      size="sm"
                      variant={selectedLog === log.name ? "secondary" : "ghost"}
                      className="w-full justify-start"
                      onClick={() => void handleLogSelection(log.name)}
                    >
                      {log.name} ({formatBytes(log.size)})
                    </Button>
                  </li>
                ))}
              </ul>
              <pre className="overflow-auto h-[calc(100vh-170px)] rounded-none border bg-zinc-950 p-3 pr-24 text-xs leading-relaxed text-zinc-100">
                {logContent}
              </pre>
            </CardContent>
          </Card>

          <Card className="xl:col-span-6">
            <CardHeader>
              <CardTitle>Mods</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <form onSubmit={handleModUpload} className="flex flex-wrap gap-2">
                <Input
                  type="file"
                  name="mod-file"
                  multiple
                  accept=".jar,.zip"
                  className="flex-1"
                />
                <Button type="submit" disabled={busy}>
                  Upload mods
                </Button>
              </form>
              <form
                onSubmit={handleModFolderSync}
                className="flex flex-wrap items-center gap-2"
              >
                <input
                  type="file"
                  name="mod-sync-folder"
                  multiple
                  {...({
                    webkitdirectory: "",
                    directory: "",
                  } as Record<string, string>)}
                  className="flex-1 border px-3 py-2 text-sm"
                />
                <Button type="submit" variant="secondary" disabled={busy}>
                  Sync folder
                </Button>
              </form>
              <p className="text-xs text-muted-foreground">
                Folder sync uses only top-level <code>.jar</code>/
                <code>.zip</code> files. Subfolders and other file types are
                ignored.
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void refreshMods()}
                disabled={busy}
              >
                Refresh mods
              </Button>
              <ul className="h-[calc(100vh-140px)] space-y-2 overflow-auto">
                {mods.map((mod) => (
                  <li
                    key={mod.filename}
                    className="flex items-center justify-between gap-3 rounded-none border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {mod.pluginName}
                        {mod.pluginVersion ? ` v${mod.pluginVersion}` : ""}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {mod.filename}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {formatBytes(mod.size)} |{" "}
                        {mod.disabled ? "Disabled" : "Enabled"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void setModState(mod.filename, !mod.disabled)
                        }
                      >
                        {mod.disabled ? "Enable" : "Disable"}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => void deleteMod(mod.filename)}
                      >
                        Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="xl:col-span-6">
            <CardHeader>
              <CardTitle>Whitelist</CardTitle>
              <CardDescription>
                Manage allowed players by UUID or username.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-center justify-between gap-3 rounded-none border p-2 text-sm">
                <span>Whitelist enabled</span>
                <input
                  type="checkbox"
                  checked={whitelist?.enabled ?? false}
                  onChange={(event) =>
                    void updateWhitelistEnabled(event.target.checked)
                  }
                  disabled={busy || user.role !== "owner"}
                />
              </label>

              <form
                onSubmit={addWhitelistEntry}
                className="flex flex-wrap items-center gap-2"
              >
                <Input
                  type="text"
                  value={whitelistInput}
                  onChange={(event) => setWhitelistInput(event.target.value)}
                  placeholder="username or uuid"
                  disabled={busy || user.role !== "owner"}
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={busy || user.role !== "owner"}
                >
                  Add
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void refreshWhitelist()}
                  disabled={busy}
                >
                  Refresh
                </Button>
              </form>

              <p className="text-xs text-muted-foreground">
                UUIDs are stored in <code>whitelist.json</code>. Username
                labels are resolved from local player data, cached lookups, or
                remote lookup.
              </p>

              <ul className="max-h-80 space-y-2 overflow-auto">
                {(whitelist?.entries ?? []).map((entry) => (
                  <li
                    key={entry.uuid}
                    className="flex items-center justify-between gap-3 rounded-none border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {entry.username ?? "Unknown player"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {entry.uuid}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatWhitelistSource(entry.source)}
                        {entry.lastSeenAt
                          ? ` | Updated ${formatDate(entry.lastSeenAt)}`
                          : ""}
                      </p>
                    </div>
                    {user.role === "owner" && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => void removeWhitelistEntry(entry.uuid)}
                        disabled={busy}
                      >
                        Remove
                      </Button>
                    )}
                  </li>
                ))}
                {(whitelist?.entries.length ?? 0) === 0 && (
                  <li className="rounded-none border p-3 text-sm text-muted-foreground">
                    No players in whitelist.
                  </li>
                )}
              </ul>
            </CardContent>
          </Card>

          <Card className="xl:col-span-6">
            <CardHeader>
              <CardTitle>Backups</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="backup-note">Note</Label>
                <Input
                  id="backup-note"
                  type="text"
                  value={backupNote}
                  onChange={(event) => setBackupNote(event.target.value)}
                  placeholder="Manual snapshot note (optional)"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => void createBackup()}
                  disabled={busy}
                >
                  Create manual backup
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void refreshBackups()}
                  disabled={busy}
                >
                  Refresh backups
                </Button>
              </div>

              <ul className="max-h-80 space-y-2 overflow-auto">
                {backups.map((backup) => (
                  <li
                    key={backup.id}
                    className="flex items-center justify-between gap-3 rounded-none border p-3"
                  >
                    <div>
                      <p className="font-medium">{backup.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(backup.createdAt)} |{" "}
                        {backup.source === "native"
                          ? backup.archived
                            ? "Archive"
                            : "Active"
                          : "Manual"}{" "}
                        | {formatBytes(backup.size)}
                      </p>
                      {backup.note && (
                        <p className="text-sm text-muted-foreground">
                          {backup.note}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void restoreBackup(backup.id)}
                        disabled={busy}
                      >
                        Restore
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => void deleteBackup(backup.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {user.role === "owner" && (
            <Card className="xl:col-span-6">
              <CardHeader>
                <CardTitle>Invites</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="friend@example.com"
                  />
                  <Button onClick={() => void createInvite()} disabled={busy}>
                    Invite
                  </Button>
                </div>

                {lastInviteUrl && (
                  <div className="rounded-none border bg-muted/40 p-3">
                    <p className="mb-1 text-sm text-muted-foreground">
                      Latest invite link:
                    </p>
                    <code className="break-all text-xs">{lastInviteUrl}</code>
                  </div>
                )}

                <ul className="max-h-80 space-y-2 overflow-auto">
                  {invites.map((invite) => (
                    <li
                      key={invite.id}
                      className="flex items-center justify-between gap-3 rounded-none border p-3"
                    >
                      <div>
                        <p className="font-medium">{invite.email}</p>
                        <p className="text-sm text-muted-foreground">
                          {invite.acceptedAt
                            ? `Accepted ${formatDate(invite.acceptedAt)}`
                            : `Expires ${formatDate(invite.expiresAt)}`}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => void revokeInvite(invite.id)}
                      >
                        Revoke
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </section>

        {status && (
          <p className="rounded-none border border-emerald-600/30 bg-emerald-500/10 p-3 text-sm text-emerald-700">
            {status}
          </p>
        )}
        {error && (
          <p className="rounded-none border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
