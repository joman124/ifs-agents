/* The free AI's settings check (api/_free-ai-settings.js, and
   api/free-ai.js?check=1). What must hold: each mismatch that once reached a
   person - "auto" sent to Groq, another provider's models named, the model
   list cleared, a gateway address that cannot work - is named up front with
   the setting and what to set instead; good settings for each provider pass
   clean; nothing a key holds is ever echoed; only the deployment's owners
   reach the diagnostics, and the live check runs only behind its flag, with
   nothing of anyone's in it. */
"use strict";

var crypto = require("crypto");

module.exports = async function (t) {
  var S = require("../api/_free-ai-settings.js");
  var BASE = { UPSTASH_REDIS_REST_URL: "https://fake.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t", SESSION_SECRET: "s" };
  var GROQ = "https://api.groq.com/openai/v1", GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai";
  var env = function (extra) { return Object.assign({}, BASE, extra); };
  var about = function (r, setting) { return r.problems.filter(function (p) { return p.setting === setting; }); };
  var said = function (r) { return JSON.stringify(r.problems); };

  /* ---- off, and half on ---- */
  var off = S.check(env({}));
  t.ok(!off.on && off.ok, "with no URL and no key the free AI is simply off, not broken");
  t.eq(about(off, "FREELLMAPI_URL").length, 1, "and the check says how to switch it on");
  var noKey = S.check(env({ FREELLMAPI_URL: GROQ }));
  t.ok(!noKey.ok && about(noKey, "FREELLMAPI_KEY")[0].severity === "error", "a URL with no key is an error, naming FREELLMAPI_KEY");
  var noUrl = S.check(env({ FREELLMAPI_KEY: "gsk_abc" }));
  t.ok(!noUrl.ok && /api\.groq\.com/.test(about(noUrl, "FREELLMAPI_URL")[0].fix), "a key with no URL says which addresses to set");
  var noRedis = S.check({ FREELLMAPI_URL: GROQ, FREELLMAPI_KEY: "gsk_abc" });
  t.eq(noRedis.problems.filter(function (p) { return p.severity === "error"; }).map(function (p) { return p.setting; }),
    ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "SESSION_SECRET"], "each missing setting the free AI needs is named");

  /* ---- Groq ---- */
  var g = S.check(env({ FREELLMAPI_URL: GROQ, FREELLMAPI_KEY: "gsk_abc" }));
  t.ok(g.ok && g.problems.length === 0 && g.target === "Groq", "Groq with FREELLMAPI_MODEL unset is clean (its own models are used)");
  t.eq(S.check(env({ FREELLMAPI_URL: GROQ, FREELLMAPI_KEY: "gsk_abc", FREELLMAPI_MODEL: "llama-3.3-70b-versatile, openai/gpt-oss-20b" })).problems, [],
    "Groq naming its own models is clean");
  t.eq(S.check(env({ FREELLMAPI_URL: "https://api.groq.com/openai/v1/chat/completions", FREELLMAPI_KEY: "gsk_abc" })).problems, [],
    "Groq's address given with the full path is fine: the known endpoint is used whatever the path");
  var gAuto = S.check(env({ FREELLMAPI_URL: GROQ, FREELLMAPI_KEY: "gsk_abc", FREELLMAPI_MODEL: "auto" }));
  t.ok(gAuto.ok && /"auto"/.test(about(gAuto, "FREELLMAPI_MODEL")[0].problem), "\"auto\" on Groq is named (Groq has no such model)");
  t.ok(/Take "auto" out/.test(about(gAuto, "FREELLMAPI_MODEL")[0].fix), "with what to do instead");
  var gGem = S.check(env({ FREELLMAPI_URL: GROQ, FREELLMAPI_KEY: "gsk_abc", FREELLMAPI_MODEL: "gemini-2.5-flash" }));
  t.ok(/Gemini/.test(about(gGem, "FREELLMAPI_MODEL")[0].problem) && /llama-3\.3-70b-versatile/.test(about(gGem, "FREELLMAPI_MODEL")[0].fix),
    "a Gemini model named on Groq says whose model it is and lists Groq's instead");
  var gOdd = S.check(env({ FREELLMAPI_URL: GROQ, FREELLMAPI_KEY: "gsk_abc", FREELLMAPI_MODEL: "mixtral-8x7b-32768" }));
  t.ok(/not one of the Groq free models/.test(said(gOdd)), "a model Groq's list does not have is flagged as a likely 404");
  var gKey = S.check(env({ FREELLMAPI_URL: GROQ, FREELLMAPI_KEY: "AIzaSyFAKE-not-real" }));
  t.ok(/does not look like a key for Groq/.test(about(gKey, "FREELLMAPI_KEY")[0].problem), "a Gemini-looking key on Groq is flagged");
  t.ok(said(gKey).indexOf("AIzaSyFAKE") < 0, "without ever echoing the key");

  /* ---- Google's Gemini API ---- */
  var m = S.check(env({ FREELLMAPI_URL: GEMINI, FREELLMAPI_KEY: "AIzaFAKE" }));
  t.ok(m.ok && m.problems.length === 0 && /Gemini/.test(m.target), "Gemini with FREELLMAPI_MODEL unset is clean");
  t.eq(S.check(env({ FREELLMAPI_URL: GEMINI, FREELLMAPI_KEY: "AIzaFAKE", FREELLMAPI_MODEL: "gemini-2.5-flash,gemma-4-31b-it" })).problems, [],
    "Gemini naming its own models is clean");
  var mGroq = S.check(env({ FREELLMAPI_URL: GEMINI, FREELLMAPI_KEY: "AIzaFAKE", FREELLMAPI_MODEL: "llama-3.3-70b-versatile" }));
  t.ok(/a model on Groq/.test(said(mGroq)) && /gemini-2\.5-flash/.test(about(mGroq, "FREELLMAPI_MODEL")[0].fix),
    "a Groq model left in FREELLMAPI_MODEL after switching to Gemini is named, with Gemini's models instead");
  var mAuto = S.check(env({ FREELLMAPI_URL: GEMINI, FREELLMAPI_KEY: "AIzaFAKE", FREELLMAPI_MODEL: "auto:smart" }));
  t.ok(/"auto:smart"/.test(about(mAuto, "FREELLMAPI_MODEL")[0].problem), "a gateway routing named on Gemini is flagged");
  t.ok(/does not look like a key for Google's Gemini API/.test(said(S.check(env({ FREELLMAPI_URL: GEMINI, FREELLMAPI_KEY: "gsk_abc" })))),
    "a Groq key on Gemini is flagged");

  /* ---- a FreeLLMAPI gateway ---- */
  t.eq(S.check(env({ FREELLMAPI_URL: "https://gateway.example", FREELLMAPI_KEY: "any-key" })).problems, [], "a gateway with nothing else set is clean");
  t.eq(S.check(env({ FREELLMAPI_URL: "https://gateway.example/v1", FREELLMAPI_KEY: "k", FREELLMAPI_MODEL: "gemini-2.5-flash, auto:smart" })).problems, [],
    "a gateway may name any provider's models and its own routing");
  var gwPath = S.check(env({ FREELLMAPI_URL: "https://gateway.example/v1/chat/completions", FREELLMAPI_KEY: "k" }));
  t.ok(!gwPath.ok && about(gwPath, "FREELLMAPI_URL")[0].fix === "Set the gateway's bare address: https://gateway.example.",
    "a gateway address ending in /chat/completions is an error, with the bare address to set instead");
  var gwHttp = S.check(env({ FREELLMAPI_URL: "http://gateway.example", FREELLMAPI_KEY: "k" }));
  t.ok(gwHttp.ok && /unencrypted/.test(said(gwHttp)), "http:// works but is warned about");
  var bad = S.check(env({ FREELLMAPI_URL: "gateway.example", FREELLMAPI_KEY: "k" }));
  t.ok(!bad.ok && /https:\/\//.test(about(bad, "FREELLMAPI_URL")[0].fix), "an address without a scheme is an error, saying to start it https://");

  /* ---- other settings ---- */
  t.ok(/default of 500/.test(said(S.check(env({ FREELLMAPI_URL: GROQ, FREELLMAPI_KEY: "gsk_a", FREE_AI_DAILY_LIMIT: "lots" })))),
    "a daily limit that is not a whole number says the default is used");
  t.eq(S.check(env({ FREELLMAPI_URL: GROQ, FREELLMAPI_KEY: "gsk_a", FREE_AI_DAILY_LIMIT: "0" })).problems, [], "0 (no limit) is fine");

  /* ---- live answers, in plain words ---- */
  t.ok(S.liveSaid(200, "").ok, "200: answered");
  t.ok(/take it out of FREELLMAPI_MODEL/.test(S.liveSaid(404, "{\"error\":{\"message\":\"model_not_found\"}}").said), "404: the model to take out");
  t.ok(/FREELLMAPI_KEY/.test(S.liveSaid(400, "API key not valid. Please pass a valid API key.").said), "Gemini's 400 for a bad key names the key");
  t.ok(/FREELLMAPI_KEY/.test(S.liveSaid(401, "").said), "401 names the key");
  t.ok(S.liveSaid(429, "").ok, "429 is a busy model, not a settings problem");
  t.ok(/FREELLMAPI_URL/.test(S.liveSaid(0, "").said), "unreachable names the URL");
  t.ok(S.liveSaid(500, "Traceback: secret stuff").said.indexOf("Traceback") < 0, "a raw error is never passed on");

  /* ---- the owners' page and the startup log, through the handler ---- */
  var KEYS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "SESSION_SECRET", "FREELLMAPI_URL", "FREELLMAPI_KEY",
    "FREELLMAPI_MODEL", "FREE_AI_DAILY_LIMIT", "STATS_USERS", "CRON_SECRET", "FREE_AI_LIVE_CHECK"];
  var saved = {};
  KEYS.forEach(function (k) { saved[k] = process.env[k]; delete process.env[k]; });
  var warned = [];
  var realWarn = console.warn;
  console.warn = function (x) { warned.push(String(x)); };
  var realFetch = global.fetch;
  var sent = [];
  global.fetch = async function (url, opts) {
    sent.push({ url: String(url), body: JSON.parse(opts.body) });
    var model = JSON.parse(opts.body).model;
    var status = model === "gone-model" ? 404 : 200;
    return { ok: status === 200, status: status, text: async function () { return "{}"; } };
  };

  try {
    var handler = require("../api/free-ai.js");
    handler._internal.forget();
    var session = function (user) {
      var body = Buffer.from(JSON.stringify({ u: user, exp: Date.now() + 60000 })).toString("base64url");
      return body + "." + crypto.createHmac("sha256", "test-secret").update(body).digest("base64url");
    };
    var call = function (query, user) {
      var res = { code: 0, body: null, headers: {},
        setHeader: function (k, v) { this.headers[k] = v; },
        status: function (c) { this.code = c; return this; },
        json: function (b) { this.body = b; } };
      var req = { method: "GET", query: query, headers: user ? { authorization: "Bearer " + session(user) } : {} };
      return handler(req, res).then(function () { return res; });
    };

    Object.assign(process.env, { UPSTASH_REDIS_REST_URL: "https://fake.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t",
      SESSION_SECRET: "test-secret", STATS_USERS: "owner", FREELLMAPI_URL: GROQ, FREELLMAPI_KEY: "gsk_fake",
      FREELLMAPI_MODEL: "gemini-2.5-flash, gone-model" });

    var plain = await call({});
    t.eq(plain.body, { available: true, daily: 500 }, "the plain GET is unchanged");
    t.ok(warned.some(function (w) { return /^free-ai settings: FREELLMAPI_MODEL names gemini-2\.5-flash, a model on Google's Gemini API/.test(w); }),
      "the first request logs each settings problem, naming the setting");
    var count = warned.length;
    await call({});
    t.eq(warned.length, count, "and only once per instance");

    t.eq((await call({ check: "1" })).code, 404, "the diagnostics are a 404 without a session");
    t.eq((await call({ check: "1" }, "someone")).code, 404, "and for an account that does not run the deployment");
    var page = await call({ check: "1" }, "owner");
    t.eq(page.code, 200, "an owner gets them");
    t.eq(page.body.target, "Groq", "saying what FREELLMAPI_URL points at");
    t.ok(page.body.problems.some(function (p) { return p.setting === "FREELLMAPI_MODEL"; }), "and what is wrong");
    t.ok(page.body.models.indexOf("llama-3.3-70b-versatile") >= 0, "and which models a session will try");
    t.ok(JSON.stringify(page.body).indexOf("gsk_fake") < 0, "never the key");
    t.eq(sent.length, 0, "no request is sent for a plain check");

    var noLive = await call({ check: "live" }, "owner");
    t.ok(/FREE_AI_LIVE_CHECK=1/.test(noLive.body.live.off) && sent.length === 0, "the live check is off unless the flag is set");

    process.env.FREE_AI_LIVE_CHECK = "1";
    var live = await call({ check: "live" }, "owner");
    t.eq(sent.length, live.body.models.length, "with the flag: one request per model");
    t.ok(sent.every(function (s) { return s.url === "https://api.groq.com/openai/v1/chat/completions"; }), "to the provider's endpoint");
    t.ok(sent.every(function (s) { return s.body.messages.length === 1 && s.body.messages[0].content === "Say OK." && s.body.max_tokens <= 16; }),
      "each a tiny fixed prompt, with no one's content");
    var gone = live.body.live.models.filter(function (x) { return x.model === "gone-model"; })[0];
    t.ok(gone && !gone.ok && /take it out/.test(gone.said), "a model the provider does not have is named, with what to do");
    t.ok(live.body.live.models.filter(function (x) { return x.model === "llama-3.3-70b-versatile"; })[0].ok, "a model that answers says so");

    delete process.env.SESSION_SECRET;
    process.env.CRON_SECRET = "cron-secret";
    var res = { code: 0, body: null, setHeader: function () {}, status: function (c) { this.code = c; return this; }, json: function (b) { this.body = b; } };
    await handler({ method: "GET", query: { check: "1" }, headers: { authorization: "Bearer cron-secret" } }, res);
    t.ok(res.code === 200 && res.body.problems.some(function (p) { return p.setting === "SESSION_SECRET"; }),
      "CRON_SECRET reaches them even when SESSION_SECRET is the missing setting");
    t.eq((await call({ check: "1" }, "owner")).code, 404, "and with no SESSION_SECRET no session gets in");
  } finally {
    global.fetch = realFetch;
    console.warn = realWarn;
    KEYS.forEach(function (k) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  }
};
