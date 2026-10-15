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

  /* How each platform takes the link, and what it asks of the person after.
     Claude keeps a connector on in every chat; ChatGPT and Gemini need it
     switched on per chat and ask before each save, so they say so.
     start/save are the hand-off steps in ui.js linkedSession; home is where
     a new chat opens when there is no pre-filled chat link. */
  var STEPS = {
    anthropic: {
      lead: "Claude reads your parts through a connector:",
      steps: ["Open Claude &rarr; <b>Customize</b> &rarr; <b>Connectors</b>.",
        "Press <b>+</b> &rarr; <b>Add custom connector</b>.",
        "Name it <b>Inner Table</b> and paste the link below. Leave the OAuth fields empty."],
      use: "Then just start talking in Claude &mdash; it knows to use your parts."
    },
    openai: {
      lead: "ChatGPT takes the link as a custom connector in <b>developer mode</b>. Set it up once on the web at chatgpt.com &mdash; the phone app can&rsquo;t &mdash; on a paid plan (Plus or Pro; on a work account an admin may have to allow it):",
      steps: ["On chatgpt.com, open <b>Settings</b> &rarr; <b>Apps</b> &rarr; <b>Advanced settings</b> and turn on <b>Developer mode</b>. (On some accounts the page is called Connectors or Plugins.)",
        "Press <b>Create</b> (or <b>+</b> &rarr; <b>Add custom MCP server</b>). Name it <b>Inner Table</b>, paste the link below as the server URL, set authentication to <b>No authentication</b>, accept the warning and save."],
      use: "ChatGPT doesn&rsquo;t switch it on by itself. In each new chat, press <b>+</b> in the message box &rarr; <b>Developer mode</b> (it may sit under More) &rarr; turn on <b>Inner Table</b>, then talk. When a session closes ChatGPT asks before it saves &mdash; allow it.",
      start: "<b>In the new chat, turn on Inner Table:</b> press <b>+</b> &rarr; <b>Developer mode</b> &rarr; <b>Inner Table</b>. Then paste the message and send it.",
      save: "it asks first, so allow it",
      home: "https://chatgpt.com/"
    },
    gemini: {
      lead: "Gemini takes the link as a custom app. Set it up once on the web at gemini.google.com; it then works in the phone app too. For now Google allows this only on a personal Google account, in the US, with <b>Keep Activity</b> on:",
      steps: ["On gemini.google.com, open <b>Settings</b> &rarr; <b>Connected Apps</b> (if it isn&rsquo;t there, open <b>Personal Intelligence</b> first).",
        "Under <b>Custom apps</b>, press <b>Add a custom app</b>, paste the link below, press <b>Next</b> and follow what it says."],
      use: "In each chat, type <b>@</b> and pick <b>Inner Table</b> so Gemini uses it. When a session closes Gemini asks before it saves &mdash; allow it.",
      fallback: "Can&rsquo;t add it &mdash; outside the US, on a work or school account, or Gemini won&rsquo;t take the link? Press <b>Copy a message for any AI</b> and paste it into Gemini instead. Gemini reads your parts through it but can&rsquo;t save, so paste its closing reply into Inner Table &mdash; Add a part.",
      start: "<b>In the new chat, type @ and pick Inner Table</b>, then paste the message after it and send.",
      save: "it asks first, so allow it",
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
      '<p class="dim" style="margin:14px 2px 6px"><b>Sessions you start in Inner Table open in ' + name + '</b>, with your parts&rsquo; history, and save back here when they end.</p>' +
      '<p class="dim" style="margin:10px 2px 6px">' + p.lead + "</p>" +
      "<ol>" + p.steps.map(function (s) { return "<li>" + s + "</li>"; }).join("") + "</ol>" +
      '<div id="bridgeBox" class="bridge-box"><p class="dim" style="margin:0">Checking for your link&hellip;</p></div>' +
      '<p class="dim" style="margin:10px 2px 0">' + p.use + "</p>" +
      (p.fallback ? '<p class="dim" style="margin:10px 2px 0">' + p.fallback + "</p>" : "") +
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

  /* The plain-link route to one session, for an AI that reads pages but has
     no connector (Gemini where Google doesn't offer custom apps). */
  function sessionUrl(token, mode, slugs, material) {
    var q = "&session=" + encodeURIComponent(mode) +
      (slugs || []).map(function (sl) { return "&part=" + encodeURIComponent(sl); }).join("") +
      (material ? "&material=" + encodeURIComponent(String(material).slice(0, 1500)) : "");
    return urlFor(token) + q;
  }

  window.IFS.ui.linkAi = { how: function (provider) { return STEPS[provider] || STEPS.anthropic; }, html: html, mount: mount, currentToken: currentToken, sessionUrl: sessionUrl };
})();
