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

  /* --- recency: what the map dims and the daily check-in picks --- */
  var TODAY = "2026-08-17";
  function seen(name, dates) {
    return part(name, {
      sessions: (dates || []).map(function (d) { return { date: d, mode: "checkin", categories: [], note: "" }; })
    });
  }

  t.eq(S.daysBetween("2026-08-10", TODAY), 7, "daysBetween counts calendar days");
  t.eq(S.daysBetween(TODAY, TODAY), 0, "the same day is zero days apart");
  t.eq(S.daysBetween("", TODAY), 0, "a missing date does not produce NaN");
  t.eq(S.lastSessionISO(seen("A", ["2026-06-01", "2026-08-01", "2026-07-01"])), "2026-08-01",
    "the last session is the newest one, not the last one appended");
  t.eq(S.lastSessionISO(part("Untouched")), "", "a part with no sessions has no last session");

  t.eq(S.partHeat(seen("Today", [TODAY]), TODAY), 1, "a part sat with today is at full heat");
  t.ok(S.partHeat(seen("Old", ["2026-01-01"]), TODAY) <= 0.12,
    "a part left alone for months sits at the floor");
  t.ok(S.partHeat(seen("Week", ["2026-08-10"]), TODAY) < S.partHeat(seen("Day", ["2026-08-16"]), TODAY),
    "heat decays with the days since the last session");
  t.ok(S.partHeat(part("New"), TODAY) > 0.12,
    "a part never interviewed is not cold from neglect - it was never warm");
  /* a stored date in the future (a clock skew, a hand-edited backup) must not
     read as hotter than today or the ring and the map disagree with reality */
  t.eq(S.partHeat(seen("Ahead", ["2026-12-01"]), TODAY), 1, "a future date is clamped to full, not beyond it");

  /* --- edge weight: how much has actually been said about a pair --- */
  function pair(aNotes, bNotes) {
    var x = part("A"), y = part("B");
    x.slug = "a"; y.slug = "b";
    if (aNotes != null) x.relationships = [{ part: "b", type: "polarized-with", notes: aNotes }];
    if (bNotes != null) y.relationships = [{ part: "a", type: "polarized-with", notes: bNotes }];
    return [x, y];
  }
  var unmapped = pair(null, null);
  t.eq(S.edgeWeight(unmapped[0], unmapped[1]), 0, "a pair nobody has mapped carries no weight");

  var oneSide = pair("", null);
  var bothBare = pair("", "");
  var bothDeep = pair(
    "Every time it eases off I have to work twice as hard to cover for us, and it never notices.",
    "It never stops pushing, and somebody has to give us a way out of the pressure it builds.");
  t.ok(S.edgeWeight(oneSide[0], oneSide[1]) > 0, "one side naming the relationship is still mapped");
  t.ok(S.edgeWeight(bothBare[0], bothBare[1]) > S.edgeWeight(oneSide[0], oneSide[1]),
    "both parts naming it outweighs one part doing all the talking");
  t.ok(S.edgeWeight(bothDeep[0], bothDeep[1]) > S.edgeWeight(bothBare[0], bothBare[1]),
    "two described accounts outweigh two bare type-picks");
  t.eq(S.edgeWeight(bothDeep[0], bothDeep[1]), 1, "a fully mutual, fully described pair tops out at 1");
  t.eq(S.edgeWeight(bothDeep[1], bothDeep[0]), S.edgeWeight(bothDeep[0], bothDeep[1]),
    "weight is symmetric - a thread has one thickness from either end");

  /* --- readings: how a part says it feels toward another, right now --- */
  var critic = part("The Critic"), dreamer = part("The Dreamer");
  critic.slug = "the-critic"; dreamer.slug = "the-dreamer";

  t.eq(S.getFeeling(critic, "the-dreamer"), null, "a part with no readings has none to give");
  t.eq(S.setFeeling(critic, "the-dreamer", 9, TODAY), null, "a rating off the scale is refused");
  t.eq(S.setFeeling(critic, "the-critic", 4, TODAY), null, "a part cannot rate itself");
  t.eq(critic.feelings, [], "and neither refusal leaves anything behind");

  S.setFeeling(critic, "the-dreamer", 2, "2026-08-10");
  var f1 = S.getFeeling(critic, "the-dreamer");
  t.eq([f1.rating, f1.rounds, f1.prev], [2, 1, 0], "a first reading starts at one round with nothing before it");

  S.setFeeling(critic, "the-dreamer", 4, TODAY);
  var f2 = S.getFeeling(critic, "the-dreamer");
  t.eq([f2.rating, f2.prev, f2.rounds, f2.date], [4, 2, 2, TODAY],
    "a second reading keeps the first as prev and climbs the round count");
  t.eq(critic.feelings.length, 1, "one entry per direction, not one per round");

  /* Directed and never mirrored: a reading is the rater's to give. */
  t.eq(S.getFeeling(dreamer, "the-critic"), null,
    "rating another part writes nothing to that part's own profile");
  S.setFeeling(dreamer, "the-critic", 1, TODAY);
  var both = S.pairFeeling(critic, dreamer);
  t.eq([both.ab, both.ba, both.sides], [4, 1, 2], "a pair reads both directions, in order");
  t.eq(S.pairFeeling(dreamer, critic).ab, 1, "and the other way round from the other end");
  t.eq(S.pairFeeling(critic, part("Stranger")).sides, 0, "an unrated pair has no sides");

  t.eq(S.feelingTone(5), "positive", "close reads as supportive");
  t.eq(S.feelingTone(1), "negative", "hostile reads as in tension");
  t.eq(S.feelingTone(3), "unknown", "neutral is not a tone - it is an answer");

  /* The point of the feature: a round of the table thickens the thread. */
  var r1 = part("R1"), r2 = part("R2");
  r1.slug = "r1"; r2.slug = "r2";
  t.eq(S.edgeWeight(r1, r2), 0, "an unmapped, unrated pair is still weightless");
  S.setFeeling(r1, "r2", 3, "2026-08-01");
  var oneRead = S.edgeWeight(r1, r2);
  t.ok(oneRead > 0, "one reading gives an unmapped thread substance of its own");
  S.setFeeling(r2, "r1", 3, "2026-08-01");
  var bothRead = S.edgeWeight(r1, r2);
  t.ok(bothRead > oneRead, "both sides answering outweighs one of them doing so");
  S.setFeeling(r1, "r2", 4, "2026-08-08");
  S.setFeeling(r2, "r1", 4, "2026-08-08");
  t.ok(S.edgeWeight(r1, r2) > bothRead, "a second round thickens the thread again");
  var runaway = r1, runaway2 = r2;
  for (var k = 0; k < 20; k++) {
    S.setFeeling(runaway, "r2", 5, TODAY);
    S.setFeeling(runaway2, "r1", 5, TODAY);
  }
  t.ok(S.edgeWeight(r1, r2) <= 1, "no number of rounds pushes a thread past full thickness");
  t.eq(S.edgeWeight(r1, r2), S.edgeWeight(r2, r1), "readings keep the weight symmetric");

  /* Written notes and readings are two accounts of one thread; a pair with
     both should read as better known than a pair with either. */
  var told = pair("Every time it eases off I have to work twice as hard to cover for us.", null);
  var toldWeight = S.edgeWeight(told[0], told[1]);
  S.setFeeling(told[0], "b", 2, TODAY);
  t.ok(S.edgeWeight(told[0], told[1]) > toldWeight,
    "a reading adds to what was already written about a pair");

  /* Tone: the named edge wins, and the readings speak only where nothing
     has been named. */
  t.eq(S.pairTone(told[0], told[1]), "negative", "a named edge takes its tone from its type");
  t.eq(S.pairTone(r1, r2), "positive", "an unnamed pair takes its tone from what the parts felt");
  t.eq(S.pairTone(part("X"), part("Y")), "unknown", "and an unasked pair has no tone at all");

  /* Merges must not lose a round: it is a meeting that actually happened. */
  var mBase = part("M"), mIn = part("M");
  mBase.feelings = [{ part: "the-dreamer", rating: 2, date: "2026-08-01", rounds: 3, prev: 1 },
                    { part: "the-planner", rating: 5, date: "2026-08-02", rounds: 1, prev: 0 }];
  mIn.feelings = [{ part: "the-dreamer", rating: 4, date: "2026-08-09", rounds: 1, prev: 0 }];
  var mm = S.mergeParts(mBase, mIn);
  var kept = mm.feelings.filter(function (f) { return f.part === "the-planner"; })[0];
  var folded = mm.feelings.filter(function (f) { return f.part === "the-dreamer"; })[0];
  t.ok(!!kept, "a reading the incoming profile never mentioned is kept, not deleted");
  t.eq(folded.rating, 4, "where both hold a direction, the later reading stands");
  t.eq(folded.rounds, 3, "but the round count only ever climbs");

  /* --- readings out of a hand-edited backup --- */
  var dirty = S.normalizePart({ name: "Dirty", feelings: [
    { part: "the-dreamer", rating: 4, date: "2026-08-09", rounds: 2, prev: 3 },
    { part: "the-dreamer", rating: 1, date: "2026-07-01", rounds: 5 },
    { part: "the-planner", rating: 11 },
    { part: "", rating: 3 },
    { rating: 2 },
    "not even an object"
  ] });
  t.eq(dirty.feelings.length, 1, "an off-scale, unnamed or malformed reading is dropped");
  t.eq(dirty.feelings[0].rating, 4, "a slug recorded twice keeps the later reading");
  t.eq(dirty.feelings[0].rounds, 5, "and the larger round count of the two");
  t.eq(S.normalizePart({ name: "None" }).feelings, [],
    "a profile with no feelings block still has an empty one");

  /* --- who the daily check-in offers first --- */
  var quiet = seen("Quiet", ["2026-02-01"]);
  var recent = seen("Recent", [TODAY]);
  t.eq(S.quietestPart([recent, quiet], TODAY).name, "Quiet", "the coldest part is the one offered");
  t.eq(S.quietestPart([], TODAY), null, "an empty library offers nobody");

  /* equally cold, so the less developed one is the more useful invitation */
  var coldBare = seen("Bare", ["2026-02-01"]);
  var coldFull = seen("Full", ["2026-02-01"]);
  coldFull.positive_intent = "keep us from being humiliated again";
  coldFull.emotions = ["vigilance", "contempt worn as armour", "a tiredness it will not admit to"];
  coldFull.narrative.origin_story = "It arrived the year of the school move, and never left.";
  t.eq(S.quietestPart([coldFull, coldBare], TODAY).name, "Bare",
    "between two equally quiet parts, the one with more left to say wins");
};
