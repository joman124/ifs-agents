/* Inner Table - counts the days people come back, and nothing else.

   A day is "active" for an account when it opened the app signed in: every
   start, every return to the app (app.js pullNow), "Sync now" and signing in
   pull through GET /api/sync, so that pull is where the day is marked. What
   is kept is deliberately thin:

     innertable:active:<YYYY-MM-DD>   a set of pseudonymous ids, one for each
                                      account that opened the app that UTC
                                      day; each day's set expires after 150
                                      days
     innertable:firstseen             id -> the UTC day the account was made
                                      in the app, or "before" for one that
                                      was already here when counting began

   The id is an HMAC of the username under SESSION_SECRET, so none of these
   keys holds a name, and nothing about what anyone wrote is recorded: not
   parts, not sessions, not how long the app was open. api/stats.js turns the
   lists into totals for whoever runs the deployment. A leading underscore
   keeps this file off Vercel's list of endpoints, like _sessions.js. */
"use strict";

var crypto = require("crypto");

var DAY_TTL = 150 * 24 * 60 * 60;   // seconds each day's list is kept
var FIRST_KEY = "innertable:firstseen";
// an account counting found already here has no day it was made
var BEFORE = "before";

function dayKey(day) { return "innertable:active:" + day; }

function activityId(username, secret) {
  return crypto.createHmac("sha256", secret).update("activity:" + username).digest("hex").slice(0, 16);
}

function dayOf(now) { return (now || new Date()).toISOString().slice(0, 10); }

function addDays(day, n) {
  return new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
}

/* The account opened the app today. HSETNX means the first-seen entry is
   written once and never moved: an account made in the app already has its
   day from signup (markNew), so one that reaches here without an entry was
   made before counting began - and stays "before" rather than turning up as
   a newcomer the first time it comes back.
   Best-effort by design: a failure is swallowed and never reaches the
   caller, so counting can never be what stops someone's parts syncing. */
async function markActive(base, token, secret, username, now) {
  try {
    var id = activityId(username, secret);
    var key = dayKey(dayOf(now));
    await fetch(base + "/pipeline", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify([
        ["SADD", key, id],
        ["EXPIRE", key, String(DAY_TTL)],
        ["HSETNX", FIRST_KEY, id, BEFORE]
      ])
    });
  } catch (e) { /* not counted today; nothing else changes */ }
}

/* The day a new account was made, from api/signup.js. Awaited there before
   sign-up answers, so it always lands before the first pull marks the
   account active. Best-effort like markActive: an account whose day failed
   to save is counted as "before", which undercounts newcomers rather than
   inventing any. */
async function markNew(base, token, secret, username, now) {
  if (!secret) return;
  try {
    await fetch(base, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: JSON.stringify(["HSETNX", FIRST_KEY, activityId(username, secret), dayOf(now)])
    });
  } catch (e) { /* counted as "before" */ }
}

module.exports = {
  markActive: markActive,
  markNew: markNew,
  activityId: activityId,
  dayKey: dayKey,
  dayOf: dayOf,
  addDays: addDays,
  FIRST_KEY: FIRST_KEY,
  BEFORE: BEFORE
};
