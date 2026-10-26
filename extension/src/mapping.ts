import { ID_RE } from "./ids";

/** One recipient from a snippets.mjs mapping.csv, keyed by lower-cased email. */
export interface MappingEntry {
  id: string;
  pseudonym: string;
  campaign: string;
}

export type MappingIndex = Record<string, MappingEntry>;

/** Minimal RFC 4180 CSV parser: quoted fields, embedded commas, CRLF or LF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(field), (field = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field), (field = "");
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) (row.push(field), rows.push(row));
  return rows;
}

/**
 * Entries from one mapping.csv (header: email,name,campaign,id,pseudonym).
 * Rows with a malformed id are skipped rather than imported wrong.
 */
export function parseMapping(text: string): MappingIndex {
  const rows = parseCsv(text);
  const header = rows.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
  const col = (name: string) => header.indexOf(name);
  const [email, campaign, id, pseudonym] = [col("email"), col("campaign"), col("id"), col("pseudonym")];
  if (email < 0 || id < 0) return {};
  const out: MappingIndex = {};
  for (const row of rows) {
    const key = row[email]?.trim().toLowerCase();
    const rowId = row[id]?.trim();
    if (!key || !rowId || !ID_RE.test(rowId)) continue;
    out[key] = {
      id: rowId,
      pseudonym: (pseudonym >= 0 ? row[pseudonym] : "")?.trim() || `anon-${rowId.slice(0, 10)}`,
      campaign: (campaign >= 0 ? row[campaign] : "")?.trim() ?? "",
    };
  }
  return out;
}

/**
 * Whether a compose should be tracked: an explicit toggle wins, otherwise the subject
 * prefix (case-insensitive) or the track-by-default setting turns it on.
 */
export function shouldTrack(
  manual: boolean | null,
  subject: string,
  prefix: string,
  trackByDefault: boolean,
): boolean {
  if (manual !== null) return manual;
  const p = prefix.trim().toLowerCase();
  if (p && subject.trim().toLowerCase().startsWith(p)) return true;
  return trackByDefault;
}

/** The campaign stored with a registration, in order of preference. */
export function campaignFor(entry: MappingEntry | undefined, configured: string, subject: string, prefix: string): string {
  if (entry?.campaign) return entry.campaign;
  if (configured.trim()) return configured.trim();
  const p = prefix.trim().toLowerCase();
  const s = subject.trim();
  return p && s.toLowerCase().startsWith(p) ? s.slice(prefix.trim().length).trim() || s : s;
}

/** Origins the options page refuses: the tracker must live on the custom domain. */
export function isForbiddenOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "workers.dev" || host.endsWith(".workers.dev");
  } catch {
    return true;
  }
}
