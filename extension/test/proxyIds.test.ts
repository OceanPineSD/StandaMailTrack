import { describe, expect, it } from "vitest";
import { trackedIds } from "../src/proxyIds";

const ORIGIN = "https://t.example.workers.dev";
const A = "A".repeat(22);
const B = "b1".repeat(11);

describe("trackedIds", () => {
  it("C10: extracts ids from direct and Gmail-proxied pixel srcs and ignores foreign images", () => {
    const srcs = [
      `${ORIGIN}/p/${A}.gif`,
      `https://ci3.googleusercontent.com/meips/ADKq_Nb#${ORIGIN}/p/${B}.gif`,
      `https://ci3.googleusercontent.com/meips/x#${encodeURIComponent(`${ORIGIN}/p/${A}.gif`)}`,
      "https://img.com/p/" + A + ".gif",
      `https://evil.com/?u=${ORIGIN}x/p/${A}.gif`,
      `${ORIGIN}/p/short.gif`,
    ];
    expect(trackedIds(srcs, ORIGIN)).toEqual([A, B]);
  });

  it("returns nothing without an origin", () => {
    expect(trackedIds([`${ORIGIN}/p/${A}.gif`], "")).toEqual([]);
  });
});
