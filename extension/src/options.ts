import { isForbiddenOrigin, parseMapping, type MappingIndex } from "./mapping";
import { send } from "./messages";
import { loadSettings, normalizeOrigin, saveSettings } from "./settings";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>("form");
const fields = {
  origin: $<HTMLInputElement>("origin"),
  token: $<HTMLInputElement>("token"),
  appId: $<HTMLInputElement>("appId"),
  trackByDefault: $<HTMLInputElement>("trackByDefault"),
  subjectPrefix: $<HTMLInputElement>("subjectPrefix"),
  campaign: $<HTMLInputElement>("campaign"),
  mapping: $<HTMLInputElement>("mapping"),
};
const status = $<HTMLParagraphElement>("status");
const mappingCount = $<HTMLSpanElement>("mappingCount");

function show(text: string, ok: boolean) {
  status.textContent = text;
  status.className = ok ? "ok" : "err";
}

async function showMappingCount() {
  const { mappingIndex } = (await chrome.storage.local.get("mappingIndex")) as { mappingIndex?: MappingIndex };
  const n = Object.keys(mappingIndex ?? {}).length;
  mappingCount.textContent = n ? `${n} recipient${n === 1 ? "" : "s"} imported.` : "";
}

loadSettings().then(async (s) => {
  fields.origin.value = s.origin;
  fields.token.value = s.token;
  fields.appId.value = s.appId;
  fields.trackByDefault.checked = s.trackByDefault;
  fields.subjectPrefix.value = s.subjectPrefix;
  fields.campaign.value = s.campaign;
  // A saved origin without its host permission breaks every Worker call with "Failed to fetch".
  if (s.origin && !(await chrome.permissions.contains({ origins: [`${s.origin}/*`] })))
    show(`Chrome hasn't granted access to ${s.origin}. Press Save and allow it.`, false);
});
void showMappingCount();

fields.mapping.addEventListener("change", () => {
  (async () => {
    const files = [...(fields.mapping.files ?? [])];
    if (!files.length) return;
    const { mappingIndex } = (await chrome.storage.local.get("mappingIndex")) as { mappingIndex?: MappingIndex };
    const merged: MappingIndex = { ...(mappingIndex ?? {}) };
    let added = 0;
    for (const file of files) {
      const parsed = parseMapping(await file.text());
      added += Object.keys(parsed).length;
      Object.assign(merged, parsed);
    }
    await chrome.storage.local.set({ mappingIndex: merged });
    await showMappingCount();
    show(added ? `Imported ${added} mapping row${added === 1 ? "" : "s"}.` : "No valid rows found in those files.", added > 0);
    fields.mapping.value = "";
  })().catch((err) => show(`Import failed: ${err}`, false));
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const origin = normalizeOrigin(fields.origin.value);
  if (!origin) return show("Worker URL must be an https:// address.", false);
  if (isForbiddenOrigin(origin))
    return show("Use your custom tracking domain, not workers.dev. Links on workers.dev trip spam warnings.", false);
  // Must run inside the click's user gesture, so it comes before any await.
  const granted = chrome.permissions.request({ origins: [`${origin}/*`] });
  (async () => {
    if (!(await granted)) return show("The extension needs permission to reach your Worker.", false);
    await saveSettings({
      origin,
      token: fields.token.value.trim(),
      appId: fields.appId.value.trim(),
      trackByDefault: fields.trackByDefault.checked,
      subjectPrefix: fields.subjectPrefix.value.trim(),
      campaign: fields.campaign.value.trim(),
    });
    fields.origin.value = origin;
    show("Saved. Checking the connection…", true);
    const reply = await send({ type: "checkConnection" });
    if (!reply.ok) return show(`Saved, but: ${reply.error}`, false);
    if (reply.state === "ok") show("Saved and connected. Reload Gmail to start tracking.", true);
    else if (reply.state === "unauthorized") show("Saved, but the Worker rejected the API token.", false);
    else show("Saved, but the Worker didn't answer. Check the URL.", false);
  })().catch((err) => show(`Error: ${err}`, false));
});
