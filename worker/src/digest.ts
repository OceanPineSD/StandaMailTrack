import type { Env } from "./index";

export interface CampaignOpens {
  campaign: string;
  opens: number;
  unique_opens: number;
}

export interface CampaignClicks {
  campaign: string;
  url: string;
  clicks: number;
  unique_clicks: number;
}

export interface DigestEvent {
  campaign: string;
  recipient: string;
  event: string;
  destination: string;
  at: number;
}

export interface DigestData {
  since: number;
  now: number;
  opens: CampaignOpens[];
  clicks: CampaignClicks[];
  events: DigestEvent[];
}

export interface Settings {
  digest_enabled: boolean;
  digest_every_days: number;
  digest_to: string;
  digest_from: string;
  last_digest_at: number;
}

const DAY_MS = 86_400_000;
/** The cron fires once a day; the slack keeps a slightly early tick from skipping a whole day. */
const SLACK_MS = 3_600_000;

export async function readSettings(env: Env): Promise<Settings> {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const map = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return {
    digest_enabled: map.digest_enabled === "1",
    digest_every_days: Math.max(1, Number(map.digest_every_days) || 1),
    digest_to: map.digest_to ?? "",
    digest_from: map.digest_from ?? "",
    last_digest_at: Number(map.last_digest_at) || 0,
  };
}

