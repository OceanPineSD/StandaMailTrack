# email-tracker

A free, self-hosted, Streak-style open and click tracker for emails you send from Gmail in desktop Chrome.

You run your own copy: a tiny Cloudflare Worker stores the data, and a Chrome extension you load yourself adds the tracking.
There are no third-party servers, no accounts with us, and no subscription. It all fits in free tiers.

```
 Gmail (your Chrome)                     Cloudflare (your account, free)
 ┌──────────────────────────┐            ┌────────────────────────────────┐
 │ extension                │  register  │ Worker  ── D1 (SQLite)         │
 │  • adds pixel + links    │ ─────────▶ │  /p/<id>.gif   pixel           │
 │  • Sent badges, sidebar  │  stats     │  /c/<id>/<n>   link redirect   │
 │  • notifications         │ ◀───────── │  /api/*        token-protected │
 └──────────────────────────┘            └────────────────────────────────┘
                                             ▲ recipient opens / clicks
```

## Features

- **Sent-list badges.** Tracked threads show `✓` (sent, not opened) or `✓✓ N` (opened N times).
- **Thread sidebar.** Open a tracked thread and click the eye icon on the right. You'll see every open and click, with
  time, rough place (the city, or "via Gmail") and device.
- **Desktop notifications.** "bob@x.com opened your email" or "Someone clicked a link" arrive about 1–2 minutes after
  it happens.
- **A Track toggle in compose.** Turn tracking off for a single email, and set the default in the options.
- **Your own views are ignored.** Opens right after sending, your own reading in Gmail, and replies that quote
  your email are not counted.

## Before you start

You need:

