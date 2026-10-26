import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api";
import { createPoller, notificationsFor } from "../src/notify";
import type { TrackEvent } from "../src/types";

const ev = (over: Partial<TrackEvent> = {}): TrackEvent => ({
  type: "open",
  id: 1,
  email_id: "e1",
  at: 1_000,
  via_proxy: true,
  city: null,
  country: null,
  url: null,
  subject: "Q3 plan",
  recipients: ["bob@x.com"],
  recipient_count: 1,
  ...over,
});

describe("notificationsFor", () => {
  it("names a single recipient and says where it was opened", () => {
    expect(notificationsFor([ev()])).toEqual([{ title: "bob@x.com opened your email", message: "“Q3 plan” · via Gmail" }]);
  });

  it("says Someone for several recipients and shows the clicked link and city", () => {
    const click = ev({ type: "click", recipients: ["a@x", "b@x"], recipient_count: 2, url: "https://a.com/reset?token=secret", via_proxy: false, city: "Pune", country: "IN" });
    expect(notificationsFor([click])).toEqual([
      { title: "Someone clicked a link", message: "“Q3 plan” · a.com · Pune, IN" },
    ]);
  });

  it("falls back to (no subject) when the subject is empty", () => {
    expect(notificationsFor([ev({ subject: "" })])[0].message).toBe("“(no subject)” · via Gmail");
  });

  it("caps a burst and folds the rest into one summary", () => {
    const many = Array.from({ length: 7 }, (_, i) => ev({ id: i + 1 }));
    const got = notificationsFor(many, 3);
    expect(got).toHaveLength(4);
    expect(got[3]).toEqual({ title: "StandaMailTrack", message: "+4 more opens and clicks" });
  });

  it("returns nothing for no events", () => {
    expect(notificationsFor([])).toEqual([]);
  });
});

function store(initial: string | null) {
  let cursor = initial;
  return { get: vi.fn(async () => cursor), set: vi.fn(async (c: string | null) => void (cursor = c)), now: () => cursor };
}

describe("createPoller", () => {
  it("sends the stored cursor, notifies, and saves the new cursor", async () => {
    const s = store("3-1");
    const fetchEvents = vi.fn(async () => ({ events: [ev()], cursor: "4-1" }));
    const notify = vi.fn();
    await createPoller({ getCursor: s.get, setCursor: s.set, fetchEvents, notify }).poll();
    expect(fetchEvents).toHaveBeenCalledWith("3-1");
    expect(notify).toHaveBeenCalledWith([{ title: "bob@x.com opened your email", message: "“Q3 plan” · via Gmail" }]);
    expect(s.now()).toBe("4-1");
  });

  it("on the first poll only stores the cursor", async () => {
    const s = store(null);
    const fetchEvents = vi.fn(async () => ({ events: [], cursor: "9-2" }));
    const notify = vi.fn();
    await createPoller({ getCursor: s.get, setCursor: s.set, fetchEvents, notify }).poll();
    expect(fetchEvents).toHaveBeenCalledWith(null);
    expect(notify).not.toHaveBeenCalled();
    expect(s.now()).toBe("9-2");
  });

  it("drops a cursor the Worker rejects so the next poll starts fresh", async () => {
    const s = store("garbage");
    const fetchEvents = vi.fn(async () => {
      throw new ApiError(400, "invalid cursor");
    });
    await createPoller({ getCursor: s.get, setCursor: s.set, fetchEvents, notify: vi.fn() }).poll();
    expect(s.now()).toBeNull();
  });

  it("keeps the cursor when the Worker is unreachable", async () => {
    const s = store("3-1");
    const fetchEvents = vi.fn(async () => {
      throw new ApiError(503, "down");
    });
    await expect(createPoller({ getCursor: s.get, setCursor: s.set, fetchEvents, notify: vi.fn() }).poll()).rejects.toThrow();
    expect(s.now()).toBe("3-1");
  });

  it("never runs two polls at once, so events aren't notified twice", async () => {
    const s = store("1-1");
    let release!: () => void;
    const fetchEvents = vi.fn(
      () => new Promise<{ events: TrackEvent[]; cursor: string }>((r) => (release = () => r({ events: [ev()], cursor: "2-1" }))),
    );
    const notify = vi.fn();
    const p = createPoller({ getCursor: s.get, setCursor: s.set, fetchEvents, notify });
    const a = p.poll();
    const b = p.poll();
    await vi.waitFor(() => expect(fetchEvents).toHaveBeenCalled());
    release();
    await Promise.all([a, b]);
    expect(fetchEvents).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
