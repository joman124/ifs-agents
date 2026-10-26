/* node test/run.js
   No framework, no dependencies. Each *.test.js exports one function that
   takes an assert object and calls it as many times as it likes. Suites run
   one after another: several of them replace global.fetch. */
"use strict";

var SUITES = ["schema", "markdown", "files", "questions", "reference", "store", "voice", "auth", "sync", "isolation", "deletion", "reminders", "templates", "portrait", "bridge", "aikey", "freeai", "llm", "practice", "ground", "talk", "integrate", "stats"];

var pass = 0;
var failures = [];
var running = null;

/* A suite left waiting on something that never comes - a timer on the
   harness's virtual clock nobody ticks, a promise nothing settles - empties
   the event loop, and Node exits quietly with 0 before the summary: a pass
   in CI. Say which suite never finished, and fail. */
process.on("exit", function () {
  if (running === null) return;
  failures.push(running + " - the suite never finished (it waited on something that never came)");
  console.log("\n" + pass + " passed, " + failures.length + " failed");
  failures.forEach(function (f) { console.log("\n  FAIL  " + f); });
  console.log("");
  process.exitCode = 1;
});

async function runSuite(name) {
  running = name;
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
    await require("./" + name + ".test.js")(t);
  } catch (e) {
    failures.push(name + " - suite threw: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n      ") : e));
  }
}

SUITES.reduce(function (p, name) { return p.then(function () { return runSuite(name); }); }, Promise.resolve())
  .then(function () {
    running = null;
    console.log("\n" + pass + " passed, " + failures.length + " failed");
    failures.forEach(function (f) { console.log("\n  FAIL  " + f); });
    console.log("");
    process.exit(failures.length ? 1 : 0);
  });
