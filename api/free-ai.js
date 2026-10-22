/* Inner Table - free AI for anyone signed in, so nobody has to bring a key.

   Sessions for someone with no AI account of their own run through a
   FreeLLMAPI gateway (github.com/tashfeenahmed/freellmapi) that whoever runs
   this deployment hosts: one OpenAI-style endpoint that hands each request to
   whichever free-tier model still has room. The gateway's key lives only
   here, server-side. The browser holds nothing but its signed session, so
   only accounts on this deployment can use it, and each account has a daily
   allowance so one person cannot spend everyone's free quota.

   GET                                    -> { available, daily }
   POST { system, messages, stream }      -> the gateway's chat-completions
        (signed in; messages are             reply, or its SSE stream passed
         [{ role, text }], as in llm.js)     straight through

   The model is the server's choice (FREELLMAPI_MODEL, "auto" by default):
   a client cannot pick one that fans out and spends several requests' quota.
   Errors come back as { error: { message } } in words meant for the person,
   which is the shape llm.js already reads. */
"use strict";

var verifySession = require("./sync.js").verifySession;

var DEFAULT_DAILY = 200;          // requests per account per UTC day
var MAX_MESSAGES = 500;
var MAX_CHARS = 600000;           // system prompt + every message, together

function dailyKey(username, day) { return "innertable:freeai:" + username + ":" + day; }

function config() {
  var url = String(process.env.FREELLMAPI_URL || "").trim();
  var key = String(process.env.FREELLMAPI_KEY || "").trim();
  var limit = parseInt(process.env.FREE_AI_DAILY_LIMIT, 10);
  return {
    url: url,
    key: key,
    model: String(process.env.FREELLMAPI_MODEL || "").trim() || "auto",
    daily: isNaN(limit) || limit < 0 ? DEFAULT_DAILY : limit,   // 0 = no cap
    ready: !!(url && key && process.env.UPSTASH_REDIS_REST_URL &&
      process.env.UPSTASH_REDIS_REST_TOKEN && process.env.SESSION_SECRET)
  };
}

/* The gateway's chat endpoint, whether FREELLMAPI_URL was given as the bare
   address or already ending in /v1. */
function endpoint(base) {
  var b = String(base).replace(/\/+$/, "");
  return (/\/v1$/.test(b) ? b : b + "/v1") + "/chat/completions";
}

/* Only a system prompt and plain user/assistant turns, within size. Returns
   { system, messages, stream } or { error }. */
function cleanAsk(body) {
  body = body || {};
  if (typeof body.system !== "string" || !Array.isArray(body.messages)) return { error: "That request could not be read." };
  if (body.messages.length > MAX_MESSAGES) return { error: "This session is too long for the free AI. Start a new one." };
  var total = body.system.length;
  var messages = [];
  for (var i = 0; i < body.messages.length; i++) {
    var m = body.messages[i] || {};
    if ((m.role !== "user" && m.role !== "assistant") || typeof m.text !== "string") return { error: "That request could not be read." };
    total += m.text.length;
    messages.push({ role: m.role, content: m.text });
  }
  if (total > MAX_CHARS) return { error: "This session is too long for the free AI. Start a new one." };
  return { system: body.system, messages: messages, stream: body.stream === true };
}

function fail(res, status, message, code) {
  var error = { message: message };
  if (code) error.code = code;
  res.status(status).json({ error: error });
}

/* What the gateway said, as words for the person. 401 is never passed on:
   to the app it means "sign in again", and here it would mean the server's
   own key is wrong. */
function upstreamError(status, bodyText) {
  var said = "";
  try {
    var j = JSON.parse(bodyText);
    said = (j.error && (j.error.message || j.error)) || j.message || "";
    if (typeof said !== "string") said = "";
  } catch (e) {}
  if (status === 400) return { status: 400, message: "The free AI could not take that request." + (said ? " It said: " + said.slice(0, 200) : "") };
  if (status === 413) return { status: 400, message: "This session is too long for the free AI's models. Start a new one." };
  if (status === 401 || status === 403 || status === 404) {
    return { status: 502, message: "The free AI is not set up right on the server - its gateway turned the request down (" + status + ")." };
  }
  // 429: every free model at its cap; 503: none with room (or none set up) just now
  if (status === 429 || status === 503) {
    return { status: 503, message: "Every free model is at its limit right now. Try again in a few minutes." };
  }
  return { status: 502, message: "The free AI could not answer just now (" + status + "). Try again in a minute." };
}

