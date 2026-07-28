import { createHandler } from "../../shared-api/src/index";

interface Env {
  STB_APP_ID: string;
  STB_APP_KEY: string;
  ALLOWED_ORIGINS?: string;
}

const logger = {
  debug(message: string, fields?: Record<string, unknown>) { console.debug(message, fields); },
  info(message: string, fields?: Record<string, unknown>) { console.info(message, fields); },
  warn(message: string, fields?: Record<string, unknown>) { console.warn(message, fields); },
  error(message: string, fields?: Record<string, unknown>) { console.error(message, fields); }
};

let currentKey = "";
let currentHandler: ((request: Request) => Promise<Response>) | undefined;

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const identity = `${env.STB_APP_ID}\u0000${env.STB_APP_KEY}\u0000${env.ALLOWED_ORIGINS ?? ""}`;
    if (!currentHandler || currentKey !== identity) {
      currentKey = identity;
      currentHandler = createHandler(
        {
          STB_APP_ID: env.STB_APP_ID,
          STB_APP_KEY: env.STB_APP_KEY,
          ALLOWED_ORIGINS: (env.ALLOWED_ORIGINS ?? "https://fabian20ro.github.io")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          UPSTREAM_TIMEOUT_MS: 10_000
        },
        { logger, clock: { now: () => Date.now() } }
      );
    }
    return currentHandler(request);
  }
} satisfies ExportedHandler<Env>;
