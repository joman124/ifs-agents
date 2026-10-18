/* A "just talk" conversation lands on the parts it was about. The note it
   leaves names those parts, and each one gets the note's line in its own
   session history - in the app, from another device, from the person's own
   AI through the bridge, and for notes kept before this existed. */
"use strict";
var H = require("./harness");

module.exports = function (t) {
  function fresh() {
    var env = H.load(["schema", "store"]);
    env.IFS.store.load();
    ["The Wandering Magician", "Dr. John"].forEach(function (n) { env.IFS.store.upsertPart(env.IFS.schema.blankPart(n)); });
    return env;
  }
  var talkLines = function (p) { return (p.sessions || []).filter(function (s) { return s.mode === "talk"; }); };

  /* --- a note written in the app --- */
  var a = fresh(), ST = a.IFS.store;
  ST.addJournal({ date: "2026-10-15", summary: "The Magician went outside and felt free.", parts: ["the-wandering-magician", "Dr. John"], via: "app" });
  var mag = talkLines(ST.getPart("the-wandering-magician"));
  t.eq(mag.length, 1, "the part a conversation names gets a line in its session history");
  t.eq(mag[0].date, "2026-10-15", "dated the day of the conversation");
  t.ok(/^Conversation: The Magician went outside/.test(mag[0].note), "carrying what the conversation was about");
  t.eq(talkLines(ST.getPart("dr-john")).length, 1, "a part named by its name rather than its slug is found too");
  ST.addJournal({ id: "again", date: "2026-10-15", summary: "The Magician went outside and felt free.", parts: ["the-wandering-magician"], via: "app" });
  t.eq(talkLines(ST.getPart("the-wandering-magician")).length, 1, "the same note twice leaves one line");
  ST.addJournal({ date: "2026-10-16", summary: "Nobody in particular.", parts: ["no-such-part"], via: "app" });
  t.eq(talkLines(ST.getPart("dr-john")).length, 1, "a note naming an unknown part touches nothing");

  /* --- a note from another device, or from the person's AI, arriving by sync --- */
  var b = fresh();
  b.IFS.store.importAll(JSON.stringify({ parts: {}, journal: [{ id: "j-ai-1", date: "2026-10-17", via: "ai", summary: "Talked about Dr. John at work.", parts: ["dr-john"] }] }), { sync: true });
  var dj = talkLines(b.IFS.store.getPart("dr-john"));
  t.eq(dj.length, 1, "a synced note lands on its part");
  t.ok(/^Conversation in your AI app: /.test(dj[0].note), "and says it was held in the person's AI");

  /* --- notes kept before notes reached the profiles --- */
  var c = fresh();
  var saved = JSON.parse(c.storage.getItem("innertable.v1"));
  saved.journal = [{ id: "old", date: "2026-10-15", via: "app", summary: "An older conversation.", parts: ["the-wandering-magician"] }];
  c.storage.setItem("innertable.v1", JSON.stringify(saved));
  c.IFS.store.load();
  t.eq(talkLines(c.IFS.store.getPart("the-wandering-magician")).length, 1, "a note already kept is added to its part on the next open");
  c.IFS.store.load();
  t.eq(talkLines(c.IFS.store.getPart("the-wandering-magician")).length, 1, "and only once");

  /* --- saved by the person's own AI through the bridge --- */
  var sessions = require("../api/_sessions.js");
  var S = c.IFS.schema;
  var state = { parts: { "dr-john": S.blankPart("Dr. John") } };
  var res = sessions.prepareSave(state, { journal: "```journal\nsummary: A long talk about work.\nparts: Dr. John\n```" });
  t.ok(!res.error, "the bridge takes a talk session's note");
  var p = res.parts.filter(function (x) { return x.slug === "dr-john"; })[0];
  t.ok(p && talkLines(p).length === 1, "and puts it on the part right away, so the AI sees it there too");
  t.eq(talkLines(p)[0].note, S.journalSession(res.journal[0]).note, "the same line the app writes, so the two never double up");
};
