# Column headings → profile fields

How `scripts/row_to_part.py` reads a header row, and what to do when it reads
one wrongly. Headings are compared after lowercasing, dropping punctuation and
parenthetical hints, and removing filler words - so `Wants / Needs (list)`,
`WANTS AND NEEDS` and `wants_needs` are the same heading.

Matching runs in three passes: an exact match against the table below, then a
`--map` override, then a loose word-overlap match that only fires when three
quarters of a known heading's words are present. Anything left over is
`UNMAPPED` - kept verbatim in the profile's Session notes, never dropped.

## The table

| Field | Headings recognized |
|---|---|
| `name` | name, part name, part, the part, part title, called, what it calls itself, who, who is this part |
| `type` | type, part type, kind, manager/firefighter/exile, protector or exile, role type |
| `age` | age, felt age, how old, age of part |
| `location` | location, where in the body, body location, where it lives, where do you feel it, where I feel it, where felt, body, embodiment, where it sits, where it shows up in the body |
| `appearance` | appearance, what it looks like, looks like, image, how it presents, visual, form |
| `origin` | origin, when did it start, first appeared, when it appeared, beginning, history, started |
| `emotions` | emotions, emotion, feelings, feeling, what it feels, affect |
| `fears` | fears, fear, afraid of, what it is afraid of, worries, concerns, what would happen if it stopped |
| `hopes_goals` | hopes, goals, hope/goal, hopes and goals, what it hopes for, aims, wishes |
| `behaviors` | behaviors, behaviours, behavior, what it does, actions, strategies, how it acts, its job |
| `wants_needs` | wants, needs, wants/needs, wants and needs, what it wants, asks, requests |
| `positive_intent` | positive intent, positive intention, intent, intention, protective intent, how it helps, what it is trying to do, purpose, why it does this, protects by |
| `unburdened_vision` | unburdened, unburdened vision, unburdened role, if it did not have to, what it would do instead, released, without the role, if it were free |
| `trust_in_self` | trust in self, trust, trusts self, trust level, self trust |
| `relationships` | relationships, relationship, related parts, connections, links, other parts, relations |
| `enemies` → edges | enemies, enemy, who it fights, opposed by, adversaries, in conflict with, polarized with |
| `allies` → edges | allies, ally, friends, who it works with, allied with, supporters, gets along with |
| `protects` → edges | protects, who it protects, protecting, stands in front of, guards |
| `protected_by` → edges | protected by, who protects it, shielded by |
| `## In its own words` | in its own words, own words, quotes, quote, what it says, verbatim, its words, voice |
| `## Origin story` | origin story, backstory, full history, how it came to be, the story |
| `## What activates it` | what activates it, triggers, trigger, activation, when it shows up, what sets it off |
| `## How it relates to other parts` | how it relates to other parts, relationship notes, dynamics, relates to others |
| `## What it needs` | what it needs, unmet needs, needs from self |
| `## Session notes` | session notes, notes, note, comments, observations, journal, log, remarks |

Order matters where headings overlap. `Origin story` is checked before
`Origin`, and the `wants_needs` list before the `What it needs` section, so the
more specific reading wins instead of whichever happened to be tried first.

### Overriding

```bash
--map "Heading exactly as it appears=field"
--map "Heading=ignore"          # drop it entirely, notes included
```

Field names are the ones in the left column; narrative sections are written
`n:in_its_own_words`, `n:origin_story`, `n:what_activates_it`,
`n:relates_to_others`, `n:what_it_needs`, `n:session_notes`.

## How cell contents are read

**Lists** (`emotions`, `fears`, `hopes_goals`, `behaviors`, `wants_needs`)
split on newlines, semicolons, bullets and pipes - the separators someone
types on purpose. Commas only split when every resulting piece still reads as a
label - three words or fewer, 24 characters or fewer - because "if I stop
checking everything, we get humiliated again" is one fear with a comma in it,
not two fears. Leading bullets and numbering are stripped.

