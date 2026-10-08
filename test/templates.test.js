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
  });
};
