/* Ground me: the person's own grounding plan. It has to survive sync (the
   phone reached for in a bad moment must have it), be read defensively, and
   reach the sessions that are supposed to use it - in the app and in the
   person's own AI. Also the device voice that speaks those sessions. */
"use strict";
var H = require("./harness");

module.exports = function (t) {
  function fresh() {
    var env = H.load(["schema", "store"]);
    env.IFS.store.load();
    return env;
  }

  /* --- the plan is kept, cleaned, and travels in the synced blob --- */
  var a = fresh();
  var ST = a.IFS.store;
  t.eq(ST.state.plan.skills, [], "a new account starts with an empty plan");
  ST.setPlan({ skills: ["  Cold water on my hands ", "", 7], people: ["Sam 555 123 4567"], bogus: ["x"] });
  t.eq(ST.state.plan.skills, ["Cold water on my hands"], "lines are trimmed and non-text is dropped");
  t.ok(!("bogus" in ST.state.plan), "only the plan's own sections are kept");
  t.ok(!!ST.state.plan.updated, "saving stamps the plan");
  var blob = JSON.parse(ST.exportAll({ images: false }));
  t.eq(blob.plan.people, ["Sam 555 123 4567"], "the plan rides the synced blob");

  /* --- a newer plan wins a sync; an older one does not --- */
  var b = fresh();
  b.IFS.store.setPlan({ skills: ["Step outside"] });
  var mine = b.IFS.store.state.plan.updated;
  b.IFS.store.importAll(JSON.stringify({ parts: {}, plan: { skills: ["Old"], updated: "2020-01-01T00:00:00.000Z" } }), { sync: true });
  t.eq(b.IFS.store.state.plan.skills, ["Step outside"], "an older plan from another device does not overwrite a newer one");
  b.IFS.store.importAll(JSON.stringify({ parts: {}, plan: { skills: ["Newer"], updated: "2999-01-01T00:00:00.000Z" } }), { sync: true });
  t.eq(b.IFS.store.state.plan.skills, ["Newer"], "a newer plan from another device replaces this one");
  t.ok(mine < b.IFS.store.state.plan.updated, "and keeps its own stamp");
  b.IFS.store.importAll(JSON.stringify({ parts: {}, plan: "garbage" }), { sync: true });
  t.eq(b.IFS.store.state.plan.skills, ["Newer"], "a malformed plan is ignored");

  /* --- reload keeps it --- */
  var c = fresh();
  c.IFS.store.setPlan({ reasons: ["My dog"] });
  c.IFS.store.load();
  t.eq(c.IFS.store.state.plan.reasons, ["My dog"], "the plan survives a reload");

  /* --- sessions are told about it, and only about what they need --- */
  var T = H.load(["schema", "questions", "reference", "markdown", "templates"]).IFS.templates;
  t.eq(T.groundingBlock(null), "", "no plan, nothing added to a session");
  t.eq(T.groundingBlock({ skills: [], people: [] }), "", "an empty plan adds nothing");
  var block = T.groundingBlock({ skills: ["Cold water"], signs: ["Chest tight"], people: ["Sam 555 123 4567"] });
  t.ok(/Cold water/.test(block) && /Chest tight/.test(block), "their skills and warning signs reach the guide");
  t.ok(!/555/.test(block) && !/Sam/.test(block), "names and phone numbers are never sent to the AI");

  var sessions = require("../api/_sessions.js");
  var built = sessions.build({ parts: {}, plan: { skills: ["Hold a smooth stone"] } }, { mode: "talk" });
  t.ok(/Hold a smooth stone/.test(built.text), "a session the person's own AI runs gets the plan too");

  /* --- the device voice: the best one installed, never a novelty voice --- */
  var V = H.load(["schema", "voice"]).IFS.voice;
  var v = function (name, lang) { return { name: name, lang: lang || "en-US", voiceURI: name }; };
  var score = function (name, lang) { return V.voiceScore(v(name, lang), "en-US"); };
  t.ok(score("Microsoft Aria Online (Natural) - English (United States)") > score("Microsoft David - English (United States)"), "a neural voice beats a plain one");
  t.ok(score("Ava (Premium)") > score("Samantha"), "a premium Apple voice beats the default one");
  t.ok(score("Google US English") > score("Fred"), "Google's voice beats Fred");
  t.ok(score("Bad News") < 0 && score("Zarvox") < 0, "novelty voices are never picked");
  t.ok(score("Thomas", "fr-FR") < 0, "a voice in another language is never picked");
  t.ok(score("Daniel", "en-GB") > 0, "another accent of the same language is fine");
};
