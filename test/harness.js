/* Load the app's modules into a fake window, in Node, with no dependencies.
   The modules are browser IIFEs that hang off window.IFS, so a vm context
   with just enough browser in it runs them unchanged - no build step, no
   bundler, nothing to keep in sync with the app.

   The clock is virtual on purpose: voice.js decides when a spoken turn is
   over using multi-second timers, and a test suite that actually waits nine
   seconds for one assertion is a test suite nobody runs. */
"use strict";
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var JS = path.join(__dirname, "..", "app", "js");

function makeClock() {
  var now = 0, seq = 0, timers = {};
  return {
    now: function () { return now; },
    setTimeout: function (fn, ms) {
      var id = ++seq;
      timers[id] = { at: now + (Number(ms) || 0), fn: fn };
      return id;
    },
    clearTimeout: function (id) { delete timers[id]; },
    /* Run every timer due within `ms`, in order, advancing the clock to each
       one as it fires - so a callback that schedules another timer behaves
       the way it would in a browser. */
    tick: function (ms) {
      var until = now + ms;
      for (;;) {
        var nextId = null;
        Object.keys(timers).forEach(function (id) {
          if (timers[id].at > until) return;
          if (nextId === null || timers[id].at < timers[nextId].at) nextId = id;
        });
        if (nextId === null) break;
        var t = timers[nextId];
        delete timers[nextId];
        now = t.at;
        t.fn();
      }
      now = until;
    }
  };
}

function makeStorage() {
  var data = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); },
    removeItem: function (k) { delete data[k]; },
    clear: function () { data = {}; }
  };
}

/* load(["schema", "store"]) -> { IFS, win, clock, storage } */
function load(modules, extra) {
  var clock = makeClock();
  var storage = makeStorage();
  var win = {
    navigator: { language: "en-US" },
    localStorage: storage,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: function () { return 0; },
    clearInterval: function () {},
    console: console,
    atob: global.atob,
    btoa: global.btoa,
    fetch: function () { return Promise.reject(new Error("no network in tests")); }
  };
  Object.keys(extra || {}).forEach(function (k) { win[k] = extra[k]; });
  win.window = win;
  win.self = win;
  var ctx = vm.createContext(win);
  modules.forEach(function (m) {
    var file = path.join(JS, m + ".js");
    vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: m + ".js" });
  });
  return { IFS: win.IFS, win: win, clock: clock, storage: storage };
}

/* A recognizer that does nothing until a test tells it to, standing in for
   the Web Speech API. `last` is whichever one voice.js most recently made. */
function fakeRecognition() {
  function Fake() {
    var self = this;
    this.log = [];
    this.start = function () { self.log.push("start"); Fake.starts++; };
    this.stop = function () { self.log.push("stop"); if (self.onend) self.onend(); };
    this.abort = function () { self.log.push("abort"); if (self.onend) self.onend(); };
    /* drive it from a test */
    this.say = function (text, isFinal) {
      self.onresult({ resultIndex: 0, results: [{ 0: { transcript: text }, isFinal: isFinal !== false }] });
    };
    this.browserEnd = function () { if (self.onend) self.onend(); };
    this.fail = function (err) { if (self.onerror) self.onerror({ error: err }); };
    Fake.last = self;
  }
  Fake.starts = 0;
  Fake.last = null;
  return Fake;
}

/* A speech synthesiser that says nothing and finishes when a test says so.
   voice.js hands the floor over when the reply has been spoken, so a test
   about turn-taking needs to control that moment exactly. */
function fakeSpeech() {
  var api = {
    spoken: [], speaking: false, pending: false, cutOff: 0, last: null,
    speak: function (u) { api.spoken.push(u.text); api.speaking = true; api.last = u; },
    /* cancelling an idle synthesiser is a no-op in a browser, so only a
       cancel that lands on live speech counts as being cut off */
    cancel: function () { if (api.speaking) api.cutOff++; api.speaking = false; },
    /* the utterance reaching its end, the way the browser reports it */
    finish: function () {
      api.speaking = false;
      if (api.last && api.last.onend) api.last.onend();
    }
  };
  api.Utterance = function (text) { this.text = text; this.rate = 1; };
  return api;
}

function readExample(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

module.exports = {
  load: load,
  fakeRecognition: fakeRecognition,
  fakeSpeech: fakeSpeech,
  readExample: readExample
};
