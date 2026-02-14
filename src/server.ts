import dashboardPage from "./client/index.html";
import type { ServerWebSocket } from "bun";
import { clearSessionCookie, getSessionUserFromRequest, login, logoutFromRequest, registerFromInvite, setupOwner } from "./auth";
import { config, ensureDirectories } from "./config";
import { hasAnyUsers, PublicUser } from "./db";
import { HytaleManager } from "./hytale-manager";
import { createInviteAndDispatch, getInviteSummaries, removeInvite } from "./invites";
import { AppError, jsonResponse, parseJson } from "./utils";

ensureDirectories();

type SocketData = {
  user: PublicUser;
};

type CommandRequest = {
  id?: string;
  action: string;
  payload?: Record<string, unknown>;
};

const sockets = new Set<ServerWebSocket<SocketData>>();

const manager = new HytaleManager((event, payload) => {
  const packet = JSON.stringify({
    type: "event",
    event,
    payload,
  });

  for (const socket of sockets) {
    socket.send(packet);
  }
});

function commandError(message: string, status = 400): never {
  throw new AppError(status, message);
}

function assertOwner(user: PublicUser): void {
  if (user.role !== "owner") {
    throw new AppError(403, "Owner permissions are required for this action.");
  }
}

function sendAck(
  socket: ServerWebSocket<SocketData>,
  id: string,
  ok: boolean,
  payload: Record<string, unknown>,
): void {
  socket.send(
    JSON.stringify({
      type: "ack",
      id,
      ok,
      ...payload,
    }),
  );
}

async function sendBootstrap(socket: ServerWebSocket<SocketData>): Promise<void> {
  const [serverState, mods, backups, logs, curseForgeInstalled, nexusInstalled] = await Promise.all([
    manager.snapshot(),
    manager.listMods(),
    manager.listBackups(),
    manager.listLogFiles(),
    manager.listCurseForgeInstalledMods(false),
    manager.listNexusInstalledMods(false),
  ]);

  socket.send(
    JSON.stringify({
      type: "event",
      event: "bootstrap",
      payload: {
        user: socket.data.user,
        serverState,
        mods,
        curseForgeInstalled,
        nexusInstalled,
        backups,
        logs,
        invites: socket.data.user.role === "owner" ? getInviteSummaries() : [],
      },
    }),
  );
}

