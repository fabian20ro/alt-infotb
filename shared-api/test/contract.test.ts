import { describe, expect, it, vi } from "vitest";
import { createHandler } from "../src/index.js";

const config = {
  STB_APP_ID: "test-app",
  STB_APP_KEY: "test-key",
  ALLOWED_ORIGINS: ["https://fabian20ro.github.io"],
  UPSTREAM_TIMEOUT_MS: 1000
};
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function handler(responses: Response[]) {
  const fetch = vi.fn(async () => {
    const response = responses.shift();
    if (!response) throw new Error("unexpected request");
    return response;
  });
  return {
    fetch,
    handle: createHandler(config, { logger, clock: { now: () => 1_000 }, transport: { fetch } })
  };
}

describe("Alt InfoTB contract", () => {
  it("rejects non-exact routes and origins", async () => {
    const { handle } = handler([]);
    expect((await handle(new Request("https://host/lines/stop/escape", { headers: { Origin: "https://fabian20ro.github.io" } }))).status).toBe(404);
    expect((await handle(new Request("https://host/lines/stop", { headers: { Origin: "https://evil.example" } }))).status).toBe(403);
  });

  it("passes protobuf bytes through unchanged", async () => {
    const bytes = new Uint8Array([10, 3, 83, 84, 66]);
    const { handle } = handler([
      Response.json({ data: { userInfo: "token" } }),
      new Response(bytes, { headers: { "Content-Type": "application/x-protobuf" } })
    ]);
    const response = await handle(new Request("https://host/lines/stop?stop_id=3570", { headers: { Origin: "https://fabian20ro.github.io" } }));
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("content-type")).toBe("application/x-protobuf");
  });

  it("coalesces concurrent authentication and refreshes once on 412", async () => {
    const auth = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: { userInfo: "old" } }))
      .mockResolvedValueOnce(Response.json({ data: { userInfo: "new" } }));
    let upstreamCalls = 0;
    const fetch = vi.fn(async (request: Request) => {
      if (request.url.endsWith("/proxy/user/auth")) return auth();
      upstreamCalls += 1;
      if (upstreamCalls === 1) return new Response(null, { status: 412 });
      return new Response(new Uint8Array([1]));
    });
    const handle = createHandler(config, { logger, clock: { now: () => 1_000 }, transport: { fetch } });
    const response = await handle(new Request("https://host/lines/stop", { headers: { Origin: "https://fabian20ro.github.io" } }));
    expect(response.status).toBe(200);
    expect(auth).toHaveBeenCalledTimes(2);
    expect(upstreamCalls).toBe(2);
  });
});

const origin = { Origin: "https://fabian20ro.github.io" };
const request = (target: string) => new Request(`https://host${target}`, { headers: origin });

