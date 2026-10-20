import { device, place, summarize, summaryLine, timeAgo } from "./format";
import type { EmailDetail } from "./types";

interface Row {
  at: number;
  text: string;
}

function rowsOf(d: EmailDetail): Row[] {
  const where = (loc: string, ua: string | null) => [loc, device(ua)].filter(Boolean).join(" · ");
  const opens = d.opens.map((o) => ({
    at: o.at,
    text: `Opened · ${where(place({ city: o.city, country: o.country, via_proxy: o.via_proxy }), o.ua)}`,
  }));
  const clicks = d.clicks.map((c) => ({
    at: c.at,
    text: `Clicked ${c.url ?? `link ${c.link_idx + 1}`} · ${where(place({ city: c.city, country: c.country, via_proxy: false }), c.ua)}`,
  }));
  return [...opens, ...clicks].sort((a, b) => b.at - a.at);
}

/** The sidebar content for a thread's tracked emails. Everything from the Worker goes in as text. */
export function renderPanel(details: EmailDetail[], now: number, doc: Document): HTMLElement {
  const el = (tag: string, text?: string, style?: string) => {
    const e = doc.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (style) e.setAttribute("style", style);
    return e;
  };

  const root = el("div", undefined, "font:13px/1.4 sans-serif;padding:8px 12px;color:#202124");
  for (const d of [...details].sort((a, b) => b.email.sent_at - a.email.sent_at)) {
    const section = el("section", undefined, "margin-bottom:16px");
    section.append(
      el("div", d.email.subject || "(no subject)", "font-weight:600"),
      el("div", `To ${d.email.recipients.join(", ")} · sent ${timeAgo(d.email.sent_at, now)}`, "color:#5f6368;font-size:12px"),
      el("div", summaryLine(summarize(d), now), "margin:6px 0"),
    );
    const rows = rowsOf(d);
    if (!rows.length) {
      section.append(el("div", "No opens or clicks yet.", "color:#5f6368"));
    } else {
      const list = el("ul", undefined, "margin:0;padding-left:16px");
      for (const r of rows) {
        const li = el("li", undefined, "margin:2px 0;overflow-wrap:anywhere");
        li.title = new Date(r.at).toLocaleString();
        li.append(el("span", r.text), el("span", ` · ${timeAgo(r.at, now)}`, "color:#5f6368"));
        list.append(li);
      }
      section.append(list);
    }
    root.append(section);
  }
  return root;
}
