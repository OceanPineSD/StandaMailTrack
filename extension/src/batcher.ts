/**
 * Coalesces lookups made in one burst (Gmail renders a whole list of rows at once) into few requests,
 * and caches answers for `ttlMs`. A failed request answers undefined and isn't cached.
 */
export function createBatcher<T>(
  fetchMany: (ids: string[]) => Promise<Record<string, T>>,
  { delayMs = 50, ttlMs = 60_000, max = 500 }: { delayMs?: number; ttlMs?: number; max?: number } = {},
) {
  const cache = new Map<string, { at: number; value: Promise<T | undefined> }>();
  let waiting = new Map<string, (v: T | undefined) => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function run(batch: Map<string, (v: T | undefined) => void>) {
    const ids = [...batch.keys()];
    for (let i = 0; i < ids.length; i += max) {
      const chunk = ids.slice(i, i + max);
      try {
        const got = await fetchMany(chunk);
        for (const id of chunk) batch.get(id)!(got[id]);
      } catch {
        for (const id of chunk) {
          cache.delete(id);
          batch.get(id)!(undefined);
        }
      }
    }
  }

  return {
    get(id: string): Promise<T | undefined> {
      const hit = cache.get(id);
      if (hit && Date.now() - hit.at < ttlMs) return hit.value;
      // A forget() mid-burst can ask again for an id that's already waiting; answer both callers.
      const prev = waiting.get(id);
      const value = new Promise<T | undefined>((resolve) =>
        waiting.set(id, prev ? (v) => (prev(v), resolve(v)) : resolve),
      );
      cache.set(id, { at: Date.now(), value });
      timer ??= setTimeout(() => {
        const batch = waiting;
        waiting = new Map();
        timer = null;
        void run(batch);
      }, delayMs);
      return value;
    },
    forget(id: string) {
      cache.delete(id);
    },
  };
}
