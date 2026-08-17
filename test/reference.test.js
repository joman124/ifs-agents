/* The reference library and the two things that now reach into it: the
   first-run coach cues, and the daily check-in's rotating prompt.

   The cue integrity check is the point of this file. A cue whose `learn` id
   does not name a real page still renders perfectly - it just has a "Read
   more" button that opens nothing, which is invisible until someone taps it
   on their first day in the app. */
"use strict";
var H = require("./harness");

module.exports = function (t) {
  var R = H.load(["schema", "reference"]).IFS.reference;

  /* --- the library itself --- */
  var ids = R.LEARN.map(function (p) { return p.id; });
  t.eq(ids.length, new Set(ids).size, "every learn page has a distinct id");
  R.LEARN.forEach(function (p) {
    t.ok(!!p.title && !!p.blurb, p.id + " has a title and a blurb for the menu row");
    t.ok(p.body.length > 0, p.id + " has a body");
  });

  /* --- coach cues point at pages that exist --- */
  var cueIds = R.COACH.map(function (c) { return c.id; });
  t.eq(cueIds.length, new Set(cueIds).size, "every coach cue has a distinct id");
  R.COACH.forEach(function (c) {
    t.ok(ids.indexOf(c.learn) >= 0,
      "the '" + c.id + "' cue's Read more opens a page that exists (" + c.learn + ")");
    t.ok(!!c.title && !!c.text, "the '" + c.id + "' cue has something to say");
    t.ok(c.text.length < 400, "the '" + c.id + "' cue stays short enough to read in place");
  });

  /* The cues are mounted by id from ui.js; these are the five it asks for, so
     a rename here without a rename there would silently show nothing. */
  ["parts", "map", "table", "session", "meeting"].forEach(function (id) {
    t.ok(!!R.coach(id), "ui.js can still find the '" + id + "' cue");
  });
  t.eq(R.coach("no-such-cue"), null, "and an unknown id is null rather than a crash");

  /* --- the daily prompt --- */
  t.eq(R.ritualPrompt("2026-08-17"), R.ritualPrompt("2026-08-17"),
    "the same day asks the same question all day");
  t.ok(R.RITUAL_PROMPTS.indexOf(R.ritualPrompt("2026-08-17")) >= 0,
    "and it is one of the written prompts, not a derived string");

  var week = ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20",
              "2026-08-21", "2026-08-22", "2026-08-23"];
  var got = week.map(R.ritualPrompt);
  t.ok(new Set(got).size > 1, "and a different day asks a different question");

  /* Nothing stored, nothing to go wrong: the prompt is derived from the date
     string alone, so it survives a reload and an empty date does not throw. */
  t.ok(R.RITUAL_PROMPTS.indexOf(R.ritualPrompt("")) >= 0, "an empty date still yields a real prompt");

  R.RITUAL_PROMPTS.forEach(function (p) {
    t.ok(/\?$/.test(p), "every ritual prompt is a question: " + p);
  });
};
