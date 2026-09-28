/* Inner Table - the check-in reminder. Every device with notifications on
   is nudged every six hours from eight to eight: 8am, 2pm and 8pm on that
   device's own clock. The timezone comes up with the subscription (see
   push-subscribe.js), so a phone is reminded on its time, not the server's;
   one saved before timezones were sent is skipped until the app next opens
   and re-sends it.

   Hit once an hour by .github/workflows/reminders.yml - Vercel's Hobby plan
   only runs its own crons once a day, and "the device's 8am" lands on a
   different UTC hour for every timezone. CRON_SECRET guards it: without that
   check anyone could buzz every subscriber's phone. */
"use strict";

var crypto = require("crypto");

var REMIND_HOURS = [8, 14, 20];
var PREFIX = "innertable:push:";
// a reminder that sat undelivered past this is noise, not a nudge
var TTL_SECONDS = 2 * 60 * 60;

function localHour(tz, now) {
  try {
    return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now));
  } catch (e) { return -1; }
}

function isDue(sub, now) {
  return !!(sub && sub.tz) && REMIND_HOURS.indexOf(localHour(sub.tz, now)) >= 0;
}

function authorized(req, secret) {
  var got = Buffer.from(req.headers.authorization || "");
  var want = Buffer.from("Bearer " + secret);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

module.exports = async function handler(req, res) {
  var base = process.env.UPSTASH_REDIS_REST_URL;
  var redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  var cronSecret = process.env.CRON_SECRET;
  var vapidPublic = process.env.VAPID_PUBLIC_KEY;
  var vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  var vapidSubject = process.env.VAPID_SUBJECT;

  if (!base || !redisToken || !cronSecret || !vapidPublic || !vapidPrivate || !vapidSubject) {
    res.status(500).json({ error: "Reminders are not configured on the server yet." });
    return;
  }
  if (!authorized(req, cronSecret)) { res.status(401).json({ error: "Not allowed" }); return; }

  // required here rather than at the top so test/ can load isDue without
  // node_modules installed
  var webpush = require("web-push");
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  async function redis(cmd) {
    var r = await fetch(base, {
      method: "POST",
      headers: { Authorization: "Bearer " + redisToken },
      body: JSON.stringify(cmd)
    });
    if (!r.ok) throw new Error("Upstash " + cmd[0] + " failed");
    return (await r.json()).result;
  }

  var now = new Date();
  var payload = JSON.stringify({
    title: "Inner Table",
    body: "A moment to check in - is a part asking for you right now?",
    url: "./"
  });

  try {
    var keys = [];
    var cursor = "0";
    do {
      var page = await redis(["SCAN", cursor, "MATCH", PREFIX + "*", "COUNT", "200"]);
      cursor = String(page[0]);
      keys = keys.concat(page[1]);
    } while (cursor !== "0");

    var sent = 0;
    await Promise.all(keys.map(async function (key) {
      var list = [];
      try { list = JSON.parse((await redis(["GET", key])) || "[]"); } catch (e) { list = []; }
      if (!Array.isArray(list)) return;
      var gone = [];
      await Promise.all(list.filter(function (s) { return isDue(s, now); }).map(async function (sub) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
            payload,
            { TTL: TTL_SECONDS }
          );
          sent++;
        } catch (e) {
          // 404/410 = the push service says this subscription is gone
          if (e && (e.statusCode === 404 || e.statusCode === 410)) gone.push(sub.endpoint);
        }
      }));
      if (gone.length) {
        await redis(["SET", key, JSON.stringify(list.filter(function (s) {
          return gone.indexOf(s.endpoint) < 0;
        }))]);
      }
    }));

    res.status(200).json({ ok: true, accounts: keys.length, sent: sent });
  } catch (e) {
    res.status(502).json({ error: e.message || "Reminder run failed" });
  }
};

module.exports.isDue = isDue;
