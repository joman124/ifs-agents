#!/usr/bin/env node
/* Admin-only, and READ-ONLY: shows which parts each account currently holds,
   and which parts are sitting in more than one account.

     vercel env pull .env.local        (once - fetches the Upstash creds)
     node scripts/audit-parts.js

   Before the per-account store landed, a device kept everyone's parts under
   one key and sign-in merged whatever was there into the account signing in,
   then pushed the union up. Accounts that were used on a shared browser can
   therefore still be holding someone else's parts. The fix stops it
   happening again; it cannot know which of the parts already up there
   belonged to whom. This tells you what is actually in each account so you
   can judge that yourself.

   It issues SCAN and GET and nothing else - no key is written or deleted by
   this script, so it is safe to run against production. What it prints is
   intimate (part names, session dates): send it nowhere, and delete the
   output when you are done with it.

   Options:
     --json      machine-readable dump instead of the report
     --shared    only the parts that appear in more than one account */
"use strict";

require("./env.js")();

var REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
var REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
var asJson = process.argv.indexOf("--json") >= 0;
var sharedOnly = process.argv.indexOf("--shared") >= 0;

if (!REDIS_URL || !REDIS_TOKEN) {
  console.error("Missing Upstash credentials. From the project root run:");
  console.error("  vercel env pull .env.local");
  process.exit(1);
}

function redis(pathname) {
  return fetch(REDIS_URL + pathname, { headers: { Authorization: "Bearer " + REDIS_TOKEN } })
    .then(function (r) {
      if (!r.ok) throw new Error("Upstash HTTP " + r.status + " on " + pathname);
      return r.json();
    });
}

/* Every account is a innertable:user:<name> record, so the user keys are the
   list of accounts - a state key only exists once someone has synced. */
async function listUsers() {
  var users = [], cursor = "0";
  do {
    var res = await redis("/scan/" + cursor + "/match/innertable:user:*/count/500");
    var out = res.result || [];
    cursor = String(out[0] || "0");
    (out[1] || []).forEach(function (k) { users.push(String(k).replace("innertable:user:", "")); });
  } while (cursor !== "0");
  return users.sort();
}

async function stateFor(user) {
  var res = await redis("/get/innertable:state:" + user);
  if (!res.result) return null;
  try { return JSON.parse(res.result); } catch (e) { return { broken: true }; }
}

/* The most recent session recorded on a part is the best cheap signal of who
   has actually been working with it - a part that arrived by the bleed
   carries the sessions of the account it came from and gains none after. */
function lastSession(part) {
  var ss = (part && part.sessions) || [];
  var last = "";
  ss.forEach(function (s) { if (s && s.date && s.date > last) last = s.date; });
  return last;
}

function describe(part, slug) {
  return {
    slug: slug,
    name: (part && part.name) || slug,
    type: (part && part.type) || "unknown",
    sessions: ((part && part.sessions) || []).length,
    lastSession: lastSession(part) || null
  };
}

(async function main() {
  var users = await listUsers();
  if (!users.length) { console.log("No accounts found."); return; }

  var accounts = [];
  var bySlug = {};                       // slug -> [username, ...]

  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    var st = await stateFor(u);
    if (!st) { accounts.push({ user: u, synced: false, parts: [] }); continue; }
    if (st.broken) { accounts.push({ user: u, synced: true, unreadable: true, parts: [] }); continue; }
    var parts = Object.keys(st.parts || {}).sort().map(function (slug) {
      (bySlug[slug] = bySlug[slug] || []).push(u);
      return describe(st.parts[slug], slug);
    });
    accounts.push({
      user: u, synced: true, parts: parts,
      transcripts: (st.transcripts || []).length,
      meetings: ((st.table || {}).meetings || []).length
    });
  }

  var shared = Object.keys(bySlug).filter(function (s) { return bySlug[s].length > 1; }).sort();

  if (asJson) {
    console.log(JSON.stringify({ accounts: accounts, sharedSlugs: shared.map(function (s) {
      return { slug: s, accounts: bySlug[s] };
    }) }, null, 2));
    return;
  }

  if (!sharedOnly) {
    console.log("\n=== Accounts ===\n");
    accounts.forEach(function (a) {
      if (!a.synced) { console.log(a.user + "  (never synced - nothing on the server)"); return; }
      if (a.unreadable) { console.log(a.user + "  (state present but unreadable)"); return; }
      console.log(a.user + "  " + a.parts.length + " part(s), " +
        a.transcripts + " transcript(s), " + a.meetings + " meeting(s)");
      a.parts.forEach(function (p) {
        var mark = bySlug[p.slug].length > 1 ? "  <-- also in: " +
          bySlug[p.slug].filter(function (x) { return x !== a.user; }).join(", ") : "";
        console.log("    " + p.slug + "  (" + p.type + ", " + p.sessions + " session(s)" +
          (p.lastSession ? ", last " + p.lastSession : "") + ")" + mark);
      });
      console.log("");
    });
  }

  console.log("=== Parts held by more than one account ===\n");
  if (!shared.length) {
    console.log("None. No part is in two libraries.\n");
    return;
  }
  console.log("Each of these is either a genuine duplicate name or one person's part\n" +
    "sitting in another person's library. The session counts say which:\n" +
    "the copy that has been worked with is the one that belongs there.\n");
  shared.forEach(function (slug) {
    console.log(slug);
    bySlug[slug].forEach(function (u) {
      var a = accounts.filter(function (x) { return x.user === u; })[0];
      var p = a.parts.filter(function (x) { return x.slug === slug; })[0];
      console.log("    " + u + "  (" + p.sessions + " session(s)" +
        (p.lastSession ? ", last " + p.lastSession : ", never worked with") + ")");
    });
    console.log("");
  });
  console.log("This script changes nothing. To remove a part from an account, the\n" +
    "person can delete it in the app, which syncs the removal up.\n");
})().catch(function (e) {
  console.error("Audit failed: " + e.message);
  process.exit(1);
});
