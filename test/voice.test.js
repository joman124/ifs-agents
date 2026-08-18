/* Turn-taking. Two things ruin a spoken session, and both are pinned here:
   the mic closing early - the pause after an IFS question is where the answer
   comes from - and the app hearing its own reply through the speaker, calling
   it an interruption, and cutting itself off mid-sentence. */
"use strict";
var H = require("./harness");

module.exports = function (t) {
  var REPLY = "Thank you for telling me that. What does it fear would happen if it stopped?";

  /* A page with a microphone, a voice, and settings that can be leaned on. */
  function setup(over) {
    var Fake = H.fakeRecognition();
    var Speech = H.fakeSpeech();
    var env = H.load(["schema", "store", "gemini-voice", "voice"], {
      SpeechRecognition: Fake,
      speechSynthesis: Speech,
      SpeechSynthesisUtterance: Speech.Utterance
    });
    env.IFS.store.load();
    Object.assign(env.IFS.store.state.settings, over || {});
    env.Fake = Fake;
    env.Speech = Speech;
    env.voice = env.IFS.voice;
    return env;
  }

  /* One turn, with everything the caller is told about it collected. */
  function turn(env, opts) {
    var seen = { end: null, interim: null, interrupted: false, error: null, barged: false, states: [] };
    var cbs = {
      onEnd: function (text) { seen.end = text; },
      onInterim: function (text) { seen.interim = text; },
      onInterrupt: function () { seen.interrupted = true; },
      onError: function (msg) { seen.error = msg; },
      onBargeIn: function () { seen.barged = true; },
      onState: function (s) { seen.states.push(s); }
    };
    Object.keys(opts || {}).forEach(function (k) { cbs[k] = opts[k]; });
    seen.cbs = cbs;
    return seen;
  }

  /* ================= the mic waits for someone to start ================= */

  var a = setup();
  var aSeen = turn(a);
  a.voice.listen(aSeen.cbs);
  t.eq(a.Fake.starts, 1, "listening starts one recognition run");
  a.Fake.last.browserEnd();          // the browser gives up on the silence
  a.clock.tick(400);
  a.Fake.last.browserEnd();
  a.clock.tick(400);
  t.eq(a.Fake.starts, 3, "the run is reopened each time the browser ends it");
  t.eq(aSeen.end, null, "a browser-ended run is not the person finishing their turn");
  a.clock.tick(120000);
  t.eq(aSeen.end, null, "silence alone never closes the turn, however long");

  /* --- once speech arrives, silence decides --- */
  var b = setup();
  var bSeen = turn(b);
  b.voice.listen(bSeen.cbs);
  b.Fake.last.say("I think it is trying to keep me safe");
  t.eq(bSeen.interim, "I think it is trying to keep me safe", "interim text reaches the caller");
  b.clock.tick(3000);
  t.eq(bSeen.end, null, "three seconds of quiet is still a pause, not an ending");
  b.clock.tick(1500);
  t.eq(bSeen.end, "I think it is trying to keep me safe", "four seconds of quiet ends the turn");

  /* --- a pause mid-answer keeps the turn open --- */
  var c = setup();
  var cSeen = turn(c);
  c.voice.listen(cSeen.cbs);
  c.Fake.last.say("It started when");
  c.clock.tick(3000);
  c.Fake.last.say(" I was about nine");
  c.clock.tick(3000);
  t.eq(cSeen.end, null, "each new word pushes the end of the turn back out");
  c.clock.tick(1500);
  t.eq(cSeen.end, "It started when I was about nine", "the whole answer arrives as one turn");

  /* --- being interrupted buys five more seconds, and keeps them --- */
  var d = setup();
  var dSeen = turn(d);
  d.voice.listen(dSeen.cbs);
  d.Fake.last.say("hold on, someone's at the door");
  t.eq(dSeen.interrupted, true, "saying you are interrupted is noticed");
  d.clock.tick(4500);
  t.eq(dSeen.end, null, "the usual four seconds no longer closes the turn");
  d.clock.tick(5000);
  t.eq(dSeen.end, "hold on, someone's at the door", "nine seconds does");

  var again = turn(d);
  d.voice.listen(again.cbs);
  d.Fake.last.say("sorry - back");
  d.clock.tick(4500);
  t.eq(again.end, null, "the longer window carries into the next turn");
  d.clock.tick(5000);
  t.eq(again.end, "sorry - back", "and still ends at nine");

  var quiet = setup();
  var qSeen = turn(quiet);
  quiet.voice.listen(qSeen.cbs);
  quiet.Fake.last.say("it is mostly quiet in there");
  quiet.clock.tick(4500);
  t.eq(qSeen.end, "it is mostly quiet in there",
    "an ordinary session keeps the four-second window");

  /* --- stopping by hand keeps what was already said --- */
  var e = setup();
  var eSeen = turn(e);
  e.voice.listen(eSeen.cbs);
  e.Fake.last.say("I was in the middle of");
  e.voice.stopListening();
  t.eq(eSeen.end, "I was in the middle of", "a manual stop delivers the words instead of discarding them");
  e.clock.tick(10000);
  t.eq(e.Fake.starts, 1, "and does not reopen the mic afterwards");

  /* --- a refused microphone is reported once and not retried --- */
  var f = setup();
  var fSeen = turn(f);
  f.voice.listen(fSeen.cbs);
  f.Fake.last.fail("not-allowed");
  f.Fake.last.browserEnd();
  f.clock.tick(2000);
  t.ok(/[Mm]icrophone access was blocked/.test(fSeen.error || ""), "a blocked mic says so");
  t.eq(f.Fake.starts, 1, "a mic we have been refused is not reopened in a loop");

  /* --- no-speech is the browser being impatient, not an error to show --- */
  var g = setup();
  var gSeen = turn(g);
  g.voice.listen(gSeen.cbs);
  g.Fake.last.fail("no-speech");
  g.Fake.last.browserEnd();
  g.clock.tick(500);
  t.eq(gSeen.error, null, "no-speech is not surfaced to the person");
  t.eq(g.Fake.starts, 2, "and the mic reopens");

  /* ================= one at a time (the default) =================
     The bug this exists to make impossible: the reply comes out of the
     speaker, the mic hears it, the app decides the person has started
     talking, and cuts itself off. */

  var one = setup();
  var oneSeen = turn(one);
  one.voice.exchange(REPLY, oneSeen.cbs);
  t.eq(one.Speech.spoken.length, 1, "the reply is spoken");
  t.eq(one.Fake.starts, 0, "the microphone is not open at all while the reply is being spoken");
  one.Speech.finish();
  t.eq(one.Fake.starts, 0, "nor the instant it ends - the last words are still in the room");
  one.clock.tick(800);
  t.eq(one.Fake.starts, 1, "once they have faded, the floor is handed over");
  t.eq(oneSeen.states.join(" > "), "speaking > listening", "and the dot says whose turn it is");
  one.Fake.last.say("it fears everyone would see straight through me");
  one.clock.tick(4500);
  t.eq(oneSeen.end, "it fears everyone would see straight through me",
    "the answer is theirs, whole, and nothing of ours is in it");

  /* A dictation that overlaps the reply anyway - a mic tap mid-sentence, a
     run that was slow to close - still hears only itself, and must not act
     on it. */
  var over = setup();
  var overSeen = turn(over);
  over.voice.speak(REPLY, null);
  over.voice.listen(overSeen.cbs);
  over.Fake.last.say("what does it fear would happen if it stopped", true);
  over.clock.tick(30000);
  t.eq(overSeen.end, null, "our own voice never closes the person's turn");
  t.eq(overSeen.interim, null, "and is never shown back to them as something they said");
  over.Speech.finish();
  over.clock.tick(800);
  over.Fake.last.say("it fears being laughed at", true);
  over.clock.tick(4500);
  t.eq(overSeen.end, "it fears being laughed at",
    "the turn holds only what the person said, not the reply that preceded it");

  /* The tail: a recogniser hands back the last syllable a beat after the
     audio element has said "ended". */
  var tail = setup();
  var tailSeen = turn(tail);
  tail.voice.speak(REPLY, null);
  tail.voice.listen(tailSeen.cbs);
  tail.Speech.finish();
  tail.Fake.last.say("if it stopped", true);
  tail.clock.tick(30000);
  t.eq(tailSeen.end, null, "an echo arriving just after we stop talking is still an echo");

  /* Closing the session in the handover gap must not pop the mic open. */
  var closed = setup();
  closed.voice.exchange(REPLY, turn(closed).cbs);
  closed.Speech.finish();
  closed.voice.stopSpeaking();
  closed.voice.stopListening();
  closed.clock.tick(5000);
  t.eq(closed.Fake.starts, 0, "a session closed mid-handover never opens the mic afterwards");

  /* Tapping the dot takes the floor immediately, at any point in the reply. */
  var tap = setup();
  var tapSeen = turn(tap);
  tap.voice.exchange(REPLY, tapSeen.cbs);
  t.eq(tap.Fake.starts, 0, "before the tap, nothing is listening");
  tap.voice.takeFloor();
  t.ok(tap.Speech.cutOff > 0, "tapping stops the reply mid-sentence");
  t.eq(tap.Fake.starts, 1, "and opens the mic there and then");
  tap.Fake.last.say("can I say something");
  tap.clock.tick(4500);
  t.eq(tapSeen.end, "can I say something", "what they cut in with is their turn");
  tap.Speech.finish();
  tap.clock.tick(5000);
  t.eq(tap.Fake.starts, 1, "and the abandoned reply never re-opens the mic behind them");

  /* ================= cutting in (opt-in) ================= */

  var cut = setup({ turnTaking: "open" });
  var cutSeen = turn(cut);
  cut.voice.exchange(REPLY, cutSeen.cbs);
  t.eq(cut.Fake.starts, 1, "with cutting in allowed the mic is open through the reply");
  cut.Fake.last.say("What does it fear would happen", true);
  cut.clock.tick(30000);
  t.eq(cutSeen.end, null, "our own voice off the speaker still never closes the turn");
  t.eq(cutSeen.barged, false, "and is not reported as an interruption");

  var real = setup({ turnTaking: "open" });
  var realSeen = turn(real);
  real.voice.exchange(REPLY, realSeen.cbs);
  real.Fake.last.say("actually can we stay with the shame a moment", true);
  t.eq(realSeen.barged, true, "real speech during the reply is a barge-in");
  t.ok(real.Speech.cutOff > 0, "which stops us talking over them");
  real.clock.tick(6000);
  t.eq(realSeen.end, "actually can we stay with the shame a moment",
    "and what they said starts their turn rather than being thrown away");

  var stray = setup({ turnTaking: "open" });
  var straySeen = turn(stray);
  stray.voice.exchange(REPLY, straySeen.cbs);
  stray.Fake.last.say("mm", true);
  t.eq(straySeen.barged, false, "one half-heard word is a mishearing, not someone taking the floor");
  t.eq(stray.Speech.cutOff, 0, "so the reply keeps going");

  var stop = setup({ turnTaking: "open" });
  var stopSeen = turn(stop);
  stop.voice.exchange(REPLY, stopSeen.cbs);
  stop.Fake.last.say("stop", true);
  t.eq(stopSeen.barged, true, "'stop' is one word and has to land the first time");

  /* ================= telling our words from theirs ================= */

  var V = setup().voice;
  t.ok(V.isEcho("what does it fear would happen", REPLY),
    "the reply coming back off the speaker is recognised as echo");
  t.ok(V.isEcho("Thank you for telling me that.", REPLY), "punctuation and case do not matter");
  t.ok(V.isEcho("thank you for telling that what does it fear happen", REPLY),
    "an echo with words dropped by the recogniser is still an echo");
  t.ok(!V.isEcho("it thinks everyone would see straight through me", REPLY),
    "an actual answer is not echo");
  t.ok(!V.isEcho("it fears it would happen again", REPLY),
    "an answer that reuses the question's words is not echo - the order is different");
  t.ok(!V.isEcho("stopped", REPLY),
    "a single word inside the reply is too little to call either way");
  t.ok(!V.isEcho("what", REPLY), "nor is one word that happens to appear in it");
  t.ok(V.bargeWorthy("hold on a second"), "a sentence is enough to interrupt");
  t.ok(V.bargeWorthy("wait"), "so is a word people actually interrupt with");
  t.ok(!V.bargeWorthy("uh"), "a filler is not");

  /* ================= which engine ends up in use ================= */

  t.eq(setup().voice.engines().speak, "browser", "with nothing configured the browser speaks");
  t.eq(setup({ geminiKey: "k" }).voice.engines().speak, "gemini",
    "the free Gemini key already set up for sessions is enough for a voice");
  t.eq(setup({ geminiKey: "k", elevenKey: "k", elevenVoiceId: "v" }).voice.engines().speak, "eleven",
    "a voice someone deliberately cloned wins over the default");
  t.eq(setup({ geminiKey: "k", voiceEngine: "browser" }).voice.engines().speak, "browser",
    "an explicit choice is honoured");
  t.eq(setup({ elevenKey: "k", elevenVoiceId: "v", voiceEngine: "gemini" }).voice.engines().speak, "eleven",
    "a choice with no key behind it falls back rather than going silent");

  /* The microphone: echo cancellation is what makes cutting in safe, so
     asking to cut in picks the mic that has it. */
  function withRecorder(over) {
    var Fake = H.fakeRecognition();
    var env = H.load(["schema", "store", "gemini-voice", "voice"], {
      SpeechRecognition: Fake,
      navigator: { language: "en-US", mediaDevices: { getUserMedia: function () {} } },
      AudioContext: function () {},
      Blob: function () {}
    });
    env.IFS.store.load();
    Object.assign(env.IFS.store.state.settings, over || {});
    return env.IFS.voice.engines();
  }
  t.eq(withRecorder({ geminiKey: "k" }).listen, "web",
    "taking turns, the browser's own dictation is instant and free");
  t.eq(withRecorder({ geminiKey: "k", turnTaking: "open" }).listen, "gemini",
    "asking to cut in switches to the mic that cancels the echo");
  t.eq(withRecorder({}).listen, "web", "with no Gemini key there is nothing to switch to");
  t.eq(withRecorder({ geminiKey: "k", micEngine: "gemini" }).listen, "gemini",
    "or it can just be chosen");

  /* No dictation in this browser at all (Safari, Firefox): the Gemini mic is
     the difference between voice mode and no voice mode. */
  var safari = H.load(["schema", "store", "gemini-voice", "voice"], {
    navigator: { language: "en-US", mediaDevices: { getUserMedia: function () {} } },
    AudioContext: function () {},
    Blob: function () {}
  });
  safari.IFS.store.load();
  t.eq(safari.IFS.voice.canListen(), false, "a browser with no dictation and no key cannot listen");
  safari.IFS.store.state.settings.geminiKey = "k";
  t.eq(safari.IFS.voice.canListen(), true, "with a Gemini key, it can");
};