export async function collectDigestData(env: Env, since: number, now: number): Promise<DigestData> {
  const [opens, clicks, events] = await env.DB.batch([
    env.DB.prepare(
      `SELECT e.subject AS campaign, COUNT(*) AS opens, COUNT(DISTINCT o.email_id) AS unique_opens
       FROM counted_opens o JOIN emails e ON e.id = o.email_id
       WHERE o.at > ?1 AND o.at <= ?2 GROUP BY e.subject ORDER BY opens DESC`,
    ).bind(since, now),
    env.DB.prepare(
      `SELECT e.subject AS campaign, COALESCE(l.url, '') AS url, COUNT(*) AS clicks,
              COUNT(DISTINCT c.email_id) AS unique_clicks
       FROM clicks c JOIN emails e ON e.id = c.email_id
       LEFT JOIN links l ON l.email_id = c.email_id AND l.idx = c.link_idx
       WHERE c.at > ?1 AND c.at <= ?2 GROUP BY e.subject, l.url ORDER BY clicks DESC`,
    ).bind(since, now),
    env.DB.prepare(
      `SELECT * FROM (
         SELECT e.subject AS campaign, e.recipients, 'open' AS event, '' AS destination, o.at
         FROM counted_opens o JOIN emails e ON e.id = o.email_id WHERE o.at > ?1 AND o.at <= ?2
         UNION ALL
         SELECT e.subject AS campaign, e.recipients, 'click' AS event, COALESCE(l.url, '') AS destination, c.at
         FROM clicks c JOIN emails e ON e.id = c.email_id
         LEFT JOIN links l ON l.email_id = c.email_id AND l.idx = c.link_idx
         WHERE c.at > ?1 AND c.at <= ?2
       ) ORDER BY at DESC LIMIT 30`,
    ).bind(since, now),
  ]);
  return {
    since,
    now,
    opens: opens.results as unknown as CampaignOpens[],
    clicks: clicks.results as unknown as CampaignClicks[],
    events: (events.results as unknown as (DigestEvent & { recipients: string })[]).map((e) => ({
      campaign: e.campaign,
      recipient: (JSON.parse(e.recipients) as string[]).join("; "),
      event: e.event,
      destination: e.destination,
      at: e.at,
    })),
  };
}

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** Pure digest renderer: returns null when the window holds no events. */
export function buildDigest(d: DigestData): { subject: string; html: string; text: string } | null {
  const totalOpens = d.opens.reduce((n, r) => n + r.opens, 0);
  const totalClicks = d.clicks.reduce((n, r) => n + r.clicks, 0);
  if (totalOpens + totalClicks === 0) return null;

  const subject = `StandaMailTrack: ${totalOpens} open${totalOpens === 1 ? "" : "s"}, ${totalClicks} click${totalClicks === 1 ? "" : "s"}`;
  const fmt = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";

  const textLines = [
    `Window: ${fmt(d.since)} to ${fmt(d.now)}`,
    "",
    "Opens by campaign (counted opens; treat as delivered and rendered):",
    ...d.opens.map((r) => `  ${r.campaign || "(no campaign)"}: ${r.opens} opens, ${r.unique_opens} unique`),
    "",
    "Clicks by link:",
    ...(d.clicks.length
      ? d.clicks.map((r) => `  ${r.campaign || "(no campaign)"} -> ${r.url}: ${r.clicks} clicks, ${r.unique_clicks} unique`)
      : ["  none"]),
    "",
    `Latest events (up to 30):`,
    ...d.events.map((e) => `  ${fmt(e.at)}  ${e.event.padEnd(5)} ${e.recipient}  ${e.campaign}${e.destination ? "  -> " + e.destination : ""}`),
  ];

  const row = (cells: string[], tag = "td") =>
    `<tr>${cells.map((c) => `<${tag} style="padding:4px 10px;border-bottom:1px solid #eee;text-align:left">${c}</${tag}>`).join("")}</tr>`;
  const html = [
    `<p style="font-family:sans-serif">Window: ${fmt(d.since)} to ${fmt(d.now)}</p>`,
    `<h3 style="font-family:sans-serif">Opens by campaign</h3>`,
    `<p style="font-family:sans-serif;color:#666;font-size:13px">Counted opens. Treat as delivered and rendered, not read.</p>`,
    `<table style="font-family:sans-serif;font-size:14px;border-collapse:collapse">`,
    row(["Campaign", "Opens", "Unique"], "th"),
    ...d.opens.map((r) => row([escapeHtml(r.campaign || "(no campaign)"), String(r.opens), String(r.unique_opens)])),
    `</table>`,
    `<h3 style="font-family:sans-serif">Clicks by link</h3>`,
    `<table style="font-family:sans-serif;font-size:14px;border-collapse:collapse">`,
    row(["Campaign", "Link", "Clicks", "Unique"], "th"),
    ...(d.clicks.length
      ? d.clicks.map((r) =>
          row([escapeHtml(r.campaign || "(no campaign)"), escapeHtml(r.url), String(r.clicks), String(r.unique_clicks)]),
        )
      : [row(["none", "", "", ""])]),
    `</table>`,
    `<h3 style="font-family:sans-serif">Latest events</h3>`,
    `<table style="font-family:sans-serif;font-size:13px;border-collapse:collapse">`,
    row(["Time (UTC)", "Event", "Recipient", "Campaign", "Destination"], "th"),
    ...d.events.map((e) =>
      row([fmt(e.at), e.event, escapeHtml(e.recipient), escapeHtml(e.campaign), escapeHtml(e.destination)]),
    ),
    `</table>`,
  ].join("\n");

  return { subject, html, text: textLines.join("\n") };
}

/** Runs on the cron trigger: sends the digest when due and there is activity, then advances the window. */
export async function runDigest(env: Env, now = Date.now()): Promise<string> {
  if (!env.RESEND_API_KEY) return "skipped: RESEND_API_KEY not set";
  const s = await readSettings(env);
  if (!s.digest_enabled) return "skipped: digest disabled";
  if (!s.digest_to || !s.digest_from) return "skipped: digest_to or digest_from not set";
  if (now - s.last_digest_at < s.digest_every_days * DAY_MS - SLACK_MS) return "skipped: not due yet";

  const data = await collectDigestData(env, s.last_digest_at, now);
  const advance = () =>
    env.DB.prepare("UPDATE settings SET value = ?1 WHERE key = 'last_digest_at'").bind(String(now)).run();

  const digest = buildDigest(data);
  if (!digest) {
    await advance();
    return "sent nothing: no events in window";
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: s.digest_from, to: [s.digest_to], subject: digest.subject, html: digest.html, text: digest.text }),
  });
  if (!res.ok) {
    // last_digest_at stays put, so the next cron retries the same window.
    const body = await res.text();
    console.error("digest send failed", res.status, body);
    return `send failed: ${res.status}`;
  }
  await advance();
  return `sent: ${digest.subject}`;
}
