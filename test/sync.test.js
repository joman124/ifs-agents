/* Cross-device sync, from the app's side.

   push() sends the whole state and overwrites the server copy, so the thing
   worth proving is that it never runs before a pull has said what is up
   there. Otherwise a device that signs in while offline would, on the next
   edit, flatten the other device's parts with its own near-empty state. */
"use strict";
var H = require("./harness.js");

/* let queued promises settle - the store's timers are virtual, fetch is not */
function flush() {
  return new Promise(function (r) { setImmediate(r); });
}

function setup(responder) {
  var calls = [];
  var env = H.load(["schema", "markdown", "store", "auth", "sync"], {
    fetch: function (url, opts) {
      calls.push({ url: String(url), method: (opts && opts.method) || "GET", body: opts && opts.body });
      return responder(calls.length);
    }
  });
  env.IFS.store.load();
  // a live session, so isLoggedIn() is true without a real login round trip
  env.storage.setItem("innertable.session", JSON.stringify({
    token: "t", username: "alice", exp: Date.now() + 60000
  }));
  return { env: env, calls: calls };
}

function ok(state) {
  return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ state: state }); } });
}

module.exports = async function (t) {
  /* ---- nothing goes up before a pull comes back ---- */
  var a = setup(function () { return Promise.reject(new Error("offline")); });
  a.env.IFS.store.upsertPart({ slug: "critic", name: "The Critic" });
  a.env.clock.tick(5000);
  await flush();
  t.eq(a.calls.length, 0, "an edit before any pull pushes nothing");

  await a.env.IFS.sync.pull();          // fails: offline
  a.env.IFS.store.upsertPart({ slug: "dreamer", name: "The Dreamer" });
  a.env.clock.tick(5000);
  await flush();
  t.ok(a.calls.every(function (c) { return c.method !== "POST"; }),
    "an edit after a failed pull still pushes nothing");

  /* ---- once the server has answered, edits do go up ---- */
  var b = setup(function () { return ok(null); });   // signed in, server empty
  b.env.IFS.store.upsertPart({ slug: "critic", name: "The Critic" });
  b.env.clock.tick(5000);
  await flush();
  t.eq(b.calls.length, 0, "still nothing before the first pull");

  await b.env.IFS.sync.pull();
  b.env.clock.tick(5000);
  await flush();
  var posts = b.calls.filter(function (c) { return c.method === "POST"; });
  t.ok(posts.length >= 1, "an empty server gets seeded from this device");
  t.ok(posts[0].body.indexOf("critic") !== -1,
    "and the parts that were already here are what it sends");

  /* ---- a pull merges rather than replaces ---- */
  var remote = JSON.stringify({
    app: "inner-table", version: 1,
    parts: { dreamer: { slug: "dreamer", name: "The Dreamer", type: "exile" } }
  });
  var c = setup(function (n) { return ok(n === 1 ? remote : null); });
  c.env.IFS.store.upsertPart({ slug: "critic", name: "The Critic" });
  await c.env.IFS.sync.pull();
  var names = c.env.IFS.store.listParts().map(function (p) { return p.slug; }).sort();
  t.eq(names, ["critic", "dreamer"], "the other device's parts arrive without erasing this one's");

  /* ---- sessions the person's AI saved are folded in, then acknowledged ---- */
  var withInbox = JSON.stringify({ app: "inner-table", version: 1,
    parts: { critic: { slug: "critic", name: "The Critic", positive_intent: "keep me safe" } } });
  var d = setup(function (n) {
    if (n === 1) return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ state: withInbox,
      inbox: [{ id: "2026-10-09T05:00:00.000Z-aa", parts: [{ slug: "critic", name: "The Critic", age: "about 12" }] }] }); } });
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true }); } });
  });
  await d.env.IFS.sync.pull();
  var critic = d.env.IFS.store.getPart("critic");
  t.eq(critic.age, "about 12", "a session saved by the person's AI lands on the device");
  t.eq(critic.positive_intent, "keep me safe", "...merged in, keeping what it left out");
  t.eq(d.env.IFS.sync.fromAi(), ["The Critic"], "...and the app can say whose session arrived");
  d.env.clock.tick(5000);
  await flush();
  var pushes = d.calls.filter(function (x) { return x.method === "POST" && x.url === "/api/sync"; });
  t.ok(pushes.length >= 1 && JSON.parse(pushes[0].body).ack[0] === "2026-10-09T05:00:00.000Z-aa",
    "the push that carries it acknowledges it");
  t.ok(JSON.parse(pushes[0].body).state.indexOf("about 12") !== -1, "...in the same request as the state that now holds it");
  d.env.IFS.store.upsertPart({ slug: "other", name: "Other" });
  d.env.clock.tick(5000);
  await flush();
  pushes = d.calls.filter(function (x) { return x.method === "POST" && x.url === "/api/sync"; });
  t.eq(JSON.parse(pushes[pushes.length - 1].body).ack, [], "once acknowledged, it is not acknowledged again");

  /* ---- a part deleted here after the AI saved it stays deleted ---- */
  var e = setup(function (n) {
    if (n === 1) return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ state: JSON.stringify({ app: "inner-table", parts: {} }),
      inbox: [{ id: "2026-01-01T00:00:00.000Z-bb", parts: [{ slug: "gone", name: "Gone", updated: "2026-01-01T00:00:00.000Z" }] }] }); } });
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true }); } });
  });
  e.env.IFS.store.upsertPart({ slug: "gone", name: "Gone" });
  e.env.IFS.store.deletePart("gone");
  await e.env.IFS.sync.pull();
  t.eq(e.env.IFS.store.getPart("gone"), null, "an older save never brings back a part deleted since");

  /* ---- signing out withdraws the permission to write ---- */
  c.env.IFS.auth.logout();
  c.env.IFS.sync.reset();
  c.calls.length = 0;
  c.env.IFS.store.upsertPart({ slug: "third", name: "Third" });
  c.env.clock.tick(5000);
  await flush();
  t.eq(c.calls.length, 0, "after signing out, edits stay on the device");
};