describe("topology route and query allowlist", () => {
  it.each([
    "/lines", "/lines?lang=ro", "/lines?lang=en", "/lines/199",
    "/lines/199?lang=ro", "/lines/199/direction/0?lang=en", "/lines/199/direction/1",
    "/lines/stop?stop_id=6084&selected_line_id=199&direction=0",
    "/lines/stop?stop_id=6084&direction=1&lang=ro"
  ])("forwards the exact validated target: %s", async (target) => {
    const fetch = vi.fn(async (upstream: Request) => {
      if (upstream.url.endsWith("/proxy/user/auth")) {
        expect(upstream.headers.get("App-key")).toBe("test-key");
        return Response.json({ data: { userInfo: "token" } });
      }
      expect(upstream.url).toBe(`https://info.stb.ro/api/web/v2-6${target}`);
      expect(upstream.method).toBe("GET");
      expect(upstream.headers.get("User-Info")).toBe("token");
      expect(upstream.headers.get("App-key")).toBeNull();
      return new Response(new Uint8Array([10, 0]), { headers: { "Content-Type": "application/x-protobuf" } });
    });
    const handle = createHandler(config, { logger, clock: { now: () => 1_000 }, transport: { fetch } });
    expect((await handle(request(target))).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    "/lines/", "/lines/0", "/lines/-1", "/lines/01", "/lines/1.5", "/lines/1e2",
    "/lines/9007199254740992", "/lines/199/", "/lines/199/direction/2",
    "/lines/199/direction/-1", "/lines/199/direction/01", "/lines/199/direction/0/escape",
    "/lines/199/other", "/lines/stops/6084", "/proxy/user/auth", "/lines/%31"
  ])("rejects unknown paths without upstream/auth traffic: %s", async (target) => {
    const { handle, fetch } = handler([]);
    expect((await handle(request(target))).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "/lines?lang=fr", "/lines?lang=", "/lines?lang=ro&lang=en", "/lines?lang=ro&lang=ro",
    "/lines?stop_id=6084", "/lines?url=https://evil.example", "/lines/199?direction=0",
    "/lines/199/direction/0?selected_line_id=199", "/lines?lang=ro&%6cang=en",
    "/lines/stop?stop_id=0", "/lines/stop?stop_id=-1", "/lines/stop?stop_id=01",
    "/lines/stop?stop_id=1.5", "/lines/stop?stop_id=1e2", "/lines/stop?stop_id=9007199254740992",
    "/lines/stop?stop_id=1&stop_id=2", "/lines/stop?stop_id=6084&unknown=1",
    "/lines/stop?selected_line_id=", "/lines/stop?selected_line_id=0",
    "/lines/stop?direction=2", "/lines/stop?direction=0&direction=1"
  ])("rejects malformed or unexpected query values: %s", async (target) => {
    const { handle, fetch } = handler([]);
    expect((await handle(request(target))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps methods and origins restricted for topology", async () => {
    const { handle, fetch } = handler([]);
    expect((await handle(new Request("https://host/lines", { method: "POST", headers: origin }))).status).toBe(405);
    expect((await handle(new Request("https://host/lines"))).status).toBe(403);
    expect((await handle(new Request("https://host/lines", { headers: { Origin: "https://evil.example" } }))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("authentication concurrency", () => {
  it("coalesces simultaneous cold requests", async () => {
    const firstAuth = deferred<Response>();
    const fetch = vi.fn(async (upstream: Request) => upstream.url.endsWith("/proxy/user/auth")
      ? firstAuth.promise : new Response("ok"));
    const handle = createHandler(config, { logger, clock: { now: () => 1_000 }, transport: { fetch } });
    const pending = [handle(request("/lines")), handle(request("/lines/199"))];
    expect(fetch).toHaveBeenCalledTimes(1);
    firstAuth.resolve(Response.json({ data: { userInfo: "old" } }));
    expect((await Promise.all(pending)).map((response) => response.status)).toEqual([200, 200]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("shares a refresh for concurrent 412s and reuses it for a late 412", async () => {
    const refresh = deferred<Response>();
    const late = deferred<Response>();
    const refreshing = deferred<void>();
    let authCalls = 0;
    const tokens: string[] = [];
    const fetch = vi.fn(async (upstream: Request) => {
      if (upstream.url.endsWith("/proxy/user/auth")) {
        authCalls += 1;
        if (authCalls === 1) return Response.json({ data: { userInfo: "old" } });
        refreshing.resolve();
        return refresh.promise;
      }
      const userToken = upstream.headers.get("User-Info")!;
      tokens.push(userToken);
      if (userToken === "old") {
        if (upstream.url.endsWith("/lines/200")) return late.promise;
        return new Response(null, { status: 412 });
      }
      return new Response("ok");
    });
    const handle = createHandler(config, { logger, clock: { now: () => 1_000 }, transport: { fetch } });
    const first = handle(request("/lines"));
    const second = handle(request("/lines/199"));
    const third = handle(request("/lines/200"));
    await refreshing.promise;
    refresh.resolve(Response.json({ data: { userInfo: "new" } }));
    expect((await Promise.all([first, second])).map((response) => response.status)).toEqual([200, 200]);
    late.resolve(new Response(null, { status: 412 }));
    expect((await third).status).toBe(200);
    expect(authCalls).toBe(2);
    expect(tokens.filter((value) => value === "old")).toHaveLength(3);
    expect(tokens.filter((value) => value === "new")).toHaveLength(3);
  });

  it("does not retry an endlessly rejected token more than once", async () => {
    const { handle, fetch } = handler([
      Response.json({ data: { userInfo: "old" } }), new Response(null, { status: 412 }),
      Response.json({ data: { userInfo: "new" } }), new Response(null, { status: 412 })
    ]);
    expect((await handle(request("/lines"))).status).toBe(412);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("recovers after failed authentication without caching the failure", async () => {
    const { handle } = handler([
      Response.json({ data: { userInfo: "" } }),
      Response.json({ data: { userInfo: "valid" } }), new Response("ok")
    ]);
    const failed = await handle(request("/lines"));
    expect(failed.status).toBe(502);
    expect(failed.headers.get("X-Proxy-Error")).toBe("auth-response");
    expect((await handle(request("/lines"))).status).toBe(200);
  });
});

describe("caller cancellation", () => {
  it("aborts the upstream transport without retrying or refreshing auth", async () => {
    const started = deferred<void>();
    const controller = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    const fetch = vi.fn(async (upstream: Request) => {
      if (upstream.url.endsWith("/proxy/user/auth")) return Response.json({ data: { userInfo: "token" } });
      upstreamSignal = upstream.signal;
      started.resolve();
      return new Promise<Response>((_resolve, reject) => {
        upstream.signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
      });
    });
    const handle = createHandler(config, { logger, clock: { now: () => 1_000 }, transport: { fetch } });
    const pending = handle(new Request("https://host/lines", { headers: origin, signal: controller.signal }));
    await started.promise;
    controller.abort();
    expect((await pending).status).toBe(502);
    expect(upstreamSignal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("preserves another caller's shared authentication when one caller aborts", async () => {
    const authentication = deferred<Response>();
    const controller = new AbortController();
    const fetch = vi.fn(async (upstream: Request) => upstream.url.endsWith("/proxy/user/auth")
      ? authentication.promise : new Response("ok"));
    const handle = createHandler(config, { logger, clock: { now: () => 1_000 }, transport: { fetch } });
    const cancelled = handle(new Request("https://host/lines/199", { headers: origin, signal: controller.signal }));
    const active = handle(request("/lines"));
    controller.abort();
    authentication.resolve(Response.json({ data: { userInfo: "token" } }));
    expect((await cancelled).status).toBe(502);
    expect((await active).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([upstream]) => new URL(upstream.url).pathname)).toEqual([
      "/api/web/v2-6/proxy/user/auth", "/api/web/v2-6/lines"
    ]);
  });

  it("continues forwarding caller cancellation after response headers arrive", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async (upstream: Request) => {
      if (upstream.url.endsWith("/proxy/user/auth")) return Response.json({ data: { userInfo: "token" } });
      return new Response(new ReadableStream({ start(stream) {
        upstream.signal.addEventListener("abort", () => stream.error(new DOMException("Cancelled", "AbortError")), { once: true });
      } }));
    });
    const handle = createHandler(config, { logger, clock: { now: () => 1_000 }, transport: { fetch } });
    const response = await handle(new Request("https://host/lines", { headers: origin, signal: controller.signal }));
    const reading = response.arrayBuffer();
    controller.abort();
    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("authentication deadline", () => {
  it("times out a stalled auth body for all waiters and allows later recovery", async () => {
    vi.useFakeTimers();
    try {
      const { handle, fetch } = handler([
        new Response(new ReadableStream({ start() {} })),
        Response.json({ data: { userInfo: "recovered" } }), new Response("ok")
      ]);
      const pending = Promise.all([handle(request("/lines")), handle(request("/lines/199"))]);
      await vi.advanceTimersByTimeAsync(1000);
      const responses = await pending;
      expect(responses.map(response => response.status)).toEqual([502, 502]);
      expect(responses.map(response => response.headers.get("X-Proxy-Error"))).toEqual(["auth-fetch", "auth-fetch"]);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect((await handle(request("/lines"))).status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
