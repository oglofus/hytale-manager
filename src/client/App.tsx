import {
  FormEvent,
  UIEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import { Separator } from "./components/ui/separator";
import {
  BackupEntry,
  BootstrapPayload,
  CurseForgeInstalledMod,
  CurseForgeSearchMod,
  CurseForgeSearchResult,
  CurseForgeSearchSort,
  InviteSummary,
  LogFileSummary,
  ModEntry,
  NexusInstalledMod,
  NexusSearchMod,
  NexusSearchResult,
  NexusSearchSort,
  ServerState,
  User,
} from "./types";
import { DashboardSocket } from "./ws";

const TERMINAL_LIMIT = 4_000;
const LONG_OPERATION_TIMEOUT_MS = 20 * 60 * 1000;
const CURSEFORGE_PAGE_SIZE = 20;
const NEXUS_PAGE_SIZE = 20;

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
  const [commandInput, setCommandInput] = useState("");

  const [mods, setMods] = useState<ModEntry[]>([]);
  const [curseForgeInstalled, setCurseForgeInstalled] = useState<
    CurseForgeInstalledMod[]
  >([]);
  const [curseForgeResults, setCurseForgeResults] = useState<
    CurseForgeSearchMod[]
  >([]);
  const [curseForgeQuery, setCurseForgeQuery] = useState("");
  const [curseForgeSort, setCurseForgeSort] =
    useState<CurseForgeSearchSort>("popularity");
  const [curseForgePage, setCurseForgePage] = useState(1);
  const [curseForgeTotalCount, setCurseForgeTotalCount] = useState(0);
  const [curseForgeSearching, setCurseForgeSearching] = useState(false);
  const [curseForgeWorking, setCurseForgeWorking] = useState(false);
  const [curseForgeSetupApiKey, setCurseForgeSetupApiKey] = useState("");
  const [curseForgeSetupGameId, setCurseForgeSetupGameId] = useState("70216");
  const [curseForgeSetupClassId, setCurseForgeSetupClassId] = useState("");
  const [nexusInstalled, setNexusInstalled] = useState<NexusInstalledMod[]>([]);
  const [nexusResults, setNexusResults] = useState<NexusSearchMod[]>([]);
  const [nexusQuery, setNexusQuery] = useState("");
  const [nexusSort, setNexusSort] = useState<NexusSearchSort>("popularity");
  const [nexusPage, setNexusPage] = useState(1);
  const [nexusTotalCount, setNexusTotalCount] = useState(0);
  const [nexusSearching, setNexusSearching] = useState(false);
  const [nexusWorking, setNexusWorking] = useState(false);
  const [nexusConnectingSso, setNexusConnectingSso] = useState(false);
  const [nexusManualApiKey, setNexusManualApiKey] = useState("");
  const [nexusGameDomain, setNexusGameDomain] = useState("hytale");
  const nexusSsoRef = useRef<{
    socket: WebSocket | null;
    pingTimer: number | null;
    closed: boolean;
  } | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [logs, setLogs] = useState<LogFileSummary[]>([]);
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
  const [backupNote, setBackupNote] = useState("");

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
  const curseForgeConfigured = !!serverState?.curseForgeConfigured;
  const curseForgeHasNextPage =
    curseForgePage * CURSEFORGE_PAGE_SIZE < curseForgeTotalCount;
  const curseForgeUpdateCount = curseForgeInstalled.filter(
    (item) => item.updateAvailable,
  ).length;
  const nexusConfigured = !!serverState?.nexusConfigured;
  const nexusHasNextPage = nexusPage * NEXUS_PAGE_SIZE < nexusTotalCount;
  const nexusUpdateCount = nexusInstalled.filter(
    (item) => item.updateAvailable,
  ).length;

  useEffect(() => {
    const unsubscribeEvents = socket.onEvent((event, payload) => {
      if (event === "bootstrap") {
        const data = payload as BootstrapPayload;
        setUser(data.user);
        setServerState(data.serverState);
        setTerminalLines(data.serverState.terminal ?? []);
        setMods(data.mods);
        setCurseForgeInstalled(data.curseForgeInstalled ?? []);
        setNexusInstalled(data.nexusInstalled ?? []);
        setNexusGameDomain(data.serverState.nexusGameDomain ?? "hytale");
        setBackups(data.backups);
        setLogs(data.logs);
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
      const sso = nexusSsoRef.current;
      if (sso?.pingTimer) {
        window.clearInterval(sso.pingTimer);
      }
      if (sso?.socket && !sso.closed) {
        sso.closed = true;
        sso.socket.close();
      }
      nexusSsoRef.current = null;
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
    if (!terminal || !shouldFollowTerminalRef.current) {
      return;
    }

    terminal.scrollTop = terminal.scrollHeight;
  }, [terminalLines]);

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
    if (!user || !connected || !curseForgeConfigured) {
      return;
    }

    if (curseForgeResults.length > 0) {
      return;
    }

    void searchCurseForge(1);
  }, [
    user,
    connected,
    curseForgeConfigured,
    curseForgeResults.length,
    curseForgeSort,
  ]);

  useEffect(() => {
    if (!user || !connected || !nexusConfigured) {
      return;
    }

    if (nexusResults.length > 0) {
      return;
    }

    void searchNexusMods(1);
  }, [user, connected, nexusConfigured, nexusResults.length, nexusSort]);

  useEffect(() => {
    if (!serverState) {
      return;
    }

    if (serverState.curseForgeGameId && !curseForgeSetupGameId) {
      setCurseForgeSetupGameId(String(serverState.curseForgeGameId));
    }

    if (serverState.curseForgeClassId !== null && !curseForgeSetupClassId) {
      setCurseForgeSetupClassId(String(serverState.curseForgeClassId));
    }

    if (serverState.nexusGameDomain) {
      setNexusGameDomain(serverState.nexusGameDomain);
    }
  }, [
    serverState,
    curseForgeSetupGameId,
    curseForgeSetupClassId,
    nexusGameDomain,
  ]);

  function handleTerminalScroll(event: UIEvent<HTMLPreElement>) {
    const element = event.currentTarget;
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

  async function searchCurseForge(
    page = 1,
    overrides?: { query?: string; sort?: CurseForgeSearchSort },
  ): Promise<void> {
    if (!curseForgeConfigured) {
      return;
    }

    const query = (overrides?.query ?? curseForgeQuery).trim();
    const sort = overrides?.sort ?? curseForgeSort;

    setCurseForgeSearching(true);
    setError("");

    try {
      const result = await request<CurseForgeSearchResult>(
        "curseforge.search",
        {
          query,
          sort,
          page,
          pageSize: CURSEFORGE_PAGE_SIZE,
        },
      );
      setCurseForgeResults(result.mods);
      setCurseForgePage(result.page);
      setCurseForgeTotalCount(result.totalCount);
    } catch (searchError) {
      setError((searchError as Error).message);
    } finally {
      setCurseForgeSearching(false);
    }
  }

  async function connectCurseForge(event: FormEvent): Promise<void> {
    event.preventDefault();

    if (user?.role !== "owner") {
      setError("Only the owner can configure CurseForge credentials.");
      return;
    }

    const apiKey = curseForgeSetupApiKey.trim();
    const gameIdInput = curseForgeSetupGameId.trim();
    const gameId = Number(
      gameIdInput || serverState?.curseForgeGameId || 70216,
    );
    const classIdRaw = curseForgeSetupClassId.trim();
    const classId = classIdRaw ? Number(classIdRaw) : 0;

    if (!apiKey) {
      setError("CurseForge API key is required.");
      return;
    }
    if (!Number.isFinite(gameId) || gameId <= 0) {
      setError("CurseForge game ID must be a positive integer.");
      return;
    }
    if (!Number.isFinite(classId) || classId < 0) {
      setError("CurseForge class ID must be zero or a positive integer.");
      return;
    }

    setCurseForgeWorking(true);
    setError("");

    try {
      const response = await request<{
        configured: boolean;
        gameId: number;
        classId: number;
        serverState: ServerState;
      }>("curseforge.connect", {
        apiKey,
        gameId,
        classId,
      });

      setServerState(response.serverState);
      setCurseForgeSetupApiKey("");
      setCurseForgeSetupGameId(String(response.gameId));
      setCurseForgeSetupClassId(String(response.classId));
      setStatus("CurseForge connected successfully.");

      const [installed, search] = await Promise.all([
        request<CurseForgeInstalledMod[]>("curseforge.installed", {
          checkUpdates: false,
        }),
        request<CurseForgeSearchResult>("curseforge.search", {
          query: "",
          sort: "popularity",
          page: 1,
          pageSize: CURSEFORGE_PAGE_SIZE,
        }),
      ]);
      setCurseForgeInstalled(installed);
      setCurseForgeResults(search.mods);
      setCurseForgePage(search.page);
      setCurseForgeTotalCount(search.totalCount);
    } catch (connectError) {
      setError((connectError as Error).message);
    } finally {
      setCurseForgeWorking(false);
    }
  }

  async function refreshCurseForgeInstalled(
    checkUpdates: boolean,
  ): Promise<void> {
    if (!curseForgeConfigured) {
      return;
    }

    setCurseForgeWorking(true);
    setError("");

    try {
      const installed = await request<CurseForgeInstalledMod[]>(
        checkUpdates ? "curseforge.checkUpdates" : "curseforge.installed",
        checkUpdates ? undefined : { checkUpdates: false },
      );
      setCurseForgeInstalled(installed);
      if (checkUpdates) {
        setStatus("CurseForge updates checked.");
      }
    } catch (checkError) {
      setError((checkError as Error).message);
    } finally {
      setCurseForgeWorking(false);
    }
  }

  async function installCurseForgeMod(modId: number): Promise<void> {
    if (!curseForgeConfigured) {
      return;
    }

    setCurseForgeWorking(true);
    setError("");

    try {
      const result = await request<{
        installedMod: CurseForgeInstalledMod | null;
        mods: ModEntry[];
        installed: CurseForgeInstalledMod[];
        alreadyInstalled: boolean;
      }>("curseforge.install", { modId }, LONG_OPERATION_TIMEOUT_MS);

      setMods(result.mods);
      setCurseForgeInstalled(result.installed);
      setStatus(
        result.alreadyInstalled
          ? "Mod is already installed."
          : "CurseForge mod installed.",
      );
    } catch (installError) {
      setError((installError as Error).message);
    } finally {
      setCurseForgeWorking(false);
    }
  }

  async function updateCurseForgeMod(modId: number): Promise<void> {
    if (!curseForgeConfigured) {
      return;
    }

    setCurseForgeWorking(true);
    setError("");

    try {
      const result = await request<{
        updated: boolean;
        installedMod: CurseForgeInstalledMod | null;
        installed: CurseForgeInstalledMod[];
        mods: ModEntry[];
      }>("curseforge.update", { modId }, LONG_OPERATION_TIMEOUT_MS);
      setMods(result.mods);
      setCurseForgeInstalled(result.installed);
      setStatus(
        result.updated
          ? "CurseForge mod updated."
          : "Mod is already up to date.",
      );
    } catch (updateError) {
      setError((updateError as Error).message);
    } finally {
      setCurseForgeWorking(false);
    }
  }

  async function updateAllCurseForgeMods(): Promise<void> {
    if (!curseForgeConfigured) {
      return;
    }

    setCurseForgeWorking(true);
    setError("");

    try {
      const result = await request<{
        updated: number;
        skipped: number;
        installed: CurseForgeInstalledMod[];
        mods: ModEntry[];
      }>("curseforge.updateAll", undefined, LONG_OPERATION_TIMEOUT_MS);
      setMods(result.mods);
      setCurseForgeInstalled(result.installed);
      setStatus(
        `CurseForge update complete. Updated: ${result.updated}, skipped: ${result.skipped}.`,
      );
    } catch (updateError) {
      setError((updateError as Error).message);
    } finally {
      setCurseForgeWorking(false);
    }
  }

  function cleanupNexusSsoSession(): void {
    const current = nexusSsoRef.current;
    if (!current) {
      return;
    }

    if (current.pingTimer) {
      window.clearInterval(current.pingTimer);
    }
    if (current.socket && !current.closed) {
      current.closed = true;
      current.socket.close();
    }
    nexusSsoRef.current = null;
  }

  async function searchNexusMods(
    page = 1,
    overrides?: { query?: string; sort?: NexusSearchSort },
  ): Promise<void> {
    if (!nexusConfigured) {
      return;
    }

    const query = (overrides?.query ?? nexusQuery).trim();
    const sort = overrides?.sort ?? nexusSort;

    setNexusSearching(true);
    setError("");

    try {
      const result = await request<NexusSearchResult>("nexus.search", {
        query,
        sort,
        page,
        pageSize: NEXUS_PAGE_SIZE,
      });
      setNexusResults(result.mods);
      setNexusPage(result.page);
      setNexusTotalCount(result.totalCount);
    } catch (searchError) {
      setError((searchError as Error).message);
    } finally {
      setNexusSearching(false);
    }
  }

  async function refreshNexusInstalled(checkUpdates: boolean): Promise<void> {
    if (!nexusConfigured) {
      return;
    }

    setNexusWorking(true);
    setError("");

    try {
      const installed = await request<NexusInstalledMod[]>(
        checkUpdates ? "nexus.checkUpdates" : "nexus.installed",
        checkUpdates ? undefined : { checkUpdates: false },
      );
      setNexusInstalled(installed);
      if (checkUpdates) {
        setStatus("Nexus updates checked.");
      }
    } catch (refreshError) {
      setError((refreshError as Error).message);
    } finally {
      setNexusWorking(false);
    }
  }

  async function connectNexusWithKey(apiKey: string): Promise<void> {
    setNexusWorking(true);
    setError("");

    try {
      const result = await request<{
        configured: boolean;
        gameDomain: string;
        premium: boolean;
        userName: string;
        serverState: ServerState;
        installed: NexusInstalledMod[];
      }>("nexus.connect", {
        apiKey,
        gameDomain: nexusGameDomain.trim() || "hytale",
      });

      setServerState(result.serverState);
      setNexusInstalled(result.installed);
      setNexusGameDomain(result.gameDomain);
      setNexusManualApiKey("");
      setStatus(
        `Nexus connected as ${result.userName}${result.premium ? " (Premium)" : ""}.`,
      );

      const search = await request<NexusSearchResult>("nexus.search", {
        query: "",
        sort: "popularity",
        page: 1,
        pageSize: NEXUS_PAGE_SIZE,
      });
      setNexusResults(search.mods);
      setNexusPage(search.page);
      setNexusTotalCount(search.totalCount);
    } catch (connectError) {
      setError((connectError as Error).message);
    } finally {
      setNexusWorking(false);
    }
  }

  async function connectNexusManual(event: FormEvent): Promise<void> {
    event.preventDefault();
    const apiKey = nexusManualApiKey.trim();
    if (!apiKey) {
      setError("Nexus API key is required.");
      return;
    }
    await connectNexusWithKey(apiKey);
  }

  async function startNexusSso(): Promise<void> {
    if (!serverState?.nexusSsoReady) {
      setError(
        "Nexus SSO is not configured on the server. Set HYTALE_NEXUS_APP_ID.",
      );
      return;
    }

    cleanupNexusSsoSession();
    setNexusConnectingSso(true);
    setError("");

    try {
      const challenge = await request<{
        id: string;
        appId: string;
        url: string;
        wsUrl: string;
      }>("nexus.sso.start");
      const ws = new WebSocket(challenge.wsUrl);
      const session = {
        socket: ws,
        pingTimer: null as number | null,
        closed: false,
      };
      nexusSsoRef.current = session;

      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({ id: challenge.id, appid: challenge.appId }));
        session.pingTimer = window.setInterval(() => {
          try {
            ws.send("ping");
          } catch {
            // ignore
          }
        }, 25_000);

        const opened = window.open(
          challenge.url,
          "_blank",
          "noopener,noreferrer",
        );
        if (!opened) {
          setStatus(`Open Nexus SSO URL manually: ${challenge.url}`);
        } else {
          setStatus("Nexus SSO opened in a new tab. Authorize to continue.");
        }
      });

      ws.addEventListener("message", (event) => {
        const raw = typeof event.data === "string" ? event.data.trim() : "";
        if (!raw) {
          return;
        }

        let parsed: unknown = null;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = null;
        }

        if (parsed && typeof parsed === "object") {
          const errorLike = parsed as { error?: unknown; message?: unknown };
          const message =
            typeof errorLike.error === "string"
              ? errorLike.error
              : typeof errorLike.message === "string"
                ? errorLike.message
                : "";
          if (message) {
            setError(`Nexus SSO failed: ${message}`);
            cleanupNexusSsoSession();
            setNexusConnectingSso(false);
            return;
          }
        }

        if (raw.startsWith("{") || raw.startsWith("[")) {
          return;
        }

        void connectNexusWithKey(raw).finally(() => {
          cleanupNexusSsoSession();
          setNexusConnectingSso(false);
        });
      });

      ws.addEventListener("error", () => {
        setError("Nexus SSO websocket connection failed.");
        cleanupNexusSsoSession();
        setNexusConnectingSso(false);
      });

      ws.addEventListener("close", () => {
        cleanupNexusSsoSession();
        setNexusConnectingSso(false);
      });
    } catch (ssoError) {
      setError((ssoError as Error).message);
      cleanupNexusSsoSession();
      setNexusConnectingSso(false);
    }
  }

  async function installNexusMod(modId: number): Promise<void> {
    if (!nexusConfigured) {
      return;
    }

    setNexusWorking(true);
    setError("");

    try {
      const result = await request<{
        installedMod: NexusInstalledMod | null;
        mods: ModEntry[];
        installed: NexusInstalledMod[];
        alreadyInstalled: boolean;
      }>("nexus.install", { modId }, LONG_OPERATION_TIMEOUT_MS);
      setMods(result.mods);
      setNexusInstalled(result.installed);
      setStatus(
        result.alreadyInstalled
          ? "Nexus mod is already installed."
          : "Nexus mod installed.",
      );
    } catch (installError) {
      setError((installError as Error).message);
    } finally {
      setNexusWorking(false);
    }
  }

  async function updateNexusMod(modId: number): Promise<void> {
    if (!nexusConfigured) {
      return;
    }

    setNexusWorking(true);
    setError("");

    try {
      const result = await request<{
        updated: boolean;
        installedMod: NexusInstalledMod | null;
        installed: NexusInstalledMod[];
        mods: ModEntry[];
      }>("nexus.update", { modId }, LONG_OPERATION_TIMEOUT_MS);
      setMods(result.mods);
      setNexusInstalled(result.installed);
      setStatus(
        result.updated
          ? "Nexus mod updated."
          : "Nexus mod is already up to date.",
      );
    } catch (updateError) {
      setError((updateError as Error).message);
    } finally {
      setNexusWorking(false);
    }
  }

  async function updateAllNexusMods(): Promise<void> {
    if (!nexusConfigured) {
      return;
    }

    setNexusWorking(true);
    setError("");

    try {
      const result = await request<{
        updated: number;
        skipped: number;
        installed: NexusInstalledMod[];
        mods: ModEntry[];
      }>("nexus.updateAll", undefined, LONG_OPERATION_TIMEOUT_MS);
      setMods(result.mods);
      setNexusInstalled(result.installed);
      setStatus(
        `Nexus update complete. Updated: ${result.updated}, skipped: ${result.skipped}.`,
      );
    } catch (updateError) {
      setError((updateError as Error).message);
    } finally {
      setNexusWorking(false);
    }
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

      cleanupNexusSsoSession();
      socket.disconnect();
      setUser(null);
      setServerState(null);
      setTerminalLines([]);
      setMods([]);
      setCurseForgeInstalled([]);
      setCurseForgeResults([]);
      setCurseForgeTotalCount(0);
      setCurseForgePage(1);
      setNexusInstalled([]);
      setNexusResults([]);
      setNexusTotalCount(0);
      setNexusPage(1);
      setNexusConnectingSso(false);
      setBackups([]);
      setLogs([]);
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
        const session = await request<{ uploadId: string }>(
          "mod.upload.start",
          {
            filename: file.name,
            size: file.size,
          },
        );

        const chunkSize = 128 * 1024;
        for (let offset = 0; offset < file.size; offset += chunkSize) {
          const chunk = file.slice(offset, offset + chunkSize);
          const base64 = toBase64(await chunk.arrayBuffer());
          await request("mod.upload.chunk", {
            uploadId: session.uploadId,
            chunk: base64,
          });
        }

        await request("mod.upload.finish", {
          uploadId: session.uploadId,
        });
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

        <section className="grid gap-4 xl:grid-cols-12">
          <Card className="xl:col-span-3">
            <CardHeader>
              <CardTitle>Install</CardTitle>
              <CardDescription>
                Native downloader is the only install source.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
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
            </CardContent>
          </Card>

          <Card className="xl:col-span-9">
            <CardHeader>
              <CardTitle>Terminal</CardTitle>
              <CardDescription>
                Run commands and follow live output.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
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
              <pre
                ref={terminalRef}
                onScroll={handleTerminalScroll}
                className="h-90 overflow-auto rounded-none border bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-100"
              >
                {terminalLines.join("\n")}
              </pre>
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
              <pre className="h-80 overflow-auto rounded-none border bg-muted/40 p-3 text-xs leading-relaxed">
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
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void refreshMods()}
                disabled={busy}
              >
                Refresh mods
              </Button>
              <ul className="max-h-105 space-y-2 overflow-auto">
                {mods.map((mod) => (
                  <li
                    key={mod.filename}
                    className="flex items-center justify-between gap-3 rounded-none border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{mod.filename}</p>
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
              <CardTitle>CurseForge</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!curseForgeConfigured ? (
                user.role === "owner" ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Connect once and credentials will be encrypted and saved
                      in the app database.
                    </p>
                    <form
                      onSubmit={(event) => void connectCurseForge(event)}
                      className="grid gap-3 md:grid-cols-2"
                    >
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="cf-key">API key</Label>
                        <Input
                          id="cf-key"
                          type="password"
                          value={curseForgeSetupApiKey}
                          onChange={(event) =>
                            setCurseForgeSetupApiKey(event.target.value)
                          }
                          placeholder="CurseForge API key"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="cf-game-id">Game ID</Label>
                        <Input
                          id="cf-game-id"
                          type="number"
                          min={1}
                          step={1}
                          value={curseForgeSetupGameId}
                          onChange={(event) =>
                            setCurseForgeSetupGameId(event.target.value)
                          }
                          placeholder="70216 (Hytale)"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="cf-class-id">Class ID (optional)</Label>
                        <Input
                          id="cf-class-id"
                          type="number"
                          min={0}
                          step={1}
                          value={curseForgeSetupClassId}
                          onChange={(event) =>
                            setCurseForgeSetupClassId(event.target.value)
                          }
                          placeholder="0 = all classes"
                        />
                      </div>
                      <Button
                        type="submit"
                        disabled={curseForgeWorking}
                        className="md:col-span-2"
                      >
                        {curseForgeWorking
                          ? "Connecting..."
                          : "Connect CurseForge"}
                      </Button>
                    </form>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Owner needs to connect CurseForge before browsing and
                    installing mods.
                  </p>
                )
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Connected (
                    {serverState?.curseForgeSource === "env"
                      ? "environment variables"
                      : "dashboard secure storage"}
                    ) | gameId: {serverState?.curseForgeGameId ?? "-"} |
                    classId: {serverState?.curseForgeClassId ?? 0}
                  </p>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void searchCurseForge(1);
                    }}
                    className="grid gap-2 md:grid-cols-[1fr_200px_auto]"
                  >
                    <Input
                      type="text"
                      value={curseForgeQuery}
                      onChange={(event) =>
                        setCurseForgeQuery(event.target.value)
                      }
                      placeholder="Search by mod name or creator"
                    />
                    <Select
                      value={curseForgeSort}
                      onValueChange={(value) => {
                        const nextSort = value as CurseForgeSearchSort;
                        setCurseForgeSort(nextSort);
                        setCurseForgePage(1);
                        void searchCurseForge(1, { sort: nextSort });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Sort" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="popularity">Popularity</SelectItem>
                        <SelectItem value="totalDownloads">
                          Total downloads
                        </SelectItem>
                        <SelectItem value="lastUpdated">
                          Last updated
                        </SelectItem>
                        <SelectItem value="name">Name</SelectItem>
                        <SelectItem value="author">Author</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      type="submit"
                      disabled={curseForgeSearching || curseForgeWorking}
                    >
                      {curseForgeSearching ? "Searching..." : "Search"}
                    </Button>
                  </form>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void refreshCurseForgeInstalled(false)}
                      disabled={curseForgeWorking}
                    >
                      Refresh installed
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void refreshCurseForgeInstalled(true)}
                      disabled={curseForgeWorking}
                    >
                      Check updates
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void updateAllCurseForgeMods()}
                      disabled={
                        curseForgeWorking || curseForgeInstalled.length === 0
                      }
                    >
                      Update all ({curseForgeUpdateCount})
                    </Button>
                  </div>

                  <ul className="max-h-64 space-y-2 overflow-auto">
                    {curseForgeResults.map((mod) => (
                      <li
                        key={mod.id}
                        className="flex items-start justify-between gap-3 rounded-none border p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{mod.name}</p>
                          <p className="text-sm text-muted-foreground">
                            by {mod.authors.join(", ") || "Unknown"} |{" "}
                            {Math.round(mod.downloadCount).toLocaleString()}{" "}
                            downloads
                          </p>
                          {mod.summary && (
                            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                              {mod.summary}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          {mod.websiteUrl && (
                            <Button size="sm" variant="outline" asChild>
                              <a
                                href={mod.websiteUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open
                              </a>
                            </Button>
                          )}
                          <Button
                            size="sm"
                            onClick={() => void installCurseForgeMod(mod.id)}
                            disabled={curseForgeWorking}
                          >
                            Install
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void searchCurseForge(Math.max(1, curseForgePage - 1))
                      }
                      disabled={curseForgeSearching || curseForgePage <= 1}
                    >
                      Prev
                    </Button>
                    <p className="text-sm text-muted-foreground">
                      Page {curseForgePage} /{" "}
                      {Math.max(
                        1,
                        Math.ceil(curseForgeTotalCount / CURSEFORGE_PAGE_SIZE),
                      )}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void searchCurseForge(curseForgePage + 1)}
                      disabled={curseForgeSearching || !curseForgeHasNextPage}
                    >
                      Next
                    </Button>
                  </div>

                  <Separator />
                  <h3 className="text-sm font-semibold">
                    Installed from CurseForge
                  </h3>
                  <ul className="max-h-52 space-y-2 overflow-auto">
                    {curseForgeInstalled.length === 0 && (
                      <li className="rounded-none border p-3 text-sm text-muted-foreground">
                        No CurseForge mods installed yet.
                      </li>
                    )}
                    {curseForgeInstalled.map((mod) => (
                      <li
                        key={mod.modId}
                        className="flex items-center justify-between gap-3 rounded-none border p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{mod.modName}</p>
                          <p className="truncate text-sm text-muted-foreground">
                            {mod.localFilename}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {mod.updateAvailable
                              ? `Update available: ${mod.latestFileName ?? mod.latestFileId ?? "new file"}`
                              : "Up to date"}
                            {mod.localFileMissing
                              ? " | local file missing"
                              : ""}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void updateCurseForgeMod(mod.modId)}
                          disabled={curseForgeWorking || !mod.updateAvailable}
                        >
                          Update
                        </Button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="xl:col-span-6">
            <CardHeader>
              <CardTitle>Nexus Mods</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!nexusConfigured ? (
                user.role === "owner" ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Connect via Nexus SSO (recommended) or by API key.
                      Credentials are encrypted and stored in the dashboard.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        onClick={() => void startNexusSso()}
                        disabled={
                          nexusConnectingSso ||
                          nexusWorking ||
                          !serverState?.nexusSsoReady
                        }
                      >
                        {nexusConnectingSso
                          ? "Waiting for SSO..."
                          : "Connect with Nexus SSO"}
                      </Button>
                      {!serverState?.nexusSsoReady && (
                        <p className="text-sm text-muted-foreground">
                          Set HYTALE_NEXUS_APP_ID to enable SSO.
                        </p>
                      )}
                    </div>

                    <form
                      onSubmit={(event) => void connectNexusManual(event)}
                      className="grid gap-3 md:grid-cols-2"
                    >
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="nexus-key">API key</Label>
                        <Input
                          id="nexus-key"
                          type="password"
                          value={nexusManualApiKey}
                          onChange={(event) =>
                            setNexusManualApiKey(event.target.value)
                          }
                          placeholder="Nexus API key"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="nexus-domain">Game domain</Label>
                        <Input
                          id="nexus-domain"
                          type="text"
                          value={nexusGameDomain}
                          onChange={(event) =>
                            setNexusGameDomain(event.target.value)
                          }
                          placeholder="hytale"
                        />
                      </div>
                      <Button
                        type="submit"
                        disabled={nexusWorking}
                        className="self-end"
                      >
                        {nexusWorking ? "Connecting..." : "Connect by API key"}
                      </Button>
                    </form>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Owner needs to connect Nexus before browsing and installing
                    mods.
                  </p>
                )
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Connected (
                    {serverState?.nexusSource === "env"
                      ? "environment variables"
                      : "dashboard secure storage"}
                    ) | game domain: {serverState?.nexusGameDomain ?? "hytale"}
                  </p>

                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void searchNexusMods(1);
                    }}
                    className="grid gap-2 md:grid-cols-[1fr_200px_auto]"
                  >
                    <Input
                      type="text"
                      value={nexusQuery}
                      onChange={(event) => setNexusQuery(event.target.value)}
                      placeholder="Search by mod name or creator"
                    />
                    <Select
                      value={nexusSort}
                      onValueChange={(value) => {
                        const nextSort = value as NexusSearchSort;
                        setNexusSort(nextSort);
                        setNexusPage(1);
                        void searchNexusMods(1, { sort: nextSort });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Sort" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="popularity">Popularity</SelectItem>
                        <SelectItem value="downloads">Downloads</SelectItem>
                        <SelectItem value="lastUpdated">
                          Last updated
                        </SelectItem>
                        <SelectItem value="name">Name</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      type="submit"
                      disabled={nexusSearching || nexusWorking}
                    >
                      {nexusSearching ? "Searching..." : "Search"}
                    </Button>
                  </form>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void refreshNexusInstalled(false)}
                      disabled={nexusWorking}
                    >
                      Refresh installed
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void refreshNexusInstalled(true)}
                      disabled={nexusWorking}
                    >
                      Check updates
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void updateAllNexusMods()}
                      disabled={nexusWorking || nexusInstalled.length === 0}
                    >
                      Update all ({nexusUpdateCount})
                    </Button>
                  </div>

                  <ul className="max-h-64 space-y-2 overflow-auto">
                    {nexusResults.map((mod) => (
                      <li
                        key={mod.modId}
                        className="flex items-start justify-between gap-3 rounded-none border p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{mod.name}</p>
                          <p className="text-sm text-muted-foreground">
                            by {mod.author || "Unknown"} |{" "}
                            {Math.round(mod.downloads).toLocaleString()}{" "}
                            downloads
                          </p>
                          {mod.summary && (
                            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                              {mod.summary}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Button size="sm" variant="outline" asChild>
                            <a
                              href={`https://www.nexusmods.com/${serverState?.nexusGameDomain ?? "hytale"}/mods/${mod.modId}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open
                            </a>
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => void installNexusMod(mod.modId)}
                            disabled={nexusWorking}
                          >
                            Install
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void searchNexusMods(Math.max(1, nexusPage - 1))
                      }
                      disabled={nexusSearching || nexusPage <= 1}
                    >
                      Prev
                    </Button>
                    <p className="text-sm text-muted-foreground">
                      Page {nexusPage} /{" "}
                      {Math.max(
                        1,
                        Math.ceil(nexusTotalCount / NEXUS_PAGE_SIZE),
                      )}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void searchNexusMods(nexusPage + 1)}
                      disabled={nexusSearching || !nexusHasNextPage}
                    >
                      Next
                    </Button>
                  </div>

                  <Separator />
                  <h3 className="text-sm font-semibold">
                    Installed from Nexus
                  </h3>
                  <ul className="max-h-52 space-y-2 overflow-auto">
                    {nexusInstalled.length === 0 && (
                      <li className="rounded-none border p-3 text-sm text-muted-foreground">
                        No Nexus mods installed yet.
                      </li>
                    )}
                    {nexusInstalled.map((mod) => (
                      <li
                        key={mod.modId}
                        className="flex items-center justify-between gap-3 rounded-none border p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{mod.modName}</p>
                          <p className="truncate text-sm text-muted-foreground">
                            {mod.localFilename}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {mod.updateAvailable
                              ? `Update available: ${mod.latestFileName ?? mod.latestFileId ?? "new file"}`
                              : "Up to date"}
                            {mod.localFileMissing
                              ? " | local file missing"
                              : ""}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" asChild>
                            <a
                              href={mod.pageUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open
                            </a>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void updateNexusMod(mod.modId)}
                            disabled={nexusWorking || !mod.updateAvailable}
                          >
                            Update
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
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
                  placeholder="Before major mod update"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => void createBackup()}
                  disabled={busy}
                >
                  Create backup
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
                      <p className="font-medium">{backup.id}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(backup.createdAt)} | items:{" "}
                        {backup.itemCount}
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
