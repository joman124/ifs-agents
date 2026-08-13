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

  /* The % has to describe the part, not the flags. A profile typed in by
     hand or imported as markdown arrives full of content with every flag
     still untouched; it used to read 0%. */
  var blank = part("Blank");
  t.eq(S.coverageScore(blank), 0, "a part with nothing in it scores zero");

  var filled = part("Filled", {
    positive_intent: "keep the person safe",
    emotions: ["vigilance", "contempt"],
    fears: ["being seen"], hopes_goals: ["rest"], behaviors: ["rehearses"],
    origin: "a spelling bee", unburdened_vision: "an editor",
    age: "about forty", location: "behind the eyes", trust_in_self: "low"
  });
  S.CATEGORIES.forEach(function (c) { filled.coverage[c] = "untouched"; });
  // terse entries on purpose: this proves content counts at all, and depth
  // weighting keeps a profile of stubs honestly short of half
  t.ok(S.coverageScore(filled) > 0.25,
    "content alone lifts the score clear of zero, with every coverage flag untouched");
  t.ok(S.coverageScore(filled) < 0.5,
    "but a profile of one-word stubs does not reach the table on its own");
  t.ok(S.coverageScore(filled) > S.coverageScore(blank),
    "and a part that holds more reads higher than one that holds nothing");

  /* per-category, the number tracks the fields that category is made of */
  t.eq(S.dataScore(blank, "positive_intent"), 0, "no intent recorded scores zero");
  t.ok(S.dataScore(filled, "positive_intent") > 0.5, "an intent recorded carries the category");
  t.ok(S.dataScore(filled, "emotions_feelings") < 1,
    "two one-word emotions do not fill a category by themselves");
  t.ok(S.dataScore(part("Two", { emotions: ["vigilance", "contempt"] }), "emotions_feelings") >
       S.dataScore(part("One", { emotions: ["vigilance"] }), "emotions_feelings"),
    "each further signal adds to the category");

  /* explored but thin still counts - the flag is the other honest signal */
  var explored = part("Explored");
  S.CATEGORIES.forEach(function (c) { explored.coverage[c] = "untouched"; });
  explored.coverage.history_origin = "complete";
  t.ok(S.coverageScore(explored) > 0,
    "a category explored to completion counts even if little was recordable");

  /* nobody's part may lose ground: the score can only ever be at or above
     what the coverage flags alone would have given */
  var flagsOnly = function (p) {
    var pts = 0, denom = 0;
    S.CATEGORIES.forEach(function (c) {
      if (p.coverage[c] === "declined") return;
      denom += 1;
      pts += p.coverage[c] === "complete" ? 1 : (p.coverage[c] === "partial" ? 0.5 : 0);
    });
    return denom ? pts / denom : 0;
  };
  [blank, filled, explored, scored].forEach(function (p) {
    t.ok(S.coverageScore(p) >= flagsOnly(p) - 1e-9,
      p.name + " never scores below what its coverage flags alone gave");
  });

  /* --- depth, not just presence --- */
  var stub = part("Stub", { emotions: ["sad", "mad", "glad"] });
  var told = part("Told", { emotions: [
    "a dread that arrives before the meeting does",
    "contempt it wears so nobody sees the fear underneath",
    "tiredness it will not admit to out loud"
  ] });
  t.ok(S.dataScore(told, "emotions_feelings") > S.dataScore(stub, "emotions_feelings"),
    "three sentences count for more than three one-word stubs");
  t.ok(S.dataScore(stub, "emotions_feelings") > 0, "but stubs still count for something");
  t.eq(S.signalWeight(true), 1, "a flag that is simply set counts whole");
  t.ok(S.signalWeight("shame") < S.signalWeight("a shame that arrives before anyone speaks"),
    "a word weighs less than a thought");

  /* --- the green light is the same measure as the ring --- */
  var ready = part("Ready", { positive_intent: "protection" });
  t.eq(S.readiness(ready).ready, false, "an intent alone does not open the table");
  t.ok(S.readiness(ready).missing.join(" ").indexOf("%") >= 0,
    "and what is missing is stated as the same percentage the ring shows");

  var developed = part("Developed", {
    positive_intent: "keep the person from being humiliated again",
    age: "older than the person is", location: "behind the eyes, reading along",
    origin: "the first time being wrong happened in front of other people",
    emotions: ["a vigilance that never fully sets down", "contempt worn as armour"],
    fears: ["that easing off makes the shame visible to everyone"],
    hopes_goals: ["work that nobody can find fault with"],
    behaviors: ["rehearses the conversation before it happens"],
    wants_needs: ["acknowledgement that the standards kept the person safe"],
    unburdened_vision: "an editor rather than a censor",
    trust_in_self: "low"
  });
  t.eq(S.readiness(developed).ready, true, "a part with enough of itself written down can join the table");
  t.ok(S.readiness(developed).score >= 0.5, "and the light agrees with the number the ring shows");
  t.eq(S.readiness(part("Nameless")).ready, false, "an empty part is never ready");

  /* the two must never disagree - that mismatch is what this replaced */
  [blank, filled, explored, stub, told, developed, ready].forEach(function (p) {
    var r = S.readiness(p);
    if (r.ready) t.ok(S.coverageScore(p) >= 0.5, p.name + ": a lit green light means at least 50%");
    else t.ok(!p.name || !p.positive_intent || S.coverageScore(p) < 0.5,
      p.name + ": an unlit light means something real is missing");
  });

  t.eq(S.initial("The Final Boss"), "F", "the ring letter skips a leading article");
  t.eq(S.slugify("  Won't Stop!  "), "wont-stop", "slugify strips punctuation and edges");
};
