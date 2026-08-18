/* Inner Table - voice mode: whose turn it is, and who is speaking.

   Turn-taking is the whole job here. Two people cannot talk at once, and a
   session where the app hears its own reply, decides the person is talking,
   and cuts itself off mid-sentence is worse than no voice mode at all - that
   is what this file is arranged to prevent:

     1. One at a time (the default). While the reply is being spoken the
        microphone is not open. Nothing the speaker emits can be mistaken for
        the person, because nothing is listening. The floor is handed over
        when the words have finished - plus a short tail, because a room and a
        speech recogniser both hold the last syllable for a moment after the
        audio element says "ended".
     2. Cutting in (opt-in). The mic stays open through the reply, and it
        takes real speech to interrupt: anything that reads as our own words
        coming back is discarded, and a lone half-heard word is not a turn.
        Safest with headphones, or with the Gemini microphone, which asks the
        browser to cancel the echo in the audio itself.
     3. Either way the person can simply take the floor - tapping the orb
        stops the reply and opens the mic.

   Engines, all optional, all falling back to something rather than to
   silence:
     speaking   Gemini TTS (free tier, same key as chat) | ElevenLabs (a
                personal or cloned voice) | the browser's own voice
     listening  the browser's dictation (Web Speech) | the Gemini microphone,
                which records with echo cancellation and transcribes - and is
                the only voice input at all in Safari and Firefox

   Where the audio goes depends on the engine and is never nowhere: browser
   dictation goes to the browser vendor, the Gemini mic sends a recording to
   Google, ElevenLabs receives the reply text. The settings screen says so. */
