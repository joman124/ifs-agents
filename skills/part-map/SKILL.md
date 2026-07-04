---
name: part-map
description: Map relationships between IFS parts (polarizations, alliances, protection) and render the swarm graph. Use when the user wants to explore how parts relate ("map my parts", "how do these parts interact", "show the system").
---

# Part Map

Interview the person about how two (or more) profiled parts relate, write
symmetric relationship edges into both profiles, and render the swarm graph.

## Steps

1. List `parts/*.md`. Fewer than two parts → suggest `/part-intake` and stop.
2. Read `${CLAUDE_PLUGIN_ROOT}/templates/relationship-mapping.md` and follow it
   as your instructions. Use AskUserQuestion for pair selection (suggest the
   pair most co-mentioned in the profiles' narratives as the first option).
3. Interview each side of the pair per the protocol (permission first; watch for
   Self getting pulled into polarizations). Map one or two pairs per session.
4. Update **both** profiles for each mapped pair:
   - Mirrored `relationships` edges (`protects` ↔ `protected-by`; the symmetric
     types mirror as themselves), each side's note in its own words.
   - Upgrade both `coverage.relationships` honestly.
   - Append `sessions` entries (`mode: mapping`) and dated Session notes.
   - Add prose to each "How it relates to other parts" section.
5. Render the full-system Mermaid graph (every part in `parts/`, even unmapped
   ones; Self as a circle at top; `protects` directed, other edges undirected;
   one edge per mirrored pair). Show it in chat and also write it to
   `parts/system-map.md` so it survives the session.
6. Close: thank both parts, ask if observing parts want anything noted.

When unsure between `conflicts-with` and `polarized-with`, record
`conflicts-with` — polarization is a strong claim.
