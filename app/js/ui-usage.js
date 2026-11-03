/* Inner Table - UI: Settings -> Usage, for whoever runs the deployment.

   How many people come back (api/stats.js). The server answers only the
   accounts named in STATS_USERS, so for everyone else the one quiet request
   comes back 404 and the section never appears: nothing to see, nothing to
   explain, no error. Asked once per account per app run. An IIFE off
   window.IFS like every other module; shared shell helpers arrive through
   window.IFS.ui._share. */
(function () {
  "use strict";
  var AUTH = window.IFS.auth;

  // username -> the totals, or false once the server has said they are not
  // this account's to see; undefined until asked
  var known = {};
  var asking = {};

  /* The totals for the signed-in account, or null when there are none to
     show (yet). The first call asks, and redraws Settings when there is
     something to put in it. */
  function current() {
    if (!AUTH.isLoggedIn()) return null;
    var who = AUTH.getUsername();
    if (known[who] !== undefined) return known[who] || null;
    if (!asking[who]) {
      asking[who] = true;
      fetch("/api/stats", { headers: { Authorization: "Bearer " + AUTH.getToken() } })
        .then(function (r) { return r.ok ? r.json() : false; })
        .then(function (data) {
          known[who] = data && typeof data === "object" ? data : false;
          if (known[who] && AUTH.getUsername() === who) window.IFS.ui.renderSettings();
        }, function () { asking[who] = false; });   // offline: ask again next time
    }
    return null;
  }

  function n(x) { return typeof x === "number" && isFinite(x) ? x : 0; }

  /* The first day the totals were read over: a `since` on it only means
     counting began before the window, so it is not worth saying. */
  function windowStart(d) {
    var t = Date.parse(d.today + "T00:00:00Z");
    return isFinite(t) ? new Date(t - (n(d.days) - 1) * 86400000).toISOString().slice(0, 10) : "";
  }

  /* The section's body. Returning people first; small numbers stay as
     numbers, with the share only where there is something to divide. */
  function body(d) {
    var esc = window.IFS.ui._share.esc;
    var line = function (main, sub) {
      return '<div class="sr-copy"><b>' + esc(main) + '</b><span class="sr-sub">' + esc(sub) + "</span></div>";
    };
    var cb = d.cameBackWithin7 || {};
    var act = d.active || {};
    var head = "";
    (d.cohorts || []).forEach(function (c, i) { if (i === 0) head = c.weeks.length; });
    var cohortRows = (d.cohorts || []).filter(function (c) { return n(c.size) > 0; }).map(function (c) {
      var cells = "";
      for (var w = 0; w < head; w++) {
        cells += "<td>" + (w < c.weeks.length ? esc(String(n(c.weeks[w]))) : "") + "</td>";
      }
      return "<tr><th>" + esc(c.start.slice(5)) + "</th><td>" + esc(String(n(c.size))) + "</td>" + cells + "</tr>";
    }).join("");
    var weekHeads = "";
    for (var h = 1; h <= head; h++) weekHeads += "<th>+" + h + "</th>";

    return '<div class="set-pad usage">' +
      line(n(d.returningThisWeek) + " came back this week", "opened the app in the last 7 days, and first came before that") +
      line(n(d.newThisWeek) + " new this week", "accounts made in the last 7 days") +
      line(cb.of ? n(cb.came) + " of " + n(cb.of) + " came back within a week (" + n(cb.pct) + "%)" : "Came back within a week: not yet",
        "of the people who joined 8 to 35 days ago, how many returned in their first 7 days") +
      line(n(act.today) + " today · " + n(act.week) + " this week · " + n(act.month) + " this month",
        "accounts that opened the app; a month here is the last 28 days" +
        (d.stickiness != null ? " · " + Math.round(100 * d.stickiness) + "% of this month's people were here this week" : "")) +
      (cohortRows
        ? '<p class="fieldlabel">Weekly cohorts</p>' +
          '<div class="usage-scroll"><table class="usage-table"><thead><tr><th>joined</th><th>size</th>' + weekHeads + "</tr></thead>" +
          "<tbody>" + cohortRows + "</tbody></table></div>" +
          '<p class="dim usage-note">Each row is everyone who joined in one 7-day block; +1, +2&hellip; count how many of them opened the app 1, 2&hellip; weeks later.</p>'
        : "") +
      '<p class="dim usage-note">' + esc(d.note || "") +
      (d.since && d.since !== windowStart(d) ? " Counting since " + esc(d.since) + "." : "") + "</p>" +
      "</div>";
  }

  /* ---- Settings -> Free AI setup: the same owners only ----
     api/free-ai.js?check=1 says which free-AI setting is wrong and what to
     set instead; a 404 for everyone else, so the section never appears for
     them. "Check each model" asks the server for one tiny request per model,
     when the deployment allows it (FREE_AI_LIVE_CHECK=1). */
  var setup = {};      // username -> the check, false when not theirs; undefined until asked
  var settingUp = {};

  function ask(who, how) {
    return fetch("/api/free-ai?check=" + how, { headers: { Authorization: "Bearer " + AUTH.getToken() } })
      .then(function (r) { return r.ok ? r.json() : false; })
      .then(function (data) {
        setup[who] = data && typeof data === "object" ? data : false;
        if (setup[who] && AUTH.getUsername() === who) window.IFS.ui.renderSettings();
      });
  }

  function freeAi() {
    if (!AUTH.isLoggedIn()) return null;
    var who = AUTH.getUsername();
    if (setup[who] !== undefined) return setup[who] || null;
    if (!settingUp[who]) {
      settingUp[who] = true;
      ask(who, "1").catch(function () { settingUp[who] = false; });
    }
    return null;
  }

  function freeAiSummary(d) {
    var errors = (d.problems || []).filter(function (p) { return p.severity === "error"; }).length;
    if (!d.on) return "off";
    if (errors) return errors + (errors === 1 ? " setting" : " settings") + " to fix";
    return (d.problems || []).length ? "works, with notes" : "settings look right";
  }

  function freeAiBody(d) {
    var esc = window.IFS.ui._share.esc;
    var rows = (d.problems || []).map(function (p) {
      return '<div class="sr-copy"><b>' + esc((p.severity === "error" ? "Fix: " : "Note: ") + p.setting) + "</b>" +
        '<span class="sr-sub">' + esc(p.setting + " " + p.problem) + " " + esc(p.fix) + "</span></div>";
    }).join("");
    var live = d.live
      ? (d.live.off ? '<p class="dim usage-note">' + esc(d.live.off) + "</p>"
        : (d.live.models || []).map(function (m) {
          return '<div class="sr-copy"><b>' + esc(m.model) + '</b><span class="sr-sub">' + esc(m.said) + "</span></div>";
        }).join(""))
      : "";
    return '<div class="set-pad usage">' +
      '<div class="sr-copy"><b>' + esc(d.target ? "Sessions go to: " + d.target : "No free AI address set") + "</b>" +
      '<span class="sr-sub">' + esc((d.models || []).length ? "models tried, in order: " + d.models.join(", ") : "no models to try") + "</span></div>" +
      (rows || '<p class="dim usage-note">Every setting fits ' + esc(d.target || "the free AI") + ".</p>") +
      live +
      (d.liveAllowed ? '<button class="btn btn-soft" id="freeAiLiveBtn">Check each model</button>' : "") +
      "</div>";
  }

  document.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest("#freeAiLiveBtn") : null;
    if (!btn || !AUTH.isLoggedIn()) return;
    btn.disabled = true;
    btn.textContent = "Checking…";
    ask(AUTH.getUsername(), "live").catch(function () { btn.disabled = false; btn.textContent = "Check each model"; });
  });

  window.IFS.ui.usage = { current: current, body: body, freeAi: freeAi, freeAiSummary: freeAiSummary, freeAiBody: freeAiBody };
})();
