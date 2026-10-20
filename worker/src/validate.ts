import { HttpError } from "./http";

export const ID_RE = /^[0-9A-Za-z]{22}$/;

export const LIMITS = {
  subject: 500,
  recipients: 100,
  recipient: 320,
  links: 200,
  url: 2048,
  threadIds: 500,
  externalId: 200,
  selfViewIds: 100,
};

export function isId(value: unknown): value is string {
  return typeof value === "string" && ID_RE.test(value);
}

function bad(message: string): never {
  throw new HttpError(400, message);
}

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > LIMITS.url) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export interface NewEmail {
  id: string;
  subject: string;
  recipients: string[];
  links: string[];
}

export function parseNewEmail(body: Record<string, unknown>): NewEmail {
  const { id, subject = "", recipients = [], links = [] } = body;
  if (!isId(id)) bad("invalid id");
  if (typeof subject !== "string" || subject.length > LIMITS.subject) bad("invalid subject");
  if (
    !Array.isArray(recipients) ||
    recipients.length > LIMITS.recipients ||
    !recipients.every((r) => typeof r === "string" && r.length <= LIMITS.recipient)
  )
    bad("invalid recipients");
  if (!Array.isArray(links) || links.length > LIMITS.links || !links.every(isHttpUrl)) bad("invalid links");
  return { id, subject, recipients: recipients as string[], links: links as string[] };
}

/** An optional opaque Gmail id (thread or message): absent, null, or a short string. */
export function optionalExternalId(value: unknown, name: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || value.length === 0 || value.length > LIMITS.externalId) bad(`invalid ${name}`);
  return value;
}

export function parseIdList(value: unknown, max: number): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max || !value.every(isId)) bad("invalid ids");
  return value as string[];
}
