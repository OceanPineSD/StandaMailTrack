export interface Settings {
  /** Worker origin, e.g. https://email-tracker.me.workers.dev */
  origin: string;
  token: string;
  appId: string;
  trackByDefault: boolean;
}

export const DEFAULTS: Settings = { origin: "", token: "", appId: "", trackByDefault: true };

/** The https origin of a pasted Worker URL, or null if it isn't one (the manifest only grants https hosts). */
export function normalizeOrigin(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol !== "https:") return null;
  return url.origin;
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored } as Settings;
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set(s);
}