(function () {
  "use strict";

  var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;

  /* Turn-taking constants.
     The Web Speech API ends a run by itself after a few seconds of quiet, and
     with continuous:false that closed the mic on someone who was still
     gathering their answer - which is most of a session, since the pause after
     an IFS question is where the answer comes from. So: the run restarts until
     speech actually arrives, and once it has, the turn ends only after the
     person has been quiet for SILENCE_MS. Saying you are being interrupted
     buys INTERRUPT_MS more, and keeps it for the rest of the page session - a
     room with someone else in it stays that way. */
  var SILENCE_MS = 4000;
  var INTERRUPT_MS = 5000;
  var TAIL_MS = 700;          // our last words are still in the room after "ended"
  var MAX_RESTARTS = 40;      // ~5 minutes of holding the mic open for silence
  var BARGE_WORDS = 3;        // fewer than this is a mishearing, not an interruption
  var INTERRUPTED = /\b(?:interrupt(?:ed|ing|ion)?|hold on|hang on|one (?:sec|second|minute|moment)|give me a (?:sec|second|minute|moment)|be right back|back in a (?:sec|second|minute)|someone(?:'s| is)? (?:here|calling|talking|at the door)|somebody(?:'s| is)? (?:here|calling)|(?:the|my) (?:door|phone|dog|baby|kid|kids))\b/i;
  /* Nobody says three words before cutting someone off. These are what people
     actually say, and they have to land the first time. */
  var URGENT = /^\s*(?:stop|wait|no|nope|pause|hold on|hang on|hey|sorry|actually)\b/i;
  var extraGrace = 0;

  function GV() { return window.IFS.geminiVoice || null; }

  function settings() {
    try { return window.IFS.store.state.settings || {}; } catch (e) { return {}; }
  }

  /* ---------------- which engine ---------------- */

  function canSynth() { return "speechSynthesis" in window; }

  function elevenConfig() {
    var s = settings();
    return s.elevenKey && s.elevenVoiceId ? s : null;
  }
  function geminiReady() {
    var s = settings();
    return !!(s.geminiKey && GV());
  }
  function gemMicReady() {
    return !!(geminiReady() && GV().canRecord());
  }

  /* auto: a voice someone deliberately set up wins - an ElevenLabs clone is
     not something you configure by accident - then Gemini's, then whatever
     the browser has. */
  function voiceEngine() {
    var want = settings().voiceEngine || "auto";
    if (want === "eleven" && elevenConfig()) return "eleven";
    if (want === "gemini" && geminiReady()) return "gemini";
    if (want === "browser" && canSynth()) return "browser";
    if (elevenConfig()) return "eleven";
    if (geminiReady()) return "gemini";
    if (canSynth()) return "browser";
    return "none";
  }

  /* auto: the browser's own dictation, which is instant, free and shows the
     words as they arrive - except when the person has asked to be able to cut
     in, where the Gemini mic's echo cancellation is what makes cutting in
     safe next to a loudspeaker. Browsers with no dictation at all (Safari,
     Firefox) get the Gemini mic whenever there is a key for it. */
  function micEngine() {
    var want = settings().micEngine || "auto";
    var gem = gemMicReady(), web = !!Rec;
    if (want === "gemini" && gem) return "gemini";
    if (want === "browser" && web) return "web";
    if (want === "auto" && gem && duplexOpen()) return "gemini";
    if (web) return "web";
    if (gem) return "gemini";
    return "none";
  }

  function duplexOpen() { return settings().turnTaking === "open"; }

  function canListen() { return micEngine() !== "none"; }
  function canSpeak() { return voiceEngine() !== "none"; }

  function engines() { return { speak: voiceEngine(), listen: micEngine(), duplex: duplexOpen() ? "open" : "hold" }; }

  /* ---------------- the floor ----------------
     Who is speaking right now, held in one place so that every path - the
     recogniser, the mic, a stray dictation started from a button - answers
     the same question the same way. `text` is what we are saying, kept
     through the tail so a late echo of it is still recognisable. */
  var floor = { speaking: false, tail: false, text: "" };
  var tailTimer = null;

  function agentHasFloor() { return floor.speaking || floor.tail; }

  function hold(text) {
    if (tailTimer) { clearTimeout(tailTimer); tailTimer = null; }
    floor.speaking = true;
    floor.tail = false;
    floor.text = text;
  }

  /* Finished speaking - but not finished being heard. */
  function release() {
    floor.speaking = false;
    floor.tail = true;
    if (tailTimer) clearTimeout(tailTimer);
    tailTimer = setTimeout(function () { tailTimer = null; floor.tail = false; }, TAIL_MS);
  }

  /* The person has it: nothing we said is still owed a tail, because they are
     talking over the top of it. */
  function handToPerson() {
    silence();
    if (tailTimer) { clearTimeout(tailTimer); tailTimer = null; }
    floor.speaking = false;
    floor.tail = false;
    floor.text = "";
  }

  function normalize(s) {
    return String(s == null ? "" : s).toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  }
  function words(s) { var n = normalize(s); return n ? n.split(" ") : []; }

  /* The loudspeaker feeding the reply back into the microphone is not the
     person interrupting. What comes back is the reply's own words - in order,
     often with a word dropped or misheard - so a run of the sentence being
     spoken is discarded rather than treated as a turn.

     Longest common subsequence, not a bag of words: "it fears being laughed
     at" shares most of its words with a question about what a part fears, and
     is an answer, not an echo. In order, it matches almost nothing. */
  function isEcho(heard, spoken) {
    var h = words(heard), sp = words(spoken);
    if (!h.length || !sp.length) return false;
    // a word or two is too little to call, and "stop" or "wait" appearing in
    // the reply must still reach us as an interruption
    if (h.length < 3) return false;
    if (normalize(spoken).indexOf(normalize(heard)) !== -1) return true;
    h = h.slice(0, 60); sp = sp.slice(0, 200);
    var prev = new Array(sp.length + 1), row = new Array(sp.length + 1), i, j;
    for (j = 0; j <= sp.length; j++) prev[j] = 0;
    for (i = 1; i <= h.length; i++) {
      row[0] = 0;
      for (j = 1; j <= sp.length; j++) {
        row[j] = h[i - 1] === sp[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
      }
      for (j = 0; j <= sp.length; j++) prev[j] = row[j];
    }
    return prev[sp.length] / h.length >= 0.7;
  }

  /* Enough to take the floor from us mid-sentence. */
  function bargeWorthy(text) {
    if (URGENT.test(text)) return true;
    return words(text).length >= BARGE_WORDS;
  }

  /* Whatever engine heard it: saying you are being interrupted widens the
     window for the rest of the page session. */
  function noteInterruption(text, onInterrupt) {
    if (extraGrace || !INTERRUPTED.test(text)) return;
    extraGrace = INTERRUPT_MS;
    if (onInterrupt) onInterrupt();
  }

  /* ---------------- listening ---------------- */

  var active = null;  // {stop, drop} for whichever engine holds the mic

  /* Start dictation for one turn. opts: {onInterim(text), onEnd(finalText),
     onError(msg), onInterrupt(), onBargeIn(), onThinking()}.
     onEnd fires once, with everything heard across the turn. */
  function listen(opts) {
    opts = opts || {};
    dropListening();
    var kind = micEngine();
    if (kind === "web") return webListen(opts);
    if (kind === "gemini") { gemListen(opts); return true; }
    if (opts.onError) opts.onError("Voice input isn't supported in this browser.");
    return false;
  }

  function webListen(opts) {
    var r = new Rec();
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.continuous = true;

    var finalText = "", done = false, stopping = false, timer = null, restarts = 0;

    function disarm() { if (timer) { clearTimeout(timer); timer = null; } }
    function close(deliver) {
      if (done) return;
      done = true;
      disarm();
      if (active === handle) active = null;
      stopping = true;
      /* stop() hands back what it has already heard; abort() throws it away.
         Which one is the difference between a manual stop keeping the words
         and losing them. */
      try { if (deliver) r.stop(); else r.abort(); }
      catch (e) { try { r.abort(); } catch (e2) {} }
      if (deliver && opts.onEnd) opts.onEnd(finalText.trim());
    }
    function arm() {   // every syllable pushes the end of the turn back out
      disarm();
      timer = setTimeout(function () { close(true); }, SILENCE_MS + extraGrace);
    }
    var handle = {
      stop: function () { close(true); },
      drop: function () { close(false); }
    };

    r.onresult = function (ev) {
      var interim = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var res = ev.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      var all = (finalText + interim).trim();
      if (!all) return;
      if (agentHasFloor()) {
        /* One at a time: the mic should not even be open here, but a manual
           dictation or a slow-closing run can overlap the reply. Anything
           heard while we are speaking is our own voice, and is dropped - it
           must not land in the turn, and it must not start the end-of-turn
           clock, or the answer would "finish" full of our own words. */
        if (!duplexOpen()) { finalText = ""; return; }
        if (isEcho(all, floor.text)) { finalText = ""; return; }
        if (!bargeWorthy(all)) return;   // wait for a real sentence before we stop
        handToPerson();
        if (opts.onBargeIn) opts.onBargeIn();
      }
      noteInterruption(all, opts.onInterrupt);
      if (opts.onInterim) opts.onInterim(all);
      arm();
    };

    r.onerror = function (ev) {
      if (ev.error === "no-speech" || ev.error === "aborted") return; // onend decides
      stopping = true; // don't reopen a mic we've been told we can't have
      if (opts.onError) opts.onError(
        ev.error === "not-allowed" ? "Microphone access was blocked. Allow it in your browser settings."
                                   : "Voice input hiccup (" + ev.error + ").");
    };

    /* The browser ending its run is not the person finishing their turn. Only
       the silence timer, an error, or an explicit stop ends the turn. */
    r.onend = function () {
      if (done) return;
      if (stopping || restarts >= MAX_RESTARTS) { close(true); return; }
      restarts++;
      setTimeout(function () {
        if (done) return;
        try { r.start(); } catch (e) { close(true); }
      }, 250);
    };

    active = handle;
    try { r.start(); } catch (e) {
      active = null;
      if (opts.onError) opts.onError("Couldn't start the microphone.");
      return false;
    }
    return true;
  }

  /* The Gemini microphone: our own recording, cancelled against what the
     speaker is playing, ended by a loudness-based turn detector and then
     transcribed. There are no interim words on this path - the transcript
     arrives in one piece when the turn is over - so the caller is told we are
     working rather than left looking at an idle screen. */
  function gemListen(opts) {
    var s = settings();
    var mic = null, dropped = false, stopped = false;
    /* The mic is asked for asynchronously, so a turn can be stopped before
       there is anything to stop - remember, and act on it when it arrives. */
    var handle = {
      stop: function () { stopped = true; if (mic) mic.stop(); },
      drop: function () {
        dropped = true;
        if (mic) mic.drop();
        if (active === handle) active = null;
      }
    };
    active = handle;

    GV().openMic({
      silenceMs: SILENCE_MS + extraGrace,
      muted: function () { return agentHasFloor() && !duplexOpen(); },
      onStart: function () {
        if (!agentHasFloor()) return;
        /* Echo cancellation has already removed our own voice from this
           stream, so sound arriving now really is them. */
        handToPerson();
        if (opts.onBargeIn) opts.onBargeIn();
      },
      onTurn: async function (wav) {
        if (dropped) return;
        if (active === handle) active = null;
        if (!wav) { if (opts.onEnd) opts.onEnd(""); return; }
        if (opts.onThinking) opts.onThinking();
        var text = "";
        try {
          text = await GV().transcribe(wav, { key: s.geminiKey, sttModel: s.geminiSttModel });
        } catch (e) {
          if (opts.onError) opts.onError(e.message || "Couldn't reach Gemini to transcribe that.");
          return;
        }
        if (dropped) return;
        if (text) {
          noteInterruption(text, opts.onInterrupt);
          if (opts.onInterim) opts.onInterim(text);
        }
        if (opts.onEnd) opts.onEnd(text);
      },
      onError: function (msg) {
        if (active === handle) active = null;
        if (opts.onError) opts.onError(msg);
      }
    }).then(function (h) {
      mic = h;
      if (!h) return;
      /* ponytail: the stream is opened and closed once per turn, which costs a
         moment at the start of each one. If that gap ever swallows a first
         syllable, hold one stream open for the whole session and gate it with
         `muted` instead. */
      if (dropped) h.drop();
      else if (stopped) h.stop();
    });
  }

  /* stop(), not drop() - it delivers what was already heard instead of
     throwing the turn away. */
  function stopListening() { if (active) active.stop(); }
  function dropListening() { if (active) active.drop(); active = null; }
  function isListening() { return !!active; }

  /* ---------------- speaking ---------------- */

  /* Profile blocks and markdown decoration are stripped so it reads like a
     person talking, not a file. */
  function speakable(text) {
    return String(text == null ? "" : text)
      .replace(/```[\s\S]*?(```|$)/g, " The written profile has been updated. ")
      .replace(/\*\*([^*\n]{1,48}?):?\*\*:?/g, " $1 says: ")
      .replace(/[*_#`>]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /* ElevenLabs puts the real reason in the body - {detail:{status,message}} -
     and a bare status code sends people hunting in the wrong place. A 403 in
     particular is usually a key created without text_to_speech permission, or
     a voice the plan doesn't cover; only the body says which. Consumes the
     response, so call it only on a failure. */
  async function apiError(res, noun) {
    var msg = "";
    try {
      var d = (await res.json()).detail;
      if (typeof d === "string") msg = d;
      else if (d && typeof d.message === "string") msg = d.message;
      else if (Array.isArray(d) && d[0] && d[0].msg) msg = d[0].msg;
    } catch (e) {}
    if (msg) return "ElevenLabs: " + msg.slice(0, 200);
    if (res.status === 401) return "ElevenLabs rejected that API key";
    if (res.status === 403) return "ElevenLabs refused that request (403) - the key may lack text-to-speech permission, or the voice may need a paid plan";
    if (res.status === 404) return "That ElevenLabs " + (noun || "voice") + " wasn't found";
    if (res.status === 429) return "ElevenLabs quota or rate limit reached";
    return "ElevenLabs error " + res.status;
  }

  /* One rate for every engine. ElevenLabs accepts 0.7-1.2 and the browser is
     happy well outside that, so clamp to the narrower range and stay honest
     about what the engines do differently: ElevenLabs re-times the delivery,
     Gemini is asked in words to slow down, speechSynthesis just plays back
     slower. */
  function speechRate() {
    var v = parseFloat(settings().speechRate);
    if (!v || isNaN(v)) v = 0.9;
    return Math.min(1.2, Math.max(0.7, v));
  }

  /* Interrupt safety: silence() bumps `gen`, so a speak() that was cut off
     (person sent a message, closed the session) never fires its onEnd -
     otherwise the hands-free mic would pop open after a manual interrupt. */
  var gen = 0;
  var audioEl = null; // current ElevenLabs / Gemini playback

  function speak(text, onEnd) {
    stopSpeaking();
    var myGen = gen;
    var clean = speakable(text);
    var done = function () {
      if (gen !== myGen) return;   // superseded: whoever superseded us owns the floor
      release();
      if (onEnd) onEnd();
    };
    if (!clean) { done(); return; }
    hold(clean);
    var engine = voiceEngine();
    if (engine === "gemini") geminiSpeak(clean, myGen, done);
    else if (engine === "eleven") elevenSpeak(clean, elevenConfig(), myGen, done);
    else if (engine === "browser") browserSpeak(clean, myGen, done);
    else done();
  }

  function browserSpeak(clean, myGen, done) {
    if (!canSynth()) { done(); return; }
    var u = new SpeechSynthesisUtterance(clean);
    u.rate = speechRate();
    var fired = false;
    var finish = function () { if (!fired) { fired = true; done(); } };
    u.onend = finish;
    u.onerror = finish;
    try { speechSynthesis.speak(u); } catch (e) { finish(); return; }
    // some browsers never fire onend after cancel(); poll as a safety net
    var poll = setInterval(function () {
      if (fired || gen !== myGen) { clearInterval(poll); finish(); return; }
      if (!speechSynthesis.speaking && !speechSynthesis.pending) { clearInterval(poll); finish(); }
    }, 600);
  }

  /* Whatever the engine produced, played through one <audio> element so that
     stopping mid-sentence is the same operation for all of them. Playback
     failing (autoplay policy, a codec) falls back to the browser voice rather
     than to silence. */
  function playAudio(blob, clean, myGen, done) {
    if (gen !== myGen) { done(); return; }   // interrupted while generating
    var url = URL.createObjectURL(blob);
    var a = new Audio(url);
    audioEl = a;
    var handled = false;
    var cleanup = function () {
      if (handled) return false;
      handled = true;
      URL.revokeObjectURL(url);
      if (audioEl === a) audioEl = null;
      return true;
    };
    a.onended = function () { if (cleanup()) done(); };
    a.onerror = function () {
      if (!cleanup()) return;
      if (gen === myGen) browserSpeak(clean, myGen, done);
      else done();
    };
    a.play().catch(function () { a.onerror(); });
  }

  function fellBack(msg) {
    if (msg && window.IFS.ui && window.IFS.ui.toast) {
      window.IFS.ui.toast(String(msg).replace(/\.?$/, ".") + " Using the browser voice.");
    }
  }

  /* Gemini's own voice, on the same free-tier key as the chat. */
  async function geminiSpeak(clean, myGen, done) {
    var s = settings();
    try {
      var blob = await GV().tts(clean, {
        key: s.geminiKey, voice: s.geminiVoice, ttsModel: s.geminiTtsModel, rate: speechRate()
      });
      playAudio(blob, clean, myGen, done);
    } catch (e) {
      fellBack(e.message);
      if (gen === myGen) browserSpeak(clean, myGen, done);
      else done();
    }
  }

  /* Personal voice via the ElevenLabs TTS API. */
  async function elevenSpeak(clean, s, myGen, done) {
    var apiProblem = "";
    try {
      var res = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" +
        encodeURIComponent(s.elevenVoiceId) + "?output_format=mp3_44100_128", {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": s.elevenKey },
        body: JSON.stringify(elevenBody(clean, s))
      });
      if (!res.ok) {
        apiProblem = await apiError(res, "voice");
        throw new Error(apiProblem);
      }
      playAudio(await res.blob(), clean, myGen, done);
    } catch (e) {
      fellBack(apiProblem);
      if (gen === myGen) browserSpeak(clean, myGen, done);
      else done();
    }
  }

  /* ponytail: voice_settings is sent only when the rate is not 1, because a
     partial voice_settings object can drop the voice's own stored stability
     and similarity for that request - which would quietly retune a clone
     someone tuned deliberately. At normal speed we send nothing and the voice
     keeps its own settings. Upgrade path if speed at 1.0 is ever wanted: GET
     /v1/voices/<id>/settings once per session and merge. */
  function elevenBody(clean, s) {
    var body = { text: clean, model_id: s.elevenModel || "eleven_flash_v2_5" };
    var rate = speechRate();
    if (rate !== 1) body.voice_settings = { speed: rate };
    return body;
  }

  /* Stop the sound without deciding whose turn it is. */
  function silence() {
    gen++;
    if (audioEl) { try { audioEl.pause(); } catch (e) {} audioEl = null; }
    if (canSynth()) { try { speechSynthesis.cancel(); } catch (e) {} }
  }

  function stopSpeaking() {
    handover = null;   // nothing is owed a microphone once we have been stopped
    silence();
    if (floor.speaking) release();
  }

  /* ---------------- one exchange ---------------- */

  /* Speak the reply and then hand the floor over, without a button in
     between. In "one at a time" the microphone opens once the words (and
     their tail) are gone; with cutting in allowed it is open throughout and
     real speech takes the floor. Falls back to speaking alone where there is
     no mic at all.

     opts: {onState(state), onInterim(t), onEnd(finalText), onError,
            onBargeIn, onInterrupt, onSpoken}
     state is one of "speaking" | "listening" | "thinking" | "idle". */
  var handover = null;   // the microphone this exchange still owes the person

  function exchange(text, opts) {
    opts = opts || {};
    var open = duplexOpen() && canListen();
    var opened = false;
    var say = function (s) { if (opts.onState) opts.onState(s); };

    function openMic() {
      if (opened) return;
      opened = true;
      if (handover === openMic) handover = null;
      if (!canListen()) { say("idle"); return; }
      /* Announced on the tail too: we really are listening by then, and the
         person watching the dot should not be told we are still talking. */
      if (!floor.speaking) say("listening");
      listen({
        onInterim: opts.onInterim,
        onInterrupt: opts.onInterrupt,
        onThinking: function () { say("thinking"); },
        onBargeIn: function () {
          say("listening");
          if (opts.onBargeIn) opts.onBargeIn();
        },
        onEnd: function (finalText) {
          say("idle");
          if (opts.onEnd) opts.onEnd(finalText);
        },
        onError: function (msg) {
          say("idle");
          if (opts.onError) opts.onError(msg);
        }
      });
    }

    say("speaking");
    if (!open) dropListening();   // one at a time: nothing is listening while we talk

    speak(text, function () {
      if (opts.onSpoken) opts.onSpoken();
      if (!canListen()) { say("idle"); return; }
      if (open) { say("listening"); return; }   // the mic has been open all along
      /* The tail: the recogniser and the room both hand back our last words
         a beat after the audio ends, and an open mic would hear them. */
      setTimeout(function () { if (handover === openMic) openMic(); }, TAIL_MS);
    });
    handover = openMic;           // set after speak(), whose stopSpeaking() clears it

    if (open) openMic();
    return canListen();
  }

  /* "I'll take it from here" - a tap on the orb, at any point in the reply.
     Stops the voice and opens the mic straight away rather than waiting for
     the sentence to finish. */
  function takeFloor() {
    var owed = handover;
    if (!agentHasFloor() && !owed) return false;
    handToPerson();
    if (owed) owed();
    return true;
  }

  window.IFS.voice = {
    apiError: apiError,
    isEcho: isEcho,
    bargeWorthy: bargeWorthy,
    engines: engines,
    exchange: exchange,
    takeFloor: takeFloor,
    canListen: canListen,
    canSpeak: canSpeak,
    listen: listen,
    stopListening: stopListening,
    isListening: isListening,
    speaking: agentHasFloor,
    speak: speak,
    speakable: speakable,
    stopSpeaking: stopSpeaking
  };
})();
