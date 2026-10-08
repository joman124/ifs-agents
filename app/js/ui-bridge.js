/* Inner Table - UI: linking your own AI.
   The Settings > Live sessions "Link my AI" panel: makes, shows and revokes the
   private read-only link served by api/bridge.js, and says how to hand it to
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
    return "Here is a private, read-only link to my Inner Table profile - my inner parts, from Internal Family Systems self-exploration: " +
      url + "\n\nPlease open it and use it to understand my parts. This is journalling, not therapy: no trauma processing and no unburdening.";
  }

  function html(provider) {
    var p = STEPS[provider] || STEPS.anthropic;
    return '<div class="bridge">' +
      '<p class="dim" style="margin:14px 2px 6px">' + p.lead + "</p>" +
      "<ol>" + p.steps.map(function (s) { return "<li>" + s + "</li>"; }).join("") + "</ol>" +
      '<div id="bridgeBox" class="bridge-box"><p class="dim" style="margin:0">Checking for your link&hellip;</p></div>' +
      '<p class="dim" style="margin:10px 2px 0">Your AI can <b>read</b> your parts and your table &mdash; nothing else. It cannot change anything, and your session transcripts and keys are never shared. Anyone holding the link can read your parts, so keep it private; revoke it any time.</p>' +
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
    try { render(box, await call(method)); toast(done); }
    catch (e) { toast(e.message); }
  }

  /* Call after the html() above is in the page. */
  async function mount() {
    var box = $("#bridgeBox");
    if (!box) return;
    try {
      var token = await call("GET");
      if (document.body.contains(box)) render(box, token);
    } catch (e) {
      if (document.body.contains(box)) box.innerHTML = '<p class="dim" style="margin:0">' + esc(e.message) + "</p>";
    }
  }

  window.IFS.ui.linkAi = { html: html, mount: mount };
})();
