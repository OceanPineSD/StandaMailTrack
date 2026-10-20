import { send } from "./messages";
import { loadSettings, normalizeOrigin, saveSettings } from "./settings";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>("form");
const fields = {
  origin: $<HTMLInputElement>("origin"),
  token: $<HTMLInputElement>("token"),
  appId: $<HTMLInputElement>("appId"),
  trackByDefault: $<HTMLInputElement>("trackByDefault"),
};
const status = $<HTMLParagraphElement>("status");

function show(text: string, ok: boolean) {
  status.textContent = text;
  status.className = ok ? "ok" : "err";
}

loadSettings().then((s) => {
  fields.origin.value = s.origin;
  fields.token.value = s.token;
  fields.appId.value = s.appId;
  fields.trackByDefault.checked = s.trackByDefault;
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const origin = normalizeOrigin(fields.origin.value);
  if (!origin) return show("Worker URL must be an https:// address.", false);
  // Must run inside the click's user gesture, so it comes before any await.
  const granted = chrome.permissions.request({ origins: [`${origin}/*`] });
  (async () => {
    if (!(await granted)) return show("The extension needs permission to reach your Worker.", false);
    await saveSettings({
      origin,
      token: fields.token.value.trim(),
      appId: fields.appId.value.trim(),
      trackByDefault: fields.trackByDefault.checked,
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
