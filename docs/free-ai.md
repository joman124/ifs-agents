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
  allowance**, 500 messages by default, so one person cannot use up the free
  quota everyone shares. A request that fails is not counted.
- **A model that can't take a request passes it on.** Inner Table tries the
  models you list in `FREELLMAPI_MODEL` in order, and the gateway's own
  routing last. A model too small for the request, or at its per-minute
  limit, hands it to the next one instead of failing the person. See *How a
  request is routed* below.
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
That means it **cannot run on Vercel**: it needs an always-on host with a
persistent disk. **Railway** (option A) is the easiest. It takes clicks in a
browser, with no terminal and no server to look after, and gives you HTTPS. If
you already run a server, use option B.

### First, make an encryption key

FreeLLMAPI encrypts the provider keys it stores with a 64-character key you
choose. Make one, and **keep it somewhere safe**. If it changes or is lost,
the stored provider keys can't be decrypted and have to be added again.

- Mac or Linux, in Terminal: `openssl rand -hex 32`
- Windows, in PowerShell:
  ```powershell
  $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | % { $_.ToString('x2') }) -join ''
  ```

### Option A: Railway (easiest)

Railway's Hobby plan is $5 a month, which includes $5 of usage; usage beyond
that is billed on top. New accounts start with a one-time $5 trial credit.
Check [railway.com/pricing](https://railway.com/pricing) for the current
terms.

1. Sign up at [railway.com](https://railway.com) and create a new project.
2. Click **+ New → Docker Image** and enter:
   ```
   ghcr.io/tashfeenahmed/freellmapi:latest
   ```
3. Open the new service's **Variables** tab and add:

   | Variable | Value |
   |---|---|
   | `ENCRYPTION_KEY` | the key you just made |
   | `PORT` | `3001` |
   | `PROXY_RATE_LIMIT_RPM` | `600` |

4. In **Settings → Volumes**, add a volume with mount path
   `/app/server/data`. This is where FreeLLMAPI keeps its database: your
   account, provider keys and settings. **Without it they are wiped every
   time the service restarts.**
5. In **Settings → Networking**, click **Generate Domain** and set the target
   port to `3001`. You get an address like
   `https://freellmapi-production-1234.up.railway.app`. That is your gateway's
   address.
6. Wait until the deployment shows as active, then go on to step 2 below.

### Option B: Docker on your own server

```sh
mkdir freellmapi && cd freellmapi
curl -fsSLO https://raw.githubusercontent.com/tashfeenahmed/freellmapi/main/docker-compose.yml
cat > .env <<EOF
ENCRYPTION_KEY=paste-the-key-you-made-here
PORT=3001
HOST_BIND=0.0.0.0
PROXY_RATE_LIMIT_RPM=600
EOF
docker compose up -d
```

**Put HTTPS in front of it**, for example Caddy, nginx with Let's Encrypt,
or a Cloudflare Tunnel. The gateway key travels in a request header, so it
must not cross the internet in plain HTTP. FreeLLMAPI binds to localhost by
default and describes itself as single-user. Exposing it is fine only because
its unified key guards every request and only your Vercel functions hold that
key.

### Why `PROXY_RATE_LIMIT_RPM`

The gateway limits requests per minute **per client IP**, 120 by default.
Every Inner Table request reaches it from Vercel's servers, so all your users
would share that one limit. Raise it, as above. Inner Table already caps each
account per day.

## 2. Create the dashboard account and add free provider keys

1. Open your gateway's address in a browser. It asks you to create the first
   account, and for a **setup code**. The code is in the gateway's logs, on a
   line reading `First-run setup code: …`:
   - Railway: the service → **Deployments** → the active deployment →
     **Deploy Logs**.
   - Docker: `docker compose logs freellmapi`.

   A new code is printed each time the gateway starts, until an account
   exists. Use a strong password: this dashboard is reachable from the
   internet.
2. On the **Keys** page, add free-tier keys from a few providers. More
   providers means more free capacity before everything hits its cap, and
   daily caps reset at UTC midnight. **Pick them for tokens per minute**,
   not just requests. Every session request carries the person's whole inner
   system, 4,000 to 10,000 tokens, and a model that takes only 8,000 tokens a
   minute fits about one of those a minute, for all your users together.
   These are the free-tier numbers in FreeLLMAPI's own catalog. Check each
   provider's current page, since they change:

   | Provider | Tokens a minute | Context | Fit for Inner Table |
   |---|---|---|---|
   | Google AI Studio (Gemini Flash, Flash-Lite) | 250,000 | 1M | The most room by far, but read the privacy note below |
   | Mistral | 500,000 | 128k+ | Lots of tokens, only about 2 requests a minute |
   | Cerebras | 30,000 | 131k | Good |
   | OpenRouter `:free` models | no token cap | 131k+ | 20 a minute, but a small daily cap per key |
   | Groq Llama 4 Scout | 30,000 | — | Good |
   | Groq gpt-oss, Llama 3.3, Qwen | 6,000–12,000 | 131k | Too small on its own: one or two requests a minute |

   A gateway with **only Groq** keys is the one setup that will keep saying
   "at its limit" here. Add at least one of the first three. Where to get
   keys:
   - Google AI Studio: [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
   - Cerebras: [cloud.cerebras.ai](https://cloud.cerebras.ai)
   - Mistral: [console.mistral.ai](https://console.mistral.ai)
   - OpenRouter (its free models): [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys)
   - Groq: [console.groq.com/keys](https://console.groq.com/keys)
3. Copy the **unified API key** from the header of the Keys page. It starts
   `freellmapi-`.

**Choose providers with your users' privacy in mind.** Profiles and sessions
here are intimate journaling. Some free tiers say they may use what is sent to
them to train or improve their models, or that people may read it. Google's
unpaid Gemini tier is one. FreeLLMAPI's own notes say its keyless Kilo
provider logs free prompts for training. Read each provider's free-tier terms,
and leave out or disable any you are not comfortable sending journaling to.
Some free tiers also limit or forbid serving a public app. That is between you
and each provider.

## 3. Connect it to Inner Table

In Vercel, open the project → **Settings → Environment Variables**. Add these
for both **Production** and **Preview**:

| Variable | What it is |
|---|---|
| `FREELLMAPI_URL` | The gateway's address, e.g. `https://freellmapi-production-1234.up.railway.app` (with or without `/v1`) |
| `FREELLMAPI_KEY` | Its unified key, `freellmapi-…`. Mark it **Sensitive** |
| `FREELLMAPI_MODEL` | Optional. The models to try, in order, comma-separated, for example `gemini-2.5-flash, auto:smart`. The gateway's own `auto` routing is always tried last, and is all there is when this is unset. Routing strategies (`auto:reliable`, `auto:smart`…) and your gateway's profiles (`auto:<name>`) work too. See *How a request is routed* |
| `FREE_AI_DAILY_LIMIT` | Optional. Messages per account per UTC day, default `500`; `0` means no cap |

**No gateway yet?** `FREELLMAPI_URL` can point straight at a provider's own
OpenAI-style API instead, for example Groq's, `https://api.groq.com/openai/v1`,
with a Groq key in `FREELLMAPI_KEY`. A provider's API has no `auto`, so
`FREELLMAPI_MODEL` must list its models, the roomiest first. For Groq's free
tier, where each model has its own per-minute allowance:

```
meta-llama/llama-4-scout-17b-16e-instruct, llama-3.3-70b-versatile, openai/gpt-oss-120b, openai/gpt-oss-20b
```

That is about 58,000 tokens a minute between them, against 8,000 for
`openai/gpt-oss-20b` alone. Groq retires and renames models, so check its
current list. A model it no longer has is skipped, and said so in the logs.
A gateway still gives far more room, because it can use Gemini, Cerebras
and Mistral too.

The free AI also needs the account variables already described in the
README (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`,
`SESSION_SECRET`), because it is only for signed-in accounts and the daily
count lives in Upstash.

Environment variables only reach a deployment made after they are set, so
**redeploy**: Vercel → **Deployments** → the latest one → **Redeploy**.

### Check it

1. Open your app's address with `/api/free-ai` on the end, for example
   `https://your-app.vercel.app/api/free-ai`. It should show:
   ```
   {"available":true,"daily":500}
   ```
   `"available":false` means the deployment doesn't have `FREELLMAPI_URL`,
   `FREELLMAPI_KEY` or the account variables yet. Check them, and redeploy.
2. Sign in and start a session. The first time, the app shows its one-time
   free AI notice; press **Start**, and a reply should come back.

To try it before it goes live, do both checks on a pull request's
**preview** deployment: it has its own address, linked from the pull request,
and uses the **Preview** variables.

## How a request is routed

The gateway never moves a request on from a model you **name** to a
*different* model. It only tries other keys of that same model. So if
`FREELLMAPI_MODEL` names a single small model, every request that model
can't take fails, however much room the other models have. With Groq's
`openai/gpt-oss-20b` (8,000 tokens a minute), that means:

- `413 Request too large ... Limit 8000, Requested 9391`: a relationship
  mapping, or a long session, can never fit.
- `429 Rate limit reached ... Limit 8000, Used 5572, Requested 4324`: the
  second request in any minute fails. That includes the step that writes a
  finished conversation into each part's profile, which asks once per part,
  one after another.

So Inner Table treats `FREELLMAPI_MODEL` as a **ladder**:

1. It tries each model you list, in order.
2. A model that answers `413` is not asked for a request that size again for
   six hours.
3. A model that answers `429` rests for as long as it said, so later requests
   skip straight past it. That memory is per server instance, so treat it as
   a shortcut, not a guarantee.
4. The gateway's own `auto` routing is always the last rung. It knows each
   model's context window and per-minute limits, and moves between models
   itself.

Only when every rung fails does the person see an error. If the models are
only busy, the app waits as long as the gateway says one needs, up to 30
seconds, and asks once more.

What to set:

- **Unset, or `auto`**: the gateway picks. This is the simplest choice, and
  right for most setups.
- **A model you prefer, then auto**, e.g. `gemini-2.5-flash`: it is tried
  first, and anything it can't take goes to `auto`.
- **Not a small model on its own.** Naming one is harmless now, since
  anything it can't take falls through. But every request it turns down
  costs a round trip first.

Writing a conversation into a profile asks for a small JSON answer
(`response_format: json_object`). The gateway sends those only to models
that can return JSON, and checks the reply.

## When something goes wrong

- People see plain messages, for example "Every free model is at its limit
  right now". The gateway's actual reason is logged by the function. Look in
  Vercel → the project → Logs:
  - `free-ai: gateway answered 429 for openai/gpt-oss-20b: …` is what one
    model said.
  - `free-ai: answered on auto (google/gemini-2.5-flash) after passing over
    openai/gpt-oss-20b (429)` says which model answered in the end, and
    what was passed over on the way.
- `404` for `auto`, saying ``The model `auto` does not exist``, and
  `FREELLMAPI_URL has no "auto"`: the URL is a provider's own API, not a
  FreeLLMAPI gateway. List that provider's models in `FREELLMAPI_MODEL`
  (see *No gateway yet?* in step 3). People only see "not set up right"
  when no model on the list exists there.
- `400` with `tool_use_failed` or `json_validate_failed`: the model fumbled
  its reply, usually Groq's gpt-oss. The next model on the list takes the
  request, and the app tries once more on its own.
- `401` / `403` in those logs: `FREELLMAPI_KEY` doesn't match the
  gateway's unified key. The key changes if it is regenerated in the
  dashboard.
- `429` / `503` with `no_providers_configured` or `quota_exceeded`: no
  provider key has room. Add more providers, or wait for the UTC reset.
- `429` naming **tokens per minute (TPM)**, again and again, even for `auto`:
  your providers are too small for these prompts. See the table in step 2,
  and add Google AI Studio, Cerebras or Mistral.
- `413`: a session's prompt is over a model's token budget. It carries the
  person's whole inner system. If it comes from every rung, including
  `auto`, no model you have keys for can take it. Add a provider with a
  bigger context window.

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
