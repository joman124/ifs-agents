---
name: part-development
description: Convert rows of a spreadsheet into IFS part profiles - one markdown file per part that uploads straight into the Inner Table app (ifs-agents.vercel.app) and feed the other ifs-agents skills. Use this whenever someone has parts, characters, or self-inventory data in an .xlsx, .csv or Google Sheet and wants markdown out of it - requests like "turn my parts spreadsheet into files", "convert row 4 into a part profile", "make these rows uploadable to the parts site", or "one file per part from this sheet". Use it too when a part .md needs checking before upload, or when a sheet's column headings need mapping onto the profile schema, even if the person never says "markdown" or names the format.
---

# Part Development

One row of a spreadsheet describes one inner part. This skill turns that row
into the profile format the Inner Table app and the ifs-agents skills both
read: `parts/<slug>.md`, YAML frontmatter over six narrative sections.

## What you are producing

A single markdown file per part. The frontmatter carries the structured
attributes (name, type, age, location, fears, hopes, relationships, coverage,
sessions); the body carries the part's own words. The full field list and the
allowed values are in `reference/profile-format.md` - read it before writing a
profile by hand, and any time a value looks like it might not be legal.

The format is exact in two places that are easy to get wrong: the six `##`
sections must all be present, in order, even when empty (the app matches
sections by title and drops anything else), and `type`, `trust_in_self`,
`coverage.*` and relationship `type` only accept fixed values - an invented one
is silently discarded on import. `scripts/row_to_part.py check <file>` catches
both.

## The two rules

**The header row is the schema.** A cell means whatever the word at the top of
its column says it means. That is the whole categorization step - resist the
urge to re-read a cell's content and decide it "really" belongs somewhere else.

**Nothing is invented.** An empty cell becomes an empty field, not a plausible
guess. `unknown` is a valid, honest value here; a profile is built up over many
sessions and gaps are expected. A fabricated fear reads back to the person as
something their part supposedly said, which is worse than a blank.

## Running the converter

`scripts/row_to_part.py` sits beside this file and needs nothing installed - an
.xlsx is a zip of XML, so it reads one with the standard library alone. Call it
with the path this skill was loaded from; inside a Claude Code project that has
the ifs-agents plugin, that is
`${CLAUDE_PLUGIN_ROOT}/skills/part-development/scripts/row_to_part.py`. The
examples below shorten it to `scripts/row_to_part.py`.

Google Sheets and Numbers files are not spreadsheets this can open - export to
`.xlsx` or `.csv` first.

## Workflow

### 1. Find the actual table

```bash
python3 scripts/row_to_part.py inspect <file.xlsx>
```

Sheets are rarely one clean table. There is usually a title, sometimes a
legend, sometimes a second block off to the side. The script splits the sheet
on blank rows, reads a header row out of each block, and ranks them by how many
headings look like profile fields - so the parts table wins even when it is not
first. **A single-cell row above a block is read as that block's title**, which
is usually the label that says which table this is; check that the title and
headers printed for table 1 are the ones the person meant, and pass
`--table "<title>"` or `--header-row N` if not.

If the first column is full of field names and each part occupies a column, the
sheet runs the other way - add `--transpose`, then select with `--col C`.

Also try `--sheet "<name>"` when the workbook has several sheets;
`inspect` lists them.

### 2. Agree the column mapping

`inspect` prints every heading and where it lands, including `UNMAPPED`.
Anything unmapped is kept verbatim in the profile's Session notes rather than
dropped, so no data is lost - but a heading that clearly means something the
schema has a home for should be mapped properly:

```bash
--map "Where I feel it=location" --map "Internal ref=ignore"
```

`reference/column-map.md` lists the headings recognized for each field, the
splitting rules, and how spreadsheet-shaped columns like `Enemies` and `Allies`
become relationship edges. Read it when a mapping looks wrong, when you are
choosing between two fields for an ambiguous heading, or when a sheet uses
vocabulary nothing in the list covers.

When a heading is genuinely ambiguous - "Notes" could be the part's own words
or the interviewer's observations - ask rather than guess. It costs one
question and saves a profile that misquotes somebody's part.

### 3. Convert

```bash
python3 scripts/row_to_part.py convert <file.xlsx> --row 4 --out parts/
python3 scripts/row_to_part.py convert <file.xlsx> --all --out parts/
```

Row numbers are the ones printed by `inspect`, which are the spreadsheet's own
row numbers - so `--row 4` is what the person sees as row 4. The script writes
`parts/<slug>.md`, prints what it mapped, and refuses to overwrite an existing
profile (a profile accumulates sessions; overwriting one throws that away).

### 4. Read the result back against the row

This is the step a script cannot do, and it is why this skill exists rather
than just a converter. Open the generated file next to the row and fix what
only judgment can:

- **Quotes belong in "In its own words", verbatim.** If a cell holds something
  the part actually said, it should appear as a quotation, not paraphrased into
  a frontmatter field.
- **A paragraph in a one-line field belongs below.** `origin` is a headline;
  the story goes in "Origin story". The script moves long origins for you -
  check that what it split still reads as two sensible pieces.
- **Prose that was crammed into a list should stay prose.** Three fears typed
  as one sentence are one entry, not three.
- **A behavior in the intent field is a behavior.** "Checks everything three
  times" is what the part does; "keeps us from being humiliated" is why. Move
  them if the sheet mixed them up.
- **Names of other parts should match the slugs of their own profiles**, so the
  app's map connects them instead of drawing edges to strangers.

Keep the person's wording throughout. Tidying a part's phrasing into
professional language is the most common way these files go wrong.

### 5. Check, then hand over

```bash
python3 scripts/row_to_part.py check parts/the-critic.md
```

Then tell the person what to do with the file. In the app
(**ifs-agents.vercel.app**): **Add a part → Upload or paste → Pick .md files**,
where several files can be selected at once. A profile whose name matches a
part they already have updates that part instead of duplicating it, and the
merge never lets an empty field overwrite something they already had. In a
project using the ifs-agents skills, the files go in `parts/` and
`/part-checkin <slug>` picks up from there.

Say plainly how developed the profiles are. A spreadsheet row usually lands
well below the bar where a part can be compiled into an agent, and that is
normal - it is a starting point for check-ins, not a finished profile.

## Judgment calls worth getting right

**Type.** `manager`, `firefighter`, `exile`, `unknown` are the only values. A
sheet that says "protector" has not said which kind of protector - leave
`unknown` and mention it, rather than picking. The raw word is preserved in the
notes either way.

**Coverage.** The script marks a category `partial` where the row put content
in it and leaves the rest `untouched`. Do not raise anything to `complete`:
that is a claim that a topic was explored richly in session, which a
spreadsheet cell cannot support. `declined` is for a cell that says the part
refused the topic - that is real information and the app will stop asking.

**Relationships.** `Enemies` becomes `conflicts-with`, not `polarized-with`.
Polarization means two parts escalating each other, which is a strong claim a
column heading does not make; a mapping session can upgrade it later.

**Rows that are not parts.** Legend rows, totals, blank template rows, and
"example" rows are common. Skip them and say which you skipped.

## Privacy

These profiles are personal, sometimes intimate. Write them where the person
asked, keep `parts/` out of shared repositories, and do not paste their content
into any service the person did not ask you to use. If the spreadsheet came
from a shared drive, mention that the profiles it produces are more sensitive
than the sheet was.

## When there is no spreadsheet

If the material is a journal entry, a chat log, or notes rather than a table,
this skill's converter has nothing to key on. Write the profile directly from
`reference/profile-format.md`, or point the person at the Inner Table app's
paste box, which turns raw notes into a profile through the same schema.
