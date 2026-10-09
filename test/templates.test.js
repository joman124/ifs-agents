/* The session prompts are the product's heart and its import contract at
   once: whatever wording changes, every mode must build, the guide's
   safety rails must ride along, and a pasted-back profile must still be
   asked for in the exact shape the importer reads. */
"use strict";
var H = require("./harness");

module.exports = function (t) {
  var env = H.load(["schema", "markdown", "questions", "reference", "templates"]);
  var S = env.IFS.schema, T = env.IFS.templates;

  var critic = S.blankPart("The Critic");
  critic.coverage.introduction = "complete";
  critic.coverage.history_origin = "declined";
  var dreamer = S.blankPart("The Dreamer");
  var material = "Should I take the job in Lisbon?";

  var built = {
    intake: T.intake(),
    checkin: T.checkin(critic),
    mapping: T.mapping([critic, dreamer]),
    embody: T.embody(critic, material),
    meeting: T.meeting([critic, dreamer], material, null)
  };

  Object.keys(built).forEach(function (mode) {
    var p = built[mode];
    t.ok(typeof p === "string" && p.length > 500, mode + " builds a real prompt");
    t.ok(!/undefined|\[object Object\]/.test(p), mode + " has no unfilled values");
  });

  /* every interviewing mode carries the guide and the boundaries */
  ["intake", "checkin", "mapping"].forEach(function (mode) {
    var p = built[mode];
    t.ok(/How do you feel toward it right now\?/.test(p), mode + " asks the feel-toward question");
    t.ok(/step back a little/.test(p), mode + " knows what to do when a reactive part answers");
    t.ok(/No unburdening/.test(p), mode + " rules out unburdening");
    t.ok(/988/.test(p) && /findahelpline/.test(p), mode + " carries crisis resources");
    t.ok(/ask directly whether they are safe/.test(p), mode + " checks safety directly, even when a part says it");
    t.ok(/The app will tell you the session is closing\. When it does, respond with:/.test(p),
      mode + " keeps the close sentence the portable wrapper rewrites");
  });

  /* the check-in aims at the thin ground and stays off declined ground */
  t.ok(built.checkin.indexOf("thinnest on **History & origin**") < 0, "a declined category is never the check-in's aim");
  t.ok(/Is The Critic around today\?/.test(built.checkin), "the check-in finds the part again by name");

  /* memory: what is known arrives as memory, and the session aims at what isn't */
  var known = S.blankPart("The Watcher");
  known.type = "manager";
  known.age = "about 12";
  known.positive_intent = "keep me from ever being caught out and humiliated in front of people";
  known.coverage.introduction = "complete";
  known.coverage.history_origin = "declined";
  known.narrative.in_its_own_words = "I'm not cruel, I'm early.";
  known.narrative.session_notes = "2026-09-20 - felt curious toward it for the first time.\n\n2026-09-01 - intake.";
  known.relationships = [{ part: "the-dreamer", type: "polarized-with", notes: "thinks it is reckless" }];
  known.feelings = [{ part: "the-dreamer", rating: 2, prev: 1, date: "2026-09-20", rounds: 2 }];
  known.sessions = [{ date: "2026-09-20", mode: "checkin", categories: [], note: "softened when thanked" }];
  var dreamer2 = S.blankPart("The Dreamer");
  var ck = T.checkin(known, [known, dreamer2]);
  t.ok(/What you already know about The Watcher/.test(ck), "a check-in carries a memory brief");
  t.ok(/In its own words: "I'm not cruel, I'm early\."/.test(ck), "...in the part's own words");
  t.ok(/Never ask for something already known as if it were new/.test(ck), "...with instructions to use it as memory");
  t.ok(/felt curious toward it for the first time/.test(ck), "...including the last session note");
  t.ok(/polarized with The Dreamer/.test(ck), "other parts are named, not slugged");
  t.ok(/warmer than the time before/.test(ck), "a reading's direction of travel is remembered");
  var thinLine = (ck.match(/Thin - where today's time is best spent: (.*)/) || [])[1] || "";
  t.ok(thinLine && thinLine.indexOf("History & origin") < 0, "declined ground is never listed as thin");
  t.ok(thinLine.indexOf("Positive intent") < 0, "a category the profile already holds counts as covered even when never flagged");
  t.ok(/Closed - the part declined these.*History & origin/.test(ck), "declined ground is named as closed");
  t.ok(/## The profile file \(update this at the close\)/.test(ck), "the raw profile still rides along for the update");

  var em = T.embody(known, "", [known, dreamer2]);
  t.ok(/Who you are - your memory/.test(em) && /I'm not cruel, I'm early/.test(em), "an embodied part speaks from its memory");
  t.ok(/You have declined to talk about: History & origin/.test(em), "...and keeps its declined ground closed");
  t.ok(/Nothing has been put on the table yet/.test(em), "with no material, the part asks for it rather than reacting to a placeholder");
  t.ok(/step out of the role at once/.test(em), "a crisis breaks character");
  var ex = S.blankPart("The Little One");
  ex.type = "exile";
  t.ok(/Never narrate or hint at its memories/.test(T.embody(ex, "x", [ex])), "an exile is voiced in the present, never through its memories");

  var room = { built: true, room: "A round table.", seats: { "the-watcher": "table", "the-dreamer": "table" }, tools: [], agreements: [],
    meetings: [{ date: "2026-09-20", topic: "Apply for the job?", parts: ["the-watcher", "the-dreamer"],
      voices: [{ name: "The Watcher", line: "Not until it is perfect." }], synthesis: "Both want it to go well." }] };
  var mt = T.meeting([known, dreamer2], "Take the promotion?", room, [known, dreamer2]);
  t.ok(/Earlier meetings these parts sat in/.test(mt) && /Not until it is perfect/.test(mt), "a meeting remembers earlier meetings");
  t.ok(/Self's synthesis: Both want it to go well/.test(mt), "...and what Self made of them");
  t.ok(/The Watcher last felt wary toward The Dreamer/.test(mt), "...and how the parts last felt toward each other");
  t.ok(/how do they feel toward the parts gathered here\?/.test(mt), "the person's own Self is checked before anyone speaks");
  t.ok(/stop the meeting at once/.test(mt) && /Do not resume the meeting/.test(mt), "a crisis stops the meeting");
  ex.slug = "the-little-one";
  room.seats["the-little-one"] = "table";
  t.ok(/Before an exile speaks, ask the protectors/.test(T.meeting([known, ex], "x", room, [known, ex])), "an exile at the table speaks only with its protectors' leave");

  /* the copy-paste versions */
  ["intake", "checkin", "mapping", "embody", "meeting"].forEach(function (mode) {
    var parts = mode === "intake" ? [] : mode === "checkin" || mode === "embody" ? [critic] : [critic, dreamer];
    var p = T.portable(mode, parts, material, null);
    t.ok(p.indexOf("# A guided session") === 0, mode + " portable opens with the run-it header");
    t.ok(/supersede any general-purpose persona/.test(p), mode + " portable outranks a chat's standing persona");
    t.ok(!/The app will tell you/.test(p), mode + " portable never mentions an app the outside chat can't see");
    var writes = mode === "intake" || mode === "checkin" || mode === "mapping";
    t.eq(/Exact profile file format/.test(p), writes, mode + " portable carries the file format only when it writes profiles");
    if (writes) t.ok(/When the person says the session is over/.test(p), mode + " portable says how the session closes");
    if (writes) t.ok(/Add a part, then paste/.test(p), mode + " portable says how the profile gets back into the app");
    t.ok(p.indexOf("(paste the material here)") < 0, mode + " portable never hands the model a placeholder");
  });
};
