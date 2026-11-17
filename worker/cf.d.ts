// Ambient declarations for the Cloudflare Workers runtime APIs this Worker uses (the platform
// bundles worker/index.ts; these types only serve `tsc -p worker`).

declare module 'cloudflare:workers' {
  export abstract class DurableObject<E = unknown> {
    protected ctx: DurableObjectState;
    protected env: E;
    constructor(ctx: DurableObjectState, env: E);
    fetch?(request: Request): Response | Promise<Response>;
    alarm?(): void | Promise<void>;
    webSocketMessage?(ws: CfWebSocket, message: string | ArrayBuffer): void | Promise<void>;
    webSocketClose?(ws: CfWebSocket, code: number, reason: string, wasClean: boolean): void | Promise<void>;
    webSocketError?(ws: CfWebSocket, error: unknown): void | Promise<void>;
  }
}

interface CfWebSocket {
  readonly readyState: number;
  send(message: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  accept(): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  put<T>(key: string, value: T): Promise<void>;
  put<T>(entries: Record<string, T>): Promise<void>;
  delete(key: string | string[]): Promise<boolean | number>;
  deleteAll(): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(time: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

interface DurableObjectState {
  readonly storage: DurableObjectStorage;
  acceptWebSocket(ws: CfWebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): CfWebSocket[];
  setWebSocketAutoResponse(pair: WebSocketRequestResponsePair): void;
  getWebSocketAutoResponseTimestamp(ws: CfWebSocket): Date | null;
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
}

interface DurableObjectId {
  toString(): string;
}

interface DurableObjectStub {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId, options?: { locationHint?: string }): DurableObjectStub;
}

/** Where Cloudflare received the request (a subset). */
interface IncomingRequestCfProperties {
  continent?: string;
  country?: string;
  colo?: string;
}

interface Request {
  readonly cf?: IncomingRequestCfProperties;
}

declare class WebSocketPair {
  0: CfWebSocket;
  1: CfWebSocket;
}

declare class WebSocketRequestResponsePair {
  constructor(request: string, response: string);
}

interface ResponseInit {
  webSocket?: CfWebSocket | null;
}

interface Response {
  readonly webSocket?: CfWebSocket | null;
}
