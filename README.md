# StandaMailTrack

Self-hosted email open and click tracking for Gmail senders. You own the data, the domain, and the logs.

A fork of [Argus](https://github.com/sagarrajak245/Argus) by [sagar rajak](https://github.com/sagarrajak245), MIT licensed. The worker, the suppression logic, and the Chrome extension are his work. This fork adds a CSV export endpoint, a mail-merge snippet script that keeps recipient addresses off the server, and this README.

It runs as a single Cloudflare Worker with a D1 database, on the free tier. No vendor reads your mailbox. No shared redirect domain touches your links.

## Read this before you trust the numbers

**Opens are inflated.** Apple Mail Privacy Protection and Gmail's image proxy fetch tracking pixels without a human looking. Corporate link scanners do the same to links. Treat an "open" as "delivered and rendered", nothing more. Clicks and replies are the real signal.

**The counts are also a lower bound.** Gmail caches images, so repeat opens often never reach your worker. Both errors are real. Do not quote open rates as if they were read rates.

## Deliverability rules this tool depends on

Tracking pixels and rewritten links make spam filters look harder at you. The tool only works if your sending setup holds up:

- Send from your own domain. Set SPF, DKIM, and DMARC first.
- Host the tracker on a subdomain of that same sending domain. A `workers.dev` URL in links looks worse to filters.
- Ramp a new domain at 20 to 30 emails a day for two weeks before real volume.
- Watch Google Postmaster Tools. Keep the spam rate under 0.1 percent. Never let it pass 0.3 percent.

## What gets logged, and what never does

Everything lives in a D1 database inside your own Cloudflare account, behind your API token.

Logged per event: a 22-character id, open or click, the clicked destination, timestamp, user agent, and coarse geo (city, region, country). Gmail proxy fetches are flagged and their geo is dropped.

Never logged: raw IP addresses, message content, link parameters beyond the registered URL.

Recipient addresses depend on which path you use:

- **Mail-merge script path:** the server stores a pseudonym like `anon-3kF9q2LmXe`. Your real recipient list stays in a local `mapping.csv` on your machine. The server never sees an address.
- **Chrome extension path:** the extension registers the real recipient addresses from the compose window into your D1. Still your account, your token, nobody else's eyes. Skip the extension if you want zero addresses server-side.

Redirects are allow-listed. The worker only forwards to URLs registered for that exact email, so it cannot be abused as an open redirect.

Tracking pixels are normal in marketing email. People may not expect them in personal mail, and consent laws such as GDPR may apply. Use this responsibly.

## Setup

You need Node 18+ and a free Cloudflare account.

```bash
git clone https://github.com/OceanPineSD/StandaMailTrack
cd StandaMailTrack/worker
npm ci
npx wrangler login
npm run deploy
```

`npm run deploy` finds or creates your D1 database, writes a gitignored local config with its id, runs migrations, and deploys. Run it again any time. The deploy prints your worker URL.

Then set your API token (pick a long random string and keep it somewhere safe):

```bash
npm run secret
```

Add a custom domain to the worker in the Cloudflare dashboard, on a subdomain of your sending domain. See the deliverability rules above for why.

## Sending a tracked batch (mail merge)

Put your recipients in a CSV with `email`, `campaign`, and optionally `name` columns. Then:

```bash
node scripts/snippets.mjs generate \
  --csv recipients.csv \
  --base https://track.yourdomain.com \
  --token YOUR_API_TOKEN \
  --secret ANY_LONG_RANDOM_STRING \
  --links "https://www.linkedin.com/in/you/,https://yourdomain.com" \
  --out out/
```

This registers each recipient under a pseudonym and writes one HTML snippet per person into `out/`. Paste a snippet at the bottom of that person's email, in a client that sends HTML. It holds the tracked links and the pixel. `out/mapping.csv` maps ids back to addresses. Keep it local.

The `--secret` makes ids deterministic. The same secret, campaign, and address always give the same id, so re-runs are safe.

## Reading the results

Pull every counted open and click as CSV:

```bash
curl -H "Authorization: Bearer YOUR_API_TOKEN" https://track.yourdomain.com/api/export.csv > export.csv
```

Then join it back to real recipients, locally:

```bash
node scripts/snippets.mjs join --export export.csv --mapping out/mapping.csv --out report.csv
```

`report.csv` has one row per event with email, name, campaign, event type, destination, and time.

## Optional: an email digest of results

The worker can email you a summary on a schedule. It runs on a daily cron and sends through [Resend](https://resend.com) (free tier is plenty). A digest only goes out when the window had activity. It lists opens by campaign, clicks by link, and the latest events.

Set it up once:

1. Create a free Resend account and copy an API key.
2. Add the key to the worker: `npx wrangler secret put RESEND_API_KEY` (from `worker/`).
3. Configure and enable it:

```bash
curl -X PUT https://your-worker-url/api/settings \
  -H "Authorization: Bearer YOUR_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"digest_enabled":"1","digest_every_days":"1","digest_to":"you@yourdomain.com"}'
```

`digest_every_days` accepts 1 to 30. Until you verify your domain in Resend, digests come from Resend's onboarding address, which only delivers to your own Resend account email. After verifying, set `digest_from` to an address on your domain the same way.

## Optional: check marks and send-time tracking inside Gmail

The Chrome extension hooks Gmail's Send. When tracking is on it rewrites every link to your
tracker, adds the pixel, and registers the recipient, all at send time. The rules it enforces:

- Tracking is off by default. It turns on when the subject starts with your configured prefix,
  or when you flip the per-compose toggle. The toggle always wins.
- Tracked sends need exactly one To and no Cc or Bcc, or the send is blocked with a message.
- Gmail's expiring google.com/url link wrappers are unwrapped before rewriting.
- Links already on your tracker are never double-wrapped, and only one pixel is ever attached.
- If the Worker can't be reached, the send is blocked and the draft stays unchanged. It never
  sends half-tracked.
- Import your mapping.csv files in the options page and known recipients reuse their id and
  pseudonym, so their address stays off the server. Unknown recipients register with their
  real address (see the privacy section).

Extension adapted from [Argus](https://github.com/sagarrajak245/Argus) by sagarrajak245, MIT.
It needs a free [InboxSDK](https://register.inboxsdk.com) app id. Build and load it:

```bash
cd extension
npm ci
npm run build
```

Then load `extension/dist` as an unpacked extension in Chrome and fill in your worker URL, API token, and InboxSDK app id in its options. The extension talks only to the worker origin you type in. InboxSDK itself is a third-party library and may report errors and usage to its maker.

## How opens are counted

The worker ignores opens in the first 15 seconds after send, suppresses hits near your own views of the thread (reported by the extension), dedupes repeats within a minute, and caps events per email per hour. Multi-recipient emails share one pixel, so a named "who opened" only exists for single-recipient sends. Details are in the upstream [Argus README](https://github.com/sagarrajak245/Argus#readme).

## License

MIT. Upstream copyright sagar rajak, fork changes copyright Tung Nguyen. See [LICENSE](LICENSE).
