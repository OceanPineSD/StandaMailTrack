function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Ids of our pixels among image srcs. Gmail shows images through its proxy, keeping the original URL
 * after `#` (sometimes percent-encoded), so the origin is matched anywhere at a URL boundary.
 */
export function trackedIds(srcs: string[], origin: string): string[] {
  if (!origin) return [];
  const re = new RegExp(`(?:^|#)${escapeRe(origin)}/p/([0-9A-Za-z]{22})\\.gif`);
  const ids = new Set<string>();
  for (const src of srcs) {
    let decoded = src;
    try {
      decoded = decodeURIComponent(src);
    } catch {
      // keep the raw src
    }
    const m = re.exec(decoded) ?? re.exec(src);
    if (m) ids.add(m[1]);
  }
  return [...ids];
}
