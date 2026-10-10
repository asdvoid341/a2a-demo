# A2A demo companion (Cloudflare Worker)

One small Worker with two jobs:

1. **CORS proxy.** Browsers block a page from calling agents that don't send CORS headers, and most A2A agents don't. `GET/POST https://<worker>/?url=<https URL>` relays the request and streams the response back (Server-Sent Events included). Only `https://` targets on public hosts are allowed.
2. **Phrasebook Agent.** A real A2A 1.0 agent on another origin, so you can try **Add agent** in the demo with something genuinely external. Its card is at `https://<worker>/.well-known/agent-card.json`. It streams, and it is stateless, so it finishes every task in one reply. It answers `GetTask` with `TaskNotFoundError`, and that is an honest answer.

## Deploy (free Cloudflare account)

```bash
cd proxy
npx wrangler login
npx wrangler deploy
```

Wrangler prints the URL, e.g. `https://a2a-demo-companion.<you>.workers.dev`.

## Use it in the demo

- **As an agent:** click **Add agent** and paste the Worker URL. Then ask *“Plan 3 days in Lisbon…”*: the host also asks the Phrasebook Agent (after you approve sending data to it).
- **As a proxy:** open **Settings**, set **CORS proxy** to the Worker URL, then tick **Go through my CORS proxy** when adding an agent that blocks browsers.

## Lock it down

Anyone who knows the URL can use an open proxy. Set `ALLOWED_ORIGINS` in `wrangler.toml` to your page's origin, e.g. `https://asdvoid341.github.io`. The proxy then refuses requests from other sites. (The Phrasebook Agent itself stays open to every page; only the proxy is restricted. This only stops other web pages: someone with curl can still set any `Origin` header. Don't put anything secret behind it.)
