/** Same format the Worker accepts (worker/src/validate.ts). */
export const ID_RE = /^[0-9A-Za-z]{22}$/;

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const LENGTH = 22; // 62^22 ≈ 2^131 — unguessable, so ids double as capability tokens for /p and /c.
// Largest multiple of 62 below 256: bytes at or above it are rejected so every character is equally likely.
const LIMIT = 256 - (256 % ALPHABET.length);

export function newId(): string {
  let out = "";
  const buf = new Uint8Array(32);
  while (out.length < LENGTH) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < LIMIT) out += ALPHABET[b % ALPHABET.length];
      if (out.length === LENGTH) break;
    }
  }
  return out;
}
