/* Account isolation.

   Part profiles are intimate, and the one failure this app must never have is
   one person's parts appearing in another person's library. It had it: the
   device kept every install's state under a single key, sign-out deliberately
   left that state in place, and sign-in pulled the server copy and *merged*
   it into whatever was there - then pushed the union up under the new
   account's name. Two people sharing a browser was all it took.

   These tests are the boundary, stated as behaviour. */
"use strict";
var H = require("./harness.js");

/* let queued promises settle - the store's timers are virtual, fetch is not */
function flush() { return new Promise(function (r) { setImmediate(r); }); }

/* One browser, one server, many accounts. `server` maps username -> blob. */
function browser(server) {
  var pushes = [];
  var who = null;
  var env = H.load(["schema", "markdown", "store", "auth", "sync"], {
    fetch: function (url, opts) {
      // the real handler keys off the signed token, never off the body
      if (opts && opts.method === "POST") {
        server[who] = JSON.parse(opts.body).state;
        pushes.push(who);
        return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true }); } });
      }
      return Promise.resolve({
        ok: true, json: function () { return Promise.resolve({ state: server[who] || null }); }
      });
    }
  });
  var api = {
    env: env, pushes: pushes,
    ST: env.IFS.store, AUTH: env.IFS.auth, SY: env.IFS.sync,
    boot: function () {
      api.ST.load(api.AUTH.isLoggedIn() ? api.AUTH.getUsername() : null);
      return api;
    },
    signIn: function (u) {
      who = u;
      env.storage.setItem("innertable.session",
        JSON.stringify({ token: "t." + u, username: u, exp: Date.now() + 60000 }));
      api.ST.switchOwner(u);
      return api;
    },
    signOut: function () {
      api.AUTH.logout(); api.SY.reset(); api.ST.switchOwner(null); who = null;
      return api;
    },
    settle: async function () { api.env.clock.tick(5000); await flush(); return api; },
    slugs: function () { return api.ST.listParts().map(function (p) { return p.slug; }).sort(); }
  };
  return api;
}

function blobSlugs(raw) {
  return raw ? Object.keys(JSON.parse(raw).parts).sort() : null;
}

/* Enough of IndexedDB for the mirror: a plain object standing in for the
   object store, so a test can see which key the mirror actually wrote. */
function fakeIndexedDB(cells) {
  return {
    open: function () {
      var rq = {};
      setTimeout(function () {
        rq.result = {
          createObjectStore: function () {},
          transaction: function () {
            return {
              objectStore: function () {
                return {
                  put: function (v, k) { cells[k] = v; },
                  get: function (k) {
                    var r = {};
                    setTimeout(function () { r.result = cells[k]; if (r.onsuccess) r.onsuccess(); }, 0);
                    return r;
                  }
                };
              }
            };
          }
        };
        if (rq.onsuccess) rq.onsuccess();
      }, 0);
      return rq;
    }
  };
}

