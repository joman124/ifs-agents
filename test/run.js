#!/usr/bin/env node
/* Inner Table — safety tests.
 *
 *   node test/run.js
 *
 * No dependencies, no build, no browser. Loads the app's pure modules into a
 * fake `window` and asserts on the logic that has actually gone wrong before:
 * parsing profiles, merging them, and normalising untrusted input. Every
 * fixture is public — examples/parts/the-critic.md, or generated here.
 *
 * Scope, honestly: this covers data integrity, not the UI. Views, sheets,
 * panels, the map and the table flows are not exercised. It will catch a
 * profile being silently mangled or overwritten; it will not catch a button
 * that stopped working.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..");
const JS = path.join(ROOT, "app", "js");

global.window = {};
["schema.js", "questions.js", "markdown.js"].forEach(function (f) {
  new Function("window", fs.readFileSync(path.join(JS, f), "utf8"))(global.window);
});
const S = window.IFS.schema, Q = window.IFS.questions, MD = window.IFS.md;

const CRITIC = fs.readFileSync(path.join(ROOT, "examples", "parts", "the-critic.md"), "utf8");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  ok   " + name); passed++; }
  catch (e) { console.log("  FAIL " + name + "\n         " + e.message); failed++; }
}
function group(name) { console.log("\n" + name); }

/* ---------------------------------------------------------------- parsing */
group("Parsing and round-tripping a profile");

test("the shipped example parses", function () {
  const p = MD.parse(CRITIC);
  assert.strictEqual(p.name, "The Critic");
  assert.strictEqual(p.slug, "the-critic");
  assert.strictEqual(p.type, "manager");
  assert.strictEqual(p.coverage.introduction, "complete");
  assert.strictEqual(p.coverage.integration_harmony, "untouched");
  assert.strictEqual(p.sessions.length, 4);
  assert(p.narrative.in_its_own_words.indexOf("fine print") >= 0);
});

test("serialising and re-parsing changes nothing", function () {
  const p = MD.parse(CRITIC);
  assert.deepStrictEqual(MD.parse(MD.serialize(p)), p);
});

test("a '#' inside a quoted value is content, not a comment", function () {
  const p = MD.parse(mk({ name: '"Captain — #10"', age: '"about 7 # not literal"' }));
  assert.strictEqual(p.name, "Captain — #10");
  assert.strictEqual(p.age, "about 7 # not literal");
  assert.strictEqual(MD.parse(MD.serialize(p)).name, "Captain — #10", "and survives a round trip");
});

test("an unquoted trailing comment is still stripped", function () {
  const p = MD.parse(mk({ name: "Behemoth", type: "unknown   # still deciding" }));
  assert.strictEqual(p.type, "unknown");
});

test("an inline flow list is a list, not one string", function () {
  const p = MD.parse(mk({ name: "X", emotions: "[distrusting, paranoia]" }));
  assert.deepStrictEqual(p.emotions, ["distrusting", "paranoia"]);
});

test("a part that has not named itself still imports", function () {
  const p = MD.parse(mk({ name: "", type: "firefighter" }));
  assert.strictEqual(p.name, "(unnamed part)");
  assert.strictEqual(p.type, "firefighter");
});

test("genuine junk is still refused", function () {
  assert.throws(function () { MD.parse("---\nfoo: bar\n---\nhello"); }, /no name/i);
});

test("concatenated files parse as separate parts", function () {
  const blob = CRITIC + "\n\n" + mk({ name: "The Dreamer", type: "firefighter" });
  const found = MD.analyze(blob).profiles;
  assert.strictEqual(found.length, 2, "got " + found.length +
    " — one file's body must not swallow the next");
  assert.deepStrictEqual(found.map(function (p) { return p.slug; }), ["the-critic", "the-dreamer"]);
});

/* ---------------------------------------------------------------- merging */
group("Merging never loses data");

test("a thin reply cannot erase what is already stored", function () {
  const base = MD.parse(CRITIC);
  const thin = S.blankPart("The Critic");
  thin.fears = ["being blamed"];
  thin.coverage.introduction = "partial";          // a downgrade attempt
  const m = S.mergeParts(base, thin);
  assert.strictEqual(m.positive_intent, base.positive_intent, "intent survived");
  assert.strictEqual(m.age, base.age, "age survived");
  assert.strictEqual(m.narrative.origin_story, base.narrative.origin_story, "narrative survived");
  assert.strictEqual(m.coverage.introduction, "complete", "coverage never downgrades");
  assert(m.fears.indexOf("being blamed") >= 0, "the new fear was added");
  assert(m.fears.length > 1, "and the old ones kept");
  assert.strictEqual(m.relationships.length, base.relationships.length, "edges survived");
});

