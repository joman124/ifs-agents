/* The question bank feeds both the tap-through questionnaire and the AI
   prompts, so what it routes and what it refuses to re-ask is a contract. */
"use strict";
var H = require("./harness");

module.exports = function (t) {
  var env = H.load(["schema", "questions"]);
  var S = env.IFS.schema, Q = env.IFS.questions;

  /* --- what a check-in goes for next --- */
  var p = S.blankPart("The Critic");
  t.eq(Q.nextCategory(p), "introduction", "an untouched part starts at the beginning");

  p.coverage.introduction = "partial";
  t.eq(Q.nextCategory(p), "history_origin", "untouched ground comes before revisiting partial ground");

  S.CATEGORIES.forEach(function (c) { p.coverage[c] = "complete"; });
  p.coverage.emotions_feelings = "partial";
  t.eq(Q.nextCategory(p), "emotions_feelings", "with nothing untouched left, the thinnest partial is next");

  S.CATEGORIES.forEach(function (c) { p.coverage[c] = "declined"; });
  t.eq(Q.nextCategory(p), null, "a declined category is never offered again");

  var mixed = S.blankPart("Mixed");
  mixed.coverage.introduction = "declined";
  t.eq(Q.nextCategory(mixed), "history_origin", "declined is skipped, not returned to");

  /* --- answers land in the right place --- */
  var target = S.blankPart("");
  var intro = Q.forCategory("introduction");
  var byQ = function (text) {
    for (var i = 0; i < intro.length; i++) if (intro[i].q.indexOf(text) === 0) return intro[i];
    return null;
  };

  var nameQ = byQ("What is your name");
  var needQ = byQ("Do you need anything");
  var tellQ = byQ("What do you want to tell us");
  t.ok(nameQ && needQ && tellQ, "the introduction questions are all present");

  var answered = Q.applyAnswers(target, "introduction", [
    { def: nameQ, text: "The Watchman" },
    { def: needQ, text: "quiet\nnotice" },
    { def: tellQ, text: "I do not sleep." },
    { def: byQ("How are you doing"), text: "   " }
  ]);
  t.eq(answered, 3, "a blank answer is not counted as answered");
  t.eq(target.name, "The Watchman", "a field question writes the scalar field");
  t.eq(target.wants_needs, ["quiet", "notice"], "a list question splits on lines");
  t.ok(target.narrative.in_its_own_words.indexOf("I do not sleep.") >= 0,
    "free text lands in the category's narrative section");
  t.ok(target.narrative.in_its_own_words.indexOf(tellQ.q) >= 0,
    "and carries the question it answered");
  t.eq(target.coverage.introduction, "partial", "some of a category answered is partial");

  var full = S.blankPart("Full");
  Q.applyAnswers(full, "history_origin", Q.forCategory("history_origin").map(function (def) {
    return { def: def, text: "something real" };
  }));
  t.eq(full.coverage.history_origin, "complete", "every question answered is complete");

  var none = S.blankPart("None");
  Q.applyAnswers(none, "history_origin", [{ def: Q.forCategory("history_origin")[0], text: "" }]);
  t.eq(none.coverage.history_origin, "untouched", "answering nothing changes no coverage");

  /* --- the safety exclusion is real, not just documented --- */
  var everything = S.CATEGORIES.map(function (c) {
    return Q.forCategory(c).map(function (x) { return x.q; }).join(" ");
  }).join(" ");
  t.ok(!/trauma/i.test(everything), "the source document's trauma question stays out of the bank");
  t.ok(S.CATEGORIES.every(function (c) { return Q.forCategory(c).length > 0; }),
    "every coverage category has questions to ask");
};