module.exports = async function (t) {

  /* ---- the reported incident, exactly ---- */
  var server = {
    scottfisk: JSON.stringify({
      app: "inner-table", version: 1,
      parts: { "scotts-planner": { slug: "scotts-planner", name: "Scotts Planner" } },
      transcripts: [], table: {}
    })
  };
  var b = browser(server).boot();

  b.signIn("john");
  b.ST.upsertPart({ slug: "johns-critic", name: "Johns Critic" });
  b.ST.upsertPart({ slug: "johns-exile", name: "Johns Exile" });
  await b.SY.pull(); await b.settle();
  t.eq(blobSlugs(server.john), ["johns-critic", "johns-exile"], "john's parts reach john's slot");

  b.signOut();
  t.eq(b.slugs(), [], "signing out closes the account's library rather than leaving it on screen");

  b.signIn("scottfisk");
  await b.SY.pull(); await b.settle();
  t.eq(b.slugs(), ["scotts-planner"],
    "the next account to sign in sees only its own parts");
  t.eq(blobSlugs(server.scottfisk), ["scotts-planner"],
    "and only its own parts are written back to its slot - this is the bug that was reported");
  t.eq(blobSlugs(server.john), ["johns-critic", "johns-exile"],
    "john's slot is untouched by anything scottfisk did");

  /* ---- and nobody loses their own work ---- */
  b.signOut().signIn("john");
  await b.SY.pull(); await b.settle();
  t.eq(b.slugs(), ["johns-critic", "johns-exile"],
    "john signs back in on the same device and finds his own parts where he left them");

  /* ---- a fresh device: the store opens per account at boot, not per device ---- */
  var s2 = { alice: JSON.stringify({ app: "inner-table", version: 1,
    parts: { "alices-part": { slug: "alices-part", name: "Alices Part" } }, transcripts: [], table: {} }) };
  var c = browser(s2).boot();
  c.signIn("alice");
  await c.SY.pull(); await c.settle();
  c.signOut();
  var reopened = c.ST;
  reopened.load("alice");
  t.eq(reopened.listParts().map(function (p) { return p.slug; }), ["alices-part"],
    "booting straight into a signed-in account opens that account's store");
  reopened.load(null);
  t.eq(reopened.listParts(), [], "and booting signed out opens the device store, which is a different store");

  /* ---- parts built signed out are never adopted silently ---- */
  var s3 = {};
  var d = browser(s3).boot();
  d.ST.upsertPart({ slug: "device-part", name: "Device Part" });   // signed out
  t.eq(d.ST.deviceStore().parts, 1, "a signed-out person's parts live in the device store");
  t.eq(d.ST.deviceStore().claimedBy, null, "which starts unclaimed");

  d.signIn("mallory");
  await d.SY.pull(); await d.settle();
  t.eq(d.slugs(), [],
    "signing in does not sweep up whatever the last person left on the device");
  t.eq(blobSlugs(s3.mallory), [], "and nothing of theirs is pushed to the new account's slot");

  /* ...but the person they belong to can claim them, once. */
  var got = d.ST.claimDeviceStore();
  t.eq(got, 1, "the owner can take their own device parts into their account");
  t.eq(d.slugs(), ["device-part"], "and they land in the account");
  t.eq(d.ST.deviceStore().parts, 0, "the device store is emptied, so they exist in one place");
  t.eq(d.ST.deviceStore().claimedBy, "mallory", "and it is marked claimed");

  d.signOut().signIn("trent");
  await d.SY.pull(); await d.settle();
  t.eq(d.ST.deviceStore().claimedBy, "mallory",
    "a later account finds the device store already claimed, so it is never offered those parts");

  /* declining is recorded too - the offer has to happen exactly once */
  var e = browser({}).boot();
  e.ST.upsertPart({ slug: "someone-elses", name: "Someone Elses" });
  e.signIn("guest");
  e.ST.leaveDeviceStore();
  t.eq(e.ST.deviceStore().claimedBy, "guest", "declining resolves the offer");
  t.eq(e.ST.deviceStore().parts, 1, "without touching the parts, which stay for signed-out use");
  t.eq(e.slugs(), [], "and without putting them in the account that declined");

  /* ---- a push queued before an account switch must not land after it ---- */
  var s4 = { one: null, two: null };
  var f = browser(s4).boot();
  f.signIn("one");
  await f.SY.pull();                       // reconciled as "one"
  f.ST.upsertPart({ slug: "ones-part", name: "Ones Part" });   // schedules a push
  f.signIn("two");                         // switch before the timer fires
  await f.settle();
  t.ok(!s4.two, "a push scheduled as one account never lands in another's slot");

  /* ---- the offline backup mirror is per account too ---- */
  var cells = {};
  var g = H.load(["schema", "markdown", "store"], { indexedDB: fakeIndexedDB(cells) });
  g.IFS.store.load("harry");
  g.IFS.store.upsertPart({ slug: "harrys-part", name: "Harrys Part" });
  g.IFS.store.initMirror(null);
  // the fake's callbacks land on real timers, not the store's virtual clock
  await new Promise(function (r) { setTimeout(r, 10); });
  g.IFS.store.save();
  t.ok(!!cells["state:u:harry"], "the mirror writes under the account's own key");
  t.ok(!cells["state"], "and not under one shared key that any account would restore from");
};