**Scalars** collapse internal newlines to spaces, since the format cannot carry
a line break inside a frontmatter value.

**`origin`** is special: a paragraph in that cell is a story, not a headline, so
anything over ~200 characters is trimmed to a one-line origin *and* copied
whole into the "Origin story" section.

**Placeholders** - `n/a`, `none`, `-`, `?`, `tbd`, `unknown`, `not sure` - are
read as empty, except in `type` and `trust_in_self`, where `none` and `unknown`
are real answers.

**Declined** - a cell starting `declined`, `refused`, `won't say`, `prefer not`
marks that category `declined`, but only if no other column answered the same
category. The wording is kept in the notes. A part that skipped one question
still spoke.

**Enums** are normalized, not invented. `Manager (proactive)` → `manager`;
`fire fighter` → `firefighter`. A value with no legal reading - "protector",
"medium" - leaves the field at `unknown` and is preserved verbatim in the
notes, with a warning printed. Guessing here would put a claim in the profile
that nobody made.

## Relationship columns

Spreadsheets rarely have a relationships column in the schema's shape. Three
common layouts all work:

| Sheet says | Becomes |
|---|---|
| `Enemies: The Dreamer` | `part: the-dreamer, type: conflicts-with` |
| `Allies: The Planner - we hand off` | `part: the-planner, type: allied-with, notes: we hand off` |
| `Relationships: the-dreamer: polarized-with - we escalate` | `part: the-dreamer, type: polarized-with, notes: we escalate` |

`Enemies` deliberately becomes `conflicts-with` rather than `polarized-with`:
polarization means two parts escalating each other into opposite extremes, and
a column heading does not establish that. A mapping session upgrades it.

In a general `Relationships` column, an entry that names no edge type is left
unparsed and kept in the notes - recording a relationship type nobody stated
would be an invention, and the app drops unknown types anyway.

Named parts are slugified (`The Dreamer` → `the-dreamer`) so edges line up with
those parts' own files. Check the spelling against the other rows: an edge to
`the-dreamer` and a part filed as `dreamer` will not connect on the map.

## Coverage inference

A category is marked `partial` when the row put content in one of its fields:

| Category | Fed by |
|---|---|
| introduction | name, type, age, location, appearance, In its own words |
| history_origin | origin, Origin story |
| emotions_feelings | emotions, What activates it |
| beliefs_motivations | fears, hopes_goals, behaviors |
| relationships | any edge column, How it relates to other parts |
| communication_needs | wants_needs, What it needs |
| positive_intent | positive_intent |
| changes_healing | unburdened_vision |
| integration_harmony | trust_in_self, How it relates to other parts |

Only content that actually landed counts. A `type` column holding "protector"
resolves to `unknown`, so it raises no flag - a coverage mark is a claim about
what is recorded, and there is nothing there to point at.

## A worked example

Row 4 of a sheet whose headers are
`Name | Type | Age | Where I feel it | Origin | Emotions | Fears | Enemies | Trust in Self | Quotes | Colour code`:

```
The Critic | manager | about 14 | behind the eyes |
appeared around 8th grade, after a science-fair project was mocked in front of
the whole class and it decided somebody had better read the fine print |
vigilance; contempt; dread (hidden) |
if I stop checking everything, we get humiliated again |
The Dreamer | growing | "You missed something. You always miss something." | red
```

produces `parts/the-critic.md` with `name`, `type`, `age`, `location` and
`trust_in_self` set; `emotions` as three entries; `fears` as one; a
`conflicts-with` edge to `the-dreamer`; the origin as a single frontmatter line
(had it run past ~200 characters it would also have been copied whole into
"Origin story"); the quote under "In its own words"; `introduction`, `history_origin`, `emotions_feelings`,
`beliefs_motivations`, `relationships` and `integration_harmony` at `partial`;
and, under "Session notes", a dated line recording that `Colour code: red` had
nowhere schema-shaped to go.
