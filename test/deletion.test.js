/* Deleting a part means deleting it for the account, on every device.

   It did not. Sync merges rather than replaces, so a part simply missing from
   an incoming blob meant nothing, and any other signed-in device pushed the
   deleted part straight back - to the server, and from there to the device it
   had just been deleted on. The delete undid itself.

   Deletions are recorded now, and the record travels. What these tests pin
   down is the pair of things that has to stay true at once: a deletion holds
   everywhere, and a part deliberately made again afterwards is not mistaken
   for the ghost of the old one. */
"use strict";
var H = require("./harness.js");

function flush() { return new Promise(function (r) { setImmediate(r); }); }

/* One account, one server slot, as many devices as a test wants. */
function account() {
  var slot = { state: null };
  var api = {
    slot: slot,
    device: function () {
      var env = H.load(["schema", "markdown", "store", "auth", "sync"], {
        fetch: function (url, opts) {
          if (opts && opts.method === "POST") {
            slot.state = JSON.parse(opts.body).state;
            return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true }); } });
          }
          return Promise.resolve({
            ok: true, json: function () { return Promise.resolve({ state: slot.state }); }
          });
        }
      });
      env.storage.setItem("innertable.session",
        JSON.stringify({ token: "t", username: "john", exp: Date.now() + 60000 }));
      var d = { env: env, ST: env.IFS.store, SY: env.IFS.sync };
      d.ST.load("john");
      d.settle = async function () { env.clock.tick(5000); await flush(); return d; };
      d.sync = async function () { await d.SY.pull(); await d.settle(); return d; };
      d.slugs = function () {
        return d.ST.listParts().map(function (p) { return p.slug; }).sort();
      };
      /* Parts in the store are always schema-shaped; a bare {slug, name} is
         not something the app can produce, and merging into one throws. */
      d.add = function (name, extra) {
        var part = env.IFS.schema.blankPart(name);
        Object.keys(extra || {}).forEach(function (k) { part[k] = extra[k]; });
        d.ST.upsertPart(part);
        return part;
      };
      return d;
    },
    slugs: function () {
      return slot.state ? Object.keys(JSON.parse(slot.state).parts).sort() : null;
    }
  };
  return api;
}


/* One browser, shared by whoever signs in on it, against a server of many
   accounts. Deletions are recorded per account, so this is where that has to
   prove itself: the two people can easily have a part with the same name, and
   a slug is derived from the name. */
function sharedBrowser(server) {
  var who = null;
  var env = H.load(["schema", "markdown", "store", "auth", "sync"], {
    fetch: function (url, opts) {
      if (opts && opts.method === "POST") {
        server[who] = JSON.parse(opts.body).state;
        return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true }); } });
      }
      return Promise.resolve({
        ok: true, json: function () { return Promise.resolve({ state: server[who] || null }); }
      });
    }
  });
  var b = { env: env, ST: env.IFS.store, SY: env.IFS.sync, AUTH: env.IFS.auth };
  b.ST.load(null);
  b.settle = async function () { env.clock.tick(5000); await flush(); return b; };
  b.sync = async function () { await b.SY.pull(); await b.settle(); return b; };
  b.signIn = function (u) {
    who = u;
    env.storage.setItem("innertable.session",
      JSON.stringify({ token: "t." + u, username: u, exp: Date.now() + 6e7 }));
    b.ST.switchOwner(u);
    return b;
  };
  b.signOut = function () {
    b.AUTH.logout(); b.SY.reset(); b.ST.switchOwner(null); who = null;
    return b;
  };
  b.add = function (name, extra) {
    var part = env.IFS.schema.blankPart(name);
    Object.keys(extra || {}).forEach(function (k) { part[k] = extra[k]; });
    b.ST.upsertPart(part);
    return part;
  };
  b.slugs = function () { return b.ST.listParts().map(function (p) { return p.slug; }).sort(); };
  b.originOf = function (slug) { var p = b.ST.getPart(slug); return p ? p.origin : null; };
  return b;
}

