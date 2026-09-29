/* The check-in reminders: a device is due at 8am, 2pm and 8pm on its own
   clock (DST included), never without a timezone, and the endpoint refuses
   anyone who doesn't hold CRON_SECRET - otherwise it is a button that buzzes
   every subscriber's phone. */
"use strict";

var remind = require("../api/push-remind.js");

module.exports = async function (t) {
  var isDue = remind.isDue;
  var ny = { tz: "America/New_York" };
  var at = function (iso) { return new Date(iso); };

  t.ok(isDue(ny, at("2026-01-15T13:30:00Z")), "8:30am New York in winter (UTC-5) is due");
  t.ok(isDue(ny, at("2026-07-15T12:30:00Z")), "8:30am New York in summer (UTC-4) is due");
  t.ok(isDue(ny, at("2026-01-15T19:05:00Z")), "2pm New York is due");
  t.ok(isDue(ny, at("2026-01-16T01:05:00Z")), "8pm New York is due");
  t.ok(!isDue(ny, at("2026-01-15T12:30:00Z")), "7:30am is not due");
  t.ok(!isDue(ny, at("2026-01-15T14:30:00Z")), "9:30am is not due");
  t.ok(!isDue(ny, at("2026-01-16T02:05:00Z")), "9pm is not due");
  t.ok(!isDue(ny, at("2026-01-15T05:00:00Z")), "midnight is not due");
  t.ok(isDue({ tz: "Asia/Kolkata" }, at("2026-01-15T08:45:00Z")), "a half-hour offset zone at 2:15pm is due");
  t.ok(!isDue({}, at("2026-01-15T08:00:00Z")), "no timezone is never due, even at 8am UTC");
  t.ok(!isDue({ tz: "Not/AZone" }, at("2026-01-15T13:30:00Z")), "a bogus timezone is never due");

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

  delete process.env.CRON_SECRET;
  t.eq((await call("Bearer undefined")).code, 500, "an unset CRON_SECRET fails closed");
};
