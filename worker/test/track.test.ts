import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { api, backdate, click, count, newId, pixel, register } from "./helpers";

describe("GET /p/:id.gif (open pixel)", () => {
  it("C1: always returns an uncacheable GIF; opens inside the 15s grace window are not counted", async () => {
    const id = newId();
    await register(id);
    await backdate(id, 5_000); // this hit lands at sent_at + 5s
    const early = await pixel(id, "UA-early");
    expect(early.status).toBe(200);
    expect(early.headers.get("Content-Type")).toBe("image/gif");
    expect(early.headers.get("Cache-Control")).toContain("no-store");
    expect(new Uint8Array(await early.arrayBuffer()).length).toBeGreaterThan(0);

    await backdate(id, 60_000); // the next hit lands at sent_at + 65s
    await pixel(id, "UA-late");

    expect(await count("SELECT COUNT(*) n FROM opens WHERE email_id = ?", id)).toBe(2);
    const stats = await (await api(`/api/emails/${id}`)).json<{ opens: unknown[] }>();
    expect(stats.opens).toHaveLength(1);
  });

  it("C2: unknown or malformed ids still get a GIF and write nothing", async () => {
    const before = await count("SELECT COUNT(*) n FROM opens");
    for (const bad of [newId(), "short", "x".repeat(23), "bad!chars_____________"]) {
      const res = await pixel(bad);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/gif");
    }
    expect(await count("SELECT COUNT(*) n FROM opens")).toBe(before);
  });

  it("C7: dedupes the same user agent within 60s", async () => {
    const id = newId();
    await register(id);
    await pixel(id, "UA-same");
    await pixel(id, "UA-same");
    await pixel(id, "UA-other");
    expect(await count("SELECT COUNT(*) n FROM opens WHERE email_id = ?", id)).toBe(2);
  });

  it("caps opens at 60 per email per hour", async () => {
    const id = newId();
    await register(id);
    for (let i = 0; i < 65; i++) await pixel(id, `UA-${i}`);
    expect(await count("SELECT COUNT(*) n FROM opens WHERE email_id = ?", id)).toBe(60);
  });

  it("records geo for direct opens and nulls it for Gmail's image proxy", async () => {
    const id = newId();
    await register(id);
    await pixel(id, "Mozilla/5.0 iPhone", { city: "Mumbai", region: "Maharashtra", country: "IN" });
    await pixel(id, "Mozilla/5.0 (via ggpht.com GoogleImageProxy)", { city: "Mountain View", country: "US" });
    const { results } = await env.DB.prepare(
      "SELECT via_proxy, city, country FROM opens WHERE email_id = ? ORDER BY id",
    )
      .bind(id)
      .all();
    expect(results).toEqual([
      { via_proxy: 0, city: "Mumbai", country: "IN" },
      { via_proxy: 1, city: null, country: null },
    ]);
  });
});

describe("GET /c/:id/:idx (click redirect)", () => {
  it("C3: redirects to exactly the stored URL and logs one click", async () => {
    const id = newId();
    await register(id, { links: ["https://a.com/?q=1", "https://b.com/x"] });
    const res = await click(id, 0, { city: "Pune", country: "IN" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://a.com/?q=1");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(await count("SELECT COUNT(*) n FROM clicks WHERE email_id = ? AND link_idx = 0", id)).toBe(1);
  });

  it("dedupes repeated clicks on the same link by the same user agent within 60s", async () => {
    const id = newId();
    await register(id, { links: ["https://a.com/"] });
    await click(id, 0);
    const second = await click(id, 0);
    expect(second.status).toBe(302); // still redirects
    expect(await count("SELECT COUNT(*) n FROM clicks WHERE email_id = ?", id)).toBe(1);
  });

  it("C2: 404s (never redirects) for unknown ids, malformed ids or unknown link indexes", async () => {
    const id = newId();
    await register(id, { links: ["https://a.com/"] });
    for (const [cid, idx] of [[newId(), 0], ["bad", 0], [id, 99], [id, -1], [id, "abc"]] as const) {
      const res = await click(cid, idx);
      expect(res.status, `${cid}/${idx}`).toBe(404);
      expect(res.headers.get("Location"), `${cid}/${idx}`).toBeNull();
    }
  });
});

describe("click redirect when the database is down", () => {
  it("answers 503 with Retry-After instead of throwing", async () => {
    const { createExecutionContext } = await import("cloudflare:test");
    const { default: worker } = await import("../src/index");
    const brokenDb = { prepare: () => { throw new Error("D1 unavailable"); } } as unknown as D1Database;
    const res = await worker.fetch(
      new Request(`https://t.test/c/${newId()}/0`, { redirect: "manual" }),
      { ...env, DB: brokenDb },
      createExecutionContext(),
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
    expect(res.headers.get("Location")).toBeNull();
  });
});
