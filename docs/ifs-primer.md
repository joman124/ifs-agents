# IFS Primer

A working minimum of Internal Family Systems (IFS) concepts, as this repo uses
them. IFS was developed by Richard C. Schwartz; for the real thing, see the
[IFS Institute](https://ifs-institute.com/) or *No Bad Parts* (Schwartz, 2021).

## The core idea

Every person has an internal system of **parts** — "we" instead of "I." Parts
are subpersonalities with their own ages, feelings, beliefs, jobs, and
relationships to each other. This multiplicity is normal, not pathology.

The system can be thrown into unhealthy equilibrium by trauma or chronic stress:
parts get stuck in extreme roles they took on to survive something, and keep
running those strategies long after the danger has passed.

## Self

Beneath and between the parts, every person has a **Self** — a core of
consciousness that is not a part. Self has the power to restabilize the system.
The ideal is a system *led* by Self, with each part trusted, heard, and in a
healthy role.

You know Self is present by the **8 Cs**: Compassionate, Curious, Courageous,
Calm, Clear, Connected, Creative, Confident. If you're feeling toward a part
with curiosity and compassion, Self is home. If you feel flooded, hostile, or
merged with the part, another part has **blended** with you.

## Types of parts

- **Managers** — proactive protectors. They organize, plan, criticize,
  perfect, please, and control to keep painful material from ever being
  triggered. (The inner critic is usually a manager.)
- **Firefighters** — reactive protectors. When pain breaks through anyway, they
  do whatever stops it *now*: numbing, bingeing, raging, dissociating,
  distracting. Their methods are costly; their intent is protective.
- **Exiles** — young, hurt parts carrying the burdens (pain, shame, terror)
  that the protectors work so hard to keep locked away.

Every part — including the ones causing problems — has a **positive intent**.
No bad parts.

## Working rules (encoded throughout this repo)

1. All parts are welcome.
2. **We ask permission to communicate, always.**
3. **Protectors set the pace.** You don't go around a protector to reach what
   it protects; you earn its trust.
4. Parts will avoid overwhelming you if you communicate a boundary with them.
5. **Polarization**: two parts locked in opposing strategies, each escalating
   because the other exists (e.g., a strict manager vs. a rebellious
   firefighter). Mapped in this repo as `polarized-with` edges.
6. **Unblending** — the process of a part separating enough from Self that Self
   can relate *to* it. The **6 Fs**: Find, Focus, Flesh out, Feel toward,
   Befriend, Fear (what does it fear would happen if it stopped?). The interview
   templates walk this arc without naming it.
7. **Unburdening** — the therapeutic step where an exile releases what it
   carries. **This repo does not do unburdening.** That is therapy, done with a
   trained professional. Here, the `unburdened_vision` field only records what a
   part *says* it would do if it were free — its hope, in its words.

## Fraser's Table

A group format this repo's table meetings are modeled on: imagine a safe,
neutral meeting room with a table; invite parts to it — no part is forced;
use tools like a talking stick, flexible lighting, side rooms for parts that
want to observe without sitting; close with reflection and gratitude. The
`templates/table-meeting.md` protocol adapts this for part-agents responding to
a dataset.

## How this maps to the repo

| IFS concept | Repo artifact |
|---|---|
| A part | `parts/<slug>.md` profile |
| Getting to know a part (6 Fs arc) | `interview-intake.md` / `interview-checkin.md` |
| Part relationships & polarizations | `relationships:` edges + `relationship-mapping.md` |
| A part's voice | compiled agent (`embody-part.md` / `/part-compile`) |
| Self-led internal meeting | `table-meeting.md` / `/parts-meeting` |
| Protectors set the pace | `coverage` statuses incl. first-class `declined` |
