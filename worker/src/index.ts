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

/** A real page at the root, so the tracking domain is not a bare redirector. */
function homePage(): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>StandaMailTrack</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;line-height:1.6;color:#222}a{color:#0a5}</style>
</head>
<body>
<h1>StandaMailTrack</h1>
<p>This domain serves email analytics for <a href="https://standahealth.com">Standa Health</a>:
link redirects and open tracking for email we send. It stores no personal data beyond
pseudonymous event logs.</p>
<p>The software is open source:
<a href="https://github.com/OceanPineSD/StandaMailTrack">github.com/OceanPineSD/StandaMailTrack</a>.</p>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET") {
      if (path === "/health") return new Response("ok");
      if (path === "/") return homePage();
      if (path === "/robots.txt") return new Response("User-agent: *\nAllow: /\nDisallow: /api/\n");
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
