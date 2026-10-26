import * as InboxSDK from "@inboxsdk/core";
import type { ComposeView } from "@inboxsdk/core";
import { createBatcher } from "./batcher";
import { badgeLabel } from "./format";
import { newId } from "./ids";
import { inject, stripPixels, untrack } from "./inject";
import { LIMITS } from "./limits";
import { send } from "./messages";
import { renderPanel } from "./panel";
import { trackedIds } from "./proxyIds";
import { ID_RE } from "./ids";
import { campaignFor, shouldTrack, type MappingIndex } from "./mapping";
import { DEFAULTS, type Settings } from "./settings";
import type { EmailDetail, EmailSummary } from "./types";

/** Self views of the same email closer than this are one view (Gmail re-renders messages). */
const SELF_VIEW_GAP_MS = 30_000;
/** Detail lookups per opened thread. */
const PANEL_EMAILS = 10;

type Sdk = Awaited<ReturnType<typeof InboxSDK.load>>;

/** Covers the background's own 3s register timeout plus messaging overhead. */
const REGISTER_DEADLINE_MS = 3_500;

// Eye icon for the compose toolbar button.
const ICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#5f6368" stroke-width="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
)}`;

/** Everything setupCompose needs; the content script never reads the API token, only the background does. */
interface ComposeConfig {
  origin: string;
  appId: string;
  trackByDefault: boolean;
  subjectPrefix: string;
  campaign: string;
  mappingIndex: MappingIndex;
}

async function loadPublicSettings(): Promise<ComposeConfig> {
  const keys = ["origin", "appId", "trackByDefault", "subjectPrefix", "campaign", "mappingIndex"] as const;
  const s = (await chrome.storage.local.get([...keys])) as Partial<Settings> & { mappingIndex?: MappingIndex };
  return {
    origin: s.origin ?? "",
    appId: s.appId ?? "",
    trackByDefault: s.trackByDefault ?? DEFAULTS.trackByDefault,
    subjectPrefix: s.subjectPrefix ?? DEFAULTS.subjectPrefix,
    campaign: s.campaign ?? DEFAULTS.campaign,
    mappingIndex: s.mappingIndex ?? {},
  };
}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms))]);
}

function recipientsOf(cv: ComposeView): string[] {
  const all = [...cv.getToRecipients(), ...cv.getCcRecipients(), ...cv.getBccRecipients()];
  return [...new Set(all.map((c) => c.emailAddress.trim()).filter((e) => e && e.length <= LIMITS.recipientLength))].slice(
    0,
    LIMITS.recipients,
  );
}

function setupCompose(sdk: Sdk, cv: ComposeView, cfg: ComposeConfig) {
  const { origin, trackByDefault, subjectPrefix, campaign, mappingIndex } = cfg;
  // null = follow the subject prefix / default; true or false = the user's explicit toggle.
  let manual: boolean | null = null;
  const effective = () => {
    let subject = "";
    try {
      subject = cv.getSubject() ?? "";
    } catch {
      // some compose states (e.g. replies before render) can throw; treat as no subject
    }
    return shouldTrack(manual, subject, subjectPrefix, trackByDefault);
  };
  // Fresh per attempt: links are stored by position, so an edit after a blocked send must not reuse an id.
  let emailId: string | null = null;
  let tracked = false; // the body that went out carries our pixel
  let resending = false; // our own cv.send() after the register round-trip
  // The tracked body of an attempt that is in the compose but hasn't gone out (Gmail may still block it).
  let pending: { id: string; links: string[] } | null = null;

  const bar = cv.addStatusBar({ height: 22 });
  const render = () => {
    const on = effective();
    bar.el.textContent = on ? "👁 Tracking opens and clicks" : "Tracking off for this email";
    bar.el.style.cssText = `font:12px/22px sans-serif;padding:0 12px;color:${on ? "#188038" : "#5f6368"}`;
  };
  render();
  // The subject prefix can turn tracking on while the user types; keep the bar honest.
  const refresh = setInterval(() => {
    if (manual === null) render();
  }, 1_500);
  cv.on("destroy", () => clearInterval(refresh));
  cv.addButton({
    title: "Toggle email tracking",
    iconUrl: ICON,
    type: "MODIFIER",
    onClick: () => {
      manual = !effective();
      render();
    },
  });

  cv.on("presending", (event) => {
    if (resending) return; // let our own send through
    let current = cv.getHTMLContent();
    if (pending) {
      // Gmail blocked the last attempt: undo its links and pixel so they aren't counted under a dead id.
      current = untrack(current, { ...pending, origin });
      pending = null;
    }
    emailId = null;
    tracked = false;
    if (!effective()) {
      // Never forward someone else's pixel of ours from quoted text.
      cv.setBodyHTML(stripPixels(current, origin));
      return;
    }

    // Per-recipient tracking only works with exactly one recipient.
    const to = cv.getToRecipients();
    if (to.length !== 1 || cv.getCcRecipients().length || cv.getBccRecipients().length) {
      event.cancel();
      cv.setBodyHTML(current);
      sdk.ButterBar.showMessage({
        text: "Tracking needs exactly one To and no Cc or Bcc. Not sent. Toggle tracking off to send untracked.",
        time: 8_000,
      });
      return;
    }

    event.cancel();
    const rcpt = to[0].emailAddress.trim().toLowerCase();
    const entry = mappingIndex[rcpt];
    const id = entry && ID_RE.test(entry.id) ? entry.id : newId();
    const { html, links } = inject(current, { id, origin });
    const subject = cv.getSubject() ?? "";
    const email = {
      id,
      subject: campaignFor(entry, campaign, subject, subjectPrefix).slice(0, LIMITS.subject),
      // An imported mapping keeps the address off the server; otherwise the real address is stored.
      recipients: entry ? [entry.pseudonym] : recipientsOf(cv),
      links,
    };

    withDeadline(send({ type: "register", email }), REGISTER_DEADLINE_MS)
      .then((reply) => {
        if (!reply?.ok) throw new Error(reply?.error ?? "no reply");
        cv.setBodyHTML(html);
        emailId = id;
        tracked = true;
        pending = { id, links };
        resending = true;
        try {
          cv.send();
        } catch (e) {
          // The compose was closed while we waited on the Worker; the draft keeps the body.
          console.warn("[standamailtrack] couldn't resend:", e);
        }
        // If Gmail blocks the send (e.g. no recipients), the next click must go through presending again.
        setTimeout(() => (resending = false), 2_000);
      })
      .catch((e: unknown) => {
        // Fail safe: never send half-tracked or untracked by accident. The draft stays as it was.
        console.warn("[standamailtrack] register failed, send blocked:", e);
        try {
          cv.setBodyHTML(current);
        } catch {
          return; // the compose is gone
        }
        sdk.ButterBar.showMessage({
          text: `Tracking failed (${String((e as Error)?.message ?? e)}). Not sent; the draft is unchanged.`,
          time: 8_000,
        });
      });
  });
  cv.on("sendCanceled", () => {
    resending = false;
  });

  cv.on("sent", async (event) => {
    pending = null;
    if (!tracked || !emailId) return;
    try {
      const [thread_id, message_id] = await Promise.all([event.getThreadID(), event.getMessageID()]);
      await send({ type: "patch", id: emailId, thread_id, message_id });
    } catch (e) {
      console.warn("[standamailtrack] couldn't record thread id:", e);
    }
  });
}

async function ask<T>(msg: Parameters<typeof send>[0]): Promise<T> {
  const reply = await send(msg);
  if (!reply?.ok) throw new Error(reply?.error ?? "no reply");
  return reply.data as T;
}

/** Thread id -> its tracked emails, one batched /api/threads call per burst of rendered rows. */
const threads = createBatcher<EmailSummary[]>(
  async (ids) => (await ask<{ threads: Record<string, EmailSummary[]> }>({ type: "threads", ids })).threads,
  { max: 100 },
);

function setupThreadRow(row: InboxSDK.ThreadRowView) {
  row
    .getThreadIDIfStableAsync()
    .then(async (tid) => {
      if (!tid) return;
      const badge = badgeLabel((await threads.get(tid)) ?? []);
      if (badge && !row.destroyed) row.addLabel(badge);
    })
    .catch((e) => console.warn("[standamailtrack] badge failed:", e));
}

const lastSelfView = new Map<string, number>();

/** You reading your own tracked email (or a reply quoting it) loads its pixel too; tell the Worker it was you. */
async function reportSelfView(mv: InboxSDK.MessageView, origin: string) {
  let ids: string[] = [];
  try {
    const srcs = [...mv.getBodyElement().querySelectorAll("img")].map((img) => img.getAttribute("src") ?? "");
    const now = Date.now();
    ids = trackedIds(srcs, origin)
      .filter((id) => now - (lastSelfView.get(id) ?? 0) > SELF_VIEW_GAP_MS)
      .slice(0, 100);
    if (!ids.length) return;
    for (const id of ids) lastSelfView.set(id, now);
    await ask({ type: "selfViews", ids });
  } catch (e) {
    for (const id of ids) lastSelfView.delete(id); // let the next view retry
    console.warn("[standamailtrack] self view failed:", e);
  }
}

async function setupThreadView(tv: InboxSDK.ThreadView) {
  const tid = await tv.getThreadIDAsync();
  threads.forget(tid); // the panel should show the latest counts
  const emails = ((await threads.get(tid)) ?? []).slice(-PANEL_EMAILS);
  if (!emails.length || tv.destroyed) return;

  const el = document.createElement("div");
  const load = async () => {
    const details = await Promise.all(emails.map((e) => ask<EmailDetail>({ type: "email", id: e.id }).catch(() => null)));
    const ok = details.filter((d): d is EmailDetail => d !== null);
    const refresh = document.createElement("button");
    refresh.textContent = "Refresh";
    refresh.setAttribute("style", "margin:8px 12px 0;font:12px sans-serif");
    refresh.onclick = () => void load();
    el.replaceChildren(refresh, ok.length ? renderPanel(ok, Date.now(), document) : document.createTextNode("Couldn't load tracking."));
  };
  await load();
  if (!tv.destroyed) tv.addSidebarContentPanel({ el, title: "StandaMailTrack", iconUrl: chrome.runtime.getURL("icon.svg") });
}

async function main() {
  const cfg = await loadPublicSettings();
  if (!cfg.origin || !cfg.appId) {
    console.info("[standamailtrack] not set up; open the extension's options page.");
    return;
  }
  const { origin, appId } = cfg;
  const sdk = await InboxSDK.load(2, appId);
  sdk.Compose.registerComposeViewHandler((cv) => setupCompose(sdk, cv, cfg));
  sdk.Lists.registerThreadRowViewHandler(setupThreadRow);
  sdk.Conversations.registerMessageViewHandler((mv) => void reportSelfView(mv, origin));
  sdk.Conversations.registerThreadViewHandler((tv) => {
    setupThreadView(tv).catch((e) => console.warn("[standamailtrack] panel failed:", e));
  });
}

main().catch((e) => console.error("[standamailtrack] failed to start", e));
