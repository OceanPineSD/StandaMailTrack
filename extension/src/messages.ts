import type { NewEmail, ConnectionState } from "./api";

/** Requests from the Gmail content script and the options page to the background service worker. */
export type Request =
  | { type: "register"; email: NewEmail }
  | { type: "patch"; id: string; thread_id: string; message_id: string }
  | { type: "checkConnection" }
  | { type: "threads"; ids: string[] }
  | { type: "email"; id: string }
  | { type: "selfViews"; ids: string[] };

export type Reply = { ok: true; state?: ConnectionState; data?: unknown } | { ok: false; error: string };

export function send(msg: Request): Promise<Reply> {
  return chrome.runtime.sendMessage(msg);
}