async function dispatchCommand(socket: ServerWebSocket<SocketData>, command: CommandRequest): Promise<void> {
  const requestId = command.id ?? crypto.randomUUID();

  try {
    if (!command.action) {
      commandError("Command action is required.");
    }

    switch (command.action) {
      case "server.status": {
        const snapshot = await manager.snapshot();
        sendAck(socket, requestId, true, { data: snapshot });
        return;
      }

      case "server.install": {
        const result = await manager.install();
        sendAck(socket, requestId, true, { data: result });
        return;
      }

      case "java.install": {
        const result = await manager.installManagedJavaRuntime();
        sendAck(socket, requestId, true, { data: result });
        return;
      }

      case "server.start": {
        await manager.start();
        sendAck(socket, requestId, true, { data: { ok: true } });
        return;
      }

      case "server.stop": {
        const force = (command.payload?.force as boolean | undefined) ?? false;
        await manager.stop(force);
        sendAck(socket, requestId, true, { data: { ok: true } });
        return;
      }

      case "server.restart": {
        await manager.restart();
        sendAck(socket, requestId, true, { data: { ok: true } });
        return;
      }

      case "server.command": {
        const value = (command.payload?.value as string | undefined) ?? "";
        manager.sendCommand(value);
        sendAck(socket, requestId, true, { data: { ok: true } });
        return;
      }

      case "mods.list": {
        sendAck(socket, requestId, true, { data: await manager.listMods() });
        return;
      }

      case "mod.disable": {
        const filename = command.payload?.filename as string | undefined;
        if (!filename) {
          commandError("filename is required.");
        }
        await manager.disableMod(filename);
        sendAck(socket, requestId, true, { data: await manager.listMods() });
        return;
      }

      case "mod.enable": {
        const filename = command.payload?.filename as string | undefined;
        if (!filename) {
          commandError("filename is required.");
        }
        await manager.enableMod(filename);
        sendAck(socket, requestId, true, { data: await manager.listMods() });
        return;
      }

      case "mod.delete": {
        const filename = command.payload?.filename as string | undefined;
        if (!filename) {
          commandError("filename is required.");
        }
        await manager.deleteMod(filename);
        sendAck(socket, requestId, true, { data: await manager.listMods() });
        return;
      }

      case "mod.upload.start": {
        const filename = command.payload?.filename as string | undefined;
        const size = Number(command.payload?.size ?? 0);
        if (!filename || !size) {
          commandError("filename and size are required.");
        }
        const session = await manager.startModUpload(filename, size);
        sendAck(socket, requestId, true, { data: session });
        return;
      }

      case "mod.upload.chunk": {
        const uploadId = command.payload?.uploadId as string | undefined;
        const chunk = command.payload?.chunk as string | undefined;
        if (!uploadId || !chunk) {
          commandError("uploadId and chunk are required.");
        }
        const progress = await manager.appendModUpload(uploadId, chunk);
        sendAck(socket, requestId, true, { data: progress });
        return;
      }

      case "mod.upload.finish": {
        const uploadId = command.payload?.uploadId as string | undefined;
        if (!uploadId) {
          commandError("uploadId is required.");
        }
        const mod = await manager.finishModUpload(uploadId);
        sendAck(socket, requestId, true, {
          data: {
            mod,
            mods: await manager.listMods(),
          },
        });
        return;
      }

      case "mod.upload.cancel": {
        const uploadId = command.payload?.uploadId as string | undefined;
        if (!uploadId) {
          commandError("uploadId is required.");
        }
        await manager.cancelModUpload(uploadId);
        sendAck(socket, requestId, true, { data: { ok: true } });
        return;
      }

      case "curseforge.search": {
        const query = (command.payload?.query as string | undefined) ?? "";
        const sort = (command.payload?.sort as string | undefined) ?? "popularity";
        const page = Number(command.payload?.page ?? 1);
        const pageSize = Number(command.payload?.pageSize ?? 20);
        const result = await manager.searchCurseForgeMods({
          query,
          sort: sort as "popularity" | "lastUpdated" | "name" | "author" | "totalDownloads",
          page,
          pageSize,
        });
        sendAck(socket, requestId, true, { data: result });
        return;
      }

      case "curseforge.connect": {
        assertOwner(socket.data.user);
        const apiKey = (command.payload?.apiKey as string | undefined) ?? "";
        const gameId = Number(command.payload?.gameId ?? 0);
        const classIdRaw = command.payload?.classId;
        const classId = classIdRaw === undefined || classIdRaw === null || classIdRaw === ""
          ? undefined
          : Number(classIdRaw);

        const result = await manager.connectCurseForge({
          apiKey,
          gameId,
          classId,
        });

        sendAck(socket, requestId, true, {
          data: {
            ...result,
            serverState: await manager.snapshot(),
          },
        });
        return;
      }

      case "curseforge.installed": {
        const checkUpdates = (command.payload?.checkUpdates as boolean | undefined) ?? false;
        sendAck(socket, requestId, true, { data: await manager.listCurseForgeInstalledMods(checkUpdates) });
        return;
      }

      case "curseforge.install": {
        const modId = Number(command.payload?.modId ?? 0);
        if (!modId) {
          commandError("modId is required.");
        }
        sendAck(socket, requestId, true, { data: await manager.installCurseForgeMod(modId) });
        return;
      }

      case "curseforge.checkUpdates": {
        sendAck(socket, requestId, true, { data: await manager.checkCurseForgeUpdates() });
        return;
      }

      case "curseforge.update": {
        const modId = Number(command.payload?.modId ?? 0);
        if (!modId) {
          commandError("modId is required.");
        }
        sendAck(socket, requestId, true, { data: await manager.updateCurseForgeMod(modId) });
        return;
      }

      case "curseforge.updateAll": {
        sendAck(socket, requestId, true, { data: await manager.updateAllCurseForgeMods() });
        return;
      }

      case "nexus.sso.start": {
        assertOwner(socket.data.user);
        sendAck(socket, requestId, true, { data: manager.createNexusSsoChallenge() });
        return;
      }

      case "nexus.connect": {
        assertOwner(socket.data.user);
        const apiKey = (command.payload?.apiKey as string | undefined) ?? "";
        const gameDomain = (command.payload?.gameDomain as string | undefined) ?? undefined;
        const result = await manager.connectNexus({
          apiKey,
          gameDomain,
        });

        sendAck(socket, requestId, true, {
          data: {
            ...result,
            serverState: await manager.snapshot(),
            installed: await manager.listNexusInstalledMods(false),
          },
        });
        return;
      }

      case "nexus.search": {
        const query = (command.payload?.query as string | undefined) ?? "";
        const sort = (command.payload?.sort as string | undefined) ?? "popularity";
        const page = Number(command.payload?.page ?? 1);
        const pageSize = Number(command.payload?.pageSize ?? 20);
        const result = await manager.searchNexusMods({
          query,
          sort: sort as "popularity" | "downloads" | "lastUpdated" | "name",
          page,
          pageSize,
        });
        sendAck(socket, requestId, true, { data: result });
        return;
      }

      case "nexus.installed": {
        const checkUpdates = (command.payload?.checkUpdates as boolean | undefined) ?? false;
        sendAck(socket, requestId, true, { data: await manager.listNexusInstalledMods(checkUpdates) });
        return;
      }

      case "nexus.install": {
        const modId = Number(command.payload?.modId ?? 0);
        if (!modId) {
          commandError("modId is required.");
        }
        sendAck(socket, requestId, true, { data: await manager.installNexusMod(modId) });
        return;
      }

      case "nexus.checkUpdates": {
        sendAck(socket, requestId, true, { data: await manager.checkNexusUpdates() });
        return;
      }

      case "nexus.update": {
        const modId = Number(command.payload?.modId ?? 0);
        if (!modId) {
          commandError("modId is required.");
        }
        sendAck(socket, requestId, true, { data: await manager.updateNexusMod(modId) });
        return;
      }

      case "nexus.updateAll": {
        sendAck(socket, requestId, true, { data: await manager.updateAllNexusMods() });
        return;
      }

      case "logs.list": {
        sendAck(socket, requestId, true, { data: await manager.listLogFiles() });
        return;
      }

      case "logs.read": {
        const name = command.payload?.name as string | undefined;
        const tail = Number(command.payload?.tail ?? 300);
        if (!name) {
          commandError("name is required.");
        }
        sendAck(socket, requestId, true, {
          data: {
            name,
            content: await manager.readLogFile(name, tail),
          },
        });
        return;
      }

      case "backups.list": {
        sendAck(socket, requestId, true, { data: await manager.listBackups() });
        return;
      }

      case "backup.create": {
        const note = (command.payload?.note as string | undefined) ?? "";
        const backup = await manager.createBackup(note);
        sendAck(socket, requestId, true, {
          data: {
            backup,
            backups: await manager.listBackups(),
          },
        });
        return;
      }

      case "backup.delete": {
        const id = command.payload?.id as string | undefined;
        if (!id) {
          commandError("id is required.");
        }
        await manager.deleteBackup(id);
        sendAck(socket, requestId, true, { data: await manager.listBackups() });
        return;
      }

      case "backup.restore": {
        const id = command.payload?.id as string | undefined;
        if (!id) {
          commandError("id is required.");
        }
        await manager.restoreBackup(id);
        sendAck(socket, requestId, true, { data: { ok: true } });
        return;
      }

      case "invite.create": {
        assertOwner(socket.data.user);
        const email = command.payload?.email as string | undefined;
        const role = (command.payload?.role as "owner" | "member" | undefined) ?? "member";

        if (!email) {
          commandError("email is required.");
        }

        const invite = await createInviteAndDispatch(socket.data.user.id, email, role);
        sendAck(socket, requestId, true, {
          data: {
            invite,
            invites: getInviteSummaries(),
          },
        });
        return;
      }

      case "invites.list": {
        assertOwner(socket.data.user);
        sendAck(socket, requestId, true, { data: getInviteSummaries() });
        return;
      }

      case "invite.revoke": {
        assertOwner(socket.data.user);
        const id = Number(command.payload?.id ?? 0);
        if (!id) {
          commandError("id is required.");
        }

        removeInvite(id);
        sendAck(socket, requestId, true, { data: getInviteSummaries() });
        return;
      }

      case "ping": {
        sendAck(socket, requestId, true, { data: { now: new Date().toISOString() } });
        return;
      }

      default: {
        commandError(`Unknown command: ${command.action}`, 404);
      }
    }
  } catch (error) {
    if (error instanceof AppError) {
      sendAck(socket, requestId, false, {
        error: error.message,
        status: error.status,
      });
      return;
    }

    console.error("Command failure", error);
    sendAck(socket, requestId, false, {
      error: "Unexpected command error",
      status: 500,
    });
  }
}

