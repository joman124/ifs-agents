# Part Profile Schema

This is the canonical definition of a part profile. Every template, skill, and
generated agent in this repo derives from this schema. A part profile is a single
Markdown file — YAML frontmatter for structured attributes, narrative sections below.

Files live in `parts/<slug>.md` (e.g., `parts/the-critic.md`). The slug is a
kebab-case version of the part's chosen name. `parts/` is personal data and is
**never committed** to a shared repo (see `.gitignore`).

## Design principles

1. **Unknown is a valid value.** Profiles are built over many sessions. Empty or
   `unknown` fields are honest, not broken. Never invent values to fill gaps.
2. **The part's words win.** Structured fields summarize; the narrative sections
   preserve the part's own language. When they conflict, the narrative is truer.
3. **Declining is first-class.** A part may refuse a topic. Record `declined` and
   don't re-ask every session — revisit only if the part signals willingness.
4. **Protectors set the pace.** The coverage map exists to guide *gentle* ongoing
   questioning, not to gamify completion.

## Frontmatter fields

The core attribute list comes directly from the source question set:
`(name; type; age; location; appearance; origin; emotion; fear; hope/goal;
behavior; enemies; allies; wants/needs; unburdened)`.

| Field | Type | Meaning |
|---|---|---|
| `name` | string | The part's name, or how it wants to be called. May change — parts sometimes rename themselves. |
| `type` | enum | `manager` \| `firefighter` \| `exile` \| `unknown`. Default `unknown`; never force a label. A part tells you what it is over time. |
| `age` | string | The part's *felt* age ("about 7", "ageless", "teenage"). |
| `location` | string | Where it's embodied — in, on, or around the body ("chest", "behind the eyes", "hovering to my left"). |
| `appearance` | string | How it looks/presents when visualized. |
| `origin` | string | When and why it first came into existence, in brief. Full story goes in the narrative. |
| `emotions` | list | Emotions it carries or represents. |
| `fears` | list | Its concerns and fears — including the key protector question: "what would happen if you stepped outside your role?" |
| `hopes_goals` | list | What it hopes for; what it's working toward. |
| `behaviors` | list | What it does and when it activates. |
| `wants_needs` | list | What it wants/needs from the person, from Self, from the process. |
| `positive_intent` | string | How it is trying to protect or help the person, in its own understanding. |
| `unburdened_vision` | string | What it would do instead if it no longer had to play this role. |
| `trust_in_self` | enum | `unknown` \| `none` \| `low` \| `growing` \| `high`. How much this part trusts Self to lead. Modulates the compiled agent's tone. |
| `relationships` | list | Typed edges to other parts — the swarm graph. See below. |
| `coverage` | map | Per-category interview status. Drives the ongoing-questions engine. See below. |
| `sessions` | list | Append-only session log. See below. |

### `relationships` entries

```yaml
relationships:
  - part: <other-part-slug>
    type: protects | protected-by | polarized-with | allied-with | conflicts-with
    notes: <one line in the part's words about this relationship>
```

Edges should be **symmetric**: if A `protects` B, B's file gets `protected-by` A.
`polarized-with`, `allied-with`, and `conflicts-with` mirror as themselves.
The relationship-mapping flow maintains this symmetry.

Edge types:
- `protects` / `protected-by` — a protector standing guard over (usually) an exile.
- `polarized-with` — two parts locked in opposing strategies (classic IFS polarization).
- `allied-with` — parts that cooperate or share goals.
- `conflicts-with` — friction that isn't a full polarization.

### `coverage` map

One status per interview question category (the nine categories of the question bank):

```yaml
coverage:
  introduction: untouched
  history_origin: untouched
  emotions_feelings: untouched
  beliefs_motivations: untouched
  relationships: untouched
  communication_needs: untouched
  positive_intent: untouched
  changes_healing: untouched
  integration_harmony: untouched
```

Statuses:
- `untouched` — never asked.
- `partial` — some questions answered; more welcome later.
- `complete` — richly answered; only revisit if the part brings it up.
- `declined` — the part chose not to go there. Respect it. Do not re-open unless
  the part volunteers.

The check-in flow targets the lowest-coverage **non-declined** categories.

### `sessions` log

Append-only. Never rewrite history.

```yaml
sessions:
  - date: 2026-07-03
    mode: intake          # intake | checkin | mapping | meeting
    categories: [introduction, positive_intent]
    note: <one line summary>
```

## Narrative body sections

After the frontmatter, in this order (empty sections stay present as placeholders):

```markdown
# <Name>

## In its own words
First-person statements from the part, quoted as close to verbatim as possible.

## Origin story
The fuller history: when it appeared, what was happening, what it stepped up to do.

## What activates it
Triggers, situations, and cues — and what it does when activated.

## How it relates to other parts
Prose companion to the `relationships` edges: dynamics, standoffs, alliances.

## What it needs
From the person, from Self, from other parts. Unmet needs it has named.

## Session notes
Reverse-chronological dated entries appended after each session.
```

## Compilation readiness

A part may be compiled into a runnable agent when **all** of the following hold:
- `name` is set and `positive_intent` is non-empty.
- `coverage.introduction` is `partial` or `complete`.
- `coverage.positive_intent` is `partial` or `complete`.
- At least **two** other categories are `partial` or `complete`.

Below this bar, the compile flow should decline and suggest a check-in session
instead. An under-interviewed part makes a hollow, confabulated agent.
