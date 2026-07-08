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

  /* Start dictation. opts: {onInterim(text), onEnd(finalText), onError(msg)}
     Runs one utterance (continuous: false) then calls onEnd with what was
     heard - the caller decides whether to auto-send or leave it in the box. */
  function listen(opts) {
    opts = opts || {};
    if (!Rec) { if (opts.onError) opts.onError("Voice input isn't supported in this browser."); return false; }
    stopListening();
    var r = new Rec();
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.continuous = false;
    var finalText = "";
    r.onresult = function (ev) {
      var interim = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var res = ev.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      if (opts.onInterim) opts.onInterim((finalText + interim).trim());
    };
    r.onerror = function (ev) {
      if (ev.error === "no-speech" || ev.error === "aborted") return; // onend handles it
      if (opts.onError) opts.onError(
        ev.error === "not-allowed" ? "Microphone access was blocked. Allow it in your browser settings."
                                   : "Voice input hiccup (" + ev.error + ").");
    };
    r.onend = function () {
      if (active === r) active = null;
      if (opts.onEnd) opts.onEnd(finalText.trim());
    };
    active = r;
    try { r.start(); } catch (e) {
      active = null;
      if (opts.onError) opts.onError("Couldn't start the microphone.");
      return false;
    }
    return true;
  }

  function stopListening() {
    if (active) { var r = active; active = null; try { r.abort(); } catch (e) {} }
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
    u.rate = 1.02;
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
        body: JSON.stringify({ text: clean, model_id: s.elevenModel || "eleven_flash_v2_5" })
      });
      if (!res.ok) {
        apiProblem = res.status === 401 ? "ElevenLabs rejected the API key - check it in Settings."
          : res.status === 404 ? "That ElevenLabs voice ID wasn't found - check it in Settings."
          : res.status === 429 ? "ElevenLabs quota or rate limit reached."
          : "ElevenLabs error " + res.status + ".";
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
        window.IFS.ui.toast(apiProblem + " Using the browser voice.");
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

  window.IFS.voice = {
    canListen: canListen,
    canSpeak: canSpeak,
    listen: listen,
    stopListening: stopListening,
    isListening: isListening,
    speak: speak,
    stopSpeaking: stopSpeaking
  };
})();
