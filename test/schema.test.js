/* The merge and coverage rules from docs/HANDOFF.md "Invariants". Every
   assertion here stands for a way the app has actually lost data before. */
"use strict";
var H = require("./harness");

module.exports = function (t) {
  var S = H.load(["schema"]).IFS.schema;

  function part(name, over) {
    var p = S.blankPart(name);
    Object.keys(over || {}).forEach(function (k) { p[k] = over[k]; });
    return p;
  }

  /* --- mergeParts: an omitted field means "not mentioned", never "delete" --- */
  var base = part("The Critic", {
    age: "12", positive_intent: "keep us from being humiliated",
    emotions: ["contempt", "fear"], type: "manager"
  });
  base.narrative.origin_story = "It arrived the year of the school move.";
  base.coverage.introduction = "complete";
  base.coverage.relationships = "declined";

  var incoming = part("The Critic", { emotions: ["fear", "shame"] });
  incoming.coverage.introduction = "partial";
  incoming.coverage.emotions_feelings = "partial";
  incoming.coverage.relationships = "partial";

  var m = S.mergeParts(base, incoming);
  t.eq(m.age, "12", "a field the model left out survives the merge");
  t.eq(m.positive_intent, "keep us from being humiliated", "positive intent is not wiped by an empty one");
  t.eq(m.type, "manager", "type falls back to the stored value when incoming is unknown");
  t.eq(m.emotions, ["contempt", "fear", "shame"], "lists union without duplicating");
  t.eq(m.narrative.origin_story, "It arrived the year of the school move.",
    "a narrative section the model omitted is kept");
  t.eq(m.coverage.introduction, "complete", "coverage never falls back down");
  t.eq(m.coverage.emotions_feelings, "partial", "coverage still climbs");
  t.eq(m.coverage.relationships, "declined", "declined is sticky against a partial");

  var reopened = part("The Critic");
  reopened.coverage.relationships = "complete";
  t.eq(S.mergeParts(base, reopened).coverage.relationships, "complete",
    "declined yields only to a complete answer - the part reopened it");

  /* --- mergeDuplicate: two records of one part, so nothing may be dropped --- */
  var keep = part("The Critic", { emotions: ["contempt"] });
  keep.narrative.in_its_own_words = "I am the one who checks.";
  keep.sessions = [{ date: "2026-01-02", mode: "intake", categories: [], note: "first" }];
  keep.relationships = [{ part: "the-critic-2", type: "allied-with", notes: "" },
                        { part: "the-planner", type: "protects", notes: "" }];

  var absorb = part("Critic (dup)", { emotions: ["fear"] });
  absorb.narrative.in_its_own_words = "Someone has to notice the mistakes.";
  absorb.slug = "the-critic-2";
  absorb.sessions = [{ date: "2026-01-05", mode: "checkin", categories: [], note: "second" }];
  absorb.relationships = [{ part: "the-dreamer", type: "polarized-with", notes: "" }];
  absorb.coverage.integration_harmony = "complete";

  var d = S.mergeDuplicate(keep, absorb);
  t.eq(d.slug, "the-critic", "the survivor's identity wins");
  t.eq(d.name, "The Critic", "including its name");
  t.eq(d.coverage.integration_harmony, "complete", "coverage climbs to the better of the two");
  t.ok(d.relationships.some(function (r) { return r.part === "the-dreamer"; }),
    "an edge only the absorbed record had is kept");
  t.ok(d.relationships.some(function (r) { return r.part === "the-planner"; }),
    "and so is one only the survivor had");
  t.ok(d.narrative.in_its_own_words.indexOf("I am the one who checks.") >= 0 &&
       d.narrative.in_its_own_words.indexOf("Someone has to notice the mistakes.") >= 0,
    "duplicate narratives are joined, not replaced");
  t.eq(d.sessions.length, 2, "both session logs survive a duplicate merge");
  t.eq(d.sessions[0].date, "2026-01-02", "sessions come back in date order");
  t.ok(!d.relationships.some(function (r) { return r.part === "the-critic-2"; }),
    "the edge between the two halves is dropped rather than pointing at itself");

  var joined = S.mergeDuplicate(keep, keep);
  t.eq(joined.narrative.in_its_own_words, "I am the one who checks.",
    "identical narratives are not doubled up");

  /* --- normalizePart: a hand-edited backup must not brick the Parts tab --- */
  t.eq(S.normalizePart(null), null, "null is not a part");
  t.eq(S.normalizePart({ slug: "x" }), null, "a part with no name is rejected");
  var raw = S.normalizePart({ name: "Half A Part", relationships: [
    { part: "the-planner", type: "protects" },
    { part: "", type: "protects" },
    { part: "the-ghost", type: "not-a-real-edge" }
  ] });
  t.eq(Object.keys(raw.coverage).length, S.CATEGORIES.length,
    "a part with no coverage block gets all nine categories");
  t.eq(raw.coverage.introduction, "untouched", "missing coverage defaults to untouched");
  t.eq(raw.narrative.session_notes, "", "a part with no narrative block still has every section");
  t.eq(raw.relationships.map(function (r) { return r.part; }), ["the-planner"],
    "edges with no target or an unknown type are dropped");
  t.eq(S.normalizePart({ name: "Odd", type: "wizard", trust_in_self: "enormous" }).type, "unknown",
    "an out-of-schema type falls back to unknown");
  t.eq(S.normalizePart({ name: "The Watchman" }).slug, "the-watchman",
    "slug derives from the name");

  /* --- scoring --- */
  var scored = part("Scored");
  S.CATEGORIES.forEach(function (c) { scored.coverage[c] = "untouched"; });
  scored.coverage.introduction = "complete";
  scored.coverage.relationships = "declined";
  var withDeclined = S.coverageScore(scored);
  scored.coverage.relationships = "untouched";
  t.ok(withDeclined > S.coverageScore(scored),
    "a declined topic is excluded from the score rather than counted as a gap");

  var ready = part("Ready", { positive_intent: "protection" });
  ready.coverage.introduction = "complete";
  ready.coverage.positive_intent = "complete";
  t.eq(S.readiness(ready).ready, false, "two touched categories are not enough on their own");
  ready.coverage.emotions_feelings = "partial";
  ready.coverage.history_origin = "partial";
  t.eq(S.readiness(ready).ready, true, "name, intent, both required categories and two more is ready");
  t.eq(S.readiness(part("Nameless")).ready, false, "an empty part is never ready");

  t.eq(S.initial("The Final Boss"), "F", "the ring letter skips a leading article");
  t.eq(S.slugify("  Won't Stop!  "), "wont-stop", "slugify strips punctuation and edges");
};
