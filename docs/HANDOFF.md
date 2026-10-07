# Inner Table — handoff

Everything a fresh session needs to pick this up. Written 2026-08-01, refreshed
2026-09-27 to cover the multi-user, sync and push work (PR #7).

---

## What this is

**Inner Table** is a mobile-first PWA for Internal Family Systems
(IFS) self-exploration. You meet your inner "parts", build a written profile of
each one, map how they relate, and hold a table meeting where they respond to
something real. It is on-device first — parts live in browser storage with an
IndexedDB mirror — and signed-in users get two server-side services: **accounts
with cloud sync** (the same parts on every device you sign in on) and
**Web Push** for the daily check-in. The LLM sessions themselves still call the
provider's API straight from the browser; there are no analytics anywhere.

It is the webapp half of **ifs-agents**, which also ships Claude Code skills and
portable prompts that read and write the *same* `parts/<slug>.md` files.

> **Not therapy.** A self-exploration and journalling tool that borrows IFS
> structure and deliberately excludes depth work: no trauma processing, no
> unburdening. This constraint is load-bearing — see *Invariants* below.

## Where things live

| | |
|---|---|
| **Live app** | https://ifs-agents.vercel.app |
| **Public repo** (code) | https://github.com/joman124/ifs-agents — `main` |
| **Private repo** (real part data) | `joman124/ifs-agents-jm` — profiles, sessions, imports |
| **Hosting** | Vercel project `ifs-agents`, auto-deploys every push to `main` |
| **Vercel config** | `vercel.json` — serves `app/` as site root, `cleanUrls`, no-cache on `sw.js`; `api/` functions deploy as serverless endpoints |
| **Server API** | `api/` — signup, login (scrypt-hashed passwords, HMAC-signed session tokens), state sync, Web Push subscription/sending. Stateless; all persistence is Upstash Redis. See *Server setup* below. |
| **State storage** | Signed-out: browser only (localStorage + IndexedDB mirror). Signed-in: same local storage as source of truth, plus a per-user state blob in Upstash Redis (`innertable:state:<username>`) for cross-device sync — whole-blob push/pull, reconciled before the first push, merged through `store.importAll` on pull. |
| **CI** | `.github/workflows/test.yml` — runs `node test/run.js` on push and PR to `main`. (An earlier GitHub Pages workflow never succeeded and was deleted in `afb4b85`.) |

Deploys are automatic: push to `main` → Vercel builds → live. There is no build
step; `app/` is served as static files and `api/` runs as serverless functions
on the same project.

### Server setup

The `api/` functions need environment variables on the Vercel project. Without
them they return a 500 that says which feature is unconfigured — the app degrades
gracefully (local-only mode), it never crashes.

| Variable | For | How to get |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | accounts + sync | Upstash Redis database |
| `SESSION_SECRET` | signing login tokens (HMAC-SHA256) | any long random string |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push | `node scripts/gen-vapid-keys.js` |
| `VAPID_SUBJECT` | Web Push contact | `mailto:` address |
| `CRON_SECRET` | check-in reminders (`api/push-remind.js`) | any long random string — also set as a GitHub Actions secret of the same name; `.github/workflows/reminders.yml` sends it hourly, and the endpoint notifies each device at 8am, 2pm and 8pm on its own clock |

`scripts/add-user.js` provisions accounts from the command line when needed.

## Repo layout

```
app/                 the webapp (this is what deploys)
  index.html         single page, 4 tabs, sheet + panel overlays
  css/app.css        all styles (931 lines)
  sw.js              service worker, cache-first shell — bump CACHE on every deploy
  manifest.webmanifest  icons + install-card screenshots (placeholders — see Next steps §1)
  screenshots/       placeholder install-card PNGs — replace with real device shots
  js/                see the table below
api/                 serverless functions (Vercel): signup, login, sync,
                     push-subscribe, push-send, push-remind, vapid-public-key
  root package.json  holds the `web-push` dependency for the functions only
test/                node test/run.js — 497 assertions, no dependencies
docs/                ifs-primer.md, safety.md, HANDOFF.md (this file)
  source/            the practitioner notes the whole system derives from
schema/part-schema.md  canonical profile format — the contract
templates/           portable prompts (same content as js/templates.js)
skills/              Claude Code slash commands
examples/            one fictional part, "The Critic"
scripts/             gen-vapid-keys.js, add-user.js, env.js, audit-parts.js
```

### The JS modules

Load order matters (`schema` → `questions`/`reference` → `markdown` → `store` → rest).
All are IIFEs hanging off `window.IFS`. No framework, no bundler, ES5-style
`var`/`function` with `async/await` where useful.

| File | Lines | What it owns |
|---|--:|---|
| `icons.js` | 59 | The line-icon set (`IFS.icon(name, size)`) used by the shell, menus and settings |
| `schema.js` | 718 | Part shape, the 9 coverage categories, 5 edge types, the 5-point feeling scale, `mergeParts`, `mergeDuplicate`, `readiness`, `coverageScore`, `edgeWeight`, `setFeeling`/`pairFeeling`/`pairTone`/`feelingHistory`, `mapCounts`, `initial` |
| `questions.js` | 130 | The IFS question bank (33 questions), `nextCategory`, `applyAnswers` |
| `reference.js` | 207 | Fraser's Table protocol (build/tools/seats/closing), the 8-page reference library, the first-run coach cues and the daily check-in prompts |
| `markdown.js` | 489 | `parts/<slug>.md` ⇄ object. Frontmatter parser, `splitDocs`, `analyze`, `splitVoices`/`summarizeMeeting` |
| `store.js` | 831 | localStorage + IndexedDB mirror; parts, transcripts, table, settings, `absorbPart`, table-only `exportTable`/`importTable` |
| `templates.js` | 425 | LLM prompt builders; `roomBlock` injects the person's room into meetings |
| `llm.js` | 272 | Gemini / Anthropic / OpenAI, chat + SSE streaming, retry |
| `voice.js` | 360 | Web Speech dictation + TTS, optional ElevenLabs voice |
| `graph.js` | 559 | Force-directed SVG swarm map, implicit and felt threads, seating forces, thread weight and recency heat; a dragged part stays where it is dropped (per device, per account) |
| `auth.js` | 62 | Session token storage, sign-in/up/out flows against `api/` |
| `sync.js` | 82 | Whole-blob push/pull via `api/sync.js`; nothing pushes before a pull reconciles; a pending push is pinned to the account that queued it |
| `push.js` | 222 | Web Push subscribe/unsubscribe, daily check-in reminder scheduling; requires sign-in |
| `ui.js` | 3093 | The shell and every view, sheet, panel and flow except the two below. Still the big one; shares its helpers with them via `IFS.ui._share`. |
| `ui-table.js` | 740 | The Table tab: the room, seating, meetings, the round of the table and the readings-history sheet |
| `ui-learn.js` | 49 | The Learn library sheet and its pages |
| `app.js` | 49 | Boot, SW registration, storage persistence |

## The three tabs, and the profile menu

The bottom tab bar holds the three places the work happens. Settings is not a
tab: it lives behind the **profile avatar** in the top-right corner, alongside
the theme switch and sign out.

1. **Parts** — opens on a greeting header, then a grid of part cards (type,
   positive intent, a "profile depth" bar, readiness and how long it has been
   quiet), headed by the **daily check-in** hero card: once a day it asks one rotating question and offers the
   part that has gone quietest, with a way straight into a session. A profile
   page has a single primary next-step CTA, tap-to-edit fields, and
   per-category coverage.
2. **Map** — every pair of parts is drawn as a faint thread ("you already relate,
   you just haven't named it"). Tap a thread to name it; tap a part to focus it.
   Once a table exists, seating becomes distance from Self. Thread thickness is
   how much both parts have said about each other *and* how many rounds of
   readings they have been through; parts fade as they go quiet and the
   recently-visited one keeps a light on. An unnamed pair with readings on it is
   a **felt** thread: dashed still, but with substance and a tone of its own.
   The **map key** carries all of that vocabulary and is closed by default — the
   "Key" button bottom-left opens it as a sheet on a phone and a side panel from
   700px up, with a scrim that closes it, Escape, and a close button. Its first
   section is the old three-tone filter (supportive / in tension / not mapped),
   which still drives `mapTone`; the rest explains the five edge styles, the
   felt threads and the five-point scale behind them, and what a part's colour
   and fading mean. Counts come from `S.mapCounts()`, so the key doubles as a
   read on the system: how many pairs are named, how many were rated at a table,
   how many answered both ways. A filter left switched on is carried on the
   closed button, which wears the tone's label and dot. The key steps aside
   while a part is selected — the part card owns that corner.
3. **Table** — Fraser's Table. Build the room through the source document's own
   questions, invite parts to one of four seats, add tools and agreements, hold a
   meeting, close with the reflection. A meeting opens with the parts taking
   their seats, runs as a group chat with one named bubble per voice, and
   leaves a summary card behind on the tab. It closes with a **round of the
   table**: one screen per part, five points each, rating how it feels toward
   every other part in the room — offered when a meeting ends, reachable on
   its own from the tab (the only way in for copy-prompt mode, since that never
   passes through the app's own session close), and **reachable from any past
   meeting card**, where it is filed on that meeting's date rather than today.
   A card says whether a round was recorded; one whose attendees have since
   been deleted says so instead of offering a round nobody can answer.
4. **Settings** (from the profile avatar, not a tab) — a jump bar of
   sections, then account (sign in/up/out, "Sync now", sign-out closes your parts
   and returns to the sign-in screen), push notifications (tied to the signed-in
   account), provider keys, voice, theme, backup/restore, transcripts.
   "Find my voices" lists the ElevenLabs account's own voices (clones first) so
   no ID is copied by hand; "Test this key" does a live round-trip for
   whichever LLM provider is active instead of failing silently mid-session.

The **ⓘ in the topbar** opens the reference library from anywhere. The
**profile avatar** next to it opens a menu: Settings, How this works, the
Light / Dark / Auto theme switch, and Sign out.

Visual language: line icons from `js/icons.js` (one stroke weight, drawn in
`currentColor`), DM Sans for text and Newsreader for headings — both
self-hosted in `app/fonts/` so the app makes no third-party requests and
works offline. All colour comes from the tokens at the top of `app.css`.

## Data model

### A part — `parts/<slug>.md`

The contract is `schema/part-schema.md`. YAML frontmatter + six fixed narrative
sections, in this order: *In its own words / Origin story / What activates it /
How it relates to other parts / What it needs / Session notes*.

- `slug` is derived from `name`, **never** from the filename. This has bitten
  twice — see *Known issues*.
- 9 coverage categories, each `untouched | partial | complete | declined`.
- 5 edge types: `protects` / `protected-by` (mirrors) and `polarized-with` /
  `allied-with` / `conflicts-with` (self-mirroring). Edges are always written to
  **both** profiles.
- `EDGE_TONE` in `schema.js` groups those five into three tones for the map
  key and the relationship sheet. The five stay the source of truth on disk.
  `namedEdge(a, b)` is the one place a pair's edge is looked up from either
  side; `mapCounts(parts)` walks every pair once for the key's numbers.
- `feelings` — directed, dated readings of how this part feels toward another,
  `{part, rating 1-5, date, rounds, prev}`. The opposite of an edge in every
  way that matters: **never mirrored** (it lives only on the rater's profile),
  temporary rather than structural, and taken at a table meeting rather than in
  a mapping session. A new reading pushes the old one into `prev` and climbs
  `rounds`, so the profile carries the direction of travel. Ratings off the
  scale are dropped, not clamped.
- **Readings can arrive out of order**, because a past meeting can get its
  round months later. `setFeeling` handles it and every caller relies on that:
  `rounds` climbs either way (the meeting happened), but `rating`/`date` move
  only forward in time, and an older reading lands in `prev` only where nothing
  truer sits there. It returns `{entry, current}` so the caller can say which
  readings actually became current. Do not bypass it.

### The table — `state.table`

```js
{ built, name, room, details,
  tools: [{id,label,note}], agreements: [str],
  seats: { <slug>: "table"|"room"|"adjoining"|"away" },
  log: [{date, answers, note}],
  meetings: [{id, date, topic, parts:[slug],
              voices: [{name, line, color}], synthesis, transcript, readings}] }
```

`meetings` is capped at 60 and, like transcripts, a restore **adds to** what is
already there rather than replacing it — both are history.

Included in backups. A deleted part gives up its chair as well as its edges.

### Sync — `api/sync.js` ⇄ `app/js/sync.js`

Signed-in users share one state blob per account, stored at
`innertable:state:<username>` in Upstash Redis. The browser's local storage
stays the source of truth; sync is best-effort on top of it. The server
verifies the HMAC-signed session token (issued by `api/login.js`) on every
call, so one user can never read or write another's slot. The client pushes
the whole blob after a 1.5 s debounce, but never before a pull has reconciled
what the server holds — a push that lands in the wrong account's slot would
flatten the other device's parts, so nothing goes up blind, and a queued push
is pinned to the username that queued it. A pull merges through
`store.importAll`'s existing merge logic rather than overwriting, so the
Invariants around merges still hold across devices.

## Invariants — do not break these

These are not style preferences; several were fixed *because* they were broken.

1. **Never invent.** Unstated fields stay empty. Coverage reflects only ground
   actually covered, so the development % stays honest. A Likert row in the
   round of the table is deliberately **not** pre-selected from the last
   reading: a round that recorded itself when someone tapped Next would thicken
   the map on nobody's word.
2. **Declined is first-class and sticky.** A declined category is never re-asked
   and never silently downgraded. Reopening asks first.
3. **Protectors set the pace.** Hesitation backs off. Everything is skippable.
4. **Merges never lose data.** `mergeParts` (a model's rewrite: newer text
   supersedes) and `mergeDuplicate` (two records of one part: narratives are
   *joined*, both session logs kept) are deliberately different. Don't collapse them.
5. **Coverage only ever climbs.** So does `rounds` on a reading — it counts
   meetings that actually happened, and a merge that lost one would be lying
   about the map's thickness.
6. **No trauma depth, no unburdening.** The source doc's trauma question is
   deliberately absent from both the questionnaire and the prompts.
7. **Personal profiles never go in the public repo.** `.gitignore` root-anchors
   `/parts/` and `/sessions/`. Real data belongs in `ifs-agents-jm` (private).
8. **Escape user text.** `esc()` before any `innerHTML` interpolation.
9. **Bump `CACHE` in `sw.js`** on every deploy or installed clients serve stale files.

## Running and verifying locally

```bash
python3 -m http.server 8777 --directory app
# then http://localhost:8777/index.html
```

No build, no install. Any static server works — Node one-liners and
`npx serve app` do too; `.claude/launch.json` has a config for the latter.
A plain static server won't run the `api/` functions; test those against a
Vercel preview deploy (or `vercel dev`) with the env vars from *Server setup*
above — without them each function returns its "not configured" 500 and the
app runs local-only.

### The test suite

```bash
node test/run.js
```

No dependencies, no browser, no build, under a second, and it exits non-zero
on failure so it drops straight into a hook or CI later. It covers **data
integrity, not the UI**: it will catch a profile being mangled or overwritten;
it will not catch a button that stopped working. Run it before every push.

`test/harness.js` runs the real browser modules unchanged — they are IIFEs
hanging off `window.IFS`, so a Node `vm` context with just enough browser in it
(a `localStorage` object, a `navigator`, a fake `SpeechRecognition`) loads them
with nothing to keep in sync. It also supplies a **virtual clock**: `voice.js`
decides a spoken turn is over with four- and nine-second timers, and a suite
that really waits nine seconds is a suite nobody runs. `clock.tick(ms)` fires
the due timers in order.

Covered: `parts/<slug>.md` round trips including the committed example and the
awkward cases (`#` inside a quoted value, concatenated files, an unnamed part),
both merge paths, untrusted backups, the question bank's routing and its
refusal to re-ask a declined category, the store defects from the review
(rename carrying edges and seats, collision refusal, absorb, delete), and mic
turn-taking.

It earned its place immediately — the first run found that
`examples/parts/the-critic.md`, the repo's own worked example, could not be
imported by the app, because the file opens with an HTML comment and the
frontmatter regex demanded `---` first.

Not covered: anything needing a DOM. The UI has been verified by driving the
real page — Playwright where available, otherwise the browser tools — and two
patterns are worth reusing when you do:

- The sheet and panel animate for ~200–350 ms. Settle between transitions or
  clicks land on the wrong element.
- `navigator.share` / `canShare` / `clipboard` are prototype getters —
  `Object.defineProperty` to stub them, plain assignment silently does nothing.

## Code review, 2026-08-01

A full read-through found ten defects. **All ten are fixed** and covered by
regression tests. Worth knowing because the causes recur:

| # | Defect | Cause |
|---|---|---|
| 1 | Answering "What is your name?" with an existing part's name **destroyed that part** | `deletePart` + `upsertPart` used as a rekey; `upsertPart` has no collision check |
| 2 | Any rename silently dropped every **inbound edge** and the part's seat | same — `deletePart` also strips edges and seats |
| 3 | With a room built, the FAB's "Table meeting" produced a meeting with **nobody in it** | the template switched to seat-based attendance; that caller still picked by readiness |
| 4 | A hand-edited backup **permanently bricked the Parts tab** | `importAll` validated only `slug` + `name`; a part with no `coverage` threw inside `renderParts` on every later boot |
| 5 | Merging duplicates leaked the absorbed part's seat | `absorbPart` didn't clear `table.seats` |
| 6 | The map stacked pan/pinch listeners on **every** visit | handlers live on the `<svg>`, which `innerHTML = ""` doesn't clear |
| 7 | Invented table tools couldn't be removed, and duplicated | the toggle list rendered only the presets |
| 8 | Copy still referenced the deleted Sessions tab | — |
| 9 | Repeated closing agreements piled up forever | no dedup, uncapped log |
| 10 | Latent recursion in `buildTable.finish()` ↔ `closePanel()` | the guard flag was un-set before closing |

The fix for 1 and 2 is `store.renamePart(oldSlug, part)` — the only correct way
to move a part to a new slug. It carries inbound edges and the seat, and returns
`null` on collision so the caller can offer a merge instead. **Never use
`deletePart` to rekey.** The fix for 4 is `schema.normalizePart(raw)`, which
every imported part now passes through.

Clean in three categories: no XSS (every interpolation goes through `esc()`), no
migration problems for an existing user with no `table` key, and no use-before-
definition.

## Known issues

**Slug drift in the private repo.** Seven relationship edges in
`ifs-agents-jm/parts/` point at `the-magician` and `captain`, but those profiles'
names derive `the-wanderer-magician` and `captain-10`. The map silently skips
edges it can't resolve, so those relationships never draw. The app labels them
"not in your library yet". Fixing means rewriting the `part:` targets in five
files. Deliberately not done — it touches live personal data.

**Icons are generated, not hand-drawn.** The PNGs in `app/icons/` are rasterised
from `icon.svg` and `icon-maskable.svg`. If either SVG changes, regenerate them —
there is no build step and no image tooling in the repo. The throwaway method
that produced them: serve `app/`, open it, and in the page console draw the SVG
into a canvas at each size and `PUT` the base64 back to a dev server that writes
the file. 180 is drawn on an opaque `#14110e` background (iOS composites its own
mask over an opaque square); 192 and 512 keep the rounded transparent corners.

---

## Next steps

Ordered by value against "a web app people save to their phones for local use".

### 1. Make it genuinely installable — **done**, one bullet left

- ~~**PNG icons.**~~ `icons/icon-180.png` (opaque, `apple-touch-icon`),
  `icon-192.png`, `icon-512.png`, and `icon-maskable-512.png` now exist and are
  what the manifest and `<link>` point at. The SVGs stay as the source.
- ~~**An install prompt.**~~ `ui.js` captures `beforeinstallprompt` and offers a
  banner with a real **Install** button on Android/desktop; on iOS, where no such
  event exists, the same banner says *tap Share, then Add to Home Screen*.
  Dismissing snoozes it for 30 days (`settings.installSnooze`). Settings →
  **About** is the permanent path, and reads *Installed* once it is.
- ~~**Manifest polish:** `id`, `categories`, maskable PNG.~~ `screenshots` are
  now in the manifest — `screenshots/wide.png` (1280×720) and
  `screenshots/narrow.png` (750×1334) — which gives Android the richer install
  card. Both are **generated placeholders** drawn in the app's palette
  (`scripts`-side throwaway at `/tmp/gen-screenshots.py`; no image tooling in
  the repo). Replace them with real device screenshots when convenient; the
  sizes and `form_factor` values (`wide` / `narrow`) are already correct.
- ~~**Verify offline.**~~ Verified for real on 2026-08-01: shell cached under
  `inner-table-v11`, dev server killed, cold navigation still booted the whole
  app with zero console errors. **iOS home-screen install verified on a real
  phone per owner, 2026-09-27.**

### 2. Protect data — it is the whole product

Signed-in users get a per-account state blob in Upstash (sync), which doubles
as an off-device backup. Signed-out users still rely on browser storage
(localStorage + IndexedDB mirror), so the risks below are theirs:

- Safari can evict script-writable storage after ~7 days of no interaction for
  sites not on the home screen. `navigator.storage.persist()` is already
  requested; surface whether it was *granted* and warn if not. The passive
  status row was removed in the settings cleanup; the "export backups" nudge
  now rides on the backup reminder and the **Your data** section instead of a
  standalone line.
- The backup reminder only nags after 3 weeks. Consider a first-run prompt and
  a "your data is only on this device" line in onboarding for signed-out users.
- ~~No import/export of the table alone; only the whole-backup JSON.~~
  Settings → **Your data** now exports and imports the table on its own
  (`store.exportTable`/`importTable`); an import merges the room onto the
  current one and adds only meetings this device doesn't already have.

### 3. Commit the test harness — **done**

`test/` now holds 497 assertions over the pure logic, run with
`node test/run.js`. `.github/workflows/test.yml` runs the suite on push and
PR to `main`, so regressions get caught before they merge. See *Running and
verifying locally* above for what is and isn't covered. What's left here is
smaller: DOM-level coverage of the sheet/panel flows, and wiring the runner
into a pre-commit hook alongside the CI.

Writing it found one real defect, now fixed: `examples/parts/the-critic.md`
opens with an HTML comment saying it is fictional, and frontmatter has to come
first — so the one example profile in the repo was the one file the importer
refused. `extractProfiles` now drops a leading comment before giving up.

### 4. Table follow-ons

- ~~The closing reflection can't be reopened after the fact.~~ ~~`log[].answers`
  is stored but only the first answer is surfaced in the UI.~~ A row under
  **Closing reflections** now opens every answer it holds, question by
  question (`openClosingLog`). Editing one after the fact is still not
  possible — reopening only reads.
- A finished meeting now leaves a **summary card** on the tab
  (`table.meetings[]`): who was seated, what was on the table, the line each
  part ended on, and Self's closing read. It is built from the transcript by
  `MD.summarizeMeeting`, so it costs no extra model call, and it links through
  to the full transcript. Meetings also open with a short seating ceremony,
  and each part speaks in its own named, coloured bubble.
- ~~A meeting changed nothing on the map — the one event where the whole system
  sits down together left the threads between those parts exactly as it found
  them.~~ A meeting now closes with a **round of the table**: each part rates
  how it feels toward every other part in the room, and those readings thicken
  the threads (`schema.feelingWeight` folded into `edgeWeight`) and give an
  unnamed pair a tone of its own. The prompt asks for the same round in
  character first, so the words the person taps are the ones the parts said.
  Meetings held before the feature existed can still get their round, from
  the meeting card, dated to that meeting.
  What is not built: a history view of how a pair moved over several rounds —
  the profile carries `prev` and `rounds`, but nothing plots them, so only the
  last two readings of a direction survive as numbers.
- The source doc suggests a notebook left in the room for parts to leave
  messages between meetings — the tool exists as a label but does nothing.
- Meetings still require an API key or copy-prompt mode. A no-AI structured
  meeting (each seated part answered by *you*, in turn) would match the
  questionnaire's zero-config path.

### 5. Smaller

- Session transcripts are reachable but plain; the panel has no empty state.
- ~~The reference library is not linked from the places its content is
  relevant (e.g. the 6 Fs from a check-in).~~ Five **coach cues**
  (`reference.js` `COACH`) now surface it in place: on the Parts, Map and
  Table tabs, and at the top of a first interview and a first meeting. Each
  is one paragraph with a **Read more** into the full page, fires once, and
  runs only during an account's first day (`settings.coachOn` / `taught`).
  The library still has no search.
- ~~`ui.js` is 3629 lines. Splitting the Table and Learn sections out would help,
  but only worth doing alongside the test harness.~~ Done: the Table tab lives
  in `ui-table.js` and the Learn library in `ui-learn.js`; `ui.js` is 3093 lines.

---

## Questions for the owner

1. ~~**Is this for you, or for other people too?**~~ **Answered: other people
   too.** Sign-up and login make this a multi-user platform, and the first-run
   experience is built on that — a fresh account gets the coach cues, an
   established one gets the daily check-in.
2. ~~**Which phone?**~~ iOS and Android both install and run; iOS home-screen
   install verified on a real phone per owner, 2026-09-27. Remaining iOS
   exposure is storage eviction for sites kept off the home screen (see
   *Next steps* §2).
3. **Do you want a no-AI path all the way through?** The questionnaire, map and
   table all work with zero configuration, but *meetings* still need a key or
   the copy-prompt detour. Closing that gap makes the app fully usable offline.
4. ~~**Should the slug drift in the private repo be fixed?**~~ **Answered:
   leave it alone — owner, 2026-09-27.** Seven edges don't draw; the data stays
   as-is.
5. ~~**How much should the app teach?**~~ **Answered:** contextually, but only
   at the start. Five coach cues surface the library where its content is
   relevant, each once, and only during an account's first day — after that
   the ⓘ is the path again and the daily check-in takes the space. Whether to
   extend this to later moments (legacy burdens when a part looks inherited)
   is still open.
6. **Is anything else meant to be in here?** A previous session mentioned code
   from another AI tool that was never found; every commit in this repo is
   accounted for by you or Claude.
