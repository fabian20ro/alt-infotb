export interface ScopedLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface ModuleDependencies {
  logger: ScopedLogger;
  clock: { now(): number };
  transport?: { fetch(request: Request): Promise<Response> };
}

export interface AltStbConfig {
  STB_APP_ID: string;
  STB_APP_KEY: string;
  ALLOWED_ORIGINS: string[];
  UPSTREAM_TIMEOUT_MS?: number;
}

const API_BASE = "https://info.stb.ro/api/web/v2-6";
const AUTH_PATH = "/proxy/user/auth";
const TOKEN_TTL_MS = 50 * 60 * 1000;

class ProxyError extends Error {
  readonly stage: "auth-fetch" | "auth-http" | "auth-response" | "upstream-fetch";
  readonly upstreamStatus?: number;

  constructor(
    stage: "auth-fetch" | "auth-http" | "auth-response" | "upstream-fetch",
    upstreamStatus?: number
  ) {
    super(stage);
    this.stage = stage;
    this.upstreamStatus = upstreamStatus;
  }
}

function requiredString(config: Readonly<Record<string, unknown>>, name: string): string {
  const value = config[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${name}`);
  return value.trim();
}

function parseConfig(config: Readonly<Record<string, unknown>>): AltStbConfig {
  const origins = config.ALLOWED_ORIGINS;
  if (!Array.isArray(origins) || origins.some((value) => typeof value !== "string")) {
    throw new Error("ALLOWED_ORIGINS must be a string array");
  }
  const timeout = config.UPSTREAM_TIMEOUT_MS;
  if (timeout !== undefined && (!Number.isInteger(timeout) || Number(timeout) < 100)) {
    throw new Error("UPSTREAM_TIMEOUT_MS must be an integer >= 100");
  }
  return {
    STB_APP_ID: requiredString(config, "STB_APP_ID"),
    STB_APP_KEY: requiredString(config, "STB_APP_KEY"),
    ALLOWED_ORIGINS: origins as string[],
    UPSTREAM_TIMEOUT_MS: timeout === undefined ? 10_000 : Number(timeout)
  };
}

function appHeaders(appId: string): Headers {
  return new Headers({
    "App-Id": appId,
    "App-Version": "0.0.0",
    "Device-Name": "Chrome",
    Lang: "ro",
    "OS-Type": "Web",
    "OS-Version": "web",
    Source: "ro.radcom.smartcity.web"
  });
}

function isOriginAllowed(origin: string | null, allowed: string[]): boolean {
  if (!origin) return false;
  if (allowed.includes(origin)) return true;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function cors(origin: string | null, allowed: string[]): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none';"
  });
  if (origin && isOriginAllowed(origin, allowed)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function withCors(response: Response, origin: string | null, allowed: string[]): Response {
  const headers = new Headers(response.headers);
  cors(origin, allowed).forEach((value, key) => headers.set(key, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function isPositiveId(value: string): boolean {
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
}

/** The same read-only contract is used by the Worker and the development proxy. */
function validateTarget(url: URL): 400 | 404 | undefined {
  const isStop = url.pathname === "/lines/stop";
  const line = /^\/lines\/([^/]+)(?:\/direction\/([01]))?$/.exec(url.pathname);
  if (!isStop && url.pathname !== "/lines" && (!line || !isPositiveId(line[1]))) return 404;

  const allowed = isStop ? ["stop_id", "selected_line_id", "direction", "lang"] : ["lang"];
  const seen = new Set<string>();
  for (const [key, value] of url.searchParams) {
    if (!allowed.includes(key) || seen.has(key)) return 400;
    seen.add(key);
    if (key === "lang") {
      if (value !== "ro" && value !== "en") return 400;
    } else if (key === "direction") {
      if (value !== "0" && value !== "1") return 400;
    } else if (!isPositiveId(value)) return 400;
  }
  return undefined;
}

export function createHandler(
  rawConfig: Readonly<Record<string, unknown>>,
  dependencies: ModuleDependencies
): (request: Request) => Promise<Response> {
  const config = parseConfig(rawConfig);
  const transport = dependencies.transport ?? { fetch: (request: Request) => fetch(request) };
  let cachedToken: { value: string; fetchedAt: number } | undefined;
  let tokenRequest: Promise<string> | undefined;

  async function send(url: string, headers: Headers, stage: "auth-fetch" | "upstream-fetch", callerSignal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("upstream timeout"), config.UPSTREAM_TIMEOUT_MS);
    const signal = callerSignal ? AbortSignal.any([controller.signal, callerSignal]) : controller.signal;
    try {
      signal.throwIfAborted();
      return await transport.fetch(new Request(url, { headers, signal }));
    } catch {
      throw new ProxyError(stage);
    } finally {
      clearTimeout(timer);
    }
  }

  async function authenticate(): Promise<string> {
    const headers = new Headers({ "App-key": config.STB_APP_KEY, "App-Id": config.STB_APP_ID });
    // Authentication is shared across callers. Its own deadline must cover the
    // JSON body too, otherwise one stalled response holds tokenRequest forever.
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort("authentication timeout");
        reject(new ProxyError("auth-fetch"));
      }, config.UPSTREAM_TIMEOUT_MS);
    });
    try {
      const response = await Promise.race([
        send(`${API_BASE}${AUTH_PATH}`, headers, "auth-fetch", controller.signal), timedOut
      ]);
      if (!response.ok) throw new ProxyError("auth-http", response.status);
      try {
        const body = await Promise.race([response.json(), timedOut]) as { data?: { userInfo?: unknown } };
        if (typeof body.data?.userInfo !== "string" || !body.data.userInfo.trim()) throw new Error("invalid token");
        cachedToken = { value: body.data.userInfo, fetchedAt: dependencies.clock.now() };
        return body.data.userInfo;
      } catch (error) {
        if (error instanceof ProxyError) throw error;
        throw new ProxyError("auth-response");
      }
    } finally {
      clearTimeout(timer!);
    }
  }

  async function token(rejectedToken?: string): Promise<string> {
    // A late 412 for an old request must not invalidate the token another request
    // has already refreshed. Concurrent rejections share one authentication call.
    if (rejectedToken && cachedToken?.value === rejectedToken) cachedToken = undefined;
    if (cachedToken && dependencies.clock.now() - cachedToken.fetchedAt < TOKEN_TTL_MS) {
      return cachedToken.value;
    }
    if (!tokenRequest) {
      tokenRequest = authenticate().finally(() => { tokenRequest = undefined; });
    }
    return tokenRequest;
  }

  async function upstream(pathAndQuery: string, userToken: string, signal: AbortSignal): Promise<Response> {
    const headers = appHeaders(config.STB_APP_ID);
    headers.set("User-Info", userToken);
    return send(`${API_BASE}${pathAndQuery}`, headers, "upstream-fetch", signal);
  }

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin, config.ALLOWED_ORIGINS) });
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: cors(origin, config.ALLOWED_ORIGINS) });
    const invalidTarget = validateTarget(url);
    if (invalidTarget) return new Response(invalidTarget === 404 ? "Not found" : "Invalid query", { status: invalidTarget, headers: cors(origin, config.ALLOWED_ORIGINS) });
    if (!isOriginAllowed(origin, config.ALLOWED_ORIGINS)) return new Response("Origin not allowed", { status: 403, headers: cors(origin, config.ALLOWED_ORIGINS) });

    try {
      request.signal.throwIfAborted();
      const userToken = await token();
      let response = await upstream(`${url.pathname}${url.search}`, userToken, request.signal);
      if (response.status === 412) {
        await response.body?.cancel();
        request.signal.throwIfAborted();
        response = await upstream(`${url.pathname}${url.search}`, await token(userToken), request.signal);
      }
      return withCors(response, origin, config.ALLOWED_ORIGINS);
    } catch (error) {
      const failure = error instanceof ProxyError ? error : new ProxyError("upstream-fetch");
      dependencies.logger.error("STB proxy failure", { stage: failure.stage, upstreamStatus: failure.upstreamStatus });
      const headers = cors(origin, config.ALLOWED_ORIGINS);
      headers.set("Content-Type", "text/plain");
      headers.set("X-Proxy-Error", failure.stage);
      if (failure.upstreamStatus) headers.set("X-Upstream-Status", String(failure.upstreamStatus));
      return new Response("Proxy error: Internal Server Error", { status: 502, headers });
    }
  };
}
