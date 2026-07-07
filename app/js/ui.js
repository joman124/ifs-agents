/* Inner Table - UI: views, sheets, panels, chat sessions. */
(function () {
  "use strict";
  var S = window.IFS.schema;
  var MD = window.IFS.md;
  var ST = window.IFS.store;
  var T = window.IFS.templates;
  var LLM = window.IFS.llm;
  var G = window.IFS.graph;

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

  /* ================= sheet ================= */
  function openSheet(html) {
    $("#sheetBody").innerHTML = html;
    $("#sheetBackdrop").classList.remove("hidden");
    var sh = $("#sheet");
    sh.classList.remove("hidden", "closing");
    buzz();
  }
  function closeSheet() {
    var sh = $("#sheet");
    if (sh.classList.contains("hidden")) return;
    sh.classList.add("closing");
    setTimeout(function () {
      sh.classList.add("hidden"); sh.classList.remove("closing");
      $("#sheetBackdrop").classList.add("hidden");
    }, 210);
  }

  /* ================= panel ================= */
  var panelOnClose = null;
  function openPanel(title, sub, bodyHTML, actionsHTML, onClose) {
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
    p.classList.add("closing");
    setTimeout(function () { p.classList.add("hidden"); p.classList.remove("closing"); $("#panelBody").innerHTML = ""; }, 190);
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
    $("#topTitle").textContent = { parts: "Inner Table", map: "Swarm Map", sessions: "Sessions", settings: "Settings" }[name];
    $("#fabNew").classList.toggle("hidden", name !== "parts");
    if (name === "map") renderMap(); else G.stop();
    if (name === "parts") renderParts();
    if (name === "sessions") renderSessions();
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

  function doExportBackup() {
    downloadBlob(new Blob([ST.exportAll()], { type: "application/json" }), "inner-table-backup-" + S.todayISO() + ".json");
    ST.markBackup();
    renderParts();
    toast("Backup exported - store it somewhere private");
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
  }

  function renderParts() {
    renderBanners();
    var parts = ST.listParts();
    var list = $("#partsList");
    $("#partsEmpty").classList.toggle("hidden", parts.length > 0);
    list.innerHTML = parts.map(function (p) {
      var rd = S.readiness(p);
      var score = S.coverageScore(p);
      var last = p.sessions.length ? p.sessions[p.sessions.length - 1] : null;
      var sub = p.positive_intent || (last ? "last session " + last.date : "not yet interviewed");
      return '<div class="part-card" data-slug="' + esc(p.slug) + '">' +
        ringSVG(score, (p.name || "?").charAt(0).toUpperCase()) +
        '<div class="part-card-main">' +
        '<div class="part-card-name">' + esc(p.name) +
        ' <span class="badge ' + esc(p.type) + '">' + esc(p.type) + "</span></div>" +
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
      return '<div class="covitem cov-' + st + '" title="' + st + '"><i></i>' + esc(S.CATEGORY_LABELS[c]) + "</div>";
    }).join("");

    var relHTML = (p.relationships && p.relationships.length)
      ? p.relationships.map(function (r) {
          var other = ST.getPart(r.part);
          return '<div class="sessionrow"><span class="sr-mode">' + esc(r.type.replace(/-/g, " ")) + "</span><span>" +
            esc(other ? other.name : r.part) + (r.notes ? ' <span class="dim">' + esc(r.notes) + "</span>" : "") + "</span></div>";
        }).join("")
      : '<div class="prose none">no mapped relationships yet</div>';

    var sessHTML = p.sessions.length
      ? p.sessions.slice().reverse().map(function (s) {
          return '<div class="sessionrow"><span class="sr-date">' + esc(s.date) + '</span><span class="sr-mode">' + esc(s.mode) + "</span><span>" + esc(s.note || "") + "</span></div>";
        }).join("")
      : '<div class="prose none">no sessions logged</div>';

    var narrHTML = S.NARRATIVE_SECTIONS.filter(function (sec) { return sec.key !== "session_notes"; })
      .map(function (sec) {
        return '<div class="card"><h3>' + esc(sec.title) + "</h3>" + prose(p.narrative[sec.key]) + "</div>";
      }).join("");

    var body =
      '<div class="profile">' +
      '<div class="profile-hero">' +
      '<div class="avatar">' + esc((p.name || "?").charAt(0).toUpperCase()) + "</div>" +
      '<h1 class="serif">' + esc(p.name) + "</h1>" +
      '<div class="sub"><span class="badge ' + esc(p.type) + '">' + esc(p.type) + "</span></div>" +
      (facts.length ? '<div class="chips">' + facts.map(function (f) { return '<span class="chip">' + f + "</span>"; }).join("") + "</div>" : "") +
      "</div>" +
      '<div class="readiness ' + (rd.ready ? "ok" : "no") + '">' +
      (rd.ready ? "&#10003; Developed enough to speak at table meetings"
                : "Needs " + esc(rd.missing.join(", ")) + " before it can speak for itself") +
      "</div>" +
      '<div class="card"><h3>Positive intent</h3>' + prose(p.positive_intent) + "</div>" +
      '<div class="card"><h3>Coverage</h3><div class="covgrid">' + covHTML + "</div></div>" +
      '<div class="card"><h3>Fears</h3>' + tagList(p.fears) + "</div>" +
      '<div class="card"><h3>Hopes &amp; goals</h3>' + tagList(p.hopes_goals) + "</div>" +
      '<div class="card"><h3>Behaviors</h3>' + tagList(p.behaviors) + "</div>" +
      '<div class="card"><h3>Wants &amp; needs</h3>' + tagList(p.wants_needs) + "</div>" +
      '<div class="card"><h3>Emotions</h3>' + tagList(p.emotions) + "</div>" +
      (p.unburdened_vision ? '<div class="card"><h3>If it no longer had this role</h3>' + prose(p.unburdened_vision) + "</div>" : "") +
      '<div class="card"><h3>Relationships</h3>' + relHTML + "</div>" +
      narrHTML +
      '<div class="card"><h3>Session notes</h3>' + prose(p.narrative.session_notes) + "</div>" +
      '<div class="card"><h3>Session log</h3>' + sessHTML + "</div>" +
      '<div class="profile-cta">' +
      '<button class="btn btn-primary btn-big" id="pfCheckin">Check in with ' + esc(p.name) + "</button>" +
      '<button class="btn btn-soft btn-big" id="pfEmbody"' + (rd.ready ? "" : " disabled") + ">React to material (embody)</button>" +
      '<button class="btn btn-soft btn-big" id="pfExport">Export profile (.md)</button>' +
      '<button class="btn btn-soft btn-big" id="pfEdit">Edit raw markdown</button>' +
      '<button class="btn btn-danger btn-big" id="pfDelete">Delete this part</button>' +
      "</div></div>";

    openPanel(p.name, p.type + " · " + Math.round(S.coverageScore(p) * 100) + "% developed", body);

    $("#pfCheckin").addEventListener("click", function () { startSession("checkin", [p.slug]); });
    var em = $("#pfEmbody");
    if (em) em.addEventListener("click", function () { askMaterial("embody", [p.slug]); });
    $("#pfExport").addEventListener("click", function () { exportPartMd(p); });
    $("#pfEdit").addEventListener("click", function () { editRaw(p.slug); });
    $("#pfDelete").addEventListener("click", function () {
      openSheet(
        '<h2 class="sheet-title serif">Delete ' + esc(p.name) + "?</h2>" +
        '<p class="dim">This removes the profile and its relationship edges from this device. Export it first if you want to keep it.</p>' +
        '<button class="btn btn-danger btn-big" id="delYes">Delete forever</button>' +
        '<button class="btn btn-ghost btn-big" id="delNo">Keep it</button>'
      );
      $("#delYes").addEventListener("click", function () {
        ST.deletePart(p.slug); closeSheet(); closePanel(); renderParts(); toast(p.name + " deleted");
      });
      $("#delNo").addEventListener("click", closeSheet);
    });
  }

  function exportPartMd(p) {
    var md = MD.serialize(p);
    var file = new Blob([md], { type: "text/markdown" });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([file], p.slug + ".md")] })) {
      navigator.share({ files: [new File([file], p.slug + ".md", { type: "text/markdown" })], title: p.name })
        .catch(function () {});
    } else {
      downloadBlob(file, p.slug + ".md");
    }
    toast("Profile exported - keep it private");
  }

  function downloadBlob(blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
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
        if (np.slug !== slug) ST.deletePart(slug);
        ST.upsertPart(np);
        closePanel(); renderParts(); toast("Saved");
        openProfile(np.slug);
      } catch (e) { toast("Not saved: " + e.message); }
    });
  }

  /* ================= new session flows ================= */
  function newSessionSheet() {
    var parts = ST.listParts();
    var ready = parts.filter(function (p) { return S.readiness(p).ready; });
    openSheet(
      '<h2 class="sheet-title serif">Start something</h2>' +
      menuItem("", "Meet a new part", "intake interview · 10-20 min", "mi-intake") +
      menuItem("", "Create a part by hand", "just a name is enough to start", "mi-create") +
      menuItem("", "Check in with a part", parts.length ? "deepen an existing profile" : "you need a part first", "mi-checkin", !parts.length) +
      menuItem("", "Map two parts", parts.length >= 2 ? "who protects, who conflicts" : "you need two parts first", "mi-map", parts.length < 2) +
      menuItem("", "A part reacts to material", ready.length ? "embody one part over a document or decision" : "no part is developed enough yet", "mi-embody", !ready.length) +
      menuItem("", "Table meeting", ready.length >= 2 ? "all developed parts respond; Self synthesizes" : "needs two developed parts", "mi-meeting", ready.length < 2) +
      menuItem("", "Import a profile", "paste text or pick a .md file", "mi-import")
    );
    bind("#mi-intake", function () { closeSheet(); startSession("intake", []); });
    bind("#mi-create", function () { createPartSheet(""); });
    bind("#mi-checkin", function () { pickPart("Who do you want to check in with?", function (slug) { startSession("checkin", [slug]); }); });
    bind("#mi-map", function () {
      pickParts("Which two parts should we map?", 2, 2, false, function (slugs) { startSession("mapping", slugs); });
    });
    bind("#mi-embody", function () { pickPart("Which part should react?", function (slug) { askMaterial("embody", [slug]); }, true); });
    bind("#mi-meeting", function () {
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
    "mi-create": "✎"             // pencil
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
          esc(p.name.charAt(0).toUpperCase()) + '</span><span class="mi-main">' + esc(p.name) +
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

  function pickPart(title, cb, mustBeReady) {
    var parts = ST.listParts().filter(function (p) { return !mustBeReady || S.readiness(p).ready; });
    openSheet(
      '<h2 class="sheet-title serif">' + esc(title) + "</h2>" +
      parts.map(function (p) {
        return '<button class="menu-item" data-slug="' + esc(p.slug) + '"><span class="mi-icon">' +
          esc(p.name.charAt(0).toUpperCase()) + '</span><span class="mi-main">' + esc(p.name) +
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
        '<p class="dim">Paste a saved profile, or the end-of-session output from any AI chat &mdash; prose around it is fine, I\'ll find the profile.</p>' +
        '<textarea id="importBox" placeholder="---&#10;name: ..."></textarea>' +
        '<div style="height:10px"></div>' +
        '<div style="display:flex;gap:10px">' +
        '<button class="btn btn-soft" id="importFile" style="flex:1">Pick a .md file</button>' +
        '<button class="btn btn-primary" id="importGo" style="flex:1">Import</button>' +
        '</div>' +
        '<div id="importResult"></div>' +
        '<p class="dim" style="text-align:center;margin:14px 0 6px">no file? no problem</p>' +
        '<button class="btn btn-soft btn-big" id="importByHand">Create the part by hand instead</button>'
      );
      $("#importGo").addEventListener("click", function () { reviewImport($("#importBox").value); });
      $("#importByHand").addEventListener("click", function () { createPartSheet(""); });
      $("#importFile").addEventListener("click", function () {
        var inp = document.createElement("input");
        inp.type = "file"; inp.accept = ".md,.txt,text/markdown,text/plain";
        inp.addEventListener("change", function () {
          var f = inp.files[0]; if (!f) return;
          f.text().then(function (txt) {
            var box = $("#importBox");
            if (box) { box.value = txt; reviewImport(txt); }
          });
        });
        inp.click();
      });
    }, 240);
  }

  /* Analyze pasted/loaded text and render a preview (or friendly diagnosis)
     into the import sheet. Nothing is saved until the person confirms. */
  function reviewImport(text) {
    var box = $("#importResult");
    if (!box) return;
    var res = MD.analyze(text);

    if (res.profiles.length) {
      var cards = res.profiles.map(function (p) {
        var exists = !!ST.getPart(p.slug);
        return '<div class="part-card" style="cursor:default">' +
          '<div class="part-card-main"><div class="part-card-name">' + esc(p.name) +
          ' <span class="badge ' + esc(p.type) + '">' + esc(p.type) + '</span></div>' +
          '<div class="part-card-sub">' + (exists ? "updates your existing " + esc(p.name) : "new part") +
          ' &middot; ' + Math.round(S.coverageScore(p) * 100) + '% developed</div></div></div>';
      }).join("");
      box.innerHTML =
        '<div class="readiness ok" style="margin-top:14px">&#10003; Found ' + res.profiles.length + ' profile' + (res.profiles.length > 1 ? "s" : "") + '</div>' +
        cards +
        '<button class="btn btn-primary btn-big" id="importConfirm">Add to library</button>';
      $("#importConfirm").addEventListener("click", function () {
        res.profiles.forEach(ST.upsertPart);
        closeSheet(); renderParts(); buzz(12);
        toast("Welcomed: " + res.profiles.map(function (p) { return p.name; }).join(", "));
        if (res.profiles.length === 1) openProfile(res.profiles[0].slug);
      });
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
        ST.upsertPart(p);
        closeSheet(); renderParts(); buzz(12);
        toast("Welcomed: " + p.name);
        openProfile(p.slug);
      });
      return;
    }

    box.innerHTML =
      '<div class="readiness no" style="margin-top:14px">' + esc(res.error.title) + '</div>' +
      '<p class="dim" style="margin:8px 2px">' + esc(res.error.hint) + '</p>';
  }

  /* Create a part with a simple form - no file, no interview required.
     The profile starts thin on purpose; check-ins deepen it. */
  function createPartSheet(prefillName) {
    closeSheet();
    setTimeout(function () {
      openSheet(
        '<h2 class="sheet-title serif">Create a part by hand</h2>' +
        '<p class="dim">Just a name is enough &mdash; everything else can stay unknown and emerge in check-ins. Only write what you actually sense.</p>' +
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
        p.sessions.push({ date: S.todayISO(), mode: "intake", categories: cats, note: "profile started by hand" });
        ST.upsertPart(p);
        closeSheet(); renderParts(); buzz(12);
        toast("Welcome, " + p.name + " - deepen it with a check-in anytime");
        openProfile(slug);
      });
    }, 240);
  }

  /* ================= chat sessions ================= */
  var session = null; // {mode, slugs, material, system, messages, busy, closed}

  var MODE_TITLES = {
    intake: "Intake interview", checkin: "Check-in", mapping: "Relationship mapping",
    embody: "Embodied reaction", meeting: "Table meeting"
  };

  function buildSystem(mode, slugs, material) {
    var parts = slugs.map(ST.getPart).filter(Boolean);
    if (mode === "intake") return T.intake();
    if (mode === "checkin") return T.checkin(parts[0]);
    if (mode === "mapping") return T.mapping(parts);
    if (mode === "embody") return T.embody(parts[0], material);
    return T.meeting(parts, material);
  }

  function startSession(mode, slugs, material) {
    closeSheet();
    var s = ST.state.settings;
    if (s.provider === "manual" || !LLM.configured(s)) {
      manualSession(mode, slugs, material);
      return;
    }
    session = {
      mode: mode, slugs: slugs, material: material || "",
      system: buildSystem(mode, slugs, material),
      messages: [], busy: false, closed: false
    };
    openChatPanel(session, false);
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
    openPanel(
      MODE_TITLES[sess.mode],
      partNames || "a new part",
      '<div class="chat">' +
      '<button class="groundbtn" id="groundBtn">&#9875; ground me</button>' +
      '<div class="chat-scroll" id="chatScroll">' +
      '<div class="msg system-note">Private session · ' + esc(s.provider) + " · saved as you go · you can stop anytime</div>" +
      "</div>" +
      '<div class="chat-input">' +
      '<textarea id="chatBox" rows="1" placeholder="Speak as yourself or as the part..."></textarea>' +
      '<button class="sendbtn" id="chatSend" aria-label="Send">&#8593;</button>' +
      "</div></div>",
      '<button class="btn btn-soft" id="endSession" style="padding:8px 14px;font-size:.8rem">End &amp; save</button>',
      function () {
        if (session && session.messages.length && !session.closed) {
          if (!confirm("Pause this session? It stays saved as a draft - resume it anytime from the Parts tab.")) return false;
        }
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

  function renderVoices(text) {
    var re = /\*\*([^*\n]{1,48}?):?\*\*:?\s*/g;
    var segs = [];
    var current = null, last = 0, m;
    while ((m = re.exec(text)) !== null) {
      var chunk = text.slice(last, m.index);
      if (current) current.text += chunk;
      else if (chunk.trim()) segs.push({ name: null, text: chunk });
      current = { name: m[1].replace(/:$/, "").trim(), text: "" };
      segs.push(current);
      last = re.lastIndex;
    }
    var tail = text.slice(last);
    if (current) current.text += tail;
    else if (tail.trim()) segs.push({ name: null, text: tail });

    var hasVoices = segs.some(function (s) { return s.name; });
    if (!hasVoices) {
      var plain = document.createElement("div");
      plain.textContent = text;
      return '<div class="bubble">' + plain.innerHTML + "</div>";
    }
    return segs.filter(function (s) { return s.name || s.text.trim(); }).map(function (s) {
      if (!s.name) return '<div class="bubble">' + esc(s.text.trim()) + "</div>";
      var selfV = /^self$/i.test(s.name);
      return '<div class="voice' + (selfV ? " self-voice" : "") + '" style="--vc:' + voiceColor(s.name) + '">' +
        '<span class="vname">' + esc(s.name) + "</span>" + esc(s.text.trim()) + "</div>";
    }).join("");
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
    box.value = ""; box.style.height = "auto";
    buzz();
    pump(v);
  }

  async function endSession() {
    if (!session || session.busy) return;
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
      '<p class="dim" style="margin:8px 2px">You can extract the profile from a saved transcript later, from the Sessions tab.</p>' +
      '<button class="btn btn-ghost btn-big" id="closeStay">Keep talking instead</button>'
    );
    bind("#closeRetry", function () { closeSheet(); endSession(); });
    bind("#closeSaveOnly", function () {
      closeSheet();
      if (session) finalizeSession(session, null, true);
    });
    bind("#closeStay", closeSheet);
  }

  function finalizeSession(sess, reply, interviewish) {
    sess.closed = true;

    var savedNames = [];
    if (reply) {
      try {
        MD.extractProfiles(reply).forEach(function (p) {
          ST.upsertPart(p);
          savedNames.push(p.name);
        });
      } catch (e) { console.error(e); }
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
    if (visible.length) {
      var text = visible.map(function (m) {
        return (m.role === "user" ? "YOU: " : "GUIDE: ") + m.text;
      }).join("\n\n");
      ST.addTranscript({
        date: S.todayISO(), mode: sess.mode,
        title: MODE_TITLES[sess.mode] + (sess.slugs.length ? " · " + sess.slugs.map(function (sl) { var p = ST.getPart(sl); return p ? p.name : sl; }).join(", ") : ""),
        parts: sess.slugs, text: text
      });
    }
    ST.clearDraft();
    session = null;
    panelOnClose = null;
    closePanel();
    renderParts();
    toast(savedNames.length ? "Profile saved: " + savedNames.join(", ")
      : (interviewish ? "Transcript saved - extract the profile anytime from Sessions" : "Session saved"));
  }

  /* ---------- manual (copy-prompt) mode ---------- */
  function manualSession(mode, slugs, material) {
    var parts = slugs.map(ST.getPart).filter(Boolean);
    var prompt = T.portable(mode, parts, material);
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
  function renderMap() {
    var parts = ST.listParts();
    var svg = $("#swarmSvg");
    var has = parts.length > 0;
    $("#mapEmpty").classList.toggle("hidden", has);
    $("#mapLegend").classList.toggle("hidden", !has);
    $("#mapHint").classList.toggle("hidden", !has);
    $("#mapCard").classList.add("hidden");
    if (has) {
      $("#mapLegend").innerHTML =
        '<div class="lg"><i style="color:var(--manager)"></i>protects</div>' +
        '<div class="lg"><i style="color:var(--firefighter);border-top-style:dashed"></i>polarized</div>' +
        '<div class="lg"><i style="color:var(--good)"></i>allied</div>' +
        '<div class="lg"><i style="color:var(--warn);border-top-style:dotted"></i>conflicts</div>';
      G.render(svg, parts, {
        onSelect: function (node) {
            var card = $("#mapCard");
            if (!node || node.self) { card.classList.add("hidden"); return; }
            var p = ST.getPart(node.id);
            if (!p) { card.classList.add("hidden"); return; }
            var edges = (p.relationships || []).length;
            card.innerHTML =
              '<span class="mc-name">' + esc(p.name) +
              '<span class="mc-sub">' + esc(p.type) + " &middot; " + edges + " relationship" + (edges === 1 ? "" : "s") + "</span></span>" +
              '<button class="btn btn-primary" id="mcOpen">Open profile</button>';
            card.classList.remove("hidden");
            $("#mcOpen").addEventListener("click", function () { openProfile(p.slug); });
            buzz();
        }
      });
    } else {
      G.stop(); svg.innerHTML = "";
    }
  }

  /* ================= sessions ================= */
  function renderSessions() {
    var ts = ST.state.transcripts;
    $("#sessionsEmpty").classList.toggle("hidden", ts.length > 0);
    $("#sessionsList").innerHTML = ts.map(function (t) {
      return '<div class="sess-card" data-id="' + esc(t.id) + '">' +
        '<div class="sc-top"><span>' + esc(t.date) + "</span><span>" + esc(t.mode) + "</span></div>" +
        '<div class="sc-title">' + esc(t.title) + "</div>" +
        '<div class="sc-note">' + esc((t.text || "").slice(0, 90)) + "...</div></div>";
    }).join("");
    document.querySelectorAll(".sess-card").forEach(function (el) {
      el.addEventListener("click", function () {
        var t = ST.state.transcripts.filter(function (x) { return x.id === el.dataset.id; })[0];
        if (!t) return;
        var interviewish = ["intake", "checkin", "mapping"].indexOf(t.mode) >= 0;
        var canExtract = interviewish && LLM.configured(ST.state.settings);
        openPanel(t.title, t.date,
          '<div class="transcript">' +
          (canExtract ? '<button class="btn btn-primary btn-big" id="extractT" style="margin-bottom:6px">Extract the profile from this transcript</button>' +
            '<p class="dim" style="margin:0 0 14px">Rebuilds the part profile from what was said - useful if a session closed without saving one.</p>' : "") +
          '<pre>' + esc(t.text) + "</pre>" +
          '<button class="btn btn-danger btn-big" id="delT">Delete transcript</button></div>');
        $("#delT").addEventListener("click", function () {
          ST.deleteTranscript(t.id); closePanel(); renderSessions(); toast("Deleted");
        });
        var ex = $("#extractT");
        if (ex) ex.addEventListener("click", function () { extractFromTranscript(t, ex); });
      });
    });
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

  /* ================= settings ================= */
  function renderSettings() {
    var s = ST.state.settings;
    $("#settingsPane").innerHTML =
      '<div class="set-group"><h3>Live sessions</h3>' +
      '<div class="set-pad"><div class="seg" id="provSeg">' +
      segBtn("manual", "Copy-prompt", s.provider) + segBtn("gemini", "Gemini", s.provider) + segBtn("anthropic", "Claude", s.provider) +
      "</div>" +
      '<div id="provFields"></div>' +
      '<p class="dim" style="margin:12px 2px 2px">Your key is stored only on this device and sent directly to the provider. Anything you share in a session is subject to that provider’s data policies.</p>' +
      "</div></div>" +

      '<div class="set-group"><h3>Appearance</h3>' +
      '<div class="set-pad"><div class="seg" id="themeSeg">' +
      segBtn("auto", "Auto", s.theme) + segBtn("dark", "Dark", s.theme) + segBtn("light", "Light", s.theme) +
      "</div></div>" +
      '<div class="set-row"><span class="sr-main">Haptic feedback<span class="sr-sub">tiny vibrations on taps (where supported)</span></span>' +
      '<input type="checkbox" id="hapt" style="width:auto" ' + (s.haptics ? "checked" : "") + "></div></div>" +

      '<div class="set-group"><h3>Your data</h3>' +
      '<div class="set-row"><span class="sr-main">Export backup<span class="sr-sub">all parts + transcripts as one JSON file</span></span><button class="btn btn-soft" id="expAll">Export</button></div>' +
      '<div class="set-row"><span class="sr-main">Import backup<span class="sr-sub">merge a previously exported file</span></span><button class="btn btn-soft" id="impAll">Import</button></div>' +
      '<div class="set-row"><span class="sr-main" style="color:var(--danger)">Erase everything<span class="sr-sub">removes all parts and sessions from this device</span></span><button class="btn btn-danger" id="wipeAll">Erase</button></div>' +
      "</div>" +

      '<div class="set-group"><h3>About</h3>' +
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
    $("#hapt").addEventListener("change", function (e) { s.haptics = e.target.checked; ST.save(); buzz(); });
    $("#expAll").addEventListener("click", doExportBackup);
    $("#impAll").addEventListener("click", function () {
      var inp = document.createElement("input");
      inp.type = "file"; inp.accept = ".json,application/json";
      inp.addEventListener("change", function () {
        var f = inp.files[0]; if (!f) return;
        f.text().then(function (txt) {
          try { var n = ST.importAll(txt); renderParts(); toast("Imported " + n + " part(s)"); }
          catch (e) { toast("Import failed: " + e.message); }
        });
      });
      inp.click();
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

  function renderProviderFields() {
    var s = ST.state.settings;
    var el = $("#provFields");
    if (s.provider === "manual") {
      el.innerHTML = '<p class="dim" style="margin:12px 2px 0">No key needed. Sessions generate a portable prompt you paste into any AI chat, then paste the updated profile back.</p>';
      return;
    }
    var isG = s.provider === "gemini";
    el.innerHTML =
      '<label class="fieldlabel">' + (isG ? "Gemini" : "Anthropic") + ' API key</label>' +
      '<input type="password" id="provKey" autocomplete="off" placeholder="' + (isG ? "AIza..." : "sk-ant-...") + '" value="' + esc(isG ? s.geminiKey : s.anthropicKey) + '">' +
      '<label class="fieldlabel">Model</label>' +
      '<input type="text" id="provModel" value="' + esc(isG ? s.geminiModel : s.anthropicModel) + '">' +
      '<p class="dim" style="margin:10px 2px 0">' + (isG
        ? 'Free keys at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com</a>.'
        : 'Keys at <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a>.') + "</p>";
    $("#provKey").addEventListener("input", function (e) {
      if (isG) s.geminiKey = e.target.value.trim(); else s.anthropicKey = e.target.value.trim();
      ST.save();
    });
    $("#provModel").addEventListener("input", function (e) {
      if (isG) s.geminiModel = e.target.value.trim(); else s.anthropicModel = e.target.value.trim();
      ST.save();
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
      ST.state.settings.onboarded = true;
      ST.save();
      $("#onboarding").classList.add("hidden");
      $("#app").classList.remove("hidden");
      showView("parts");
      buzz(15);
    });
  }

  /* ================= boot wiring ================= */
  function init() {
    applyTheme();
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

    document.querySelectorAll(".tab").forEach(function (t) {
      t.addEventListener("click", function () { showView(t.dataset.view); });
    });
    $("#themeBtn").addEventListener("click", cycleTheme);
    $("#fabNew").addEventListener("click", newSessionSheet);
    $("#sheetBackdrop").addEventListener("click", closeSheet);
    $("#panelBack").addEventListener("click", closePanel);
    $("#groundResume").addEventListener("click", hideGrounding);
    $("#groundEnd").addEventListener("click", function () {
      hideGrounding();
      if (session) endSession();
    });

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
      if (t.dataset.action === "load-sample") {
        try {
          ST.upsertPart(MD.parse(ST.SAMPLE_CRITIC));
          renderParts(); toast("The Critic has arrived (fictional sample)");
        } catch (e2) { toast("Sample failed: " + e2.message); }
      }
    });

    if (ST.state.settings.onboarded) {
      $("#app").classList.remove("hidden");
      showView("parts");
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
