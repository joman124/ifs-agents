/* Inner Table - UI: linking your own AI.
   The Settings > Live sessions "Link my AI" panel: makes, shows and revokes the
   private link served by api/bridge.js (reads parts, runs sessions, saves them), and says how to hand it to
   Claude, ChatGPT or Gemini. An IIFE off window.IFS like every other module;
   shared shell helpers arrive through window.IFS.ui._share. */
(function () {
  "use strict";
  var UI = window.IFS.ui._share;
  var AUTH = window.IFS.auth;
  var esc = UI.esc, toast = UI.toast, bind = UI.bind, buzz = UI.buzz, $ = UI.$;

  /* How each platform takes a connector. Gemini's app has none, so it gets the
     plain-link route that every platform also offers underneath. */
  var STEPS = {
    anthropic: {
      lead: "Claude reads your parts through a connector:",
      steps: ["Open Claude &rarr; <b>Customize</b> &rarr; <b>Connectors</b>.",
        "Press <b>+</b> &rarr; <b>Add custom connector</b>.",
        "Name it <b>Inner Table</b> and paste the link below. Leave the OAuth fields empty."]
    },
    openai: {
      lead: "ChatGPT reads your parts through a connector in developer mode:",
      steps: ["Open ChatGPT &rarr; <b>Settings</b> &rarr; <b>Connectors</b> &rarr; <b>Advanced</b>, and turn on <b>Developer mode</b>.",
        "Press <b>Create</b>, name it <b>Inner Table</b>, paste the link below as the server URL, and set authentication to <b>No authentication</b>."]
    },
    gemini: {
      lead: "The Gemini app has no connectors yet, so hand it the link directly:",
      steps: ["Press <b>Copy a message for any AI</b> below.",
        "Paste it into a Gemini chat that can open web links."]
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

  function copy(text, done) {
    navigator.clipboard.writeText(text).then(function () { toast(done); buzz(); },
      function () { toast("Copy failed - select the text and copy it by hand"); });
  }

  function anyAiMessage(url) {
    return "Here is a private link to my Inner Table profile - my inner parts, from Internal Family Systems self-exploration: " +
      url + "\n\nPlease open it and use it to understand my parts. Whenever I want to talk - about how I am, or my parts - open the session link the page describes (mode talk, unless I ask for a check-in, a part's reaction, or a table meeting) and follow those instructions for the rest of our conversation. This is journalling, not therapy: no trauma processing and no unburdening.";
  }

  function html(provider) {
    var p = STEPS[provider] || STEPS.anthropic;
    var name = { anthropic: "Claude", openai: "ChatGPT", gemini: "Gemini" }[provider] || "your AI";
    return '<div class="bridge">' +
      '<p class="dim" style="margin:14px 2px 6px"><b>Sessions you start in Inner Table open in ' + name + '</b>, with your parts&rsquo; history, and save back here when they end. You can also just start talking in ' + name + ' &mdash; it knows to use your parts.</p>' +
      '<p class="dim" style="margin:10px 2px 6px">' + p.lead + "</p>" +
      "<ol>" + p.steps.map(function (s) { return "<li>" + s + "</li>"; }).join("") + "</ol>" +
      '<div id="bridgeBox" class="bridge-box"><p class="dim" style="margin:0">Checking for your link&hellip;</p></div>' +
      '<p class="dim" style="margin:10px 2px 0">Your AI can <b>talk with you as someone who knows your parts</b> &mdash; just start talking, or ask it to &ldquo;check in with The Critic&rdquo; or &ldquo;hold a table meeting about the job offer&rdquo; &mdash; using Inner Table&rsquo;s own sessions. When a conversation ends it <b>saves</b> what was learned: profile updates, a meeting&rsquo;s readings, and a short note of the conversation, so the next one &mdash; there or here &mdash; picks up where you left off. Everything merges in and nothing is erased. It cannot delete a part, see your pictures, or read your session transcripts or keys. Anyone holding the link can do the same, so keep it private; revoke it any time.</p>' +
      "</div>";
  }

  function render(box, token) {
    if (!token) {
      box.innerHTML = '<button class="btn btn-primary btn-big" id="bridgeMake">Create my private link</button>';
      bind("#bridgeMake", function () { act(box, "POST", "Link created"); });
      return;
    }
    var url = urlFor(token);
    box.innerHTML =
      '<label class="fieldlabel" style="margin-top:0">Your private link</label>' +
      '<input id="bridgeUrl" readonly value="' + esc(url) + '">' +
      '<div class="bridge-row">' +
      '<button class="btn btn-soft" id="bridgeCopy">Copy link</button>' +
      '<button class="btn btn-soft" id="bridgeMsg">Copy a message for any AI</button></div>' +
      '<div class="bridge-row">' +
      '<button class="btn btn-ghost" id="bridgeNew">Make a new link</button>' +
      '<button class="btn btn-ghost" id="bridgeRevoke">Revoke</button></div>';
    $("#bridgeUrl").addEventListener("focus", function () { this.select(); });
    bind("#bridgeCopy", function () { copy(url, "Link copied"); });
    bind("#bridgeMsg", function () { copy(anyAiMessage(url), "Message copied - paste it into your AI"); });
    bind("#bridgeNew", function () { act(box, "POST", "New link made - the old one no longer works"); });
    bind("#bridgeRevoke", function () { act(box, "DELETE", "Revoked - no AI can read your parts now"); });
  }

  async function act(box, method, done) {
    try { known = await call(method); render(box, known); toast(done); }
    catch (e) { toast(e.message); }
  }

  /* Call after the html() above is in the page. */
  async function mount() {
    var box = $("#bridgeBox");
    if (!box) return;
    try {
      var token = known = await call("GET");
      if (document.body.contains(box)) render(box, token);
    } catch (e) {
      if (document.body.contains(box)) box.innerHTML = '<p class="dim" style="margin:0">' + esc(e.message) + "</p>";
    }
  }

  /* The current link's token, or null if none has been made. Asked once per
     app run and remembered; a link made or revoked here updates it. */
  var known; // undefined until asked
  async function currentToken() {
    if (known !== undefined) return known;
    known = await call("GET");
    return known;
  }

  /* The plain-link route to one session, for an AI that reads pages but takes
     no connector (Gemini). */
  function sessionUrl(token, mode, slugs, material) {
    var q = "&session=" + encodeURIComponent(mode) +
      (slugs || []).map(function (sl) { return "&part=" + encodeURIComponent(sl); }).join("") +
      (material ? "&material=" + encodeURIComponent(String(material).slice(0, 1500)) : "");
    return urlFor(token) + q;
  }

  window.IFS.ui.linkAi = { html: html, mount: mount, currentToken: currentToken, sessionUrl: sessionUrl };
})();
