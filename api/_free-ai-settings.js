/* Inner Table - the free AI's settings, checked before anyone's request
   finds out they are wrong.

   Every free-tier fix so far was a setting that did not fit where
   FREELLMAPI_URL pointed - "auto" sent to Groq, Gemini models named on Groq,
   a model list cleared - and each was found only when a person's session
   failed. check(env) reads the same environment api/free-ai.js does and says,
   for each setting that is wrong, what is wrong and what to set instead.
   Plain words, never a raw error, and never a key's value: only whether it
   is there and what it looks like.

   PROVIDERS are the APIs FREELLMAPI_URL can point straight at, known by their
   address: the chat endpoint, whatever path the address was given with; what
   their keys look like; and their free-tier models, the most room first. A
   model one has since retired answers 404 and is passed over. Anything else
   is taken for a FreeLLMAPI gateway. */
"use strict";

var PROVIDERS = [
  { name: "Groq", host: /(^|\.)groq\.com$/i, chat: "https://api.groq.com/openai/v1/chat/completions",
    url: "https://api.groq.com/openai/v1", key: /^gsk_/, keyLooks: "starts with gsk_",
    // each has its own tokens-a-minute allowance: together, several sessions a minute where one takes one
    models: ["meta-llama/llama-4-scout-17b-16e-instruct", "llama-3.3-70b-versatile", "openai/gpt-oss-120b", "openai/gpt-oss-20b"] },
  { name: "Google's Gemini API", host: /^generativelanguage\.googleapis\.com$/i,
    chat: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    url: "https://generativelanguage.googleapis.com/v1beta/openai", key: /^AIza/, keyLooks: "starts with AIza",
    // unpaid, each Gemini model takes about 20 requests a day and each Gemma about 1000
    models: ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemma-4-31b-it", "gemma-4-26b-a4b-it"] }
];

function provider(url) {
  var host;
  try { host = new URL(url).hostname; } catch (e) { return null; }
  for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].host.test(host)) return PROVIDERS[i];
  return null;
}

