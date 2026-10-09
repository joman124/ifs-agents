/* The person's own AI connection, kept with their account (api/ai-key.js).
   What must hold: only the account's own session reads or writes it, the key
   is never stored in the clear, a disconnect is kept (so other devices learn
   of it), and OpenRouter's sign-in lands the key on the account that started
   it - once, and never on anyone else's. */
"use strict";

var crypto = require("crypto");

module.exports = async function (t) {
  process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "fake-redis-token";
  process.env.SESSION_SECRET = "test-secret";

  var db = {};
  var ttl = {};
  var openrouter = { exchanges: [], key: "sk-or-v1-made-for-ann" };
  var realFetch = global.fetch;
  var ok = function (v) { return { ok: true, json: async function () { return v; } }; };
  global.fetch = async function (url, opts) {
    url = String(url);
    if (url === "https://openrouter.ai/api/v1/auths/keys") {
      openrouter.exchanges.push(JSON.parse(opts.body));
      return openrouter.key ? ok({ key: openrouter.key }) : { ok: false, json: async function () { return {}; } };
    }
    if (url === "https://openrouter.ai/api/v1/models") {
      return ok({ data: [
        { id: "anthropic/claude-sonnet-5", created: 100 },
        { id: "anthropic/claude-sonnet-5.5", created: 200 },
        { id: "anthropic/claude-sonnet-5.5:beta", created: 300 },
        { id: "anthropic/claude-opus-5.5", created: 400 }
      ] });
    }
    if (url === "https://fake.upstash.io") {        // a command array
      var cmd = JSON.parse(opts.body);
      if (cmd[0] === "SET") { db[cmd[1]] = cmd[2]; if (cmd[3] === "EX") ttl[cmd[1]] = Number(cmd[4]); }
      return ok({ result: "OK" });
    }
    var path = url.replace("https://fake.upstash.io/", "");
    var i = path.indexOf("/");
    var op = path.slice(0, i), key = path.slice(i + 1);
    if (op === "get") return ok({ result: db[key] === undefined ? null : db[key] });
    if (op === "set") { db[key] = opts.body; return ok({ result: "OK" }); }
    if (op === "del") { delete db[key]; return ok({ result: 1 }); }
    return { ok: false };
  };

  function session(user) {
    var body = Buffer.from(JSON.stringify({ u: user, exp: Date.now() + 60000 })).toString("base64url");
    return body + "." + crypto.createHmac("sha256", "test-secret").update(body).digest("base64url");
  }

  var handler = require("../api/ai-key.js");
  function call(method, opts) {
    opts = opts || {};
    var res = { code: 0, body: null, headers: {}, ended: false,
      setHeader: function (k, v) { this.headers[k] = v; },
      status: function (c) { this.code = c; return this; },
      json: function (b) { this.body = b; },
      end: function () { this.ended = true; } };
    Object.defineProperty(res, "statusCode", { set: function (c) { this.code = c; }, get: function () { return this.code; } });
    return handler({ method: method, query: opts.query || {}, body: opts.body,
      headers: Object.assign({ host: "inner.example" }, opts.headers || {}) }, res).then(function () { return res; });
  }
  var as = function (user, extra) { return Object.assign({ headers: { authorization: "Bearer " + session(user) } }, extra || {}); };

  /* ---- only the account's own session ---- */
  t.eq((await call("GET")).code, 401, "no session reads nothing");
  t.eq((await call("POST", { body: { ai: { provider: "anthropic", key: "sk-ant-x" } } })).code, 401, "no session writes nothing");
  t.eq((await call("GET", as("ann"))).body.ai, null, "nothing is connected until it is");

  var at = "2026-10-09T10:00:00.000Z";
  var saved = await call("POST", as("ann", { body: { ai: { provider: "anthropic", key: "sk-ant-secret-123", model: "", at: at } } }));
  t.eq(saved.code, 200, "a signed-in person can keep a connection");
  t.ok(db["innertable:ai:ann"] && db["innertable:ai:ann"].indexOf("sk-ant-secret-123") < 0, "the key is never stored in the clear");
  t.eq((await call("GET", as("ann"))).body.ai, { provider: "anthropic", key: "sk-ant-secret-123", model: "", at: at },
    "and it comes back to the same account, whole");
  t.eq((await call("GET", as("bob"))).body.ai, null, "another account never sees it");

  t.eq((await call("POST", as("ann", { body: { ai: { provider: "nonsense", key: "k" } } }))).code, 400, "an unknown provider is refused");
  var off = await call("POST", as("ann", { body: { ai: { provider: "anthropic", key: "", model: "x", at: "2026-10-09T11:00:00.000Z" } } }));
  t.eq(off.code, 200, "a disconnect is accepted");
  t.eq((await call("GET", as("ann"))).body.ai, { provider: "", key: "", model: "", at: "2026-10-09T11:00:00.000Z" },
    "and kept, with its time, so every device hears of it");

  /* ---- sealing ---- */
  var I = handler._internal;
  t.eq(I.open(I.seal({ a: 1 }, "s1"), "s1"), { a: 1 }, "sealed data opens with the same secret");
  t.eq(I.open(I.seal({ a: 1 }, "s1"), "s2"), null, "and not with another");
  t.eq(I.callbackParams({ query: { state: "abc?code=xyz" } }), { state: "abc", code: "xyz" }, "a code glued onto the state is still read");
  t.eq(I.callbackParams({ query: { state: "abc", code: "xyz" } }), { state: "abc", code: "xyz" }, "and so is a separate one");

  /* ---- OpenRouter's one-tap sign-in ---- */
  var start = await call("POST", as("ann", { body: { action: "openrouter" } }));
  t.eq(start.code, 200, "the sign-in can be started by a signed-in person");
  var u = new URL(start.body.url);
  t.eq(u.origin + u.pathname, "https://openrouter.ai/auth", "it sends them to OpenRouter's sign-in");
  t.eq(u.searchParams.get("code_challenge_method"), "S256", "with a PKCE challenge");
  var cb = new URL(u.searchParams.get("callback_url"));
  t.ok(/^https:\/\/inner\.example\/connect\/openrouter\/[A-Za-z0-9_-]{20,80}$/.test(cb.href), "and back to this deployment, on a plain path");
  var state = cb.pathname.split("/").pop();
  t.eq(ttl["innertable:oauth:" + state], 900, "the pending sign-in expires on its own");
  t.eq((await call("POST", { body: { action: "openrouter" } })).code, 401, "nobody signed out can start one");

  var back = await call("GET", { query: { state: state, code: "the-code" } });
  t.eq(back.code, 302, "coming back redirects into the app");
  t.eq(back.headers.Location, "/?connected=openrouter", "connected");
  var ex = openrouter.exchanges[0];
  t.eq(ex.code, "the-code", "the code is exchanged");
  t.eq(crypto.createHash("sha256").update(ex.code_verifier).digest("base64url"), u.searchParams.get("code_challenge"),
    "with the verifier that matches the challenge sent");
  var kept = (await call("GET", as("ann"))).body.ai;
  t.eq([kept.provider, kept.key, kept.model], ["openrouter", "sk-or-v1-made-for-ann", "anthropic/claude-sonnet-5.5"],
    "the key lands on the account that started it, on the newest plain Claude Sonnet");
  t.eq((await call("GET", as("bob"))).body.ai, null, "and nowhere else");

  var again = await call("GET", { query: { state: state, code: "the-code" } });
  t.eq(again.headers.Location, "/?connect_error=expired", "a state is good for one use only");
  t.eq((await call("GET", { query: { state: "short", code: "c" } })).headers.Location, "/?connect_error=cancelled", "a malformed state goes nowhere");

  var start2 = new URL(new URL((await call("POST", as("bob", { body: { action: "openrouter" } }))).body.url).searchParams.get("callback_url")).pathname.split("/").pop();
  openrouter.key = "";
  t.eq((await call("GET", { query: { state: start2, code: "bad" } })).headers.Location, "/?connect_error=openrouter",
    "when OpenRouter hands over no key, nothing is saved");
  t.eq((await call("GET", as("bob"))).body.ai, null, "and bob is still not connected");

  global.fetch = realFetch;
};
