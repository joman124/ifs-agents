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
var crypto = require("crypto");
var path = require("path");
var vm = require("vm");

var MODULES = ["schema", "markdown", "questions", "reference", "templates"];
var MODES = ["talk", "checkin", "embody", "meeting", "mapping", "intake"];
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
    picked = roster.filter(function (p) { return S.readiness(p).ready && (!seats || seats[p.slug] === "table"); });
    if (picked.length < 2) {
      return { error: "A meeting needs at least two parts at the table. Name them in parts, or seat them on the Table tab in Inner Table. The person's parts are: " + known + "." };
    }
  }
  if (mode === "meeting" && picked.length < 2) {
    return { error: "A meeting needs at least two parts. The person's parts are: " + known + "." };
  }
  if (mode === "meeting" && picked.filter(function (p) { return S.readiness(p).ready; }).length < 2) {
    var ready = roster.filter(function (p) { return S.readiness(p).ready; }).map(function (p) { return p.name; });
    return { error: "A meeting needs at least two parts that can speak for themselves - parts known well enough. " +
      (ready.length ? "Ready now: " + ready.join(", ") + "." : "None is yet; a check-in or two with a part gets it there.") };
  }
  if (mode === "intake" || mode === "talk") picked = [];
  if (mode === "meeting" && asked.length && table && table.built) {
    // parts named for this meeting take a seat at the table for it, whatever
    // the saved seating says - the person asked for them
    table = Object.assign({}, table, { seats: Object.assign({}, table.seats) });
    picked.forEach(function (p) { table.seats[p.slug] = "table"; });
  }

  var journal = (Array.isArray(state.journal) ? state.journal : []).map(S.normalizeJournal).filter(Boolean);
  var text = I.templates.portable(mode, picked, str(args.material), table,
    { roster: roster, journal: journal, bridge: true, save: !!args.canSave });
  var plan = I.templates.groundingBlock(state.plan);
  if (plan) text += "\n\n" + plan;
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
  var merged = S.mergeSession(existing || null, incoming);
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

var FEELING_WORDS = { hostile: 1, wary: 2, neutral: 3, warm: 4, close: 5 };
function ratingOf(v) {
  if (typeof v === "number" && v >= 1 && v <= 5) return Math.round(v);
  return FEELING_WORDS[str(String(v || "")).toLowerCase()] || 0;
}

/* args: { profiles, journal, readings, meeting, notices } - any of them, from
   a session's close (see the session prompts) or a quick notice
   ({ part, note, feel }, the app's "Notice a part"). Returns
   { parts, meetings, journal, said, noticed } or { error }. Pure: the caller writes. */
