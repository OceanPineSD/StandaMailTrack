import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import worker from "../src/index";

export const AUTH = { Authorization: "Bearer test-token" };
export const BASE = "https://t.test";

let seq = 0;
/** A fresh valid 22-char base62 id, unique within the test run. */
export function newId(): string {
  seq += 1;
  return ("T" + seq.toString(36) + "x".repeat(22)).slice(0, 22);
}

/** Calls the worker and waits for its `waitUntil` work (DB writes) to finish. */
export async function call(
  path: string,
  init: RequestInit & { cf?: Record<string, unknown> } = {},
): Promise<Response> {
  const ctx = createExecutionContext();
  const req = new Request(BASE + path, { redirect: "manual", ...init } as RequestInit);
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export function api(path: string, method = "GET", body?: unknown, headers: Record<string, string> = AUTH) {
  return call(path, {
    method,
    headers: { ...headers, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
}

export async function register(
  id: string,
  { links = [] as string[], recipients = ["bob@example.com"], subject = "Hello" } = {},
) {
  const res = await api("/api/emails", "POST", { id, subject, recipients, links });
  if (res.status !== 200) throw new Error(`register failed: ${res.status} ${await res.text()}`);
}

/** Moves an email's sent_at and all its recorded events into the past by `ms`. */
export async function backdate(id: string, ms: number) {
  await env.DB.batch([
    env.DB.prepare("UPDATE emails SET sent_at = sent_at - ?2 WHERE id = ?1").bind(id, ms),
    env.DB.prepare("UPDATE opens SET at = at - ?2 WHERE email_id = ?1").bind(id, ms),
    env.DB.prepare("UPDATE self_views SET at = at - ?2 WHERE email_id = ?1").bind(id, ms),
    env.DB.prepare("UPDATE clicks SET at = at - ?2 WHERE email_id = ?1").bind(id, ms),
  ]);
}

export function pixel(id: string, ua = "Mozilla/5.0 (test)", cf?: Record<string, unknown>) {
  return call(`/p/${id}.gif`, { headers: { "User-Agent": ua }, cf });
}

export function click(id: string, idx: number | string, cf?: Record<string, unknown>, ua = "Mozilla/5.0 (test)") {
  return call(`/c/${id}/${idx}`, { headers: { "User-Agent": ua }, cf });
}

export async function count(sql: string, ...binds: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql).bind(...binds).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Ages every stored row by 10 minutes (keeping relative timing) so nothing left by earlier tests is unsettled. */
export async function settleAll() {
  const ms = 600_000;
  await env.DB.batch(
    ["emails SET sent_at = sent_at", "opens SET at = at", "clicks SET at = at", "self_views SET at = at"].map((s) =>
      env.DB.prepare(`UPDATE ${s} - ?`).bind(ms),
    ),
  );
}
