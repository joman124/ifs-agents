/* The small daily practice: a ten-second notice becomes part of a part's
   memory, progress is counted as IFS counts it (how the person feels toward
   a part, how often they sat with it, threads that warmed), and one rule
   says when a part can speak for itself - in words, not a percentage. */
"use strict";
var H = require("./harness.js");

module.exports = function (t) {
  var env = H.load(["schema", "markdown", "questions", "reference", "store", "templates"]);
  var S = env.IFS.schema, MD = env.IFS.md, ST = env.IFS.store, T = env.IFS.templates;
  ST.load();

  /* ---- a notice lives in the part's own session log ---- */
  var critic = S.blankPart("The Critic");
  t.eq(S.addNotice(critic, "   ", ""), null, "an empty notice records nothing");
  var e = S.addNotice(critic, "Loud  before the\nmeeting", "annoyed", "2026-10-01");
  t.eq(e, { date: "2026-10-01", mode: "notice", categories: [], note: "Loud before the meeting", feel: "annoyed" },
    "a notice is a dated session entry with the moment and the feeling");
  t.eq(S.addNotice(critic, "", "not-a-feeling", "2026-10-02"), null, "an unknown feeling word alone records nothing");
  S.addNotice(critic, "Quieter today", "curious", "2026-10-08");
  t.eq(S.towardPart(critic), { feel: "curious", date: "2026-10-08", times: 2 }, "the latest feeling toward it, and how often they sat with it");

  var back = S.normalizePart(JSON.parse(JSON.stringify(critic)));
  t.eq(back.sessions[1].feel, "curious", "the feeling survives sync");
  var md = MD.serialize(critic);
  var parsed = MD.analyze(md).profiles[0];
  t.ok(parsed && parsed.sessions[0].feel === "annoyed" && parsed.sessions[0].mode === "notice", "...and an export and re-import");

  /* through the store: kept, synced as an edit, and remembered by the next check-in */
  ST.upsertPart(S.blankPart("The Watcher"));
  var entry = ST.notice("the-watcher", "Scanning the room at dinner", "curious");
  t.ok(entry && ST.getPart("the-watcher").sessions.some(function (s) { return s.mode === "notice" && s.feel === "curious"; }), "the store keeps a notice on the part");
  t.eq(ST.notice("nobody-here", "x", "calm"), null, "a notice for a part that isn't there is refused");
  var ck = T.checkin(ST.getPart("the-watcher"), ST.listParts());
  t.ok(/Noticed between sessions/.test(ck) && /Scanning the room at dinner/.test(ck), "the next check-in starts from what was noticed");
  t.ok(/the person felt \*\*curious\*\* toward it/.test(ck), "...and knows how the person last felt toward it");

  /* ---- looking back: what IFS counts ---- */
  var dreamer = S.blankPart("The Dreamer");
  S.addNotice(dreamer, "Daydreaming in the meeting", "impatient", "2026-09-20");
  S.addNotice(dreamer, "Planning the trip", "warm", "2026-10-05");
  dreamer.sessions.push({ date: "2026-10-06", mode: "checkin", categories: [], note: "" });
  var old = S.blankPart("The Old One");
  old.sessions.push({ date: "2026-06-01", mode: "checkin", categories: [], note: "" });
  critic.feelings = [{ part: "the-dreamer", rating: 4, prev: 2, date: "2026-10-03", rounds: 2 }];
  var lb = S.lookBack([critic, dreamer, old], "2026-10-10", 30);
  t.eq(lb.sat.map(function (x) { return x.name + ":" + x.count; }), ["The Dreamer:3", "The Critic:2"], "who they sat with this month, most first");
  t.eq([lb.sessions, lb.notices], [1, 4], "sessions and notices are counted apart");
  t.eq(lb.shifts, [
    { slug: "the-critic", name: "The Critic", from: "annoyed", to: "curious", dir: "warmer" },
    { slug: "the-dreamer", name: "The Dreamer", from: "impatient", to: "warm", dir: "warmer" }
  ], "feelings toward parts that warmed over the month");
  t.eq(lb.threads, [{ from: "The Critic", to: "The Dreamer", was: 2, now: 4, dir: "warmer" }], "a thread between parts that warmed");
  t.eq(S.lookBack([old], "2026-10-10", 30).sat, [], "a part last met months ago is not in this month");

  /* ---- one rule for speaking, said as a next step ---- */
  var thin = S.blankPart("The Hurrier");
  var hint = S.unlockHint(thin);
  t.ok(!hint.ready && hint.category === "positive_intent" && /what it is trying to do for you/.test(hint.text), "with no positive intent, that is the next step");
  t.ok(!/%/.test(hint.text), "never as a percentage");
  var ready = H.makeReady(S.blankPart("The Planner"));
  t.ok(S.unlockHint(ready).ready, "a ready part has nothing missing");
};
