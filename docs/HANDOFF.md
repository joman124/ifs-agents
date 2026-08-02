# Inner Table — handoff

Everything a fresh session needs to pick this up. Written 2026-08-01, updated 2026-08-02.

---

## What this is

**Inner Table** is a mobile-first, zero-backend PWA for Internal Family Systems
(IFS) self-exploration. You meet your inner "parts", build a written profile of
each one, map how they relate, and hold a table meeting where they respond to
something real. Everything lives in the browser — no account, no server, no
analytics.

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
| **Vercel config** | `vercel.json` — serves `app/` as site root, `cleanUrls`, no-cache on `sw.js` |
| **CI** | None. A GitHub Pages workflow existed, never once succeeded, and was deleted in `afb4b85`. |

Deploys are automatic: push to `main` → Vercel builds → live. There is no build
step; `app/` is served as static files.

## Repo layout

```
app/                 the webapp (this is what deploys)
  index.html         single page, 4 tabs, sheet + panel overlays
  css/app.css        all styles (605 lines)
  sw.js              service worker, cache-first shell — bump CACHE on every deploy
  manifest.webmanifest
  js/                see the table below
test/                node test/run.js — 127 assertions, no dependencies
docs/                ifs-primer.md, safety.md, HANDOFF.md (this file)
  source/            the practitioner notes the whole system derives from
schema/part-schema.md  canonical profile format — the contract
templates/           portable prompts (same content as js/templates.js)
skills/              Claude Code slash commands
examples/            one fictional part, "The Critic"
```

### The JS modules

Load order matters (`schema` → `questions`/`reference` → `markdown` → `store` → rest).
All are IIFEs hanging off `window.IFS`. No framework, no bundler, ES5-style
`var`/`function` with `async/await` where useful.

| File | Lines | What it owns |
|---|--:|---|
| `schema.js` | 249 | Part shape, the 9 coverage categories, 5 edge types, `mergeParts`, `mergeDuplicate`, `readiness`, `coverageScore`, `initial` |
| `questions.js` | 130 | The IFS question bank (33 questions), `nextCategory`, `applyAnswers` |
| `reference.js` | 154 | Fraser's Table protocol (build/tools/seats/closing) + the 8-page reference library |
| `markdown.js` | 361 | `parts/<slug>.md` ⇄ object. Frontmatter parser, `splitDocs`, `analyze` |
| `store.js` | 363 | localStorage + IndexedDB mirror; parts, transcripts, table, settings, `absorbPart` |
| `templates.js` | 383 | LLM prompt builders; `roomBlock` injects the person's room into meetings |
| `llm.js` | 260 | Gemini / Anthropic / OpenAI, chat + SSE streaming, retry |
| `voice.js` | 178 | Web Speech dictation + TTS, optional ElevenLabs voice |
| `graph.js` | 387 | Force-directed SVG swarm map, implicit threads, seating forces |
| `ui.js` | 2454 | Every view, sheet, panel and flow. The big one. |
| `app.js` | 40 | Boot, SW registration, storage persistence |

## The four tabs

1. **Parts** — library with coverage rings and readiness dots. A profile page has
   a single primary next-step CTA, tap-to-edit fields, and per-category coverage.
