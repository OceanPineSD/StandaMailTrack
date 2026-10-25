import type { Env } from "./index";
import { runDigest } from "./digest";
import { HttpError, json, readJson } from "./http";
import { LIMITS, isId, optionalExternalId, parseIdList, parseNewEmail } from "./validate";

/** Opens/clicks younger than this may still be suppressed by a late self view, so events wait for them. */
const SETTLE_MS = 60_000;
/** D1 allows at most 100 bound parameters per statement. */
const BIND_CHUNK = 100;

interface EmailRow {
  id: string;
  subject: string;
  recipients: string;
  recipient_count: number;
  sent_at: number;
  thread_id: string | null;
  message_id: string | null;
}

function emailOut(row: EmailRow) {
  return { ...row, recipients: JSON.parse(row.recipients) as string[] };
}

const bool = (v: unknown) => v === 1 || v === true;

async function createEmail(request: Request, env: Env): Promise<Response> {
  const email = parseNewEmail(await readJson(request));
  const now = Date.now();
  // One batch = one transaction, so an email is never stored without its links.
  // Idempotent: a repeat register never changes stored links, but fills in any that are missing.
  const [inserted] = await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO emails (id, subject, recipients, recipient_count, sent_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(email.id, email.subject, JSON.stringify(email.recipients), email.recipients.length, now),
    ...email.links.map((url, idx) =>
      env.DB.prepare("INSERT OR IGNORE INTO links (email_id, idx, url) VALUES (?, ?, ?)").bind(email.id, idx, url),
    ),
  ]);
  return json({ id: email.id, created: inserted.meta.changes > 0 });
}

async function patchEmail(id: string, request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const threadId = optionalExternalId(body.thread_id, "thread_id");
  const messageId = optionalExternalId(body.message_id, "message_id");
  const res = await env.DB.prepare(
    "UPDATE emails SET thread_id = COALESCE(?2, thread_id), message_id = COALESCE(?3, message_id) WHERE id = ?1",
  )
    .bind(id, threadId ?? null, messageId ?? null)
    .run();
  if (res.meta.changes === 0) throw new HttpError(404, "email not found");
  return json({ ok: true });
}

async function getEmail(id: string, env: Env): Promise<Response> {
  const [email, opens, clicks] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM emails WHERE id = ?").bind(id),
    env.DB.prepare("SELECT at, via_proxy, city, region, country, ua FROM counted_opens WHERE email_id = ? ORDER BY at").bind(id),
    env.DB.prepare(
      `SELECT c.at, c.link_idx, l.url, c.city, c.region, c.country, c.ua
       FROM clicks c LEFT JOIN links l ON l.email_id = c.email_id AND l.idx = c.link_idx
       WHERE c.email_id = ? ORDER BY c.at`,
    ).bind(id),
  ]);
  const row = email.results[0] as EmailRow | undefined;
  if (!row) throw new HttpError(404, "email not found");
  return json({
    email: emailOut(row),
    opens: opens.results.map((o: any) => ({ ...o, via_proxy: bool(o.via_proxy) })),
    clicks: clicks.results,
  });
}

async function selfViews(request: Request, env: Env): Promise<Response> {
  const ids = parseIdList((await readJson(request)).ids, LIMITS.selfViewIds);
  const now = Date.now();
  await env.DB.batch(ids.map((id) => env.DB.prepare("INSERT INTO self_views (email_id, at) VALUES (?, ?)").bind(id, now)));
  return json({ ok: true });
}

async function threads(url: URL, env: Env): Promise<Response> {
  const ids = [...new Set((url.searchParams.get("ids") ?? "").split(",").filter(Boolean))];
  if (ids.length > LIMITS.threadIds || ids.some((t) => t.length > LIMITS.externalId)) {
    throw new HttpError(400, "invalid ids");
  }
  const out: Record<string, unknown[]> = {};
  for (let i = 0; i < ids.length; i += BIND_CHUNK) {
    const chunk = ids.slice(i, i + BIND_CHUNK);
    const { results } = await env.DB.prepare(
      `SELECT e.*,
         (SELECT COUNT(*) FROM counted_opens o WHERE o.email_id = e.id) AS open_count,
         (SELECT MIN(at) FROM counted_opens o WHERE o.email_id = e.id) AS first_open,
         (SELECT MAX(at) FROM counted_opens o WHERE o.email_id = e.id) AS last_open,
         (SELECT COUNT(*) FROM clicks c WHERE c.email_id = e.id) AS click_count,
         (SELECT json_object('city', city, 'country', country, 'via_proxy', via_proxy)
            FROM counted_opens o WHERE o.email_id = e.id ORDER BY at DESC, id DESC LIMIT 1) AS last_location
       FROM emails e
       WHERE e.thread_id IN (${chunk.map(() => "?").join(",")})
       ORDER BY e.sent_at`,
    )
      .bind(...chunk)
      .all<EmailRow & { last_location: string | null }>();
    for (const r of results) {
      const loc = r.last_location ? JSON.parse(r.last_location) : null;
      (out[r.thread_id!] ??= []).push({
        ...emailOut(r),
        last_location: loc && { city: loc.city, country: loc.country, via_proxy: bool(loc.via_proxy) },
      });
    }
  }
  return json({ threads: out });
}

