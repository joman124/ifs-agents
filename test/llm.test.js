/* The in-app AI client (app/js/llm.js), plus the two things around it that
   decide whether a person's connection survives: the one-time carry-over of
   keys typed in before settings.ai existed (store.js), and keeping the
   connection in step with the account across devices (sync.js). */
"use strict";
var H = require("./harness.js");

function flush() { return new Promise(function (r) { setImmediate(r); }); }

/* A fetch Response whose body streams the given SSE text in two chunks. */
function sse(text) {
  var enc = new TextEncoder();
  var mid = Math.floor(text.length / 2);
  var chunks = [enc.encode(text.slice(0, mid)), enc.encode(text.slice(mid))];
  return { ok: true, body: { getReader: function () {
    return { read: function () { return Promise.resolve(chunks.length ? { done: false, value: chunks.shift() } : { done: true }); } };
  } } };
}
function json(obj, status) {
  return Promise.resolve({ ok: !status || status < 400, status: status || 200,
    json: function () { return Promise.resolve(obj); }, text: function () { return Promise.resolve(JSON.stringify(obj)); } });
}

module.exports = async function (t) {
  var calls = [];
  var reply = null;
  var env = H.load(["schema", "llm"], {
    TextDecoder: TextDecoder,
    location: { origin: "https://inner.example" },
    fetch: function (url, opts) { calls.push({ url: String(url), opts: opts }); return reply(url, opts); }
  });
  var L = env.IFS.llm;

  /* ---- whose key is it ---- */
  t.eq(["sk-ant-api03-x", "sk-or-v1-x", "sk-proj-x", "AIzaSy-x", "hello", ""].map(L.detect),
    ["anthropic", "openrouter", "openai", "gemini", "", ""], "a key's shape says whose it is");
  t.eq(L.label({ provider: "anthropic", key: "k", model: "" }), "Claude Sonnet 5.5 via your Anthropic key", "an empty model means the current Sonnet");
  t.eq(L.label({ provider: "openrouter", key: "k", model: "anthropic/claude-opus-5.5" }), "Claude Opus 5.5 via OpenRouter", "OpenRouter names read the same way");
  t.ok(!L.configured({ provider: "anthropic", key: "" }) && !L.configured({ provider: "x", key: "k" }) && !L.configured(null),
    "no key, or an unknown provider, is not connected");

  /* ---- request shapes ---- */
  var a = L._request({ provider: "anthropic", key: "sk-ant-k", model: "" }, "SYSTEM", [{ role: "user", text: "hi" }], true);
  t.eq(a.body.model, "claude-sonnet-5-5", "Anthropic defaults to the current Sonnet");
  t.eq(a.body.cache_control, { type: "ephemeral" }, "the long system prompt is cached across a session's turns");
  t.eq(a.body.output_config, { effort: "medium" }, "a current Claude model thinks at medium effort");
  t.eq([a.headers["anthropic-beta"], a.body.fallbacks], ["server-side-fallback-2026-07-01", "default"],
    "a declined turn falls back to another Claude model instead of ending the session");
  t.eq(a.headers["x-api-key"], "sk-ant-k", "the key goes in its header");
  var old = L._request({ provider: "anthropic", key: "k", model: "claude-sonnet-4-5" }, "S", [], false);
  t.ok(!old.body.output_config && !old.body.fallbacks && !old.headers["anthropic-beta"], "an older model chosen by hand gets neither");

  var r = L._request({ provider: "openrouter", key: "sk-or-k", model: "anthropic/claude-sonnet-5.5" }, "SYSTEM", [{ role: "user", text: "hi" }], false);
  t.eq(r.url, "https://openrouter.ai/api/v1/chat/completions", "OpenRouter has its own endpoint");
  t.eq(r.body.messages[0].content[0].cache_control, { type: "ephemeral" }, "a Claude model through OpenRouter caches the system prompt too");
  t.eq([r.headers["X-Title"], r.headers["HTTP-Referer"]], ["Inner Table", "https://inner.example"], "and names the app on the person's OpenRouter activity");
  t.ok(r.body.max_tokens && !r.body.max_completion_tokens, "OpenRouter takes max_tokens");
  var o = L._request({ provider: "openai", key: "sk-k", model: "" }, "SYSTEM", [], false);
  t.eq([o.url, o.body.model, typeof o.body.messages[0].content], ["https://api.openai.com/v1/chat/completions", "gpt-5.1", "string"], "OpenAI is unchanged");

  /* ---- replies ---- */
  var ai = { provider: "anthropic", key: "sk-ant-k", model: "" };
  reply = function () { return json({ content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Hello there." }], stop_reason: "end_turn" }); };
  t.eq(await L.chat(ai, "S", [{ role: "user", text: "hi" }]), "Hello there.", "thinking blocks are left out of the reply");

  reply = function () { return json({ content: [], stop_reason: "refusal" }); };
  var refused = null;
  try { await L.chat(ai, "S", [{ role: "user", text: "hi" }]); } catch (e) { refused = e.message; }
  t.ok(/declined/.test(refused || ""), "a refusal is said plainly, not as an empty reply");

  /* An empty reply says why, and says it was empty: a caller writing a
     conversation into a part counts that as a try instead of asking again
     at every open (integrate.js). */
  var nothing = function (provider, body) {
    reply = function () { return json(body); };
    return L.chat({ provider: provider, key: "k", model: "" }, "S", [{ role: "user", text: "hi" }])
      .then(function () { return null; }, function (e) { return e; });
  };
  var e1 = await nothing("free", { choices: [{ message: { role: "assistant", content: "" }, finish_reason: "length" }] });
  t.eq([e1 && e1.message, e1 && e1.empty], ["Free AI returned an empty reply (length).", true],
    "a chat-completions reply with no text names the reason it stopped");
  var e2 = await nothing("anthropic", { content: [{ type: "thinking", thinking: "" }], stop_reason: "max_tokens" });
  t.eq([e2 && e2.message, e2 && e2.empty], ["Anthropic returned an empty reply (max_tokens).", true],
    "so does a Claude reply that thought until it ran out of room");
  var e3 = await nothing("gemini", { promptFeedback: { blockReason: "SAFETY" } });
  t.eq(e3 && e3.message, "Gemini returned an empty reply (SAFETY).", "and a Gemini prompt it blocked");
  t.ok((await nothing("anthropic", { content: [], stop_reason: "refusal" })).empty, "a refusal also counts as nothing written");
  reply = function () { return json({ choices: [{ message: { content: [{ type: "text", text: "In " }, { type: "text", text: "parts." }] } }] }); };
  t.eq(await L.chat({ provider: "openai", key: "k", model: "" }, "S", []), "In parts.", "text sent as a list of parts is read whole");

  reply = function () { return json({ error: { message: "invalid x-api-key" } }, 401); };
  var bad = null;
  try { await L.chat(ai, "S", [{ role: "user", text: "hi" }]); } catch (e) { bad = e.message; }
  t.ok(/rejected/.test(bad) && /invalid x-api-key/.test(bad), "a rejected key carries the provider's own words");

  var tries = [];
  reply = function (url, opts) {
    var b = JSON.parse(opts.body);
    tries.push(!!b.fallbacks);
    if (b.fallbacks) return Promise.resolve({ ok: false, status: 400, clone: function () { return { text: function () { return Promise.resolve('{"error":{"message":"fallbacks: not available"}}'); } }; },
      text: function () { return Promise.resolve(""); } });
    return json({ content: [{ type: "text", text: "Still here." }] });
  };
  t.eq(await L.chat(ai, "S", [{ role: "user", text: "hi" }]), "Still here.", "an account that refuses the fallback option still gets its session");
  t.eq(tries, [true, false], "by asking once more without it");

  /* ---- streaming ---- */
  var seen = [];
  reply = function () {
    return Promise.resolve(sse(
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm"}}\n\n' +
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hel"}}\n\n' +
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"lo."}}\n\n' +
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n'));
  };
  t.eq(await L.chatStream(ai, "S", [{ role: "user", text: "hi" }], function (x) { seen.push(x); }), "Hello.", "a streamed Claude reply is assembled");
  t.eq(seen, ["Hel", "Hello."], "with the text so far reported as it comes, and no thinking in it");

  seen = [];
  reply = function () {
    return Promise.resolve(sse(': OPENROUTER PROCESSING\n\n' +
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":" you"}}]}\n\ndata: [DONE]\n\n'));
  };
  t.eq(await L.chatStream({ provider: "openrouter", key: "sk-or-k", model: "" }, "S", [], function (x) { seen.push(x); }), "Hi you",
    "an OpenRouter stream is read, keepalives skipped");

  calls = [];
  reply = function (url, opts) {
    return JSON.parse(opts.body).stream ? Promise.reject(new Error("network")) : json({ content: [{ type: "text", text: "Plain." }] });
  };
  t.eq(await L.chatStream(ai, "S", [], function () {}), "Plain.", "a stream that fails falls back to a plain call");

  /* ---- the free AI (api/free-ai.js) ---- */
  var free = { provider: "free", key: "session-token", model: "" };
  var f = L._request(free, "SYSTEM", [{ role: "user", text: "hi" }], true);
  t.eq([f.url, f.headers.Authorization], ["/api/free-ai", "Bearer session-token"],
    "the free AI goes through the app's own server, on the person's session");
  t.eq(f.body, { system: "SYSTEM", messages: [{ role: "user", text: "hi" }], stream: true },
    "carrying only the session's words - the model is the server's choice");
  t.eq(L.label(free), "Inner Table’s free AI", "and it is named as the app's own");

  calls = [];
  var limitWords = "That's today's free AI used up (200 messages). It comes back tomorrow.";
  reply = function () { return json({ error: { message: limitWords, code: "daily_limit" } }, 429); };
  var lim = null;
  try { await L.chat(free, "S", [{ role: "user", text: "hi" }]); } catch (e) { lim = e.message; }
  t.eq(lim, limitWords, "the free AI's own words reach the person as they are");
  t.eq(calls.length, 1, "and the day's allowance is not retried seconds later");

  /* Its server has already tried every model it routes to, so the app does
     not retry blind: it waits as long as the server says a model needs, once,
     and takes a final answer as final. */
  var tick = async function (ms) { for (var i = 0; i < 6; i++) { await flush(); env.clock.tick(ms); } };
  var busyThen = function (wait, then) {
    var n = 0;
    return function (url, opts) {
      n++;
      if (n === 1) return json({ error: { message: "Every free model is at its limit right now.", code: "busy", retry_after: wait } }, 503);
      return then(url, opts);
    };
  };
  calls = [];
  reply = busyThen(3, function () { return json({ choices: [{ message: { content: "Room now." } }] }); });
  var waiting = L.chat(free, "S", [{ role: "user", text: "hi" }]);
  await flush(); await flush();
  env.clock.tick(2900);
  await flush();
  t.eq(calls.length, 1, "busy: the free AI is not asked again before the wait its server named");
  await tick(200);
  t.eq(await waiting, "Room now.", "...and once it has passed, the one more try gets the reply");
  t.eq(calls.length, 2, "...one more, not two");

  calls = [];
  reply = function () { return json({ error: { message: "Every free model is at its limit right now. Try again in about 300 seconds.", code: "busy", retry_after: 300 } }, 503); };
  var longWait = null;
  try { await L.chat(free, "S", []); } catch (e) { longWait = e; }
  t.eq([calls.length, /300 seconds/.test(longWait.message)], [1, true], "a wait of minutes is said, not sat through");

  calls = [];
  reply = function () { return json({ error: { message: "This session is too long for every model the free AI can use.", code: "too_long" } }, 400); };
  var tooLong = null;
  try { await L.chatStream(free, "S", [], function () {}); } catch (e) { tooLong = e; }
  t.eq([calls.length, /too long/.test(tooLong && tooLong.message)], [1, true],
    "a stream turned down for good is not asked again the plain way - the same answer would come back");

  calls = [];
  reply = busyThen(2, function () { return json({ choices: [{ message: { content: "Plain, later." } }] }); });
  var streamed = L.chatStream(free, "S", [], function () {});
  await tick(1000);
  t.eq(await streamed, "Plain, later.", "a busy stream waits as long as it was told, then asks the plain way");
  t.eq([calls.length, JSON.parse(calls[0].opts.body).stream, JSON.parse(calls[1].opts.body).stream], [2, true, false], "...once");

  t.eq(L._request(free, "S", [], false, false, { json: true }).body.json, true, "a write-in asks the free AI's server for JSON");
  t.ok(!("json" in L._request({ provider: "openai", key: "k", model: "" }, "S", [], false, false, { json: true }).body),
    "...which is the free AI's own word; a provider's API is not sent it");

  seen = [];
  reply = function () {
    return Promise.resolve(sse('data: {"choices":[{"delta":{"content":"Free"}}]}\n\ndata: {"choices":[{"delta":{"content":" words"}}]}\n\ndata: [DONE]\n\n'));
  };
  t.eq(await L.chatStream(free, "S", [], function (x) { seen.push(x); }), "Free words", "a free AI stream is read like any chat-completions one");

  var none = { provider: "", key: "", model: "", at: "" };
  var own = { provider: "anthropic", key: "sk-ant-k", model: "", at: "" };
  var offers = function (answer, storage) {
    var extra = { fetch: function (url) {
      if (String(url) !== "/api/free-ai") return Promise.reject(new Error("unexpected " + url));
      return answer === "offline" ? Promise.reject(new Error("offline")) : json({ available: answer, daily: 200 });
    } };
    if (storage) extra.localStorage = storage;
    return H.load(["schema", "auth", "llm"], extra);
  };
  var fe = offers(true);
  t.eq(fe.IFS.llm.active(none), none, "nothing is offered before the server says so");
  t.eq(await fe.IFS.llm.checkFree(), true, "the server says this deployment runs a free AI");
  t.eq(fe.IFS.llm.active(none), none, "but it is only for someone signed in");
  fe.storage.setItem("innertable.session", JSON.stringify({ token: "tok-ann", username: "ann", exp: Date.now() + 60000 }));
  t.eq(fe.IFS.llm.active(none), { provider: "free", key: "tok-ann", model: "" }, "signed in, it is the connection, on their own session");
  t.ok(fe.IFS.llm.configured(fe.IFS.llm.active(none)), "and counts as connected");
  t.eq(fe.IFS.llm.active(own), own, "their own AI always comes first");
  t.eq(await fe.IFS.llm.checkFree(), false, "asking again with the same answer changes nothing");

  var reopened = offers("offline", fe.storage);
  t.ok(reopened.IFS.llm.freeReady(), "the answer is remembered, so the next open knows at once");
  t.eq(await reopened.IFS.llm.checkFree(), false, "and keeps it when the server can't be reached");
  t.ok(reopened.IFS.llm.freeReady(), "still offered offline");
  var switchedOff = offers(false, fe.storage);
  t.eq(await switchedOff.IFS.llm.checkFree(), true, "switched off on the server");
  t.eq(switchedOff.IFS.llm.active(none), none, "it is no longer offered");

  /* ---- keys from before settings.ai are carried over once ---- */
  var st = H.load(["schema", "markdown", "store"]);
  st.storage.setItem("innertable.v1", JSON.stringify({ parts: {}, settings: {
    provider: "openai", openaiKey: "sk-old", openaiModel: "gpt-5.1", anthropicKey: "sk-ant-also" } }));
  st.IFS.store.load(null);
  t.eq(st.IFS.store.state.settings.ai, { provider: "openai", key: "sk-old", model: "", at: "" },
    "the key in use becomes the connection; an old default model gives way to the current one");
  var st2 = H.load(["schema", "markdown", "store"]);
  st2.storage.setItem("innertable.v1", JSON.stringify({ parts: {}, settings: {
    provider: "anthropic", anthropicKey: "sk-ant-x", anthropicModel: "claude-opus-5-5",
    ai: { provider: "", key: "", model: "", at: "2026-10-01T00:00:00Z" } } }));
  st2.IFS.store.load(null);
  t.eq(st2.IFS.store.state.settings.ai.key, "", "a deliberate disconnect is not undone by an old key still lying around");

  /* ---- the connection follows the account ---- */
  function synced(remote) {
    var sent = [];
    var e = H.load(["schema", "markdown", "store", "auth", "sync"], {
      fetch: function (url, opts) {
        if (opts && opts.method === "POST") { sent.push(JSON.parse(opts.body)); return json({ ok: true }); }
        return json({ ai: remote });
      }
    });
    e.IFS.store.load();
    e.storage.setItem("innertable.session", JSON.stringify({ token: "t", username: "alice", exp: Date.now() + 60000 }));
    return { env: e, sent: sent, ai: function () { return e.IFS.store.state.settings.ai; } };
  }
  var s1 = synced({ provider: "openrouter", key: "sk-or-new", model: "anthropic/claude-sonnet-5.5", at: "2026-10-09T12:00:00Z" });
  s1.env.IFS.store.state.settings.ai = { provider: "anthropic", key: "sk-ant-old", model: "", at: "2026-10-01T00:00:00Z" };
  t.eq(await s1.env.IFS.sync.syncAi(), true, "a newer connection on the account is taken");
  t.eq(s1.ai().key, "sk-or-new", "and replaces this device's older one");

  var s2 = synced({ provider: "", key: "", model: "", at: "2026-10-09T12:00:00Z" });
  s2.env.IFS.store.state.settings.ai = { provider: "anthropic", key: "sk-ant-old", model: "", at: "2026-10-01T00:00:00Z" };
  await s2.env.IFS.sync.syncAi();
  t.eq(s2.ai().key, "", "a disconnect made on another device reaches this one");

  var s3 = synced(null);
  s3.env.IFS.store.state.settings.ai = { provider: "anthropic", key: "sk-ant-here", model: "", at: "" };
  t.eq(await s3.env.IFS.sync.syncAi(), false, "nothing on the account changes nothing here");
  t.eq(s3.sent.length && s3.sent[0].ai.key, "sk-ant-here", "and a key that was only on this device goes up to the account");
  t.ok(!!s3.ai().at, "stamped with when, so it can be outranked later");

  var s4 = synced(null);
  await s4.env.IFS.sync.setAi({ provider: "gemini", key: "AIza-k", model: "" });
  t.eq([s4.ai().provider, s4.sent[0].ai.key], ["gemini", "AIza-k"], "connecting saves here and on the account at once");
  await flush();
};
