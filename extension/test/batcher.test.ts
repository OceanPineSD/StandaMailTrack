import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBatcher } from "../src/batcher";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createBatcher", () => {
  it("collects ids asked for in one burst into one request", async () => {
    const fetchMany = vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, id.toUpperCase()])));
    const b = createBatcher(fetchMany, { delayMs: 50 });
    const got = Promise.all([b.get("a"), b.get("b"), b.get("a")]);
    await vi.advanceTimersByTimeAsync(50);
    expect(await got).toEqual(["A", "B", "A"]);
    expect(fetchMany).toHaveBeenCalledTimes(1);
    expect(fetchMany.mock.calls[0][0]).toEqual(["a", "b"]);
  });

  it("splits a burst into requests of at most `max` ids", async () => {
    const fetchMany = vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, 1])));
    const b = createBatcher(fetchMany, { delayMs: 10, max: 2 });
    const got = Promise.all(["a", "b", "c"].map((id) => b.get(id)));
    await vi.advanceTimersByTimeAsync(10);
    await got;
    expect(fetchMany.mock.calls.map((c) => c[0])).toEqual([["a", "b"], ["c"]]);
  });

  it("serves repeats from cache until the ttl, then asks again", async () => {
    let n = 0;
    const fetchMany = vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, ++n])));
    const b = createBatcher(fetchMany, { delayMs: 10, ttlMs: 1000 });
    const first = b.get("a");
    await vi.advanceTimersByTimeAsync(10);
    expect(await first).toBe(1);
    const cached = b.get("a");
    await vi.advanceTimersByTimeAsync(10);
    expect(await cached).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    const fresh = b.get("a");
    await vi.advanceTimersByTimeAsync(10);
    expect(await fresh).toBe(2);
  });

  it("answers undefined on failure and doesn't cache it", async () => {
    const fetchMany = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ a: 7 });
    const b = createBatcher(fetchMany, { delayMs: 10 });
    const failed = b.get("a");
    await vi.advanceTimersByTimeAsync(10);
    expect(await failed).toBeUndefined();
    const retry = b.get("a");
    await vi.advanceTimersByTimeAsync(10);
    expect(await retry).toBe(7);
  });

  it("forget() drops a cached id so the next get re-fetches it", async () => {
    let n = 0;
    const b = createBatcher(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, ++n])), { delayMs: 10 });
    const one = b.get("a");
    await vi.advanceTimersByTimeAsync(10);
    await one;
    b.forget("a");
    const two = b.get("a");
    await vi.advanceTimersByTimeAsync(10);
    expect(await two).toBe(2);
  });
  it("answers an earlier caller when the id is forgotten and asked again in the same burst", async () => {
    const fetchMany = vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, id])));
    const b = createBatcher(fetchMany, { delayMs: 50 });
    const first = b.get("a");
    b.forget("a");
    const second = b.get("a");
    await vi.advanceTimersByTimeAsync(50);
    expect(await Promise.race([first, new Promise((r) => setTimeout(() => r("hung"), 1000))])).toBe("a");
    expect(await second).toBe("a");
  });
});
