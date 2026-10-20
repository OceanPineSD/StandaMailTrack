import type { EmailDetail, EmailSummary, Location } from "./types";

const MIN = 60_000;

/** "just now", "5m ago", "2h ago", "3d ago", then the date. */
export function timeAgo(at: number, now: number): string {
  const mins = Math.floor((now - at) / MIN);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h ago`;
  if (mins < 7 * 24 * 60) return `${Math.floor(mins / (24 * 60))}d ago`;
  return new Date(at).toISOString().slice(0, 10);
}

/** Gmail's proxy hides the reader's location, so its hits only say "via Gmail". */
export function place(loc: Location): string {
  if (loc.via_proxy) return "via Gmail";
  return [loc.city, loc.country].filter(Boolean).join(", ") || "unknown location";
}

/** A rough platform name from a browser UA; empty for Gmail's proxy or an unknown UA. */
export function device(ua: string | null): string {
  if (!ua || ua.includes("GoogleImageProxy")) return "";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Macintosh|Mac OS X/.test(ua)) return "Mac";
  if (/Linux/.test(ua)) return "Linux";
  return "";
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One line per email. A single pixel can't tell recipients apart, so several recipients read "Someone". */
export function summaryLine(e: EmailSummary, now: number): string {
  const parts: string[] = [];
  if (e.open_count > 0) {
    const who = e.recipient_count === 1 && e.recipients[0] ? e.recipients[0] : "Someone";
    parts.push(`${who} opened ${e.open_count}×`);
    if (e.last_open !== null) parts.push(`last ${timeAgo(e.last_open, now)}`);
    if (e.last_location) parts.push(place(e.last_location));
  } else {
    parts.push("Sent, not opened");
  }
  if (e.click_count > 0) parts.push(plural(e.click_count, "click"));
  return parts.join(" · ");
}

/** The summary row of a detail, as /api/threads would report it. */
export function summarize(d: EmailDetail): EmailSummary {
  const last = d.opens.reduce<EmailDetail["opens"][number] | null>((a, o) => (!a || o.at >= a.at ? o : a), null);
  return {
    ...d.email,
    open_count: d.opens.length,
    first_open: d.opens.length ? Math.min(...d.opens.map((o) => o.at)) : null,
    last_open: last?.at ?? null,
    click_count: d.clicks.length,
    last_location: last && { city: last.city, country: last.country, via_proxy: last.via_proxy },
  };
}

export interface Badge {
  title: string;
  foregroundColor: string;
  backgroundColor: string;
}

/** Sent-list label for a thread: "✓✓ <opens>" once anything was opened, "✓" before; null if untracked. */
export function badgeLabel(emails: EmailSummary[]): Badge | null {
  if (!emails.length) return null;
  const opens = emails.reduce((n, e) => n + e.open_count, 0);
  return opens > 0
    ? { title: `✓✓ ${opens}`, foregroundColor: "#ffffff", backgroundColor: "#188038" }
    : { title: "✓", foregroundColor: "#5f6368", backgroundColor: "#e8eaed" };
}
