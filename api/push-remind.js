/* Inner Table - the daily reminder. Each device with notifications on is
   nudged at the hours the person chose for it - once a day by default, at
   8pm on that device's own clock. A reflective practice nagged three times a
   day turns into one more "should"; one quiet nudge, at a time they picked,
   does not. The timezone comes up with the subscription (see
   push-subscribe.js), so a phone is reminded on its time, not the server's;
   one saved before timezones were sent is skipped until the app next opens
   and re-sends it.

   Hit once an hour by 24 daily Vercel crons (vercel.json: Hobby allows 100
   jobs, each once a day, firing anywhere inside its hour), with
   .github/workflows/reminders.yml as a backup - GitHub's "hourly" schedule
   ran about four times a day in practice. Runs land late, skip an hour or
   double up, so a reminder still goes out up to LATE_HOURS after the chosen
   hour, and each device remembers the last one it got (sub.last) so it is
   never sent twice. CRON_SECRET guards it (Vercel sends it as the bearer):
   without that check anyone could buzz every subscriber's phone. */
"use strict";

var crypto = require("crypto");

var DEFAULT_HOURS = [20];
var LATE_HOURS = 3;

/* The hours a device asked for (push-subscribe.js keeps them clean), or the
   default for one saved before there was a choice. */
function hoursOf(sub) {
  var h = sub && Array.isArray(sub.hours) ? sub.hours.filter(function (x) {
    return typeof x === "number" && x >= 0 && x <= 23 && Math.floor(x) === x;
  }) : [];
  return h.length ? h : DEFAULT_HOURS;
}
var PREFIX = "innertable:push:";
// a reminder that sat undelivered past this is noise, not a nudge
var TTL_SECONDS = 2 * 60 * 60;

/* The device's own date and hour, or null for a timezone Intl won't take. */
function localTime(tz, now) {
  try {
    var p = {};
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "numeric", hourCycle: "h23" }).formatToParts(now).forEach(function (x) { p[x.type] = x.value; });
    return { date: p.year + "-" + p.month + "-" + p.day, hour: Number(p.hour) };
  } catch (e) { return null; }
}

/* The reminder a device is owed right now, as "YYYY-MM-DD@HH" on its own
   clock - the latest chosen hour that has come within the last LATE_HOURS
   and not been sent yet - or "" when nothing is owed. */
function isDue(sub, now) {
  var t = sub && sub.tz ? localTime(sub.tz, now) : null;
  if (!t) return "";
  var owed = hoursOf(sub).filter(function (h) { return h <= t.hour && t.hour < h + LATE_HOURS; });
  if (!owed.length) return "";
  var slot = t.date + "@" + String(Math.max.apply(null, owed)).padStart(2, "0");
  return (typeof sub.last === "string" ? sub.last : "") >= slot ? "" : slot;
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
    body: "A moment to notice - which part is around right now?",
    // opens straight onto the ten-second notice
    url: "./?notice=1"
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
      var gone = [], sentTo = {};
      await Promise.all(list.map(async function (sub) {
        var slot = isDue(sub, now);
        if (!slot) return;
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
            payload,
            { TTL: TTL_SECONDS }
          );
          sent++;
          sentTo[sub.endpoint] = slot;
        } catch (e) {
          // 404/410 = the push service says this subscription is gone
          if (e && (e.statusCode === 404 || e.statusCode === 410)) gone.push(sub.endpoint);
        }
      }));
      if (gone.length || Object.keys(sentTo).length) {
        // re-read so a device that subscribed during the sends is kept
        // ponytail: still a read-then-write; Redis WATCH/MULTI if it ever bites
        var fresh = [];
        try { fresh = JSON.parse((await redis(["GET", key])) || "[]"); } catch (e) { fresh = list; }
        if (!Array.isArray(fresh)) fresh = list;
        await redis(["SET", key, JSON.stringify(fresh.filter(function (s) {
          return gone.indexOf(s.endpoint) < 0;
        }).map(function (s) {
          return sentTo[s.endpoint] ? Object.assign({}, s, { last: sentTo[s.endpoint] }) : s;
        }))]);
      }
    }));

    res.status(200).json({ ok: true, accounts: keys.length, sent: sent });
  } catch (e) {
    res.status(502).json({ error: e.message || "Reminder run failed" });
  }
};

module.exports.isDue = isDue;
