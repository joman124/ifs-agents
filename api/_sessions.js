/* Inner Table - the app's session prompts, built on the server.
   The bridge (api/bridge.js) lets a person's own AI run a guided session -
   check-in, meeting, embodied reaction - from their parts. That has to be the
   app's own protocol, word for word, not a server-side copy that drifts: so
   this loads the browser modules that build the prompts (they are plain
   IIFEs off window.IFS) into a small sandbox, the same way the tests do.
   The leading underscore keeps Vercel from deploying this file as an
   endpoint of its own; vercel.json ships app/js alongside the bridge. */
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var MODULES = ["schema", "markdown", "questions", "reference", "templates"];
var MODES = ["intake", "checkin", "mapping", "embody", "meeting"];
var IFS = null;

function load() {
  if (IFS) return IFS;
  var win = { navigator: { language: "en-US" }, console: console };
  win.window = win;
  win.self = win;
  var ctx = vm.createContext(win);
  MODULES.forEach(function (m) {
    var file = path.join(__dirname, "..", "app", "js", m + ".js");
    vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: m + ".js" });
  });
  IFS = win.IFS;
  return IFS;
}

function str(v) { return typeof v === "string" ? v.trim() : ""; }

/* The app syncs parts as an object keyed by slug (store.exportAll); older
   blobs and hand-made fixtures hold an array. Either reads the same. */
function partsOf(state) {
  var p = state && state.parts;
  if (Array.isArray(p)) return p;
  if (p && typeof p === "object") return Object.keys(p).map(function (k) { return p[k]; });
  return [];
}

/* Build one session's prompt from synced state.
   args: { mode, parts: [slug...], material }
   Returns { text } or { error } - an error is said in words the AI can relay,
   naming the real slugs, because a wrong guess is the usual way this fails. */
function build(state, args) {
  var I = load();
  var S = I.schema;
  args = args || {};
  var mode = str(args.mode).toLowerCase();
  if (MODES.indexOf(mode) < 0) {
    return { error: "mode must be one of: " + MODES.join(", ") + "." };
  }
  var roster = partsOf(state).map(S.normalizePart).filter(Boolean);
  var table = state.table || null;
  var known = roster.map(function (p) { return p.slug + " (" + p.name + ")"; }).join(", ") || "none yet";

  var asked = Array.isArray(args.parts) ? args.parts : (args.parts ? [args.parts] : []);
  var picked = [];
  for (var i = 0; i < asked.length; i++) {
    var want = str(asked[i]).toLowerCase();
    var hit = roster.filter(function (p) { return p.slug.toLowerCase() === want || p.name.toLowerCase() === want; })[0];
    if (!hit) return { error: "No part called \"" + asked[i] + "\". The person's parts are: " + known + "." };
    if (picked.indexOf(hit) < 0) picked.push(hit);
  }

  if ((mode === "checkin" || mode === "embody") && picked.length !== 1) {
    return { error: mode + " needs exactly one part. The person's parts are: " + known + "." };
  }
  if (mode === "mapping" && picked.length < 2) {
    return { error: "mapping needs two parts. The person's parts are: " + known + "." };
  }
  if (mode === "meeting" && !picked.length) {
    // nobody named: the meeting sits whoever the person seated at their table
    var seats = (table && table.built && table.seats) || null;
    picked = seats
      ? roster.filter(function (p) { return seats[p.slug] === "table"; })
      : roster.filter(function (p) { return S.readiness(p).ready; });
    if (picked.length < 2) {
      return { error: "A meeting needs at least two parts at the table. Name them in parts, or seat them on the Table tab in Inner Table. The person's parts are: " + known + "." };
    }
  }
  if (mode === "meeting" && picked.length < 2) {
    return { error: "A meeting needs at least two parts. The person's parts are: " + known + "." };
  }
  if (mode === "intake") picked = [];
  if (mode === "meeting" && asked.length && table && table.built) {
    // parts named for this meeting take a seat at the table for it, whatever
    // the saved seating says - the person asked for them
    table = Object.assign({}, table, { seats: Object.assign({}, table.seats) });
    picked.forEach(function (p) { table.seats[p.slug] = "table"; });
  }

  var text = I.templates.portable(mode, picked, str(args.material), table,
    { roster: roster, bridge: true, save: !!args.canSave });
  return { text: text };
}

