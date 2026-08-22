/* node test/run.js
   No framework, no dependencies. Each *.test.js exports one function that
   takes an assert object and calls it as many times as it likes. */
"use strict";

var SUITES = ["schema", "markdown", "files", "questions", "reference", "store", "voice", "auth", "sync"];

var pass = 0;
var failures = [];
var pending = [];

SUITES.forEach(function (name) {
  var t = {
    ok: function (cond, msg) {
      if (cond) pass++;
      else failures.push(name + " - " + msg);
    },
    eq: function (got, want, msg) {
      var g = JSON.stringify(got), w = JSON.stringify(want);
      if (g === w) pass++;
      else failures.push(name + " - " + msg + "\n      got:  " + g + "\n      want: " + w);
    },
    throws: function (fn, msg) {
      try { fn(); failures.push(name + " - " + msg + " (did not throw)"); }
      catch (e) { pass++; }
    }
  };
  function blame(e) {
    failures.push(name + " - suite threw: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n      ") : e));
  }
  try {
    // a suite may be async (the auth gate is); collect it and await below
    var result = require("./" + name + ".test.js")(t);
    if (result && typeof result.then === "function") pending.push(result.catch(blame));
  } catch (e) {
    blame(e);
  }
});

Promise.all(pending).then(function () {
  console.log("\n" + pass + " passed, " + failures.length + " failed");
  failures.forEach(function (f) { console.log("\n  FAIL  " + f); });
  console.log("");
  process.exit(failures.length ? 1 : 0);
});
