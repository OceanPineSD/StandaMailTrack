import { describe, expect, it } from "vitest";
import { renderPanel } from "../src/panel";
import type { EmailDetail } from "../src/types";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const NASTY = 'https://a.com/"><img src=x onerror=alert(1)>';

const detail: EmailDetail = {
  email: {
    id: "A".repeat(22),
    subject: "Quote",
    recipients: ["bob@x.com"],
    recipient_count: 1,
    sent_at: NOW - 60 * MIN,
    thread_id: "t1",
    message_id: "m1",
  },
  opens: [
    { at: NOW - 50 * MIN, via_proxy: true, city: null, region: null, country: null, ua: "GoogleImageProxy" },
    { at: NOW - 5 * MIN, via_proxy: false, city: "Pune", region: "MH", country: "IN", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)" },
  ],
  clicks: [{ at: NOW - 10 * MIN, link_idx: 0, url: NASTY, city: "Pune", region: "MH", country: "IN", ua: "Mozilla/5.0 (Windows NT 10.0)" }],
};

describe("renderPanel", () => {
  it("summarises each email and lists its events newest first", () => {
    const el = renderPanel([detail], NOW, document);
    expect(el.textContent).toContain("Quote");
    expect(el.textContent).toContain("bob@x.com opened 2× · last 5m ago · Pune, IN · 1 click");
    const rows = [...el.querySelectorAll("li")].map((li) => li.textContent ?? "");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("Opened");
    expect(rows[0]).toContain("Pune, IN · iPhone");
    expect(rows[1]).toContain("Clicked");
    expect(rows[2]).toContain("via Gmail");
  });

  it("renders server data as text, never as html", () => {
    const el = renderPanel([detail], NOW, document);
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toContain(NASTY);
  });

  it("says when nothing happened yet", () => {
    const el = renderPanel([{ ...detail, opens: [], clicks: [] }], NOW, document);
    expect(el.textContent).toContain("Sent, not opened");
    expect(el.textContent).toContain("No opens or clicks yet");
  });
});
