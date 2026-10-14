/* The daily reminder: a device is due at the hours chosen for it - 8pm by
   default - on its own clock (DST included), never without a timezone, and the endpoint refuses
   anyone who doesn't hold CRON_SECRET - otherwise it is a button that buzzes
   every subscriber's phone. */
"use strict";

var remind = require("../api/push-remind.js");

module.exports = async function (t) {
  var isDue = remind.isDue;
  var ny = { tz: "America/New_York" };
  var at = function (iso) { return new Date(iso); };

  // by default: once a day, at 8pm on the device's own clock
  t.ok(isDue(ny, at("2026-01-16T01:05:00Z")), "8pm New York in winter (UTC-5) is due by default");
  t.ok(isDue(ny, at("2026-07-16T00:05:00Z")), "8pm New York in summer (UTC-4) is due by default");
  t.ok(!isDue(ny, at("2026-01-15T13:30:00Z")), "8:30am is not due by default - one nudge a day, not three");
  t.ok(!isDue(ny, at("2026-01-15T19:05:00Z")), "2pm is not due by default");
  t.ok(isDue(ny, at("2026-01-16T02:05:00Z")), "9pm still owes an 8pm reminder no run delivered");
  t.ok(!isDue(ny, at("2026-01-16T04:05:00Z")), "...but 11pm is too late to send it");
  t.eq(isDue(ny, at("2026-01-16T01:05:00Z")), "2026-01-15@20", "what is owed is named on the device's own date and hour");

  // never twice: a run that lands late, doubles up, or follows a re-subscribe
  var got = { tz: "America/New_York", last: "2026-01-15@20" };
  t.ok(!isDue(got, at("2026-01-16T01:40:00Z")) && !isDue(got, at("2026-01-16T02:05:00Z")), "a device that got tonight's reminder is not sent it again");
  t.ok(isDue(got, at("2026-01-17T01:05:00Z")), "...and is owed tomorrow's");
  var both = { tz: "America/New_York", hours: [8, 20], last: "2026-01-15@08" };
  t.ok(isDue(both, at("2026-01-16T01:05:00Z")), "the morning one going out does not stop the evening one");

  // a time the person chose
  var morning = { tz: "America/New_York", hours: [8] };
  t.ok(isDue(morning, at("2026-01-15T13:30:00Z")), "a device set to 8am is due at 8:30am");
  t.ok(!isDue(morning, at("2026-01-16T01:05:00Z")), "...and not at 8pm");
  var twice = { tz: "America/New_York", hours: [8, 20] };
  t.ok(isDue(twice, at("2026-01-15T13:30:00Z")) && isDue(twice, at("2026-01-16T01:05:00Z")), "morning and evening, when asked for");
  t.ok(isDue({ tz: "America/New_York", hours: ["8", 99] }, at("2026-01-16T01:05:00Z")), "nonsense hours fall back to the default");

  t.ok(isDue({ tz: "Asia/Kolkata", hours: [14] }, at("2026-01-15T08:45:00Z")), "a half-hour offset zone at 2:15pm is due when 2pm was chosen");
  t.ok(!isDue({}, at("2026-01-16T01:05:00Z")), "no timezone is never due");
  t.ok(!isDue({ tz: "Not/AZone" }, at("2026-01-16T01:05:00Z")), "a bogus timezone is never due");

  var validHours = require("../api/push-subscribe.js").validHours;
  t.eq(validHours([20, 8, 8]), [8, 20], "chosen hours are kept whole, unique and in order");
  t.eq(validHours([1, 2, 3, 4]), undefined, "more than three a day is not kept");
  t.eq(validHours(["8", 25, -1, 7.5]), undefined, "nothing that is not an hour is kept");

  process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "fake-redis-token";
  process.env.VAPID_PUBLIC_KEY = "pub";
  process.env.VAPID_PRIVATE_KEY = "priv";
  process.env.VAPID_SUBJECT = "https://example.test";
  process.env.CRON_SECRET = "the-cron-secret";

  function call(authorization) {
    var res = { code: 0, body: null,
      status: function (c) { this.code = c; return this; },
      json: function (b) { this.body = b; } };
    return remind({ method: "GET", headers: authorization ? { authorization: authorization } : {} }, res)
      .then(function () { return res; });
  }

  t.eq((await call("")).code, 401, "no secret is refused");
  t.eq((await call("Bearer wrong")).code, 401, "a wrong secret is refused");
  t.eq((await call("Bearer the-cron-secretX")).code, 401, "a longer secret with the right prefix is refused");

  // a full run: who gets sent what, and what is remembered
  var Module = require("module");
  var realLoad = Module._load;
  var pushed = [];
  Module._load = function (req) {
    if (req === "web-push") return { setVapidDetails: function () {}, sendNotification: async function (sub) {
      if (sub.endpoint === "https://push.test/gone") { var e = new Error("gone"); e.statusCode = 410; throw e; }
      pushed.push(sub.endpoint);
    } };
    return realLoad.apply(this, arguments);
  };
  var db = { "innertable:push:ann": JSON.stringify([
    { endpoint: "https://push.test/phone", keys: { p256dh: "p", auth: "a" }, tz: "America/New_York" },
    { endpoint: "https://push.test/laptop", keys: { p256dh: "p", auth: "a" }, tz: "America/New_York", hours: [8] },
    { endpoint: "https://push.test/gone", keys: { p256dh: "p", auth: "a" }, tz: "America/New_York" }]) };
  var realFetch = global.fetch;
  global.fetch = async function (url, opts) {
    var cmd = JSON.parse(opts.body), result = null;
    if (cmd[0] === "SCAN") result = ["0", Object.keys(db)];
    if (cmd[0] === "GET") result = db[cmd[1]] || null;
    if (cmd[0] === "SET") { db[cmd[1]] = cmd[2]; result = "OK"; }
    return { ok: true, json: async function () { return { result: result }; } };
  };
  var RealDate = Date;
  var clock = function (iso) { global.Date = function (v) { return v === undefined ? new RealDate(iso) : new RealDate(v); }; };
  try {
    clock("2026-01-16T02:20:00Z");   // 9:20pm in New York: the 8pm run never came
    var run1 = await call("Bearer the-cron-secret");
    t.eq(run1.body.sent, 1, "a late run sends the evening reminder it owes");
    t.eq(pushed, ["https://push.test/phone"], "...only to the device that wanted the evening");
    var saved = JSON.parse(db["innertable:push:ann"]);
    t.eq(saved.map(function (s) { return s.endpoint; }), ["https://push.test/phone", "https://push.test/laptop"], "a subscription the push service says is gone is dropped");
    t.eq(saved[0].last, "2026-01-15@20", "...and the one that was sent is remembered");
    clock("2026-01-16T02:50:00Z");   // a second run in the same hour
    t.eq((await call("Bearer the-cron-secret")).body.sent, 0, "a doubled-up run sends nothing more");
    clock("2026-01-16T13:10:00Z");   // 8:10am the next morning
    t.eq((await call("Bearer the-cron-secret")).body.sent, 1, "the morning device gets its own in the morning");
    t.eq(pushed[pushed.length - 1], "https://push.test/laptop", "...and only that one");
  } finally {
    global.Date = RealDate;
    global.fetch = realFetch;
    Module._load = realLoad;
  }

  delete process.env.CRON_SECRET;
  t.eq((await call("Bearer undefined")).code, 500, "an unset CRON_SECRET fails closed");
};
