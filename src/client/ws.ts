import { AckMessage, EventMessage } from "./types";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: number;
};

type EventListener = (event: string, payload: unknown) => void;
type ConnectionListener = (connected: boolean) => void;

export class DashboardSocket {
  private ws: WebSocket | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly eventListeners = new Set<EventListener>();
  private readonly connectionListeners = new Set<ConnectionListener>();

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      const current = this.ws;
      await new Promise<void>((resolve, reject) => {
        const onOpen = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error("WebSocket connection failed"));
        };
        const cleanup = () => {
          current.removeEventListener("open", onOpen);
          current.removeEventListener("error", onError);
        };

        current.addEventListener("open", onOpen);
        current.addEventListener("error", onError);
      });
      return;
    }

    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const endpoint = `${protocol}://${location.host}/ws`;
    const ws = new WebSocket(endpoint);

    ws.addEventListener("message", (event) => {
      this.onMessage(event.data);
    });

    ws.addEventListener("close", () => {
      this.ws = null;
      this.notifyConnection(false);
      this.rejectAllPending(new Error("Realtime channel disconnected."));
    });

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        ws.removeEventListener("error", onError);
        this.ws = ws;
        this.notifyConnection(true);
        resolve();
      };

      const onError = () => {
        ws.removeEventListener("open", onOpen);
        reject(new Error("Unable to connect to the realtime channel."));
      };

      ws.addEventListener("open", onOpen);
      ws.addEventListener("error", onError);
    });
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onConnection(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  async request<T = unknown>(action: string, payload?: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
    await this.connect();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Realtime channel is not connected.");
    }

    const id = crypto.randomUUID();
    const response = new Promise<T>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Command timed out: ${action}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
    });

    this.ws.send(
      JSON.stringify({
        id,
        action,
        payload,
      }),
    );

    return await response;
  }

  private onMessage(raw: unknown): void {
    if (typeof raw !== "string") {
      return;
    }

    let packet: AckMessage | EventMessage;
    try {
      packet = JSON.parse(raw) as AckMessage | EventMessage;
    } catch {
      return;
    }

    if (packet.type === "ack") {
      const pending = this.pending.get(packet.id);
      if (!pending) {
        return;
      }

      window.clearTimeout(pending.timeout);
      this.pending.delete(packet.id);

      if (packet.ok) {
        pending.resolve(packet.data);
      } else {
        pending.reject(new Error(packet.error ?? "Request failed"));
      }
      return;
    }

    if (packet.type === "event") {
      for (const listener of this.eventListeners) {
        listener(packet.event, packet.payload);
      }
    }
  }

  private notifyConnection(connected: boolean): void {
    for (const listener of this.connectionListeners) {
      listener(connected);
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [key, value] of this.pending.entries()) {
      window.clearTimeout(value.timeout);
      value.reject(error);
      this.pending.delete(key);
    }
  }
}
