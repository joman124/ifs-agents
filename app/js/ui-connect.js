/* Inner Table - UI: connecting the person's own AI, so sessions run here.

   Everyone pays for their own sessions, on their own AI account. Two ways in,
   both one screen:
   - Connect with OpenRouter: sign in there, approve, and come back connected
     (api/ai-key.js runs the exchange) - nothing to copy.
   - Paste a key from Anthropic, OpenRouter, OpenAI or Google: the key's own
     shape says whose it is, one short test call proves it works, and it is
     kept with the account so every device they sign in on is connected too.
   Also the one-time "where would you like to talk?" choice for someone who
   has set nothing up yet. An IIFE off window.IFS like every other module;
   shared shell helpers arrive through window.IFS.ui._share. */
(function () {
  "use strict";
  var UI = window.IFS.ui._share;
  var LLM = window.IFS.llm;
  var SY = window.IFS.sync;
  var ST = window.IFS.store;
  var AUTH = window.IFS.auth;
  var icon = window.IFS.icon;
  var esc = UI.esc, toast = UI.toast, bind = UI.bind, buzz = UI.buzz, $ = UI.$;

  /* Where each provider hands out keys. */
  var KEY_PAGES = {
    anthropic: { who: "Anthropic", url: "https://console.anthropic.com/settings/keys", host: "console.anthropic.com" },
    openrouter: { who: "OpenRouter", url: "https://openrouter.ai/settings/keys", host: "openrouter.ai" },
    openai: { who: "OpenAI", url: "https://platform.openai.com/api-keys", host: "platform.openai.com" },
    gemini: { who: "Google AI Studio", url: "https://aistudio.google.com/apikey", host: "aistudio.google.com" }
  };

  /* A session someone was starting when they went to connect, picked up again
     once they are back - even when OpenRouter's sign-in took them out of the
     app and back in. */
  var RESUME_KEY = "innertable.afterConnect";
  function rememberResume(resume) {
    try {
      if (resume) localStorage.setItem(RESUME_KEY, JSON.stringify({ resume: resume, at: Date.now() }));
      else localStorage.removeItem(RESUME_KEY);
    } catch (e) {}
  }
  function takeResume() {
    try {
      var raw = localStorage.getItem(RESUME_KEY);
      localStorage.removeItem(RESUME_KEY);
      var j = raw ? JSON.parse(raw) : null;
      // a sign-in abandoned yesterday should not open a session today
      return j && j.resume && Date.now() - j.at < 30 * 60000 ? j.resume : null;
    } catch (e) { return null; }
  }

  function connected(ai) {
    var where = AUTH.isLoggedIn() ? "" : " on this device";
    toast("Connected" + where + " - " + LLM.label(ai));
    buzz(12);
  }

  /* opts.resume = { mode, slugs, material }: the session to start once connected. */
  function openConnect(opts) {
    opts = opts || {};
    var signedIn = AUTH.isLoggedIn();
    UI.openSheet(
      '<h2 class="sheet-title serif">Talk here in Inner Table</h2>' +
      '<p class="dim">Sessions run right here, on your own AI account &mdash; you pay it directly, usually a few cents a session. ' +
      "A Claude or ChatGPT subscription can&rsquo;t be used for this; an account with API credit can.</p>" +
      (signedIn
        ? '<button class="btn btn-primary btn-big" id="cxRouter">Connect with OpenRouter</button>' +
          '<p class="dim cx-note">Sign in to OpenRouter (or make an account), add a little credit, approve Inner Table &mdash; and you&rsquo;re back here, connected. Sessions run on Claude.</p>' +
          '<div class="cx-or"><span>or paste an API key</span></div>'
        : "") +
      '<input type="password" id="cxKey" autocomplete="off" spellcheck="false" placeholder="sk-ant-&hellip;, sk-or-&hellip;, sk-&hellip; or AIza&hellip;" aria-label="API key">' +
      '<p class="dim cx-note" id="cxWho">A key from Anthropic, OpenRouter, OpenAI or Google AI Studio &mdash; Inner Table tells which from the key.</p>' +
      '<button class="btn ' + (signedIn ? "btn-soft" : "btn-primary") + ' btn-big" id="cxPaste">Connect this key</button>' +
      '<p class="dim cx-note">' + (signedIn
        ? "The key is kept with your account, encrypted, so your other devices are connected too."
        : "The key stays on this device.") +
      " What you say in a session goes straight from here to that provider and falls under its data policy.</p>" +
      '<button class="btn btn-ghost btn-big" id="cxCancel">Not now</button>'
    );

    var who = $("#cxWho");
    var input = $("#cxKey");
    input.addEventListener("input", function () {
      var p = LLM.detect(input.value);
      who.classList.remove("cx-error");
      who.innerHTML = p
        ? "That&rsquo;s " + (p === "anthropic" || p === "openai" ? "an " : "a ") + esc(KEY_PAGES[p].who) + " key."
        : input.value.trim()
          ? "That doesn&rsquo;t look like an API key yet &mdash; keys start with sk-ant-, sk-or-, sk- or AIza."
          : "A key from Anthropic, OpenRouter, OpenAI or Google AI Studio &mdash; Inner Table tells which from the key.";
    });

    bind("#cxPaste", async function () {
      var btn = this;
      var key = input.value.trim();
      var provider = LLM.detect(key);
      if (!provider) {
        who.classList.add("cx-error");
        who.innerHTML = key
          ? "That doesn&rsquo;t look like an API key &mdash; keys start with sk-ant-, sk-or-, sk- or AIza."
          : "Paste a key first. Get one at " + keyLinks() + ".";
        return;
      }
      var ai = { provider: provider, key: key, model: "" };
      btn.disabled = true;
      btn.textContent = "Checking the key…";
      try {
        await LLM.test(ai);
      } catch (e) {
        btn.disabled = false;
        btn.textContent = "Connect this key";
        who.classList.add("cx-error");
        who.textContent = e.message || "That key didn't work.";
        return;
      }
      var kept = await SY.setAi(ai);
      UI.closeSheet();
      connected(ST.state.settings.ai);
      if (signedIn && !kept) toast("Connected here - it will reach your other devices next time you're online");
      if (opts.resume) setTimeout(function () { window.IFS.ui.startSession(opts.resume.mode, opts.resume.slugs, opts.resume.material); }, 250);
      if (opts.done) opts.done();
    });

    bind("#cxRouter", async function () {
      var btn = this;
      btn.disabled = true;
      btn.textContent = "Opening OpenRouter…";
      try {
        var url = await SY.openRouterUrl();
        rememberResume(opts.resume || null);
        location.href = url;
      } catch (e) {
        btn.disabled = false;
        btn.textContent = "Connect with OpenRouter";
        toast(e.message);
      }
    });
    bind("#cxCancel", UI.closeSheet);
  }

  function keyLinks() {
    return ["anthropic", "openrouter", "openai", "gemini"].map(function (p) {
      return '<a href="' + KEY_PAGES[p].url + '" target="_blank" rel="noopener">' + KEY_PAGES[p].host + "</a>";
    }).join(", ");
  }

  /* Connected already: what it is, a test, a different key, or disconnect. */
  function openManage(done) {
    var ai = ST.state.settings.ai;
    var page = KEY_PAGES[ai.provider] || {};
    UI.openSheet(
      '<h2 class="sheet-title serif">Sessions run here</h2>' +
      '<p class="dim">With <b>' + esc(LLM.label(ai)) + "</b>, paid from your " + esc(page.who || "") + " account" +
      (page.url ? ' &mdash; usage and credit at <a href="' + page.url.replace(/\/settings\/keys$|\/api-keys$|\/apikey$/, "") + '" target="_blank" rel="noopener">' + page.host + "</a>" : "") + ".</p>" +
      '<button class="btn btn-soft btn-big" id="cxTest">Test it</button><div style="height:8px"></div>' +
      '<button class="btn btn-soft btn-big" id="cxSwap">Use a different account or key</button>' +
      '<details class="advanced"><summary>Model</summary>' +
      '<input id="cxModel" autocomplete="off" spellcheck="false" value="' + esc(ai.model) + '" placeholder="' + esc(LLM.DEFAULT_MODELS[ai.provider] || "") + '">' +
      '<p class="dim cx-note">Leave it empty for Inner Table&rsquo;s choice. Any model name ' + esc(page.who || "the provider") + " accepts works here.</p>" +
      '<button class="btn btn-soft" id="cxModelSave">Save model</button></details>' +
      '<div style="height:12px"></div><button class="btn btn-danger btn-big" id="cxOff">Disconnect</button>' +
      '<button class="btn btn-ghost btn-big" id="cxClose">Done</button>'
    );
    bind("#cxTest", async function () {
      var btn = this;
      btn.disabled = true; btn.textContent = "Checking…";
      try { await LLM.test(ST.state.settings.ai); toast("Working - " + LLM.label(ST.state.settings.ai) + " answered"); }
      catch (e) { toast(e.message || "It did not answer"); }
      btn.disabled = false; btn.textContent = "Test it";
    });
    bind("#cxSwap", function () { openConnect({ done: done }); });
    bind("#cxModelSave", async function () {
      var cur = ST.state.settings.ai;
      await SY.setAi({ provider: cur.provider, key: cur.key, model: $("#cxModel").value.trim() });
      toast("Sessions will use " + LLM.label(ST.state.settings.ai));
      UI.closeSheet();
      if (done) done();
    });
    bind("#cxOff", async function () {
      await SY.setAi({ provider: "", key: "", model: "" });
      UI.closeSheet();
      toast(AUTH.isLoggedIn() ? "Disconnected on all your devices" : "Disconnected");
      if (done) done();
    });
    bind("#cxClose", UI.closeSheet);
  }

  /* Nothing set up yet: ask once where sessions should happen. Choosing
     copy-a-prompt is remembered, so it is never asked again; the other two
     ask nothing more once they are set up. */
  function chooseWhere(resume, onCopy) {
    var item = function (id, ic, title, sub) {
      return '<button class="menu-item" id="' + id + '"><span class="mi-icon">' + icon(ic) + '</span><span class="mi-main">' +
        title + '<span class="mi-sub">' + sub + "</span></span></button>";
    };
    UI.openSheet(
      '<h2 class="sheet-title serif">Where would you like to talk?</h2>' +
      '<p class="dim">Pick once &mdash; you can change it any time in Settings &rarr; Live sessions.</p>' +
      item("cwHere", "chat", "Here in Inner Table", "connect your own AI account &middot; a few cents a session") +
      item("cwApp", "sync", "In my Claude or ChatGPT app", "link it once &middot; sessions open there and save back here") +
      item("cwCopy", "file", "Copy a prompt", "paste it into any AI chat, then paste the result back")
    );
    bind("#cwHere", function () { openConnect({ resume: resume }); });
    bind("#cwApp", function () {
      UI.closeSheet();
      showSessionsSettings();
    });
    bind("#cwCopy", function () {
      ST.state.settings.copyPrompt = true;
      ST.save();
      UI.closeSheet();
      setTimeout(onCopy, 230);
    });
  }

  function showSessionsSettings() {
    UI.closePanel();
    UI.showView("settings");
    setTimeout(function () { var g = $("#setSessions"); if (g) g.scrollIntoView({ block: "start" }); }, 80);
  }

  /* Back from OpenRouter's sign-in: ?connected=openrouter or ?connect_error=… */
  async function handleReturn() {
    var q = new URLSearchParams(location.search);
    var ok = q.get("connected");
    var err = q.get("connect_error");
    if (!ok && !err) return;
    history.replaceState(null, "", location.pathname + location.hash);
    if (err) {
      rememberResume(null);
      toast({
        cancelled: "OpenRouter sign-in was cancelled - nothing changed",
        expired: "That sign-in took too long - try Connect with OpenRouter again",
        openrouter: "OpenRouter didn't hand over a key - try again, or paste one instead"
      }[err] || "Couldn't connect - try again");
      return;
    }
    await SY.syncAi();
    var ai = ST.state.settings.ai;
    if (!LLM.configured(ai)) { toast("Connected - open the app where you signed in to start"); return; }
    connected(ai);
    var resume = takeResume();
    if (resume) setTimeout(function () { window.IFS.ui.startSession(resume.mode, resume.slugs, resume.material); }, 400);
  }

  window.IFS.ui.connect = {
    open: openConnect, manage: openManage, chooseWhere: chooseWhere,
    handleReturn: handleReturn, showSessionsSettings: showSessionsSettings
  };
})();
