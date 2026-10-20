import type { Env } from "./index";
import { NO_STORE } from "./http";
import { isId } from "./validate";

// 1×1 transparent GIF.
const GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));

const DEDUPE_MS = 60_000;
const CAP_WINDOW_MS = 3_600_000;
const CAP_PER_WINDOW = 60;

interface Hit {
  at: number;
  ua: string | null;
  viaProxy: boolean;
  city: string | null;
  region: string | null;
  country: string | null;
}

function hitFrom(request: Request): Hit {
  const ua = request.headers.get("User-Agent");
  // Gmail fetches images through its proxy, so the geo would be Google's, not the reader's.
  const viaProxy = ua?.includes("GoogleImageProxy") ?? false;
  const cf = (request as { cf?: IncomingRequestCfProperties }).cf;
  const geo = (v: unknown) => (!viaProxy && typeof v === "string" && v ? v : null);
  return { at: Date.now(), ua, viaProxy, city: geo(cf?.city), region: geo(cf?.region), country: geo(cf?.country) };
}

function gif(): Response {
  return new Response(GIF, {
    headers: { "Content-Type": "image/gif", "Cache-Control": NO_STORE, Expires: "0", Pragma: "no-cache" },
  });
}

/** GET /p/:id.gif — always answers with the GIF; the open is recorded in the background. */
export function handlePixel(id: string, request: Request, env: Env, ctx: ExecutionContext): Response {
  if (isId(id)) {
    const h = hitFrom(request);
    // One statement: only known emails, dedupe the same UA within 60s, cap opens per email per hour.
    const write = env.DB.prepare(
      `INSERT INTO opens (email_id, at, via_proxy, city, region, country, ua)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
       WHERE EXISTS (SELECT 1 FROM emails WHERE id = ?1)
         AND NOT EXISTS (SELECT 1 FROM opens WHERE email_id = ?1 AND ua IS ?7 AND at > ?2 - ?8)
         AND (SELECT COUNT(*) FROM opens WHERE email_id = ?1 AND at > ?2 - ?9) < ?10`,
    )
      .bind(id, h.at, h.viaProxy ? 1 : 0, h.city, h.region, h.country, h.ua, DEDUPE_MS, CAP_WINDOW_MS, CAP_PER_WINDOW)
      .run();
    ctx.waitUntil(write.catch((e) => console.error("open write failed", e)));
  }
  return gif();
}

/** GET /c/:id/:idx — redirects only to a URL registered for that email (never an open redirect). */
export async function handleClick(
  id: string,
  rawIdx: string,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": NO_STORE } });
  if (!isId(id) || !/^\d{1,3}$/.test(rawIdx)) return notFound();
  const idx = Number(rawIdx);
  let link: { url: string } | null;
  try {
    link = await env.DB.prepare("SELECT url FROM links WHERE email_id = ? AND idx = ?").bind(id, idx).first<{ url: string }>();
  } catch (e) {
    console.error("link lookup failed", e);
    return new Response("Temporarily unavailable, please retry.", {
      status: 503,
      headers: { "Cache-Control": NO_STORE, "Retry-After": "5" },
    });
  }
  if (!link) return notFound();

  const h = hitFrom(request);
  const write = env.DB.prepare(
    `INSERT INTO clicks (email_id, link_idx, at, city, region, country, ua)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
     WHERE NOT EXISTS (SELECT 1 FROM clicks WHERE email_id = ?1 AND link_idx = ?2 AND ua IS ?7 AND at > ?3 - ?8)
       AND (SELECT COUNT(*) FROM clicks WHERE email_id = ?1 AND at > ?3 - ?9) < ?10`,
  )
    .bind(id, idx, h.at, h.city, h.region, h.country, h.ua, DEDUPE_MS, CAP_WINDOW_MS, CAP_PER_WINDOW)
    .run();
  ctx.waitUntil(write.catch((e) => console.error("click write failed", e)));

  return new Response(null, { status: 302, headers: { Location: link.url, "Cache-Control": NO_STORE } });
}