/* ---------- saving what a session learned ----------
   The same merge the app applies when a session closes or a profile is
   pasted in (schema.mergeParts, plus the store's append-only session log):
   fields the model left out are kept, lists are unioned, coverage never
   goes backwards, declined stays declined. Nothing is ever deleted. */

var MAX_TEXT = 200000;
var MAX_PROFILES = 6;

function nowISO() { return new Date().toISOString(); }

function mergeOne(S, existing, incoming, stamp) {
  var merged = S.mergeParts(existing || null, incoming);
  if (existing) {
    var seen = {}, log = [];
    (existing.sessions || []).concat(merged.sessions || []).forEach(function (x) {
      var k = x.date + "|" + x.mode + "|" + (x.note || "");
      if (!seen[k]) { seen[k] = 1; log.push(x); }
    });
    merged.sessions = log;
  }
  // a save is an edit: it must read as newer than the copy on any device,
  // and than a deletion made before it
  merged.updated = stamp;
  delete merged.image;      // pictures travel on their own endpoint; never through here
  delete merged.image_at;
  return merged;
}

/* text: one or more ```markdown profile blocks, as the session prompt asks
   for. Returns { parts: [merged part...], names } or { error }. Pure: the
   caller writes the result. */
function prepareSave(state, text) {
  var I = load();
  var S = I.schema, MD = I.md;
  text = typeof text === "string" ? text : "";
  if (!text.trim()) return { error: "profiles was empty - pass the complete updated profile(s), each in its own ```markdown block." };
  if (text.length > MAX_TEXT) return { error: "That is too long to be a profile. Pass only the profile block(s)." };

  var res = MD.analyze(text);
  var found = res.profiles.length ? res.profiles : (res.salvage ? [res.salvage] : []);
  if (!found.length) return { error: "No profile could be read from that. Each profile needs YAML frontmatter with at least a name, inside a ```markdown block." };
  if (found.length > MAX_PROFILES) return { error: "At most " + MAX_PROFILES + " profiles can be saved at once." };

  var bySlug = {};
  partsOf(state).forEach(function (p) {
    var n = S.normalizePart(p);
    if (n) bySlug[n.slug] = Object.assign(n, { image: "", image_at: "" });
  });
  var stamp = nowISO();
  var out = [];
  found.forEach(function (raw) {
    var clean = S.normalizePart(raw);
    if (!clean) return;
    out.push(mergeOne(S, bySlug[clean.slug], clean, stamp));
  });
  if (!out.length) return { error: "No profile with a name could be read from that." };
  return { parts: out, names: out.map(function (p) { return p.name; }) };
}

/* Fold saved parts into a synced state blob, keeping whatever shape (object
   or array) it already had and every field this server does not know. */
function applyToState(state, parts) {
  var next = Object.assign({}, state);
  var asArray = Array.isArray(state.parts);
  var map = {};
  partsOf(state).forEach(function (p) { if (p && p.slug) map[p.slug] = p; });
  parts.forEach(function (p) {
    var prev = map[p.slug] || {};
    // the stored copy may carry a picture; a save never removes it
    var keep = prev.image ? { image: prev.image, image_at: prev.image_at } : {};
    map[p.slug] = Object.assign({}, p, keep);
  });
  next.parts = asArray ? Object.keys(map).map(function (k) { return map[k]; }) : map;
  if (next.deleted && next.deleted.parts) {
    next.deleted = Object.assign({}, next.deleted, { parts: Object.assign({}, next.deleted.parts) });
    parts.forEach(function (p) { delete next.deleted.parts[p.slug]; });
  }
  return next;
}

/* What the bridge reads: the synced blob with any saves the app has not
   picked up yet folded in, so a second session right after a first one
   already knows what the first one learned. */
function overlay(state, pending) {
  var parts = [];
  (pending || []).forEach(function (entry) {
    (entry && Array.isArray(entry.parts) ? entry.parts : []).forEach(function (p) { parts.push(p); });
  });
  return parts.length ? applyToState(state, parts) : state;
}

module.exports = { build: build, MODES: MODES, partsOf: partsOf, prepareSave: prepareSave, applyToState: applyToState, overlay: overlay };
