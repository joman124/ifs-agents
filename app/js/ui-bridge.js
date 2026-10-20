/* Inner Table - UI: linking your own AI.
   The Settings > AI sessions "Link my AI" panel: makes, shows and revokes the
   private link served by api/bridge.js (reads parts, runs sessions, saves them), and walks the
   person through handing it to Claude, ChatGPT or Gemini one step at a time.
   An IIFE off window.IFS like every other module; shared shell helpers arrive
   through window.IFS.ui._share. */
(function () {
  "use strict";
  var UI = window.IFS.ui._share;
  var AUTH = window.IFS.auth;
  var esc = UI.esc, toast = UI.toast, bind = UI.bind, buzz = UI.buzz, $ = UI.$;

  /* The walkthrough, one screen per step. Most people have never added a
     connector, so each step is one thing to do: a short title, the buttons to
     press in order (taps), and at most one line more. act "open" opens the
     app, "copy" hands over the link. need is what has to be true first.
     Claude keeps a connector on in every chat; ChatGPT and Gemini need it
     switched on per chat and ask before each save, so their last step says so.
     start/save are the hand-off steps in ui.js linkedSession; home is where a
     new chat opens when there is no pre-filled chat link. */
  var STEPS = {
    anthropic: {
      name: "Claude", site: "https://claude.ai/",
      walk: [
        { t: "Open Claude", say: "The website, the desktop app or the phone app all work.", act: "open" },
        { t: "Find Connectors", taps: ["Customize", "Connectors"] },
        { t: "Add a new one", taps: ["+", "Add custom connector"] },
        { t: "Paste your link", say: "Name it <b>Inner Table</b>, paste your link and press <b>Add</b>. Leave everything else empty.", act: "copy" }
      ],
      use: "Just start talking in Claude &mdash; it knows your parts."
    },
    openai: {
      name: "ChatGPT", site: "https://chatgpt.com/",
      need: ["A paid plan (Plus or Pro)", "A computer, just for setup"],
      walk: [
        { t: "Open ChatGPT on a computer", say: "The phone app can&rsquo;t do this part. Afterwards it works everywhere.", act: "open" },
        { t: "Turn on Developer mode", taps: ["Your name, bottom left", "Settings", "Apps", "Advanced settings"], say: "Switch <b>Developer mode</b> on." },
        { t: "Add Inner Table", taps: ["Create"], say: "Name it <b>Inner Table</b>, paste your link, pick <b>No authentication</b>, tick the box and press <b>Create</b>.", act: "copy" },
        { t: "Switch it on in each chat", taps: ["+", "Developer mode", "Inner Table"], say: "ChatGPT needs this every time you start a new chat." }
      ],
      use: "When a session ends, ChatGPT asks before it saves &mdash; press <b>Allow</b>.",
      start: "<b>Switch on Inner Table</b> in the new chat: <b>+</b> &rarr; <b>Developer mode</b> &rarr; <b>Inner Table</b>. Then paste and send.",
      save: "press Allow when it asks",
      home: "https://chatgpt.com/"
    },
    gemini: {
      name: "Gemini", site: "https://gemini.google.com/app",
      need: ["A personal Google account", "In the US", "Keep Activity on", "A computer, just for setup"],
      walk: [
        { t: "Open Gemini on a computer", say: "Afterwards it works in the phone app too.", act: "open" },
        { t: "Find Connected Apps", taps: ["Settings", "Connected Apps"], say: "Not there? Open <b>Personal Intelligence</b> first." },
        { t: "Add Inner Table", taps: ["Add a custom app"], say: "Paste your link, press <b>Next</b> and follow along.", act: "copy" },
        { t: "Pick it in each chat", taps: ["@", "Inner Table"], say: "Type <b>@</b> in the message box and choose Inner Table." }
      ],
      use: "When a session ends, Gemini asks before it saves &mdash; press <b>Allow</b>.",
      fallback: "Gemini won&rsquo;t let you add it? Open <b>Manage your link</b> below, press <b>Copy a message for any AI</b> and paste that into Gemini instead.",
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
    walkAt = 0;
    walkFor = provider;
    return '<div class="bridge">' +
      '<p class="bridge-lead">Sessions open in <b>' + p.name + "</b> and save back here. Set it up once &mdash; about two minutes.</p>" +
      (p.need ? '<div class="bridge-need"><span>You&rsquo;ll need</span>' +
        p.need.map(function (n) { return '<span class="chip">' + n + "</span>"; }).join("") + "</div>" : "") +
      '<div id="linkWalk" class="walk"></div>' +
      (p.fallback ? '<p class="dim bridge-small">' + p.fallback + "</p>" : "") +
      '<details class="advanced"><summary>Manage your link</summary>' +
      '<div id="bridgeBox" class="bridge-box"><p class="dim" style="margin:0">Checking for your link&hellip;</p></div></details>' +
      '<details class="advanced"><summary>What can my AI see?</summary>' +
      '<p class="dim bridge-small">Your AI can <b>talk with you as someone who knows your parts</b> &mdash; just start talking, or ask it to &ldquo;check in with The Critic&rdquo; or &ldquo;hold a table meeting about the job offer&rdquo;. When a conversation ends it <b>saves</b> what was learned &mdash; profile updates, a meeting&rsquo;s readings, a short note &mdash; so the next one picks up where you left off. Nothing is erased.</p>' +
      '<p class="dim bridge-small">It can&rsquo;t delete a part, see your pictures, or read your transcripts or keys. Anyone holding the link can do the same, so keep it private &mdash; you can revoke it any time.</p></details>' +
      "</div>";
  }

  /* ---------- the walkthrough ---------- */
  var walkAt = 0, walkFor = "anthropic";

  function stepActions(p, s) {
    if (s.act === "open") return '<a class="btn btn-primary btn-big" id="walkOpen" href="' + p.site + '" target="_blank" rel="noopener">Open ' + p.name + "</a>";
    if (s.act !== "copy") return "";
    return known ? '<button class="btn btn-primary btn-big" id="walkCopy">Copy your link</button>'
      : '<button class="btn btn-primary btn-big" id="walkMake">Make your private link</button>';
  }

  function renderWalk() {
    var box = $("#linkWalk");
    if (!box) return;
    var p = STEPS[walkFor] || STEPS.anthropic;
    var n = p.walk.length;
    if (walkAt >= n) {
      box.innerHTML = '<div class="walk-card walk-done"><div class="walk-tick">&#10003;</div><h4>You&rsquo;re linked</h4>' +
        "<p>" + p.use + "</p>" +
        '<p class="dim">Start any session in Inner Table and it opens in ' + p.name + ".</p>" +
        '<button class="btn btn-ghost" id="walkAgain">Show the steps again</button></div>';
      bind("#walkAgain", function () { walkAt = 0; renderWalk(); });
      return;
    }
    var s = p.walk[walkAt];
    var dots = p.walk.map(function (_, i) {
      return '<span class="walk-dot' + (i < walkAt ? " past" : i === walkAt ? " on" : "") + '"></span>';
    }).join("");
    box.innerHTML = '<div class="walk-card">' +
      '<div class="walk-top"><span>Step ' + (walkAt + 1) + " of " + n + '</span><span class="walk-dots">' + dots + "</span></div>" +
      "<h4>" + s.t + "</h4>" +
      (s.taps ? '<div class="walk-taps">' + s.taps.map(function (t) { return '<span class="walk-tap">' + t + "</span>"; }).join('<span class="walk-arrow">&rsaquo;</span>') + "</div>" : "") +
      (s.say ? "<p>" + s.say + "</p>" : "") +
      stepActions(p, s) +
      '<div class="walk-nav">' +
      (walkAt ? '<button class="btn btn-ghost" id="walkBack">Back</button>' : "<span></span>") +
      '<button class="btn btn-soft" id="walkNext">' + (walkAt === n - 1 ? "Done" : "I did this &rsaquo;") + "</button></div></div>";
    bind("#walkBack", function () { walkAt--; renderWalk(); });
    bind("#walkNext", function () { walkAt++; renderWalk(); });
    bind("#walkOpen", function () { buzz(12); });
    bind("#walkCopy", function () { copy(urlFor(known), "Link copied - now paste it into " + p.name); });
    bind("#walkMake", function () { act($("#bridgeBox"), "POST", "Link made - now copy it"); });
  }

  /* ---------- managing the link ---------- */
  function render(box, token) {
    if (!box) return;
    if (!token) {
      box.innerHTML = '<p class="dim bridge-small" style="margin-top:0">No link yet &mdash; the steps above make one when you reach the paste step.</p>';
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
    try { known = await call(method); render(box, known); renderWalk(); toast(done); }
    catch (e) { toast(e.message); }
  }

  /* Call after the html() above is in the page. */
  async function mount() {
    var box = $("#bridgeBox");
    if (!box) return;
    renderWalk();
    try {
      known = await call("GET");
      if (document.body.contains(box)) { render(box, known); renderWalk(); }
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