/* Pass the gateway's SSE stream on as it arrives. If the person leaves, stop
   reading; if the gateway drops mid-reply, say so in the stream's own terms
   so llm.js falls back to a plain call. */
async function pipe(upstream, res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");
  var reader = upstream.body.getReader();
  var gone = false;
  if (res.on) res.on("close", function () {
    if (res.writableEnded) return;
    gone = true;
    reader.cancel().catch(function () {});
  });
  try {
    for (;;) {
      var chunk = await reader.read();
      if (chunk.done || gone) break;
      res.write(Buffer.from(chunk.value));
    }
  } catch (e) {
    if (!gone) res.write('data: {"error":{"message":"The free AI stopped mid-reply."}}\n\n');
  }
  res.end();
}

module.exports = async function handler(req, res) {
  var cfg = config();

  if (req.method === "GET") {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ available: cfg.ready, daily: cfg.ready ? cfg.daily : 0 });
    return;
  }
  if (req.method !== "POST") { fail(res, 405, "Method not allowed"); return; }
  if (!cfg.ready) { fail(res, 503, "The free AI is not switched on for this app."); return; }

  var auth = req.headers.authorization || "";
  var session = verifySession(auth.indexOf("Bearer ") === 0 ? auth.slice(7) : "", process.env.SESSION_SECRET);
  if (!session) { fail(res, 401, "Sign in again to use the free AI."); return; }

  var ask = cleanAsk(req.body);
  if (ask.error) { fail(res, 400, ask.error); return; }

  var base = process.env.UPSTASH_REDIS_REST_URL;
  var token = process.env.UPSTASH_REDIS_REST_TOKEN;
  var command = async function (args) {
    var r = await fetch(base, { method: "POST", headers: { Authorization: "Bearer " + token }, body: JSON.stringify(args) });
    if (!r.ok) throw new Error("Upstash request failed");
    return (await r.json()).result;
  };

  /* Count first, so two requests at once cannot both slip under the cap;
     a request the gateway fails on is handed back. */
  var counted = null;
  if (cfg.daily) {
    counted = dailyKey(session.u, new Date().toISOString().slice(0, 10));
    try {
      var used = await command(["INCR", counted]);
      if (used === 1) await command(["EXPIRE", counted, "172800"]);
      if (used > cfg.daily) {
        await command(["DECR", counted]).catch(function () {});
        fail(res, 429, "That's today's free AI used up (" + cfg.daily + (cfg.daily === 1 ? " message" : " messages") + "). " +
          "It comes back tomorrow.", "daily_limit");
        return;
      }
    } catch (e) {
      fail(res, 502, "Could not reach your account just now. Try again in a minute.");
      return;
    }
  }
  var refund = function () {
    if (counted) return command(["DECR", counted]).catch(function () {});
  };

  var upstream;
  try {
    upstream = await fetch(endpoint(cfg.url), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.key },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: "system", content: ask.system }].concat(ask.messages),
        stream: ask.stream
      })
    });
  } catch (e) {
    await refund();
    fail(res, 502, "Could not reach the free AI just now. Try again in a minute.");
    return;
  }

  if (!upstream.ok) {
    var text = "";
    try { text = await upstream.text(); } catch (e) {}
    await refund();
    // the gateway's own reason, for whoever runs the deployment (the person gets plainer words)
    console.warn("free-ai: gateway answered " + upstream.status + ": " + text.slice(0, 300));
    var err = upstreamError(upstream.status, text);
    fail(res, err.status, err.message);
    return;
  }

  if (ask.stream && upstream.body) { await pipe(upstream, res); return; }

  var data;
  try { data = await upstream.json(); } catch (e) {
    await refund();
    fail(res, 502, "The free AI sent back something unreadable. Try again in a minute.");
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(data);
};

module.exports._internal = { endpoint: endpoint, cleanAsk: cleanAsk, upstreamError: upstreamError };