function heldSlugs(raw) { return raw ? Object.keys(JSON.parse(raw).parts).sort() : null; }

module.exports = async function (t) {

  /* ---- a delete on one device holds on the other ---- */
  var acc = account();
  var phone = acc.device(), laptop = acc.device();

  phone.add("The Critic");
  phone.add("The Planner");
  await phone.sync();
  await laptop.sync();
  t.eq(laptop.slugs(), ["the-critic", "the-planner"], "both devices start from the same library");

  phone.ST.deletePart("the-critic");
  await phone.settle();
  t.eq(phone.slugs(), ["the-planner"], "deleting removes it here");
  t.eq(acc.slugs(), ["the-planner"], "and the server copy loses it too");

  await laptop.sync();
  t.eq(laptop.slugs(), ["the-planner"],
    "the other device honours the deletion instead of ignoring a part it cannot see");
  t.eq(acc.slugs(), ["the-planner"],
    "and does not push the deleted part back up - this is the bug");

  await phone.sync();
  t.eq(phone.slugs(), ["the-planner"], "so it never returns to the device it was deleted on");

  /* ---- a device that was offline for the whole thing still catches up ---- */
  var tablet = acc.device();
  await tablet.sync();
  t.eq(tablet.slugs(), ["the-planner"],
    "a device signing in later gets the library as it stands, not as it was");

  /* ---- deleting the last part leaves an empty library, not a restored one ---- */
  phone.ST.deletePart("the-planner");
  await phone.settle();
  await laptop.sync();
  await phone.sync();
  t.eq(phone.slugs(), [], "the phone's library is empty");
  t.eq(laptop.slugs(), [], "and so is the laptop's");
  t.eq(acc.slugs(), [], "and the account holds nothing");

  /* ---- but a part written again after the delete is a new part, not a ghost ----
     Without this the tombstone would be a permanent ban on the name, and
     someone who deleted a part and then met it again could never keep it. */
  var acc2 = account();
  var a = acc2.device(), b = acc2.device();
  a.add("The Critic");
  await a.sync(); await b.sync();
  a.ST.deletePart("the-critic");
  await a.settle(); await b.sync();
  t.eq(b.slugs(), [], "deleted everywhere first");

  b.add("The Critic", { origin: "met again" });
  await b.settle();
  t.eq(b.slugs(), ["the-critic"], "making it again on one device keeps it there");
  await a.sync();
  t.eq(a.slugs(), ["the-critic"],
    "and it reaches the other device, because it was written after it was deleted");
  await b.sync();
  t.eq(b.slugs(), ["the-critic"], "and it is not deleted again on the next sync");
  t.eq(a.ST.state.deleted.parts["the-critic"], undefined,
    "the tombstone is lifted rather than left to fight the part forever");

  /* ---- restoring your own backup is not a sync, and brings things back ----
     A pull is another device's opinion about the same account. A backup file
     is a person saying "put this back", so the file wins. */
  var acc3 = account();
  var solo = acc3.device();
  solo.add("Kept");
  solo.add("Gone");
  await solo.sync();
  var backup = solo.ST.exportAll();
  solo.ST.deletePart("gone");
  await solo.settle();
  t.eq(solo.slugs(), ["kept"], "deleted before the restore");
  solo.ST.importAll(backup);
  t.eq(solo.slugs(), ["gone", "kept"],
    "restoring a backup brings back what is in the file - that is what restoring is");
  t.eq(solo.ST.state.deleted.parts.gone, undefined, "and lifts the tombstone with it");

  /* ---- the same rule for session transcripts ---- */
  var acc4 = account();
  var p2 = acc4.device(), l2 = acc4.device();
  p2.ST.addTranscript({ date: "2026-08-01", mode: "checkin", title: "One", parts: [], text: "one" });
  await p2.sync(); await l2.sync();
  t.eq(l2.ST.state.transcripts.length, 1, "a transcript reaches the other device");
  var id = p2.ST.state.transcripts[0].id;
  p2.ST.deleteTranscript(id);
  await p2.settle(); await l2.sync(); await p2.sync();
  t.eq(p2.ST.state.transcripts.length, 0, "deleting a transcript holds here");
  t.eq(l2.ST.state.transcripts.length, 0, "and on the other device, rather than syncing back");

  /* ---- the record does not grow forever ---- */
  var acc5 = account();
  var old = acc5.device();
  old.add("Ancient");
  old.ST.deletePart("ancient");
  // backdate the tombstone past the year it is kept for
  old.ST.state.deleted.parts.ancient = new Date(Date.now() - 400 * 864e5).toISOString();
  old.ST.importAll(JSON.stringify({ parts: {}, transcripts: [] }), { sync: true });
  t.eq(old.ST.state.deleted.parts.ancient, undefined,
    "a tombstone older than any plausible offline gap is pruned");

  /* ---- two accounts on one device ----
     A deletion has to reach every device of the account that made it and stop
     dead at the edge of that account. Both halves are tested with the same
     slug on both sides, which is the case most likely to break: two people
     each meet an inner critic, and "The Critic" slugifies the same either way. */
  var shared = {};
  var browser = sharedBrowser(shared);
  var johnsLaptop = sharedBrowser(shared);

  browser.signIn("john");
  browser.add("The Critic", { origin: "johns critic" });
  browser.add("The Planner", { origin: "johns planner" });
  await browser.sync();
  await johnsLaptop.signIn("john").sync();
  t.eq(johnsLaptop.originOf("the-critic"), "johns critic", "john's own second device has john's critic");

  browser.signOut().signIn("scottfisk");
  browser.add("The Critic", { origin: "scotts critic" });
  await browser.sync();
  t.eq(browser.originOf("the-critic"), "scotts critic",
    "scottfisk's critic is his own, despite sharing a slug with john's");

  browser.ST.deletePart("the-critic");
  await browser.settle();
  t.eq(browser.slugs(), [], "he can delete it");
  t.eq(heldSlugs(shared.scottfisk), [], "and his account loses it");
  t.eq(heldSlugs(shared.john), ["the-critic", "the-planner"],
    "while john's account is untouched by a deletion made in another account");

  browser.signOut().signIn("john");
  await browser.sync();
  t.eq(browser.slugs(), ["the-critic", "the-planner"],
    "john signs back in on the same device and his critic is still there");
  t.eq(browser.originOf("the-critic"), "johns critic",
    "and it is his critic, not the ghost of the one deleted in the other account");
  await johnsLaptop.sync();
  t.eq(johnsLaptop.slugs(), ["the-critic", "the-planner"],
    "his other device never hears about the other account's deletion either");

  /* The other direction: john deleting must not disturb scottfisk. */
  johnsLaptop.ST.deletePart("the-critic");
  await johnsLaptop.settle();
  await browser.sync();
  t.eq(browser.slugs(), ["the-planner"], "john's deletion reaches john's other device");
  browser.signOut().signIn("scottfisk");
  await browser.sync();
  t.eq(browser.slugs(), [], "and scottfisk's account is where he left it");

  /* And a tombstone in one account never suppresses a part in another: scott
     meets a critic of his own after john deleted his. */
  browser.add("The Critic", { origin: "scotts new critic" });
  await browser.settle();
  t.eq(browser.originOf("the-critic"), "scotts new critic",
    "a part made in one account is not buried by another account's tombstone");
  t.eq(heldSlugs(shared.scottfisk), ["the-critic"], "and it reaches his own slot");
  t.eq(heldSlugs(shared.john), ["the-planner"], "leaving john's deletion standing in john's");

  /* ---- deleting while signed out stays on the device ---- */
  var solo2 = sharedBrowser({});
  solo2.add("Private", { origin: "made signed out" });
  solo2.ST.deletePart("private");
  t.eq(solo2.ST.state.deleted.parts.private !== undefined, true,
    "a signed-out deletion is recorded in the device store");
  solo2.signIn("newcomer");
  t.eq(solo2.ST.state.deleted.parts.private, undefined,
    "and does not follow the person into an account that never held that part");
};
