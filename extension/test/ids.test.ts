import { describe, expect, it } from "vitest";
import { ID_RE, newId } from "../src/ids";

describe("newId", () => {
  it("C9: 10k ids all match the worker's id format and are unique", () => {
    const ids = Array.from({ length: 10_000 }, newId);
    for (const id of ids) expect(id).toMatch(ID_RE);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses every base62 character (no truncated alphabet)", () => {
    const seen = new Set(Array.from({ length: 2_000 }, newId).join(""));
    expect(seen.size).toBe(62);
  });
});
