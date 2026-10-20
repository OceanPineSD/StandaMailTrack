import { describe, expect, it } from "vitest";
import { badgeLabel, device, place, summaryLine, timeAgo } from "../src/format";
import type { EmailSummary } from "../src/types";

const NOW = 1_800_000_000_000;
const MIN = 60_000;

function email(over: Partial<EmailSummary> = {}): EmailSummary {
  return {
    id: "A".repeat(22),
    subject: "Hello",
    recipients: ["bob@x.com"],
    recipient_count: 1,
    sent_at: NOW - 600 * MIN,
    thread_id: "t1",
    message_id: "m1",
    open_count: 0,
    first_open: null,
    last_open: null,
    click_count: 0,
    last_location: null,
    ...over,
  };
}

describe("timeAgo", () => {
  it("scales from seconds to a date", () => {
    expect(timeAgo(NOW - 30_000, NOW)).toBe("just now");
    expect(timeAgo(NOW - 5 * MIN, NOW)).toBe("5m ago");
    expect(timeAgo(NOW - 125 * MIN, NOW)).toBe("2h ago");
    expect(timeAgo(NOW - 3 * 1440 * MIN, NOW)).toBe("3d ago");
    expect(timeAgo(NOW - 30 * 1440 * MIN, NOW)).toBe(new Date(NOW - 30 * 1440 * MIN).toISOString().slice(0, 10));
  });
});

describe("place", () => {
  it("says via Gmail for proxy hits and city, country otherwise", () => {
    expect(place({ city: null, country: null, via_proxy: true })).toBe("via Gmail");
    expect(place({ city: "Pune", country: "IN", via_proxy: false })).toBe("Pune, IN");
    expect(place({ city: null, country: "IN", via_proxy: false })).toBe("IN");
    expect(place({ city: null, country: null, via_proxy: false })).toBe("unknown location");
  });
});

describe("device", () => {
  it("names the platform of a browser UA and nothing for Gmail's proxy", () => {
    expect(device("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/155")).toBe("Windows");
    expect(device("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("iPhone");
    expect(device("Mozilla/5.0 (Linux; Android 15; Pixel 9)")).toBe("Android");
    expect(device("Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)")).toBe("Mac");
    expect(device("Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)")).toBe("");
    expect(device(null)).toBe("");
  });
});

describe("summaryLine (C9)", () => {
  it("names the only recipient", () => {
    const e = email({ open_count: 3, last_open: NOW - 125 * MIN, last_location: { city: null, country: null, via_proxy: true } });
    expect(summaryLine(e, NOW)).toBe("bob@x.com opened 3× · last 2h ago · via Gmail");
  });

  it("says Someone with several recipients, and counts clicks", () => {
    const e = email({
      recipients: ["a@x.com", "b@x.com"],
      recipient_count: 2,
      open_count: 1,
      last_open: NOW - 5 * MIN,
      click_count: 2,
      last_location: { city: "Pune", country: "IN", via_proxy: false },
    });
    expect(summaryLine(e, NOW)).toBe("Someone opened 1× · last 5m ago · Pune, IN · 2 clicks");
  });

  it("says not opened, but still reports a click (images can be blocked)", () => {
    expect(summaryLine(email(), NOW)).toBe("Sent, not opened");
    expect(summaryLine(email({ click_count: 1 }), NOW)).toBe("Sent, not opened · 1 click");
  });
});

describe("badgeLabel", () => {
  it("sums opens over the thread's tracked emails", () => {
    expect(badgeLabel([email({ open_count: 2 }), email({ open_count: 1 })])?.title).toBe("✓✓ 3");
  });

  it("is a single tick when nothing was opened, and nothing when the thread isn't tracked", () => {
    expect(badgeLabel([email()])?.title).toBe("✓");
    expect(badgeLabel([])).toBeNull();
  });
});
