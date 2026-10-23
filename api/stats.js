/* Inner Table - how many people come back, for whoever runs the deployment.

   GET -> totals built from the lists api/_activity.js keeps. Two callers
   only: a signed-in account named in STATS_USERS (comma-separated; the app
   shows it to them in Settings -> Usage), or CRON_SECRET as the bearer, for
   a script. Anyone else gets a 404, so the endpoint does not advertise that
   it exists.

   Everything here is a count. The lists hold pseudonymous ids, never names,
   and nothing about what anyone wrote, so nothing here can say who. Returning
   people lead, because they are the measure that matters for a practice:
   someone who meets a part once and never comes back has not been helped. */
"use strict";

var crypto = require("crypto");
var verifySession = require("./sync.js").verifySession;
var A = require("./_activity.js");

var WEEKS = 8;               // cohorts shown, as rolling 7-day blocks
var DAYS = WEEKS * 7;        // day lists read, today included

/* "a"..."b" in whole days (b after a is positive). */
function daysBetween(a, b) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

function isDay(v) { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v); }

function pct(n, of) { return of ? Math.round(100 * n / of) : null; }

/* The numbers, from plain data so they can be checked by hand.
   daySets:   { "YYYY-MM-DD": [id, ...] } for the days read (missing = none)
   firstSeen: { id: "YYYY-MM-DD" | "before" }
   today:     "YYYY-MM-DD", UTC

   "This week" is the 7 days ending today, today included; "this month" the
   28. Someone made this week is counted under new, never under returning. */
function summarize(daySets, firstSeen, today) {
  daySets = daySets || {};
  firstSeen = firstSeen || {};
  var memo = {};
  var setOn = function (day) {
    if (memo[day]) return memo[day];
    var s = {};
    (Array.isArray(daySets[day]) ? daySets[day] : []).forEach(function (id) { s[id] = true; });
    return (memo[day] = s);
  };
  // distinct ids active on any day from `from` to `to` days ago (inclusive)
  var activeBetween = function (from, to) {
    var s = {};
    for (var i = from; i <= to; i++) Object.assign(s, setOn(A.addDays(today, -i)));
    return s;
  };
  var ago = function (id) { return isDay(firstSeen[id]) ? daysBetween(firstSeen[id], today) : Infinity; };

  var week = activeBetween(0, 6);
  var month = activeBetween(0, 27);
  var weekIds = Object.keys(week);
  var weekN = weekIds.length, monthN = Object.keys(month).length;
  var ids = Object.keys(firstSeen);

  var returning = weekIds.filter(function (id) { return ago(id) > 6; }).length;
  var fresh = ids.filter(function (id) { var a = ago(id); return a >= 0 && a <= 6; }).length;

  /* Came back within a week of their first day: only accounts whose seven
     days after it have all finished (first seen 8 to 35 days ago), so an
     account that might still come back is never counted as one that did
     not. */
  var eligible = ids.filter(function (id) { var a = ago(id); return a >= 8 && a <= 35; });
  var came = eligible.filter(function (id) {
    for (var d = 1; d <= 7; d++) if (setOn(A.addDays(firstSeen[id], d))[id]) return true;
    return false;
  }).length;

  /* Cohorts: everyone made in one 7-day block, then how many of them opened
     the app in each block after it. Block 0 ends today; oldest first. */
  var cohorts = [];
  for (var k = WEEKS - 1; k >= 0; k--) {
    var lo = 7 * k, hi = 7 * k + 6;     // days ago this block covers
    var members = ids.filter(function (id) { var a = ago(id); return a >= lo && a <= hi; });
    var weeks = [];
    for (var j = k - 1; j >= 0; j--) {
      var later = activeBetween(7 * j, 7 * j + 6);
      weeks.push(members.filter(function (id) { return later[id]; }).length);
    }
    cohorts.push({ start: A.addDays(today, -hi), end: A.addDays(today, -lo), size: members.length, weeks: weeks });
  }

  // the earliest day anyone was marked, within the days read
  var since = null;
  for (var i = DAYS - 1; i >= 0 && !since; i--) {
    var day = A.addDays(today, -i);
    if (Object.keys(setOn(day)).length) since = day;
  }

  return {
    today: today,
    since: since,
    days: DAYS,
    returningThisWeek: returning,
    newThisWeek: fresh,
    cameBackWithin7: { of: eligible.length, came: came, pct: pct(came, eligible.length) },
    active: { today: Object.keys(setOn(today)).length, week: weekN, month: monthN },
    stickiness: monthN ? Math.round(100 * weekN / monthN) / 100 : null,
    accounts: { seen: ids.length, before: ids.filter(function (id) { return firstSeen[id] === A.BEFORE; }).length },
    cohorts: cohorts,
    note: "A day counts when an account opens the app signed in. Accounts made before counting began are " +
      "counted as returning, never as new, and are left out of the cohorts and the came-back share."
  };
}

function same(a, b) {
  var x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function owners() {
  return String(process.env.STATS_USERS || "").split(",").map(function (u) {
    return u.trim().toLowerCase();
  }).filter(Boolean);
}

function allowed(req, secret) {
  var auth = String((req.headers && req.headers.authorization) || "");
  var bearer = auth.indexOf("Bearer ") === 0 ? auth.slice(7) : "";
  if (!bearer) return false;
  var cron = process.env.CRON_SECRET;
  if (cron && same(bearer, cron)) return true;
  var session = verifySession(bearer, secret);
  return !!(session && owners().indexOf(String(session.u).toLowerCase()) >= 0);
}

module.exports = async function handler(req, res) {
  var base = process.env.UPSTASH_REDIS_REST_URL;
  var token = process.env.UPSTASH_REDIS_REST_TOKEN;
  var secret = process.env.SESSION_SECRET;

  if (!base || !token || !secret) {
    res.status(500).json({ error: "Usage counts are not configured on the server yet." });
    return;
  }
  // asked before the method, so nobody else learns even that much
  if (!allowed(req, secret)) { res.status(404).json({ error: "Not found" }); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  var today = A.dayOf();
  var days = [];
  for (var i = DAYS - 1; i >= 0; i--) days.push(A.addDays(today, -i));
  var cmds = days.map(function (d) { return ["SMEMBERS", A.dayKey(d)]; });
  cmds.push(["HGETALL", A.FIRST_KEY]);

  try {
    var r = await fetch(base + "/pipeline", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify(cmds)
    });
    if (!r.ok) { res.status(502).json({ error: "Upstash read failed" }); return; }
    var out = await r.json();
    if (!Array.isArray(out)) { res.status(502).json({ error: "Upstash read failed" }); return; }
    var daySets = {};
    days.forEach(function (d, n) {
      var got = out[n] && out[n].result;
      daySets[d] = Array.isArray(got) ? got : [];
    });
    var flat = out[days.length] && out[days.length].result;
    var firstSeen = {};
    for (var j = 0; Array.isArray(flat) && j + 1 < flat.length; j += 2) firstSeen[flat[j]] = flat[j + 1];
    res.status(200).json(summarize(daySets, firstSeen, today));
  } catch (e) {
    res.status(502).json({ error: "Upstash read failed" });
  }
};

module.exports.summarize = summarize;
