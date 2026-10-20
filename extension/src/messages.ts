import type { NewEmail, ConnectionState } from "./api";

/** Requests from the Gmail content script and the options page to the background service worker. */
export type Request =
  | { type: "register"; email: NewEmail }
  | { type: "patch"; id: string; thread_id: string; message_id: string }
  | { type: "checkConnection" };

export type Reply = { ok: true; state?: ConnectionState } | { ok: false; error: string };

export function send(msg: Request): Promise<Reply> {
  return chrome.runtime.sendMessage(msg);
}
