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

describe("Alt STB contract", () => {
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
