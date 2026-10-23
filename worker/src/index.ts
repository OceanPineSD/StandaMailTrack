import { handleApi } from "./api";
import { isAuthorized } from "./auth";
import { runDigest } from "./digest";
import { HttpError, error } from "./http";
import { handleClick, handlePixel } from "./track";

export interface Env {
  DB: D1Database;
  API_TOKEN: string;
  RESEND_API_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET") {
      if (path === "/health") return new Response("ok");
      const pixel = /^\/p\/([^/]+)\.gif$/.exec(path);
      if (pixel) return handlePixel(pixel[1], request, env, ctx);
      const click = /^\/c\/([^/]+)\/([^/]+)$/.exec(path);
      if (click) return handleClick(click[1], click[2], request, env, ctx);
    }

    if (path.startsWith("/api/")) {
      if (!(await isAuthorized(request, env.API_TOKEN))) return error(401, "unauthorized");
      try {
        return await handleApi(request, url, env);
      } catch (e) {
        if (e instanceof HttpError) return error(e.status, e.message);
        console.error("api error", e);
        return error(500, "internal error");
      }
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runDigest(env)
        .then((outcome) => console.log("digest:", outcome))
        .catch((e) => console.error("digest failed", e)),
    );
  },
} satisfies ExportedHandler<Env>;
