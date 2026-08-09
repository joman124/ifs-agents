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

  /* ---- signing out withdraws the permission to write ---- */
  c.env.IFS.auth.logout();
  c.env.IFS.sync.reset();
  c.calls.length = 0;
  c.env.IFS.store.upsertPart({ slug: "third", name: "Third" });
  c.env.clock.tick(5000);
  await flush();
  t.eq(c.calls.length, 0, "after signing out, edits stay on the device");
};