test("a declined topic stays declined", function () {
  const base = S.blankPart("A");
  base.coverage.relationships = "declined";
  const inc = S.blankPart("A");
  inc.coverage.relationships = "partial";
  assert.strictEqual(S.mergeParts(base, inc).coverage.relationships, "declined");
  inc.coverage.relationships = "complete";         // the part reopened it
  assert.strictEqual(S.mergeParts(base, inc).coverage.relationships, "complete");
});

test("folding two records of one part joins them rather than replacing", function () {
  const keep = MD.parse(CRITIC);
  const absorb = S.blankPart("The Inner Critic");
  absorb.narrative.origin_story = "A SECOND ACCOUNT";
  absorb.unburdened_vision = "";
  absorb.location = "";
  absorb.coverage.integration_harmony = "complete";
  absorb.sessions = [{ date: "2026-07-20", mode: "checkin", categories: [], note: "later" }];
  absorb.relationships = [{ part: "the-judge", type: "allied-with", notes: "" }];

  const m = S.mergeDuplicate(keep, absorb);
  assert.strictEqual(m.slug, "the-critic", "the survivor's identity wins");
  assert(m.narrative.origin_story.indexOf("A SECOND ACCOUNT") >= 0, "the absorbed account is kept");
  assert(m.narrative.origin_story.indexOf(keep.narrative.origin_story.slice(0, 20)) >= 0,
    "and so is the survivor's");
  assert.strictEqual(m.coverage.integration_harmony, "complete", "coverage climbs");
  assert.strictEqual(m.sessions.length, keep.sessions.length + 1, "both logs kept");
  assert(m.relationships.some(function (r) { return r.part === "the-judge"; }), "absorbed edge kept");
  assert(m.relationships.some(function (r) { return r.part === "the-dreamer"; }), "survivor edge kept");
});

test("merging identical copies does not duplicate their content", function () {
  const a = MD.parse(CRITIC);
  const b = MD.parse(CRITIC);
  b.name = "The Inner Critic"; b.slug = "the-inner-critic";
  const m = S.mergeDuplicate(a, b);
  assert.strictEqual(m.narrative.origin_story, a.narrative.origin_story);
  assert.deepStrictEqual(m.fears, a.fears);
  assert.strictEqual(m.sessions.length, a.sessions.length);
});

/* ----------------------------------------------------- untrusted backups */
group("A hand-edited backup cannot break the app");

test("a part with no coverage map is repaired, not stored raw", function () {
  const p = S.normalizePart({ slug: "x", name: "Broken" });
  assert(p, "accepted");
  assert.strictEqual(p.coverage.introduction, "untouched", "given a full coverage map");
  assert.strictEqual(typeof p.narrative.origin_story, "string", "given a narrative");
  assert.doesNotThrow(function () { S.readiness(p); S.coverageScore(p); },
    "readiness and coverage must not throw — this is what bricked the Parts tab");
});

test("nonsense values are dropped rather than trusted", function () {
  const p = S.normalizePart({
    name: "X", type: "wizard", trust_in_self: "enormous",
    emotions: "not a list", coverage: { introduction: "bogus" },
    relationships: [{ part: "y", type: "invented" }, { part: "z", type: "allied-with" }],
    sessions: "nope", narrative: null
  });
  assert.strictEqual(p.type, "unknown");
  assert.strictEqual(p.trust_in_self, "unknown");
  assert.deepStrictEqual(p.emotions, []);
  assert.strictEqual(p.coverage.introduction, "untouched");
  assert.deepStrictEqual(p.relationships.map(function (r) { return r.part; }), ["z"]);
  assert.deepStrictEqual(p.sessions, []);
});

test("an entry with no name is rejected outright", function () {
  assert.strictEqual(S.normalizePart({ slug: "y" }), null);
  assert.strictEqual(S.normalizePart(null), null);
  assert.strictEqual(S.normalizePart("a string"), null);
});

test("a real profile survives normalisation unchanged", function () {
  const p = MD.parse(CRITIC);
  const n = S.normalizePart(JSON.parse(JSON.stringify(p)));
  assert.deepStrictEqual(n, p);
});

/* -------------------------------------------------------------- questions */
group("The question bank and the guided flow");

