---
name: part-checkin
description: Run an ongoing check-in session with an existing IFS part to deepen its profile. Use when the user wants to continue getting to know a part ("check in with the critic", "continue the interview", "talk to a part").
---

# Part Check-In

Deepen an existing part profile through a short ongoing session.

## Steps

1. Resolve the part: if an argument was given, read `parts/<slug>.md`. If not,
   list the files in `parts/` and let the user pick (AskUserQuestion). If the
   part doesn't exist, suggest `/part-intake`.
2. Read `${CLAUDE_PLUGIN_ROOT}/templates/interview-checkin.md` and follow it as
   your instructions. Key mechanics:
   - Honor previously stated needs and "next time" notes before any agenda.
   - Target the 1–2 lowest-coverage categories that are **not `declined`**.
   - Never raise `declined` topics unless the part does.
   - 3–5 questions, one at a time, permission at category boundaries.
3. Update `parts/<slug>.md` per the protocol's update rules:
   - Update frontmatter fields with changes; upgrade `coverage` honestly.
   - **Append** to `sessions` (date, `mode: checkin`, categories, note) and to
     "Session notes" — never rewrite or delete history.
4. Confirm what changed in one or two lines, including the new coverage picture,
   and whether the part now meets the compile readiness bar (see
   `${CLAUDE_PLUGIN_ROOT}/schema/part-schema.md`). If it does, mention
   `/part-compile <slug>`.

All interviewer safety rules from the intake protocol are binding here too.
