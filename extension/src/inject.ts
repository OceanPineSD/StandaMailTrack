import { LIMITS } from "./limits";

/** Quoted text from earlier messages: left alone, and the pixel goes before it. */
const QUOTE = ".gmail_quote, .gmail_quote_container, blockquote";

function parseBody(html: string): HTMLElement {
  return new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, "text/html").body;
}

/** True for any image that loads one of our pixels, directly or through Gmail's proxy (`…#<origin>/p/…`). */
function isOwnPixel(img: Element, origin: string): boolean {
  const src = img.getAttribute("src") ?? "";
  let decoded = src;
  try {
    decoded = decodeURIComponent(src);
  } catch {
    // keep the raw src
  }
  return [src, decoded].some((s) => s.includes(`${origin}/p/`));
}

function removePixels(body: HTMLElement, origin: string) {
  for (const img of [...body.querySelectorAll("img")]) if (isOwnPixel(img, origin)) img.remove();
}

/** Removes every tracking pixel of ours, including copies quoted from earlier emails. */
export function stripPixels(html: string, origin: string): string {
  const body = parseBody(html);
  removePixels(body, origin);
  return body.innerHTML;
}

/** Only URLs the Worker will accept: one bad href would otherwise fail the whole register. */
function isTrackable(href: string): boolean {
  if (href.length > LIMITS.url) return false;
  try {
    const { protocol } = new URL(href);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Prepares an outgoing body: drops old pixels, adds one pixel for `id`, and points each http(s) link
 * outside quoted text at the click redirect. Returns the new html and the original URLs, in `idx` order.
 */
export function inject(html: string, { id, origin }: { id: string; origin: string }): { html: string; links: string[] } {
  const body = parseBody(html);
  removePixels(body, origin);

  const links: string[] = [];
  for (const a of body.querySelectorAll("a[href]")) {
    if (links.length >= LIMITS.links) break;
    if (a.closest(QUOTE)) continue;
    const href = a.getAttribute("href")!.trim();
    if (!/^https?:\/\//i.test(href) || !isTrackable(href) || href.startsWith(`${origin}/`)) continue;
    a.setAttribute("href", `${origin}/c/${id}/${links.length}`);
    links.push(href);
  }

  const img = body.ownerDocument.createElement("img");
  img.setAttribute("src", `${origin}/p/${id}.gif`);
  img.setAttribute("width", "1");
  img.setAttribute("height", "1");
  img.setAttribute("alt", "");
  img.setAttribute("style", "width:1px;height:1px;border:0");
  // Gmail folds quoted text behind "…", and images in the fold don't load, so stay above the first quote.
  const quote = [...body.children].find((el) => el.matches(QUOTE) || el.querySelector(QUOTE));
  if (quote?.matches(QUOTE)) body.insertBefore(img, quote);
  else if (quote) quote.querySelector(QUOTE)!.before(img);
  else body.append(img);

  return { html: body.innerHTML, links };
}

/**
 * Undoes `inject` for an attempt that never went out: points its click links back at their URLs and
 * drops our pixels, so the next attempt tracks them under its own id. Text edited since is kept.
 */
export function untrack(html: string, { id, origin, links }: { id: string; origin: string; links: string[] }): string {
  const body = parseBody(html);
  const prefix = `${origin}/c/${id}/`;
  let changed = false;
  for (const a of body.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href")!;
    if (!href.startsWith(prefix)) continue;
    const url = links[Number(href.slice(prefix.length))];
    if (url === undefined) continue;
    a.setAttribute("href", url);
    changed = true;
  }
  const pixels = [...body.querySelectorAll("img")].filter((img) => isOwnPixel(img, origin));
  pixels.forEach((img) => img.remove());
  return changed || pixels.length ? body.innerHTML : html;
}
