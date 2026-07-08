/* Inner Table - browser-side LLM clients (bring your own key).
   Keys live in localStorage on this device only; calls go straight from the
   browser to the provider. Supports Google Gemini, Anthropic Claude, and
   OpenAI ChatGPT. */
(function () {
  "use strict";

  function friendly(status, bodyText, provider) {
    if (status === 401 || status === 403) return "The " + provider + " API key was rejected. Check it in Settings.";
    if (status === 404) return "That " + provider + " model name wasn't found. Check the model in Settings.";
    if (status === 429) return "Rate limit or quota reached on " + provider + ". Wait a minute and try again.";
    if (status >= 500) return provider + " is having a moment (server error " + status + "). Try again shortly.";
    var detail = "";
    try { detail = JSON.parse(bodyText).error.message || ""; } catch (e) {}
    return provider + " error " + status + (detail ? ": " + detail.slice(0, 200) : ".");
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

  /* messages: [{role: "user"|"assistant", text}] */
  async function callGemini(settings, system, messages) {
    var url = "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(settings.geminiModel) + ":generateContent?key=" +
      encodeURIComponent(settings.geminiKey);
    var body = {
      system_instruction: { parts: [{ text: system }] },
      contents: messages.map(function (m) {
        return { role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] };
      }),
      generationConfig: { temperature: 0.8, maxOutputTokens: 16384 }
    };
    return withRetry(async function () {
      var res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        var txt = await res.text();
        var err = new Error(friendly(res.status, txt, "Gemini"));
        err.retryable = res.status >= 500 || res.status === 429;
        throw err;
      }
      var data = await res.json();
      var cand = data.candidates && data.candidates[0];
      var parts = cand && cand.content && cand.content.parts;
      var text = (parts || []).map(function (p) { return p.text || ""; }).join("");
      if (!text) throw new Error("Gemini returned an empty reply" + (cand && cand.finishReason ? " (" + cand.finishReason + ")" : "") + ".");
      return text;
    });
  }

  async function callAnthropic(settings, system, messages) {
    var body = {
      model: settings.anthropicModel,
      max_tokens: 16384,
      system: system,
      messages: messages.map(function (m) { return { role: m.role, content: m.text }; })
    };
    return withRetry(async function () {
      var res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": settings.anthropicKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        var txt = await res.text();
        var err = new Error(friendly(res.status, txt, "Anthropic"));
        err.retryable = res.status >= 500 || res.status === 429;
        throw err;
      }
      var data = await res.json();
      var text = (data.content || []).map(function (b) { return b.text || ""; }).join("");
      if (!text) throw new Error("Anthropic returned an empty reply.");
      return text;
    });
  }

  async function callOpenAI(settings, system, messages) {
    var body = {
      model: settings.openaiModel,
      max_completion_tokens: 16384,
      messages: [{ role: "system", content: system }].concat(
        messages.map(function (m) { return { role: m.role, content: m.text }; }))
    };
    return withRetry(async function () {
      var res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + settings.openaiKey
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        var txt = await res.text();
        var err = new Error(friendly(res.status, txt, "OpenAI"));
        err.retryable = res.status >= 500 || res.status === 429;
        throw err;
      }
      var data = await res.json();
      var msg = data.choices && data.choices[0] && data.choices[0].message;
      var text = (msg && msg.content) || "";
      if (!text) throw new Error("OpenAI returned an empty reply.");
      return text;
    });
  }

  function configured(settings) {
    if (settings.provider === "gemini") return !!settings.geminiKey;
    if (settings.provider === "anthropic") return !!settings.anthropicKey;
    if (settings.provider === "openai") return !!settings.openaiKey;
    return false;
  }

  async function chat(settings, system, messages) {
    if (settings.provider === "gemini") return callGemini(settings, system, messages);
    if (settings.provider === "anthropic") return callAnthropic(settings, system, messages);
    if (settings.provider === "openai") return callOpenAI(settings, system, messages);
    throw new Error("No AI provider configured. Set one up in Settings, or use copy-prompt mode.");
  }

  /* ---------------- streaming ---------------- */

  /* Read an SSE body, calling onData with each parsed JSON "data:" payload. */
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
        try { onData(JSON.parse(payload)); } catch (e) { /* partial or keepalive */ }
      }
    }
  }

  async function streamGemini(settings, system, messages, onDelta) {
    var url = "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(settings.geminiModel) + ":streamGenerateContent?alt=sse&key=" +
      encodeURIComponent(settings.geminiKey);
    var body = {
      system_instruction: { parts: [{ text: system }] },
      contents: messages.map(function (m) {
        return { role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] };
      }),
      generationConfig: { temperature: 0.8, maxOutputTokens: 16384 }
    };
    var res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(friendly(res.status, await res.text(), "Gemini"));
    var text = "";
    await readSSE(res, function (data) {
      var parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
      (parts || []).forEach(function (p) { if (p.text) { text += p.text; onDelta(text); } });
    });
    if (!text) throw new Error("Gemini returned an empty reply.");
    return text;
  }

  async function streamAnthropic(settings, system, messages, onDelta) {
    var body = {
      model: settings.anthropicModel,
      max_tokens: 16384,
      stream: true,
      system: system,
      messages: messages.map(function (m) { return { role: m.role, content: m.text }; })
    };
    var res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": settings.anthropicKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(friendly(res.status, await res.text(), "Anthropic"));
    var text = "";
    await readSSE(res, function (data) {
      if (data.type === "content_block_delta" && data.delta && data.delta.text) {
        text += data.delta.text;
        onDelta(text);
      }
      if (data.type === "error") throw new Error("Anthropic stream error.");
    });
    if (!text) throw new Error("Anthropic returned an empty reply.");
    return text;
  }

  async function streamOpenAI(settings, system, messages, onDelta) {
    var body = {
      model: settings.openaiModel,
      max_completion_tokens: 16384,
      stream: true,
      messages: [{ role: "system", content: system }].concat(
        messages.map(function (m) { return { role: m.role, content: m.text }; }))
    };
    var res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + settings.openaiKey
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(friendly(res.status, await res.text(), "OpenAI"));
    var text = "";
    await readSSE(res, function (data) {
      var delta = data.choices && data.choices[0] && data.choices[0].delta;
      if (delta && delta.content) { text += delta.content; onDelta(text); }
    });
    if (!text) throw new Error("OpenAI returned an empty reply.");
    return text;
  }

  /* Stream when possible; if the stream setup or transport fails for any
     reason, fall back to the plain call (which has retry-with-backoff). */
  async function chatStream(settings, system, messages, onDelta) {
    try {
      if (settings.provider === "gemini") return await streamGemini(settings, system, messages, onDelta || function () {});
      if (settings.provider === "anthropic") return await streamAnthropic(settings, system, messages, onDelta || function () {});
      if (settings.provider === "openai") return await streamOpenAI(settings, system, messages, onDelta || function () {});
    } catch (e) {
      console.warn("stream failed, falling back to plain call:", e.message);
    }
    return chat(settings, system, messages);
  }

  window.IFS.llm = { chat: chat, chatStream: chatStream, configured: configured };
})();
