/* Inner Table - free AI for anyone signed in, so nobody has to bring a key.

   Sessions for someone with no AI account of their own run through a
   FreeLLMAPI gateway (github.com/tashfeenahmed/freellmapi) that whoever runs
   this deployment hosts: one OpenAI-style endpoint in front of many free-tier
   models. The gateway's key lives only here, server-side. The browser holds
   nothing but its signed session, so only accounts on this deployment can use
   it, and each account has a daily allowance so one person cannot spend
   everyone's free quota.

   GET                                    -> { available, daily }
   POST { system, messages, stream, json } -> the gateway's chat-completions
        (signed in; messages are             reply, or its SSE stream passed
         [{ role, text }], as in llm.js;     straight through
         json: answer with one JSON object)

   Which model answers is the server's choice: a client cannot pick one that
   fans out and spends several requests' quota. FREELLMAPI_MODEL is a ladder -
   one model, routing strategy or profile, or several, comma-separated, tried
   in order - and the gateway's own routing ("auto") is always its last rung,
   added when the list does not end in one. The ladder is the point: the
   gateway never moves a pinned model on to a *different* model, only to
   other keys of the same one, so a model too small for a request (413) or at
   its per-minute cap (429) used to fail the person outright - a session's
   prompt carries their whole inner system and runs to thousands of tokens,
   and some free models take only 8000 a minute. Here it is the next rung's
   turn. What a rung said is remembered by this instance for a while - when it
   has room again after a 429, the size it turned down with a 413, that the
   endpoint has no such model (404) - so the next request does not ask it
   again in vain.

   FREELLMAPI_URL can also be a provider's own OpenAI-style API, such as
   Groq's, with FREELLMAPI_MODEL listing its models. That API has no "auto":
   it answers 404, which is remembered like any model it does not have, and
   the last model it does have becomes the rung that is always asked.

   Errors come back as { error: { message, code, retry_after } } in words
   meant for the person, which is the shape llm.js already reads. code is
   busy (try again after retry_after seconds), too_long, daily_limit,
   unavailable (the server's setup) or bad_request. */
"use strict";

var verifySession = require("./sync.js").verifySession;

var DEFAULT_DAILY = 500;          // requests per account per UTC day
var MAX_MESSAGES = 500;
var MAX_CHARS = 600000;           // system prompt + every message, together
var REST_DEFAULT = 20;            // seconds a busy rung rests when it names no time
var REST_MAX = 900;
var ROOM_MS = 6 * 3600 * 1000;    // how long a size a rung turned down is believed
var GONE_MS = 10 * 60 * 1000;     // how long "no such model" (404) is believed

function dailyKey(username, day) { return "innertable:freeai:" + username + ":" + day; }

function config() {
  var url = String(process.env.FREELLMAPI_URL || "").trim();
  var key = String(process.env.FREELLMAPI_KEY || "").trim();
  var limit = parseInt(process.env.FREE_AI_DAILY_LIMIT, 10);
  return {
    url: url,
    key: key,
    ladder: ladder(process.env.FREELLMAPI_MODEL),
    daily: isNaN(limit) || limit < 0 ? DEFAULT_DAILY : limit,   // 0 = no cap
    ready: !!(url && key && process.env.UPSTASH_REDIS_REST_URL &&
      process.env.UPSTASH_REDIS_REST_TOKEN && process.env.SESSION_SECRET)
  };
}

/* "gemini-2.5-flash, auto:smart" -> ["gemini-2.5-flash", "auto:smart"];
   "openai/gpt-oss-20b" -> ["openai/gpt-oss-20b", "auto"]. */
function ladder(spec) {
  var seen = {};
  var rungs = String(spec || "").split(",").map(function (s) { return s.trim(); }).filter(function (s) {
    if (!s || seen[s]) return false;
    seen[s] = 1;
    return true;
  });
  if (!rungs.length || !/^auto(:|$)/.test(rungs[rungs.length - 1])) rungs.push("auto");
  return rungs;
}

/* The gateway's chat endpoint, whether FREELLMAPI_URL was given as the bare
   address or already ending in /v1. */
function endpoint(base) {
  var b = String(base).replace(/\/+$/, "");
  return (/\/v1$/.test(b) ? b : b + "/v1") + "/chat/completions";
}

/* Only a system prompt and plain user/assistant turns, within size. Returns
   { system, messages, stream, json, chars } or { error }. */
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
  return { system: body.system, messages: messages, stream: body.stream === true, json: body.json === true, chars: total };
}

/* Roughly how many tokens a request is. A little over the gateway's own
   count (characters / 4), which under-counts prompts like these - so a rung
   that turned down a size is not asked again with one just under it. */
function tokens(ask) { return Math.ceil((ask.chars + 16 * (ask.messages.length + 1)) / 3.5); }

/* ---------------- what each rung has said ---------------- */