function prepareSave(state, args) {
  var I = load();
  var S = I.schema, MD = I.md;
  args = args || {};
  var text = typeof args.profiles === "string" ? args.profiles : "";
  var jtext = typeof args.journal === "string" ? args.journal : "";
  var readings = Array.isArray(args.readings) ? args.readings : [];
  var meeting = args.meeting && typeof args.meeting === "object" ? args.meeting : null;
  var notices = Array.isArray(args.notices) ? args.notices.slice(0, 20) : [];
  if (!text.trim() && !jtext.trim() && !readings.length && !meeting && !notices.length) {
    return { error: "nothing to save - pass profiles, a journal note, or a meeting's readings." };
  }
  if (text.length + jtext.length > MAX_TEXT || readings.length > 200) {
    return { error: "That is too long to be a session. Pass only what the session prompt asks for." };
  }

  var bySlug = {};
  partsOf(state).forEach(function (p) {
    var n = S.normalizePart(p);
    if (n) bySlug[n.slug] = Object.assign(n, { image: "", image_at: "" });
  });
  var find = function (who) {
    var w = str(String(who || "")).toLowerCase();
    if (!w) return null;
    return Object.keys(bySlug).map(function (k) { return bySlug[k]; })
      .filter(function (p) { return p.slug.toLowerCase() === w || p.name.toLowerCase() === w; })[0] || null;
  };
  var stamp = nowISO();
  var today = stamp.slice(0, 10);
  var changed = {};
  var said = [], unknown = [];

  var profiled = {};   // slugs a profile update was given for
  // profiles
  if (text.trim()) {
    var res = MD.analyze(text);
    var found = res.profiles.length ? res.profiles : (res.salvage ? [res.salvage] : []);
    if (!found.length) return { error: "No profile could be read from that. Each profile needs YAML frontmatter with at least a name, inside a ```markdown block." };
    if (found.length > MAX_PROFILES) return { error: "At most " + MAX_PROFILES + " profiles can be saved at once." };
    var incoming = [];
    found.forEach(function (raw) {
      var clean = S.normalizePart(raw);
      if (!clean) return;
      // each relationship pointed at the real part it names, before it merges
      S.resolveEdges(clean, Object.keys(bySlug).map(function (k) { return bySlug[k]; }));
      var merged = mergeOne(S, bySlug[clean.slug], clean, stamp);
      bySlug[merged.slug] = merged;
      changed[merged.slug] = 1;
      profiled[merged.slug] = 1;
      incoming.push(clean);
    });
    // ...and written to the other part's profile too, as the app does
    S.mirrorEdges(incoming, function (sl) { return bySlug[sl] || null; }).forEach(function (p) {
      p.updated = stamp;
      bySlug[p.slug] = p;
      changed[p.slug] = 1;
    });
  }

  // quick notices: the same entry the app's "Notice a part" writes
  var noticed = [];
  notices.forEach(function (n) {
    var p = n && typeof n === "object" ? find(n.part) : null;
    if (!p) { unknown.push(String((n && n.part) || "?")); return; }
    if (!S.addNotice(p, str(n.note), str(n.feel).toLowerCase(), today)) return;
    p.updated = stamp;
    changed[p.slug] = 1;
    noticed.push(p.name);
  });
  if (notices.length && !noticed.length) {
    return { error: "That notice did not land: it needs one of the person's parts (call list_parts for the real ones), and a line about the moment or a feel word." };
  }

  // a meeting's round of the table: the same recording the app's round does
  var picked = {};
  readings.forEach(function (r) {
    if (!r || typeof r !== "object") return;
    var from = find(r.from), to = find(r.toward || r.to), rating = ratingOf(r.feeling || r.rating);
    if (!from || !to || !rating || from === to) { unknown.push(String((r && r.from) || "?") + " -> " + String((r && (r.toward || r.to)) || "?")); return; }
    (picked[from.slug] = picked[from.slug] || {})[to.slug] = rating;
  });
  if (readings.length && !Object.keys(picked).length) {
    return { error: "None of those readings named two of the person's parts with one of: hostile, wary, neutral, warm, close." };
  }
  var round = S.applyReadings(function (slug) { return bySlug[slug] || null; }, picked, today);
  round.touched.forEach(function (slug) { bySlug[slug].updated = stamp; changed[slug] = 1; });
  round.changes.forEach(function (c) { said.push(c.from + " toward " + c.to + ": " + S.feelingLabel(c.rating).toLowerCase()); });

  // the meeting card, so the next meeting remembers this one
  var meetings = [];
  if (meeting) {
    var voices = (Array.isArray(meeting.voices) ? meeting.voices : []).filter(function (v) {
      return v && typeof v.name === "string" && typeof v.line === "string";
    }).slice(0, 12).map(function (v) { return { name: v.name.slice(0, 80), line: v.line.slice(0, 300) }; });
    var inRoom = voices.map(function (v) { return find(v.name); }).filter(Boolean).map(function (p) { return p.slug; });
    Object.keys(picked).forEach(function (sl) { if (inRoom.indexOf(sl) < 0) inRoom.push(sl); });
    meetings.push({
      id: "m-ai-" + crypto.randomBytes(5).toString("hex"),
      date: today,
      topic: str(meeting.topic).slice(0, 200),
      parts: inRoom,
      voices: voices,
      synthesis: str(meeting.synthesis).slice(0, 1200),
      readings: round.changes.length,
      via: "ai"
    });
  }

  // the conversation note
  var journal = [];
  if (jtext.trim()) {
    var note = MD.extractJournal(/```journal/.test(jtext) ? jtext : "```journal\n" + jtext + "\n```");
    if (!note) return { error: "The journal note needs a summary: line." };
    journal.push(S.normalizeJournal({
      id: "j-ai-" + crypto.randomBytes(5).toString("hex"), date: today, via: "ai",
      summary: note.summary,
      parts: note.parts.map(function (x) { var p = find(x); return p ? p.slug : null; }).filter(Boolean)
    }));
    // the conversation lands on each part it names, the way it does in the app
    journal.forEach(function (j) {
      (j ? j.parts : []).forEach(function (sl) {
        if (S.addJournalSession(bySlug[sl], j)) { bySlug[sl].updated = stamp; changed[sl] = 1; }
      });
    });
  }

  /* A conversation reaches each part it names through that part's profile
     update - the line in its log is only the index. Any named part saved
     without one is handed back, so the AI writes it before it is done. */
  var unprofiled = [];
  journal.forEach(function (j) {
    (j ? j.parts : []).forEach(function (sl) {
      if (!profiled[sl] && unprofiled.indexOf(bySlug[sl].name) < 0) unprofiled.push(bySlug[sl].name);
    });
  });

  var parts = Object.keys(changed).map(function (k) { return bySlug[k]; });
  return { parts: parts, meetings: meetings, journal: journal.filter(Boolean), unprofiled: unprofiled,
    names: parts.map(function (p) { return p.name; }), said: said, unknown: unknown, noticed: noticed };
}

/* Fold saved parts into a synced state blob, keeping whatever shape (object
   or array) it already had and every field this server does not know. */
function applyToState(state, parts, history) {
  var next = Object.assign({}, state);
  history = history || {};
  if (history.meetings && history.meetings.length) {
    var table = Object.assign({ meetings: [] }, state.table || {});
    var haveM = {};
    (table.meetings || []).forEach(function (m) { haveM[m.id] = 1; });
    table.meetings = (table.meetings || []).concat(history.meetings.filter(function (m) { return !haveM[m.id]; })).slice(-60);
    next.table = table;
  }
  if (history.journal && history.journal.length) {
    var haveJ = {};
    var cur = Array.isArray(state.journal) ? state.journal : [];
    cur.forEach(function (j) { haveJ[j.id] = 1; });
    next.journal = cur.concat(history.journal.filter(function (j) { return !haveJ[j.id]; })).slice(-60);
  }
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
  var parts = [], meetings = [], journal = [];
  (pending || []).forEach(function (entry) {
    if (!entry) return;
    (Array.isArray(entry.parts) ? entry.parts : []).forEach(function (p) { parts.push(p); });
    (Array.isArray(entry.meetings) ? entry.meetings : []).forEach(function (m) { meetings.push(m); });
    (Array.isArray(entry.journal) ? entry.journal : []).forEach(function (j) { journal.push(j); });
  });
  return parts.length || meetings.length || journal.length
    ? applyToState(state, parts, { meetings: meetings, journal: journal }) : state;
}

function feelWords() { return load().schema.FEEL_TOWARD.map(function (f) { return f.key; }); }

module.exports = { feelWords: feelWords, build: build, MODES: MODES, partsOf: partsOf, prepareSave: prepareSave, applyToState: applyToState, overlay: overlay };
