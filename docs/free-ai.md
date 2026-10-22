# Free AI for everyone (FreeLLMAPI)

Inner Table can run live sessions for people who have no AI account of their
own. It does this through a [FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi)
gateway that **you** host. The gateway is one OpenAI-style endpoint that sends
each request to whichever free-tier model still has room: Google AI Studio,
Groq, Cerebras, Mistral, OpenRouter's free models and so on.

```
  phone / browser                 Vercel (this repo)                 your server
 ┌───────────────┐  session token ┌──────────────────┐  gateway key  ┌────────────┐   free-tier
 │ Inner Table   │ ─────────────▶ │ api/free-ai.js   │ ────────────▶ │ FreeLLMAPI │ ─▶ providers
 │ (no API key)  │ ◀── SSE ────── │ checks sign-in,  │ ◀── SSE ───── │ (Docker)   │
 └───────────────┘                │ daily allowance  │               └────────────┘
                                  └──────────────────┘
```

- **The gateway key never reaches the browser.** It lives only in a Vercel
  environment variable. The app sends nothing but the person's signed session.
- **Only signed-in accounts can use it.** Every account gets a **daily
  allowance**, 200 messages by default, so one person cannot use up the free
  quota everyone shares. A request that fails is not counted.
- **Nothing to set up.** The app has no AI settings: sessions run on the free
  AI. People who connected their own key, or linked their Claude, ChatGPT or
  Gemini app, before this keep using it. They can disconnect it under
  **Settings → Your own AI**, which only they see.
- **People are asked once.** Before the first session on the free AI, the app
  says once where the words go. After that, sessions just start. Anyone who
  would rather not can pick copy-prompt mode on that notice, and get the
  session to paste into an AI chat they already use. Nothing goes to the free
  AI before that yes, not even the background step that writes conversations
  into profiles.
- **When it can't answer.** If the free AI is busy or someone's allowance is
  used up, the chat offers to hold the session in another AI chat instead.
  If the gateway isn't configured at all, sessions go straight to
  copy-prompt mode.

## 1. Host FreeLLMAPI

FreeLLMAPI is a long-running Node server that keeps a SQLite database on disk.
That means it **cannot run on Vercel**. Use any always-on host with a
persistent disk: a small VPS, Fly.io, Railway, or Render with a disk attached.

With Docker on a VPS:

```sh
mkdir freellmapi && cd freellmapi
curl -fsSLO https://raw.githubusercontent.com/tashfeenahmed/freellmapi/main/docker-compose.yml
cat > .env <<EOF
ENCRYPTION_KEY=$(openssl rand -hex 32)
PORT=3001
HOST_BIND=0.0.0.0
PROXY_RATE_LIMIT_RPM=600
EOF
docker compose up -d
```

- **`PROXY_RATE_LIMIT_RPM`**: the gateway limits requests per minute **per
  client IP**, 120 by default. Every Inner Table request reaches it from
  Vercel's servers, so all your users would share that one limit. Raise it.
  Inner Table already caps each account per day.
- **Put HTTPS in front of it**, for example Caddy, nginx with Let's Encrypt,
  or a Cloudflare Tunnel. The gateway key travels in a request header, so it
  must not cross the internet in plain HTTP. FreeLLMAPI binds to localhost by
  default and describes itself as single-user. Exposing it is fine only
  because its unified key guards every request and only your Vercel functions
  hold that key.

## 2. Add free provider keys

Open the gateway's dashboard at `https://your-gateway-host/` and create the
admin account. Then, on the **Keys** page, add free-tier keys from as many
providers as you like. More providers means more free capacity before
everything hits its daily cap. Caps reset at UTC midnight.

**Choose providers with your users' privacy in mind.** Profiles and
sessions here are intimate journaling. Some free tiers say they may use what
is sent to them to train or improve their models, or that people may read it.
Read each provider's free-tier terms, and leave out or disable any you are not
comfortable sending journaling to. Some free tiers also limit or forbid
serving a public app. That is between you and each provider.

Finally, copy the **unified API key** (it starts `freellmapi-`) from the
header of the Keys page.

## 3. Connect it to Inner Table

Set these on the Vercel project (Settings → Environment Variables), then
redeploy:

| Variable | What it is |
|---|---|
| `FREELLMAPI_URL` | The gateway's address, e.g. `https://llm.example.com` (with or without `/v1`) |
| `FREELLMAPI_KEY` | Its unified key, `freellmapi-…`. Mark it **Sensitive** |
| `FREELLMAPI_MODEL` | Optional. Defaults to `auto` (the gateway's fallback chain); `auto:reliable`, `auto:smart` and the other routing strategies also work |
| `FREE_AI_DAILY_LIMIT` | Optional. Messages per account per UTC day, default `200`; `0` means no cap |

The free AI also needs the account variables already described in the
README (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`,
`SESSION_SECRET`), because it is only for signed-in accounts and the daily
count lives in Upstash.

Check it:

```sh
curl https://your-app.vercel.app/api/free-ai
# {"available":true,"daily":200}
```

The next time anyone opens the app, it notices the free AI. Starting a
session with no AI of their own offers it.

## When something goes wrong

- People see plain messages, for example "Every free model is at its limit
  right now". The gateway's actual reason is logged by the function. Look in
  Vercel → the project → Logs for lines starting `free-ai: gateway answered`.
- `401` / `403` in those logs: `FREELLMAPI_KEY` doesn't match the
  gateway's unified key. The key changes if it is regenerated in the
  dashboard.
- `429` / `503` with `no_providers_configured` or `quota_exceeded`: no
  provider key has room. Add more providers, or wait for the UTC reset.
- `413`: a session's prompt is over the gateway's token budget. It carries
  the person's whole inner system, so very large systems can hit this on
  models with small context windows.

## Limits to keep in mind

- Free models are weaker than the paid Claude models the app defaults to,
  and quality dips late in the UTC day as the best ones reach their caps.
  FreeLLMAPI offers no uptime guarantee.
- FreeLLMAPI calls itself a personal, single-user tool. Here it sits behind
  your own server, which is its only client, so that holds technically. The
  free quota itself, though, is now shared by everyone who uses your app.
- Its request reservations only coordinate within one gateway process. Run
  one instance, not several replicas.
- Anyone who can reach the app can create an account. Someone determined
  could script many accounts and spend the shared free quota: the daily
  allowance limits each account, not how many accounts there are. Watch
  usage in the gateway's dashboard. Lowering `FREE_AI_DAILY_LIMIT` turns the
  free AI down at once; removing `FREELLMAPI_KEY` turns it off.
