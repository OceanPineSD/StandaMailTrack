import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("health", () => {
  it("returns ok", async () => {
    const res = await exports.default.fetch("https://t.test/health");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("404s unknown paths", async () => {
    const res = await exports.default.fetch("https://t.test/nope");
    expect(res.status).toBe(404);
  });
});