2. **Map** — every pair of parts is drawn as a faint thread ("you already relate,
   you just haven't named it"). Tap a thread to name it; tap a part to focus it.
   Three-tone legend (supportive / in tension / not mapped) doubles as a filter.
   Once a table exists, seating becomes distance from Self.
3. **Table** — Fraser's Table. Build the room through the source document's own
   questions, invite parts to one of four seats, add tools and agreements, hold a
   meeting, close with the reflection.
4. **Settings** — provider keys, voice, theme, backup/restore, transcripts.
   "Find my voices" lists the ElevenLabs account's own voices (clones first) so
   no ID is copied by hand; "Test this key" does a live round-trip for
   whichever LLM provider is active instead of failing silently mid-session.

The **ⓘ in the topbar** opens the reference library from anywhere.

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
  legend and the relationship sheet. The five stay the source of truth on disk.

### The table — `state.table`

```js
{ built, name, room, details,
  tools: [{id,label,note}], agreements: [str],
  seats: { <slug>: "table"|"room"|"adjoining"|"away" },
  log: [{date, answers, note}] }
```

Included in backups. A deleted part gives up its chair as well as its edges.

## Invariants — do not break these

These are not style preferences; several were fixed *because* they were broken.

1. **Never invent.** Unstated fields stay empty. Coverage reflects only ground
   actually covered, so the development % stays honest.
2. **Declined is first-class and sticky.** A declined category is never re-asked
   and never silently downgraded. Reopening asks first.
3. **Protectors set the pace.** Hesitation backs off. Everything is skippable.
4. **Merges never lose data.** `mergeParts` (a model's rewrite: newer text
   supersedes) and `mergeDuplicate` (two records of one part: narratives are
   *joined*, both session logs kept) are deliberately different. Don't collapse them.
5. **Coverage only ever climbs.**
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
  **This app** is the permanent path, and reads *Installed* once it is.
- ~~**Manifest polish:** `id`, `categories`, maskable PNG.~~ Still missing:
  `screenshots`, which is what gives Android the richer install card. It needs
  real device-sized PNG screenshots, which nothing in this repo can generate.
- ~~**Verify offline.**~~ Verified for real on 2026-08-01: shell cached under
  `inner-table-v11`, dev server killed, cold navigation still booted the whole
  app with zero console errors. **Not** yet verified from an iOS home-screen
  icon on a real phone — that is the one remaining install check.

### 2. Protect local data — it is the whole product

Everything is in `localStorage` with an IndexedDB mirror. Risks worth closing:

- ~~Safari can evict script-writable storage after ~7 days of no interaction for
  sites not on the home screen. `navigator.storage.persist()` is already
  requested; surface whether it was *granted* and warn if not.~~ Settings →
  **This app** now reports the real `navigator.storage.persisted()` answer, and
  says "export backups" when it is false (which it is on a plain desktop tab).
- The backup reminder only nags after 3 weeks. Consider a first-run prompt and
  a "your data is only on this device" line in onboarding.
- No import/export of the table alone; only the whole-backup JSON.

### 3. Commit the test harness — **done**

`test/` now holds 127 assertions over the pure logic, run with
`node test/run.js`. See *Running and verifying locally* above for what is
and isn't covered. What's left here is smaller: DOM-level coverage of the
sheet/panel flows, and wiring the runner into a pre-commit hook.

Writing it found one real defect, now fixed: `examples/parts/the-critic.md`
opens with an HTML comment saying it is fictional, and frontmatter has to come
first — so the one example profile in the repo was the one file the importer
refused. `extractProfiles` now drops a leading comment before giving up.

### 4. Table follow-ons

- The closing reflection can't be reopened or edited after the fact.
- `log[].answers` is stored but only the first answer is surfaced in the UI.
- The source doc suggests a notebook left in the room for parts to leave
  messages between meetings — the tool exists as a label but does nothing.
- Meetings still require an API key or copy-prompt mode. A no-AI structured
  meeting (each seated part answered by *you*, in turn) would match the
  questionnaire's zero-config path.

### 5. Smaller

- Session transcripts are reachable but plain; the panel has no empty state.
- The reference library has no search, and is not linked from the places its
  content is relevant (e.g. the 6 Fs from a check-in).
- `ui.js` is 2454 lines. Splitting the Table and Learn sections out would help,
  but only worth doing alongside the test harness.

---

## Questions for the owner

1. **Is this for you, or for other people too?** Everything so far assumes a
   single private user. Sharing it changes onboarding, the safety copy, the
   default provider story, and whether an install prompt is worth building.
2. **Which phone?** iOS and Android need different install work, and iOS is
   where the icon and storage-eviction problems bite.
3. **Do you want a no-AI path all the way through?** The questionnaire, map and
   table all work with zero configuration, but *meetings* still need a key or
   the copy-prompt detour. Closing that gap makes the app fully usable offline.
4. **Should the slug drift in the private repo be fixed?** Seven edges currently
   don't draw. It is a mechanical fix to five files, and it is your data.
5. **How much should the app teach?** The reference library is currently opt-in
   via the ⓘ. It could surface contextually — the 6 Fs during a check-in, legacy
   burdens when a part looks inherited — at the cost of being chattier.
6. **Is anything else meant to be in here?** A previous session mentioned code
   from another AI tool that was never found; every commit in this repo is
   accounted for by you or Claude.
