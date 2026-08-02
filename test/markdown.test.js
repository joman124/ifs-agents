/* parts/<slug>.md is the contract between this app and the Claude Code
   skills, so a round trip has to be lossless and the slug has to come from
   the name - never from a filename or a stale slug in the file. */
"use strict";
var H = require("./harness");

module.exports = function (t) {
  var env = H.load(["schema", "markdown"]);
  var S = env.IFS.schema, MD = env.IFS.md;

  var p = S.blankPart("The Watchman");
  p.type = "manager";
  p.age = "nine";
  p.origin = "the year of the move";
  p.positive_intent = "catch it before anyone else does";
  p.emotions = ["vigilance", "contempt"];
  p.fears = ["being caught out"];
  p.relationships = [{ part: "the-planner", type: "protects", notes: "steps in first" }];
  p.coverage.introduction = "complete";
  p.coverage.relationships = "declined";
  p.sessions = [{ date: "2026-01-02", mode: "intake", categories: ["introduction"], note: "first meeting" }];
  p.narrative.in_its_own_words = "I do not sleep.";
  p.narrative.session_notes = "### 2026-01-02\nQuieter than expected.";

  var round = MD.parse(MD.serialize(p));
  t.eq(round.name, p.name, "name survives the round trip");
  t.eq(round.slug, "the-watchman", "slug is derived from the name");
  t.eq(round.type, "manager", "type survives");
  t.eq(round.age, "nine", "an unquoted scalar survives");
  t.eq(round.emotions, p.emotions, "lists survive");
  t.eq(round.fears, p.fears, "single-item lists survive");
  t.eq(round.relationships, p.relationships, "edges survive with their notes");
  t.eq(round.coverage, p.coverage, "all nine coverage values survive");
  t.eq(round.sessions.length, 1, "the session log survives");
  t.eq(round.narrative.in_its_own_words, "I do not sleep.", "narrative sections survive");
  t.ok(round.narrative.session_notes.indexOf("Quieter than expected.") >= 0,
    "session notes survive with their dated heading");

  var empty = MD.parse(MD.serialize(S.blankPart("Bare")));
  t.eq(empty.emotions, [], "an empty list round-trips as an empty list, not a string");
  t.eq(empty.narrative.origin_story, "", "an untouched section round-trips as empty");

  /* --- the slug follows the name, whatever the file says --- */
  var stale = MD.parse([
    "---",
    'name: "The Wanderer Magician"',
    "slug: the-magician",
    "type: unknown",
    "---",
    "",
    "# The Wanderer Magician"
  ].join("\n"));
  t.eq(stale.slug, "the-wanderer-magician",
    "a stale slug in the file does not override the name");

  /* --- awkward text does not break the format --- */
  var tricky = S.blankPart('The "Fixer": #1');
  tricky.origin = "it said: no, not that";
  var trickyRound = MD.parse(MD.serialize(tricky));
  t.eq(trickyRound.name, 'The "Fixer": #1', "quotes, colons and hashes in a name survive");
  t.eq(trickyRound.origin, "it said: no, not that", "a colon inside a value survives");

  /* --- pulling a profile back out of a chat reply --- */
  var reply = "Thanks for today. Here is the updated profile:\n\n```markdown\n" +
    MD.serialize(p) + "\n```\n\nLet me know if that reads right.";
  var found = MD.extractProfiles(reply);
  t.eq(found.length, 1, "a profile is found inside a fenced block in a chat reply");
  t.eq(found[0].name, "The Watchman", "and parses correctly");

  t.eq(MD.extractProfiles("no profile here, just talking").length, 0,
    "ordinary prose yields no profiles");
  var analysed = MD.analyze("");
  t.ok(!!analysed.error, "empty input reports an error rather than importing nothing silently");
  t.eq(analysed.profiles, [], "and returns no profiles");

  t.throws(function () { MD.parse("# Just a heading"); }, "text with no frontmatter is rejected");

  /* --- YAML corners that have bitten before --- */
  function fm(fields) {
    var lines = ["---"];
    Object.keys(fields).forEach(function (k) { lines.push(k + ": " + fields[k]); });
    return lines.concat(["---", "", "# x"]).join("\n");
  }

  var hashy = MD.parse(fm({ name: '"Captain — #10"', age: '"about 7 # not literal"' }));
  t.eq(hashy.name, "Captain — #10", "a # inside a quoted value is content, not a comment");
  t.eq(hashy.age, "about 7 # not literal", "and so is one mid-value");
  t.eq(MD.parse(MD.serialize(hashy)).name, "Captain — #10", "which survives a round trip");

  t.eq(MD.parse(fm({ name: "Behemoth", type: "unknown   # still deciding" })).type, "unknown",
    "an unquoted trailing comment is still stripped");
  t.eq(MD.parse(fm({ name: "X", emotions: "[distrusting, paranoia]" })).emotions,
    ["distrusting", "paranoia"], "an inline flow list is a list, not one string");

  var unnamed = MD.parse(fm({ type: "manager", positive_intent: "keep watch" }));
  t.ok(!!unnamed.name, "a part that has not named itself still imports");
  t.eq(unnamed.positive_intent, "keep watch", "with everything else intact");
  t.throws(function () { MD.parse("---\nfoo: bar\n---\nhello"); },
    "but frontmatter with nothing profile-shaped in it is refused");

  var two = MD.extractProfiles(MD.serialize(p) + "\n" + MD.serialize(S.blankPart("The Planner")));
  t.eq(two.length, 2, "concatenated files parse as separate parts");
  t.eq(two.map(function (x) { return x.slug; }), ["the-watchman", "the-planner"],
    "and one file's body does not swallow the next");

  /* --- the committed example still imports ---
     It opens with an HTML comment saying it is fictional, and frontmatter has
     to come first. That is the case the first run of this suite found. */
  var raw = H.readExample("examples/parts/the-critic.md");
  var critic = MD.parse(raw);
  t.eq(critic.slug, "the-critic", "the fictional example parses despite its comment header");
  t.eq(Object.keys(critic.coverage).length, 9, "with a full coverage block");
  t.ok(!!critic.positive_intent, "and a positive intent");
  t.eq(MD.extractProfiles(raw).length, 1, "and imports through the paste path too");
};
