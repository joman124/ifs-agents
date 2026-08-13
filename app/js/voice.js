/* Inner Table - voice mode.
   Dictation via the Web Speech API (SpeechRecognition). Spoken replies use
   ElevenLabs text-to-speech when a key + voice ID are set (a personal or
   cloned voice), and fall back to the browser's speechSynthesis otherwise -
   so voice works identically for every provider (Gemini, ChatGPT, Claude).
   Note: dictation audio goes to the browser vendor's speech service, and
   with ElevenLabs configured the reply TEXT goes to ElevenLabs; the LLM
   provider never receives audio. */
(function () {
  "use strict";

  var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  var active = null; // current recognizer, when listening

  function canListen() { return !!Rec; }
  function canSpeak() { return "speechSynthesis" in window; }

  /* Turn-taking.
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
  var MAX_RESTARTS = 40;      // ~5 minutes of holding the mic open for silence
  var INTERRUPTED = /\b(?:interrupt(?:ed|ing|ion)?|hold on|hang on|one (?:sec|second|minute|moment)|give me a (?:sec|second|minute|moment)|be right back|back in a (?:sec|second|minute)|someone(?:'s| is)? (?:here|calling|talking|at the door)|somebody(?:'s| is)? (?:here|calling)|(?:the|my) (?:door|phone|dog|baby|kid|kids))\b/i;
  var extraGrace = 0;

  function normalize(s) {
    return String(s == null ? "" : s).toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  }

  /* The loudspeaker feeding the reply back into the microphone is not the
     person interrupting. What comes back is the reply's own words, so a run
     of words already in the sentence being spoken is discarded rather than
     treated as a turn.
     ponytail: text-based, which holds on a speaker in a normal room. If it
     ever mis-fires the upgrade is a getUserMedia stream with echoCancellation
     feeding a separate recognizer. */
  function isEcho(heard, spoken) {
    var h = normalize(heard), sp = normalize(spoken);
    if (!h || !sp) return false;
    var hw = h.split(" ");
    // a word or two is too little to call, and "stop" or "wait" appearing in
    // the reply must still reach us as an interruption
    if (hw.length < 3) return false;
    if (sp.indexOf(h) !== -1) return true;      // a verbatim run of the reply
    var inSpoken = {};
    sp.split(" ").forEach(function (w) { inSpoken[w] = 1; });
    var hits = hw.filter(function (w) { return inSpoken[w]; }).length;
    return hits / hw.length > 0.8;
  }

  /* Start dictation. opts: {onInterim(text), onEnd(finalText), onError(msg),
     onInterrupt(), echoOf() -> text currently being spoken, onBargeIn()}.
     onEnd fires once, with everything heard across the turn. */
  function listen(opts) {
    opts = opts || {};
    if (!Rec) { if (opts.onError) opts.onError("Voice input isn't supported in this browser."); return false; }
    stopListening();
    var r = new Rec();
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.continuous = true;

    var finalText = "", done = false, stopping = false, timer = null, restarts = 0;

    function disarm() { if (timer) { clearTimeout(timer); timer = null; } }
    function finish() {
      if (done) return;
      done = true;
      disarm();
      if (active === r) active = null;
      try { r.stop(); } catch (e) {}
      if (opts.onEnd) opts.onEnd(finalText.trim());
    }
    function arm() {   // every syllable pushes the end of the turn back out
      disarm();
      timer = setTimeout(finish, SILENCE_MS + extraGrace);
    }
    r.__stop = function () { stopping = true; };

    r.onresult = function (ev) {
      var interim = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var res = ev.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      var all = (finalText + interim).trim();
      if (!all) return;
      /* Held open through the reply so the person can cut in. Anything that
         is just the reply coming back off the speaker is dropped here - it
         must not land in the turn, and it must not start the end-of-turn
         clock, or the answer would "finish" full of our own words. */
      var echoSource = opts.echoOf ? opts.echoOf() : "";
      if (echoSource) {
        if (isEcho(all, echoSource)) { finalText = ""; return; }
        if (opts.onBargeIn) opts.onBargeIn();
      }
      if (!extraGrace && INTERRUPTED.test(all)) {
        extraGrace = INTERRUPT_MS;
        if (opts.onInterrupt) opts.onInterrupt();
      }
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
      if (stopping || restarts >= MAX_RESTARTS) { finish(); return; }
      restarts++;
      setTimeout(function () {
        if (done) return;
        try { r.start(); } catch (e) { finish(); }
      }, 250);
    };

    active = r;
    try { r.start(); } catch (e) {
      active = null;
      if (opts.onError) opts.onError("Couldn't start the microphone.");
      return false;
    }
    return true;
  }

  /* stop(), not abort() - it delivers what was already heard instead of
     throwing the turn away. */
  function stopListening() {
    if (!active) return;
    var r = active;
    if (r.__stop) r.__stop();
    try { r.stop(); } catch (e) { try { r.abort(); } catch (e2) {} }
  }
  function isListening() { return !!active; }

  /* Speak text aloud. Profile blocks and markdown decoration are stripped so
     it reads like a person talking, not a file. onEnd always fires. */
  function speakable(text) {
    return String(text == null ? "" : text)
      .replace(/```[\s\S]*?(```|$)/g, " The written profile has been updated. ")
      .replace(/\*\*([^*\n]{1,48}?):?\*\*:?/g, " $1 says: ")
      .replace(/[*_#`>]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /* Interrupt safety: stopSpeaking() bumps `gen`, so a speak() that was cut
     off (person sent a message, closed the session) never fires its onEnd -
     otherwise the hands-free mic would pop open after a manual interrupt. */
  var gen = 0;
  var audioEl = null; // current ElevenLabs playback

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

  /* One rate for both engines. ElevenLabs accepts 0.7-1.2 and the browser is
     happy well outside that, so clamp to the narrower range and stay honest
     about what the two do differently: ElevenLabs re-times the delivery,
     speechSynthesis just plays back slower. */
  function speechRate() {
    var v = NaN;
    try { v = parseFloat(window.IFS.store.state.settings.speechRate); } catch (e) {}
    if (!v || isNaN(v)) v = 0.9;
    return Math.min(1.2, Math.max(0.7, v));
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

  function elevenConfig() {
    try {
      var s = window.IFS.store.state.settings;
      if (s && s.elevenKey && s.elevenVoiceId) return s;
    } catch (e) {}
    return null;
  }

  function speak(text, onEnd) {
    stopSpeaking();
    var myGen = gen;
    var done = function () { if (gen === myGen && onEnd) onEnd(); };
    var clean = speakable(text);
    if (!clean) { done(); return; }
    var cfg = elevenConfig();
    if (cfg) elevenSpeak(clean, cfg, myGen, done);
    else if (canSpeak()) browserSpeak(clean, myGen, done);
    else done();
  }

  function browserSpeak(clean, myGen, done) {
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

  /* Personal voice via the ElevenLabs TTS API. Any failure (bad key, quota,
     autoplay policy) falls back to the browser voice so voice mode never
     goes silent. */
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
      var blob = await res.blob();
      if (gen !== myGen) { done(); return; } // interrupted while generating
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
      a.onerror = function () { // playback failed (autoplay policy etc.) - use the browser voice
        if (!cleanup()) return;
        if (gen === myGen && canSpeak()) browserSpeak(clean, myGen, done);
        else done();
      };
      a.play().catch(function () { a.onerror(); });
    } catch (e) {
      if (apiProblem && window.IFS.ui && window.IFS.ui.toast) {
        window.IFS.ui.toast(apiProblem.replace(/\.?$/, ".") + " Using the browser voice.");
      }
      if (gen === myGen && canSpeak()) browserSpeak(clean, myGen, done);
      else done();
    }
  }

  function stopSpeaking() {
    gen++;
    if (audioEl) { try { audioEl.pause(); } catch (e) {} audioEl = null; }
    if (canSpeak()) { try { speechSynthesis.cancel(); } catch (e) {} }
  }

  /* One conversational turn: speak the reply with the microphone already
     open, so the person can cut in the way they would with someone in the
     room, and so the moment the reply ends the turn is simply theirs - no
     gap, no button. Falls back to speaking alone where there is no mic.

     opts: {onState(state), onInterim(t), onEnd(finalText), onError, onBargeIn}
     state is one of "speaking" | "listening" | "idle". */
  function exchange(text, opts) {
    opts = opts || {};
    var spoken = speakable(text);
    var speaking = true;
    var say = function (s) { if (opts.onState) opts.onState(s); };

    say("speaking");
    speak(text, function () {
      if (!speaking) return;              // already cut off by a barge-in
      speaking = false;
      say(canListen() ? "listening" : "idle");
      if (opts.onSpoken) opts.onSpoken();
    });

    if (!canListen()) return false;

    return listen({
      echoOf: function () { return speaking ? spoken : ""; },
      onBargeIn: function () {
        if (!speaking) return;
        speaking = false;
        stopSpeaking();                   // stop mid-sentence; they have the floor
        say("listening");
        if (opts.onBargeIn) opts.onBargeIn();
      },
      onInterim: opts.onInterim,
      onInterrupt: opts.onInterrupt,
      onEnd: function (finalText) {
        speaking = false;
        say("idle");
        if (opts.onEnd) opts.onEnd(finalText);
      },
      onError: function (msg) {
        speaking = false;
        say("idle");
        if (opts.onError) opts.onError(msg);
      }
    });
  }

  window.IFS.voice = {
    apiError: apiError,
    isEcho: isEcho,
    exchange: exchange,
    canListen: canListen,
    canSpeak: canSpeak,
    listen: listen,
    stopListening: stopListening,
    isListening: isListening,
    speak: speak,
    stopSpeaking: stopSpeaking
  };
})();
