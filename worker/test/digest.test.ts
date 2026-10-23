import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { buildDigest, collectDigestData, runDigest } from "../src/digest";
import type { Env } from "../src/index";
import { api, backdate, click, newId, pixel, register } from "./helpers";

describe("digest", () => {
  it("builds a digest from collected campaign data and skips empty windows", async () => {
    const id = newId();
    const t0 = Date.now();
    await register(id, { subject: "digest-camp", recipients: ["anon-dg"], links: ["https://example.com/d"] });
    await backdate(id, 30_000);
    await pixel(id);
    await click(id, 0);

    const data = await collectDigestData(env as unknown as Env, t0 - 60_000, Date.now() + 1);
    const digest = buildDigest(data);
    expect(digest).not.toBeNull();
    expect(digest!.subject).toContain("open");
    expect(digest!.text).toContain("digest-camp");
    expect(digest!.text).toContain("anon-dg");
    expect(digest!.html).toContain("https://example.com/d");

    const empty = buildDigest(await collectDigestData(env as unknown as Env, 1, 2));
    expect(empty).toBeNull();
  });

  it("skips sending when the API key or settings are missing", async () => {
    const noKey = { ...(env as unknown as Env), RESEND_API_KEY: undefined };
    expect(await runDigest(noKey)).toContain("RESEND_API_KEY");
    const withKey = { ...(env as unknown as Env), RESEND_API_KEY: "re_test" };
    // digest_enabled defaults to 0 and digest_to is empty, so nothing is sent.
    expect(await runDigest(withKey)).toContain("skipped");
  });
});

describe("/api/settings", () => {
  it("reads, validates and updates the digest settings", async () => {
    const before = await (await api("/api/settings")).json<Record<string, string>>();
    expect(before.digest_every_days).toBeDefined();

    expect((await api("/api/settings", "PUT", { nope: "1" })).status).toBe(400);
    expect((await api("/api/settings", "PUT", { digest_enabled: "2" })).status).toBe(400);
    expect((await api("/api/settings", "PUT", { digest_every_days: "0" })).status).toBe(400);
    expect((await api("/api/settings", "PUT", { digest_to: "not-an-email" })).status).toBe(400);

    const updated = await (
      await api("/api/settings", "PUT", { digest_every_days: "2", digest_to: "me@example.com" })
    ).json<Record<string, string>>();
    expect(updated.digest_every_days).toBe("2");
    expect(updated.digest_to).toBe("me@example.com");

    expect((await api("/api/settings", "GET", undefined, {})).status).toBe(401);
  });
});
