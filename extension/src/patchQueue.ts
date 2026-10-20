/** Thread/message ids that couldn't be sent yet; retried by the background, given up on after a week. */
export interface PendingPatch {
  id: string;
  thread_id: string;
  message_id: string;
  queuedAt: number;
}

export const MAX_AGE_MS = 7 * 86_400_000;

/** Sends each queued patch in order and returns the ones still worth retrying. */
export async function flushPatches(
  queue: PendingPatch[],
  now: number,
  send: (p: PendingPatch) => Promise<void>,
): Promise<PendingPatch[]> {
  const left: PendingPatch[] = [];
  for (const item of queue) {
    if (now - item.queuedAt > MAX_AGE_MS) continue;
    try {
      await send(item);
    } catch (e) {
      // 404 (no such email) and 400 (ids rejected) are permanent: retrying can never succeed.
      const status = (e as { status?: number }).status;
      if (status !== 404 && status !== 400) left.push(item);
    }
  }
  return left;
}

/**
 * The stored retry queue. Every read-modify-write runs on one chain, so a patch queued while a flush is
 * sending isn't overwritten by the flush's result.
 */
export function createPatchStore(storage: { read(): Promise<PendingPatch[]>; write(q: PendingPatch[]): Promise<void> }) {
  let chain: Promise<unknown> = Promise.resolve();
  const serial = (fn: () => Promise<void>): Promise<void> => {
    const run = chain.then(fn);
    chain = run.catch(() => {});
    return run;
  };
  return {
    enqueue: (p: PendingPatch) => serial(async () => storage.write([...(await storage.read()), p])),
    flush: (now: number, send: (p: PendingPatch) => Promise<void>) =>
      serial(async () => {
        const queue = await storage.read();
        if (queue.length) await storage.write(await flushPatches(queue, now, send));
      }),
  };
}
