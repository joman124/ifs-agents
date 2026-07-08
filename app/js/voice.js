/* Inner Table - voice mode.
   Dictation via the Web Speech API (SpeechRecognition) and spoken replies via
   speechSynthesis. Both run through the browser, so voice works identically
   for every provider (Gemini, ChatGPT, Claude) with no extra API key or cost.
   Note: on most browsers SpeechRecognition sends audio to the browser
   vendor's speech service; the LLM provider never receives audio. */
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

  function speak(text, onEnd) {
    var done = onEnd || function () {};
    if (!canSpeak()) { done(); return; }
    stopSpeaking();
    var clean = speakable(text);
    if (!clean) { done(); return; }
    var u = new SpeechSynthesisUtterance(clean);
    u.rate = 1.02;
    var fired = false;
    var finish = function () { if (!fired) { fired = true; done(); } };
    u.onend = finish;
    u.onerror = finish;
    try { speechSynthesis.speak(u); } catch (e) { finish(); return; }
    // some browsers never fire onend after cancel(); poll as a safety net
    var poll = setInterval(function () {
      if (fired) { clearInterval(poll); return; }
      if (!speechSynthesis.speaking && !speechSynthesis.pending) { clearInterval(poll); finish(); }
    }, 600);
  }

  function stopSpeaking() {
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