var rest = {};   // rung -> epoch ms it has room again
var room = {};   // rung -> { tokens, until }: the size it turned down, and how long that holds
var gone = {};   // rung -> epoch ms until which the endpoint is believed not to have it

/* Seconds until a busy rung has room again, from whatever it said: a
   Retry-After header, the gateway's retryAtMs, or a provider's own words
   ("Please try again in 14.2s"). 0 when it named no time. */
function retryAfter(headers, text) {
  var s = 0;
  var h = headers && typeof headers.get === "function" ? headers.get("retry-after") : null;
  if (h && /^\d+(\.\d+)?$/.test(String(h).trim())) s = Number(h);
  if (!s) {
    try {
      var at = Number((JSON.parse(text).error || {}).retryAtMs);
      if (at > Date.now()) s = (at - Date.now()) / 1000;
    } catch (e) {}
  }
  if (!s) {
    var m = /try again in\s+(?:(\d+)m)?\s*([\d.]+)\s*(ms|s)\b/i.exec(text || "");
    if (m) s = (Number(m[1] || 0) * 60) + Number(m[2]) / (m[3].toLowerCase() === "ms" ? 1000 : 1);
  }
  return s > 0 ? Math.min(REST_MAX, Math.ceil(s)) : 0;
}

/* The most a rung can take, from a 413: the provider's own "Limit N" when it
   gives one, otherwise a little under what was just sent. */
function learnRoom(rung, text, sent) {
  var m = /\bLimit\s+(\d+)/i.exec(text || "");
  var most = m ? Number(m[1]) : Math.floor(sent * 0.9);
  var cur = room[rung];
  if (!cur || cur.until < Date.now() || most < cur.tokens) room[rung] = { tokens: most, until: Date.now() + ROOM_MS };
}

function usable(rung, need, now) {
  if ((rest[rung] || 0) > now) return false;
  var r = room[rung];
  return !(r && r.until > now && need >= r.tokens * 0.9);
}

/* A reply the model itself got wrong, not the request: Groq's
   tool_use_failed (gpt-oss calling a tool nobody offered) and
   json_validate_failed (JSON mode broken). The model is fine, and the same
   request may well be answered on another try or by another model. */
var GLITCHES = { tool_use_failed: 1, json_validate_failed: 1 };
function glitch(status, text) {
  if (status !== 400) return false;
  try { return !!GLITCHES[(JSON.parse(text).error || {}).code]; } catch (e) { return false; }
}

/* ---------------- talking to the gateway ---------------- */

function fail(res, status, message, code, wait) {
  var error = { message: message };
  if (code) error.code = code;
  if (wait) { error.retry_after = wait; res.setHeader("Retry-After", String(wait)); }
  res.status(status).json({ error: error });
}

/* What the gateway said, as words for the person. 401 is never passed on:
   to the app it means "sign in again", and here it would mean the server's
   own key is wrong. */
function upstreamError(status, bodyText, wait) {
  var said = "";
  try {
    var j = JSON.parse(bodyText);
    said = (j.error && (j.error.message || j.error)) || j.message || "";
    if (typeof said !== "string") said = "";
  } catch (e) {}
  if (glitch(status, bodyText)) return { status: 502, code: "upstream", message: "The free AI could not answer just now. Try again in a moment." };
  if (status === 400) return { status: 400, code: "bad_request", message: "The free AI could not take that request." + (said ? " It said: " + said.slice(0, 200) : "") };
  if (status === 413) return { status: 400, code: "too_long", message: "This session is too long for every model the free AI can use. Start a new one, or hold this one in another AI chat." };
  if (status === 401 || status === 403 || status === 404) {
    return { status: 502, code: "unavailable", message: "The free AI is not set up right on the server - its gateway turned the request down (" + status + ")." };
  }
  // 429: every model at its cap; 503: none with room (or none set up) just now
  if (status === 429 || status === 503) {
    return { status: 503, code: "busy", wait: wait,
      message: "Every free model is at its limit right now. Try again " + (wait ? "in about " + wait + " seconds." : "in a minute.") };
  }
  return { status: 502, code: "upstream", message: "The free AI could not answer just now (" + status + "). Try again in a minute." };
}

/* Down the ladder until a rung answers. A rung that is resting, or that
   turned down a request this size, is passed over - except the last, the
   gateway's own routing, which is always asked: it knows the models better
   than this instance's memory does. A rung the endpoint said it does not
   have is passed over even as the last, and the last one it does have is
   always asked instead. A key the gateway refuses stops the climb, since no
   rung will do better. What the person is told comes from the most useful
   failure: busy, then too big, then anything else, and "no such model" only
   when that is all there was - so a provider's 404 for "auto" never hides
   what a real model said. Resolves to { upstream, rung, passed } or
   { failed: { status, text }, wait }. */
