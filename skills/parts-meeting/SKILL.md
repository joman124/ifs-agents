---
name: parts-meeting
description: Convene an IFS table meeting where compiled part-agents each react to a dataset or decision, followed by a Self-led synthesis. Use when the user wants their parts' perspectives on material ("what do my parts think of this", "table meeting", "run this by my parts").
---

# Parts Meeting

Fraser's-Table-style meeting: each compiled part responds to the material as a
real subagent; you facilitate as Self and synthesize.

## Steps

1. **Gather inputs.**
   - Material: the dataset/document/decision the user pointed at. If none given,
     ask. Read it yourself first so you can brief the parts compactly.
   - Attendees: list `.claude/agents/part-*.md`. If fewer than two exist, check
     `parts/` — profiled-but-uncompiled parts get a `/part-compile` suggestion;
     no parts at all gets `/part-intake`. Let the user confirm/trim the invite
     list (AskUserQuestion, multiSelect).
2. Read `${CLAUDE_PLUGIN_ROOT}/templates/table-meeting.md` — its ground rules
   bind the whole meeting (invitation not summons; talking stick; safety rules
   from embody-part apply to every part; Self may adjourn; not therapy).
3. **Opening round — spawn the parts in parallel.** One Agent call per attendee
   in a single message, each with `subagent_type` set to that part's agent and a
   prompt containing: the meeting agenda/question, the material (or the relevant
   excerpt), and the instruction to respond in its five-part output shape.
   Note: when running on a claude-fable-5 session, pass an explicit `model` on
   every Agent call (spawns fail otherwise).
4. **Discussion round.** From the profiles' `relationships` edges, pick the most
   relevant polarization or protective pair for this material. Run one focused
   exchange: send each side the other's opening statement via a follow-up
   message to the same agent (SendMessage), asking the protocol's polarization
   question ("what are you afraid would happen if X won this one?").
5. **Self synthesis** — as Self (8 Cs), present to the user, labeling each
   part's contribution as `[<Part Name>]`:
   - each part's position in brief, in its voice;
   - where they agree; where they're polarized on this material;
   - what each part needs;
   - a Self-led recommendation, clearly flagged as a synthesis for the person
     to decide on.
6. **Save the transcript** to `sessions/YYYY-MM-DD-table-<topic>.md` (create
   `sessions/` if needed): attendees/observers/decliners, each opening
   statement, the discussion exchange, the synthesis. Offer to append a
   `sessions` entry (`mode: meeting`) to each attendee's profile.

If a part-agent's response drifts into distress content, drop that thread,
note that the topic was too tender for this format, and continue without it.
