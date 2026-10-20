# email-tracker

A free, personal, Streak-style open & click tracker for emails you send from Gmail.

- **`worker/`** – Cloudflare Worker + D1. Serves the tracking pixel, redirects tracked links, and exposes a
  token-protected API with your stats.
- **`extension/`** – Chrome (MV3) extension, loaded unpacked. It hooks Gmail's compose window via
  [InboxSDK](https://www.inboxsdk.com/), adds the pixel, rewrites links, and shows opens and clicks in Gmail.

Everything fits in free tiers (Cloudflare Workers/D1 free plan, InboxSDK free app id).

## Status

Built in phases. See the PRs.

| Phase | What |
|---|---|
| P0 | Repo scaffold (workspaces, tests, build) |
| P1 | Worker: pixel, click redirect, API |
| P2 | Extension: tracked sending |
| P3 | Extension: Sent badges + details sidebar |
| P4 | Notifications + full setup guide |

## Development

```bash
npm install
npm test          # all workspaces
npm run typecheck
npm run build -w extension
```

## Limitations

Open tracking means "probably opened," not "definitely read." Gmail fetches images through Google's proxy, so a
Gmail recipient's location isn't visible (link clicks do show it). Apple Mail may pre-load images. One email
equals one pixel, so emails with several recipients can only show "someone opened."

## License

MIT
