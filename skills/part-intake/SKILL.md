---
name: part-intake
description: Run a full IFS part intake interview and create a new part profile. Use when the user wants to meet, add, or profile a new inner part ("interview a part", "new part", "get to know my inner critic").
---

# Part Intake

Run the intake interview protocol and write the resulting profile.

## Steps

1. Read `${CLAUDE_PLUGIN_ROOT}/templates/interview-intake.md` and follow it as
   your interviewer instructions — the rules there (permission first, protectors
   set the pace, one question at a time, no trauma probing, no unburdening,
   crisis handling) are binding and override brevity or efficiency concerns.
2. Conduct the interview conversationally in chat. Use AskUserQuestion when
   offering the category menu (step 3 of the protocol) — categories as
   multiSelect options. Open-ended part answers should come as free chat text,
   not option picks.
3. When the session closes, create `parts/<kebab-case-name>.md` in the current
   working directory (create `parts/` if needed), using the structure from
   `${CLAUDE_PLUGIN_ROOT}/templates/part-profile.md`:
   - Fill only what was actually said; leave the rest empty/`unknown`.
   - Quote the part's own words in the narrative sections.
   - Set `coverage` honestly (`complete` | `partial` | `declined` | `untouched`).
   - Add one `sessions` entry: today's date, `mode: intake`, categories touched.
4. If `parts/<slug>.md` already exists, do not overwrite — tell the user and
   suggest `/part-checkin <slug>` instead.
5. Confirm the file path to the user, summarize coverage in one line, and
   mention the natural next steps: `/part-checkin <slug>` to deepen,
   `/part-compile <slug>` once the profile meets the readiness bar.

## Privacy

Part profiles are personal data. Never commit `parts/` to a shared repo; verify
the repo's `.gitignore` covers `parts/` if you are inside a git repository, and
warn the user if it doesn't.
