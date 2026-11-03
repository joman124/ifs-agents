# Safety & Boundaries

Read this before using the system, and especially before sharing it with others.

## What this is — and is not

This is **IFS-informed inner work with an AI guide**: a way to get to know your
parts and, when they are willing, help them change. It borrows the language,
structure and healing steps of Internal Family Systems (IFS). The guide is
**not a therapist**, not a substitute for one, and not a diagnostic instrument,
and nothing it says is clinical advice. It doesn't keep saying so in sessions
— repeating a disclaimer holds a person at arm's length — but it never claims
otherwise, and says plainly that it is an AI if asked.

Sessions can go past getting to know a part. A protector can be updated,
appreciated into trusting Self, and offered a different job. With the
protectors' permission, the person can meet an exile, witness what it wants
them to know, and — if it wants to — help it let go of what it carries. That
is the IFS healing sequence, and it is the same one self-guided IFS books
teach. What keeps it safe is the order and the consent, not a ceiling:
protectors are never gone around, and the guide never digs for memories.

Some people should do this work with a trained IFS practitioner
([directory at ifs-institute.com](https://ifs-institute.com/practitioners))
rather than alone — see *When to bring in a professional* below.

## Hard boundaries built into every template

1. **Permission, always.** The guide asks before starting and before each
   threshold. Anything can be declined, and declining is recorded and respected —
   `declined` topics are not re-raised.
2. **Protectors set the pace.** Hesitation is a protector speaking. The guide
   turns toward it — what is it worried would happen? — rather than pushing past
   it or ending the session. A protector's "no" stands. Partial profiles are
   the normal, expected state.
3. **Never dig for memories.** The guide never asks what happened, probes for
   details, or suggests what might have happened. A part's past is its own to
   show, at its own pace, and the guide only asks about the person's
   experience of witnessing it ("how do you feel toward it as it shows you
   that?").
4. **Healing follows the part.** Witnessing, retrieval and unburdening happen
   only when the protectors have agreed, the person feels compassion toward
   the exile (the feel-toward check), and the exile itself wants it. The guide
   offers; the part chooses. Any step can stop partway.
5. **No distress role-play.** When the AI voices a part (a reaction, a table
   meeting), it may name fears and say what hurts; it never escalates into
   panic, despair, self-harm content, or re-enacted trauma, and it never
   narrates an exile's memories.
6. **Self leads.** Any part-agent steps back when the person redirects it.
7. **Safety outranks the exercise.** Any mention of wanting to die, self-harm,
   harming someone, or being in danger — said as the person or as a part —
   stops the session for a plain, direct safety check and crisis resources.

## Flooding, and when to slow down

The guide does not wind a session down just because it is tender — tender is
often where the work is. It slows down when you are **flooded**: overwhelmed,
panicky, unreal, numb, or swamped. Then it grounds you first (feet on the
floor, a slow breath out), asks the part that is flooding to hold back just
enough that you can stay with it — parts usually can, when asked — and then
asks whether you want to go on or rest. If flooding keeps coming back, the
part needs a slower pace, and the work goes back to its protectors.

Feeling *moved* is normal. Feeling *overwhelmed* is the signal to ground and
slow down — and you can always stop.

## When to bring in a professional

- You lose time, find things you don't remember doing, or feel parts take you
  over completely. That is dissociation, and it belongs with a clinician who
  works with it; the guide will stay with gentle, present-moment work.
- Flooding keeps returning, however slowly you go.
- Sessions leave you consistently worse rather than more curious.

**If you are in crisis**, use a crisis line, not this tool — in the US, call or
text **988**; elsewhere, see
[findahelpline.com](https://findahelpline.com/).

## Privacy

Part profiles are intimate personal data.

- `parts/`, `sessions/`, and compiled `part-*` agents are **gitignored** in this
  repo's template. Keep it that way in your own copies.
- If you sync profiles anywhere, use a **private** repo or encrypted storage.
- Anything you paste into a hosted LLM is subject to that provider's data
  policies — check them before pasting profiles.
- Compiled agents *contain the profile text*. Treat generated
  `.claude/agents/part-*.md` files with the same care as the profiles.
- A **private link to your AI app**, made back when the app offered linking
  Claude, ChatGPT or Gemini, lets whoever holds it read your parts and your
  conversation notes, and save sessions into them (merged in — it cannot
  delete a part or erase a field). Conversation notes can be forgotten one by
  one under Settings → Session transcripts.
  Keep it private, and revoke it under Settings → Your own AI if it may have
  leaked.
- **Your own API key**, if you connected one back when the app took them, is
  kept with your account, encrypted, so your other devices are connected too;
  it is never readable through the private link. What you say in a session
  goes straight from your device to that provider (Anthropic, OpenRouter,
  OpenAI or Google) and falls under its data policy. Disconnect it under
  Settings → Your own AI, and revoke the key at the provider if it may have
  leaked.
- **The free AI** (where a deployment offers it) runs sessions for people
  with no AI of their own. What you say goes through the app's server to a
  FreeLLMAPI gateway that whoever runs the deployment hosts, and from there
  to whichever free-tier provider has room. Some free tiers keep what they
  are sent or use it to improve their models. The app says this once before
  your first session on it, and nothing goes to it before you agree. Say no
  and it hands you the session as a prompt to paste into an AI chat you
  already use. If you run a deployment, choose the gateway's providers with
  this in mind ([free-ai.md](free-ai.md)).
- **What the app counts.** When you are signed in, the server notes which
  days your account opened the app, so whoever runs the deployment can see
  how many people come back. It keeps, for each day, a list of pseudonymous
  ids (made from your username with a server secret, so the list holds no
  names), and the day your account was made. Nothing about what you write,
  which parts you have, or how long you stay is recorded, and there is no
  third-party analytics. Each day's list is deleted after 150 days. The
  Usage view shows only totals, and only to the accounts the deployment's
  owner names (`STATS_USERS`); it never says which account came back when.
  The lists sit on the deployment's own server, beside your parts, so
  whoever runs it holds the secret that could match an id back to a
  username - the same person who could already open your synced parts.
  Using the app signed out is not counted at all.

## For people using this with others

If you facilitate someone else's sessions (a friend, a coach, a client): the
same boundaries apply harder. Guiding someone else toward their exiles is
different from doing it for yourself: do not use this tool to do therapy you
are not qualified to do. If you are a clinician, this tool's output may be
material a client brings you — it is not a treatment protocol.