async function handleSetup(request: Request): Promise<Response> {
  type Body = { email?: string; password?: string };
  const body = await parseJson<Body>(request);
  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";

  const session = await setupOwner(email, password);
  manager.startInitializationAfterOwnerSetup();
  return jsonResponse(
    {
      ok: true,
      user: session.user,
      bootstrapRequired: false,
    },
    {
      status: 201,
      headers: {
        "set-cookie": session.cookie,
      },
    },
  );
}

async function handleLogin(request: Request): Promise<Response> {
  type Body = { email?: string; password?: string };
  const body = await parseJson<Body>(request);
  const session = await login(body.email ?? "", body.password ?? "");

  return jsonResponse(
    {
      ok: true,
      user: session.user,
      bootstrapRequired: false,
    },
    {
      headers: {
        "set-cookie": session.cookie,
      },
    },
  );
}

async function handleRegisterFromInvite(request: Request): Promise<Response> {
  type Body = { token?: string; password?: string };
  const body = await parseJson<Body>(request);

  const session = await registerFromInvite(body.token ?? "", body.password ?? "");
  return jsonResponse(
    {
      ok: true,
      user: session.user,
      bootstrapRequired: false,
    },
    {
      status: 201,
      headers: {
        "set-cookie": session.cookie,
      },
    },
  );
}

