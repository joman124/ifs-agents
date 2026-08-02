/* Turn-taking. The pause after an IFS question is where the answer comes
   from, so the mic closing early is a product bug, not a rough edge. */
"use strict";
var H = require("./harness");

module.exports = function (t) {
  function start(opts) {
    var Fake = H.fakeRecognition();
    var env = H.load(["schema", "voice"], { SpeechRecognition: Fake });
    var seen = { end: null, interim: null, interrupted: false, error: null };
    env.IFS.voice.listen({
      onEnd: function (text) { seen.end = text; },
      onInterim: function (text) { seen.interim = text; },
      onInterrupt: function () { seen.interrupted = true; },
      onError: function (msg) { seen.error = msg; }
    });
    return { Fake: Fake, env: env, seen: seen, voice: env.IFS.voice };
  }

  /* --- the mic waits for someone to start --- */
  var a = start();
  t.eq(a.Fake.starts, 1, "listening starts one recognition run");
  a.Fake.last.browserEnd();          // the browser gives up on the silence
  a.env.clock.tick(400);
  a.Fake.last.browserEnd();
  a.env.clock.tick(400);
  t.eq(a.Fake.starts, 3, "the run is reopened each time the browser ends it");
  t.eq(a.seen.end, null, "a browser-ended run is not the person finishing their turn");
  a.env.clock.tick(120000);
  t.eq(a.seen.end, null, "silence alone never closes the turn, however long");

  /* --- once speech arrives, silence decides --- */
  var b = start();
  b.Fake.last.say("I think it is trying to keep me safe");
  t.eq(b.seen.interim, "I think it is trying to keep me safe", "interim text reaches the caller");
  b.env.clock.tick(3000);
  t.eq(b.seen.end, null, "three seconds of quiet is still a pause, not an ending");
  b.env.clock.tick(1500);
  t.eq(b.seen.end, "I think it is trying to keep me safe", "four seconds of quiet ends the turn");

  /* --- a pause mid-answer keeps the turn open --- */
  var c = start();
  c.Fake.last.say("It started when");
  c.env.clock.tick(3000);
  c.Fake.last.say(" I was about nine");
  c.env.clock.tick(3000);
  t.eq(c.seen.end, null, "each new word pushes the end of the turn back out");
  c.env.clock.tick(1500);
  t.eq(c.seen.end, "It started when I was about nine", "the whole answer arrives as one turn");

  /* --- being interrupted buys five more seconds, and keeps them --- */
  var d = start();
  d.Fake.last.say("hold on, someone's at the door");
  t.eq(d.seen.interrupted, true, "saying you are interrupted is noticed");
  d.env.clock.tick(4500);
  t.eq(d.seen.end, null, "the usual four seconds no longer closes the turn");
  d.env.clock.tick(5000);
  t.eq(d.seen.end, "hold on, someone's at the door", "nine seconds does");

  var again = { end: null };
  d.voice.listen({ onEnd: function (text) { again.end = text; } });
  d.Fake.last.say("sorry - back");
  d.env.clock.tick(4500);
  t.eq(again.end, null, "the longer window carries into the next turn");
  d.env.clock.tick(5000);
  t.eq(again.end, "sorry - back", "and still ends at nine");

  var quiet = start();
  quiet.Fake.last.say("it is mostly quiet in there");
  quiet.env.clock.tick(4500);
  t.eq(quiet.seen.end, "it is mostly quiet in there",
    "an ordinary session keeps the four-second window");

  /* --- stopping by hand keeps what was already said --- */
  var e = start();
  e.Fake.last.say("I was in the middle of");
  e.voice.stopListening();
  t.eq(e.seen.end, "I was in the middle of", "a manual stop delivers the words instead of discarding them");
  e.env.clock.tick(10000);
  t.eq(e.Fake.starts, 1, "and does not reopen the mic afterwards");

  /* --- a refused microphone is reported once and not retried --- */
  var f = start();
  f.Fake.last.fail("not-allowed");
  f.Fake.last.browserEnd();
  f.env.clock.tick(2000);
  t.ok(/[Mm]icrophone access was blocked/.test(f.seen.error || ""), "a blocked mic says so");
  t.eq(f.Fake.starts, 1, "a mic we have been refused is not reopened in a loop");

  /* --- no-speech is the browser being impatient, not an error to show --- */
  var g = start();
  g.Fake.last.fail("no-speech");
  g.Fake.last.browserEnd();
  g.env.clock.tick(500);
  t.eq(g.seen.error, null, "no-speech is not surfaced to the person");
  t.eq(g.Fake.starts, 2, "and the mic reopens");
};
