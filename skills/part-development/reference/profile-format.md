# The part profile format

The file the Inner Table app imports and the ifs-agents skills read:
`parts/<slug>.md`, where the slug is the part's name in kebab case
(`The Critic` → `the-critic.md`). One file per part.

Two halves: YAML frontmatter for structured attributes, six fixed narrative
sections for the part's own words.

## Skeleton

```markdown
---
name: The Critic
type: manager                 # manager | firefighter | exile | unknown
age: "about 14"
location: "behind the eyes"
appearance: "a thin figure with a red pen"
origin: "appeared around 8th grade, after a science fair"
emotions:
  - vigilance
  - "dread (hidden)"
fears:
  - "if I stop checking, we get humiliated again"
hopes_goals: []
behaviors: []
wants_needs: []
positive_intent: "keep the person safe from public humiliation"
unburdened_vision: "an editor consulted by invitation"
trust_in_self: growing        # unknown | none | low | growing | high
relationships:
  - part: the-dreamer
    type: polarized-with
    notes: "every big idea is a humiliation I have to prevent"
coverage:
  introduction: partial
  history_origin: partial
  emotions_feelings: untouched
  beliefs_motivations: untouched
  relationships: partial
  communication_needs: untouched
  positive_intent: partial
  changes_healing: untouched
  integration_harmony: untouched
sessions:
  - date: 2026-08-26
    mode: intake
    categories: [introduction, positive_intent]
    note: "imported from parts.xlsx, row 4"
---

# The Critic

## In its own words

## Origin story

## What activates it

## How it relates to other parts

## What it needs

## Session notes
```

## Fields

| Field | Shape | Notes |
|---|---|---|
| `name` | string | How the part wants to be called. Parts sometimes rename themselves; the file is renamed with them. |
| `type` | enum | `manager` \| `firefighter` \| `exile` \| `unknown`. Never force a label. |
| `age` | string | The part's *felt* age - "about 7", "ageless", "teenage". |
| `location` | string | Where it is embodied, in/on/around the body. |
| `appearance` | string | How it looks when visualized. |
| `origin` | string | One line. The full story goes in "Origin story". |
| `emotions` | list | Emotions it carries or represents. |
| `fears` | list | Including the protector question: what would happen if it stepped out of its role. |
| `hopes_goals` | list | What it hopes for, works toward. |
| `behaviors` | list | What it does, and when it activates. |
| `wants_needs` | list | What it wants from the person, from Self, from the process. |
| `positive_intent` | string | How it understands itself to be helping. Every part has one. |
| `unburdened_vision` | string | What it would do instead if it no longer had to play this role. |
| `trust_in_self` | enum | `unknown` \| `none` \| `low` \| `growing` \| `high`. |
| `relationships` | list of maps | `part` (slug), `type`, `notes`. |
| `coverage` | map | One status per category, below. |
| `sessions` | list of maps | Append-only log: `date`, `mode`, `categories`, `note`. |

### Relationship edge types

`protects`, `protected-by`, `polarized-with`, `allied-with`, `conflicts-with`.
Anything else is dropped on import.

Edges are meant to be symmetric: if A `protects` B, B's file gets
`protected-by` A. The other three mirror as themselves. A converter writing one
side should say so, so the other side can be added when that part is profiled.

### Coverage categories and statuses

Categories: `introduction`, `history_origin`, `emotions_feelings`,
`beliefs_motivations`, `relationships`, `communication_needs`,
`positive_intent`, `changes_healing`, `integration_harmony`.

Statuses:

- `untouched` - never asked.
- `partial` - some content recorded; more welcome later.
- `complete` - richly answered in session; only revisit if the part raises it.
- `declined` - the part chose not to go there. It stays closed; the app stops
  asking, and the category is excluded from the development score rather than
  counted as a gap.

An import records `partial` where content landed. `complete` is a statement
about an interview and should not be set from a spreadsheet.

### Session modes

`intake` | `checkin` | `mapping` | `meeting`. An import is logged as `intake`
with a note naming the source file and row, so where a profile came from stays
visible months later.

## The six sections

In this order, all present even when empty - the app matches them by title and
drops any section it does not recognize:

1. `## In its own words` - first-person statements, as close to verbatim as possible.
2. `## Origin story` - when it appeared, what was happening, what it stepped up to do.
3. `## What activates it` - triggers, cues, and what it does when activated.
4. `## How it relates to other parts` - prose companion to the `relationships` edges.
5. `## What it needs` - from the person, from Self, from other parts.
6. `## Session notes` - dated entries, newest first. Append; never rewrite.

## Values that need quoting

The importer reads a small YAML subset. Quote a scalar when it contains any of
`: # [ ] { } & * ! | > ' " % @` or a backtick, when it starts with `-`, or when
it has leading or trailing spaces. `"Captain: #10"` survives; `Captain: #10`
unquoted does not.

Newlines cannot appear inside a frontmatter scalar - collapse them to spaces,
or move the text into a narrative section. List entries take one line each.

## How developed is developed enough

The app shows a "% developed" ring per part, computed from both the coverage
flags and how much the profile actually holds - weighted by depth, so one-word
entries count for less than worked-through thoughts. At 50%, with a name and a
positive intent, a part can be compiled into an agent that speaks for itself.

A single spreadsheet row typically lands somewhere between 20% and 45%. That is
a healthy starting point for check-ins, not a defect - say so rather than
padding the profile to clear a bar.
