# ifs-agents

**An agent templating system based on Internal Family Systems (IFS).** Interview
your inner parts through guided LLM sessions, build evolving written profiles of
each part — its qualities, fears, hopes, and relationships to the other parts —
and then spawn those parts as AI agents that react to any dataset, document, or
decision through their own lens, individually or around a shared table.

This repo ships **no specific parts**. It ships the flow: the question protocol,
the profile schema, the safety rails, and the compilation step that turns a
developed profile into a runnable agent. Your parts are yours.

> **This is not therapy.** It is a self-exploration and journaling tool that
> borrows IFS structure. It deliberately excludes therapeutic depth work
> (no trauma processing, no unburdening). Read [docs/safety.md](docs/safety.md)
> before you start. If you are in crisis, use a crisis line (988 in the US), not
> this tool.

## IFS in 30 seconds

IFS (Richard Schwartz) holds that everyone has an inner system of **parts** —
subpersonalities with their own ages, feelings, jobs, and relationships:
**managers** (proactive protectors), **firefighters** (reactive protectors), and
**exiles** (young hurt parts the protectors shield). Beneath them all is
**Self** — calm, curious, compassionate — the system's natural leader. Every
part has a positive intent; there are no bad parts. Longer version:
[docs/ifs-primer.md](docs/ifs-primer.md).

## How it works

```
  ┌────────────────┐    ongoing     ┌────────────────────┐
  │ intake session │──────────────▶│  part profile       │
  │ (meet a part)  │   check-ins    │  parts/<name>.md    │◀── relationship
  └────────────────┘                │  (md + YAML,        │    mapping
                                    │   grows over time)  │    (swarm graph)
                                    └─────────┬──────────┘
                                     readiness gate
                                              ▼
                                    ┌────────────────────┐
                                    │  compiled agent     │
                                    │  part-<name>.md     │
                                    └─────────┬──────────┘
                     your dataset / document / decision
                                              ▼
                                    ┌────────────────────┐
                                    │  table meeting      │
                                    │  each part reacts,  │
                                    │  Self synthesizes   │
                                    └────────────────────┘
```

1. **Intake** — a guided interview (permission-first, one question at a time)
   meets one part and writes its profile.
2. **Check-ins** — short ongoing sessions deepen the profile over weeks. A
   per-category `coverage` map tracks what's been explored, what's partial, and
   what the part has *declined* — declined topics stay closed. Protectors set
   the pace; there is no finish line.
3. **Mapping** — pairwise sessions capture how parts relate: who protects whom,
   who's allied, who's polarized. Edges are written symmetrically into both
   profiles, and the whole swarm renders as a Mermaid graph.
4. **Compile** — once a profile clears a minimum-development bar, it compiles
   into a self-contained agent prompt that embodies the part's voice and lens,
   with hard safety rules baked in.
5. **Meet** — point the swarm at any dataset. Each part responds in character
   (as parallel subagents in Claude Code); a Self-led synthesis names
   agreements, polarizations, needs, and a recommendation — for *you* to decide.

## Quickstart A — Claude Code

Install as a plugin (or clone and add the `skills/` to your project), then from
any project directory:

```
/part-intake                      # meet a new part → parts/<name>.md
/part-checkin <name>              # short ongoing session; deepens the profile
/part-map                         # map relationships between two parts + swarm graph
/part-compile <name>              # profile → .claude/agents/part-<name>.md
/parts-meeting <path-to-dataset>  # all compiled parts react; Self synthesizes
```

A typical first arc: one intake (10–20 min), two or three check-ins across a
couple of weeks, a second part's intake, one mapping session — then your first
table meeting over something real (a budget CSV, a job offer, a draft essay).

## Quickstart B — any LLM (no tooling)

The `templates/` files are self-contained prompts:

| Do this | Paste this into a chat |
|---|---|
| Meet a new part | [templates/interview-intake.md](templates/interview-intake.md) — save the profile it produces |
| Continue with a part | [templates/interview-checkin.md](templates/interview-checkin.md) + the saved profile |
| Map two parts | [templates/relationship-mapping.md](templates/relationship-mapping.md) + both profiles |
| Have a part react to material | [templates/embody-part.md](templates/embody-part.md) + profile + the material |
| Hold a table meeting | [templates/table-meeting.md](templates/table-meeting.md) + 2+ profiles + the material |

## Repo layout

| Path | What it is |
|---|---|
| `templates/` | The portable prompts — the heart of the system |
| `schema/part-schema.md` | Canonical profile schema, edge types, coverage model, compile-readiness bar |
| `skills/` | Claude Code slash-command wrappers around the templates |
| `docs/ifs-primer.md` | IFS concepts as used here |
| `docs/safety.md` | Boundaries, when to stop, privacy — **read this** |
| `docs/source/` | The source question set this system was built from |
| `examples/` | A fully fictional sample part ("The Critic") and its compiled agent |
| `parts/`, `sessions/` | **Your** data — created at use time, gitignored, never shipped |

## Privacy

Part profiles are intimate. `parts/`, `sessions/`, and compiled
`.claude/agents/part-*.md` are gitignored here — keep them out of shared repos,
and remember that anything pasted into a hosted LLM is subject to that
provider's data policies. Details in [docs/safety.md](docs/safety.md).

## Credits & license

IFS concepts originate with Richard C. Schwartz and the
[IFS Institute](https://ifs-institute.com/); the table-meeting format is modeled
on Fraser's Table. This repo is an independent self-exploration tool and is not
affiliated with or endorsed by the IFS Institute.

MIT License — see [LICENSE](LICENSE).
