import { describe, expect, it } from "vitest";
import { MAX_AGE_MS, createPatchStore, flushPatches, type PendingPatch } from "../src/patchQueue";

const p = (id: string, queuedAt: number): PendingPatch => ({ id, thread_id: `t-${id}`, message_id: `m-${id}`, queuedAt });

describe("flushPatches", () => {
  it("drops sent patches, keeps failed ones, and gives up on week-old ones", async () => {
    const now = 1_000_000_000_000;
    const queue = [p("ok", now - 1000), p("fail", now - 1000), p("stale", now - MAX_AGE_MS - 1)];
    const sent: string[] = [];
    const left = await flushPatches(queue, now, async (item) => {
      sent.push(item.id);
      if (item.id === "fail") throw new Error("offline");
    });
    expect(sent).toEqual(["ok", "fail"]);
    expect(left.map((x) => x.id)).toEqual(["fail"]);
  });

  it("drops a patch the Worker rejects as unknown (404) rather than retrying forever", async () => {
    const left = await flushPatches([p("gone", Date.now())], Date.now(), async () => {
      throw Object.assign(new Error("not found"), { name: "ApiError", status: 404 });
    });
    expect(left).toEqual([]);
  });
});

describe("flushPatches: permanent errors", () => {
  it("F5: drops a patch the Worker rejects as invalid (400)", async () => {
    const left = await flushPatches([p("bad", Date.now())], Date.now(), async () => {
      throw Object.assign(new Error("bad"), { name: "ApiError", status: 400 });
    });
    expect(left).toEqual([]);
  });
});

describe("createPatchStore", () => {
  it("F4: a patch queued while a flush is in flight is not lost", async () => {
    let stored: PendingPatch[] = [p("a", Date.now())];
    const store = createPatchStore({
      read: async () => stored,
      write: async (q) => {
        stored = q;
      },
    });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const flushing = store.flush(Date.now(), async () => {
      await gate;
      throw new Error("offline");
    });
    const queued = store.enqueue(p("b", Date.now()));
    release();
    await Promise.all([flushing, queued]);
    expect(stored.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("F4: concurrent enqueues all land", async () => {
    let stored: PendingPatch[] = [];
    const store = createPatchStore({
      read: async () => stored,
      write: async (q) => {
        stored = q;
      },
    });
    await Promise.all(["a", "b", "c"].map((id) => store.enqueue(p(id, Date.now()))));
    expect(stored.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});
