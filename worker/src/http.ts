export const NO_STORE = "no-store, no-cache, must-revalidate, private";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": NO_STORE },
  });
}

export function error(status: number, message: string): Response {
  return json({ error: message }, status);
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const MAX_BODY = 64 * 1024;

/** Parses a JSON object body, throwing a 400 for anything else. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "body too large");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new HttpError(400, "expected an object");
  return data as Record<string, unknown>;
}
