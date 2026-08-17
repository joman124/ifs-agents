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

  /* --- table meetings: turning one blob of prose into a room of people ---
     splitVoices feeds both the group-chat bubbles and the summary card that
     stays on the Table tab, so a change here shows up in both places. */
  var turn =
    "**The Critic:** This plan has three holes in it. I can name them.\n\n" +
    "**The Dreamer:** You always can. That is not the same as being right.\n\n" +
    "**Self:** Both of you are trying to protect the same thing.";
  var segs = MD.splitVoices(turn);
  t.eq(segs.length, 3, "each **Name:** marker starts a new voice");
  t.eq(segs.map(function (s) { return s.name; }), ["The Critic", "The Dreamer", "Self"],
    "and the names come through without their markers");
  t.ok(/three holes/.test(segs[0].text), "with the words that followed attached to the right speaker");

  t.eq(MD.splitVoices("just prose, nobody named").length, 1, "unmarked prose is one nameless segment");
  t.eq(MD.splitVoices("just prose, nobody named")[0].name, null, "and it is explicitly nameless");
  t.eq(MD.splitVoices("").length, 0, "an empty turn has no voices");
  t.eq(MD.splitVoices(null).length, 0, "and neither does a missing one");

  var lead = MD.splitVoices("The room settles.\n\n**Self:** Let's begin.");
  t.eq(lead.length, 2, "prose before the first name survives as its own segment");
  t.eq(lead[0].name, null, "as narration");
  t.eq(lead[1].name, "Self", "ahead of the first speaker");

  t.eq(MD.firstSentences("One. Two. Three. Four.", 2, 200), "One. Two.",
    "firstSentences stops at the sentence count asked for");
  t.ok(MD.firstSentences("a ".repeat(200), 3, 40).length <= 41,
    "and the hard cap holds when there is no sentence boundary");
  t.ok(/…$/.test(MD.firstSentences("a ".repeat(200), 3, 40)), "marking that it was cut");
  t.eq(MD.firstSentences("", 2, 100), "", "nothing in, nothing out");

  /* --- the summary card: where each part landed, not where it came in --- */
  var turns = [
    "**The Critic:** I refuse. This is sloppy.\n\n**The Dreamer:** You always say that.",
    "**The Critic:** Fine. I will hold the standard without swinging it. That is my offer.\n\n" +
    "**Self:** You are both guarding the same thing, from opposite ends."
  ];
  var sum = MD.summarizeMeeting(turns, ["The Critic", "The Dreamer"]);
  t.eq(sum.voices.length, 2, "one line per named part at the table");
  t.eq(sum.voices[0].name, "The Critic", "in the order the parts were seated");
  t.ok(/without swinging it/.test(sum.voices[0].line),
    "and it is the part's LAST word that is kept, not its first");
  t.ok(!/I refuse/.test(sum.voices[0].line), "so an opening refusal does not stand as the outcome");
  t.ok(/opposite ends/.test(sum.synthesis), "Self's closing read becomes the synthesis");
  t.ok(!sum.voices.some(function (v) { return /^self$/i.test(v.name); }),
    "and Self is not also listed as one of the parts");

  /* A card that leads with "Fine." has wasted the only two sentences it gets. */
  var concede = MD.summarizeMeeting(
    ["**The Critic:** Fine. I am afraid that if I stop, nobody catches it and we are humiliated again. " +
     "I will hold the standard without swinging it."], ["The Critic"]);
  t.ok(/^I am afraid/.test(concede.voices[0].line),
    "a concession fragment does not get to headline the summary line");
  t.ok(/without swinging it/.test(concede.voices[0].line),
    "so the part's actual position fits on the card");

  var allShort = MD.summarizeMeeting(["**The Critic:** No. Never."], ["The Critic"]);
  t.ok(allShort.voices[0].line.length > 0,
    "but a turn that is nothing but short sentences is not trimmed to nothing");

  var noSelf = MD.summarizeMeeting(["**The Critic:** Alone in here."], ["The Critic"]);
  t.eq(noSelf.synthesis, "", "a meeting Self never closed has no synthesis");
  var absent = MD.summarizeMeeting(["**The Critic:** Only me."], ["The Critic", "The Ghost"]);
  t.eq(absent.voices.length, 1, "a seated part that never spoke contributes no line");
  t.eq(MD.summarizeMeeting([], ["The Critic"]).voices.length, 0, "an empty meeting summarises to nothing");
};