function models(spec) {
  return String(spec || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
}

function isAuto(m) { return /^auto(:|$)/.test(m); }

/* Which provider's list a model is on, other than `except`. */
function ownerOf(model, except) {
  for (var i = 0; i < PROVIDERS.length; i++) {
    if (PROVIDERS[i] !== except && PROVIDERS[i].models.indexOf(model) >= 0) return PROVIDERS[i];
  }
  return null;
}

/* { on, ok, target, problems: [{ setting, severity, problem, fix }] }.
   severity "error": sessions on the free AI fail until it is fixed.
   "warning": they work, but something is off - a wasted request, a default
   used instead of what was meant. ok is true when there is no error. */
function check(env) {
  env = env || {};
  var problems = [];
  var add = function (setting, severity, problem, fix) {
    problems.push({ setting: setting, severity: severity, problem: problem, fix: fix });
  };
  var url = String(env.FREELLMAPI_URL || "").trim();
  var key = String(env.FREELLMAPI_KEY || "").trim();
  var named = models(env.FREELLMAPI_MODEL);

  if (!url && !key) {
    add("FREELLMAPI_URL", "warning", "is not set, so the free AI is off and sessions give people a prompt to copy instead.",
      "Set FREELLMAPI_URL and FREELLMAPI_KEY to switch it on - see .env.example for each provider.");
    return { on: false, ok: true, target: null, problems: problems };
  }
  if (!url) add("FREELLMAPI_URL", "error", "is not set, though FREELLMAPI_KEY is.",
    "Set it to your gateway's address, " + PROVIDERS.map(function (p) { return p.url + " for " + p.name; }).join(", or ") + ".");
  if (!key) add("FREELLMAPI_KEY", "error", "is not set, so every request to the free AI would be refused.",
    "Set it to the key for the API FREELLMAPI_URL points at.");
  ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "SESSION_SECRET"].forEach(function (k) {
    if (!String(env[k] || "").trim()) add(k, "error", "is not set, and the free AI needs it to know who is signed in and count each day's messages.",
      "Set it as for the rest of the app (see .env.example).");
  });

  var limit = env.FREE_AI_DAILY_LIMIT;
  if (limit !== undefined && String(limit).trim() !== "" && !/^\d+$/.test(String(limit).trim())) {
    add("FREE_AI_DAILY_LIMIT", "warning", "is not a whole number, so the default of 500 messages a day is used instead.",
      "Set a whole number of messages per person per day, 0 for no limit, or leave it unset for 500.");
  }

  if (!url) return { on: false, ok: false, target: null, problems: problems };

  var parsed = null;
  try { parsed = new URL(url); } catch (e) {}
  if (!parsed || !/^https?:$/.test(parsed.protocol)) {
    add("FREELLMAPI_URL", "error", "is not a web address the free AI can call.",
      "Set the full address, starting https:// - your gateway's, or " + PROVIDERS.map(function (p) { return p.url; }).join(" or ") + ".");
    return { on: true, ok: false, target: null, problems: problems };
  }
  if (parsed.protocol === "http:") {
    add("FREELLMAPI_URL", "warning", "starts http://, so FREELLMAPI_KEY and every session travel to it unencrypted.",
      "Use the https:// address of the same gateway.");
  }

  var p = provider(url);
  if (p) {
    if (key && !p.key.test(key)) {
      add("FREELLMAPI_KEY", "warning", "does not look like a key for " + p.name + " (one " + p.keyLooks + "), and FREELLMAPI_URL points at " + p.name + ".",
        "Set the key from " + p.name + ", or point FREELLMAPI_URL at the service this key belongs to.");
    }
    named.forEach(function (m) {
      if (isAuto(m)) {
        add("FREELLMAPI_MODEL", "warning", "names \"" + m + "\", which is a FreeLLMAPI gateway's routing - " + p.name + " has no such model and is never sent it.",
          "Take \"" + m + "\" out. Left unset, FREELLMAPI_MODEL uses " + p.name + "'s own free models.");
        return;
      }
      var other = ownerOf(m, p);
      if (other) {
        add("FREELLMAPI_MODEL", "warning", "names " + m + ", a model on " + other.name + ", but FREELLMAPI_URL points at " + p.name + ", which answers 404 for it.",
          "Take it out, or leave FREELLMAPI_MODEL unset. " + p.name + "'s free models: " + p.models.join(", ") + ".");
      } else if (p.models.indexOf(m) < 0) {
        add("FREELLMAPI_MODEL", "warning", "names " + m + ", which is not one of the " + p.name + " free models Inner Table knows. If " + p.name + " does not have it, every session spends a request finding that out.",
          "Check the name on " + p.name + "'s model list, or use one of: " + p.models.join(", ") + ".");
      }
    });
    return { on: true, ok: !problems.some(isError), target: p.name, problems: problems };
  }

  // a FreeLLMAPI gateway: the address is its base, with or without /v1
  if (/\/chat\/completions\/?$/.test(parsed.pathname)) {
    add("FREELLMAPI_URL", "error", "ends in /chat/completions, and Inner Table adds that itself, so every request would go to the wrong address.",
      "Set the gateway's bare address: " + parsed.origin + ".");
  }
  return { on: true, ok: !problems.some(isError), target: "FreeLLMAPI gateway", problems: problems };
}

function isError(x) { return x.severity === "error"; }

/* One line per problem, for the server log. */
function lines(result) {
  return result.problems.map(function (x) {
    return "free-ai settings: " + x.setting + " " + x.problem + " " + x.fix;
  });
}

/* What one tiny live request said, as plain words. status 0 = not reached. */
function liveSaid(status, text, timedOut) {
  if (timedOut) return { ok: false, said: "did not answer within a few seconds - FREELLMAPI_URL may be wrong, or the service slow." };
  if (status === 0) return { ok: false, said: "could not be reached - check FREELLMAPI_URL." };
  if (status >= 200 && status < 300) return { ok: true, said: "answered." };
  if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid/i.test(text || "")) {
    return { ok: false, said: "turned the key down - check FREELLMAPI_KEY." };
  }
  if (status === 404) return { ok: false, said: "is not a model FREELLMAPI_URL has - take it out of FREELLMAPI_MODEL." };
  if (status === 429 || status === 503) return { ok: true, said: "is at its limit just now, which is not a settings problem." };
  return { ok: false, said: "turned the request down (" + status + ")." };
}

module.exports = { PROVIDERS: PROVIDERS, provider: provider, check: check, lines: lines, liveSaid: liveSaid };
