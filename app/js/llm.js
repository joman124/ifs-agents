/* Inner Table - browser-side LLM clients (bring your own key).
   One connection - { provider, key, model } - held in settings.ai and, for a
   signed-in person, kept with their account (api/ai-key.js) so it follows
   them to every device. Calls go straight from the browser to the provider,
   paid from the person's own account there. Supports Anthropic Claude,
   OpenRouter (any model, one-tap connect), OpenAI ChatGPT and Google Gemini. */
(function () {
  "use strict";

  var NAMES = { anthropic: "Anthropic", openrouter: "OpenRouter", openai: "OpenAI", gemini: "Gemini" };
  var DEFAULT_MODELS = {
    anthropic: "claude-sonnet-5-5",
    openrouter: "anthropic/claude-sonnet-5.5",
    openai: "gpt-5.1",
    gemini: "gemini-2.5-flash"
  };

  /* Which provider a pasted key belongs to, from its shape - so nobody has to
     say. Order matters: Anthropic and OpenRouter keys both start "sk-". */
  function detect(key) {
    var k = String(key || "").trim();
    if (/^sk-ant-/.test(k)) return "anthropic";
    if (/^sk-or-/.test(k)) return "openrouter";
    if (/^AIza/.test(k)) return "gemini";
    if (/^sk-/.test(k)) return "openai";
    return "";
  }

  /* "Claude Sonnet 5.5" from "claude-sonnet-5-5" or "anthropic/claude-sonnet-5.5". */
  function modelName(model) {
    var m = String(model || "").replace(/^[a-z0-9-]+\//, "");
    var c = /^claude-([a-z]+)-(\d+)(?:[-.](\d+))?$/.exec(m);
    if (c) return "Claude " + c[1].charAt(0).toUpperCase() + c[1].slice(1) + " " + c[2] + (c[3] ? "." + c[3] : "");
    var g = /^gpt-(.+)$/.exec(m);
    if (g) return "GPT-" + g[1];
    var gm = /^gemini-(.+)$/.exec(m);
    if (gm) return "Gemini " + gm[1].replace(/-/g, " ");
    return m;
  }

  function label(ai) {
    if (!configured(ai)) return "";
    return modelName(ai.model || DEFAULT_MODELS[ai.provider]) + " via " + (ai.provider === "openrouter" ? "OpenRouter" : "your " + NAMES[ai.provider] + " key");
  }

  function modelOf(ai) { return ai.model || DEFAULT_MODELS[ai.provider]; }

  /* Always carry the provider's own words. A 403 is not always a bad key -
     it is just as often a workspace, region or model permission - and
     answering "check your key" to all of them sends people to the one place
     the problem isn't. */
  function friendly(status, bodyText, provider) {
    var detail = "";
    try {
      var j = JSON.parse(bodyText);
      detail = (j.error && (j.error.message || j.error.status)) || j.message ||
        (j.detail && (j.detail.message || j.detail)) || "";
      if (typeof detail !== "string") detail = "";
    } catch (e) {}
    var said = detail ? " " + provider + " said: " + detail.slice(0, 200) : "";
    if (status === 401) return "The " + provider + " API key was rejected." + (said || " Check it in Settings.");
    if (status === 403) return provider + " refused that request (403)." +
      (said || " The key may be valid but not permitted to use this model - check the key's workspace and model access.");
    if (status === 404) return "That " + provider + " model name wasn't found." + (said || " Check the model in Settings.");
    if (status === 429) return "Rate limit or quota reached on " + provider + "." + (said || " Wait a minute and try again.");
    if (status >= 500) return provider + " is having a moment (server error " + status + ")." + said;
    return provider + " error " + status + (said || ".");
  }

  async function withRetry(fn) {
    var delays = [0, 1500, 4000];
    var lastErr;
    for (var i = 0; i < delays.length; i++) {
      if (delays[i]) await new Promise(function (r) { setTimeout(r, delays[i]); });
      try { return await fn(); }
      catch (e) {
        lastErr = e;
        if (!e.retryable) throw e;
      }
    }
    throw lastErr;
  }

  /* ---------------- request shapes ----------------
     messages: [{role: "user"|"assistant", text}]. Each provider gets one
     builder, shared by the plain and the streaming call, so the two can never
     drift apart. */

  function geminiRequest(ai, system, messages, stream) {
    return {
      url: "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(modelOf(ai)) +
        (stream ? ":streamGenerateContent?alt=sse&key=" : ":generateContent?key=") + encodeURIComponent(ai.key),
      headers: { "Content-Type": "application/json" },
      body: {
        system_instruction: { parts: [{ text: system }] },
        contents: messages.map(function (m) {
          return { role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] };
        }),
        generationConfig: { temperature: 0.8, maxOutputTokens: 16384 }
      }
    };
  }

  /* The system prompt carries the person's whole inner system and is resent
     with every turn, so it is cached: after the first message of a session
     each turn costs a fraction. Current Claude models think adaptively;
     medium effort keeps a phone conversation quick without making the guide
     careless. Where the API offers it, a declined turn is retried on another
     Claude model instead of ending the session. */
  var CURRENT_CLAUDE = /^claude-(opus|sonnet|haiku|fable)-5/;
  var FALLBACK_READY = /^claude-(sonnet-5-5|opus-5-5|opus-5|fable-5-1)$/;

  function anthropicRequest(ai, system, messages, stream, noFallback) {
    var model = modelOf(ai);
    var headers = {
      "Content-Type": "application/json",
      "x-api-key": ai.key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    };
    var body = {
      model: model,
      max_tokens: 16384,
      cache_control: { type: "ephemeral" },
      system: system,
      messages: messages.map(function (m) { return { role: m.role, content: m.text }; })
    };
    if (stream) body.stream = true;
    if (CURRENT_CLAUDE.test(model)) body.output_config = { effort: "medium" };
    if (FALLBACK_READY.test(model) && !noFallback) {
      headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
      body.fallbacks = "default";
    }
    return { url: "https://api.anthropic.com/v1/messages", headers: headers, body: body };
  }

  /* OpenAI and OpenRouter speak the same chat-completions dialect. Through
     OpenRouter a Claude model takes the same cache marker on the system
     prompt that Anthropic's own API does. */
  function chatCompletionsRequest(ai, system, messages, stream) {
    var model = modelOf(ai);
    var router = ai.provider === "openrouter";
    var sys = router && /^anthropic\//.test(model)
      ? { role: "system", content: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] }
      : { role: "system", content: system };
    var body = {
      model: model,
      messages: [sys].concat(messages.map(function (m) { return { role: m.role, content: m.text }; }))
    };
    body[router ? "max_tokens" : "max_completion_tokens"] = 16384;
    if (stream) body.stream = true;
    var headers = { "Content-Type": "application/json", "Authorization": "Bearer " + ai.key };
    if (router) {
      // OpenRouter shows these on the person's own activity page
      headers["HTTP-Referer"] = (typeof location !== "undefined" && location.origin) || "https://ifs-agents.vercel.app";
      headers["X-Title"] = "Inner Table";
    }
    return {
      url: router ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.openai.com/v1/chat/completions",
      headers: headers,
      body: body
    };
  }

  function request(ai, system, messages, stream, noFallback) {
    if (ai.provider === "gemini") return geminiRequest(ai, system, messages, stream);
    if (ai.provider === "anthropic") return anthropicRequest(ai, system, messages, stream, noFallback);
    return chatCompletionsRequest(ai, system, messages, stream);
  }

  /* ---------------- replies ---------------- */

  function replyText(provider, data) {
    if (provider === "gemini") {
      var cand = data.candidates && data.candidates[0];
      var parts = cand && cand.content && cand.content.parts;
      return (parts || []).map(function (p) { return p.text || ""; }).join("");
    }
    if (provider === "anthropic") {
      return (data.content || []).map(function (b) { return b.type === "text" || !b.type ? b.text || "" : ""; }).join("");
    }
    var msg = data.choices && data.choices[0] && data.choices[0].message;
    return (msg && msg.content) || "";
  }

  function emptyReply(provider, data) {
    if (provider === "anthropic" && data && data.stop_reason === "refusal") {
      return new Error("Claude stopped there - it declined to go on with this. Try saying it another way, or close the session.");
    }
    var why = provider === "gemini" && data && data.candidates && data.candidates[0] && data.candidates[0].finishReason;
    return new Error(NAMES[provider] + " returned an empty reply" + (why ? " (" + why + ")" : "") + ".");
  }

  /* Send it; if an account turns down the refusal-fallback option (a 400
     naming it), send it once more without - the session matters more. */
  async function send(ai, system, messages, stream) {
    var req = request(ai, system, messages, stream);
    var res = await fetch(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(req.body) });
    if (res.status === 400 && req.body.fallbacks) {
      var said = "";
      try { said = await res.clone().text(); } catch (e) {}
      if (/fallback/i.test(said)) {
        req = request(ai, system, messages, stream, true);
        res = await fetch(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(req.body) });
      }
    }
    return res;
  }

  async function chat(ai, system, messages) {
    if (!configured(ai)) throw new Error("No AI connected. Connect one in Settings, or use copy-prompt mode.");
    return withRetry(async function () {
      var res = await send(ai, system, messages, false);
      if (!res.ok) {
        var txt = await res.text();
        var err = new Error(friendly(res.status, txt, NAMES[ai.provider]));
        err.retryable = res.status >= 500 || res.status === 429;
        throw err;
      }
      var data = await res.json();
      var text = replyText(ai.provider, data);
      if (!text) throw emptyReply(ai.provider, data);
      return text;
    });
  }

  /* ---------------- streaming ---------------- */

  /* Read an SSE body, calling onData with each parsed JSON "data:" payload.
     Comment lines (OpenRouter's ": OPENROUTER PROCESSING" keepalives) carry
     no "data:" and are skipped. */
  async function readSSE(res, onData) {
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = "";
    for (;;) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      var lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.slice(0, 5) !== "data:") continue;
        var payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        var parsed;
        try { parsed = JSON.parse(payload); } catch (e) { continue; /* partial or keepalive */ }
        onData(parsed);
      }
    }
  }

  /* The text so far from one streamed event, per provider. */
  function deltaText(provider, data) {
    if (provider === "gemini") {
      var parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
      return (parts || []).map(function (p) { return p.text || ""; }).join("");
    }
    if (provider === "anthropic") {
      return data.type === "content_block_delta" && data.delta && data.delta.type !== "thinking_delta" ? data.delta.text || "" : "";
    }
    var delta = data.choices && data.choices[0] && data.choices[0].delta;
    return (delta && delta.content) || "";
  }

  async function stream(ai, system, messages, onDelta) {
    var res = await send(ai, system, messages, true);
    if (!res.ok) throw new Error(friendly(res.status, await res.text(), NAMES[ai.provider]));
    var text = "";
    var stop = null;
    await readSSE(res, function (data) {
      if (data.type === "error" || (data.error && ai.provider !== "anthropic")) {
        var said = data.error && (data.error.message || data.error);
        throw new Error(NAMES[ai.provider] + " stream error" + (typeof said === "string" ? ": " + said.slice(0, 200) : "."));
      }
      if (data.type === "message_delta" && data.delta) stop = data.delta.stop_reason || stop;
      var piece = deltaText(ai.provider, data);
      if (piece) { text += piece; onDelta(text); }
    });
    if (!text) throw emptyReply(ai.provider, { stop_reason: stop });
    return text;
  }

  /* Stream when possible; if the stream setup or transport fails for any
     reason, fall back to the plain call (which has retry-with-backoff). A
     refusal is an answer, not a transport failure, so it is not retried. */
  async function chatStream(ai, system, messages, onDelta) {
    if (!configured(ai)) throw new Error("No AI connected. Connect one in Settings, or use copy-prompt mode.");
    try {
      return await stream(ai, system, messages, onDelta || function () {});
    } catch (e) {
      if (/declined to go on/.test(e.message)) throw e;
      console.warn("stream failed, falling back to plain call:", e.message);
    }
    return chat(ai, system, messages);
  }

  function configured(ai) {
    return !!(ai && NAMES[ai.provider] && ai.key);
  }

  /* One short round trip, so a wrong key is found out at connect time rather
     than halfway through someone's first session. */
  async function test(ai) {
    await chat(ai, "Reply with the single word: ready.", [{ role: "user", text: "ready?" }]);
  }

  window.IFS.llm = {
    chat: chat, chatStream: chatStream, configured: configured, test: test,
    detect: detect, label: label, modelName: modelName, modelOf: modelOf,
    NAMES: NAMES, DEFAULT_MODELS: DEFAULT_MODELS,
    _request: request // for tests
  };
})();
