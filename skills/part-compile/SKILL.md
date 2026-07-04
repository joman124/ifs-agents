---
name: part-compile
description: Compile a developed IFS part profile into a runnable Claude Code subagent. Use when the user wants a part to become a spawnable agent ("compile the critic", "make this part an agent", "turn my parts into agents").
---

# Part Compile

Turn `parts/<slug>.md` into a runnable subagent at `.claude/agents/part-<slug>.md`
in the current project.

## Steps

1. Read `parts/<slug>.md` (no argument → list `parts/` and ask).
2. **Readiness gate** — verify against `${CLAUDE_PLUGIN_ROOT}/schema/part-schema.md`:
   - `name` set and `positive_intent` non-empty;
   - `coverage.introduction` and `coverage.positive_intent` each `partial` or `complete`;
   - at least two other categories `partial` or `complete`.

   If it fails, do **not** compile. Tell the user exactly which categories are
   missing and suggest `/part-checkin <slug>`. An under-interviewed part makes a
   hollow, confabulated agent.
3. Read `${CLAUDE_PLUGIN_ROOT}/templates/embody-part.md`. Generate
   `.claude/agents/part-<slug>.md` with:
   - Frontmatter: `name: Part - <Name>`, and a `description` saying when to
     spawn it (reacting to datasets/decisions as this part), plus read-only
     leanings — the agent analyzes material; it should not need write tools.
   - Body: a system prompt that **inlines** (a) the embodiment rules and hard
     safety rules from `embody-part.md` (part-not-person, no distress role-play,
     no harmful advice, defer to Self, not therapy), (b) the part's full profile
     content — frontmatter attributes and narrative sections — as its identity,
     and (c) the five-part output shape. The generated file must be
     self-contained: no runtime dependency on this plugin or the profile file.
4. Stamp the generated file with a header comment: source profile path, compile
   date, and the coverage map at compile time — so staleness is visible.
5. If a compiled agent already exists, recompiling over it is fine (profiles
   evolve); note in one line what changed materially.
6. Confirm the path and remind the user: after significant check-in sessions,
   recompile; and `/parts-meeting` can now include this part.

## Privacy

Generated part agents contain personal profile content. Ensure `.gitignore`
covers `.claude/agents/part-*.md` in shared repos; warn if it doesn't.
