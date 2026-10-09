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
  var roster = (state.parts || []).map(S.normalizePart).filter(Boolean);
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

  var text = I.templates.portable(mode, picked, str(args.material), table, { roster: roster, bridge: true });
  return { text: text };
}

module.exports = { build: build, MODES: MODES };