/** Cursor is "<last open id>-<last click id>". */
function parseCursor(raw: string | null): [number, number] | null {
  if (raw === null) return null;
  const m = /^(\d{1,15})-(\d{1,15})$/.exec(raw);
  if (!m) throw new HttpError(400, "invalid cursor");
  return [Number(m[1]), Number(m[2])];
}

/**
 * Clamps `after` to the table's max id (recovers a stale cursor) and returns the highest id the poll may
 * advance to: just below the first unsettled row, so a fresh event is reported (or suppressed) on a later
 * poll even when rows commit out of `at` order.
 */
async function pollWindow(env: Env, table: "opens" | "clicks", after: number, settled: number) {
  const row = await env.DB.prepare(
    `WITH a AS (SELECT MIN(?1, (SELECT COALESCE(MAX(id), 0) FROM ${table})) AS v)
     SELECT (SELECT v FROM a) AS after,
            COALESCE((SELECT MIN(id) - 1 FROM ${table} WHERE id > (SELECT v FROM a) AND at > ?2),
                     (SELECT COALESCE(MAX(id), 0) FROM ${table})) AS bound`,
  )
    .bind(after, settled)
    .first<{ after: number; bound: number }>();
  return row!;
}

async function events(url: URL, env: Env): Promise<Response> {
  const cursor = parseCursor(url.searchParams.get("after"));
  const settled = Date.now() - SETTLE_MS;
  const [o, c] = await Promise.all([
    pollWindow(env, "opens", cursor?.[0] ?? 0, settled),
    pollWindow(env, "clicks", cursor?.[1] ?? 0, settled),
  ]);
  // First poll: start from now, don't replay history (unsettled rows stay ahead of the cursor).
  if (!cursor) return json({ events: [], cursor: `${o.bound}-${c.bound}` });
  const [afterOpen, afterClick] = [o.after, c.after];
  const bounds = { o: o.bound, c: c.bound };
  const [opens, clicks] = await env.DB.batch([
    env.DB.prepare(
      `SELECT 'open' AS type, o.id, o.email_id, o.at, o.via_proxy, o.city, o.country, NULL AS url,
              e.subject, e.recipients, e.recipient_count
       FROM counted_opens o JOIN emails e ON e.id = o.email_id
       WHERE o.id > ? AND o.id <= ? ORDER BY o.id`,
    ).bind(afterOpen, bounds.o),
    env.DB.prepare(
      `SELECT 'click' AS type, c.id, c.email_id, c.at, 0 AS via_proxy, c.city, c.country, l.url,
              e.subject, e.recipients, e.recipient_count
       FROM clicks c JOIN emails e ON e.id = c.email_id
       LEFT JOIN links l ON l.email_id = c.email_id AND l.idx = c.link_idx
       WHERE c.id > ? AND c.id <= ? ORDER BY c.id`,
    ).bind(afterClick, bounds.c),
  ]);
  const all = [...opens.results, ...clicks.results]
    .map((e: any) => ({ ...e, via_proxy: bool(e.via_proxy), recipients: JSON.parse(e.recipients) }))
    .sort((a, b) => a.at - b.at);
  return json({ events: all, cursor: `${bounds.o}-${bounds.c}` });
}

