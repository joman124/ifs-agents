/* Inner Table - UI: the private link to an AI app, for people who made one.

   Sessions now run on the app's free AI, so linking an AI app is no longer
   offered. People who linked Claude, ChatGPT or Gemini before that keep
   their link (api/bridge.js): ui.js linkedSession still hands their sessions
   over through it, and Settings lets them revoke it. An IIFE off window.IFS
   like every other module; shared shell helpers arrive through
   window.IFS.ui._share. */
(function () {
  "use strict";
  var AUTH = window.IFS.auth;

  /* What linkedSession says for each app: start is what to do in the new
     chat before sending, save is what to do when it asks to save, home is
     where a new chat opens when there is no pre-filled chat link. Claude
     keeps a connector on in every chat and saves without asking. */
  var STEPS = {
    anthropic: { name: "Claude" },
    openai: {
      name: "ChatGPT",
      start: "<b>Switch on Inner Table</b> in the new chat: <b>+</b> &rarr; <b>Developer mode</b> &rarr; <b>Inner Table</b>. Then paste and send.",
      save: "press Allow when it asks",
      home: "https://chatgpt.com/"
    },
    gemini: {
      name: "Gemini",
      start: "<b>Type @ and pick Inner Table</b> in the new chat, then paste and send.",
      save: "press Allow when it asks",
      home: "https://gemini.google.com/app"
    }
  };

  async function call(method) {
    var r = await fetch("/api/bridge", { method: method, headers: { Authorization: "Bearer " + AUTH.getToken() } });
    var j = {};
    try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error(j.error || "Could not reach the server");
    return j.token;
  }

  function urlFor(token) { return location.origin + "/api/bridge?t=" + token; }

  /* The current link's token, or null if there is none. Asked once per app
     run and remembered; revoking here updates it. */
  var known; // undefined until asked
  async function currentToken() {
    if (known !== undefined) return known;
    known = await call("GET");
    return known;
  }

  /* Kill the link, so no AI can read the parts through it any more. */
  async function revoke() {
    known = await call("DELETE");
    return known;
  }

  /* The plain-link route to one session, for an AI that reads pages but has
     no connector (Gemini where Google doesn't offer custom apps). */
  function sessionUrl(token, mode, slugs, material) {
    var q = "&session=" + encodeURIComponent(mode) +
      (slugs || []).map(function (sl) { return "&part=" + encodeURIComponent(sl); }).join("") +
      (material ? "&material=" + encodeURIComponent(String(material).slice(0, 1500)) : "");
    return urlFor(token) + q;
  }

  window.IFS.ui.linkAi = {
    how: function (provider) { return STEPS[provider] || STEPS.anthropic; },
    currentToken: currentToken,
    known: function () { return known; },
    revoke: revoke,
    sessionUrl: sessionUrl
  };
})();