test("every question routes to a real field or section", function () {
  const secs = S.NARRATIVE_SECTIONS.map(function (s) { return s.key; });
  const scalars = ["name", "age", "location", "appearance", "origin",
                   "positive_intent", "unburdened_vision"];
  const lists = ["emotions", "fears", "hopes_goals", "behaviors", "wants_needs"];
  let n = 0;
  S.CATEGORIES.forEach(function (c) {
    assert(secs.indexOf(Q.SECTION_FOR[c]) >= 0, c + " has a real default section");
    Q.forCategory(c).forEach(function (q) {
      n++;
      if (q.field) assert(scalars.indexOf(q.field) >= 0, q.field + " is a real field");
      if (q.list) assert(lists.indexOf(q.list) >= 0, q.list + " is a real list");
      if (q.sec) assert(secs.indexOf(q.sec) >= 0, q.sec + " is a real section");
    });
  });
  assert(n >= 30, "the bank is populated, got " + n);
});

test("the trauma question stays out of the self-serve bank", function () {
  assert(!/trauma/i.test(JSON.stringify(Q.QUESTIONS)),
    "a form has no interviewer to back off — see docs/safety.md");
});

test("check-ins target the thinnest category, never a declined one", function () {
  const p = S.blankPart("x");
  assert.strictEqual(Q.nextCategory(p), "introduction");
  p.coverage.introduction = "partial";
  assert.strictEqual(Q.nextCategory(p), "history_origin", "untouched beats partial");
  S.CATEGORIES.forEach(function (c) { p.coverage[c] = "complete"; });
  p.coverage.relationships = "declined";
  assert.strictEqual(Q.nextCategory(p), null, "declined is never targeted");
});

test("answers land in the profile and coverage stays honest", function () {
  const p = S.blankPart("Behemoth");
  const qs = Q.forCategory("emotions_feelings");
  const n = Q.applyAnswers(p, "emotions_feelings", [
    { def: qs[0], text: "shame" },
    { def: qs[1], text: "popping the joints" }
  ]);
  assert.strictEqual(n, 2);
  assert.deepStrictEqual(p.emotions, ["shame"]);
  assert.deepStrictEqual(p.behaviors, ["popping the joints"]);
  assert(p.narrative.what_activates_it.indexOf("popping") >= 0, "the section override fired");
  assert.strictEqual(p.coverage.emotions_feelings, "partial",
    "some answers is partial, not complete");
  Q.applyAnswers(p, "emotions_feelings", qs.map(function (d) { return { def: d, text: "x" }; }));
  assert.strictEqual(p.coverage.emotions_feelings, "complete", "all answers is complete");
});

/* ------------------------------------------------------------ small stuff */
group("Schema odds and ends");

test("circle initials skip articles and punctuation", function () {
  assert.strictEqual(S.initial("The Critic"), "C");
  assert.strictEqual(S.initial("The Final Boss"), "F");
  assert.strictEqual(S.initial("(unnamed part)"), "U");
  assert.strictEqual(S.initial("Captain — #10"), "C");
  assert.strictEqual(S.initial(""), "?");
});

test("every edge type has a legend tone and a mirror", function () {
  S.EDGE_TYPES.forEach(function (t) {
    assert(S.EDGE_TONE[t], t + " has a tone");
    assert(S.EDGE_MIRROR[t], t + " has a mirror");
    assert.strictEqual(S.EDGE_MIRROR[S.EDGE_MIRROR[t]], t, t + " mirrors back to itself");
  });
});

test("the readiness bar matches the schema", function () {
  assert(S.readiness(MD.parse(CRITIC)).ready, "the worked example clears it");
  assert(!S.readiness(S.blankPart("New")).ready, "a blank part does not");
});

/* ------------------------------------------------------------------ done */
console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);

/* Build a minimal profile file, overriding frontmatter lines by key. */
function mk(over) {
  const base = {
    name: "X", type: "unknown", age: '""', location: '""', appearance: '""',
    origin: '""', emotions: "[]", fears: "[]", hopes_goals: "[]", behaviors: "[]",
    wants_needs: "[]", positive_intent: '""', unburdened_vision: '""',
    trust_in_self: "unknown", relationships: "[]"
  };
  Object.keys(over).forEach(function (k) { base[k] = over[k]; });
  const lines = ["---"];
  Object.keys(base).forEach(function (k) { lines.push(k + ": " + base[k]); });
  lines.push("coverage:");
  S.CATEGORIES.forEach(function (c) { lines.push("  " + c + ": untouched"); });
  lines.push("sessions: []", "---", "", "# " + String(base.name).replace(/"/g, ""), "");
  S.NARRATIVE_SECTIONS.forEach(function (s) { lines.push("## " + s.title, ""); });
  return lines.join("\n");
}
