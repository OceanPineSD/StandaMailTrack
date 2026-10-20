// Lets InboxSDK inject its page-world script (MV3).
import "@inboxsdk/core/background.js";
import { createApi } from "./api";
import { PIXEL_BLOCK_RULE_ID, pixelBlockRule } from "./dnr";
import type { Reply, Request } from "./messages";
import { createPatchStore, type PendingPatch } from "./patchQueue";
import { loadSettings } from "./settings";

const REGISTER_TIMEOUT_MS = 3_000;
const QUEUE_KEY = "pendingPatches";
const FLUSH_ALARM = "flush-patches";

async function api() {
  const s = await loadSettings();
  if (!s.origin || !s.token) throw new Error("Email Tracker isn't set up yet (open its options page).");
  return createApi({ origin: s.origin, token: s.token });
}

const patches = createPatchStore({
  read: async () => ((await chrome.storage.local.get(QUEUE_KEY))[QUEUE_KEY] ?? []) as PendingPatch[],
  write: (q) => chrome.storage.local.set({ [QUEUE_KEY]: q }),
});

function flushQueue() {
  // api() is resolved per item so an empty queue never needs the extension to be set up.
  return patches.flush(Date.now(), async (p) => {
    await (await api()).patch(p.id, { thread_id: p.thread_id, message_id: p.message_id });
  });
}

async function handle(msg: Request): Promise<Reply> {
  switch (msg.type) {
    case "register":
      await (await api()).register(msg.email, REGISTER_TIMEOUT_MS);
      return { ok: true };
    case "patch": {
      const p = { id: msg.id, thread_id: msg.thread_id, message_id: msg.message_id, queuedAt: Date.now() };
      try {
        await (await api()).patch(p.id, { thread_id: p.thread_id, message_id: p.message_id });
      } catch {
        await patches.enqueue(p); // retried by the alarm
      }
      return { ok: true };
    }
    case "checkConnection":
      return { ok: true, state: await (await api()).checkConnection() };
    case "threads":
      return { ok: true, data: await (await api()).threads(msg.ids) };
    case "email":
      return { ok: true, data: await (await api()).email(msg.id) };
    case "selfViews":
      await (await api()).selfViews(msg.ids);
      return { ok: true };
  }
}

chrome.runtime.onMessage.addListener((msg: Request, sender, sendResponse) => {
  // Only our own content script (on Gmail) and extension pages may use the API token.
  const fromGmail = sender.url?.startsWith("https://mail.google.com/") ?? false;
  const fromExtension = sender.url?.startsWith(chrome.runtime.getURL("")) ?? false;
  if (sender.id !== chrome.runtime.id || !(fromGmail || fromExtension)) return false;
  handle(msg).then(sendResponse, (e: unknown) => sendResponse({ ok: false, error: String((e as Error)?.message ?? e) }));
  return true; // async response
});

// Re-creating an existing periodic alarm would reset its schedule on every service-worker wake.
chrome.alarms.get(FLUSH_ALARM).then((a) => {
  if (!a) chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 1 });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FLUSH_ALARM) flushQueue().catch((e) => console.warn("patch retry failed", e));
});

/** Keeps the rule that stops your own Gmail tab from loading your pixels in step with the Worker URL. */
async function syncPixelRule() {
  const { origin } = await loadSettings();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [PIXEL_BLOCK_RULE_ID],
    addRules: origin ? [pixelBlockRule(origin)] : [],
  });
}
syncPixelRule().catch((e) => console.warn("pixel rule failed", e));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "origin" in changes) syncPixelRule().catch((e) => console.warn("pixel rule failed", e));
});
