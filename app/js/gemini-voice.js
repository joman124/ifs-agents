/* Inner Table - Gemini speech: the other half of voice mode.

   Gemini's speech models can do both ends of a spoken session on the free
   tier, with the same key the chat provider already uses - so there is one
   key to set, not three:
     - text to speech (`gemini-2.5-flash-preview-tts`) speaks the reply;
     - audio in (`gemini-2.5-flash`) turns a recorded turn into text, which is
       dictation in browsers that have none of their own (Safari, Firefox).

   Why this module records the microphone itself instead of leaning on the
   Web Speech API: the stream it opens asks for `echoCancellation`, so the
   reply coming out of the speaker is subtracted from what the mic hears
   before anything else looks at it. That is the actual fix for a session
   that kept interrupting itself - text-matching the echo afterwards is a
   guess, cancelling it in the audio path is not. Web Speech hands us no
   stream and no such control.

   Privacy, plainly: with this engine on, the reply text and - for dictation -
   a recording of the person's voice go to Google. The browser engines send
   the audio to the browser vendor instead. Either way it leaves the device;
   the settings copy says so, and voice mode still works with neither. */
(function () {
  "use strict";

  var API = "https://generativelanguage.googleapis.com/v1beta/models/";

  /* Gemini's prebuilt voices, the gentle end of the list first. A session is
     someone being asked what a frightened part of them needs; "excitable" and
     "gravelly" are real options in the API and belong nowhere near it. The
     full set is available by typing a name into the field. */
  var VOICES = [
    { id: "Achernar", note: "soft" },
    { id: "Vindemiatrix", note: "gentle" },
    { id: "Sulafat", note: "warm" },
    { id: "Leda", note: "youthful" },
    { id: "Aoede", note: "breezy" },
    { id: "Callirrhoe", note: "easy-going" },
    { id: "Despina", note: "smooth" },
    { id: "Iapetus", note: "clear" },
    { id: "Schedar", note: "even" },
    { id: "Charon", note: "informative" },
    { id: "Kore", note: "firm" },
    { id: "Puck", note: "upbeat" }
  ];

  function friendly(status, body) {
    if (window.IFS.llm && window.IFS.llm.friendly) return window.IFS.llm.friendly(status, body, "Gemini");
    return "Gemini error " + status;
  }

  /* ---------------- audio containers ---------------- */

  /* A WAV header around raw 16-bit little-endian PCM. Both directions need
     it: Gemini returns headerless PCM ("audio/L16;codec=pcm;rate=24000") that
     no <audio> element will play, and the microphone gives us raw samples
     that Gemini will only accept inside a container it knows. */
  function wavBytes(pcm, rate, channels) {
    rate = rate || 24000;
    channels = channels || 1;
    var out = new Uint8Array(44 + pcm.length);
    var view = new DataView(out.buffer);
    var byteRate = rate * channels * 2;
    function str(off, s) { for (var i = 0; i < s.length; i++) out[off + i] = s.charCodeAt(i); }
    str(0, "RIFF");
    view.setUint32(4, 36 + pcm.length, true);
    str(8, "WAVEfmt ");
    view.setUint32(16, 16, true);          // PCM header length
    view.setUint16(20, 1, true);           // format: PCM
    view.setUint16(22, channels, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, channels * 2, true); // block align
    view.setUint16(34, 16, true);          // bits per sample
    str(36, "data");
    view.setUint32(40, pcm.length, true);
    out.set(pcm, 44);
    return out;
  }

  function fromBase64(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function toBase64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  /* Float samples from the mic -> the 16-bit PCM everything else here speaks. */
  function floatsToPcm(chunks) {
    var total = 0, i, j;
    for (i = 0; i < chunks.length; i++) total += chunks[i].length;
    var out = new Uint8Array(total * 2);
    var view = new DataView(out.buffer);
    var at = 0;
    for (i = 0; i < chunks.length; i++) {
      var c = chunks[i];
      for (j = 0; j < c.length; j++) {
        var v = Math.max(-1, Math.min(1, c[j]));
        view.setInt16(at, v < 0 ? v * 0x8000 : v * 0x7fff, true);
        at += 2;
      }
    }
    return out;
  }

  /* ---------------- text to speech ---------------- */

  /* Gemini TTS has no rate parameter - delivery is directed in words. The app
     has one pace setting shared with every other engine, so it is said here
     the way this model takes direction, and the payload is fenced off from
     the instruction so a reply that happens to read like a stage direction
     is still spoken rather than obeyed. */
  function styled(text, rate) {
    var how = rate <= 0.8 ? "very slowly and gently, leaving room between sentences"
      : rate < 1 ? "slowly and warmly, unhurried"
        : "warmly and calmly";
    return "You are reading aloud for a quiet self-reflection session. Say the text " +
      "between the markers " + how + ", in a kind, steady voice. Speak only that " +
      "text - do not add, answer, comment on or announce anything.\n" +
      "<<<TEXT>>>\n" + text + "\n<<<END>>>";
  }

  function ttsRequest(text, cfg) {
    return {
      contents: [{ parts: [{ text: styled(text, cfg.rate || 1) }] }],
      generationConfig: {
        response_modalities: ["AUDIO"],
        speech_config: {
          voice_config: { prebuilt_voice_config: { voice_name: cfg.voice || VOICES[0].id } }
        }
      }
    };
  }

  /* The first inline audio part of a generateContent response, plus the
     sample rate, which rides in the mime type ("audio/L16;codec=pcm;rate=24000")
     rather than in a field of its own. */
  function audioOf(json) {
    var cand = json && json.candidates && json.candidates[0];
    var parts = (cand && cand.content && cand.content.parts) || [];
    for (var i = 0; i < parts.length; i++) {
      var d = parts[i].inlineData || parts[i].inline_data;
      if (d && d.data) {
        var m = /rate=(\d+)/.exec(d.mimeType || d.mime_type || "");
        return { data: d.data, rate: m ? parseInt(m[1], 10) : 24000 };
      }
    }
    return null;
  }

  /* Speak `text` in cfg.voice. Resolves to a WAV blob ready for <audio>. */
  async function tts(text, cfg) {
    var res = await fetch(API + encodeURIComponent(cfg.ttsModel || "gemini-2.5-flash-preview-tts") +
      ":generateContent?key=" + encodeURIComponent(cfg.key), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ttsRequest(text, cfg))
    });
    if (!res.ok) throw new Error(friendly(res.status, await res.text()));
    var audio = audioOf(await res.json());
    if (!audio) throw new Error("Gemini returned no audio for that reply.");
    return new Blob([wavBytes(fromBase64(audio.data), audio.rate)], { type: "audio/wav" });
  }

  /* ---------------- speech to text ---------------- */

  var ASK = "Transcribe the speech in this recording word for word. Reply with " +
    "the transcript only - no quotes, no speaker labels, no commentary, no " +
    "description of the audio. If nobody is speaking, reply with nothing at all.";

  function sttRequest(bytes, mime) {
    return {
      contents: [{
        parts: [
          { text: ASK },
          { inline_data: { mime_type: mime || "audio/wav", data: toBase64(bytes) } }
        ]
      }],
      generationConfig: { temperature: 0 }
    };
  }

  /* A model asked to transcribe silence will sometimes describe it instead
     ("[no speech]", "(silence)"). None of that is something the person said,
     and letting it through would send an IFS session a turn nobody took. */
  var NOT_SPEECH = /^[\s\[\(]*(no speech|silence|silent|inaudible|unintelligible|no audible speech|blank|n\/?a|none)[\s\.\]\)]*$/i;

  function transcriptOf(json) {
    var cand = json && json.candidates && json.candidates[0];
    var parts = (cand && cand.content && cand.content.parts) || [];
    var text = parts.map(function (p) { return p.text || ""; }).join("").trim();
    text = text.replace(/^["'“‘]+|["'”’]+$/g, "").trim();
    if (NOT_SPEECH.test(text)) return "";
    return text;
  }

  async function transcribe(bytes, cfg, mime) {
    var res = await fetch(API + encodeURIComponent(cfg.sttModel || "gemini-2.5-flash") +
      ":generateContent?key=" + encodeURIComponent(cfg.key), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sttRequest(bytes, mime))
    });
    if (!res.ok) throw new Error(friendly(res.status, await res.text()));
    return transcriptOf(await res.json());
  }

  /* ---------------- deciding when a turn ended ---------------- */

  /* The turn detector, from loudness alone: `push(level, now)` returns
     "start" when someone has begun speaking, "end" when they have finished,
     null the rest of the time.

     Two rules it exists to keep, both learned from sessions rather than from
     audio theory. A pause is not an ending - the answer to an IFS question
     usually arrives after several seconds of quiet, so silence has to run
     long before the turn closes. And a room is never actually silent, so the
     threshold rides on a noise floor measured from the room itself instead of
     a constant that is wrong in every room but one.

     Kept pure and clock-injected so the awkward cases are testable without a
     microphone. */
  function makeVad(opts) {
    opts = opts || {};
    var silenceMs = opts.silenceMs || 4000;   // quiet that ends a turn
    var onsetMs = opts.onsetMs == null ? 160 : opts.onsetMs; // sound that counts as speech
    var ratio = opts.ratio || 2.6;            // how far above the room's own noise
    var minLevel = opts.minLevel == null ? 0.012 : opts.minLevel;
    var floor = null;
    /* null, not 0: the first frame can arrive at timestamp 0, and a falsy
       "when did this start" would restart the clock on every frame. */
    var speaking = false, loudSince = null, quietSince = null;

    function threshold() {
      return Math.max(minLevel, (floor == null ? 0 : floor) * ratio);
    }

    return {
      /* level: 0..1 RMS of the last audio frame */
      push: function (level, now) {
        if (floor == null) floor = level;
        var loud = level > threshold();
        if (!speaking) {
          /* Track the room only between turns, and let it fall fast and rise
             slow - a fan switching on should be learned, someone talking
             should not. */
          floor = level < floor ? floor * 0.85 + level * 0.15 : floor * 0.995 + level * 0.005;
        }
        if (loud) {
          quietSince = null;
          if (speaking) return null;
          if (loudSince === null) loudSince = now;
          if (now - loudSince < onsetMs) return null;
          speaking = true;
          loudSince = null;
          return "start";
        }
        loudSince = null;
        if (!speaking) return null;
        if (quietSince === null) quietSince = now;
        if (now - quietSince < silenceMs) return null;
        speaking = false;
        quietSince = null;
        return "end";
      },
      /* Being interrupted buys the person a longer window, mid-turn. */
      setSilence: function (ms) { silenceMs = ms; },
      speaking: function () { return speaking; },
      floor: function () { return floor; },
      threshold: threshold
    };
  }

  /* ---------------- the microphone ---------------- */

  function canRecord() {
    return !!(window.navigator && navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
      (window.AudioContext || window.webkitAudioContext) && window.Blob);
  }

  function rms(buf) {
    var sum = 0;
    for (var i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / (buf.length || 1));
  }

  var MAX_TURN_MS = 180000;   // a recording that never ends is a bug, not a turn
  var PREROLL = 3;            // frames kept before speech, so no first syllable is clipped

  /* Open the microphone for one spoken turn.

     opts: {
       silenceMs, onsetMs,          - passed to the detector
       muted() -> bool,             - true while the agent holds the floor
       onStart(), onLevel(l),       - the person began; live loudness
       onTurn(wavBytes, sampleRate),- what they said, as WAV
       onError(msg)
     }
     Returns a handle: {stop(), drop(), muted(bool)}. stop() delivers whatever
     has been captured so far; drop() throws it away. */
  async function openMic(opts) {
    opts = opts || {};
    var stream, ctx, source, proc, sink;
    var vad = makeVad({ silenceMs: opts.silenceMs, onsetMs: opts.onsetMs });
    var pre = [], chunks = [], capturing = false, closed = false, startedAt = 0;

    function close() {
      if (closed) return;
      closed = true;
      try { proc.disconnect(); source.disconnect(); sink.disconnect(); } catch (e) {}
      try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      try { if (ctx && ctx.close) ctx.close(); } catch (e) {}
    }

    function deliver() {
      var got = chunks;
      chunks = [];
      capturing = false;
      var rate = (ctx && ctx.sampleRate) || 16000;
      close();
      if (!got.length) { if (opts.onTurn) opts.onTurn(null, rate); return; }
      if (opts.onTurn) opts.onTurn(wavBytes(floatsToPcm(got), rate), rate);
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,   // the whole reason this path exists
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      });
    } catch (e) {
      if (opts.onError) {
        opts.onError(/not ?allowed|permission/i.test(e && e.name || "")
          ? "Microphone access was blocked. Allow it in your browser settings."
          : "Couldn't start the microphone.");
      }
      return null;
    }

    var AC = window.AudioContext || window.webkitAudioContext;
    /* 16 kHz is plenty for speech and a quarter of the bytes of the default
       48 kHz; the WAV header carries whatever rate we actually got, so a
       browser that refuses the hint still produces a file Gemini can read. */
    try { ctx = new AC({ sampleRate: 16000 }); } catch (e) { ctx = new AC(); }
    if (ctx.state === "suspended" && ctx.resume) { try { await ctx.resume(); } catch (e) {} }

    source = ctx.createMediaStreamSource(stream);
    /* ponytail: ScriptProcessorNode is deprecated but needs no second file to
       load, which keeps this app buildless. If it ever stops working the
       upgrade is an AudioWorklet module added to the service worker shell. */
    proc = ctx.createScriptProcessor(2048, 1, 1);
    sink = ctx.createGain();
    sink.gain.value = 0;              // it must reach a destination to run, but silently

    proc.onaudioprocess = function (ev) {
      if (closed) return;
      var buf = ev.inputBuffer.getChannelData(0);
      var level = rms(buf);
      var muted = opts.muted ? opts.muted() : false;
      if (opts.onLevel) opts.onLevel(level);

      if (muted) {                    // the agent is talking: hear, but do not act
        pre.length = 0;
        return;
      }
      var frame = new Float32Array(buf.length);
      frame.set(buf);
      if (capturing) {
        chunks.push(frame);
        if (Date.now() - startedAt > MAX_TURN_MS) { deliver(); return; }
      } else {
        pre.push(frame);
        if (pre.length > PREROLL) pre.shift();
      }

      var said = vad.push(level, Date.now());
      if (said === "start" && !capturing) {
        capturing = true;
        startedAt = Date.now();
        chunks = pre.slice();
        pre = [];
        if (opts.onStart) opts.onStart();
      } else if (said === "end" && capturing) {
        deliver();
      }
    };

    source.connect(proc);
    proc.connect(sink);
    sink.connect(ctx.destination);

    return {
      vad: vad,
      /* Hand over what has been said so far - a manual stop keeps the words
         rather than throwing the turn away. */
      stop: function () { if (!closed) deliver(); },
      drop: function () { chunks = []; close(); },
      closed: function () { return closed; }
    };
  }

  window.IFS.geminiVoice = {
    VOICES: VOICES,
    canRecord: canRecord,
    wavBytes: wavBytes,
    floatsToPcm: floatsToPcm,
    fromBase64: fromBase64,
    toBase64: toBase64,
    styled: styled,
    ttsRequest: ttsRequest,
    audioOf: audioOf,
    sttRequest: sttRequest,
    transcriptOf: transcriptOf,
    tts: tts,
    transcribe: transcribe,
    makeVad: makeVad,
    openMic: openMic
  };
})();
