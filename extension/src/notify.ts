import { ApiError } from "./api";
import { place } from "./format";
import type { EventsPage, TrackEvent } from "./types";

/** Just the site: full links can carry tokens or personal data, and the OS keeps notification history. */
function host(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export interface Note {
  title: string;
  message: string;
}

/** One notification per event, at most `max`; the rest fold into a "+N more" note. */
export function notificationsFor(events: TrackEvent[], max = 5): Note[] {
  const notes = events.slice(0, max).map((e): Note => {
    const who = e.recipient_count === 1 && e.recipients[0] ? e.recipients[0] : "Someone";
    const where = place({ city: e.city, country: e.country, via_proxy: e.via_proxy });
    const subject = `“${e.subject || "(no subject)"}”`;
    return e.type === "open"
      ? { title: `${who} opened your email`, message: `${subject} · ${where}` }
      : { title: `${who} clicked a link`, message: [subject, host(e.url), where].filter(Boolean).join(" · ") };
  });
  const rest = events.length - max;
  if (rest > 0) notes.push({ title: "StandaMailTrack", message: `+${rest} more opens and clicks` });
  return notes;
}

/**
 * Polls /api/events from a stored cursor. One poll at a time, so an alarm firing during a slow poll can't
 * notify the same events twice; the cursor is saved only after a successful answer.
 */
export function createPoller(deps: {
  getCursor: () => Promise<string | null>;
  setCursor: (c: string | null) => Promise<void>;
  fetchEvents: (cursor: string | null) => Promise<EventsPage>;
  notify: (notes: Note[]) => void;
}) {
  let running: Promise<void> | null = null;

  async function once() {
    const cursor = await deps.getCursor();
    let page: EventsPage;
    try {
      page = await deps.fetchEvents(cursor);
    } catch (e) {
      // A cursor the Worker can't read would fail forever; start over from "now".
      if (e instanceof ApiError && e.status === 400) return deps.setCursor(null);
      throw e;
    }
    await deps.setCursor(page.cursor);
    const notes = notificationsFor(page.events);
    if (notes.length) deps.notify(notes);
  }

  return {
    poll(): Promise<void> {
      running ??= once().finally(() => (running = null));
      return running;
    },
  };
}
