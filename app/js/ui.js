/* Inner Table - UI: views, sheets, panels, chat sessions. */
(function () {
  "use strict";
  var S = window.IFS.schema;
  var MD = window.IFS.md;
  var ST = window.IFS.store;
  var T = window.IFS.templates;
  var LLM = window.IFS.llm;
  var G = window.IFS.graph;
  var V = window.IFS.voice;
  var Q = window.IFS.questions;
  var R = window.IFS.reference;
  var AUTH = window.IFS.auth;
  var SY = window.IFS.sync;
  var F = window.IFS.files;

  var $ = function (sel) { return document.querySelector(sel); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  function buzz(ms) {
    if (ST.state.settings.haptics && navigator.vibrate) { try { navigator.vibrate(ms || 8); } catch (e) {} }
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $("#toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add("hidden"); }, 2600);
  }

  /* ================= theme ================= */
  function applyTheme() {
    var t = ST.state.settings.theme;
    var dark = t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }
  function cycleTheme() {
    var order = ["auto", "dark", "light"];
    var s = ST.state.settings;
    s.theme = order[(order.indexOf(s.theme) + 1) % order.length];
    ST.save(); applyTheme(); buzz();
    toast("Theme: " + s.theme);
  }

  /* ================= sheet =================
     Closing animates for 210ms before the element is really hidden. A flow
     that closes one sheet and opens the next straight away would otherwise
     have the old timer hide the new sheet - so every open/close takes a
     ticket, and a stale timer does nothing. */
  var sheetSeq = 0;
  function openSheet(html) {
    sheetSeq++;
    $("#sheetBody").innerHTML = html;
    $("#sheetBackdrop").classList.remove("hidden");
    var sh = $("#sheet");
    sh.classList.remove("hidden", "closing");
    buzz();
  }
  function closeSheet() {
    var sh = $("#sheet");
    if (sh.classList.contains("hidden")) return;
    var mine = ++sheetSeq;
    sh.classList.add("closing");
    setTimeout(function () {
      if (sheetSeq !== mine) return; // a newer sheet took over
      sh.classList.add("hidden"); sh.classList.remove("closing");
      $("#sheetBackdrop").classList.add("hidden");
    }, 210);
  }

  /* ================= panel ================= */
  var panelOnClose = null;
  var panelSeq = 0;
  function openPanel(title, sub, bodyHTML, actionsHTML, onClose) {
    panelSeq++;
    $("#panelTitle").innerHTML = esc(title) + (sub ? "<small>" + esc(sub) + "</small>" : "");
    $("#panelBody").innerHTML = bodyHTML;
    $("#panelActions").innerHTML = actionsHTML || "";
    panelOnClose = onClose || null;
    var p = $("#panel");
    p.classList.remove("hidden", "closing");
    buzz();
  }
  function closePanel() {
    var p = $("#panel");
    if (p.classList.contains("hidden")) return;
    if (panelOnClose && panelOnClose() === false) return; // veto (confirm dialogs)
    var mine = ++panelSeq;
    p.classList.add("closing");
    setTimeout(function () {
      if (panelSeq !== mine) return; // a newer panel took over mid-animation
      p.classList.add("hidden"); p.classList.remove("closing"); $("#panelBody").innerHTML = "";
    }, 190);
  }

  /* ================= tabs / views ================= */
  var currentView = "parts";
  function showView(name) {
    currentView = name;
    document.querySelectorAll(".tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.view === name);
    });
    document.querySelectorAll(".view").forEach(function (v) {
      v.classList.toggle("hidden", v.id !== "view-" + name);
    });
    $("#topTitle").textContent = { parts: "Inner Table", map: "Swarm Map", table: "The Table", settings: "Settings" }[name];
    $("#fabNew").classList.toggle("hidden", name !== "parts");
    if (name === "map") renderMap(); else G.stop();
    if (name === "parts") renderParts();
    if (name === "table") renderTable();
    if (name === "settings") renderSettings();
    buzz();
  }

  /* ================= parts list ================= */
  function ringSVG(score, initial) {
    var r = 24, c = 2 * Math.PI * r;
    var off = c * (1 - score);
    return '<div class="ring"><svg width="54" height="54" viewBox="0 0 54 54">' +
      '<circle class="ring-bg" cx="27" cy="27" r="' + r + '" fill="none" stroke-width="3"/>' +
      '<circle class="ring-fg" cx="27" cy="27" r="' + r + '" fill="none" stroke-width="3" stroke-linecap="round" stroke-dasharray="' + c + '" stroke-dashoffset="' + off + '"/>' +
      '</svg><span class="ring-initial">' + esc(initial) + "</span></div>";
  }

  function daysSince(iso) {
    if (!iso) return 9999;
    var t = Date.parse(iso);
    return isNaN(t) ? 9999 : (Date.now() - t) / 86400000;
  }

  /* markBackup only on a real success - otherwise a cancelled share would
     silence the "back up your parts" reminder without a backup existing. */
  function doExportBackup() {
    exportText(ST.exportAll(), "inner-table-backup-" + S.todayISO() + ".json",
      showTextToCopy,
      function () { ST.markBackup(); renderParts(); });
  }

  /* ================= add to home screen =================
     Android and desktop hand us a beforeinstallprompt event we can fire on
     demand. iOS Safari fires nothing and exposes no API, so there the only
     honest thing is to say where the Share-sheet item lives. */
  var deferredInstall = null;

  function isStandalone() {
    return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  }
  var isIOS = F.isIOS;
  function installHint() {
    if (deferredInstall) return "opens like an app and works offline";
    if (isIOS()) return "tap Share, then <b>Add to Home Screen</b>";
    return "use your browser menu &rarr; <b>Install</b>";
  }
  function doInstall() {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    deferredInstall.userChoice.then(function (c) {
      if (c.outcome === "accepted") deferredInstall = null;
      renderParts();
    });
  }
  function watchInstall() {
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferredInstall = e;
      renderBanners();
    });
    window.addEventListener("appinstalled", function () {
      deferredInstall = null;
      renderBanners();
      toast("Inner Table is on your home screen");
    });
  }

  /* ================= coach cues =================
     The reference library holds the explanations that make this framework
     legible, and it opens only if someone taps the ⓘ - which means it is
     there when a person is already comfortable and absent when they are not.
     These are the same explanations, one paragraph each, placed at the moment
     the confusion actually happens. They run for an account's first day only,
     each fires once, and every one offers the full page behind it. */
  function coachPending(id) {
    var s = ST.state.settings;
    if (!s.coachOn) return null;
    if (s.taught && s.taught[id]) return null;
    return R.coach(id);
  }

  function markTaught(id) {
    var s = ST.state.settings;
    s.taught = s.taught || {};
    if (s.taught[id]) return;
    s.taught[id] = true;
    // nothing left to teach: stop checking on every render, and never revive
    var done = R.COACH.every(function (c) { return s.taught[c.id]; });
    if (done) s.coachOn = false;
    ST.save();
  }

  function coachHTML(id) {
    var c = coachPending(id);
    if (!c) return "";
    return '<div class="coach">' +
      '<button class="coach-x" data-coach-dismiss aria-label="Dismiss">&#10005;</button>' +
      '<div class="coach-title serif">' + esc(c.title) + "</div>" +
      '<div class="coach-text">' + esc(c.text) + "</div>" +
      '<button class="coach-more" data-coach-learn="' + esc(c.learn) + '">Read more &rsaquo;</button>' +
      "</div>";
  }

  /* Put a cue in a container if one is due, and wire its two exits. Both of
     them count as taught: a cue that has been read and closed has done its
     job, and one that sent someone to the full page has more than done it. */
  function mountCoach(el, id) {
    if (!el) return false;
    var html = coachHTML(id);
    el.innerHTML = html;
    if (!html) return false;
    var clear = function () { el.innerHTML = ""; markTaught(id); };
    el.querySelector("[data-coach-dismiss]").addEventListener("click", function () {
      clear(); buzz();
    });
    el.querySelector("[data-coach-learn]").addEventListener("click", function (e) {
      var page = e.currentTarget.dataset.coachLearn;
      clear(); buzz();
      learnPage(page);
    });
    return true;
  }

  function renderCoach(sel, id) { return mountCoach($(sel), id); }

  /* ================= the daily check-in =================
     The app opened onto a library of finished profiles, which gives a
     returning person nothing to do and no reason to come back. This is the
     loop: one question, one part that has gone quiet, and a way in. Once a
     day, and never during the first run - a new account has not had time to
     leave anything alone yet, and is being taught instead. */
  function ritualDue() {
    var s = ST.state.settings;
    if (s.coachOn) return false;
    if (s.ritualDay === S.todayISO()) return false;
    // an unfinished session is the better invitation, and its banner is
    // already sitting directly below this one
    var d = ST.state.draft;
    if (d && d.messages && d.messages.length) return false;
    return ST.listParts().length > 0;
  }

  function dismissRitual() {
    ST.state.settings.ritualDay = S.todayISO();
    ST.save();
  }

  /* How long a part has been left alone, in the roughest unit that is still
     true - "quiet for 6 weeks" lands where "quiet for 43 days" reads as a
     number to feel bad about. */
  function quietLabel(p) {
    var last = S.lastSessionISO(p);
    if (!last) return "not yet interviewed";
    var d = S.daysBetween(last, S.todayISO());
    if (d <= 0) return "you sat with it today";
    if (d === 1) return "quiet since yesterday";
    if (d < 14) return "quiet for " + d + " days";
    if (d < 60) return "quiet for " + Math.round(d / 7) + " weeks";
    return "quiet for months";
  }

  function renderRitual() {
    var el = $("#ritual");
    if (!el) return;
    if (!ritualDue()) { el.innerHTML = ""; return; }
    var today = S.todayISO();
    var p = S.quietestPart(ST.listParts(), today);
    if (!p) { el.innerHTML = ""; return; }

    el.innerHTML =
      '<div class="ritual">' +
      '<button class="coach-x" id="rtSkip" aria-label="Not today">&#10005;</button>' +
      '<div class="ritual-q serif">' + esc(R.ritualPrompt(today)) + "</div>" +
      '<div class="ritual-part">' +
      '<span class="rt-i">' + esc(S.initial(p.name)) + "</span>" +
      '<span class="rt-main"><b>' + esc(p.name) + "</b>" +
      '<span class="rt-sub">' + esc(quietLabel(p)) + "</span></span></div>" +
      '<div class="ritual-cta">' +
      '<button class="btn btn-primary" id="rtGo">Check in</button>' +
      '<button class="btn btn-soft" id="rtOther">Someone else</button>' +
      "</div></div>";

    bind("#rtSkip", function () { dismissRitual(); renderParts(); buzz(); });
    bind("#rtGo", function () {
      dismissRitual(); renderParts(); buzz(12);
      startSession("checkin", [p.slug]);
    });
    bind("#rtOther", function () {
      dismissRitual(); renderParts(); buzz();
      pickPart("Who would you like to sit with?", function (slug) {
        startSession("checkin", [slug]);
      });
    });
  }

  function renderBanners() {
    var el = $("#partsBanner");
    if (!el) return;
    var html = "";
    var d = ST.state.draft;
    var s = ST.state.settings;
    if (d && d.messages && d.messages.length) {
      html +=
        '<div class="banner"><span class="bn-main"><b>Unfinished ' + esc((d.title || "session").toLowerCase()) + "</b>" +
        '<span class="bn-sub">from ' + esc(d.updated || "recently") + " &middot; pick up where you left off</span></span>" +
        '<button class="btn btn-primary" id="bnResume">Resume</button>' +
        '<button class="btn btn-ghost" id="bnDiscard" aria-label="Discard draft">&#10005;</button></div>';
    } else if (!isStandalone() && (deferredInstall || isIOS()) && daysSince(s.installSnooze) >= 30) {
      html +=
        '<div class="banner quiet"><span class="bn-main"><b>Add to your home screen</b>' +
        '<span class="bn-sub">' + installHint() + "</span></span>" +
        (deferredInstall ? '<button class="btn btn-soft" id="bnInstall">Install</button>' : "") +
        '<button class="btn btn-ghost" id="bnInstallNo" aria-label="Not now">&#10005;</button></div>';
    } else if (ST.listParts().length && daysSince(s.lastBackup) >= 21 && daysSince(s.backupSnooze) >= 14) {
      html +=
        '<div class="banner quiet"><span class="bn-main"><b>Back up your parts</b>' +
        '<span class="bn-sub">' + (s.lastBackup ? "last backup " + esc(s.lastBackup) : "never backed up") + " &middot; browsers can clear site data</span></span>" +
        '<button class="btn btn-soft" id="bnBackup">Export</button>' +
        '<button class="btn btn-ghost" id="bnSnooze" aria-label="Remind me later">&#10005;</button></div>';
    }
    el.innerHTML = html;
    bind("#bnResume", resumeDraft);
    bind("#bnDiscard", function () {
      openSheet('<h2 class="sheet-title serif">Discard the draft?</h2><p class="dim">The unfinished conversation will be gone. Resuming instead keeps everything.</p>' +
        '<button class="btn btn-danger btn-big" id="bnDelYes">Discard it</button><button class="btn btn-ghost btn-big" id="bnDelNo">Keep it</button>');
      bind("#bnDelYes", function () { ST.clearDraft(); closeSheet(); renderParts(); toast("Draft discarded"); });
      bind("#bnDelNo", closeSheet);
    });
    bind("#bnBackup", doExportBackup);
    bind("#bnSnooze", function () { s.backupSnooze = S.todayISO(); ST.save(); renderParts(); });
    bind("#bnInstall", doInstall);
    bind("#bnInstallNo", function () { s.installSnooze = S.todayISO(); ST.save(); renderParts(); });
  }

  function renderParts() {
    renderCoach("#partsCoach", "parts");
    renderRitual();
    renderBanners();
    var parts = ST.listParts();
    var today = S.todayISO();
    var list = $("#partsList");
    $("#partsEmpty").classList.toggle("hidden", parts.length > 0);
    list.innerHTML = parts.map(function (p) {
      var rd = S.readiness(p);
      var score = S.coverageScore(p);
      var last = p.sessions.length ? p.sessions[p.sessions.length - 1] : null;
      var sub = p.positive_intent || (last ? "last session " + last.date : "not yet interviewed");
      // a part left alone long enough to have gone quiet says so, so the
      // library reads as a system with a pulse rather than a set of files
      var lastISO = S.lastSessionISO(p);
      var quiet = lastISO && S.daysBetween(lastISO, today) >= 14;
      return '<div class="part-card" data-slug="' + esc(p.slug) + '">' +
        ringSVG(score, S.initial(p.name)) +
        '<div class="part-card-main">' +
        '<div class="part-card-name">' + esc(p.name) +
        ' <span class="badge ' + esc(p.type) + '">' + esc(p.type) + "</span>" +
        (quiet ? ' <span class="quiettag">' + esc(quietLabel(p)) + "</span>" : "") + "</div>" +
        '<div class="part-card-sub">' + esc(sub) + "</div></div>" +
        '<span class="readydot' + (rd.ready ? " ready" : "") + '" title="' + (rd.ready ? "ready for meetings" : "needs more check-ins") + '"></span>' +
        "</div>";
    }).join("");
    list.querySelectorAll(".part-card").forEach(function (card) {
      card.addEventListener("click", function () { openProfile(card.dataset.slug); });
    });
  }

  /* ================= profile ================= */
  function tagList(items) {
    if (!items || !items.length) return '<div class="prose none">unknown</div>';
    return '<div class="taglist">' + items.map(function (i) { return "<span>" + esc(i) + "</span>"; }).join("") + "</div>";
  }
  function prose(v) {
    return v ? '<div class="prose">' + esc(v) + "</div>" : '<div class="prose none">unknown</div>';
  }

  /* Quick-editable fields: label + how the edit sheet should treat them. */
  var PROFILE_FIELDS = {
    positive_intent: { kind: "prose", label: "Positive intent", hint: "What is this part trying to protect you from, or move you toward?" },
    unburdened_vision: { kind: "prose", label: "If it no longer had this role", hint: "What would it rather do, if it trusted things were safe?" },
    emotions: { kind: "list", label: "Emotions" },
    fears: { kind: "list", label: "Fears" },
    hopes_goals: { kind: "list", label: "Hopes & goals" },
    behaviors: { kind: "list", label: "Behaviors" },
    wants_needs: { kind: "list", label: "Wants & needs" }
  };

  function editCard(title, bodyHTML, editKey) {
    return '<div class="card"><h3>' + esc(title) +
      '<button class="cardedit" data-edit="' + esc(editKey) + '" aria-label="Edit ' + esc(title) + '">&#9998;</button></h3>' +
      bodyHTML + "</div>";
  }

  function openProfile(slug) {
    var p = ST.getPart(slug);
    if (!p) return;
    var rd = S.readiness(p);
    var facts = [];
    if (p.age) facts.push("<b>age</b> " + esc(p.age));
    if (p.location) facts.push("<b>lives</b> " + esc(p.location));
    if (p.trust_in_self && p.trust_in_self !== "unknown") facts.push("<b>trust in Self</b> " + esc(p.trust_in_self));

    var covHTML = S.CATEGORIES.map(function (c) {
      var st = p.coverage[c];
      return '<div class="covitem cov-' + st + '" data-cov="' + c + '" title="' + st + ' - tap to ask these questions"><i></i>' + esc(S.CATEGORY_LABELS[c]) + "</div>";
    }).join("");

    // one obvious next move, rather than a wall of equal buttons
    var next = Q.nextCategory(p);
    var others = ST.listParts().filter(function (x) { return x.slug !== p.slug; });
    var unconnected = others.length && !(p.relationships || []).length;
    var nextCTA = next
      ? '<button class="btn btn-primary btn-big" id="pfAsk">Ask ' + esc(p.name) + " about " + esc(S.CATEGORY_LABELS[next].toLowerCase()) + "</button>"
      : (unconnected ? '<button class="btn btn-primary btn-big" id="pfLink">Connect ' + esc(p.name) + " to another part</button>" : "");

    /* A part it has only ever rated at the table belongs in this list too:
       "we have not named what this is, but I know how I feel about them" is
       a relationship, and leaving it out would hide what a round recorded. */
    var relSlugs = [], relSeen = {};
    (p.relationships || []).concat(p.feelings || []).forEach(function (r) {
      if (!relSeen[r.part]) { relSeen[r.part] = 1; relSlugs.push(r.part); }
    });
    var relHTML = relSlugs.length
      ? relSlugs.map(function (slug) {
          var r = (p.relationships || []).filter(function (x) { return x.part === slug; })[0];
          var f = S.getFeeling(p, slug);
          var other = ST.getPart(slug);
          // an edge naming a part that isn't here can't be drawn on the map -
          // say so rather than showing a bare slug that looks like a name
          return '<div class="sessionrow"><span class="sr-mode">' +
            esc(r ? r.type.replace(/-/g, " ") : "not named yet") + "</span><span>" +
            esc(other ? other.name : slug) +
            (other ? "" : ' <span class="dim">— not in your library yet</span>') +
            (r && r.notes ? ' <span class="dim">' + esc(r.notes) + "</span>" : "") +
            (f ? ' <span class="dim">feels ' + esc(S.feelingLabel(f.rating).toLowerCase()) +
                 (f.rounds > 1 ? " after " + f.rounds + " rounds" : "") + "</span>" : "") +
            "</span></div>";
        }).join("")
      : '<div class="prose none">' + (others.length
          ? "no mapped relationships yet - use Connect to another part below"
          : "no mapped relationships yet - they appear once you have a second part") + "</div>";

    var sessHTML = p.sessions.length
      ? p.sessions.slice().reverse().map(function (s) {
          return '<div class="sessionrow"><span class="sr-date">' + esc(s.date) + '</span><span class="sr-mode">' + esc(s.mode) + "</span><span>" + esc(s.note || "") + "</span></div>";
        }).join("")
      : '<div class="prose none">no sessions logged</div>';

    var narrHTML = S.NARRATIVE_SECTIONS.filter(function (sec) { return sec.key !== "session_notes"; })
      .map(function (sec) {
        return editCard(sec.title, prose(p.narrative[sec.key]), "narr:" + sec.key);
      }).join("");

    var body =
      '<div class="profile">' +
      '<div class="profile-hero">' +
      '<div class="avatar">' + esc(S.initial(p.name)) + "</div>" +
      '<h1 class="serif">' + esc(p.name) + "</h1>" +
      '<div class="sub"><span class="badge ' + esc(p.type) + '">' + esc(p.type) + "</span></div>" +
      '<div class="chips">' + facts.map(function (f) { return '<span class="chip">' + f + "</span>"; }).join("") +
      '<button class="chip chip-btn" id="pfAbout">&#9998; edit details</button></div>' +
      "</div>" +
      '<div class="readiness ' + (rd.ready ? "ok" : "no") + '">' +
      (rd.ready ? "&#10003; Developed enough to speak at table meetings"
                : "Needs " + esc(rd.missing.join(", ")) + " before it can speak for itself") +
      "</div>" +
      editCard("Positive intent", prose(p.positive_intent), "positive_intent") +
      '<div class="card"><h3>Coverage <span class="covhint">tap one to ask its questions</span></h3><div class="covgrid">' + covHTML + "</div></div>" +
      editCard("Fears", tagList(p.fears), "fears") +
      editCard("Hopes & goals", tagList(p.hopes_goals), "hopes_goals") +
      editCard("Behaviors", tagList(p.behaviors), "behaviors") +
      editCard("Wants & needs", tagList(p.wants_needs), "wants_needs") +
      editCard("Emotions", tagList(p.emotions), "emotions") +
      editCard("If it no longer had this role", prose(p.unburdened_vision), "unburdened_vision") +
      '<div class="card"><h3>Relationships</h3>' + relHTML + "</div>" +
      narrHTML +
      editCard("Session notes", prose(p.narrative.session_notes), "narr:session_notes") +
      '<div class="card"><h3>Session log</h3>' + sessHTML + "</div>" +
      '<div class="profile-cta">' +
      nextCTA +
      '<button class="btn btn-soft btn-big" id="pfCheckin">Check in with ' + esc(p.name) + " (AI session)</button>" +
      (others.length ? '<button class="btn btn-soft btn-big" id="pfConnect">Connect to another part</button>' : "") +
      (others.length ? '<button class="btn btn-soft btn-big" id="pfMerge">Merge with a duplicate</button>' : "") +
      '<button class="btn btn-soft btn-big" id="pfEmbody"' + (rd.ready ? "" : " disabled") + ">React to material (embody)</button>" +
      '<button class="btn btn-soft btn-big" id="pfExport">Export profile (.md)</button>' +
      '<button class="btn btn-soft btn-big" id="pfEdit">Edit raw markdown</button>' +
      '<button class="btn btn-danger btn-big" id="pfDelete">Delete this part</button>' +
      "</div></div>";

    openPanel(p.name, p.type + " · " + Math.round(S.coverageScore(p) * 100) + "% developed", body);

    // pencil on each card -> simple edit sheet; edits save straight into the
    // stored profile, which is exactly what exports and prompts read
    document.querySelectorAll("#panelBody .cardedit").forEach(function (btn) {
      btn.addEventListener("click", function () { editFieldSheet(p.slug, btn.dataset.edit); });
    });
    $("#pfAbout").addEventListener("click", function () { aboutSheet(p.slug); });

    // coverage: tap a category to work through its questions
    document.querySelectorAll("#panelBody .covitem").forEach(function (el) {
      el.addEventListener("click", function () {
        var c = el.dataset.cov;
        if (p.coverage[c] === "declined") {
          openSheet('<h2 class="sheet-title serif">' + esc(S.CATEGORY_LABELS[c]) + " was declined</h2>" +
            '<p class="dim">' + esc(p.name) + " chose not to go here. Reopen it only if the part brings it up.</p>" +
            '<button class="btn btn-soft btn-big" id="cvReopen">' + esc(p.name) + " brought it up — reopen</button>" +
            '<button class="btn btn-ghost btn-big" id="cvKeep">Leave it closed</button>');
          bind("#cvReopen", function () { closeSheet(); askCategory(p.slug, c); });
          bind("#cvKeep", closeSheet);
          return;
        }
        buzz();
        askCategory(p.slug, c);
      });
    });

    bind("#pfAsk", function () { askCategory(p.slug, next); });
    bind("#pfLink", function () { connectPart(p.slug); });
    bind("#pfConnect", function () { connectPart(p.slug); });
    bind("#pfMerge", function () { mergePartSheet(p.slug); });
    $("#pfCheckin").addEventListener("click", function () { startSession("checkin", [p.slug]); });
    var em = $("#pfEmbody");
    if (em) em.addEventListener("click", function () { askMaterial("embody", [p.slug]); });
    $("#pfExport").addEventListener("click", function () { exportPartMd(p); });
    $("#pfEdit").addEventListener("click", function () { editRaw(p.slug); });
    $("#pfDelete").addEventListener("click", function () {
      openSheet(
        '<h2 class="sheet-title serif">Delete ' + esc(p.name) + "?</h2>" +
        '<p class="dim">This removes the profile and its relationship edges ' +
        (AUTH.isLoggedIn()
          ? "from your account &mdash; every device you are signed in on, not just this one"
          : "from this device") +
        '. Export it first if you want to keep it.</p>' +
        '<button class="btn btn-danger btn-big" id="delYes">Delete forever</button>' +
        '<button class="btn btn-ghost btn-big" id="delNo">Keep it</button>'
      );
      $("#delYes").addEventListener("click", function () {
        ST.deletePart(p.slug); closeSheet(); closePanel(); renderParts(); toast(p.name + " deleted");
      });
      $("#delNo").addEventListener("click", closeSheet);
    });
  }

  /* One-field edit sheet: prose fields get a textarea, list fields get
     one-item-per-line. Saving updates the stored profile immediately - the
     exported .md, raw editor, and session prompts all read the same data. */
  function editFieldSheet(slug, key) {
    var p = ST.getPart(slug);
    if (!p) return;
    var isNarr = key.indexOf("narr:") === 0;
    var def, current;
    if (isNarr) {
      var nk = key.slice(5);
      var sec = S.NARRATIVE_SECTIONS.filter(function (x) { return x.key === nk; })[0];
      if (!sec) return;
      def = { kind: "prose", label: sec.title };
      current = p.narrative[nk] || "";
    } else {
      def = PROFILE_FIELDS[key];
      if (!def) return;
      current = p[key];
    }
    var value = def.kind === "list" ? (current || []).join("\n") : (current || "");
    openSheet(
      '<h2 class="sheet-title serif">' + esc(def.label) + "</h2>" +
      '<p class="dim">' + (def.kind === "list"
        ? "One per line - clearing a line removes it."
        : esc(def.hint || "Write it the way the part would recognize it.")) +
      " Saving updates " + esc(p.name) + "'s profile right away.</p>" +
      '<textarea id="efBox" style="min-height:' + (def.kind === "list" ? "120" : "150") + 'px">' + esc(value) + "</textarea>" +
      '<div style="height:12px"></div>' +
      '<button class="btn btn-primary btn-big" id="efSave">Save</button>'
    );
    $("#efSave").addEventListener("click", function () {
      var v = $("#efBox").value;
      if (isNarr) p.narrative[key.slice(5)] = v.trim();
      else if (def.kind === "list") p[key] = v.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
      else p[key] = v.trim();
      ST.upsertPart(p);
      closeSheet(); buzz(10);
      openProfile(slug);
      toast("Saved to " + p.name + "'s profile");
    });
  }

  /* The hero facts: type, felt age, body location, appearance, origin,
     trust in Self - all in one sheet. */
  function aboutSheet(slug) {
    var p = ST.getPart(slug);
    if (!p) return;
    openSheet(
      '<h2 class="sheet-title serif">About ' + esc(p.name) + "</h2>" +
      '<label class="fieldlabel">Type</label>' +
      '<div class="seg" id="abType">' +
      S.PART_TYPES.map(function (t) { return segBtn(t, t.charAt(0).toUpperCase() + t.slice(1), p.type); }).join("") +
      "</div>" +
      '<label class="fieldlabel">Felt age</label>' +
      '<input id="abAge" autocomplete="off" placeholder="about 7, teenage, ageless..." value="' + esc(p.age) + '">' +
      '<label class="fieldlabel">Where it lives in or around the body</label>' +
      '<input id="abLoc" autocomplete="off" placeholder="chest, behind the eyes..." value="' + esc(p.location) + '">' +
      '<label class="fieldlabel">What it looks like</label>' +
      '<input id="abApp" autocomplete="off" placeholder="a color, a figure, a shape..." value="' + esc(p.appearance) + '">' +
      '<label class="fieldlabel">Origin (headline only)</label>' +
      '<input id="abOrigin" autocomplete="off" placeholder="when and why it first showed up" value="' + esc(p.origin) + '">' +
      '<label class="fieldlabel">Trust in Self</label>' +
      '<div class="seg" id="abTrust">' +
      S.TRUST_LEVELS.map(function (t) { return segBtn(t, t, p.trust_in_self); }).join("") +
      "</div>" +
      '<div style="height:14px"></div>' +
      '<button class="btn btn-primary btn-big" id="abSave">Save</button>'
    );
    ["#abType", "#abTrust"].forEach(function (sel) {
      $(sel).addEventListener("click", function (e) {
        var b = e.target.closest("button"); if (!b) return;
        document.querySelectorAll(sel + " button").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on"); buzz();
      });
    });
    $("#abSave").addEventListener("click", function () {
      p.type = ($("#abType button.on") || { dataset: { val: p.type } }).dataset.val;
      p.trust_in_self = ($("#abTrust button.on") || { dataset: { val: p.trust_in_self } }).dataset.val;
      p.age = $("#abAge").value.trim();
      p.location = $("#abLoc").value.trim();
      p.appearance = $("#abApp").value.trim();
      p.origin = $("#abOrigin").value.trim();
      ST.upsertPart(p);
      closeSheet(); buzz(10);
      openProfile(slug);
      toast("Saved to " + p.name + "'s profile");
    });
  }

  /* Getting text off the device, in the order of what actually works.

     An installed PWA on iOS ignores <a download> entirely, and the old code
     called it, then reported success either way - so "export" looked like it
     had worked while producing nothing. It also declared the file as
     text/markdown, which iOS will not accept in a share sheet.

     So: share sheet first (text/plain, which iOS accepts, with the .md name
     preserved), then a real download, then the clipboard, and if all three
     fail, put the text on screen to select by hand. Every branch reports what
     truly happened. */
  function exportText(text, filename, onFallback, onSuccess) {
    var done = function (msg) { toast(msg); if (onSuccess) onSuccess(); };
    var blob = new Blob([text], { type: "text/plain" });
    var file = null;
    try { file = new File([blob], filename, { type: "text/plain" }); } catch (e) {}

    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      navigator.share({ files: [file] }).then(function () {
        done("Shared - keep it private");
      }, function (err) {
        // AbortError is the person tapping Cancel: not a failure, say nothing
        if (!err || err.name !== "AbortError") tryDownload(text, filename, blob, onFallback, done);
      });
      return;
    }
    tryDownload(text, filename, blob, onFallback, done);
  }

  function tryDownload(text, filename, blob, onFallback, done) {
    // a standalone PWA is exactly where <a download> silently does nothing
    var standalone = window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    if (!standalone && downloadBlob(blob, filename)) {
      done("Downloaded " + filename + " - keep it private");
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        done("Copied to the clipboard - paste it somewhere safe");
      }, function () { if (onFallback) onFallback(text, filename); });
      return;
    }
    if (onFallback) onFallback(text, filename);
  }

  /* Last resort: the text on screen, selectable, with nothing between the
     person and their own data. */
  function showTextToCopy(text, filename) {
    openPanel(filename, "select all, then copy",
      '<div class="profile">' +
      '<div class="readiness no">This device blocked both the share sheet and the download. ' +
      'The file is below &mdash; tap the box, select all, and copy.</div>' +
      '<textarea id="rawOut" readonly style="min-height:56vh;font:.8rem/1.5 ui-monospace,Consolas,monospace">' +
      esc(text) + "</textarea>" +
      '<div class="profile-cta"><button class="btn btn-primary btn-big" id="rawCopy">Copy it for me</button></div></div>');
    $("#rawOut").addEventListener("focus", function () { this.select(); });
    $("#rawCopy").addEventListener("click", function () {
      var box = $("#rawOut");
      box.select(); box.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) {}
      toast(ok ? "Copied" : "Copy blocked - select the text and copy by hand");
    });
  }

  function exportPartMd(p) {
    exportText(MD.serialize(p), p.slug + ".md", showTextToCopy);
  }

  /* Returns whether the download was actually initiated. */
  function downloadBlob(blob, name) {
    try {
      var a = document.createElement("a");
      if (typeof a.download === "undefined") return false; // no download support
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
      return true;
    } catch (e) {
      return false;
    }
  }

  function editRaw(slug) {
    var p = ST.getPart(slug);
    var md = MD.serialize(p);
    openPanel("Edit " + p.name, "raw parts/" + p.slug + ".md",
      '<div class="profile"><textarea id="rawMd" style="min-height:60vh;font:.82rem/1.5 ui-monospace,Consolas,monospace">' + esc(md) + "</textarea>" +
      '<div class="profile-cta"><button class="btn btn-primary btn-big" id="rawSave">Validate &amp; save</button></div></div>');
    $("#rawSave").addEventListener("click", function () {
      try {
        var np = MD.parse($("#rawMd").value);
        if (np.slug !== slug && !ST.renamePart(slug, np)) {
          toast("Not saved: another part is already called " + np.name);
          return;
        }
        if (np.slug === slug) ST.upsertPart(np);
        closePanel(); renderParts(); toast("Saved");
        openProfile(np.slug);
      } catch (e) { toast("Not saved: " + e.message); }
    });
  }

  /* ================= new session flows ================= */
  function newSessionSheet() {
    var parts = ST.listParts();
    var ready = parts.filter(function (p) { return S.readiness(p).ready; });
    var tb = ST.state.table;
    var seatedN = tb.built ? parts.filter(function (p) { return tb.seats[p.slug] === "table"; }).length : 0;
    var meetOn = tb.built ? parts.length >= 2 : ready.length >= 2;
    var meetSub = tb.built
      ? (seatedN >= 2 ? seatedN + " seated at your table" : "seat two parts at your table first")
      : (ready.length >= 2 ? "all developed parts respond; Self synthesizes" : "needs two developed parts");
    openSheet(
      '<h2 class="sheet-title serif">Start something</h2>' +
      '<div class="mi-head">Add a part</div>' +
      menuItem("", "Upload or paste", "one .md file, a whole parts folder, or raw notes", "mi-import") +
      menuItem("", "Meet a new part", "guided intake interview · 10-20 min", "mi-intake") +
      menuItem("", "Create by hand", "just a name is enough to start", "mi-create") +
      '<div class="mi-head">Get to know one</div>' +
      menuItem("", "Answer the IFS questions", parts.length ? "work through a category yourself · no AI needed" : "you need a part first", "mi-ask", !parts.length) +
      menuItem("", "Check in with a part", parts.length ? "AI session · deepens the profile" : "you need a part first", "mi-checkin", !parts.length) +
      '<div class="mi-head">Connect them</div>' +
      menuItem("", "Connect two parts", parts.length >= 2 ? "record how they relate · no AI needed" : "you need two parts first", "mi-link", parts.length < 2) +
      menuItem("", "Map two parts", parts.length >= 2 ? "AI session · who protects, who conflicts" : "you need two parts first", "mi-map", parts.length < 2) +
      '<div class="mi-head">Put them to work</div>' +
      menuItem("", "A part reacts to material", ready.length ? "embody one part over a document or decision" : "no part is developed enough yet", "mi-embody", !ready.length) +
      // once a room exists, seating - not the readiness bar - governs meetings
      menuItem("", "Table meeting", meetSub, "mi-meeting", !meetOn)
    );
    bind("#mi-intake", function () { closeSheet(); startSession("intake", []); });
    bind("#mi-create", function () { createPartSheet(""); });
    bind("#mi-ask", function () {
      pickPart("Which part are you asking?", function (slug) {
        var p = ST.getPart(slug);
        var next = Q.nextCategory(p);
        if (!next) { openProfile(slug); toast("Every category is covered or declined - tap one to revisit"); return; }
        askCategory(slug, next);
      });
    });
    bind("#mi-checkin", function () { pickPart("Who do you want to check in with?", function (slug) { startSession("checkin", [slug]); }); });
    bind("#mi-link", function () {
      pickParts("Which two parts relate?", 2, 2, false, function (slugs) {
        relationshipSheet(slugs[0], slugs[1]);
      });
    });
    bind("#mi-map", function () {
      pickParts("Which two parts should we map?", 2, 2, false, function (slugs) { startSession("mapping", slugs); });
    });
    bind("#mi-embody", function () { pickPart("Which part should react?", function (slug) { askMaterial("embody", [slug]); }, true); });
    bind("#mi-meeting", function () {
      // with a room built, seating is the single source of truth for who
      // attends - otherwise the prompt seats nobody and the meeting is empty
      var tb = ST.state.table;
      if (tb.built) {
        var atTable = ST.listParts().filter(function (p) { return tb.seats[p.slug] === "table"; });
        closeSheet();
        if (atTable.length < 2) {
          showView("table");
          toast("Seat at least two parts at the table first");
          return;
        }
        askMaterial("meeting", atTable.map(function (p) { return p.slug; }));
        return;
      }
      pickParts("Who takes a seat at the table?", 2, 99, true, function (slugs) { askMaterial("meeting", slugs); });
    });
    bind("#mi-import", importSheet);
  }

  var MENU_ICONS = {
    "mi-intake": "✧",            // sparkle
    "mi-checkin": "◎",           // bullseye
    "mi-map": "🕸",         // web
    "mi-embody": "📄",      // document
    "mi-meeting": "🕯",     // candle
    "mi-import": "⤓",            // down arrow
    "mi-create": "✎",            // pencil
    "mi-ask": "?",
    "mi-link": "⇄"
  };

  function menuItem(icon, title, sub, id, disabled) {
    var safe = MENU_ICONS[id] || icon;
    return '<button class="menu-item" id="' + id + '"' + (disabled ? " disabled" : "") + '>' +
      '<span class="mi-icon">' + safe + '</span><span class="mi-main">' + esc(title) +
      '<span class="mi-sub">' + esc(sub) + "</span></span></button>";
  }

  function bind(sel, fn) {
    var el = $(sel);
    if (el && !el.disabled) el.addEventListener("click", fn);
  }

  /* Multi-select picker: choose between min and max parts, then confirm.
     Only sends the chosen parts' profiles to the AI - no more than needed. */
  function pickParts(title, min, max, mustBeReady, cb) {
    var parts = ST.listParts().filter(function (p) { return !mustBeReady || S.readiness(p).ready; });
    openSheet(
      '<h2 class="sheet-title serif">' + esc(title) + "</h2>" +
      (mustBeReady ? '<p class="dim">Only parts developed enough to speak for themselves are listed.</p>' : "") +
      parts.map(function (p) {
        return '<button class="menu-item pk" data-slug="' + esc(p.slug) + '"><span class="mi-icon">' +
          esc(S.initial(p.name)) + '</span><span class="mi-main">' + esc(p.name) +
          '<span class="mi-sub">' + esc(p.type) + '</span></span><span class="pk-check">&#10003;</span></button>';
      }).join("") +
      '<div style="height:12px"></div>' +
      '<button class="btn btn-primary btn-big" id="pkGo" disabled>Choose ' + (min === max ? min : "at least " + min) + "</button>"
    );
    var chosen = [];
    var go = $("#pkGo");
    function refresh() {
      var ok = chosen.length >= min && chosen.length <= max;
      go.disabled = !ok;
      go.textContent = ok ? "Begin with " + chosen.length + " part" + (chosen.length > 1 ? "s" : "")
        : (chosen.length < min ? "Choose " + (min === max ? min : "at least " + min) : "Too many - at most " + max);
    }
    document.querySelectorAll("#sheetBody .pk").forEach(function (el) {
      el.addEventListener("click", function () {
        var slug = el.dataset.slug;
        var i = chosen.indexOf(slug);
        if (i >= 0) { chosen.splice(i, 1); el.classList.remove("on"); }
        else if (chosen.length < max) { chosen.push(slug); el.classList.add("on"); }
        buzz();
        refresh();
      });
    });
    go.addEventListener("click", function () { closeSheet(); cb(chosen.slice()); });
  }

  function pickPart(title, cb, mustBeReady, excludeSlug) {
    var parts = ST.listParts().filter(function (p) {
      return (!mustBeReady || S.readiness(p).ready) && p.slug !== excludeSlug;
    });
    openSheet(
      '<h2 class="sheet-title serif">' + esc(title) + "</h2>" +
      parts.map(function (p) {
        return '<button class="menu-item" data-slug="' + esc(p.slug) + '"><span class="mi-icon">' +
          esc(S.initial(p.name)) + '</span><span class="mi-main">' + esc(p.name) +
          '<span class="mi-sub">' + esc(p.type) + "</span></span></button>";
      }).join("")
    );
    document.querySelectorAll("#sheetBody .menu-item").forEach(function (el) {
      el.addEventListener("click", function () { closeSheet(); cb(el.dataset.slug); });
    });
  }

  function askMaterial(mode, slugs) {
    closeSheet();
    setTimeout(function () {
      openSheet(
        '<h2 class="sheet-title serif">' + (mode === "meeting" ? "What goes on the table?" : "What should it react to?") + "</h2>" +
        '<p class="dim">Paste anything real: a decision you are weighing, a plan, a budget, a draft, a journal entry.</p>' +
        '<textarea id="materialBox" placeholder="Paste or type the material..."></textarea>' +
        '<div style="height:12px"></div>' +
        '<button class="btn btn-primary btn-big" id="materialGo">Begin</button>'
      );
      $("#materialGo").addEventListener("click", function () {
        var mat = $("#materialBox").value.trim();
        if (!mat) { toast("The table needs material"); return; }
        closeSheet();
        startSession(mode, slugs, mat);
      });
    }, 240);
  }

  function importSheet() {
    closeSheet();
    setTimeout(function () {
      openSheet(
        '<h2 class="sheet-title serif">Add a part</h2>' +
        '<p class="dim">Paste <b>anything</b> &mdash; freeform journaling, notes about a part, a chat excerpt, or a saved profile. Raw text gets organized into the profile\'s fields automatically.</p>' +
        '<textarea id="importBox" placeholder="There\'s this voice that shows up whenever I..."></textarea>' +
        '<div style="height:10px"></div>' +
        '<div style="display:flex;gap:10px">' +
        '<button class="btn btn-soft" id="importFile" style="flex:1">Pick .md files</button>' +
        '<button class="btn btn-primary" id="importGo" style="flex:1">Add part</button>' +
        '</div>' +
        '<div id="importResult"></div>' +
        '<p class="dim" style="text-align:center;margin:14px 0 6px">prefer a blank form?</p>' +
        '<button class="btn btn-soft btn-big" id="importByHand">Create the part by hand instead</button>'
      );
      $("#importGo").addEventListener("click", function () { reviewImport($("#importBox").value); });
      $("#importByHand").addEventListener("click", function () { createPartSheet(""); });
      $("#importFile").addEventListener("click", function () {
        // analyze() already reads many profiles out of one blob - so a whole
        // parts/ folder imports by concatenating the files
        F.pickTextFiles({ accept: F.TEXT_ACCEPT, multiple: true, onStart: function (files) {
          var res = $("#importResult");
          if (res) {
            res.innerHTML = '<div class="readiness ok" style="margin-top:14px">Reading ' +
              files.length + (files.length === 1 ? " file" : " files") + "&hellip;</div>";
          }
        } }, function (r) {
          var res = $("#importResult");
          if (!res) return;                        // sheet closed while reading
          var trouble = F.trouble(r);
          if (!r.text.trim()) {
            res.innerHTML =
              '<div class="readiness no" style="margin-top:14px">' +
              esc(trouble || "That file came through empty.") + "</div>" +
              '<p class="dim" style="margin:8px 2px">If it lives in iCloud or Drive, open it there once so this device has its own copy, then try again &mdash; or open the file and paste the text into the box above.</p>';
            return;
          }
          var box = $("#importBox");
          if (box) box.value = r.text;
          reviewImport(r.text);
          if (trouble) toast(trouble);
        });
      });
    }, 240);
  }

  /* Field-by-field preview of one organized profile: what landed where, and
     an honest development % that reflects only what the text covered. */
  function previewFieldsHTML(p) {
    var rows = [];
    var row = function (label, val) {
      if (val == null || val === "" || (Array.isArray(val) && !val.length)) return;
      var body = Array.isArray(val)
        ? '<div class="taglist">' + val.map(function (x) { return "<span>" + esc(x) + "</span>"; }).join("") + "</div>"
        : esc(val);
      rows.push('<div class="prevrow"><b>' + label + "</b>" + body + "</div>");
    };
    row("Age", p.age);
    row("Where it lives", p.location);
    row("Origin", p.origin);
    row("Positive intent", p.positive_intent);
    row("Emotions", p.emotions);
    row("Fears", p.fears);
    row("Hopes & goals", p.hopes_goals);
    row("Behaviors", p.behaviors);
    row("Wants & needs", p.wants_needs);
    S.NARRATIVE_SECTIONS.forEach(function (sec) {
      var v = p.narrative[sec.key];
      if (v) row(sec.title, v.length > 220 ? v.slice(0, 220) + "…" : v);
    });
    var touched = S.CATEGORIES.filter(function (c) {
      return p.coverage[c] === "partial" || p.coverage[c] === "complete";
    });
    var covLine = touched.length
      ? "Covers: " + touched.map(function (c) { return S.CATEGORY_LABELS[c].toLowerCase(); }).join(", ")
      : "No categories covered yet";
    var exists = !!ST.getPart(p.slug);
    return '<div class="part-card" style="cursor:default;margin-top:12px">' +
      ringSVG(S.coverageScore(p), S.initial(p.name)) +
      '<div class="part-card-main"><div class="part-card-name">' + esc(p.name) +
      ' <span class="badge ' + esc(p.type) + '">' + esc(p.type) + "</span></div>" +
      '<div class="part-card-sub">' + (exists ? "updates your existing " + esc(p.name) : "new part") +
      " &middot; " + Math.round(S.coverageScore(p) * 100) + "% developed</div></div></div>" +
      '<div class="prevrows">' + rows.join("") + "</div>" +
      '<p class="dim" style="margin:10px 2px 0">' + esc(covLine) + ". Everything else stays unknown until a check-in &mdash; nothing was invented.</p>";
  }

  /* Show organized profile(s) ready to save. One profile gets the full
     field-by-field breakdown; several get compact cards. */
  function renderImportPreview(profiles, headline) {
    var box = $("#importResult");
    if (!box) return;
    var bodyHTML;
    if (profiles.length === 1) {
      bodyHTML = previewFieldsHTML(profiles[0]);
    } else {
      bodyHTML = profiles.map(function (p) {
        var exists = !!ST.getPart(p.slug);
        return '<div class="part-card" style="cursor:default">' +
          '<div class="part-card-main"><div class="part-card-name">' + esc(p.name) +
          ' <span class="badge ' + esc(p.type) + '">' + esc(p.type) + '</span></div>' +
          '<div class="part-card-sub">' + (exists ? "updates your existing " + esc(p.name) : "new part") +
          ' &middot; ' + Math.round(S.coverageScore(p) * 100) + '% developed</div></div></div>';
      }).join("");
    }
    box.innerHTML =
      '<div class="readiness ok" style="margin-top:14px">&#10003; ' + esc(headline) + '</div>' +
      bodyHTML +
      '<button class="btn btn-primary btn-big" id="importConfirm">' +
      (profiles.length === 1 ? "Add " + esc(profiles[0].name) + " to the library" : "Add all to library") + '</button>';
    $("#importConfirm").addEventListener("click", function () {
      profiles.forEach(function (p) { ST.mergePart(p); });
      closeSheet(); renderParts(); buzz(12);
      toast("Welcomed: " + profiles.map(function (p) { return p.name; }).join(", "));
      if (profiles.length === 1) openProfile(profiles[0].slug);
    });
    box.scrollIntoView({ block: "nearest" });
  }

  /* Analyze pasted/loaded text and render a preview into the import sheet.
     A formatted profile imports directly; anything else goes straight to AI
     organizing (no dead end). Nothing is saved until the person confirms. */
  function reviewImport(text) {
    var box = $("#importResult");
    if (!box) return;
    var res = MD.analyze(text);

    if (res.profiles.length) {
      renderImportPreview(res.profiles,
        res.profiles.length === 1 ? "Here's how that reads as a profile" : "Found " + res.profiles.length + " profiles");
      return;
    }

    if (res.salvage) {
      var p = res.salvage;
      var missingHTML = res.missing.length
        ? '<p class="dim" style="margin:8px 2px">Still missing: ' + esc(res.missing.join("; ")) + '. A check-in session (or two) will fill that in naturally.</p>'
        : "";
      box.innerHTML =
        '<div class="readiness no" style="margin-top:14px">That wasn\'t a complete profile, but I could read most of it.</div>' +
        '<div class="part-card" style="cursor:default"><div class="part-card-main">' +
        '<div class="part-card-name">' + esc(p.name) + ' <span class="badge ' + esc(p.type) + '">' + esc(p.type) + '</span></div>' +
        '<div class="part-card-sub">' + (ST.getPart(p.slug) ? "updates your existing " + esc(p.name) : "new part") + '</div></div></div>' +
        missingHTML +
        '<button class="btn btn-primary btn-big" id="importSalvage">Import what was found</button>';
      $("#importSalvage").addEventListener("click", function () {
        ST.mergePart(p);
        closeSheet(); renderParts(); buzz(12);
        toast("Welcomed: " + p.name);
        openProfile(p.slug);
      });
      return;
    }

    // Raw, unstructured text - the normal case. Organize it automatically.
    if (!text || !String(text).trim()) {
      box.innerHTML =
        '<div class="readiness no" style="margin-top:14px">Nothing to read yet</div>' +
        '<p class="dim" style="margin:8px 2px">Write or paste anything about the part first &mdash; even two sentences is plenty.</p>';
      return;
    }
    var s = ST.state.settings;
    if (s.provider !== "manual" && LLM.configured(s)) {
      shapeNotesWithAI(text);
      return;
    }
    rawFallbackOptions(text,
      "Sorting freeform notes automatically needs an AI provider (Settings &rarr; Live sessions). Without one:");
  }

  /* Manual mode / AI failure: real choices for raw text, never a dead end. */
  function rawFallbackOptions(text, leadHTML) {
    var box = $("#importResult");
    if (!box) return;
    box.innerHTML =
      '<p class="dim" style="margin:14px 2px 8px">' + leadHTML + '</p>' +
      '<button class="btn btn-primary btn-big" id="importGuided" style="margin-top:6px">Keep the notes and answer the questions yourself</button>' +
      '<p class="dim" style="margin:8px 2px">Creates the part with your text attached, then walks you through the IFS questions one at a time. No AI needed.</p>' +
      '<div style="display:flex;gap:10px;margin-top:12px">' +
      '<button class="btn btn-soft" id="importCopyPrompt" style="flex:1">Copy an AI prompt for this</button>' +
      '<button class="btn btn-soft" id="importSaveRaw" style="flex:1">Just save as notes</button>' +
      '</div>' +
      '<p class="dim" style="margin:8px 2px">The prompt bundles your text with organizing instructions &mdash; paste it into any AI chat, then paste the reply back here.</p>';
    $("#importGuided").addEventListener("click", function () { closeSheet(); createPartSheet("", text, true); });
    $("#importCopyPrompt").addEventListener("click", function () { copyConvertPrompt(text); });
    $("#importSaveRaw").addEventListener("click", function () { closeSheet(); createPartSheet("", text); });
  }

  /* Organize raw text into profile fields via the LLM, then show the
     field-by-field preview - nothing saves unseen. */
  async function shapeNotesWithAI(text) {
    var box = $("#importResult");
    if (!box) return;
    var go = $("#importGo");
    if (go) { go.disabled = true; go.textContent = "Organizing…"; }
    box.innerHTML =
      '<div class="readiness ok" style="margin-top:14px">Organizing your notes into a profile&hellip;</div>' +
      '<p class="dim" style="margin:8px 2px">Only what your text actually says goes in. The development % will reflect just the ground it covers.</p>';
    try {
      var reply = await LLM.chat(ST.state.settings, T.convertNotes(), [{ role: "user", text: text }]);
      if (!$("#importResult")) return; // sheet closed while waiting
      var res = MD.analyze(reply);
      if (res.profiles.length) {
        renderImportPreview(res.profiles, "Organized into a profile - check it over");
      } else {
        rawFallbackOptions(text, "The AI reply didn't come back as a usable profile. Try Add part again, or:");
      }
    } catch (e) {
      if ($("#importResult")) {
        rawFallbackOptions(text, esc(e.message) + " Try Add part again in a moment, or:");
      }
    } finally {
      var go2 = $("#importGo");
      if (go2) { go2.disabled = false; go2.textContent = "Add part"; }
    }
  }

  /* No-AI-configured fallback: hand over a copy-paste prompt (system
     instructions + the person's own text bundled together) for any outside
     AI chat, mirroring manual-mode sessions elsewhere in the app. */
  function copyConvertPrompt(text) {
    var full = T.convertNotes() + "\n\n## The notes to convert\n\n" + text;
    navigator.clipboard.writeText(full).then(function () {
      toast("Prompt copied - paste it into any AI chat, then bring the reply back here");
      buzz();
    }, function () {
      toast("Copy failed - long-press to select the text instead");
    });
  }

  /* Create a part with a simple form - no file, no interview required.
     The profile starts thin on purpose; check-ins deepen it. rawNotes, if
     given, is preserved verbatim in Session notes rather than lost. */
  function createPartSheet(prefillName, rawNotes, thenAsk) {
    closeSheet();
    setTimeout(function () {
      openSheet(
        '<h2 class="sheet-title serif">Create a part by hand</h2>' +
        '<p class="dim">Just a name is enough &mdash; everything else can stay unknown and emerge in check-ins. Only write what you actually sense.</p>' +
        (rawNotes ? '<p class="dim">Your pasted text will be kept as Session notes on the part, untouched &mdash; a check-in (or the AI shaping option) can sort it into categories later.</p>' : "") +
        '<label class="fieldlabel">Name</label>' +
        '<input id="cpName" autocomplete="off" placeholder="The Critic, The Night Owl, the knot in my chest..." value="' + esc(prefillName || "") + '">' +
        '<label class="fieldlabel">Type &mdash; only if it\'s told you</label>' +
        '<div class="seg" id="cpType">' +
        segBtn("unknown", "Unknown", "unknown") + segBtn("manager", "Manager", "unknown") +
        segBtn("firefighter", "Firefighter", "unknown") + segBtn("exile", "Exile", "unknown") +
        '</div>' +
        '<label class="fieldlabel">Felt age (optional)</label>' +
        '<input id="cpAge" autocomplete="off" placeholder="about 7, teenage, ageless...">' +
        '<label class="fieldlabel">Where it lives in or around the body (optional)</label>' +
        '<input id="cpLoc" autocomplete="off" placeholder="chest, behind the eyes, hovering to my left...">' +
        '<label class="fieldlabel">How it tries to help (optional)</label>' +
        '<textarea id="cpIntent" placeholder="What do you sense it is trying to protect you from, or move you toward?"></textarea>' +
        '<div style="height:14px"></div>' +
        '<button class="btn btn-primary btn-big" id="cpSave">Create part</button>' +
        '<div id="cpMsg"></div>'
      );
      $("#cpType").addEventListener("click", function (e) {
        var b = e.target.closest("button"); if (!b) return;
        document.querySelectorAll("#cpType button").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on"); buzz();
      });
      $("#cpSave").addEventListener("click", function () {
        var name = $("#cpName").value.trim();
        var msg = $("#cpMsg");
        if (!name) {
          msg.innerHTML = '<div class="readiness no" style="margin-top:12px">It needs a name &mdash; even a working one like "the tight feeling" is fine.</div>';
          return;
        }
        var slug = S.slugify(name);
        var existing = ST.getPart(slug);
        if (existing) {
          msg.innerHTML =
            '<div class="readiness no" style="margin-top:12px">You already have a part called ' + esc(existing.name) + '.</div>' +
            '<button class="btn btn-soft btn-big" id="cpOpen" style="margin-top:8px">Open it instead</button>';
          $("#cpOpen").addEventListener("click", function () { closeSheet(); openProfile(slug); });
          return;
        }
        var p = S.blankPart(name);
        p.type = (document.querySelector("#cpType button.on") || {}).dataset ? document.querySelector("#cpType button.on").dataset.val : "unknown";
        p.age = $("#cpAge").value.trim();
        p.location = $("#cpLoc").value.trim();
        p.positive_intent = $("#cpIntent").value.trim();
        var cats = ["introduction"];
        p.coverage.introduction = "partial";
        if (p.positive_intent) { p.coverage.positive_intent = "partial"; cats.push("positive_intent"); }
        if (rawNotes) {
          p.narrative.session_notes = S.todayISO() + " - pasted notes, not yet sorted into categories:\n\n" + rawNotes;
        }
        p.sessions.push({ date: S.todayISO(), mode: "intake", categories: cats, note: rawNotes ? "profile started by hand, raw notes attached" : "profile started by hand" });
        ST.upsertPart(p);
        closeSheet(); renderParts(); buzz(12);
        toast("Welcome, " + p.name);
        if (thenAsk) askCategory(slug, Q.nextCategory(p));
        else openProfile(slug);
      });
    }, 240);
  }

  /* ================= guided questionnaire =================
     The no-AI path through the question bank: one question per screen, skip
     anything, decline the whole category. Answers write straight into the
     profile - the same fields a session would have filled. */
  function askCategory(slug, cat) {
    var p = ST.getPart(slug);
    if (!p) return;
    var qs = Q.forCategory(cat);
    if (!qs.length) return;
    var answers = [];
    var i = 0;
    var done = false;

    function finish(declined) {
      // closePanel() fires the panel's close handler, which lands back here -
      // one pass only, or the two call each other forever
      if (done) return;
      done = true;
      if (declined) {
        p.coverage[cat] = "declined";
        p.sessions.push({ date: S.todayISO(), mode: "checkin", categories: [cat],
          note: S.CATEGORY_LABELS[cat] + " declined - not to be re-asked" });
        ST.upsertPart(p);
        closePanel(); renderParts();
        toast(S.CATEGORY_LABELS[cat] + " closed - it won't be raised again");
        return;
      }
      if (!answers.length) { closePanel(); return; }

      var answered = Q.applyAnswers(p, cat, answers);
      p.narrative.session_notes = S.todayISO() + " - answered " + answered + " of " +
        qs.length + " " + S.CATEGORY_LABELS[cat].toLowerCase() + " questions.\n\n" +
        (p.narrative.session_notes || "");
      p.sessions.push({ date: S.todayISO(), mode: "checkin", categories: [cat],
        note: "guided questions: " + S.CATEGORY_LABELS[cat].toLowerCase() });

      // the introduction question can rename the part; move it properly
      var taken = null;
      if (S.slugify(p.name) !== slug) {
        if (!ST.renamePart(slug, p)) {
          taken = S.slugify(p.name);   // that name already belongs to someone
          p.slug = slug;
          ST.upsertPart(p);
        }
      } else {
        ST.upsertPart(p);
      }
      closePanel(); renderParts(); buzz(12);
      if (taken) {
        toast("A part is already called that - nothing was overwritten");
        setTimeout(function () { confirmMerge(p.slug, taken); }, 400);
        return;
      }
      afterGathering(p.slug, cat);
    }

    function step() {
      if (i >= qs.length) { finish(false); return; }
      var def = qs[i];
      openPanel(p.name, S.CATEGORY_LABELS[cat] + " · " + (i + 1) + " of " + qs.length,
        '<div class="profile">' +
        '<div class="qprogress"><i style="width:' + Math.round((i / qs.length) * 100) + '%"></i></div>' +
        '<div class="card"><h3>Ask ' + esc(p.name) + '</h3>' +
        '<div class="qtext serif">' + esc(def.q) + "</div></div>" +
        '<textarea id="qBox" placeholder="Write what it answers, in its words if you can. Blank is fine."></textarea>' +
        (def.list ? '<p class="dim" style="margin:6px 2px">One per line - each becomes its own entry.</p>' : "") +
        '<div class="profile-cta">' +
        '<button class="btn btn-primary btn-big" id="qNext">' + (i === qs.length - 1 ? "Save answers" : "Next question") + "</button>" +
        '<button class="btn btn-soft btn-big" id="qSkip">Skip this one</button>' +
        '<button class="btn btn-ghost btn-big" id="qDecline">It doesn\'t want to go here</button>' +
        "</div></div>",
        "",
        function () { if (answers.length) finish(false); return true; });

      $("#qNext").addEventListener("click", function () {
        var v = $("#qBox").value.trim();
        if (v) answers.push({ def: def, text: v });
        i++; buzz(); step();
      });
      $("#qSkip").addEventListener("click", function () { i++; buzz(); step(); });
      $("#qDecline").addEventListener("click", function () {
        openSheet(
          '<h2 class="sheet-title serif">Close ' + esc(S.CATEGORY_LABELS[cat].toLowerCase()) + "?</h2>" +
          '<p class="dim">Protectors set the pace. This category gets marked <b>declined</b> and nothing here will be asked again unless ' +
          esc(p.name) + " brings it up.</p>" +
          '<button class="btn btn-primary btn-big" id="qdYes">Yes, respect that</button>' +
          '<button class="btn btn-ghost btn-big" id="qdNo">Keep going</button>');
        bind("#qdYes", function () { closeSheet(); finish(true); });
        bind("#qdNo", closeSheet);
      });
    }
    step();
  }

  function splitLines(v) {
    return v.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  /* The step after gathering: connect the part up, or keep gathering. */
  function afterGathering(slug, justDid) {
    var p = ST.getPart(slug);
    var next = Q.nextCategory(p);
    var others = ST.listParts().filter(function (x) { return x.slug !== slug; });
    var unconnected = others.length && !(p.relationships || []).length;
    openSheet(
      '<h2 class="sheet-title serif">Saved to ' + esc(p.name) + "</h2>" +
      '<p class="dim">' + (justDid ? esc(S.CATEGORY_LABELS[justDid]) + " is recorded &middot; " : "") +
      Math.round(S.coverageScore(p) * 100) + "% developed</p>" +
      (unconnected ? menuItem("", "Connect " + p.name + " to another part", "how they protect, clash, or ally", "agLink") : "") +
      (next ? menuItem("", "Keep going: " + S.CATEGORY_LABELS[next], "the thinnest part of the profile", "agNext") : "") +
      menuItem("", "Open the profile", "see everything gathered so far", "agOpen")
    );
    bind("#agLink", function () { closeSheet(); connectPart(slug); });
    bind("#agNext", function () { closeSheet(); askCategory(slug, next); });
    bind("#agOpen", function () { closeSheet(); openProfile(slug); });
  }

  /* ================= merging duplicates =================
     Two profiles of the same part - one made by hand, one from an import or a
     session that named it slightly differently. Fold them into one without
     losing either side. */
  function mergePartSheet(slug) {
    var p = ST.getPart(slug);
    if (!p) return;
    pickPart("Which part is the same as " + p.name + "?", function (otherSlug) {
      confirmMerge(slug, otherSlug);
    }, false, slug);
  }

  function confirmMerge(aSlug, bSlug) {
    var keepSlug = aSlug;
    function render() {
      var keep = ST.getPart(keepSlug);
      var absorb = ST.getPart(keepSlug === aSlug ? bSlug : aSlug);
      if (!keep || !absorb) return;
      var merged = S.mergeDuplicate(keep, absorb);
      openSheet(
        '<h2 class="sheet-title serif">Merge into one part</h2>' +
        '<p class="dim">Nothing is thrown away: empty fields fill from the other side, ' +
        'lists combine, coverage takes the higher value, both session logs are kept, ' +
        'and anything written in the same section is joined rather than replaced. ' +
        'Relationships pointing at either half end up on the merged part.</p>' +
        '<label class="fieldlabel">Which name survives?</label>' +
        '<div class="seg" id="mgName" style="flex-direction:column;gap:3px">' +
        [aSlug, bSlug].map(function (s) {
          var x = ST.getPart(s);
          return '<button data-slug="' + esc(s) + '"' + (s === keepSlug ? ' class="on"' : "") +
            ' style="text-align:left;padding:11px 12px">' + esc(x.name) +
            ' <span class="dim">' + Math.round(S.coverageScore(x) * 100) + "% developed</span></button>";
        }).join("") +
        "</div>" +
        '<p class="dim" style="margin:12px 2px 0">Result &mdash; ' + esc(absorb.name) +
        " is absorbed and disappears from the library:</p>" +
        previewFieldsHTML(merged) +
        '<div style="height:12px"></div>' +
        '<button class="btn btn-primary btn-big" id="mgGo">Merge into ' + esc(keep.name) + "</button>" +
        '<button class="btn btn-ghost btn-big" id="mgNo">Keep them separate</button>'
      );
      $("#mgName").addEventListener("click", function (e) {
        var btn = e.target.closest("button"); if (!btn) return;
        keepSlug = btn.dataset.slug; buzz(); render();
      });
      bind("#mgNo", closeSheet);
      bind("#mgGo", function () {
        var absorbedName = absorb.name;
        var res = ST.absorbPart(keepSlug, absorb.slug);
        closeSheet(); buzz(12);
        renderParts();
        if (currentView === "map") renderMap();
        if (res) {
          openProfile(res.slug);
          toast(absorbedName + " merged into " + res.name);
        }
      });
    }
    render();
  }

  /* Pick another part, then reuse the map's relationship sheet. */
  function connectPart(slug) {
    pickPart("Connect " + ST.getPart(slug).name + " to which part?", function (other) {
      relationshipSheet(slug, other, function () { openProfile(slug); });
    }, false, slug);
  }

  /* ================= chat sessions ================= */
  var session = null; // {mode, slugs, material, system, messages, busy, closed}

  var MODE_TITLES = {
    intake: "Intake interview", checkin: "Check-in", mapping: "Relationship mapping",
    embody: "Embodied reaction", meeting: "Table meeting"
  };

  function buildSystem(mode, slugs, material) {
    var parts = slugs.map(ST.getPart).filter(Boolean);
    var sys =
      mode === "intake" ? T.intake() :
      mode === "checkin" ? T.checkin(parts[0]) :
      mode === "mapping" ? T.mapping(parts) :
      mode === "embody" ? T.embody(parts[0], material) :
      T.meeting(parts, material, ST.state.table);
    /* Copy-prompt sessions always carried pacing rules; live ones never did,
       so voice mode got the written cadence read aloud fast. */
    return ST.state.settings.voiceOn ? sys + "\n\n" + T.voicePacing() : sys;
  }

  /* ---------- the parts take their seats ----------
     A meeting is the one thing in this app where several parts are in the
     room at once, and it used to begin the way every other screen begins -
     a panel slides in and a model starts typing. This is the pause before
     that: the room is named, the parts arrive one at a time, and only then
     does the conversation open. It is short, skippable, and skipped entirely
     for anyone who has asked for reduced motion. */
  function seatingCeremony(slugs, done) {
    var t = ST.state.table;
    var parts = slugs.map(ST.getPart).filter(Boolean);
    var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!parts.length || reduced) { done(); return; }

    var el = $("#seating");
    var timers = [];
    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      el.classList.add("hidden");
      el.classList.remove("go");
      done();
    }

    $("#seatingRoom").textContent = t.name || "The room";
    $("#seatingLine").textContent = "";
    $("#seatingChairs").innerHTML = parts.map(function (p, i) {
      return '<span class="chair" style="--d:' + (i * 340 + 260) + 'ms">' +
        '<span class="chair-i">' + esc(S.initial(p.name)) + "</span>" +
        '<span class="chair-n">' + esc(p.name) + "</span></span>";
    }).join("");

    el.classList.remove("hidden");
    // next frame, so the entrance animations actually run from their start
    requestAnimationFrame(function () { el.classList.add("go"); });
    buzz(14);

    var last = parts.length * 340 + 260;
    timers.push(setTimeout(function () {
      $("#seatingLine").textContent = parts.length === 1
        ? "one part is here"
        : "everyone is seated";
    }, last));
    timers.push(setTimeout(finish, last + 900));

    el.onclick = finish;
    $("#seatingSkip").onclick = function (e) { e.stopPropagation(); finish(); };
  }

  function startSession(mode, slugs, material) {
    closeSheet();
    var s = ST.state.settings;
    if (s.provider === "manual" || !LLM.configured(s)) {
      manualSession(mode, slugs, material);
      return;
    }
    var begin = function () {
      session = {
        mode: mode, slugs: slugs, material: material || "",
        system: buildSystem(mode, slugs, material),
        messages: [], busy: false, closed: false
      };
      openChatPanel(session, false);
    };
    if (mode === "meeting") seatingCeremony(slugs, begin);
    else begin();
  }

  /* Rebuild a checkpointed session (drafts survive tab death / app close). */
  function resumeDraft() {
    var d = ST.state.draft;
    if (!d) return;
    var s = ST.state.settings;
    if (s.provider === "manual" || !LLM.configured(s)) {
      toast("Set up an AI provider in Settings to resume this session");
      return;
    }
    var slugs = (d.slugs || []).filter(function (sl) { return !!ST.getPart(sl); });
    if (d.mode !== "intake" && !slugs.length) {
      ST.clearDraft(); renderParts();
      toast("That draft's part no longer exists - draft removed");
      return;
    }
    session = {
      mode: d.mode, slugs: slugs, material: d.material || "",
      system: buildSystem(d.mode, d.mode === "intake" ? [] : slugs, d.material || ""),
      messages: (d.messages || []).slice(), busy: false, closed: false
    };
    openChatPanel(session, true);
  }

  function saveDraft() {
    if (!session || session.closed) return;
    ST.setDraft({
      mode: session.mode, slugs: session.slugs, material: session.material,
      messages: session.messages, updated: S.todayISO(),
      title: MODE_TITLES[session.mode]
    });
  }

  function openChatPanel(sess, replay) {
    var s = ST.state.settings;
    var partNames = sess.slugs.map(function (sl) { var p = ST.getPart(sl); return p ? p.name : sl; }).join(", ");
    var voiceCapable = V.canSpeak() || V.canListen();
    openPanel(
      MODE_TITLES[sess.mode],
      partNames || "a new part",
      '<div class="chat">' +
      '<button class="groundbtn" id="groundBtn">&#9875; ground me</button>' +
      '<div class="chat-scroll" id="chatScroll">' +
      '<div class="msg system-note">Private session · ' + esc(s.provider) + " · saved as you go · you can stop anytime</div>" +
      "</div>" +
      '<div class="voice-orb idle" id="voiceOrb" aria-live="polite"><i></i><span class="vo-label"></span></div>' +
      '<div class="chat-input">' +
      (V.canListen() ? '<button class="micbtn" id="chatMic" aria-label="Dictate">&#127908;</button>' : "") +
      '<textarea id="chatBox" rows="1" placeholder="Speak as yourself or as the part..."></textarea>' +
      '<button class="sendbtn" id="chatSend" aria-label="Send">&#8593;</button>' +
      "</div></div>",
      (voiceCapable ? '<button class="btn btn-soft' + (s.voiceOn ? " voice-on" : "") + '" id="voiceToggle" style="padding:8px 14px;font-size:.8rem">&#128266; Voice</button>' : "") +
      '<button class="btn btn-soft" id="endSession" style="padding:8px 14px;font-size:.8rem">End &amp; save</button>',
      function () {
        if (session && session.messages.length && !session.closed) {
          if (!confirm("Pause this session? It stays saved as a draft - resume it anytime from the Parts tab.")) return false;
        }
        V.stopSpeaking(); V.stopListening();
        session = null;
        renderParts();
        return true;
      }
    );
    $("#groundBtn").addEventListener("click", showGrounding);
    $("#endSession").addEventListener("click", endSession);
    var box = $("#chatBox");
    box.addEventListener("input", function () {
      box.style.height = "auto";
      box.style.height = Math.min(box.scrollHeight, 130) + "px";
    });
    box.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && matchMedia("(min-width: 760px)").matches) {
        e.preventDefault(); sendChat();
      }
    });
    $("#chatSend").addEventListener("click", sendChat);
    var mic = $("#chatMic");
    if (mic) mic.addEventListener("click", function () {
      if (V.isListening()) { V.stopListening(); micState(false); }
      else startDictation(false);
    });
    var vt = $("#voiceToggle");
    if (vt) vt.addEventListener("click", function () {
      s.voiceOn = !s.voiceOn; ST.save();
      vt.classList.toggle("voice-on", s.voiceOn);
      buzz();
      /* the pacing rules ride in the system prompt, so toggling mid-session
         has to rebuild it or the model keeps the cadence it started with */
      if (session) session.system = buildSystem(session.mode, session.slugs, session.material);
      if (s.voiceOn) {
        toast(V.canListen() ? "Voice mode: replies are spoken, mic opens after each one"
                            : "Voice mode: replies are spoken aloud (no mic support in this browser)");
        if (V.canListen() && !session.busy) startDictation(true);
      } else {
        V.stopSpeaking(); V.stopListening(); micState(false);
        toast("Voice mode off");
      }
    });

    /* First time in a live session, say what is about to happen before it
       happens - a meeting and an interview ask different things of the person
       sitting there, so they get different cues. */
    var cue = document.createElement("div");
    cue.className = "chat-coach";
    $("#chatScroll").appendChild(cue);
    if (!mountCoach(cue, sess.mode === "meeting" ? "meeting" : "session")) cue.remove();

    if (replay) {
      sess.messages.forEach(function (m) {
        if (!m.hidden) addMsg(m.role, m.role === "assistant" ? stripFences(m.text) : m.text);
      });
    } else {
      // kick off: the model opens the session
      pump("Please begin the session.", true);
    }
  }

  function addMsg(role, text) {
    var scroll = $("#chatScroll");
    if (!scroll) return null;
    var div = document.createElement("div");
    div.className = "msg " + role;
    scroll.appendChild(div);
    setMsgText(div, text);
    return div;
  }

  function setMsgText(div, text) {
    var isAssistant = div.classList.contains("assistant");
    if (isAssistant && session && session.mode === "meeting") {
      div.innerHTML = renderVoices(text);
    } else {
      div.innerHTML = "";
      var b = document.createElement("div");
      b.className = "bubble";
      b.textContent = text;
      div.appendChild(b);
    }
    var scroll = $("#chatScroll");
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }

  /* Table meetings: split an assistant turn into per-speaker voice bubbles
     wherever the model wrote "**Name:**". Falls back to a plain bubble. */
  var VOICE_PALETTE = ["#7c9ce8", "#e87c6a", "#b48ce8", "#7fc98b", "#e8b45a", "#6ac4c9"];
  function voiceColor(name) {
    if (/^self$/i.test(name)) return "var(--self)";
    if (session) {
      for (var i = 0; i < session.slugs.length; i++) {
        var p = ST.getPart(session.slugs[i]);
        if (p && p.name.toLowerCase() === name.toLowerCase()) return VOICE_PALETTE[i % VOICE_PALETTE.length];
      }
    }
    var h = 0;
    for (var j = 0; j < name.length; j++) h = (h * 31 + name.charCodeAt(j)) >>> 0;
    return VOICE_PALETTE[h % VOICE_PALETTE.length];
  }

  /* A meeting reads as a group chat: every part's initial and name sit above
     its own message, in that part's colour, the way a room full of people
     talking is legible and a wall of prose is not. Two lines in a row from
     the same speaker merge under one header rather than repeating it.
     No entrance animation here on purpose - this re-runs on every streamed
     chunk, and anything that animates would restart on each one. */
  function renderVoices(text) {
    var segs = MD.splitVoices(text);
    if (!segs.some(function (s) { return s.name; })) {
      return '<div class="bubble">' + esc(text) + "</div>";
    }
    var groups = [];
    segs.forEach(function (s) {
      var body = s.text.trim();
      if (s.name && !body) return;              // a name with nothing after it yet
      var prev = groups[groups.length - 1];
      if (prev && prev.name && s.name && prev.name.toLowerCase() === s.name.toLowerCase()) {
        prev.text += "\n\n" + body;
        return;
      }
      groups.push({ name: s.name, text: body });
    });
    return groups.filter(function (g) { return g.name || g.text; }).map(function (g) {
      if (!g.name) return '<div class="bubble">' + esc(g.text) + "</div>";
      var selfV = /^self$/i.test(g.name);
      return '<div class="voice' + (selfV ? " self-voice" : "") + '" style="--vc:' + voiceColor(g.name) + '">' +
        '<span class="vhead"><span class="vava">' + esc(S.initial(g.name)) + "</span>" +
        '<span class="vname">' + esc(g.name) + "</span></span>" +
        '<span class="vbody">' + esc(g.text) + "</span></div>";
    }).join("");
  }

  /* ---------- voice mode ---------- */
  function micState(on) {
    var mic = $("#chatMic");
    if (mic) mic.classList.toggle("listening", !!on);
  }

  /* One dictation turn. autoSend: hands-free voice mode sends the final
     transcript itself; manual mic taps leave it in the box to review. */
  function startDictation(autoSend) {
    if (!session || V.isListening()) return;
    var sess = session;
    micState(true);
    var ok = V.listen({
      onInterim: function (t) {
        var box = $("#chatBox");
        if (box && session === sess) { box.value = t; box.dispatchEvent(new Event("input")); }
      },
      onEnd: function (finalText) {
        micState(false);
        if (session !== sess) return;
        var box = $("#chatBox");
        if (box && finalText) { box.value = finalText; box.dispatchEvent(new Event("input")); }
        if (autoSend && finalText && ST.state.settings.voiceOn && !sess.busy) sendChat();
      },
      onError: function (msg) { micState(false); toast(msg); },
      onInterrupt: function () { toast("Heard that - the mic will wait longer before it closes"); }
    });
    if (!ok) micState(false);
  }

  /* Whose turn it is, said without words. In voice mode the person is often
     not looking at the screen, but when they do glance down this is the one
     thing they need to know. */
  function voiceState(state) {
    var el = $("#voiceOrb");
    if (!el) return;
    el.className = "voice-orb " + (state || "idle");
    el.querySelector(".vo-label").textContent =
      state === "speaking" ? "speaking" :
      state === "listening" ? "listening" :
      state === "thinking" ? "thinking" : "";
    micState(state === "listening");
  }

  /* After an assistant reply in voice mode: speak it with the microphone
     already open, so cutting in works and the turn passes without a tap. */
  function voiceAfterReply(sess, reply) {
    if (!ST.state.settings.voiceOn || session !== sess) return;
    V.exchange(stripFences(reply), {
      onState: function (st) { if (session === sess) voiceState(st); },
      onInterim: function (t) {
        var box = $("#chatBox");
        if (box && session === sess) { box.value = t; box.dispatchEvent(new Event("input")); }
      },
      onBargeIn: function () { buzz(12); },   // felt, so it is clear the voice stopped for them
      onInterrupt: function () { toast("Heard that - the mic will wait longer before it closes"); },
      onEnd: function (finalText) {
        if (session !== sess || sess.closed) return;
        var box = $("#chatBox");
        if (box && finalText) { box.value = finalText; box.dispatchEvent(new Event("input")); }
        if (finalText && ST.state.settings.voiceOn && !sess.busy) sendChat();
      },
      onError: function (msg) { voiceState("idle"); toast(msg); }
    });
  }

  function typingEl() {
    var scroll = $("#chatScroll");
    var div = document.createElement("div");
    div.className = "msg assistant";
    div.innerHTML = '<div class="bubble typing"><i></i><i></i><i></i></div>';
    scroll.appendChild(div);
    scroll.scrollTop = scroll.scrollHeight;
    return div;
  }

  function setBusy(b) {
    if (!session) return;
    session.busy = b;
    var send = $("#chatSend");
    if (send) send.disabled = b;
  }

  /* Show streamed text as it arrives, but never stream a raw profile block
     into view - cut at the first fence. */
  function previewText(t) {
    var i = t.indexOf("```");
    return i < 0 ? t : t.slice(0, i).trim() + "\n… writing the profile …";
  }

  async function pump(userText, hidden) {
    if (!session || session.busy) return null;
    var sess = session;
    sess.messages.push({ role: "user", text: userText, hidden: !!hidden });
    var userBubble = hidden ? null : addMsg("user", userText);
    setBusy(true);
    if (ST.state.settings.voiceOn) voiceState("thinking");
    var tip = typingEl();
    var live = null;
    try {
      var reply = await LLM.chatStream(ST.state.settings, sess.system,
        sess.messages.map(function (m) { return { role: m.role, text: m.text }; }),
        function (fullText) {
          if (session !== sess) return;
          if (!live) { tip.remove(); live = addMsg("assistant", ""); }
          setMsgText(live, previewText(fullText));
        });
      sess.messages.push({ role: "assistant", text: reply });
      if (session === sess) {
        if (live) setMsgText(live, stripFences(reply));
        else { tip.remove(); addMsg("assistant", stripFences(reply)); }
        buzz(6);
        if (!hidden || sess.messages.length <= 2) voiceAfterReply(sess, reply);
      }
      saveDraft();
      return reply;
    } catch (e) {
      if (tip.parentNode) tip.remove();
      if (live) live.remove();
      sess.messages.pop(); // let them retry the same turn
      if (userBubble) userBubble.remove();
      if (!hidden && session === sess) {
        var box = $("#chatBox");
        if (box) { box.value = userText; box.dispatchEvent(new Event("input")); }
      }
      var note = document.createElement("div");
      note.className = "msg system-note";
      note.textContent = e.message;
      var scroll = $("#chatScroll");
      if (scroll) { scroll.appendChild(note); scroll.scrollTop = scroll.scrollHeight; }
      return null;
    } finally {
      if (session === sess) setBusy(false);
    }
  }

  function stripFences(text) {
    // don't render giant profile blocks inside chat bubbles
    return text.replace(/```(?:markdown|md|yaml)?\s*\n[\s\S]*?```/g, "— profile updated —").trim();
  }

  function sendChat() {
    var box = $("#chatBox");
    var v = box.value.trim();
    if (!v || !session || session.busy) return;
    V.stopSpeaking(); V.stopListening(); micState(false);
    box.value = ""; box.style.height = "auto";
    buzz();
    pump(v);
  }

  async function endSession() {
    if (!session || session.busy) return;
    V.stopSpeaking(); V.stopListening(); micState(false);
    var sess = session;
    var interviewish = ["intake", "checkin", "mapping"].indexOf(sess.mode) >= 0;
    var reply = null;
    if (interviewish && sess.messages.length > 1) {
      toast("Closing gently and writing the profile...");
      reply = await pump(T.CLOSE_INSTRUCTION, true);
      if (!session) return; // user navigated away mid-close
      if (reply == null) { closeFailedSheet(); return; } // nothing lost - offer retry
    }
    if (!session) return;
    finalizeSession(sess, reply, interviewish);
  }

  /* The close call failed (rate limit, network). The conversation is intact
     and checkpointed - give real choices instead of silently dropping work. */
  function closeFailedSheet() {
    openSheet(
      '<h2 class="sheet-title serif">The profile didn\'t get written</h2>' +
      '<p class="dim">The AI call failed while closing (the error is in the chat). Nothing is lost &mdash; the whole conversation is still here and saved as a draft.</p>' +
      '<button class="btn btn-primary btn-big" id="closeRetry">Try closing again</button>' +
      '<div style="height:8px"></div>' +
      '<button class="btn btn-soft btn-big" id="closeSaveOnly">Save the transcript without a profile</button>' +
      '<p class="dim" style="margin:8px 2px">You can extract the profile from a saved transcript later, under Settings &rarr; Your data.</p>' +
      '<button class="btn btn-ghost btn-big" id="closeStay">Keep talking instead</button>'
    );
    bind("#closeRetry", function () { closeSheet(); endSession(); });
    bind("#closeSaveOnly", function () {
      closeSheet();
      if (session) finalizeSession(session, null, true);
    });
    bind("#closeStay", closeSheet);
  }

  /* What the model wrote, merged onto what's already stored, shown before it
     saves. Anything the model left out is kept, so a thin closing reply can
     never quietly delete a field. */
  function reviewMerge(incoming, done) {
    var merged = incoming.map(function (p) { return S.mergeParts(ST.getPart(p.slug), p); });
    openSheet(
      '<h2 class="sheet-title serif">' + (merged.length === 1 ? "Update " + esc(merged[0].name) + "?" : "Update " + merged.length + " profiles?") + "</h2>" +
      '<p class="dim">Merged onto what you already had &mdash; nothing the session skipped gets erased.</p>' +
      (merged.length === 1 ? previewFieldsHTML(merged[0])
        : merged.map(function (p) {
            return '<div class="part-card" style="cursor:default"><div class="part-card-main">' +
              '<div class="part-card-name">' + esc(p.name) + '</div><div class="part-card-sub">' +
              Math.round(S.coverageScore(p) * 100) + "% developed</div></div></div>";
          }).join("")) +
      '<div style="height:12px"></div>' +
      '<button class="btn btn-primary btn-big" id="rmSave">Save to ' + (merged.length === 1 ? esc(merged[0].name) + "'s profile" : "all profiles") + "</button>" +
      '<button class="btn btn-ghost btn-big" id="rmSkip">Keep the transcript only</button>'
    );
    bind("#rmSave", function () {
      merged.forEach(function (p) { ST.upsertPart(p); });
      closeSheet(); renderParts(); buzz(12);
      done(merged);
    });
    bind("#rmSkip", function () { closeSheet(); done([]); });
  }

  function finalizeSession(sess, reply, interviewish) {
    sess.closed = true;

    var incoming = [];
    if (reply) {
      try { incoming = MD.extractProfiles(reply); } catch (e) { console.error(e); }
    }
    // log meeting/embody sessions on the parts without profile rewrite
    if (!interviewish) {
      sess.slugs.forEach(function (sl) {
        var p = ST.getPart(sl);
        if (!p || !S.readiness(p).ready) return;
        p.sessions.push({ date: S.todayISO(), mode: "meeting", categories: [], note: MODE_TITLES[sess.mode] });
        ST.upsertPart(p);
      });
    }

    // save transcript
    var visible = sess.messages.filter(function (m) { return !m.hidden; });
    var transcriptId = "";
    if (visible.length) {
      var text = visible.map(function (m) {
        return (m.role === "user" ? "YOU: " : "GUIDE: ") + m.text;
      }).join("\n\n");
      transcriptId = ST.addTranscript({
        date: S.todayISO(), mode: sess.mode,
        title: MODE_TITLES[sess.mode] + (sess.slugs.length ? " · " + sess.slugs.map(function (sl) { var p = ST.getPart(sl); return p ? p.name : sl; }).join(", ") : ""),
        parts: sess.slugs, text: text
      });
    }

    /* A meeting used to leave nothing behind but a transcript filed away
       under Settings, so the one event where the whole system sat down
       together was also the one that vanished fastest. Keep a card: who was
       there, what was on the table, where each part landed, and what Self
       made of it. Built from the transcript, so it costs no extra call.
       Colours are resolved while `session` is still live, which is what makes
       the card match the meeting the person just watched. */
    var meetingId = "";
    if (sess.mode === "meeting") {
      var names = sess.slugs.map(function (sl) { var p = ST.getPart(sl); return p ? p.name : sl; });
      var turns = sess.messages.filter(function (m) { return m.role === "assistant" && !m.hidden; })
        .map(function (m) { return stripFences(m.text); });
      var sum = MD.summarizeMeeting(turns, names);
      if (sum.voices.length || sum.synthesis) {
        sum.voices.forEach(function (v) { v.color = voiceColor(v.name); });
        meetingId = ST.addMeeting({
          date: S.todayISO(),
          topic: MD.firstSentences(sess.material, 1, 90),
          parts: sess.slugs.slice(),
          voices: sum.voices,
          synthesis: sum.synthesis,
          transcript: transcriptId
        });
      }
    }
    ST.clearDraft();
    var wasMeeting = sess.mode === "meeting";
    /* The last question of the script, and the only one that changes the map:
       who felt what toward whom by the end. Offered rather than asked, like
       everything else here, and read off the slugs before the session is
       dropped. */
    var roundSlugs = wasMeeting ? sess.slugs.slice() : [];
    session = null;
    panelOnClose = null;
    closePanel();
    renderParts();
    if (wasMeeting) renderTable();   // the new card belongs on the tab behind this

    var round = function (delay) {
      if (roundSlugs.length < 2) return false;
      setTimeout(function () { offerRound(roundSlugs, meetingId); }, delay);
      return true;
    };

    if (!incoming.length) {
      toast(interviewish ? "Transcript saved - extract it anytime from Settings" : "Session saved");
      round(700);
      return;
    }
    reviewMerge(incoming, function (saved) {
      if (!saved.length) { toast("Transcript kept - profiles unchanged"); round(700); return; }
      toast("Profile saved: " + saved.map(function (p) { return p.name; }).join(", "));
      if (round(500)) return;
      // one part, freshly deepened, still floating alone -> offer to connect it
      var p = saved.length === 1 ? ST.getPart(saved[0].slug) : null;
      if (p && !(p.relationships || []).length && ST.listParts().length > 1) {
        setTimeout(function () { afterGathering(p.slug, null); }, 400);
      }
    });
  }

  /* ---------- manual (copy-prompt) mode ---------- */
  function manualSession(mode, slugs, material) {
    var parts = slugs.map(ST.getPart).filter(Boolean);
    var prompt = T.portable(mode, parts, material, ST.state.table);
    openPanel(MODE_TITLES[mode], "copy-prompt mode",
      '<div class="profile">' +
      '<div class="card"><h3>How this works</h3><div class="prose">1. Copy the prompt below.\n2. Paste it into any AI chat you trust (Claude, ChatGPT, Gemini...).\n3. Have the session there.\n4. When it ends, the model outputs an updated profile - paste that back here with the Import button.</div></div>' +
      '<button class="btn btn-primary btn-big" id="copyPrompt">Copy the full prompt</button>' +
      '<div style="height:10px"></div>' +
      (navigator.share ? '<button class="btn btn-soft btn-big" id="sharePrompt">Share to another app</button><div style="height:10px"></div>' : "") +
      '<button class="btn btn-soft btn-big" id="pasteBack">Paste the updated profile back</button>' +
      '<div class="card" style="margin-top:16px"><h3>The prompt</h3><div class="prose" style="max-height:38vh;overflow:auto;font-size:.78rem">' + esc(prompt) + "</div></div>" +
      "</div>");
    $("#copyPrompt").addEventListener("click", function () {
      navigator.clipboard.writeText(prompt).then(function () { toast("Prompt copied"); buzz(); },
        function () { toast("Copy failed - long-press the prompt text instead"); });
    });
    var sh = $("#sharePrompt");
    if (sh) sh.addEventListener("click", function () {
      navigator.share({ text: prompt }).catch(function () {});
    });
    $("#pasteBack").addEventListener("click", importSheet);
  }

  /* ================= grounding ================= */
  var breathTimer = null;
  function showGrounding() {
    $("#ground").classList.remove("hidden");
    buzz(20);
    var label = $("#breathLabel");
    var phase = 0;
    label.textContent = "breathe in";
    clearInterval(breathTimer);
    breathTimer = setInterval(function () {
      phase = 1 - phase;
      label.textContent = phase ? "breathe out" : "breathe in";
    }, 4000);
  }
  function hideGrounding() {
    $("#ground").classList.add("hidden");
    clearInterval(breathTimer);
  }

  /* ================= map ================= */
  var mapTone = null;  // null = show everything, else "positive"|"negative"|"unknown"
  var keyOpen = false; // the key is closed until it is asked for

  /* The swatch a tone filter carries, and the dot the key button wears while
     that filter is the one switched on. Both are the map's own colours. */
  var TONE_SWATCH = {
    positive: '<i class="sw ln allied"></i>',
    negative: '<i class="sw ln polarized"></i>',
    unknown: '<i class="sw ln faint"></i>'
  };
  var TONE_COLOR = { positive: "var(--good)", negative: "var(--warn)", unknown: "var(--ink-faint)" };

  /* One row of the key: a swatch in the same 26px column the lines use, what
     it means, and a line under it saying why it looks like that. */
  function keyRow(swatch, label, sub) {
    return '<div class="lgrow">' + swatch + "<span>" + label +
      (sub ? "<small>" + sub + "</small>" : "") + "</span></div>";
  }

  /* The key. Its first section is the three tones, which are filters as well
     as a read on how much of the system is still unmapped; the rest is the
     map's vocabulary written out - what each thread style is saying, what a
     round of the table writes onto a thread that nobody has named, and what a
     part's colour and its fading mean. Rendered fresh on every open, because
     every count in it moves. */
  function renderLegend(parts) {
    var c = S.mapCounts(parts);

    var filter = function (tone) {
      return '<button class="lg' + (mapTone === tone ? " on" : "") + '" data-tone="' + tone + '">' +
        TONE_SWATCH[tone] + "<span>" + esc(S.TONE_LABELS[tone]) + "</span><b>" + c[tone] + "</b></button>";
    };

    /* The five schema edge types, in the order the relationship sheet offers
       them, plus the thread drawn for a pair nobody has answered for yet. */
    var named =
      keyRow('<i class="sw ln protects"></i>', "Protects",
             "the arrow points at the part being shielded") +
      keyRow('<i class="sw ln allied"></i>', "Allied",
             "they work together") +
      keyRow('<i class="sw ln polarized"></i>', "Polarized",
             "pulling opposite ways on the same thing") +
      keyRow('<i class="sw ln conflicts"></i>', "In conflict",
             "open friction between them") +
      keyRow('<i class="sw ln faint"></i>', "Not asked yet",
             "parts sharing a system already relate &mdash; tap the thread to name it") +
      keyRow('<i class="sw wedge"></i>', "Thicker",
             "more has been said about the pair &mdash; in a mapping session, at the table, or both") +
      keyRow('<i class="sw fade"></i>', "Fainter",
             "neither part, and neither the two together, has been sat with lately");

    /* What a round of the table does to the map: it gives a thread substance
       and a tone without anyone naming an edge type for it. */
    var felt =
      keyRow('<i class="sw ln felt warm"></i>', "Felt warm",
             "unnamed, and the readings came back warm or close") +
      keyRow('<i class="sw ln felt cool"></i>', "Felt cool",
             "unnamed, and the readings came back wary or hostile") +
      keyRow('<i class="sw ln felt"></i>', "Felt, neither way",
             "they sat together and it came out neutral, which is an answer");

    var scale = S.FEELINGS.map(function (f) {
      return keyRow('<i class="sw fdot ' + S.feelingTone(f.val) + '"></i>',
        "<b>" + esc(f.label) + "</b>", esc(f.blurb));
    }).join("");

    var readOut = c.readings
      ? c.readings + (c.readings === 1 ? " reading" : " readings") +
        " on " + c.rated + " of " + c.pairs + (c.pairs === 1 ? " pair" : " pairs")
      : "none taken yet";

    var note = '<p class="lg-note">At the end of a table meeting each part is asked, ' +
      "in its own voice, how it is feeling toward every other part in the room right now. " +
      "A reading is <b>directed</b> and dated &mdash; never mirrored onto the other part, because " +
      "what one feels is rarely what comes back &mdash; and it thickens the thread between them a " +
      "little more with every round, faster when <b>both</b> sides answer. " +
      (c.mutual
        ? c.mutual + (c.mutual === 1 ? " pair has" : " pairs have") + " answered both ways."
        : "A pair only one side has answered for is a claim, not yet an account.") +
      " A part may pass, and passing records nothing.</p>";

    var partRows =
      keyRow('<i class="sw dot self"></i>', "Self",
             "pinned at the top; everything else is arranged around it") +
      keyRow('<i class="sw dot manager"></i>', "Manager", "a proactive protector") +
      keyRow('<i class="sw dot firefighter"></i>', "Firefighter", "a reactive protector") +
      keyRow('<i class="sw dot exile"></i>', "Exile", "a young hurt part the protectors shield") +
      keyRow('<i class="sw dot unknown"></i>', "Not typed yet", "") +
      keyRow('<i class="sw dot lit"></i>', "Sat with lately",
             "it keeps a light on; a part left alone recedes without leaving") +
      (ST.state.table.built
        ? keyRow('<i class="sw fade"></i>', "Distance from Self",
                 "once a table exists, where a part sits is how far out it is drawn")
        : "");

    $("#mapLegend").innerHTML =
      '<header class="lg-head"><h3 class="serif" id="mapLegendTitle">Map key</h3>' +
      '<button class="iconbtn" id="lgClose" aria-label="Close the key">&times;</button></header>' +
      '<div class="lg-body">' +
      '<section><h4>Threads <small>tap to filter</small></h4>' +
      filter("positive") + filter("negative") + filter("unknown") +
      '<div class="lg-hint">' +
      (mapTone ? "tap it again to show every thread" : "showing all " + c.pairs +
        (c.pairs === 1 ? " pair" : " pairs") + " &middot; " + c.named + " named") +
      "</div></section>" +
      "<section><h4>What a thread says</h4>" + named + "</section>" +
      '<section><h4>Round the table <small>' + readOut + "</small></h4>" +
      felt + scale + note + "</section>" +
      "<section><h4>Parts</h4>" + partRows + "</section>" +
      "</div>";

    $("#lgClose").addEventListener("click", closeKey);
    document.querySelectorAll("#mapLegend .lg").forEach(function (el) {
      el.addEventListener("click", function () {
        mapTone = mapTone === el.dataset.tone ? null : el.dataset.tone;
        buzz();
        G.refresh();
        renderLegend(ST.listParts());
        setKeyButton();
      });
    });
  }

  /* Closed, the button still has to say whether a filter is on: a map drawing
     a third of its threads with the reason folded away is a bug report. */
  function setKeyButton() {
    var btn = $("#mapKeyBtn");
    if (!btn) return;
    btn.classList.toggle("filtered", !!mapTone);
    btn.setAttribute("aria-expanded", keyOpen ? "true" : "false");
    $("#mapKeyLabel").textContent = mapTone ? S.TONE_LABELS[mapTone] : "Key";
    $("#mapKeySwatch").style.background = mapTone ? TONE_COLOR[mapTone] : "";
  }

  function openKey() {
    keyOpen = true;
    renderLegend(ST.listParts());
    $("#mapLegend").classList.remove("hidden");
    $("#mapLegendScrim").classList.remove("hidden");
    $("#mapWrap").classList.add("key-open");
    setKeyButton();
    buzz();
    $("#mapLegend").focus();
  }

  function closeKey() {
    if (!keyOpen) return;
    keyOpen = false;
    $("#mapLegend").classList.add("hidden");
    $("#mapLegendScrim").classList.add("hidden");
    $("#mapWrap").classList.remove("key-open");
    setKeyButton();
  }

  /* The button and the part card share the bottom of the screen, so the key
     steps aside while a part is focused - and takes any open panel with it. */
  function showKeyButton(on) {
    if (!on) closeKey();
    $("#mapKeyBtn").classList.toggle("hidden", !on);
  }

  function renderMap() {
    var parts = ST.listParts();
    var svg = $("#swarmSvg");
    var has = parts.length > 0;
    // the threads only make sense once there is more than one part to string
    // them between, so the cue waits for the map to have something to say
    if (parts.length > 1) renderCoach("#mapCoach", "map");
    else $("#mapCoach").innerHTML = "";
    mapTone = null;
    closeKey();
    setKeyButton();
    $("#mapEmpty").classList.toggle("hidden", has);
    showKeyButton(has);
    $("#mapHint").classList.toggle("hidden", !has);
    $("#mapCard").classList.add("hidden");
    $("#mapHint").textContent = parts.length > 1
      ? "tap a thread to name it · thicker means more said"
      : "tap a part · drag to move · pinch to zoom";
    if (has) {
      // the key renders when it is opened, not here: every count in it moves
      G.render(svg, parts, {
        tone: function () { return mapTone; },
        seats: ST.state.table.built ? ST.state.table.seats : null,
        onEdge: function (aSlug, bSlug) { relationshipSheet(aSlug, bSlug); },
        onSelect: function (node) {
            var card = $("#mapCard");
            // the card and the key button share the bottom of the screen:
            // while a part is focused the card is what matters
            var show = function (on) { showKeyButton(!on); };
            if (!node || node.self) { card.classList.add("hidden"); show(false); return; }
            var p = ST.getPart(node.id);
            if (!p) { card.classList.add("hidden"); show(false); return; }
            var edges = (p.relationships || []).length;
            var open = parts.length - 1 - edges;
            var sub = edges && open ? edges + " mapped, " + open + " open"
                    : edges ? edges + " mapped"
                    : open ? open + " to name"
                    : "the only part so far";
            // once a room exists, where it sits is the more useful fact
            if (ST.state.table.built) {
              sub = R.seatLabel(ST.state.table.seats[p.slug] || "away").toLowerCase() + " · " + sub;
            }
            card.innerHTML =
              '<span class="mc-name">' + esc(p.name) +
              '<span class="mc-sub">' + esc(p.type) + " &middot; " + sub + "</span></span>" +
              '<button class="btn btn-primary" id="mcOpen">Open</button>';
            card.classList.remove("hidden");
            show(true);
            $("#mcOpen").addEventListener("click", function () { openProfile(p.slug); });
            buzz();
        }
      });
    } else {
      G.stop(); svg.innerHTML = "";
    }
  }

  /* A link was drawn between two parts: ask how they relate, then write the
     mirrored edge and the person's description to BOTH profiles. */
  function relationshipSheet(aSlug, bSlug, after) {
    var a = ST.getPart(aSlug), b = ST.getPart(bSlug);
    if (!a || !b) return;
    var existing = (a.relationships || []).filter(function (r) { return r.part === bSlug; })[0];
    var fAB = S.getFeeling(a, bSlug), fBA = S.getFeeling(b, aSlug);
    // grouped by tone, so the choice reads as supportive / in tension first
    // and the exact IFS edge type second
    var groups = [
      { tone: "positive", options: [
        { val: "allied-with", label: "Allied — they work together" },
        { val: "protects", label: a.name + " protects " + b.name },
        { val: "protected-by", label: b.name + " protects " + a.name }
      ] },
      { tone: "negative", options: [
        { val: "conflicts-with", label: "In conflict — they clash" },
        { val: "polarized-with", label: "Polarized — locked in a tug-of-war" }
      ] }
    ];
    openSheet(
      '<h2 class="sheet-title serif">' + esc(a.name) + " &amp; " + esc(b.name) + "</h2>" +
      '<p class="dim">' + (existing
        ? "Mapped as <b>" + esc(existing.type.replace(/-/g, " ")) + "</b> — saving replaces it on both profiles."
        : "These two share a system, so something already passes between them. Name it, or just say how each feels about the other, and it is written to both profiles.") + "</p>" +
      '<div class="seg" id="relType" style="flex-direction:column;gap:3px">' +
      groups.map(function (grp) {
        return '<div class="rel-tone ' + grp.tone + '">' + esc(S.TONE_LABELS[grp.tone]) + "</div>" +
          grp.options.map(function (o) {
            return '<button data-val="' + o.val + '"' + (existing && existing.type === o.val ? ' class="on"' : "") +
              ' style="text-align:left;padding:11px 12px">' + esc(o.label) + "</button>";
          }).join("");
      }).join("") +
      "</div>" +
      '<label class="fieldlabel">Describe the relationship</label>' +
      '<textarea id="relNote" placeholder="What happens between them? e.g. when one pushes to publish, the other floods me with doubt...">' + esc((existing && existing.notes) || "") + "</textarea>" +
      '<label class="fieldlabel">How each feels toward the other, right now</label>' +
      '<p class="dim" style="margin:0 2px 10px">Optional, and each side answers for itself. Every reading thickens this thread on the map.</p>' +
      '<div id="relFeel">' +
      likertRowHTML(b, fAB && fAB.rating, fAB && fAB.prev, a.name + " \u2192 " + b.name) +
      likertRowHTML(a, fBA && fBA.rating, fBA && fBA.prev, b.name + " \u2192 " + a.name) +
      "</div>" +
      '<div style="height:14px"></div>' +
      '<button class="btn btn-primary btn-big" id="relSave">' + (existing ? "Update both profiles" : "Add to both profiles") + "</button>" +
      (existing
        ? '<button class="btn btn-ghost btn-big" id="relClear">Unmap — put it back to unknown</button>'
        : '<button class="btn btn-ghost btn-big" id="relSkip">Leave it unmapped for now</button>') +
      '<div id="relMsg"></div>'
    );
    bindLikert("#relFeel");
    bind("#relSkip", closeSheet);
    bind("#relClear", function () {
      clearEdge(aSlug, bSlug);
      closeSheet(); buzz(12);
      if (currentView === "map") renderMap();
      if (after) after();
      toast("Unmapped — " + a.name + " and " + b.name + " are back to an open question");
    });
    $("#relType").addEventListener("click", function (e) {
      var btn = e.target.closest("button"); if (!btn) return;
      document.querySelectorAll("#relType button").forEach(function (x) { x.classList.remove("on"); });
      btn.classList.add("on"); buzz();
    });
    $("#relSave").addEventListener("click", function () {
      var sel = document.querySelector("#relType button.on");
      /* A row's data-to is who the reading is *about*, so the other part of
         the pair is the one who gave it. */
      var picked = readLikert("#relFeel");
      var readings = {};
      Object.keys(picked).forEach(function (to) {
        var from = to === bSlug ? aSlug : bSlug;
        (readings[from] = readings[from] || {})[to] = picked[to];
      });
      var anyRead = Object.keys(readings).length > 0;
      if (!sel && !anyRead) {
        $("#relMsg").innerHTML = '<div class="readiness no" style="margin-top:12px">Pick how they relate, or take a reading.</div>';
        return;
      }
      // the edge first: applyRound re-reads each part from the store, so
      // writing it second would drop whatever drawEdge had just put there
      if (sel) drawEdge(aSlug, bSlug, sel.dataset.val, $("#relNote").value.trim());
      var changes = anyRead ? applyRound(readings, S.todayISO()) : [];
      closeSheet(); buzz(12);
      renderParts();
      if (currentView === "map") renderMap();
      if (after) after();
      var read = changes.length + (changes.length === 1 ? " reading" : " readings");
      toast(sel
        ? "Mapped: " + a.name + " & " + b.name +
          (changes.length ? " — saved with " + read : " — saved to both profiles")
        : read + " saved — the thread has thickened");
    });
  }

  /* Write one mapped relationship to both parts: mirrored edges, honest
     coverage, a mapping entry in each session log, and the description woven
     into each part's "How it relates to other parts". */
  function drawEdge(aSlug, bSlug, type, note) {
    var a = ST.getPart(aSlug), b = ST.getPart(bSlug);
    if (!a || !b) return;
    var mirror = S.EDGE_MIRROR[type];
    a.relationships = (a.relationships || []).filter(function (r) { return r.part !== bSlug; });
    b.relationships = (b.relationships || []).filter(function (r) { return r.part !== aSlug; });
    a.relationships.push({ part: bSlug, type: type, notes: note });
    b.relationships.push({ part: aSlug, type: mirror, notes: note });
    [a, b].forEach(function (p) {
      if (p.coverage.relationships === "untouched") p.coverage.relationships = "partial";
    });
    var addNarrative = function (p, other, t) {
      var line = S.todayISO() + " - " + other.name + " (" + t.replace(/-/g, " ") + ")" + (note ? ": " + note : "");
      p.narrative.relates_to_others = (p.narrative.relates_to_others ? p.narrative.relates_to_others + "\n\n" : "") + line;
      p.sessions.push({
        date: S.todayISO(), mode: "mapping", categories: ["relationships"],
        note: "relationship with " + other.name + " drawn on the map"
      });
    };
    addNarrative(a, b, type);
    addNarrative(b, a, mirror);
    ST.upsertPart(a);
    ST.upsertPart(b);
  }

  /* Drop a mapped edge from both sides, back to the honest "we haven't asked"
     state. The narrative lines stay - they are a record of what was said. */
  function clearEdge(aSlug, bSlug) {
    [[aSlug, bSlug], [bSlug, aSlug]].forEach(function (pair) {
      var p = ST.getPart(pair[0]);
      if (!p) return;
      p.relationships = (p.relationships || []).filter(function (r) { return r.part !== pair[1]; });
      if (!p.relationships.length && p.coverage.relationships === "partial") {
        p.coverage.relationships = "untouched";
      }
      ST.upsertPart(p);
    });
  }

  /* ================= readings: a round of the table =================
     A meeting is the one time every part is in the room together, and it used
     to end leaving the map exactly as it found it. This is the last question
     of the script, asked of each part in turn: "how are you feeling toward
     the others right now?" - the practitioner's Self-check, turned around and
     asked of a part about its neighbour. Five points, directed, dated. The
     answers thicken the threads between those parts on the map, a little more
     with every meeting they sit through, so a system that keeps meeting looks
     like one. */

  /* One neighbour, five points. The last reading is shown but never
     pre-selected: a round that records itself when someone taps Next would
     thicken the map on nobody's word. */
  function likertRowHTML(target, current, prev, heading) {
    var said = current
      ? "last: " + S.feelingLabel(current).toLowerCase() +
        (prev ? ", was " + S.feelingLabel(prev).toLowerCase() : "")
      : "";
    return '<div class="rt-row" data-to="' + esc(target.slug) + '">' +
      '<div class="rt-head"><span class="rt-who">' + esc(heading || target.name) + "</span>" +
      (said ? '<span class="rt-said">' + esc(said) + "</span>" : "") + "</div>" +
      '<div class="likert">' + S.FEELINGS.map(function (f) {
        return '<button data-val="' + f.val + '" title="' + esc(f.blurb) + '">' +
          '<span class="lk-n">' + f.val + "</span>" + esc(f.label) + "</button>";
      }).join("") + "</div></div>";
  }

  /* Pills are single-choice per row. Bound to the rows themselves rather than
     to #panelBody, which survives every openPanel and would stack a listener
     per step of the round. */
  function bindLikert(scope) {
    document.querySelectorAll(scope + " .rt-row").forEach(function (row) {
      row.addEventListener("click", function (ev) {
        var btn = ev.target.closest("button[data-val]");
        if (!btn) return;
        row.querySelectorAll(".likert button").forEach(function (x) { x.classList.remove("on"); });
        btn.classList.add("on");
        buzz();
      });
    });
  }

  /* What is currently picked under `scope`, as { toSlug: rating }. */
  function readLikert(scope) {
    var out = {};
    document.querySelectorAll(scope + " .rt-row").forEach(function (row) {
      var on = row.querySelector(".likert button.on");
      if (on) out[row.dataset.to] = +on.dataset.val;
    });
    return out;
  }

  /* Write a round to the parts that gave it. Readings live on the rater, not
     on the pair: what The Critic feels toward The Dreamer is The Critic's to
     say, and the reverse may be nothing like it. `dateISO` is the day the
     round belongs to, which for a meeting recorded after the fact is that
     meeting's date and not today. Returns what changed, so the round can be
     shown back rather than only saved. */
  function applyRound(picked, dateISO) {
    var changes = [];
    Object.keys(picked).forEach(function (from) {
      var p = ST.getPart(from);
      if (!p) return;
      var rows = picked[from];
      var said = [];
      Object.keys(rows).forEach(function (to) {
        var other = ST.getPart(to);
        if (!other || to === from) return;
        var before = S.getFeeling(p, to);
        var set = S.setFeeling(p, to, rows[to], dateISO);
        if (!set) return;
        said.push(other.name + ": " + S.feelingLabel(rows[to]).toLowerCase());
        changes.push({ from: p.name, to: other.name, rating: rows[to],
                       was: before ? before.rating : 0,
                       // false when a back-filled round sits behind a newer
                       // reading: it still counts, but it is not where they
                       // stand now, and saying so would be a lie
                       current: set.current });
      });
      if (!said.length) return;
      // a reading is something said about relationships, so the coverage flag
      // climbs exactly the way drawing an edge makes it climb
      if (p.coverage.relationships === "untouched") p.coverage.relationships = "partial";
      p.narrative.relates_to_others = (p.narrative.relates_to_others ? p.narrative.relates_to_others + "\n\n" : "") +
        dateISO + " - round the table: " + said.join("; ") + ".";
      p.sessions.push({
        date: dateISO, mode: "mapping", categories: ["relationships"],
        note: "rated how it feels toward " + said.length + (said.length === 1 ? " part" : " parts") + " at the table"
      });
      ST.upsertPart(p);
    });
    return changes;
  }

  /* The round, shown back. The number that matters is not the rating but the
     move: a part that was wary and is now merely neutral is the whole reason
     for sitting down together, and it is invisible in a profile field. */
  function roundSummarySheet(changes, when) {
    // a round recorded against a past meeting sits behind whatever has been
    // said since, so the sheet says so rather than claiming it is the news
    var filed = changes.filter(function (c) { return !c.current; }).length;
    openSheet(
      '<h2 class="sheet-title serif">The round is in</h2>' +
      '<p class="dim">' + changes.length + (changes.length === 1 ? " reading" : " readings") +
      (when ? " from " + esc(when) : "") +
      ", saved to the part that gave it. The threads between them have thickened on the map." +
      (filed
        ? " " + (filed === changes.length
            ? (filed === 1 ? "It sits behind a more recent reading, so it is"
                           : "They all sit behind more recent readings, so they are")
            : (filed === 1 ? "One of them sits behind a more recent reading, so it is"
                           : filed + " of them sit behind more recent readings, so they are")) +
          " kept as history rather than as where those parts stand now."
        : "") +
      "</p>" +
      changes.map(function (c) {
        var delta = c.was ? c.rating - c.was : 0;
        var move = !c.current ? "filed as history"
          : (!c.was ? "first reading" : (delta > 0 ? "warmer" : (delta < 0 ? "cooler" : "unchanged")));
        return '<div class="shiftrow"><span>' + esc(c.from) + " &rarr; " + esc(c.to) + "</span>" +
          '<span class="dim">' + esc(S.feelingLabel(c.rating).toLowerCase()) + "</span>" +
          '<span class="sh-move ' + (c.current ? (delta > 0 ? "up" : (delta < 0 ? "down" : "")) : "") + '">' +
          esc(move) + "</span></div>";
      }).join("") +
      '<div style="height:14px"></div>' +
      '<button class="btn btn-primary btn-big" id="rtMap">See it on the map</button>' +
      '<button class="btn btn-ghost btn-big" id="rtDone">Close</button>'
    );
    bind("#rtMap", function () { closeSheet(); showView("map"); });
    bind("#rtDone", closeSheet);
  }

  /* One screen per part: it rates every other part in the round at once, or
     passes. Passing is a real answer - a part that will not say how it feels
     about another has said something - so nothing is recorded for it.

     opts.date puts the round on the day it belongs to rather than today,
     which is how a meeting held weeks ago can still get its round. */
  function roundOfTheTable(slugs, opts) {
    opts = opts || {};
    var parts = slugs.map(ST.getPart).filter(Boolean);
    if (parts.length < 2) { toast("A round needs two parts still in your library"); return; }
    var when = opts.date || S.todayISO();
    var past = when !== S.todayISO();
    var picked = {};
    var i = 0, done = false;

    function finish() {
      if (done) return;
      done = true;
      var changes = applyRound(picked, when);
      closePanel();
      renderParts();
      renderTable();
      if (currentView === "map") renderMap();
      if (!changes.length) { toast("Nothing recorded - the round is always optional"); return; }
      if (opts.meetingId) {
        var m = ST.state.table.meetings.filter(function (x) { return x.id === opts.meetingId; })[0];
        // a round finished in two sittings adds to the card rather than
        // replacing what the first one recorded
        ST.updateMeeting(opts.meetingId, { readings: ((m && m.readings) || 0) + changes.length });
      }
      buzz(12);
      setTimeout(function () { roundSummarySheet(changes, past ? when : ""); }, 260);
    }

    function step() {
      if (i >= parts.length) { finish(); return; }
      var p = parts[i];
      var others = parts.filter(function (x) { return x.slug !== p.slug; });
      openPanel("Round the table", p.name + " \u00b7 " + (i + 1) + " of " + parts.length,
        '<div class="profile">' +
        '<div class="qprogress"><i style="width:' + Math.round((i / parts.length) * 100) + '%"></i></div>' +
        '<div class="card"><div class="qtext serif">How are you, ' + esc(p.name) +
        ", feeling toward each of the others" + (past ? "?" : " right now?") + "</div>" +
        '<div class="prose dim" style="margin-top:10px">Answer as ' + esc(p.name) +
        ", in its voice. Leave any of them blank - a part that will not say is answering too." +
        (past ? " This round belongs to the meeting of " + esc(when) +
          ", so answer as it stood at the end of that one." : "") + "</div></div>" +
        others.map(function (o) {
          var f = S.getFeeling(p, o.slug);
          return likertRowHTML(o, f && f.rating, f && f.prev);
        }).join("") +
        '<div class="profile-cta">' +
        '<button class="btn btn-primary btn-big" id="rtNext">' +
        (i === parts.length - 1 ? "Finish the round" : "Next part") + "</button>" +
        '<button class="btn btn-soft btn-big" id="rtPass">' + esc(p.name) + " passes</button>" +
        "</div></div>", "",
        function () { if (Object.keys(picked).length) finish(); return true; });

      bindLikert("#panelBody");
      $("#rtNext").addEventListener("click", function () {
        var rows = readLikert("#panelBody");
        if (Object.keys(rows).length) picked[p.slug] = rows;
        i++; buzz(); step();
      });
      $("#rtPass").addEventListener("click", function () { i++; buzz(); step(); });
    }
    step();
  }

  /* Offered the moment a meeting closes, while the room is still in mind. */
  function offerRound(slugs, meetingId) {
    if (slugs.filter(function (sl) { return !!ST.getPart(sl); }).length < 2) return;
    openSheet(
      '<h2 class="sheet-title serif">Before everyone leaves</h2>' +
      '<p class="dim">The parts are still in the room. Ask each of them how it is feeling toward the others right now, and the threads between them thicken on the map &mdash; a little more with every meeting they sit through.</p>' +
      '<button class="btn btn-primary btn-big" id="orGo">Round the table</button>' +
      '<button class="btn btn-ghost btn-big" id="orNo">Not this time</button>'
    );
    bind("#orGo", function () {
      closeSheet();
      setTimeout(function () { roundOfTheTable(slugs, { meetingId: meetingId }); }, 220);
    });
    bind("#orNo", closeSheet);
  }

  /* ================= the table =================
     Fraser's Table as a place that persists, rather than a chat that
     evaporates. The room is built once through the document's own questions,
     then edited; parts are invited to a seat, never assigned one. */
  function renderTable() {
    var t = ST.state.table;
    var parts = ST.listParts();
    renderCoach("#tableCoach", "table");
    $("#tableEmpty").classList.toggle("hidden", !!t.built);
    $("#tablePane").classList.toggle("hidden", !t.built);
    if (!t.built) return;

    var seatGroups = R.SEATS.map(function (seat) {
      var inSeat = parts.filter(function (p) { return (t.seats[p.slug] || "away") === seat.id; });
      if (!inSeat.length) return "";
      return '<div class="seatgroup"><div class="seat-head">' + esc(seat.label) +
        ' <span class="dim">' + esc(seat.blurb) + "</span></div>" +
        inSeat.map(function (p) {
          return '<button class="seatchip" data-seat-slug="' + esc(p.slug) + '">' +
            '<span class="sc-i">' + esc(S.initial(p.name)) + "</span>" + esc(p.name) + "</button>";
        }).join("") + "</div>";
    }).join("");

    var seated = parts.filter(function (p) { return t.seats[p.slug] === "table"; });

    $("#tablePane").innerHTML =
      '<div class="room-card">' +
      '<h2 class="serif room-name">' + esc(t.name || "The room") + "</h2>" +
      '<div class="prose">' + esc(t.room) + "</div>" +
      (t.details ? '<div class="prose dim" style="margin-top:10px">' + esc(t.details) + "</div>" : "") +
      '<button class="chip chip-btn" id="tbEditRoom">&#9998; edit the room</button>' +
      "</div>" +

      '<div class="card"><h3>Who is here' +
      '<button class="cardedit" id="tbInvite" aria-label="Invite parts">&#9998;</button></h3>' +
      (parts.length
        ? (seatGroups || '<div class="prose none">nobody has been invited yet</div>')
        : '<div class="prose none">no parts yet - meet one on the Parts tab first</div>') +
      "</div>" +

      '<div class="card"><h3>Tools in the room' +
      '<button class="cardedit" id="tbTools" aria-label="Choose tools">&#9998;</button></h3>' +
      (t.tools.length
        ? t.tools.map(function (x) {
            return '<div class="sessionrow"><span>' + esc(x.label) +
              (x.note ? ' <span class="dim">' + esc(x.note) + "</span>" : "") + "</span></div>";
          }).join("")
        : '<div class="prose none">none yet - a talking stick, lighting, a break signal</div>') +
      "</div>" +

      '<div class="card"><h3>Agreements' +
      '<button class="cardedit" id="tbAgree" aria-label="Edit agreements">&#9998;</button></h3>' +
      (t.agreements.length ? tagList(t.agreements)
        : '<div class="prose none">what would help everyone feel more at ease?</div>') +
      "</div>" +

      (t.meetings.length
        ? '<div class="card"><h3>What happened here</h3>' +
          t.meetings.slice().reverse().map(meetingCardHTML).join("") + "</div>"
        : "") +

      (t.log.length
        ? '<div class="card"><h3>Closing reflections</h3>' + t.log.slice().reverse().map(function (m, i) {
            return '<div class="sessionrow logrow" data-log="' + (t.log.length - 1 - i) + '">' +
              '<span class="sr-date">' + esc(m.date) + "</span><span>" +
              esc(m.note || "closing reflection") + "</span></div>";
          }).join("") + "</div>"
        : "") +

      '<div class="profile-cta">' +
      '<button class="btn btn-primary btn-big" id="tbMeet"' + (seated.length >= 2 ? "" : " disabled") + ">Hold a meeting" +
      (seated.length >= 2 ? "" : " (seat two parts first)") + "</button>" +
      (seated.length >= 2
        ? '<button class="btn btn-soft btn-big" id="tbRound">Round the table</button>'
        : "") +
      '<button class="btn btn-soft btn-big" id="tbClose">Closing reflection</button>' +
      "</div>";

    document.querySelectorAll("#tablePane [data-seat-slug]").forEach(function (el) {
      el.addEventListener("click", function () { seatSheet(el.dataset.seatSlug); });
    });
    document.querySelectorAll("#tablePane [data-meeting]").forEach(function (el) {
      el.addEventListener("click", function () { openMeeting(el.dataset.meeting); });
    });
    document.querySelectorAll("#tablePane [data-log]").forEach(function (el) {
      el.addEventListener("click", function () { openClosingLog(+el.dataset.log); });
    });
    bind("#tbEditRoom", function () { buildTable(true); });
    bind("#tbInvite", invitePartsSheet);
    bind("#tbTools", toolsSheet);
    bind("#tbAgree", agreementsSheet);
    bind("#tbClose", closingReflection);
    bind("#tbMeet", function () {
      askMaterial("meeting", seated.map(function (p) { return p.slug; }));
    });
    // also reachable on its own, for a meeting held elsewhere - copy-prompt
    // mode never passes through the app's own close
    bind("#tbRound", function () {
      roundOfTheTable(seated.map(function (p) { return p.slug; }));
    });
  }

  /* A colour off a stored meeting card ends up inside a style attribute, and
     backups are hand-editable JSON, so it is checked rather than trusted. */
  function safeColor(c, fallback) {
    return /^(#[0-9a-fA-F]{3,8}|var\(--[a-z-]+\))$/.test(String(c || "")) ? String(c) : fallback;
  }

  function voiceLineHTML(v) {
    return '<div class="mt-voice" style="--vc:' + safeColor(v.color, "var(--accent)") + '">' +
      '<span class="mt-name">' + esc(v.name) + "</span>" + esc(v.line) + "</div>";
  }

  /* The meeting, kept. Enough of it to bring the room back without reopening
     the transcript: who was there, what was on the table, the line each part
     ended on, and what Self made of it. */
  function meetingCardHTML(m) {
    var who = (m.parts || []).length;
    return '<div class="meetcard" data-meeting="' + esc(m.id) + '">' +
      '<div class="mt-top"><span class="mt-date">' + esc(m.date) + "</span>" +
      '<span class="mt-count">' + who + (who === 1 ? " part" : " parts") + " at the table</span></div>" +
      (m.topic ? '<div class="mt-topic">' + esc(m.topic) + "</div>" : "") +
      // stated, not nagged: a meeting held before there was a round to take
      // is not a gap, and the card says which ones can still get one
      '<div class="mt-topic dim">' + (m.readings
        ? "round of the table &middot; " + m.readings + (m.readings === 1 ? " reading" : " readings")
        : "no round recorded") + "</div>" +
      (m.voices || []).map(voiceLineHTML).join("") +
      (m.synthesis
        ? voiceLineHTML({ name: "Self", line: m.synthesis, color: "var(--self)" })
        : "") +
      "</div>";
  }

  function openMeeting(id) {
    var m = ST.state.table.meetings.filter(function (x) { return x.id === id; })[0];
    if (!m) return;
    var t = m.transcript
      ? ST.state.transcripts.filter(function (x) { return x.id === m.transcript; })[0]
      : null;
    /* Who was at this meeting and is still in the library. A part deleted
       since cannot be asked how it felt, and a renamed one is followed by
       the store, so what is left here is exactly who can still answer. */
    var here = (m.parts || []).map(ST.getPart).filter(Boolean);
    openPanel("Table meeting", m.date,
      '<div class="profile">' +
      (m.topic ? '<div class="card"><h3>On the table</h3><div class="prose">' + esc(m.topic) + "</div></div>" : "") +
      '<div class="card"><h3>Where each part landed</h3>' +
      ((m.voices || []).length
        ? m.voices.map(voiceLineHTML).join("")
        : '<div class="prose none">nothing was recorded from this one</div>') +
      "</div>" +
      (m.synthesis ? '<div class="card"><h3>Self</h3><div class="prose">' + esc(m.synthesis) + "</div></div>" : "") +
      '<div class="card"><h3>Round the table</h3><div class="prose">' +
      (m.readings
        ? "This meeting has " + m.readings + (m.readings === 1 ? " reading" : " readings") +
          " of how the parts felt toward each other. They are on the parts themselves, and on the threads between them on the map."
        : (here.length >= 2
          ? "No round was recorded from this one. You can still take it - answer as those parts stood at the end of <b>" +
            esc(m.date) + "</b>, and it is filed on that day rather than today."
          : "No round was recorded, and too few of the parts who were here are still in your library to take one now.")) +
      "</div>" +
      (here.length >= 2
        ? '<button class="chip chip-btn" id="mtRound">&#9998; ' +
          (m.readings ? "add to the round" : "round the table") + "</button>"
        : "") +
      "</div>" +
      '<div class="profile-cta">' +
      (t ? '<button class="btn btn-soft btn-big" id="mtFull">Read the full transcript</button>' : "") +
      '<button class="btn btn-danger btn-big" id="mtDel">Remove this card</button>' +
      "</div></div>");
    bind("#mtRound", function () {
      closePanel();
      setTimeout(function () {
        roundOfTheTable(here.map(function (p) { return p.slug; }), { meetingId: id, date: m.date });
      }, 220);
    });
    if (t) bind("#mtFull", function () {
      closePanel(); setTimeout(function () { openTranscript(t); }, 220);
    });
    bind("#mtDel", function () {
      var kept = ST.state.table.meetings.filter(function (x) { return x.id !== id; });
      ST.saveTable({ meetings: kept });
      closePanel(); renderTable(); buzz();
      toast(t ? "Card removed - the transcript is still in Settings" : "Card removed");
    });
  }

  /* The closing reflection asks seven questions and the list row could only
     ever show the first answer. This is the rest of it. */
  function openClosingLog(idx) {
    var entry = ST.state.table.log[idx];
    if (!entry) return;
    var answers = entry.answers || {};
    var rows = R.CLOSING.filter(function (q) { return answers[q.key]; }).map(function (q) {
      return '<div class="card"><div class="logq">' + esc(q.q) + "</div>" +
        '<div class="prose">' + esc(answers[q.key]) + "</div></div>";
    }).join("");
    openPanel("Closing reflection", entry.date,
      '<div class="profile">' +
      (rows || '<div class="card"><div class="prose none">nothing was written down</div></div>') +
      "</div>");
  }

  /* Walk the document's "Developing the Table" questions, one per screen. */
  function buildTable(editing) {
    var t = ST.state.table;
    var steps = R.BUILD;
    var answers = {};
    var i = 0;
    var done = false;

    function finish() {
      if (done) return;
      done = true;
      var patch = { built: true };
      Object.keys(answers).forEach(function (k) { patch[k] = answers[k]; });
      // editing keeps whatever was left blank this time
      if (!patch.room && !t.room) { closePanel(); return; }
      ST.saveTable(patch);
      closePanel();
      showView("table");
      buzz(12);
      toast(editing ? "The room is updated" : "Your table is ready - now invite some parts");
      if (!editing) setTimeout(invitePartsSheet, 400);
    }

    function step() {
      if (i >= steps.length) { finish(); return; }
      var d = steps[i];
      var current = editing ? (t[d.key] || "") : "";
      openPanel(editing ? "Edit the room" : "Build your table",
        "Fraser's Table · " + (i + 1) + " of " + steps.length,
        '<div class="profile">' +
        '<div class="qprogress"><i style="width:' + Math.round((i / steps.length) * 100) + '%"></i></div>' +
        '<div class="card"><div class="qtext serif">' + esc(d.q) + "</div>" +
        (d.hint ? '<div class="prose dim" style="margin-top:10px">' + esc(d.hint) + "</div>" : "") +
        "</div>" +
        (d.short
          ? '<input id="tqBox" autocomplete="off" placeholder="a name, if one comes" value="' + esc(current) + '">'
          : '<textarea id="tqBox" style="min-height:150px" placeholder="In your own words. There is no right answer.">' + esc(current) + "</textarea>") +
        '<div class="profile-cta">' +
        '<button class="btn btn-primary btn-big" id="tqNext">' +
        (i === steps.length - 1 ? (editing ? "Save the room" : "Open the room") : "Next") + "</button>" +
        '<button class="btn btn-soft btn-big" id="tqSkip">Skip this one</button>' +
        "</div></div>", "",
        function () { if (Object.keys(answers).length) finish(); return true; });

      $("#tqNext").addEventListener("click", function () {
        var v = $("#tqBox").value.trim();
        if (v) answers[d.key] = v;
        if (i === 0 && !v && !t.room) {
          toast("The room needs a description before it can open");
          return;
        }
        i++; buzz(); step();
      });
      $("#tqSkip").addEventListener("click", function () {
        if (i === 0 && !t.room) { toast("This one is the room itself - it can't be skipped"); return; }
        i++; buzz(); step();
      });
    }
    step();
  }

  /* One part's seat. The document is explicit that a part may prefer to be
     near without participating, so every seat is an equal choice. */
  function seatSheet(slug) {
    var p = ST.getPart(slug);
    if (!p) return;
    var t = ST.state.table;
    var current = t.seats[slug] || "away";
    openSheet(
      '<h2 class="sheet-title serif">' + esc(p.name) + "</h2>" +
      '<p class="dim">There is no pressure to sit. Being near the room without joining in is a real answer, and it gets recorded as one.</p>' +
      '<div class="seg" id="stSeat" style="flex-direction:column;gap:3px">' +
      R.SEATS.map(function (s) {
        return '<button data-val="' + s.id + '"' + (s.id === current ? ' class="on"' : "") +
          ' style="text-align:left;padding:11px 12px">' + esc(s.label) +
          ' <span class="dim">' + esc(s.blurb) + "</span></button>";
      }).join("") +
      "</div>" +
      '<div style="height:14px"></div>' +
      '<button class="btn btn-soft btn-big" id="stOpen">Open ' + esc(p.name) + "'s profile</button>"
    );
    $("#stSeat").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      t.seats[slug] = b.dataset.val;
      ST.saveTable({ seats: t.seats });
      buzz(); closeSheet(); renderTable();
      toast(p.name + ": " + R.seatLabel(b.dataset.val).toLowerCase());
    });
    bind("#stOpen", function () { closeSheet(); openProfile(slug); });
  }

  function invitePartsSheet() {
    var parts = ST.listParts();
    if (!parts.length) { toast("Meet a part on the Parts tab first"); return; }
    var t = ST.state.table;
    openSheet(
      '<h2 class="sheet-title serif">Invite parts in</h2>' +
      '<p class="dim">Watch who comes. There is no pressure &mdash; a part might prefer the side of the room, or an adjoining room, and that is welcome too. Tap to move anyone.</p>' +
      parts.map(function (p) {
        var seat = t.seats[p.slug] || "away";
        return '<button class="menu-item" data-slug="' + esc(p.slug) + '"><span class="mi-icon">' +
          esc(S.initial(p.name)) + '</span><span class="mi-main">' + esc(p.name) +
          '<span class="mi-sub">' + esc(R.seatLabel(seat)) + "</span></span></button>";
      }).join("") +
      '<div style="height:12px"></div>' +
      '<button class="btn btn-soft btn-big" id="ivAll">Seat everyone at the table</button>' +
      '<p class="dim" style="margin:10px 2px 0">I want to thank all these parts for meeting here. ' +
      "If there are others, they can join at any time. They are welcome too.</p>"
    );
    document.querySelectorAll("#sheetBody .menu-item").forEach(function (el) {
      el.addEventListener("click", function () { closeSheet(); setTimeout(function () { seatSheet(el.dataset.slug); }, 240); });
    });
    bind("#ivAll", function () {
      parts.forEach(function (p) { t.seats[p.slug] = "table"; });
      ST.saveTable({ seats: t.seats });
      closeSheet(); renderTable(); buzz(12);
      toast("Everyone is seated - move anyone who would rather not be");
    });
  }

  function toolsSheet() {
    var t = ST.state.table;
    var have = {};
    t.tools.forEach(function (x) { have[x.id] = 1; });
    openSheet(
      '<h2 class="sheet-title serif">Tools in the room</h2>' +
      '<p class="dim">With several parts present it can feel loud, tense, or confusing. These help everyone feel safe and respected. Tap to add or remove.</p>' +
      R.TOOLS.map(function (x) {
        return '<button class="menu-item tool' + (have[x.id] ? " on" : "") + '" data-tool="' + esc(x.id) + '">' +
          '<span class="mi-icon">' + (have[x.id] ? "&#10003;" : "+") + '</span><span class="mi-main">' +
          esc(x.label) + '<span class="mi-sub">' + esc(x.blurb) + "</span></span></button>";
      }).join("") +
      // anything invented needs a way back out, or it is in the room forever
      t.tools.filter(function (x) { return x.id.indexOf("own-") === 0; }).map(function (x) {
        return '<button class="menu-item tool on" data-tool="' + esc(x.id) + '">' +
          '<span class="mi-icon">&#10003;</span><span class="mi-main">' + esc(x.label) +
          '<span class="mi-sub">yours &middot; tap to remove</span></span></button>';
      }).join("") +
      '<div style="height:12px"></div>' +
      '<label class="fieldlabel">Anything you want to invent yourself</label>' +
      '<input id="tlOwn" autocomplete="off" placeholder="a bell, a second door, a window...">' +
      '<div style="height:10px"></div>' +
      '<button class="btn btn-primary btn-big" id="tlAdd">Add it to the room</button>'
    );
    document.querySelectorAll("#sheetBody .tool").forEach(function (el) {
      el.addEventListener("click", function () {
        var id = el.dataset.tool;
        var def = R.TOOLS.filter(function (x) { return x.id === id; })[0];
        var already = t.tools.some(function (x) { return x.id === id; });
        if (already) t.tools = t.tools.filter(function (x) { return x.id !== id; });
        else if (def) t.tools.push({ id: id, label: def.label, note: "" });
        ST.saveTable({ tools: t.tools });
        buzz(); renderTable(); toolsSheet();
      });
    });
    bind("#tlAdd", function () {
      var v = $("#tlOwn").value.trim();
      if (!v) { toast("Name it first"); return; }
      var ownId = "own-" + S.slugify(v);
      if (t.tools.some(function (x) { return x.id === ownId; })) {
        toast("That one is already in the room"); return;
      }
      t.tools.push({ id: ownId, label: v, note: "your own" });
      ST.saveTable({ tools: t.tools });
      closeSheet(); renderTable(); buzz(12);
      toast(v + " is in the room");
    });
  }

  function agreementsSheet() {
    var t = ST.state.table;
    openSheet(
      '<h2 class="sheet-title serif">Agreements</h2>' +
      '<p class="dim">What rules or agreements would help everyone feel more at ease? One per line.</p>' +
      '<textarea id="agBox" style="min-height:150px" placeholder="only the part holding the stick speaks&#10;anyone can call a break&#10;nobody is made to sit">' +
      esc(t.agreements.join("\n")) + "</textarea>" +
      '<div style="height:12px"></div>' +
      '<button class="btn btn-primary btn-big" id="agSave">Save</button>'
    );
    bind("#agSave", function () {
      ST.saveTable({ agreements: splitLines($("#agBox").value) });
      closeSheet(); renderTable(); buzz(10);
      toast("Agreements saved");
    });
  }

  /* The document's closing reflection, asked one at a time and kept. */
  function closingReflection() {
    var steps = R.CLOSING;
    var answers = {};
    var i = 0, done = false;

    function finish() {
      if (done) return;
      done = true;
      var t = ST.state.table;
      if (Object.keys(answers).length) {
        t.log.push({ date: S.todayISO(), answers: answers,
          note: answers.showed_up ? answers.showed_up.slice(0, 80) : "closing reflection" });
        if (answers.agreements) {
          var have = {};
          t.agreements.forEach(function (a) { have[a.toLowerCase().trim()] = 1; });
          splitLines(answers.agreements).forEach(function (a) {
            if (!have[a.toLowerCase().trim()]) { have[a.toLowerCase().trim()] = 1; t.agreements.push(a); }
          });
        }
        if (t.log.length > 100) t.log = t.log.slice(-100);
        ST.saveTable({ log: t.log, agreements: t.agreements });
      }
      closePanel(); renderTable();
      if (Object.keys(answers).length) {
        openSheet('<h2 class="sheet-title serif">Before you go</h2>' +
          '<div class="prose">' + esc(R.FAREWELL) + "</div>" +
          '<div style="height:14px"></div>' +
          '<button class="btn btn-primary btn-big" id="fwOk">Leave the room gently</button>');
        bind("#fwOk", closeSheet);
      }
    }

    function step() {
      if (i >= steps.length) { finish(); return; }
      var d = steps[i];
      openPanel("Closing reflection", "Fraser's Table · " + (i + 1) + " of " + steps.length,
        '<div class="profile">' +
        '<div class="qprogress"><i style="width:' + Math.round((i / steps.length) * 100) + '%"></i></div>' +
        '<div class="card"><div class="qtext serif">' + esc(d.q) + "</div>" +
        (d.hint ? '<div class="prose dim" style="margin-top:10px">' + esc(d.hint) + "</div>" : "") + "</div>" +
        '<textarea id="crBox" placeholder="Blank is fine."></textarea>' +
        '<div class="profile-cta">' +
        '<button class="btn btn-primary btn-big" id="crNext">' +
        (i === steps.length - 1 ? "Close the meeting" : "Next") + "</button>" +
        '<button class="btn btn-soft btn-big" id="crSkip">Skip</button>' +
        "</div></div>", "",
        function () { if (Object.keys(answers).length) finish(); return true; });
      $("#crNext").addEventListener("click", function () {
        var v = $("#crBox").value.trim();
        if (v) answers[d.key] = v;
        i++; buzz(); step();
      });
      $("#crSkip").addEventListener("click", function () { i++; buzz(); step(); });
    }
    step();
  }

  /* ================= learn =================
     The reference library, reachable from the topbar anywhere in the app. */
  function renderLearnBody(page) {
    return page.body.map(function (b) {
      if (b[0] === "h") return "<h3>" + esc(b[1]) + "</h3>";
      if (b[0] === "l") return "<ul class='learn-list'>" + b[1].map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul>";
      return "<p>" + b[1] + "</p>";
    }).join("");
  }

  function learnPage(id) {
    var page = R.LEARN.filter(function (x) { return x.id === id; })[0];
    if (!page) return;
    openPanel(page.title, page.blurb,
      '<div class="profile learn">' + renderLearnBody(page) +
      '<div class="profile-cta"><button class="btn btn-soft btn-big" id="lnBack">Back to the library</button></div></div>');
    bind("#lnBack", function () { closePanel(); setTimeout(learnSheet, 200); });
  }

  function learnSheet() {
    openSheet(
      '<h2 class="sheet-title serif">How this works</h2>' +
      '<p class="dim">The framework behind the app, in short.</p>' +
      R.LEARN.map(function (x) {
        return '<button class="menu-item" data-learn="' + esc(x.id) + '"><span class="mi-icon">&#9679;</span>' +
          '<span class="mi-main">' + esc(x.title) + '<span class="mi-sub">' + esc(x.blurb) + "</span></span></button>";
      }).join("")
    );
    document.querySelectorAll("#sheetBody [data-learn]").forEach(function (el) {
      el.addEventListener("click", function () { closeSheet(); setTimeout(function () { learnPage(el.dataset.learn); }, 240); });
    });
  }

  /* ================= sessions ================= */
  /* Transcripts lost their tab to the table and now open as a panel from
     Settings, so the list may not be on screen when this is called. */
  function renderSessions() {
    var ts = ST.state.transcripts;
    var list = $("#sessionsList");
    if (!list) return;
    list.innerHTML = ts.map(function (t) {
      return '<div class="sess-card" data-id="' + esc(t.id) + '">' +
        '<div class="sc-top"><span>' + esc(t.date) + "</span><span>" + esc(t.mode) + "</span></div>" +
        '<div class="sc-title">' + esc(t.title) + "</div>" +
        '<div class="sc-note">' + esc((t.text || "").slice(0, 90)) + "...</div></div>";
    }).join("");
    document.querySelectorAll(".sess-card").forEach(function (el) {
      el.addEventListener("click", function () {
        var t = ST.state.transcripts.filter(function (x) { return x.id === el.dataset.id; })[0];
        if (t) openTranscript(t);
      });
    });
  }

  /* Also reached from a meeting card on the Table tab, which is why this is
     its own function rather than living inside the list's click handler. */
  function openTranscript(t) {
    var interviewish = ["intake", "checkin", "mapping"].indexOf(t.mode) >= 0;
    var canExtract = interviewish && LLM.configured(ST.state.settings);
    openPanel(t.title, t.date,
      '<div class="transcript">' +
      (canExtract ? '<button class="btn btn-primary btn-big" id="extractT" style="margin-bottom:6px">Extract the profile from this transcript</button>' +
        '<p class="dim" style="margin:0 0 14px">Rebuilds the part profile from what was said - useful if a session closed without saving one.</p>' : "") +
      '<pre>' + esc(t.text) + "</pre>" +
      '<button class="btn btn-danger btn-big" id="delT">Delete transcript</button></div>');
    $("#delT").addEventListener("click", function () {
      ST.deleteTranscript(t.id); closePanel(); renderSessions(); renderTable(); toast("Deleted");
    });
    var ex = $("#extractT");
    if (ex) ex.addEventListener("click", function () { extractFromTranscript(t, ex); });
  }

  /* Rebuild profile(s) from a saved transcript, then hand the result to the
     import review flow so nothing saves without the person seeing it. */
  async function extractFromTranscript(t, btn) {
    btn.disabled = true;
    btn.textContent = "Reading the transcript...";
    try {
      var livedParts = (t.parts || []).map(ST.getPart).filter(Boolean);
      var sys;
      if (t.mode === "checkin" && livedParts.length) sys = T.checkin(livedParts[0]);
      else if (t.mode === "mapping" && livedParts.length >= 2) sys = T.mapping(livedParts);
      else sys = T.intake();
      var reply = await LLM.chat(ST.state.settings, sys, [{
        role: "user",
        text: "Here is the transcript of a session we already had. Do not continue the interview.\n\n" +
          t.text + "\n\n" + T.CLOSE_INSTRUCTION
      }]);
      closePanel();
      importSheet();
      setTimeout(function () {
        var box = $("#importBox");
        if (box) { box.value = reply; reviewImport(reply); }
      }, 600);
    } catch (e) {
      toast(e.message);
      btn.disabled = false;
      btn.textContent = "Extract the profile from this transcript";
    }
  }

  /* Copying a voice ID out of the ElevenLabs dashboard by hand is the step
     people get wrong, and a wrong ID only shows up as a 404 mid-session. List
     the account's own voices instead. Professional and instant clones sort
     first - a cloned voice is what someone came here for. The ID field stays
     editable, so this failing never blocks anyone. */
  async function pickElevenVoice() {
    var s = ST.state.settings;
    buzz();
    if (!s.elevenKey) { toast("Add your ElevenLabs API key first"); return; }
    toast("Fetching your voices…");
    var voices;
    try {
      var res = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: { "xi-api-key": s.elevenKey }
      });
      if (!res.ok) throw new Error(await V.apiError(res, "account"));
      voices = (await res.json()).voices || [];
    } catch (e) {
      toast(e.message || "Could not reach ElevenLabs");
      return;
    }
    if (!voices.length) { toast("That account has no voices yet"); return; }

    var RANK = { professional: 0, cloned: 1, generated: 2, premade: 3 };
    var rank = function (v) { return RANK[v.category] == null ? 4 : RANK[v.category]; };
    voices.sort(function (a, b) { return rank(a) - rank(b); });

    openSheet('<h2 class="sheet-title serif">Your ElevenLabs voices</h2>' +
      '<p class="dim">Tap the one sessions should speak in.</p>' +
      voices.map(function (v) {
        var kind = v.category === "professional" ? "professional clone"
          : v.category === "cloned" ? "instant clone"
          : v.category || "voice";
        return '<button class="menu-item" data-vid="' + esc(v.voice_id) + '" data-vname="' + esc(v.name) + '">' +
          '<span class="mi-icon">♪</span><span class="mi-main">' + esc(v.name) +
          '<span class="mi-sub">' + esc(kind) + (v.voice_id === s.elevenVoiceId ? " &middot; current" : "") +
          "</span></span></button>";
      }).join(""));

    /* bind the buttons, not #sheetBody - that element outlives every sheet,
       so a listener on it would stack up one per visit */
    document.querySelectorAll("#sheetBody [data-vid]").forEach(function (b) {
      b.addEventListener("click", function () {
        s.elevenVoiceId = b.dataset.vid;
        ST.save();
        closeSheet();
        renderSettings();
        toast("Sessions will speak as " + b.dataset.vname);
      });
    });
  }

  /* A key that is wrong is otherwise silent until the first session fails
     halfway through a sentence. One round trip, said plainly. */
  async function testProviderKey(btn) {
    var s = ST.state.settings;
    var cfg = PROVIDERS[s.provider];
    if (!cfg || !s[cfg.key]) { toast("Add the API key first"); return; }
    btn.disabled = true;
    btn.textContent = "Checking…";
    try {
      await LLM.chat(s, "Reply with the single word: ready.", [{ role: "user", text: "ready?" }]);
      toast(cfg.label + " is working - " + s[cfg.model] + " answered");
    } catch (e) {
      toast(e.message || (cfg.label + " did not answer"));
    }
    btn.disabled = false;
    btn.textContent = "Test this key";
  }

  /* Push first, then pull: local edits made offline reach the server before
     the server's copy is merged back in, so neither side is lost. */
  async function syncNow() {
    var btn = $("#syncNowBtn");
    btn.disabled = true;
    btn.textContent = "Syncing…";
    await SY.push();
    var changed = await SY.pull();
    if (changed) renderParts();
    renderSettings();
    toast(SY.status() === "synced"
      ? (changed ? "Synced - your other device's changes are here" : "Synced")
      : "Could not reach sync - your parts are safe on this device");
  }

  /* ================= settings ================= */
  function renderSettings() {
    var s = ST.state.settings;
    $("#settingsPane").innerHTML =
      '<div class="set-group"><h3>Account</h3>' +
      (AUTH.isLoggedIn()
        ? '<div class="set-row"><span class="sr-main">Signed in as ' + esc(AUTH.getUsername()) + '<span class="sr-sub">your parts follow you to every device you sign in on</span></span><button class="btn btn-soft" id="syncNowBtn">Sync now</button></div>' +
          '<div class="set-row"><span class="sr-main">Sign out<span class="sr-sub">closes your parts and returns to the sign-in screen</span></span><button class="btn btn-soft" id="signOutBtn">Sign out</button></div>'
        : '<div class="set-row"><span class="sr-main">Not signed in<span class="sr-sub">sign in to reach your parts</span></span><button class="btn btn-soft" id="signInBtn">Sign in</button></div>') +
      '<p class="dim" style="margin:12px 14px 14px">Your parts live in your account (encrypted in transit), so every device you sign in on shares them. Anyone else signing in here reaches only their own parts &mdash; never yours.</p>' +
      "</div>" +

      '<div class="set-group"><h3>Live sessions</h3>' +
      '<div class="set-pad"><div class="seg" id="provSeg">' +
      segBtn("manual", "Copy-prompt", s.provider) + segBtn("gemini", "Gemini", s.provider) + segBtn("anthropic", "Claude", s.provider) + segBtn("openai", "ChatGPT", s.provider) +
      "</div>" +
      '<div id="provFields"></div>' +
      '<p class="dim" style="margin:12px 2px 2px">Your key is stored only on this device and sent straight to the provider. Anything you share in a session falls under that provider&rsquo;s data policies.</p>' +
      "</div></div>" +

      '<div class="set-group"><h3>Voice</h3>' +
      '<div class="set-pad">' +
      '<label class="fieldlabel">ElevenLabs API key (optional)</label>' +
      '<input type="password" id="elKey" autocomplete="off" placeholder="sk_..." value="' + esc(s.elevenKey) + '">' +
      '<label class="fieldlabel">Voice ID</label>' +
      '<input id="elVoice" autocomplete="off" placeholder="e.g. 21m00Tcm4TlvDq8ikWAM" value="' + esc(s.elevenVoiceId) + '">' +
      '<button class="btn btn-soft" id="elFind" style="margin-top:8px">Find my voices</button>' +
      '<label class="fieldlabel">Model</label>' +
      '<input id="elModel" autocomplete="off" value="' + esc(s.elevenModel) + '">' +
      '<label class="fieldlabel">Speaking pace</label>' +
      '<div class="seg" id="rateSeg">' +
      segBtn("0.8", "Unhurried", String(s.speechRate)) +
      segBtn("0.9", "Slow", String(s.speechRate)) +
      segBtn("1", "Normal", String(s.speechRate)) +
      "</div>" +
      '<button class="btn btn-soft" id="elTest" style="margin-top:12px">Hear a sample</button>' +
      '<p class="dim" style="margin:12px 2px 2px">Optional. With a key and voice ID, sessions speak in that ElevenLabs voice &mdash; e.g. your own clone &mdash; instead of the built-in one. <b>Find my voices</b> fills in the ID for you. Reply text is sent to ElevenLabs and billed per character; if anything fails, sessions fall back to the browser voice. Keys at <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener">elevenlabs.io</a>.</p>' +
      "</div></div>" +

      '<div class="set-group"><h3>Appearance</h3>' +
      '<div class="set-pad"><div class="seg" id="themeSeg">' +
      segBtn("auto", "Auto", s.theme) + segBtn("dark", "Dark", s.theme) + segBtn("light", "Light", s.theme) +
      "</div></div>" +
      '<div class="set-row"><span class="sr-main">Haptic feedback<span class="sr-sub">tiny vibrations on taps (where supported)</span></span>' +
      '<input type="checkbox" id="hapt" style="width:auto" ' + (s.haptics ? "checked" : "") + "></div></div>" +

      '<div class="set-group"><h3>Your data</h3>' +
      '<div class="set-row"><span class="sr-main">Session transcripts<span class="sr-sub">' + ST.state.transcripts.length + ' saved from live AI sessions</span></span><button class="btn btn-soft" id="openTranscripts">Open</button></div>' +
      '<div class="set-row"><span class="sr-main">Export backup<span class="sr-sub">everything, including the table, as one JSON file</span></span><button class="btn btn-soft" id="expAll">Export</button></div>' +
      '<div class="set-row"><span class="sr-main">Import backup<span class="sr-sub">merge a previously exported file</span></span><button class="btn btn-soft" id="impAll">Import</button></div>' +
      '<div class="set-row"><span class="sr-main" style="color:var(--danger)">Erase everything<span class="sr-sub">removes all parts and sessions from this device</span></span><button class="btn btn-danger" id="wipeAll">Erase</button></div>' +
      "</div>" +

      '<div class="set-group"><h3>About</h3>' +
      '<div class="set-row"><span class="sr-main">' +
      (isStandalone()
        ? 'Installed<span class="sr-sub">running from your home screen &middot; works offline</span>'
        : 'Add to home screen<span class="sr-sub">' + installHint() + "</span>") +
      "</span>" +
      (!isStandalone() && deferredInstall ? '<button class="btn btn-soft" id="setInstall">Install</button>' : "") +
      "</div>" +
      '<div class="set-pad" style="padding-top:12px"><p class="dim" style="margin:0 0 8px"><b>Inner Table</b> is the webapp of the open-source <a href="https://github.com/joman124/ifs-agents" target="_blank" rel="noopener">ifs-agents</a> system, inspired by Internal Family Systems (Richard C. Schwartz). It is a self-exploration and journaling tool, <b>not therapy</b> — no trauma processing, no unburdening. Read the <a href="https://github.com/joman124/ifs-agents/blob/main/docs/safety.md" target="_blank" rel="noopener">safety guide</a>.</p>' +
      '<p class="dim" style="margin:0">In crisis? Call or text <b>988</b> (US) or visit <a href="https://findahelpline.com" target="_blank" rel="noopener">findahelpline.com</a>.</p></div></div>';

    renderProviderFields();
    $("#provSeg").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      s.provider = b.dataset.val; ST.save(); renderSettings(); buzz();
    });
    $("#themeSeg").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      s.theme = b.dataset.val; ST.save(); applyTheme(); renderSettings(); buzz();
    });
    $("#elKey").addEventListener("input", function (e) { s.elevenKey = e.target.value.trim(); ST.save(); });
    $("#elVoice").addEventListener("input", function (e) { s.elevenVoiceId = e.target.value.trim(); ST.save(); });
    $("#elModel").addEventListener("input", function (e) { s.elevenModel = e.target.value.trim(); ST.save(); });
    bind("#elFind", pickElevenVoice);
    $("#rateSeg").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      s.speechRate = parseFloat(b.dataset.val); ST.save(); renderSettings(); buzz();
      V.speak("This is the pace I'll speak at.", null);
    });
    $("#elTest").addEventListener("click", function () {
      buzz();
      toast(s.elevenKey && s.elevenVoiceId ? "Generating a sample in your voice..." : "No ElevenLabs key set - this is the browser voice");
      V.speak("Hi, this is how your sessions will sound. Take all the time you need.", null);
    });
    $("#hapt").addEventListener("change", function (e) { s.haptics = e.target.checked; ST.save(); buzz(); });
    bind("#signInBtn", showLogin);
    bind("#signOutBtn", function () {
      AUTH.logout();
      SY.reset();
      // parts live in the account; signing out closes them under their own key
      // and returns to the sign-in gate, leaving nothing of the account on
      // screen. Another person can now sign in here and reach only their own.
      ST.switchOwner(null);
      requireLogin();
      toast("Signed out - sign in to reach your parts again");
    });
    bind("#syncNowBtn", syncNow);
    bind("#setInstall", doInstall);
    $("#openTranscripts").addEventListener("click", function () {
      if (!ST.state.transcripts.length) { toast("No transcripts yet - live AI sessions save one each"); return; }
      openPanel("Session transcripts", ST.state.transcripts.length + " saved",
        '<div class="view-pad" id="sessionsList"></div>');
      renderSessions();
    });
    $("#expAll").addEventListener("click", doExportBackup);
    $("#impAll").addEventListener("click", function () {
      F.pickTextFiles({ accept: ".json,application/json" }, function (r) {
        if (!r.text.trim()) { toast(F.trouble(r) || "That backup came through empty"); return; }
        try { var n = ST.importAll(r.text); renderParts(); toast("Imported " + n + " part(s)"); }
        catch (e) { toast("Import failed: " + e.message); }
      });
    });
    $("#wipeAll").addEventListener("click", function () {
      openSheet('<h2 class="sheet-title serif">Erase everything?</h2><p class="dim">All parts, transcripts, and settings on this device. There is no undo.</p>' +
        '<button class="btn btn-danger btn-big" id="wipeYes">Erase it all</button><button class="btn btn-ghost btn-big" id="wipeNo">Keep my data</button>');
      $("#wipeYes").addEventListener("click", function () { ST.wipe(); closeSheet(); applyTheme(); showView("parts"); toast("Fresh start"); });
      $("#wipeNo").addEventListener("click", closeSheet);
    });
  }

  function segBtn(val, label, cur) {
    return '<button data-val="' + val + '"' + (cur === val ? ' class="on"' : "") + ">" + label + "</button>";
  }

  var PROVIDERS = {
    gemini: { label: "Gemini", key: "geminiKey", model: "geminiModel", ph: "AIza...",
      hint: 'Free keys at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com</a> &mdash; sign in, <b>Create API key</b>, paste it above. The free tier covers ordinary use of <code>gemini-2.5-flash</code>; on it, Google may use your prompts to improve their models, so keep depth work out of live sessions.' },
    anthropic: { label: "Anthropic", key: "anthropicKey", model: "anthropicModel", ph: "sk-ant-...",
      hint: 'Keys at <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a>.' },
    openai: { label: "OpenAI", key: "openaiKey", model: "openaiModel", ph: "sk-...",
      hint: 'Keys at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com</a>.' }
  };

  function renderProviderFields() {
    var s = ST.state.settings;
    var el = $("#provFields");
    if (s.provider === "manual") {
      el.innerHTML = '<p class="dim" style="margin:12px 2px 0">No key needed. Sessions generate a portable prompt you paste into any AI chat, then paste the updated profile back.</p>';
      return;
    }
    var cfg = PROVIDERS[s.provider];
    if (!cfg) return;
    el.innerHTML =
      '<label class="fieldlabel">' + cfg.label + ' API key</label>' +
      '<input type="password" id="provKey" autocomplete="off" placeholder="' + cfg.ph + '" value="' + esc(s[cfg.key]) + '">' +
      '<label class="fieldlabel">Model</label>' +
      '<input type="text" id="provModel" value="' + esc(s[cfg.model]) + '">' +
      '<button class="btn btn-soft" id="provTest" style="margin-top:12px">Test this key</button>' +
      '<p class="dim" style="margin:10px 2px 0">' + cfg.hint + "</p>";
    $("#provTest").addEventListener("click", function () { testProviderKey(this); });
    $("#provKey").addEventListener("input", function (e) {
      s[cfg.key] = e.target.value.trim(); ST.save();
    });
    $("#provModel").addEventListener("input", function (e) {
      s[cfg.model] = e.target.value.trim(); ST.save();
    });
  }

  /* ================= onboarding ================= */
  function runOnboarding() {
    var slide = 0;
    var track = $("#onboardTrack");
    var dots = document.querySelectorAll("#onboardDots i");
    $("#onboarding").classList.remove("hidden");
    document.querySelectorAll("#onboarding [data-next]").forEach(function (b) {
      b.addEventListener("click", function () {
        slide++;
        track.firstElementChild.style.marginLeft = (-100 * slide) + "%";
        dots.forEach(function (d, i) { d.classList.toggle("on", i === slide); });
        buzz();
      });
    });
    $("#onboardDone").addEventListener("click", function () {
      var s = ST.state.settings;
      s.onboarded = true;
      // the three slides say what this is and what it will not do; the coach
      // cues pick up from there and say how each part of it actually works
      s.coachOn = true;
      s.firstRun = S.todayISO();
      ST.save();
      $("#onboarding").classList.add("hidden");
      // sign-in is required before the app opens: parts live in an account
      requireLogin();
      buzz(15);
    });
  }

  /* ================= sign-in (required) ================= */
  var signupMode = false;

  function setLoginMode(signup) {
    signupMode = signup;
    $("#loginTitle").textContent = signup ? "Create an account" : "Sign in";
    $("#loginIntro").textContent = signup
      ? "Pick a name and a password of at least 8 characters. Your parts live in this account and follow you to any device you sign in on - nobody else signing in here can see them."
      : "Your parts live in your account. Sign in to reach them on this device - and on any other device you sign in on.";
    $("#loginSubmit").textContent = signup ? "Create account" : "Sign in";
    $("#loginToggle").textContent = signup ? "I already have an account" : "Create an account";
    // lets a password manager offer to generate one, rather than autofilling
    $("#loginPass").setAttribute("autocomplete", signup ? "new-password" : "current-password");
    $("#loginError").classList.add("hidden");
  }

  async function doLogin() {
    var user = $("#loginUser").value.trim();
    var pass = $("#loginPass").value;
    var err = $("#loginError");
    err.classList.add("hidden");
    if (!user || !pass) return;
    var btn = $("#loginSubmit");
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = signupMode ? "Creating…" : "Signing in…";
    try {
      var who = signupMode ? await AUTH.signup(user, pass) : await AUTH.login(user, pass);
      $("#login").classList.add("hidden");
      toast(signupMode ? "Welcome, " + user : "Signed in as " + user);
      // Open this account's own store first. Everything below - the pull that
      // merges, the push that follows it - must happen inside that account,
      // never on top of whatever the last person to use this device left.
      ST.switchOwner(who);
      // an account is open now, so reveal the app behind the sign-in gate
      $("#app").classList.remove("hidden");
      showView("parts");
      var changed = await SY.pull();
      // seed only after the pull, so an account that already has parts
      // somewhere else never gets three examples dropped in beside them
      var seeded = signupMode ? ST.seedStarters() : 0;
      if (seeded) {
        // a brand new account starts its first run here rather than at
        // onboarding: this is the first screen with anything on it
        var st = ST.state.settings;
        st.coachOn = true;
        st.firstRun = S.todayISO();
        ST.save();
        renderParts();
        toast("Three example parts to start from - rename or delete them");
      }
      else if (changed) { renderParts(); toast("Synced with your other device"); }
      offerDeviceParts(who);
    } catch (e) {
      err.textContent = e.message || (signupMode ? "Could not create that account" : "Sign in failed");
      err.classList.remove("hidden");
    }
    btn.disabled = false;
    btn.textContent = label;
  }

  /* A one-time migration. Parts now live exclusively in an account, but some
     were built on this device back when the app allowed signed-out use, and
     this app cannot know who built them. So they are offered exactly once, to
     the first account that signs in, and the answer is recorded: after that
     the device store is claimed and a second account is never shown it.

     Silently adopting them is what once put one person's parts in another's
     library, and silently dropping them would lose real work. Asking is the
     only honest option. */
  function offerDeviceParts(who) {
    if (!who) return;
    var dev = ST.deviceStore();
    if (!dev.parts || dev.claimedBy) return;
    var n = dev.parts;
    var many = n === 1 ? "1 part" : n + " parts";
    openSheet(
      '<h2 class="sheet-title serif">Bring ' + esc(many) + ' into ' + esc(who) + "?</h2>" +
      '<p class="dim">' + esc(many) + " on this device " +
      "was made before an account was required, so it is not attached to anyone yet. " +
      "If that is your work, bring it in &mdash; it will sync to every device you " +
      "sign in on. If it belongs to whoever used this device before you, leave it.</p>" +
      '<p class="dim">Asked once. Either way, no other account will be offered these parts.</p>' +
      '<button class="btn btn-primary btn-big" id="devAdopt">Yes, they are mine</button>' +
      '<button class="btn btn-ghost btn-big" id="devLeave">No, they are not mine</button>'
    );
    $("#devAdopt").addEventListener("click", function () {
      var got = ST.claimDeviceStore();
      closeSheet(); renderParts(); buzz(12);
      toast(got ? "Brought in " + got + " part(s)" : "Nothing to bring in");
    });
    $("#devLeave").addEventListener("click", function () {
      ST.leaveDeviceStore();
      closeSheet();
      toast("Left alone - they stay out of your account");
    });
  }

  function bindLoginForm() {
    $("#loginSubmit").addEventListener("click", doLogin);
    $("#loginPass").addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });
    $("#loginToggle").addEventListener("click", function () { setLoginMode(!signupMode); buzz(); });
  }

  function showLogin() { $("#login").classList.remove("hidden"); }

  /* Sign-in is required: parts live in an account and nowhere else. With no
     session the app stays hidden behind the sign-in gate; a successful sign-in
     reveals it, and signing out hides it again. */
  function requireLogin() {
    if (AUTH.isLoggedIn()) {
      $("#login").classList.add("hidden");
      $("#app").classList.remove("hidden");
      showView("parts");
      return;
    }
    $("#app").classList.add("hidden");
    setLoginMode(signupMode);
    showLogin();
  }

  /* Once per open. The first run is one calendar day long: on it the coach
     cues explain the framework, and from the next open onwards the daily
     check-in is what greets a returning person instead. */
  function openTick() {
    var s = ST.state.settings;
    var today = S.todayISO();
    if (s.coachOn && s.firstRun && S.daysBetween(s.firstRun, today) >= 1) s.coachOn = false;
    s.lastOpen = today;
    ST.save();
  }

  /* ================= boot wiring ================= */
  function init() {
    if (isIOS()) document.documentElement.classList.add("ios");
    openTick();
    applyTheme();
    watchInstall();
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

    document.querySelectorAll(".tab").forEach(function (t) {
      t.addEventListener("click", function () { showView(t.dataset.view); });
    });
    $("#themeBtn").addEventListener("click", cycleTheme);
    $("#learnBtn").addEventListener("click", learnSheet);
    $("#fabNew").addEventListener("click", newSessionSheet);
    $("#sheetBackdrop").addEventListener("click", closeSheet);
    $("#panelBack").addEventListener("click", closePanel);
    $("#mapKeyBtn").addEventListener("click", function () { if (keyOpen) closeKey(); else openKey(); });
    $("#mapLegendScrim").addEventListener("click", closeKey);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeKey(); });
    $("#groundResume").addEventListener("click", hideGrounding);
    $("#groundEnd").addEventListener("click", function () {
      hideGrounding();
      if (session) endSession();
    });
    bindLoginForm();

    /* Everyone who was already signed in when this shipped has their parts in
       the device store, because that is where every install kept them before
       accounts had their own. Their account store opens empty, so offer them
       the claim at boot as well as at sign-in - otherwise the first thing they
       see after the update is an empty library. */
    if (AUTH.isLoggedIn()) {
      setTimeout(function () { offerDeviceParts(AUTH.getUsername()); }, 900);
    }

    // swipe-down on the sheet grip
    var sheet = $("#sheet");
    var startY = null;
    sheet.addEventListener("touchstart", function (e) { startY = e.touches[0].clientY; }, { passive: true });
    sheet.addEventListener("touchend", function (e) {
      if (startY != null && e.changedTouches[0].clientY - startY > 80) closeSheet();
      startY = null;
    }, { passive: true });

    document.body.addEventListener("click", function (e) {
      var t = e.target.closest("[data-action]");
      if (!t) return;
      if (t.dataset.action === "new-intake") startSession("intake", []);
      if (t.dataset.action === "create-part") createPartSheet("");
      if (t.dataset.action === "import-part") importSheet();
      if (t.dataset.action === "build-table") buildTable(false);
      if (t.dataset.action === "learn-table") learnPage("table");
      if (t.dataset.action === "load-sample") {
        try {
          ST.upsertPart(MD.parse(ST.SAMPLE_CRITIC));
          renderParts(); toast("The Critic has arrived (fictional sample)");
        } catch (e2) { toast("Sample failed: " + e2.message); }
      }
    });

    if (ST.state.settings.onboarded) {
      // sign-in gates the app: signed in reveals it, signed out shows the gate
      requireLogin();
    } else {
      runOnboarding();
    }
  }

  window.IFS.ui = {
    init: init,
    toast: toast,
    refresh: function (msg) {
      renderParts();
      if (msg) toast(msg);
    }
  };
})();
