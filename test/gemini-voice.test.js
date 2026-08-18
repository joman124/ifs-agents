/* Gemini speech: the request and response shapes, the audio containers, and
   the turn detector that decides a spoken answer has finished. None of it
   needs a microphone - the detector takes loudness and a timestamp, which is
   the whole reason it is a function and not a tangle inside onaudioprocess. */
"use strict";
var H = require("./harness");

module.exports = function (t) {
  /* A page with a network that answers whatever the test hands it. */
  function load(replies) {
    var calls = [];
    var queue = (replies || []).slice();
    var env = H.load(["schema", "llm", "gemini-voice"], {
      Blob: function (parts, opts) { this.parts = parts; this.type = opts && opts.type; },
      fetch: function (url, init) {
        calls.push({ url: url, body: JSON.parse(init.body) });
        var next = queue.shift() || { ok: true, json: {} };
        return Promise.resolve({
          ok: next.ok !== false,
          status: next.status || 200,
          json: function () { return Promise.resolve(next.json || {}); },
          text: function () { return Promise.resolve(JSON.stringify(next.json || {})); }
        });
      }
    });
    env.calls = calls;
    env.G = env.IFS.geminiVoice;
    return env;
  }

  var G = load().G;

  /* ---------------- audio containers ---------------- */

  var pcm = new Uint8Array([1, 0, 2, 0, 3, 0, 4, 0]);   // four 16-bit samples
  var wav = G.wavBytes(pcm, 24000);
  var head = String.fromCharCode.apply(null, wav.subarray(0, 4)) +
    String.fromCharCode.apply(null, wav.subarray(8, 12));
  var dv = new DataView(wav.buffer);
  t.eq(head, "RIFFWAVE", "raw PCM comes back inside a container a browser will play");
  t.eq(wav.length, 44 + pcm.length, "header plus the samples, nothing else");
  t.eq(dv.getUint32(4, true), 36 + pcm.length, "the RIFF size counts everything after it");
  t.eq(dv.getUint16(22, true), 1, "mono");
  t.eq(dv.getUint32(24, true), 24000, "at the rate the audio actually arrived at");
  t.eq(dv.getUint32(28, true), 48000, "byte rate follows from it");
  t.eq(dv.getUint16(34, true), 16, "16-bit samples");
  t.eq(dv.getUint32(40, true), pcm.length, "and the data chunk is the samples' own length");
  t.eq(new DataView(G.wavBytes(pcm, 16000).buffer).getUint32(24, true), 16000,
    "a microphone that refused 16 kHz would still be described correctly");

  t.eq(Array.from(G.fromBase64(G.toBase64(pcm))), Array.from(pcm), "base64 survives the round trip");

  var samples = G.floatsToPcm([new Float32Array([0, 1, -1, 2])]);
  var sv = new DataView(samples.buffer);
  t.eq(samples.length, 8, "one 16-bit sample per float");
  t.eq(sv.getInt16(0, true), 0, "silence is zero");
  t.eq(sv.getInt16(2, true), 32767, "full scale is the top of the range");
  t.eq(sv.getInt16(4, true), -32768, "and the bottom");
  t.eq(sv.getInt16(6, true), 32767, "anything past full scale is clamped, not wrapped");

  /* ---------------- text to speech ---------------- */

  var req = G.ttsRequest("What does it need from you?", { voice: "Sulafat", rate: 0.8 });
  t.eq(req.generationConfig.response_modalities, ["AUDIO"], "the reply is asked for as audio");
  t.eq(req.generationConfig.speech_config.voice_config.prebuilt_voice_config.voice_name, "Sulafat",
    "in the chosen voice");
  var said = req.contents[0].parts[0].text;
  t.ok(said.indexOf("What does it need from you?") !== -1, "and it carries the words to say");
  t.ok(/slowly/.test(said), "an unhurried pace is asked for in words - the API has no rate");
  t.ok(!/slowly/.test(G.ttsRequest("hi", { rate: 1 }).contents[0].parts[0].text),
    "at normal pace it is not");
  t.ok(/<<<TEXT>>>/.test(said),
    "the reply is fenced off, so a session that talks about instructions is still just read out");
  t.eq(G.ttsRequest("hi", {}).generationConfig.speech_config.voice_config.prebuilt_voice_config.voice_name,
    G.VOICES[0].id, "with no voice chosen it falls back to the gentle default");

  t.eq(G.audioOf({ candidates: [{ content: { parts: [{ text: "sorry" }] } }] }), null,
    "a reply with no audio in it is not mistaken for audio");
  var got = G.audioOf({
    candidates: [{ content: { parts: [
      { text: "" },
      { inlineData: { data: "AAA=", mimeType: "audio/L16;codec=pcm;rate=16000" } }
    ] } }]
  });
  t.eq(got.rate, 16000, "the sample rate is read out of the mime type, where Gemini puts it");
  t.eq(G.audioOf({ candidates: [{ content: { parts: [{ inline_data: { data: "AAA=" } }] } }] }).rate, 24000,
    "and defaults to 24k when it says nothing");

  /* ---------------- speech to text ---------------- */

  var stt = G.sttRequest(new Uint8Array([0, 1, 2]), "audio/wav");
  t.ok(/[Tt]ranscribe/.test(stt.contents[0].parts[0].text), "the model is asked for a transcript");
  t.eq(stt.contents[0].parts[1].inline_data.mime_type, "audio/wav", "with the recording attached");
  t.eq(stt.generationConfig.temperature, 0, "and no room for invention");

  function reply(text) { return { candidates: [{ content: { parts: [{ text: text }] } }] }; }
  t.eq(G.transcriptOf(reply("  it fears being laughed at  ")), "it fears being laughed at",
    "the transcript is what the person said");
  t.eq(G.transcriptOf(reply('"it fears being laughed at"')), "it fears being laughed at",
    "quotes the model wrapped around it are not part of it");
  t.eq(G.transcriptOf(reply("[no speech]")), "",
    "a model describing the silence has not heard a turn");
  t.eq(G.transcriptOf(reply("(silence)")), "", "however it phrases it");
  t.eq(G.transcriptOf(reply("")), "", "and an empty answer is empty");
  t.eq(G.transcriptOf({}), "", "as is a reply that came back malformed");

  /* ---------------- deciding a turn is over ---------------- */

  function vad(opts) {
    var v = G.makeVad(opts);
    var at = 1000;
    return {
      v: v,
      /* `for` ms of sound at `level`, in 100 ms frames, returning whatever
         the detector said along the way */
      run: function (level, ms) {
        var out = [];
        for (var i = 0; i < ms; i += 100) {
          var said = v.push(level, at);
          if (said) out.push(said);
          at += 100;
        }
        return out;
      }
    };
  }

  var quiet = vad();
  t.eq(quiet.run(0.002, 60000), [], "a quiet room is never a turn, however long you leave it");

  var one = vad();
  one.run(0.002, 2000);                       // the room, learned
  t.eq(one.run(0.09, 100), [], "a single loud frame is a door, not a sentence");
  t.eq(one.run(0.09, 400), ["start"], "sound that keeps going is someone speaking");
  t.eq(one.run(0.002, 3000), [], "three seconds of quiet is still a pause, not an ending");
  t.eq(one.run(0.002, 1500), ["end"], "four seconds is where the turn ends");

  var mid = vad();
  mid.run(0.002, 2000);
  mid.run(0.09, 400);
  mid.run(0.002, 3000);
  t.eq(mid.run(0.09, 200), [], "picking the sentence back up does not restart the turn");
  t.eq(mid.run(0.002, 3500), [], "and the silence clock starts again from there");
  t.eq(mid.run(0.002, 1000), ["end"], "so the whole answer arrives as one turn");

  var longer = vad({ silenceMs: 9000 });
  longer.run(0.002, 2000);
  longer.run(0.09, 400);
  t.eq(longer.run(0.002, 5000), [], "someone who said they were interrupted gets longer");
  t.eq(longer.run(0.002, 4500), ["end"], "nine seconds, then");

  var noisy = vad();
  noisy.run(0.03, 3000);                      // a fan, an air conditioner, a cafe
  t.eq(noisy.v.threshold() > 0.03, true, "the threshold rides on the room's own noise");
  t.eq(noisy.run(0.03, 5000), [], "so a noisy room is not a person talking");
  t.eq(noisy.run(0.2, 400), ["start"], "but someone talking over it still is");

  /* ---------------- the calls themselves ---------------- */

  return (async function () {
    var spoken = {
      inlineData: {
        data: Buffer.from([1, 0, 2, 0]).toString("base64"),
        mimeType: "audio/L16;codec=pcm;rate=24000"
      }
    };
    var env = load([{ json: { candidates: [{ content: { parts: [spoken] } }] } }]);
    var blob = await env.G.tts("hello", { key: "abc", voice: "Achernar" });
    t.eq(env.calls[0].url.indexOf("gemini-2.5-flash-preview-tts") !== -1, true,
      "speaking goes to the text-to-speech model");
    t.eq(env.calls[0].url.indexOf("key=abc") !== -1, true, "with the person's own key");
    t.eq(blob.type, "audio/wav", "and comes back as something an <audio> element can play");
    t.eq(blob.parts[0].length, 44 + 4, "with the header Gemini leaves off");

    var env2 = load([{ json: { candidates: [{ content: { parts: [{ text: "it fears being laughed at" }] } }] } }]);
    var said = await env2.G.transcribe(new Uint8Array([0, 1]), { key: "abc" });
    t.eq(said, "it fears being laughed at", "a recorded turn comes back as words");
    t.eq(env2.calls[0].url.indexOf("gemini-2.5-flash:") !== -1, true,
      "transcription goes to the ordinary chat model, which hears audio");

    var env3 = load([{ ok: false, status: 429, json: { error: { message: "quota exhausted" } } }]);
    var msg = "";
    try { await env3.G.tts("hello", { key: "abc" }); } catch (e) { msg = e.message; }
    t.ok(/quota exhausted/.test(msg),
      "a refusal says what Gemini actually said, not just a status code");
  })();
};