async function handleLogout(request: Request): Promise<Response> {
  logoutFromRequest(request);
  return jsonResponse(
    {
      ok: true,
    },
    {
      headers: {
        "set-cookie": clearSessionCookie(),
      },
    },
  );
}

async function handleMe(request: Request): Promise<Response> {
  const user = getSessionUserFromRequest(request);
  return jsonResponse(
    {
      ok: !!user,
      user,
      bootstrapRequired: !hasAnyUsers(),
    },
    {
      status: user ? 200 : 401,
    },
  );
}

function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return jsonResponse(
      {
        ok: false,
        error: error.message,
      },
      { status: error.status },
    );
  }

  console.error("Unhandled request error", error);
  return jsonResponse(
    {
      ok: false,
      error: "Internal server error",
    },
    { status: 500 },
  );
}

const server = Bun.serve<SocketData>({
  hostname: config.app.host,
  port: config.app.port,
  development: Bun.env.NODE_ENV !== "production" ? { hmr: true, console: true } : false,
  routes: {
    "/": dashboardPage,

    "/api/auth/bootstrap": {
      GET: () => {
        return jsonResponse({
          ok: true,
          bootstrapRequired: !hasAnyUsers(),
        });
      },
    },

    "/api/auth/setup": {
      POST: async (request: Request) => {
        try {
          return await handleSetup(request);
        } catch (error) {
          return errorResponse(error);
        }
      },
    },

    "/api/auth/login": {
      POST: async (request: Request) => {
        try {
          return await handleLogin(request);
        } catch (error) {
          return errorResponse(error);
        }
      },
    },

    "/api/auth/register-invite": {
      POST: async (request: Request) => {
        try {
          return await handleRegisterFromInvite(request);
        } catch (error) {
          return errorResponse(error);
        }
      },
    },

    "/api/auth/me": {
      GET: async (request: Request) => {
        try {
          return await handleMe(request);
        } catch (error) {
          return errorResponse(error);
        }
      },
    },

    "/api/auth/logout": {
      POST: async (request: Request) => {
        try {
          return await handleLogout(request);
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
  },

  fetch(request, serverInstance) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const user = getSessionUserFromRequest(request);
      if (!user) {
        return jsonResponse(
          {
            ok: false,
            error: "Authentication required",
          },
          { status: 401 },
        );
      }

      const upgraded = serverInstance.upgrade(request, {
        data: {
          user,
        },
      });

      if (upgraded) {
        return new Response(null, { status: 101 });
      }

      return jsonResponse(
        {
          ok: false,
          error: "WebSocket upgrade failed",
        },
        { status: 400 },
      );
    }

    if (url.pathname.startsWith("/api/")) {
      return jsonResponse(
        {
          ok: false,
          error: "Not found",
        },
        { status: 404 },
      );
    }

    return Response.redirect("/", 302);
  },

  websocket: {
    open(socket) {
      sockets.add(socket);
      void sendBootstrap(socket).catch((error) => {
        console.error("Bootstrap failed", error);
      });
    },

    close(socket) {
      sockets.delete(socket);
    },

    message(socket, raw) {
      if (typeof raw !== "string") {
        return;
      }

      let command: CommandRequest;
      try {
        command = JSON.parse(raw) as CommandRequest;
      } catch {
        sendAck(socket, crypto.randomUUID(), false, {
          error: "Invalid command JSON",
          status: 400,
        });
        return;
      }

      void dispatchCommand(socket, command);
    },
  },
});

console.log(`Hytale manager running at ${config.app.publicBaseUrl}`);
