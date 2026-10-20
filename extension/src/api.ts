import type { EmailDetail, EmailSummary } from "./types";

export interface NewEmail {
  id: string;
  subject: string;
  recipients: string[];
  links: string[];
}

export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export type ConnectionState = "ok" | "unauthorized" | "unreachable";

/** Typed client for the Worker's /api. Only the background service worker uses it. */
export function createApi({ origin, token, fetch = globalThis.fetch.bind(globalThis) }: { origin: string; token: string; fetch?: Fetch }) {
  async function call(path: string, method: string, body?: unknown, timeoutMs = 10_000): Promise<unknown> {
    const res = await fetch(origin + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new ApiError(res.status, `${method} ${path} failed: ${res.status}`);
    return res.json();
  }

  return {
    register: (email: NewEmail, timeoutMs?: number) => call("/api/emails", "POST", email, timeoutMs),
    patch: (id: string, ids: { thread_id?: string; message_id?: string }) => call(`/api/emails/${encodeURIComponent(id)}`, "PATCH", ids),
    threads: (ids: string[]) =>
      call(`/api/threads?ids=${encodeURIComponent(ids.join(","))}`, "GET") as Promise<{ threads: Record<string, EmailSummary[]> }>,
    email: (id: string) => call(`/api/emails/${encodeURIComponent(id)}`, "GET") as Promise<EmailDetail>,
    selfViews: (ids: string[]) => call("/api/self-views", "POST", { ids }),
    /** An authorized lookup of an id that can't exist answers 404; a bad token answers 401. */
    async checkConnection(): Promise<ConnectionState> {
      try {
        await call(`/api/emails/${"0".repeat(22)}`, "GET");
        return "ok";
      } catch (e) {
        if (e instanceof ApiError) return e.status === 401 ? "unauthorized" : e.status === 404 ? "ok" : "unreachable";
        return "unreachable";
      }
    },
  };
}

export type Api = ReturnType<typeof createApi>;
