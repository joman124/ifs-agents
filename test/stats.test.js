/* Returning users (api/_activity.js, api/stats.js). What must hold: the
   lists hold a pseudonym, never a name, and the same one for an account
   every time; counting can never change what a pull gets back, even when
   it fails; only the accounts named in STATS_USERS and CRON_SECRET can read
   the totals, and to everyone else the endpoint does not exist; and the
   totals are right - worked by hand below, window edges included. */
"use strict";

var crypto = require("crypto");

module.exports = async function (t) {
  var ENV = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "SESSION_SECRET", "STATS_USERS", "CRON_SECRET"];
  var saved = {};
  ENV.forEach(function (k) { saved[k] = process.env[k]; delete process.env[k]; });
  var realFetch = global.fetch;

  var A = require("../api/_activity.js");
  var stats = require("../api/stats.js");
  var sync = require("../api/sync.js");
  var summarize = stats.summarize;

  function res() {
    return {
      code: 0, body: null,
      status: function (c) { this.code = c; return this; },
      json: function (b) { this.body = b; return this; }
    };
  }
  function signWith(secret, payload) {
    var body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return body + "." + crypto.createHmac("sha256", secret).update(body).digest("base64url");
  }
  var ok = function (v) { return { ok: true, status: 200, json: async function () { return v; } }; };

  try {
    /* ---- the totals, worked by hand ----
       today 2026-10-23; "this week" is 10-17..10-23, "this month" 09-26..10-23.
         p  here before counting began, opened the app today
         q  joined 10-15 (8 days ago), back on 10-22 - day 7, the last that counts
         r  joined 09-18 (35 days ago), back on 09-26 - day 8, one too late
         s  joined 09-17 (36 days ago), back the next day - outside the window
         u  joined 10-16 (7 days ago), back 10-17: its week is not over yet
         v  joined 10-17 (6 days ago): new this week */
    var today = "2026-10-23";
    var days = {
      "2026-10-23": ["p"],
      "2026-10-22": ["q"],
      "2026-10-17": ["u", "v"],
      "2026-10-15": ["q"],
      "2026-09-26": ["r"],
      "2026-09-18": ["r", "s"],
      "2026-09-17": ["s"]
    };
    var first = { p: "before", q: "2026-10-15", r: "2026-09-18", s: "2026-09-17", u: "2026-10-16", v: "2026-10-17" };
    var sum = summarize(days, first, today);
    t.eq(sum.active, { today: 1, week: 4, month: 5 }, "active today, over 7 days and over 28 days, each account once");
    t.eq(sum.returningThisWeek, 3, "returning: active this week and first came before it - including someone from before counting");
    t.eq(sum.newThisWeek, 1, "new: made in the last 7 days, and never also counted as returning");
    t.eq(sum.cameBackWithin7, { of: 2, came: 1, pct: 50 },
      "came back within a week: only first days 8-35 days ago count, and day 7 is in while day 8 is not");
    t.eq(sum.stickiness, 0.8, "stickiness is this week's people over this month's");
    t.eq(sum.accounts, { seen: 6, before: 1 }, "accounts seen, and how many were here before counting began");
    t.eq(sum.since, "2026-09-17", "since: the earliest day anyone was marked");
    t.eq(sum.cohorts.length, 8, "eight weekly cohorts");
    t.eq(sum.cohorts[7], { start: "2026-10-17", end: "2026-10-23", size: 1, weeks: [] }, "this week's cohort has no later weeks yet");
    t.eq(sum.cohorts[6], { start: "2026-10-10", end: "2026-10-16", size: 2, weeks: [2] }, "last week's: both came back this week");
    t.eq(sum.cohorts[2], { start: "2026-09-12", end: "2026-09-18", size: 2, weeks: [0, 1, 0, 0, 0] },
      "an older cohort counts each later week, oldest first");
    t.eq(sum.cohorts[0].start, "2026-08-29", "cohorts reach back eight full weeks");
    t.eq(sum.cohorts.reduce(function (n, c) { return n + c.size; }, 0), 5,
      "someone from before counting began is in no cohort");

    var none = summarize({}, {}, today);
    t.eq([none.active, none.returningThisWeek, none.newThisWeek, none.cameBackWithin7, none.stickiness, none.since],
      [{ today: 0, week: 0, month: 0 }, 0, 0, { of: 0, came: 0, pct: null }, null, null],
      "with nothing counted yet: zeros, and no shares made up from nothing");

    /* ---- what a pull writes ---- */
    process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "fake-redis-token";
    process.env.SESSION_SECRET = "test-session-secret";
    var aliceToken = signWith("test-session-secret", { u: "alice", exp: Date.now() + 60000 });
    var bobToken = signWith("test-session-secret", { u: "bob", exp: Date.now() + 60000 });

    var calls = [];
    var counting = "ok";    // how the fake answers the counting pipeline
    global.fetch = async function (url, opts) {
      url = String(url);
      calls.push({ url: url, body: opts && opts.body });
      if (/\/pipeline$/.test(url)) {
        if (counting === "throw") throw new Error("network");
        if (counting === "fail") return { ok: false, status: 500, json: async function () { return {}; } };
        return ok([{ result: 1 }, { result: 1 }, { result: 1 }]);
      }
      if (url.indexOf("/get/innertable:state:") !== -1) return ok({ result: '{"parts":{}}' });
      if (url.indexOf("/hgetall/innertable:inbox:") !== -1) return ok({ result: [] });
      return ok({ result: null });
    };

    async function pull(tok) {
      calls.length = 0;
      var r = res();
      await sync({ method: "GET", headers: { authorization: "Bearer " + tok } }, r);
      var c = calls.filter(function (x) { return /\/pipeline$/.test(x.url); })[0];
      return { r: r, cmds: c ? JSON.parse(c.body) : null, raw: c ? c.body : "" };
    }

    var a1 = await pull(aliceToken);
    var day = A.dayOf();
    t.ok(calls[0].url.indexOf("/get/innertable:state:alice") !== -1, "the state read goes out first; counting never stands in its way");
    t.ok(a1.cmds && a1.cmds[0][0] === "SADD" && a1.cmds[0][1] === "innertable:active:" + day,
      "a pull adds the account to today's list");
    t.eq(a1.cmds[1], ["EXPIRE", "innertable:active:" + day, String(150 * 24 * 60 * 60)], "...which expires after 150 days");
    t.eq(a1.cmds[2][0] + " " + a1.cmds[2][1] + " " + a1.cmds[2][3], "HSETNX innertable:firstseen before",
      "...and an account with no day of its own is noted as here before counting began, never moved after");
    var aliceId = a1.cmds[0][2];
    t.ok(/^[0-9a-f]{16}$/.test(aliceId) && a1.raw.indexOf("alice") === -1, "what is stored is a pseudonym, not the name");
    t.eq(aliceId, A.activityId("alice", "test-session-secret"), "...an HMAC of it under the session secret");
    var a2 = await pull(aliceToken);
    t.eq(a2.cmds[0][2], aliceId, "the same account gets the same pseudonym every time");
    var b1 = await pull(bobToken);
    t.ok(b1.cmds[0][2] !== aliceId, "and another account gets another");

    /* ---- counting failing changes nothing a pull gets back ---- */
    var good = a1.r;
    counting = "throw";
    var thrown = await pull(aliceToken);
    counting = "fail";
    var failed = await pull(aliceToken);
    counting = "ok";
    t.eq([thrown.r.code, thrown.r.body], [good.code, good.body], "a counting request that throws leaves the pull exactly as it was");
    t.eq([failed.r.code, failed.r.body], [good.code, good.body], "...and so does one Upstash refuses");
    t.eq(good.code, 200, "(which is a normal 200 with the state)");

    /* ---- sign-up notes the day an account was made ---- */
    var made = [];
    await A.markNew("https://fake.upstash.io", "fake-redis-token", "test-session-secret", "newcomer", new Date("2026-10-23T12:00:00Z"));
    made = calls.filter(function (x) { return x.url === "https://fake.upstash.io"; });
    t.eq(JSON.parse(made[made.length - 1].body), ["HSETNX", "innertable:firstseen", A.activityId("newcomer", "test-session-secret"), "2026-10-23"],
      "a new account's first day is its sign-up day, under its pseudonym");
    global.fetch = async function () { throw new Error("network"); };
    var threw = false;
    try { await A.markNew("https://fake.upstash.io", "x", "test-session-secret", "newcomer"); } catch (e) { threw = true; }
    t.ok(!threw, "and a failure there never reaches sign-up");

    /* ---- who may read the totals ---- */
    process.env.STATS_USERS = " Alice , carol";
    process.env.CRON_SECRET = "cron-secret-value";
    var reads = 0;
    global.fetch = async function (url, opts) {
      reads++;
      var cmds = JSON.parse(opts.body);
      return ok(cmds.map(function (c) {
        if (c[0] === "HGETALL") return { result: ["x1", "before", "y2", A.dayOf()] };
        return { result: c[1] === "innertable:active:" + A.dayOf() ? ["x1", "y2"] : [] };
      }));
    };
    async function ask(auth, method) {
      var r = res();
      await stats({ method: method || "GET", headers: auth ? { authorization: auth } : {} }, r);
      return r;
    }
    t.eq((await ask("")).code, 404, "no credentials: as if there were no such endpoint");
    t.eq((await ask("Bearer " + bobToken)).code, 404, "a signed-in account not listed gets the same 404");
    t.eq((await ask("Bearer " + signWith("not-the-secret", { u: "alice", exp: Date.now() + 60000 }))).code, 404,
      "a forged token naming a listed account gets nothing");
    t.eq((await ask("Bearer " + signWith("test-session-secret", { u: "alice", exp: Date.now() - 1000 }))).code, 404,
      "nor does an expired one");
    t.eq((await ask("Bearer wrong-cron-secret")).code, 404, "nor a wrong secret");
    t.eq((await ask("Bearer " + bobToken, "POST")).code, 404, "anyone else is told nothing, whatever the method");
    t.eq(reads, 0, "...and none of that touched the database");
    var owner = await ask("Bearer " + aliceToken);
    t.eq(owner.code, 200, "a listed account reads them - names matched without case or spaces");
    t.eq([owner.body.returningThisWeek, owner.body.newThisWeek, owner.body.active.today], [1, 1, 2],
      "...built from today's list and the first-seen days");
    t.eq((await ask("Bearer cron-secret-value")).code, 200, "CRON_SECRET reads them too, for a script");
    t.eq((await ask("Bearer " + aliceToken, "POST")).code, 405, "a listed account writing gets the usual 405");
    process.env.STATS_USERS = "";
    t.eq((await ask("Bearer " + aliceToken)).code, 404, "with STATS_USERS empty, no account can");
    process.env.CRON_SECRET = "";
    t.eq((await ask("Bearer ")).code, 404, "and an empty CRON_SECRET opens nothing");

    delete process.env.SESSION_SECRET;
    t.eq((await ask("Bearer cron-secret-value")).code, 500, "unconfigured, it says so like the other endpoints");
  } finally {
    global.fetch = realFetch;
    ENV.forEach(function (k) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  }
};
