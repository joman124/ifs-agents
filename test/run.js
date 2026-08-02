/* node test/run.js
   No framework, no dependencies. Each *.test.js exports one function that
   takes an assert object and calls it as many times as it likes. */
"use strict";

var SUITES = ["schema", "markdown", "questions", "store", "voice"];

var pass = 0;
var failures = [];

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
  try {
    require("./" + name + ".test.js")(t);
  } catch (e) {
    failures.push(name + " - suite threw: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n      ") : e));
  }
});

console.log("\n" + pass + " passed, " + failures.length + " failed");
failures.forEach(function (f) { console.log("\n  FAIL  " + f); });
console.log("");
process.exit(failures.length ? 1 : 0);