async function climb(cfg, ask, rungs) {
  var need = tokens(ask);
  var passed = [];
  var busy = null, tooBig = null, other = null, missing = null, wait = 0;
  var last = rungs.length - 1;
  while (last >= 0 && (gone[rungs[last]] || 0) > Date.now()) last--;
  for (var i = 0; i < rungs.length; i++) {
    var rung = rungs[i];
    var now = Date.now();
    if ((gone[rung] || 0) > now) { passed.push(rung + " (not found)"); missing = missing || { status: 404, text: "" }; continue; }
    if (i < last && !usable(rung, need, now)) { passed.push(rung + " (resting)"); continue; }
    var payload = {
      model: rung,
      messages: [{ role: "system", content: ask.system }].concat(ask.messages),
      stream: ask.stream
    };
    if (ask.json) payload.response_format = { type: "json_object" };
    var r;
    try {
      r = await fetch(endpoint(cfg.url), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.key },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      rest[rung] = now + 15000;
      other = { status: 0, text: String(e && e.message || e) };
      passed.push(rung + " (unreachable)");
      continue;
    }
    if (r.ok) return { upstream: r, rung: rung, passed: passed };

    var text = "";
    try { text = await r.text(); } catch (e) {}
    // the gateway's own reason, for whoever runs the deployment (the person gets plainer words)
    console.warn("free-ai: gateway answered " + r.status + " for " + rung + ": " + text.slice(0, 300));
    passed.push(rung + " (" + r.status + ")");
    if (r.status === 401 || r.status === 403) return { failed: { status: r.status, text: text } };
    if (r.status === 413) { learnRoom(rung, text, need); tooBig = { status: 413, text: text }; continue; }
    if (r.status === 429 || r.status === 503) {
      var w = retryAfter(r.headers, text);
      rest[rung] = now + (w || REST_DEFAULT) * 1000;
      if (w && (!wait || w < wait)) wait = w;
      busy = { status: r.status, text: text };
      continue;
    }
    // a model id the endpoint does not know is not going to start working soon
    if (r.status === 404) {
      gone[rung] = now + GONE_MS;
      missing = { status: 404, text: text };
      if (/^auto(:|$)/.test(rung)) console.warn("free-ai: FREELLMAPI_URL has no \"" + rung + "\", so it is not a FreeLLMAPI gateway - FREELLMAPI_MODEL should list the models it does have");
      continue;
    }
    if (!glitch(r.status, text)) rest[rung] = now + 15000;
    other = { status: r.status, text: text };
  }
  // busy beats too big: a bigger model exists, and will have room again
  return { failed: busy || tooBig || other || missing || { status: 0, text: "" }, wait: busy ? wait : 0 };
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
  if (!cfg.ready) { fail(res, 503, "The free AI is not switched on for this app.", "unavailable"); return; }

  var auth = req.headers.authorization || "";
  var session = verifySession(auth.indexOf("Bearer ") === 0 ? auth.slice(7) : "", process.env.SESSION_SECRET);
  if (!session) { fail(res, 401, "Sign in again to use the free AI."); return; }

  var ask = cleanAsk(req.body);
  if (ask.error) { fail(res, 400, ask.error, "bad_request"); return; }

  var base = process.env.UPSTASH_REDIS_REST_URL;
  var token = process.env.UPSTASH_REDIS_REST_TOKEN;
  var command = async function (args) {
    var r = await fetch(base, { method: "POST", headers: { Authorization: "Bearer " + token }, body: JSON.stringify(args) });
    if (!r.ok) throw new Error("Upstash request failed");
    return (await r.json()).result;
  };

  /* Count first, so two requests at once cannot both slip under the cap;
     a request no rung answers is handed back. However many rungs it took,
     it is one message. */
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
      fail(res, 502, "Could not reach your account just now. Try again in a minute.", "upstream");
      return;
    }
  }
  var refund = function () {
    if (counted) return command(["DECR", counted]).catch(function () {});
  };

  var got = await climb(cfg, ask, cfg.ladder);
  if (!got.upstream) {
    await refund();
    if (!got.failed.status) { fail(res, 502, "Could not reach the free AI just now. Try again in a minute.", "upstream"); return; }
    var err = upstreamError(got.failed.status, got.failed.text, got.wait);
    fail(res, err.status, err.message, err.code, err.wait);
    return;
  }
  if (got.passed.length) {
    var via = got.upstream.headers && typeof got.upstream.headers.get === "function" ? got.upstream.headers.get("x-routed-via") : "";
    console.warn("free-ai: answered on " + got.rung + (via ? " (" + via + ")" : "") + " after passing over " + got.passed.join(", "));
  }

  if (ask.stream && got.upstream.body) { await pipe(got.upstream, res); return; }

  var data;
  try { data = await got.upstream.json(); } catch (e) {
    await refund();
    fail(res, 502, "The free AI sent back something unreadable. Try again in a minute.", "upstream");
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(data);
};

module.exports._internal = {
  endpoint: endpoint, cleanAsk: cleanAsk, upstreamError: upstreamError, ladder: ladder, retryAfter: retryAfter, tokens: tokens,
  forget: function () { rest = {}; room = {}; gone = {}; }
};
