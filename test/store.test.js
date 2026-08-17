/* The store defects from the 2026-08-01 review, pinned. Renaming a part used
   to run deletePart + upsertPart, which destroyed a same-named part and threw
   away every inbound edge and the part's chair at the table. */
"use strict";
var H = require("./harness");

module.exports = function (t) {
  function fresh() {
    var env = H.load(["schema", "store"]);
    env.IFS.store.load();
    env.add = function (name, edges) {
      var p = env.IFS.schema.blankPart(name);
      p.relationships = edges || [];
      env.IFS.store.upsertPart(p);
      return p;
    };
    return env;
  }

  /* --- renaming carries the whole part with it --- */
  var a = fresh();
  a.add("The Critic");
  a.add("The Planner", [{ part: "the-critic", type: "protects", notes: "steps in first" }]);
  a.IFS.store.saveTable({ built: true, seats: { "the-critic": "table", "the-planner": "room" } });

  var renamed = a.IFS.store.getPart("the-critic");
  renamed.name = "The Watchman";
  t.ok(a.IFS.store.renamePart("the-critic", renamed) !== null, "renaming to a free slug succeeds");
  t.eq(a.IFS.store.getPart("the-critic"), null, "the old slug is gone");
  t.eq(a.IFS.store.getPart("the-watchman").name, "The Watchman", "the part lives at the new slug");
  t.eq(a.IFS.store.getPart("the-planner").relationships[0].part, "the-watchman",
    "an inbound edge follows the rename instead of being dropped");
  t.eq(a.IFS.store.state.table.seats["the-watchman"], "table", "the part keeps its chair");
  t.eq(a.IFS.store.state.table.seats["the-critic"], undefined, "and gives up the old one");

  /* --- renaming onto an occupied slug must not eat the occupant --- */
  var b = fresh();
  b.add("The Critic");
  b.add("The Planner");
  var collide = b.IFS.store.getPart("the-planner");
  collide.name = "The Critic";
  t.eq(b.IFS.store.renamePart("the-planner", collide), null, "a collision is refused, not resolved");
  t.eq(b.IFS.store.getPart("the-critic").name, "The Critic", "the existing part is untouched");
  t.ok(b.IFS.store.getPart("the-planner") !== null, "the renamed part stays at its old slug");

  /* --- absorbing a duplicate cleans up after it --- */
  var c = fresh();
  c.add("The Critic");
  c.add("Critic Dup");
  c.add("The Planner", [{ part: "critic-dup", type: "protects", notes: "" }]);
  c.IFS.store.saveTable({ built: true, seats: { "critic-dup": "table" } });
  c.IFS.store.absorbPart("the-critic", "critic-dup");

  t.eq(c.IFS.store.getPart("critic-dup"), null, "the absorbed part is gone");
  t.eq(c.IFS.store.state.table.seats["critic-dup"], undefined, "it keeps no chair at the table");
  t.eq(c.IFS.store.state.table.seats["the-critic"], "table", "the survivor inherits the chair");
  t.eq(c.IFS.store.getPart("the-planner").relationships[0].part, "the-critic",
    "edges that named the absorbed part are repointed at the survivor");

  /* --- deleting gives up edges and the chair --- */
  var d = fresh();
  d.add("The Critic");
  d.add("The Planner", [{ part: "the-critic", type: "protects", notes: "" }]);
  d.IFS.store.saveTable({ built: true, seats: { "the-critic": "away" } });
  d.IFS.store.deletePart("the-critic");
  t.eq(d.IFS.store.getPart("the-planner").relationships.length, 0, "a dangling edge is removed");
  t.eq(d.IFS.store.state.table.seats["the-critic"], undefined, "a deleted part gives up its chair");

  /* --- a hand-edited backup must not brick the Parts tab --- */
  var e = fresh();
  var count = e.IFS.store.importAll(JSON.stringify({
    app: "inner-table",
    parts: {
      good: { name: "The Critic" },
      broken: { name: "No Coverage Block" },
      junk: { slug: "nameless" }
    }
  }));
  t.eq(count, 2, "parts without a name are skipped, the rest import");
  t.eq(Object.keys(e.IFS.store.getPart("no-coverage-block").coverage).length, 9,
    "an imported part always ends up with a full coverage block");
  t.throws(function () { e.IFS.store.importAll('{"nope":1}'); }, "a file that is not a backup is refused");

  /* --- upsert never loses session history --- */
  var f = fresh();
  var first = f.IFS.schema.blankPart("The Critic");
  first.sessions = [{ date: "2026-01-01", mode: "intake", note: "first" }];
  f.IFS.store.upsertPart(first);
  var second = f.IFS.schema.blankPart("The Critic");
  second.sessions = [{ date: "2026-02-01", mode: "checkin", note: "second" }];
  f.IFS.store.upsertPart(second);
  t.eq(f.IFS.store.getPart("the-critic").sessions.length, 2, "an earlier session log is not overwritten");

  /* --- and it all reaches storage --- */
  var g = fresh();
  g.add("The Keeper");
  var raw = g.storage.getItem("innertable.v1");
  t.ok(!!raw && raw.indexOf("The Keeper") >= 0, "parts are written to localStorage");
  var reloaded = H.load(["schema", "store"]);
  reloaded.storage.setItem("innertable.v1", raw);
  reloaded.IFS.store.load();
  t.eq(reloaded.IFS.store.getPart("the-keeper").name, "The Keeper", "and read back on the next boot");

  /* --- the starter system a new account opens on --- */
  var s = fresh();
  t.eq(s.IFS.store.seedStarters(), 3, "an empty store gets the three starters");
  var starters = s.IFS.store.listParts();
  t.eq(starters.map(function (p) { return p.type; }).sort(),
    ["exile", "firefighter", "manager"], "one of each kind");

  /* Both protectors stand in front of the same exile, and are polarized with
     each other - if that shape breaks, the map stops teaching anything. */
  var S = s.IFS.schema;
  var edge = function (from, to) {
    var p = s.IFS.store.getPart(from);
    var found = (p.relationships || []).filter(function (r) { return r.part === to; })[0];
    return found ? found.type : null;
  };
  t.eq(edge("the-perfectionist", "the-ashamed-one"), "protects", "the manager protects the exile");
  t.eq(edge("the-numbing-one", "the-ashamed-one"), "protects", "the firefighter protects the same exile");
  t.eq(edge("the-perfectionist", "the-numbing-one"), "polarized-with", "the two protectors are polarized");

  /* every edge must exist from both ends, or the map draws a half-thread */
  var asymmetric = [];
  starters.forEach(function (p) {
    (p.relationships || []).forEach(function (r) {
      if (edge(r.part, p.slug) !== S.EDGE_MIRROR[r.type]) {
        asymmetric.push(p.slug + " -" + r.type + "-> " + r.part);
      }
    });
  });
  t.eq(asymmetric, [], "every starter edge is mirrored in the other profile");

  /* They carry enough to take a seat, so a table meeting works on day one -
     but their own words are not written yet, and the ring says so. */
  starters.forEach(function (p) {
    t.ok(S.readiness(p).ready, p.name + " is developed enough to join the table");
    t.ok(S.coverageScore(p) < 0.9,
      p.name + " still reads short of finished - nobody has heard it speak yet");
    t.eq(p.narrative.in_its_own_words, "", p.name + " has no words of its own until someone asks");
  });

  /* --- and they never land on top of someone's real parts --- */
  var h = fresh();
  h.add("A Part I Already Had");
  t.eq(h.IFS.store.seedStarters(), 0, "a store with parts in it is left alone");
  t.eq(h.IFS.store.listParts().length, 1, "and keeps only what was there");

  /* --- meeting summary cards live on the table and survive a backup --- */
  var mk = fresh();
  var MS = mk.IFS.store;
  t.eq(MS.state.table.meetings, [], "a fresh table has no meetings behind it");
  t.eq(MS.state.settings.coachOn, false,
    "and the first-run coach is off by default, so an existing user is never re-taught");
  t.eq(MS.state.settings.taught, {}, "with nothing yet marked as taught");

  var id = MS.addMeeting({
    date: "2026-08-17", topic: "whether to take the job",
    parts: ["the-critic"], voices: [{ name: "The Critic", line: "I will hold the standard." }],
    synthesis: "Both are guarding the same thing.", transcript: ""
  });
  t.ok(!!id, "addMeeting hands back an id");
  t.eq(MS.state.table.meetings.length, 1, "and the card is on the table");
  t.eq(MS.state.table.meetings[0].id, id, "under that id");

  for (var mi = 0; mi < 70; mi++) {
    MS.addMeeting({ date: "2026-08-17", topic: "n" + mi, parts: [], voices: [], synthesis: "" });
  }
  t.eq(MS.state.table.meetings.length, 60, "the room keeps its history, but not without limit");
  t.eq(MS.state.table.meetings[59].topic, "n69", "and it is the oldest that falls off, not the newest");

  /* A restore adds to the meetings already here rather than replacing them -
     the same rule transcripts follow, because both are history. */
  MS.saveTable({ built: true, room: "a long library table under a window" });
  var backup = JSON.parse(MS.exportAll());
  var re = fresh();
  re.IFS.store.addMeeting({ date: "2026-08-01", topic: "kept", parts: [], voices: [], synthesis: "" });
  var mine = re.IFS.store.state.table.meetings[0].id;
  re.IFS.store.importAll(JSON.stringify(backup));
  var ids = re.IFS.store.state.table.meetings.map(function (m) { return m.id; });
  t.ok(ids.indexOf(mine) >= 0, "a restore does not throw away a meeting this device already had");
  t.ok(ids.length > 1, "and the backup's meetings arrive beside it");
  re.IFS.store.importAll(JSON.stringify(backup));
  t.eq(re.IFS.store.state.table.meetings.length, ids.length,
    "importing the same backup twice does not duplicate the cards");

  /* An older backup, written before meetings existed, must still restore. */
  var legacy = fresh();
  delete backup.table.meetings;
  legacy.IFS.store.importAll(JSON.stringify(backup));
  t.eq(legacy.IFS.store.state.table.meetings, [],
    "a backup from before meetings existed restores with an empty shelf, not a crash");
  t.ok(legacy.IFS.store.state.table.built, "and the rest of the room still comes back");
};