/** One CSV field, quoted only when it has to be. */
function csvField(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

interface ExportRow {
  id: string;
  subject: string;
  recipients: string;
  event: string;
  destination: string;
  at: number;
  via_proxy: number;
  city: string | null;
  region: string | null;
  country: string | null;
  ua: string | null;
}

/**
 * GET /api/export.csv?since=<epoch ms> — every counted open and every click, oldest first.
 * Opens inside the grace window or near a self view are excluded, the same as everywhere else.
 */
async function exportCsv(url: URL, env: Env): Promise<Response> {
  const sinceRaw = url.searchParams.get("since");
  if (sinceRaw !== null && !/^\d{1,15}$/.test(sinceRaw)) throw new HttpError(400, "invalid since");
  const since = sinceRaw === null ? 0 : Number(sinceRaw);
  const [opens, clicks] = await env.DB.batch([
    env.DB.prepare(
      `SELECT o.email_id AS id, e.subject, e.recipients, 'open' AS event, '' AS destination,
              o.at, o.via_proxy, o.city, o.region, o.country, o.ua
       FROM counted_opens o JOIN emails e ON e.id = o.email_id
       WHERE o.at > ?`,
    ).bind(since),
    env.DB.prepare(
      `SELECT c.email_id AS id, e.subject, e.recipients, 'click' AS event, COALESCE(l.url, '') AS destination,
              c.at, 0 AS via_proxy, c.city, c.region, c.country, c.ua
       FROM clicks c JOIN emails e ON e.id = c.email_id
       LEFT JOIN links l ON l.email_id = c.email_id AND l.idx = c.link_idx
       WHERE c.at > ?`,
    ).bind(since),
  ]);
  const rows = [...(opens.results as unknown as ExportRow[]), ...(clicks.results as unknown as ExportRow[])].sort(
    (a, b) => a.at - b.at,
  );
  const header = "id,campaign,recipient,event,destination,at_iso,at_ms,via_proxy,city,region,country,ua";
  const lines = rows.map((r) =>
    [
      r.id,
      r.subject,
      (JSON.parse(r.recipients) as string[]).join("; "),
      r.event,
      r.destination,
      new Date(r.at).toISOString(),
      r.at,
      bool(r.via_proxy) ? 1 : 0,
      r.city,
      r.region,
      r.country,
      r.ua,
    ]
      .map(csvField)
      .join(","),
  );
  return new Response([header, ...lines].join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="standamailtrack-export.csv"',
    },
  });
}

const SETTINGS_KEYS = new Set(["digest_enabled", "digest_every_days", "digest_to", "digest_from"]);

async function getSettings(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  return json(Object.fromEntries(results.map((r) => [r.key, r.value])));
}

/** PUT /api/settings — upserts the editable digest settings; last_digest_at stays server-managed. */
async function putSettings(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const entries = Object.entries(body);
  if (!entries.length) throw new HttpError(400, "no settings given");
  for (const [key, value] of entries) {
    if (!SETTINGS_KEYS.has(key)) throw new HttpError(400, `unknown setting: ${key}`);
    if (typeof value !== "string" || value.length > 320) throw new HttpError(400, `invalid value for ${key}`);
    if (key === "digest_enabled" && !/^[01]$/.test(value)) throw new HttpError(400, "digest_enabled must be 0 or 1");
    if (key === "digest_every_days" && !/^([1-9]|[12]\d|30)$/.test(value))
      throw new HttpError(400, "digest_every_days must be 1-30");
    if (key === "digest_to" && value !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      throw new HttpError(400, "digest_to must be an email address");
  }
  await env.DB.batch(
    entries.map(([key, value]) =>
      env.DB.prepare(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
      ).bind(key, value as string),
    ),
  );
  return getSettings(env);
}

/** Routes an authenticated /api/* request. */
export async function handleApi(request: Request, url: URL, env: Env): Promise<Response> {
  const path = url.pathname;
  const method = request.method;
  if (path === "/api/settings" && method === "GET") return getSettings(env);
  if (path === "/api/settings" && method === "PUT") return putSettings(request, env);
  if (path === "/api/digest" && method === "POST") return json({ outcome: await runDigest(env) });
  if (path === "/api/export.csv" && method === "GET") return exportCsv(url, env);
  if (path === "/api/emails" && method === "POST") return createEmail(request, env);
  if (path === "/api/self-views" && method === "POST") return selfViews(request, env);
  if (path === "/api/threads" && method === "GET") return threads(url, env);
  if (path === "/api/events" && method === "GET") return events(url, env);
  const m = /^\/api\/emails\/([^/]+)$/.exec(path);
  if (m) {
    if (!isId(m[1])) throw new HttpError(404, "email not found");
    if (method === "GET") return getEmail(m[1], env);
    if (method === "PATCH") return patchEmail(m[1], request, env);
  }
  throw new HttpError(404, "not found");
}