| What | Why | Cost |
|---|---|---|
| [Node.js](https://nodejs.org/) 22 or newer (`node -v`) | build tools | free |
| [Git](https://git-scm.com/) | to clone the repo | free |
| A [Cloudflare account](https://dash.cloudflare.com/sign-up) | hosts the Worker and database | free plan |
| An [InboxSDK](https://www.inboxsdk.com/) app id | lets the extension hook into Gmail | free |
| Desktop Google Chrome | runs the extension | free |

Setup takes about 15 minutes. You don't need a credit card.

## Setup

### 1. Get the code

```bash
git clone https://github.com/sagarrajak245/email-tracker.git
cd email-tracker
npm install
```

(Or fork it first and clone your fork if you want to make changes.)

### 2. Create your database

Every command in steps 2–4 runs **inside `worker/`**, because wrangler reads `worker/wrangler.jsonc` from there.

```bash
cd worker
npx wrangler login
npx wrangler d1 create email-tracker
```

`wrangler login` opens your browser so you can sign in to Cloudflare. `d1 create` prints a block containing a
`database_id`.

Open `worker/wrangler.jsonc` and **replace the `database_id` value with yours**. The one in the repo belongs to the
author's account and won't work for you:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "email-tracker",
    "database_id": "<paste yours here>",
    "migrations_dir": "migrations"
  }
]
```

Create the tables:

```bash
npx wrangler d1 migrations apply email-tracker --remote
```

### 3. Deploy the Worker

```bash
npx wrangler deploy
```

On your first deploy, Cloudflare may ask you to pick a `workers.dev` subdomain. Then it prints your Worker's URL, for
example `https://email-tracker.<your-subdomain>.workers.dev`. **Save this URL.**

Check it works: open `https://email-tracker.<your-subdomain>.workers.dev/p/x.gif` in a browser. You should see a
blank page, which is the invisible 1×1 image.

### 4. Set your API token

The token is the password between the extension and your Worker. Generate a long random one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy what it prints, then store it in the Worker. Wrangler asks you to paste the value:

```bash
npx wrangler secret put API_TOKEN
```

Keep the token somewhere safe, like a password manager. You'll paste it into the extension in step 6. Never commit it.

### 5. Get an InboxSDK app id

Go to [inboxsdk.com](https://www.inboxsdk.com/) and register a free app (look for "Get App ID" or
"Register"). You'll get an id that starts with `sdk_`.

### 6. Build and load the extension

Go back to the repo root:

```bash
cd ..
npm run build -w extension
```

1. In Chrome, open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the **`extension/dist`** folder.
4. On the extension's card, click **Details → Extension options**. Fill in:
   - **Worker URL**: the URL from step 3;
   - **API token**: the token from step 4;
   - **InboxSDK app ID**: the `sdk_…` id from step 5.
5. Click **Save**. Chrome asks to allow access to your Worker; allow it. The page should say **"Saved and connected"**.
6. Reload any open Gmail tabs.

Done. Compose an email in Gmail and you'll see the **Track** toggle.

### 7. Try it

Send a tracked email to an address you read **on another device or in another browser**, such as your phone. Don't use a
second Gmail account in this same Chrome profile: the extension blocks every Gmail tab in this profile from loading
your pixel, so your own views don't count, and that block also covers other accounts.

Open the email there and click a link in it. Within about 2 minutes:
- the Sent badge reads `✓✓ 1`;
- the thread's sidebar lists the open and the click;
- a desktop notification pops up.

## Updating

```bash
git pull
npm install
npm run build -w extension
```

Then click the ⟳ reload icon on the extension's card in `chrome://extensions`. If `worker/` changed, also run
the following from `worker/`:

```bash
npx wrangler d1 migrations apply email-tracker --remote
npx wrangler deploy
```

## Rotating the token

From `worker/`, run `npx wrangler secret put API_TOKEN` with a new random value. Then paste the new value into the extension's
options and save.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `wrangler` says "Missing entry-point" or "Worker name missing" | You ran it from the repo root. `cd worker` first. |
| `d1 migrations apply` fails with "database not found" | `database_id` in `worker/wrangler.jsonc` isn't yours (step 2). |
| Options page says **unauthorized** | The token in the options doesn't match the `API_TOKEN` secret. Set it again (step 4). |
| Options page says **unreachable** | Check the Worker URL is `https://…workers.dev` with no path, and that you allowed the permission prompt. |
| No Track toggle in Gmail | Reload the Gmail tab. Check the app id is set. In Gmail press F12 and look for `[email-tracker]` messages in the Console. |
| Opens never show up | Did the recipient's mail app load images? Many block them until "Show images". Opens in this Chrome profile are ignored on purpose (step 7). |
| No notifications | Allow notifications for Chrome in your OS settings (Windows: Settings → System → Notifications; macOS: System Settings → Notifications). |
| Badges/sidebar stopped working after a Gmail update | InboxSDK may need a newer version: bump `@inboxsdk/core` in `extension/package.json`, then rebuild. |

## Limitations

Open tracking means "probably opened", not "definitely read". Streak and similar tools work the same way.

- **One email = one pixel.** With several recipients (To or Cc), it can only say "someone opened". A person is
  named only when there's exactly one recipient.
- **Gmail recipients' locations are hidden.** Gmail fetches images through Google's proxy, so their opens say "via
  Gmail". Link clicks and opens in other mail apps show the city and device.
- **Counts are a lower bound.** Gmail's proxy caches images, so repeat opens may not reach the Worker.
- **Some opens are false.** Apple Mail Privacy Protection and corporate link scanners can pre-load images and links.
- **Your other devices count as recipients.** Reading your sent email on your phone (no extension) looks like a recipient open.
- **Only the Gmail web UI is covered.** Mail sent from the Gmail mobile app or other clients isn't tracked.
- **Notifications can be missed.** Chrome must be running. A backlog arrives folded on the next poll. Rarely, a
  notification fires for an open that later turns out to be your own view.
- **Deliverability.** A `*.workers.dev` link domain can look spammy to some filters. Adding a
  [custom domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) to the Worker helps.

## Privacy and responsible use

All data lives in **your** Cloudflare account: the email subject, recipient addresses, open and click times, rough city,
and user agent. Nobody else, including the author, can see it. Anyone with your API token can read it, so keep
the token private.

Tracking pixels are common in marketing email, but people may not expect them in personal mail, and some laws (such as
GDPR or ePrivacy) may require consent depending on where you and your recipients are. Use it responsibly. You can turn tracking off
for any single email.

## How it works

1. When you click Send, the extension cancels the send. It gives the email a random 22-character id, adds a
   1×1 pixel (`/p/<id>.gif`), rewrites links to `/c/<id>/<n>` and registers the email with the Worker.
   Then it sends. If registering fails, the email goes out untracked and you see a notice.
2. A pixel hit is logged in D1 as an open, and a link hit as a click. Hits from the same browser within a minute are deduped,
   and each email is capped at 60 opens per hour.
3. Opens within 15 s of sending, and within ±60 s of you viewing the thread yourself, are ignored when stats are
   read. Because this happens at read time, a late "that was me" still corrects the counts.
4. The extension's background service worker is the only part that holds the API token. It answers the Gmail page
   and polls `/api/events` every minute for notifications.

### Project layout

```
worker/      Cloudflare Worker (TypeScript) + D1 migrations
  src/       index.ts (routes) · track.ts (pixel/click) · api.ts (stats API) · auth.ts · validate.ts
extension/   Chrome MV3 extension (TypeScript, InboxSDK, esbuild)
  src/       content.ts (Gmail UI) · background.ts (API, alarms, notifications) · options.ts
  static/    manifest.json, options.html, icons
```

## Development

```bash
npm install
npm test                    # all workspaces (Worker tests run in a local workerd)
npm run typecheck
npm run build -w extension  # outputs extension/dist
cd worker && npx wrangler dev   # local Worker; put API_TOKEN=... in worker/.dev.vars
```

Contributions are welcome. Open an issue or a PR. Please keep logic in small, tested modules (see
`extension/src/*.ts` and `extension/test/`) and run `npm test` and `npm run typecheck` before opening a PR.

## License

[MIT](LICENSE)
