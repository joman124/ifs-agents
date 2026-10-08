/* The AI bridge hands a person's parts to an AI they chose, read-only, behind
   a private link. What must hold: the link is the only credential, one account
   can never reach another's parts, a revoked or malformed link reads nothing,
   and transcripts never leave. */
"use strict";

var crypto = require("crypto");

module.exports = async function (t) {
  process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "fake-redis-token";
  process.env.SESSION_SECRET = "test-secret";

  var db = {};
  var hits = 0;
  var realFetch = global.fetch;
  global.fetch = async function (url, opts) {
    hits++;
    var cmd = String(url).replace("https://fake.upstash.io/", "");
    var i = cmd.indexOf("/");
    var op = cmd.slice(0, i), key = cmd.slice(i + 1);
    if (op === "get") return { ok: true, json: async function () { return { result: db[key] === undefined ? null : db[key] }; } };
    if (op === "set") { db[key] = opts.body; return { ok: true, json: async function () { return { result: "OK" }; } }; }
    if (op === "del") { delete db[key]; return { ok: true, json: async function () { return { result: 1 }; } }; }
    return { ok: false };
  };

  function session(user) {
    var body = Buffer.from(JSON.stringify({ u: user, exp: Date.now() + 60000 })).toString("base64url");
    return body + "." + crypto.createHmac("sha256", "test-secret").update(body).digest("base64url");
  }

  var bridge = require("../api/bridge.js");
  function call(method, opts) {
    opts = opts || {};
    var res = { code: 0, body: null, sent: null, headers: {},
      setHeader: function (k, v) { this.headers[k] = v; },
      status: function (c) { this.code = c; return this; },
      json: function (b) { this.body = b; },
      send: function (b) { this.sent = b; },
      end: function () {} };
    return bridge({ method: method, query: opts.query || {}, body: opts.body,
      headers: opts.headers || {} }, res).then(function () { return res; });
  }
  var asApp = function (user) { return { headers: { authorization: "Bearer " + session(user) } }; };

  db["innertable:state:ann"] = JSON.stringify({
    parts: [{ slug: "the-critic", name: "The Critic", type: "manager", positive_intent: "keep me from failing",
      emotions: ["dread"], relationships: [{ part: "the-dreamer", type: "polarized-with", notes: "always at odds" }],
      feelings: [{ part: "the-dreamer", rating: 2, date: "2026-09-01" }],
      narrative: { in_its_own_words: "I am only trying to help.", origin_story: "" } }],
    transcripts: [{ id: "x", text: "SECRET TRANSCRIPT TEXT" }],
    table: { built: true, name: "Kitchen", room: "A round table.", seats: { "the-critic": "table" }, meetings: [] }
  });
  db["innertable:state:bob"] = JSON.stringify({ parts: [{ slug: "the-bobpart", name: "Bob's Part" }], table: null });

  // -- app side: only a signed-in account manages its link
  t.eq((await call("GET")).code, 401, "no session and no link is refused");
  t.eq((await call("GET", { headers: { authorization: "Bearer forged.token" } })).code, 401, "a forged session is refused");
  t.eq((await call("GET", asApp("ann"))).body.token, null, "no link exists until one is made");

  var made = (await call("POST", asApp("ann"))).body.token;
  t.ok(/^[A-Za-z0-9_-]{43}$/.test(made), "a made link is a 256-bit url-safe token");
  t.eq((await call("GET", asApp("ann"))).body.token, made, "the app can show the link again");
  t.eq((await call("GET", asApp("bob"))).body.token, null, "another account never sees it");

  // -- AI side: plain page
  var page = await call("GET", { query: { t: made } });
  t.eq(page.code, 200, "a good link reads the profile");
  t.ok(/The Critic/.test(page.sent) && /keep me from failing/.test(page.sent), "the page carries the part");
  t.ok(/feels toward the-dreamer: wary/.test(page.sent), "feelings are rendered in words, not bare numbers");
  t.ok(/Kitchen/.test(page.sent) && /the-critic: table/.test(page.sent), "the table is included");
  t.ok(!/SECRET TRANSCRIPT/.test(page.sent), "transcripts never leave");
  t.ok(!/Bob/.test(page.sent), "another account's parts never appear");
  t.eq((await call("GET", { query: { t: made }, headers: { accept: "text/event-stream" } })).code, 405, "an MCP client's event-stream probe gets 405");

  // -- AI side: MCP
  var rpc = function (m) { return call("POST", { query: { t: made }, body: m }); };
  var init = (await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } })).body;
  t.eq(init.result.protocolVersion, "2025-03-26", "initialize echoes a protocol version it supports");
  t.eq((await rpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } })).body.result.protocolVersion,
    "2025-06-18", "an unknown protocol version falls back to the newest");
  t.eq((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).code, 202, "a notification is acknowledged with no body");
  var tools = (await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" })).body.result.tools;
  t.eq(tools.map(function (x) { return x.name; }), ["list_parts", "get_part", "get_table"], "three read tools");
  t.ok(tools.every(function (x) { return x.annotations.readOnlyHint; }), "every tool is marked read-only");
  var got = (await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_part", arguments: { slug: "the-critic" } } })).body;
  t.ok(/I am only trying to help/.test(got.result.content[0].text), "get_part returns the profile");
  t.ok(/No part with that slug/.test((await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_part", arguments: { slug: "the-bobpart" } } })).body.result.content[0].text),
    "a slug from another account is not found");
  t.eq((await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "write_part", arguments: {} } })).body.error.code, -32602, "there is no write tool");
  t.eq((await rpc({ jsonrpc: "2.0", id: 7, method: "nope" })).body.error.code, -32601, "an unknown method is an error, not a crash");

  // -- tokens: malformed never touches storage; revoked reads nothing
  var before = hits;
  t.eq((await call("GET", { query: { t: "../../state" } })).code, 404, "a malformed token is refused");
  t.eq(hits, before, "...without a single storage lookup");
  t.eq((await call("GET", { query: { t: "A".repeat(43) } })).code, 404, "a well-formed but unknown token is refused");

  var second = (await call("POST", asApp("ann"))).body.token;
  t.ok(second !== made, "making a new link gives a new token");
  t.eq((await call("GET", { query: { t: made } })).code, 404, "...and the old one stops working");
  t.eq((await call("GET", { query: { t: second } })).code, 200, "...while the new one works");

  t.eq((await call("DELETE", asApp("ann"))).body.token, null, "revoking succeeds");
  t.eq((await call("GET", { query: { t: second } })).code, 404, "a revoked link reads nothing");
  t.eq((await call("GET", asApp("ann"))).body.token, null, "and the app shows no link");

  // -- bob has his own, separate world
  var bobTok = (await call("POST", asApp("bob"))).body.token;
  var bobPage = (await call("GET", { query: { t: bobTok } })).sent;
  t.ok(/Bob's Part/.test(bobPage) && !/The Critic/.test(bobPage), "a link reaches only its own account");

  delete process.env.SESSION_SECRET;
  t.eq((await call("GET", { query: { t: bobTok } })).code, 500, "an unconfigured server fails closed");

  global.fetch = realFetch;
};
