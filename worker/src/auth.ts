const encoder = new TextEncoder();

async function sha256(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", encoder.encode(value));
}

/**
 * Checks `Authorization: Bearer <token>` against the configured secret.
 * Both sides are hashed first so the constant-time compare always sees equal lengths.
 */
export async function isAuthorized(request: Request, secret: string | undefined): Promise<boolean> {
  if (!secret) return false;
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const [given, expected] = await Promise.all([sha256(header.slice(7)), sha256(secret)]);
  return crypto.subtle.timingSafeEqual(given, expected);
}
