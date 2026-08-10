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

  starters.forEach(function (p) {
    t.ok(!S.readiness(p).ready, p.name + " is not compile-ready - the real work is still the person's");
  });

  /* --- and they never land on top of someone's real parts --- */
  var h = fresh();
  h.add("A Part I Already Had");
  t.eq(h.IFS.store.seedStarters(), 0, "a store with parts in it is left alone");
  t.eq(h.IFS.store.listParts().length, 1, "and keeps only what was there");
};
