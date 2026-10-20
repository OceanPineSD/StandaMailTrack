import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, backdate, click, count, newId, pixel, register, settleAll } from "./helpers";

describe("auth", () => {
  it("C5: rejects missing, wrong and different-length tokens with 401", async () => {
    const id = newId();
    const badHeaders: Record<string, string>[] = [
      {},
      { Authorization: "Bearer wrong-token" },
      { Authorization: "Bearer x" },
      { Authorization: "test-token" },
    ];
    for (const headers of badHeaders) {
      expect((await api(`/api/emails/${id}`, "GET", undefined, headers)).status).toBe(401);
      expect((await api("/api/emails", "POST", { id }, headers)).status).toBe(401);
    }
  });

  it("404s unknown API routes once authenticated", async () => {
    expect((await api("/api/nope")).status).toBe(404);
  });
});

describe("POST /api/emails", () => {
  it("C5: is idempotent; a duplicate register keeps one row and the original links", async () => {
    const id = newId();
    await register(id, { links: ["https://a.com/"] });
    const again = await api("/api/emails", "POST", { id, subject: "x", recipients: [], links: ["https://evil.com/"] });
    expect(again.status).toBe(200);
    expect(await count("SELECT COUNT(*) n FROM emails WHERE id = ?", id)).toBe(1);
    const rows = await env.DB.prepare("SELECT url FROM links WHERE email_id = ?").bind(id).all();
    expect(rows.results).toEqual([{ url: "https://a.com/" }]);
  });

  it("a retried register fills in links missing from an earlier attempt", async () => {
    const id = newId();
    await register(id); // as if the links write had been lost
    await register(id, { links: ["https://a.com/"] });
    const res = await click(id, 0);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://a.com/");
  });

  it("C3: rejects bad ids, non-http(s) links and oversize input with 400", async () => {
    const bodies = [
      { id: "x".repeat(23), subject: "", recipients: [], links: [] },
      { id: "short", subject: "", recipients: [], links: [] },
      { id: newId(), subject: "", recipients: [], links: ["javascript:alert(1)"] },
      { id: newId(), subject: "", recipients: [], links: ["ftp://a.com/"] },
      { id: newId(), subject: "", recipients: [], links: ["https://a.com/" + "a".repeat(2100)] },
      { id: newId(), subject: "s".repeat(501), recipients: [], links: [] },
      { id: newId(), subject: "", recipients: [], links: Array(201).fill("https://a.com/") },
      { id: newId(), subject: "", recipients: "bob", links: [] },
      { id: newId(), subject: "", recipients: Array(101).fill("a@b.c"), links: [] },
    ];
    for (const body of bodies) expect((await api("/api/emails", "POST", body)).status, JSON.stringify(body).slice(0, 80)).toBe(400);
    expect((await api("/api/emails", "POST", "not json")).status).toBe(400);
  });
});

describe("PATCH /api/emails/:id", () => {
  it("attaches thread and message ids; 404 for unknown emails", async () => {
    const id = newId();
    await register(id);
    expect((await api(`/api/emails/${id}`, "PATCH", { thread_id: "th-1", message_id: "m-1" })).status).toBe(200);
    const row = await env.DB.prepare("SELECT thread_id, message_id FROM emails WHERE id = ?").bind(id).first();
    expect(row).toEqual({ thread_id: "th-1", message_id: "m-1" });
    expect((await api(`/api/emails/${newId()}`, "PATCH", { thread_id: "x" })).status).toBe(404);
    expect((await api(`/api/emails/${id}`, "PATCH", { thread_id: 5 })).status).toBe(400);
  });
});

describe("self views", () => {
  it("C4: a self view posted after an open still suppresses it; later opens count", async () => {
    const id = newId();
    await register(id);
    await backdate(id, 90_000);
    await pixel(id, "UA-mine"); // open at T+90s
    await backdate(id, 10_000);
    expect((await api("/api/self-views", "POST", { ids: [id] })).status).toBe(200); // self view at T+100s
    let detail = await (await api(`/api/emails/${id}`)).json<{ opens: unknown[] }>();
    expect(detail.opens).toHaveLength(0);

    await backdate(id, 100_000);
    await pixel(id, "UA-theirs"); // open at T+200s, 100s after the self view
    detail = await (await api(`/api/emails/${id}`)).json<{ opens: unknown[] }>();
    expect(detail.opens).toHaveLength(1);
  });

  it("rejects malformed ids", async () => {
    expect((await api("/api/self-views", "POST", { ids: ["bad"] })).status).toBe(400);
    expect((await api("/api/self-views", "POST", { ids: "x" })).status).toBe(400);
  });
});

describe("GET /api/emails/:id", () => {
  it("returns the email, counted opens and clicks with URLs", async () => {
    const id = newId();
    await register(id, { links: ["https://a.com/"], recipients: ["bob@example.com"], subject: "Hi Bob" });
    await backdate(id, 30_000);
    await pixel(id, "UA-1", { city: "Mumbai", country: "IN" });
    await click(id, 0, { city: "Pune", country: "IN" });
    const detail = await (await api(`/api/emails/${id}`)).json<any>();
    expect(detail.email).toMatchObject({ id, subject: "Hi Bob", recipients: ["bob@example.com"], recipient_count: 1 });
    expect(detail.opens).toEqual([expect.objectContaining({ city: "Mumbai", country: "IN", via_proxy: false })]);
    expect(detail.clicks).toEqual([expect.objectContaining({ link_idx: 0, url: "https://a.com/", city: "Pune" })]);
    expect((await api(`/api/emails/${newId()}`)).status).toBe(404);
  });
});

