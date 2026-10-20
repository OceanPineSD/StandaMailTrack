/** Mirrors worker/src/validate.ts LIMITS so a register request is never rejected. */
export const LIMITS = {
  subject: 500,
  recipients: 100,
  recipientLength: 320,
  links: 200,
  url: 2048,
} as const;
