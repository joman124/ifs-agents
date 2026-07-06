/* Inner Table - browser-side LLM clients (bring your own key).
   Keys live in localStorage on this device only; calls go straight from the
   browser to the provider. Supports Google Gemini and Anthropic Claude. */
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
      generationConfig: { temperature: 0.8, maxOutputTokens: 8192 }
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
      max_tokens: 8192,
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

  function configured(settings) {
    if (settings.provider === "gemini") return !!settings.geminiKey;
    if (settings.provider === "anthropic") return !!settings.anthropicKey;
    return false;
  }

  async function chat(settings, system, messages) {
    if (settings.provider === "gemini") return callGemini(settings, system, messages);
    if (settings.provider === "anthropic") return callAnthropic(settings, system, messages);
    throw new Error("No AI provider configured. Set one up in Settings, or use copy-prompt mode.");
  }

  window.IFS.llm = { chat: chat, configured: configured };
})();