describe("GET /api/threads", () => {
  it("C6: maps thread ids to email summaries, handling more than 100 ids", async () => {
    const id = newId();
    await register(id);
    await api(`/api/emails/${id}`, "PATCH", { thread_id: "th-c6" });
    await backdate(id, 30_000);
    await pixel(id, "UA-a", { city: "Delhi", country: "IN" });
    const others = Array.from({ length: 149 }, (_, i) => `none-${i}`);
    const res = await api(`/api/threads?ids=${["th-c6", ...others].join(",")}`);
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(Object.keys(body.threads)).toEqual(["th-c6"]);
    expect(body.threads["th-c6"]).toEqual([
      expect.objectContaining({
        id,
        open_count: 1,
        click_count: 0,
        last_location: { city: "Delhi", country: "IN", via_proxy: false },
      }),
    ]);
  });

  it("400s for more than 500 ids", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `t${i}`).join(",");
    expect((await api(`/api/threads?ids=${ids}`)).status).toBe(400);
  });
});

describe("GET /api/events", () => {
  beforeEach(settleAll);

  it("C6: without a cursor returns no history; after a cursor returns only settled new events", async () => {
    const start = await (await api("/api/events")).json<{ events: unknown[]; cursor: string }>();
    expect(start.events).toEqual([]);

    const id = newId();
    await register(id, { links: ["https://a.com/"] });
    await backdate(id, 30_000); // past the 15s grace window
    await pixel(id, "UA-1");
    await backdate(id, 120_000); // settled: older than the 60s self-view window
    const settled = await (await api(`/api/events?after=${start.cursor}`)).json<any>();
    expect(settled.events).toEqual([
      expect.objectContaining({ type: "open", email_id: id, subject: "Hello", recipient_count: 1 }),
    ]);

    // Fresh events aren't reported until they settle, and the cursor doesn't skip them.
    await click(id, 0);
    const fresh = await (await api(`/api/events?after=${settled.cursor}`)).json<any>();
    expect(fresh.events).toEqual([]);
    await backdate(id, 120_000);
    const later = await (await api(`/api/events?after=${fresh.cursor}`)).json<any>();
    expect(later.events).toEqual([expect.objectContaining({ type: "click", email_id: id, url: "https://a.com/" })]);
  });

  it("does not report suppressed opens", async () => {
    const start = await (await api("/api/events")).json<{ cursor: string }>();
    const id = newId();
    await register(id);
    await backdate(id, 30_000);
    await pixel(id, "UA-mine");
    await api("/api/self-views", "POST", { ids: [id] });
    await backdate(id, 120_000);
    const res = await (await api(`/api/events?after=${start.cursor}`)).json<any>();
    expect(res.events.filter((e: any) => e.email_id === id)).toEqual([]);
  });

  it("never skips an unsettled event that was committed before a settled one", async () => {
    const start = await (await api("/api/events")).json<{ cursor: string }>();
    const id = newId();
    await register(id);
    await backdate(id, 300_000);
    const now = Date.now();
    // Out-of-order commit: the lower id is still fresh, the higher id is already settled.
    await env.DB.prepare("INSERT INTO opens (email_id, at, ua) VALUES (?, ?, 'fresh')").bind(id, now).run();
    await env.DB.prepare("INSERT INTO opens (email_id, at, ua) VALUES (?, ?, 'old')").bind(id, now - 120_000).run();
    const first = await (await api(`/api/events?after=${start.cursor}`)).json<any>();
    expect(first.events).toEqual([]);
    await env.DB.prepare("UPDATE opens SET at = at - 120000 WHERE email_id = ? AND ua = 'fresh'").bind(id).run();
    const second = await (await api(`/api/events?after=${first.cursor}`)).json<any>();
    expect(second.events.map((e: any) => e.email_id)).toEqual([id, id]);
  });

  it("first poll keeps unsettled events for the next poll", async () => {
    const id = newId();
    await register(id);
    await backdate(id, 30_000);
    await pixel(id, "UA-pre");
    const start = await (await api("/api/events")).json<{ cursor: string }>();
    await backdate(id, 120_000);
    const next = await (await api(`/api/events?after=${start.cursor}`)).json<any>();
    expect(next.events.map((e: any) => e.email_id)).toEqual([id]);
  });

  it("resets a cursor that is ahead of the data", async () => {
    const res = await (await api("/api/events?after=999999999-999999999")).json<{ cursor: string }>();
    const max = await env.DB.prepare(
      "SELECT (SELECT COALESCE(MAX(id), 0) FROM opens) o, (SELECT COALESCE(MAX(id), 0) FROM clicks) c",
    ).first<{ o: number; c: number }>();
    const [o, c] = res.cursor.split("-").map(Number);
    expect(o).toBeLessThanOrEqual(max!.o);
    expect(c).toBeLessThanOrEqual(max!.c);
  });

  it("400s for a malformed cursor", async () => {
    expect((await api("/api/events?after=abc")).status).toBe(400);
  });
});
