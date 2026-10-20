import { describe, expect, it } from "vitest";
import { inject, stripPixels, untrack } from "../src/inject";

const ORIGIN = "https://t.example.workers.dev";
const ID = "A".repeat(22);
const OLD = "B".repeat(22);

function parse(html: string) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return doc.body;
}
const pixels = (html: string) =>
  [...parse(html).querySelectorAll("img")].filter((i) => i.getAttribute("src")!.includes(`${ORIGIN}/p/`));

describe("inject", () => {
  const body = [
    `<div>Hi <a href="https://a.com/?q=1&amp;r=2">site</a> and <a href="mailto:bob@x.com">mail</a>`,
    ` and <a href="javascript:alert(1)">bad</a> and <a href="${ORIGIN}/c/${OLD}/0">tracked</a></div>`,
    `<img src="${ORIGIN}/p/${OLD}.gif" width="1" height="1">`,
    `<div class="gmail_quote">On Mon wrote:<blockquote><a href="https://quoted.com/">q</a>`,
    `<img src="https://ci3.googleusercontent.com/meips/x#${ORIGIN}/p/${OLD}.gif"></blockquote></div>`,
  ].join("");

  it("C8: one new pixel, old ones removed, only the http link outside quotes rewritten", () => {
    const out = inject(body, { id: ID, origin: ORIGIN });
    const px = pixels(out.html);
    expect(px.map((i) => i.getAttribute("src"))).toEqual([`${ORIGIN}/p/${ID}.gif`]);
    expect(out.links).toEqual(["https://a.com/?q=1&r=2"]);

    const hrefs = [...parse(out.html).querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      `${ORIGIN}/c/${ID}/0`,
      "mailto:bob@x.com",
      "javascript:alert(1)",
      `${ORIGIN}/c/${OLD}/0`,
      "https://quoted.com/",
    ]);
  });

  it("puts the pixel before quoted text so Gmail's trimmed-content fold can't hide it", () => {
    const out = inject(body, { id: ID, origin: ORIGIN });
    const b = parse(out.html);
    const px = pixels(out.html)[0];
    const quote = b.querySelector(".gmail_quote")!;
    const pxInDoc = [...b.querySelectorAll("img")].find((i) => i.getAttribute("src") === px.getAttribute("src"))!;
    expect(pxInDoc.compareDocumentPosition(quote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("appends the pixel when there is no quote", () => {
    const out = inject("<div>hello</div>", { id: ID, origin: ORIGIN });
    expect(parse(out.html).lastElementChild!.getAttribute("src")).toBe(`${ORIGIN}/p/${ID}.gif`);
    expect(out.links).toEqual([]);
  });

  it("C8: re-injecting the output with the same id leaves the html unchanged", () => {
    const once = inject(body, { id: ID, origin: ORIGIN });
    const twice = inject(once.html, { id: ID, origin: ORIGIN });
    expect(twice.html).toBe(once.html);
  });

  it("stops tracking links past the worker's limits instead of failing the register", () => {
    const many = Array.from({ length: 205 }, (_, i) => `<a href="https://a.com/${i}">x</a>`).join("");
    const long = `<a href="https://a.com/${"z".repeat(2100)}">long</a>`;
    const out = inject(long + many, { id: ID, origin: ORIGIN });
    expect(out.links).toHaveLength(200);
    expect(out.links[0]).toBe("https://a.com/0");
    expect(parse(out.html).querySelector("a")!.getAttribute("href")).toMatch(/^https:\/\/a\.com\/z+$/);
  });
});

describe("inject: unparseable links", () => {
  it("F1: leaves links the Worker would reject untouched instead of failing the whole register", () => {
    const html = `<a href="http://">empty</a><a href="https://exa mple.com/">space</a><a href="https://ok.com/">ok</a>`;
    const out = inject(html, { id: ID, origin: ORIGIN });
    expect(out.links).toEqual(["https://ok.com/"]);
    expect([...parse(out.html).querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      "http://",
      "https://exa mple.com/",
      `${ORIGIN}/c/${ID}/0`,
    ]);
  });
});

describe("untrack", () => {
  it("F2/F3: undoes an earlier attempt: its links point back at their URLs and its pixel is gone", () => {
    const first = inject(`<p><a href="https://a.com/">a</a> <a href="https://b.com/">b</a></p>`, { id: OLD, origin: ORIGIN });
    const edited = first.html + `<p>P.S. <a href="https://c.com/">c</a></p>`;
    const back = untrack(edited, { id: OLD, origin: ORIGIN, links: first.links });
    expect(pixels(back)).toEqual([]);
    expect([...parse(back).querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      "https://a.com/",
      "https://b.com/",
      "https://c.com/",
    ]);
    // Re-tracking under a new id then counts every click for that id.
    const again = inject(back, { id: ID, origin: ORIGIN });
    expect(again.links).toEqual(["https://a.com/", "https://b.com/", "https://c.com/"]);
  });

  it("leaves other emails' tracked links alone", () => {
    const html = `<a href="${ORIGIN}/c/${ID}/0">x</a>`;
    expect(untrack(html, { id: OLD, origin: ORIGIN, links: ["https://a.com/"] })).toBe(html);
  });
});

describe("stripPixels", () => {
  it("removes every own-origin pixel, including proxied ones, and nothing else", () => {
    const html = `<p>x</p><img src="${ORIGIN}/p/${OLD}.gif"><img src="https://img.com/a.png"><img src="https://ci3.googleusercontent.com/m#${ORIGIN}/p/${OLD}.gif">`;
    const out = parse(stripPixels(html, ORIGIN));
    expect([...out.querySelectorAll("img")].map((i) => i.getAttribute("src"))).toEqual(["https://img.com/a.png"]);
  });
});
