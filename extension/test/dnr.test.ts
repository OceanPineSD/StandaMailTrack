import { describe, expect, it } from "vitest";
import { pixelBlockRule } from "../src/dnr";

describe("pixelBlockRule", () => {
  it("blocks only our pixel, only when your own Gmail tab loads it directly", () => {
    const r = pixelBlockRule("https://t.example.workers.dev");
    expect(r.action.type).toBe("block");
    expect(r.condition.urlFilter).toBe("|https://t.example.workers.dev/p/");
    expect(r.condition.initiatorDomains).toEqual(["mail.google.com"]);
    expect(r.condition.resourceTypes).toEqual(["image"]);
  });
});
