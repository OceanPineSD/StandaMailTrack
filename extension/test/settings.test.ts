import { describe, expect, it } from "vitest";
import { normalizeOrigin } from "../src/settings";

describe("normalizeOrigin", () => {
  it("keeps only the https origin of a pasted Worker URL", () => {
    expect(normalizeOrigin(" https://email-tracker.me.workers.dev/ ")).toBe("https://email-tracker.me.workers.dev");
    expect(normalizeOrigin("https://email-tracker.me.workers.dev/health?x=1")).toBe("https://email-tracker.me.workers.dev");
  });

  it("F6: rejects http, which the extension has no permission to reach", () => {
    expect(normalizeOrigin("http://localhost:8787")).toBeNull();
    expect(normalizeOrigin("http://email-tracker.me.workers.dev")).toBeNull();
  });

  it("rejects garbage and credentials", () => {
    for (const bad of ["", "nope", "ftp://a.com", "https://user:pw@a.com", "javascript:alert(1)"]) {
      expect(normalizeOrigin(bad), bad).toBeNull();
    }
  });
});
