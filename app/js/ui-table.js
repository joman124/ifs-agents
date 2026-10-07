/* Inner Table - UI: the Table tab.

Fraser's Table lives here: the room build, who sits where, the tools and
agreements, table meetings and their cards, and the round of the table with
the readings history. An IIFE off window.IFS like every other module; shared
shell helpers (sheets, panels, toasts) arrive through window.IFS.ui._share,
which ui.js attaches before this script runs. */
(function () {
  "use strict";
  var UI = window.IFS.ui._share;
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
  var esc = UI.esc, toast = UI.toast, bind = UI.bind, buzz = UI.buzz, $ = UI.$;
  var openSheet = UI.openSheet, closeSheet = UI.closeSheet;
  var openPanel = UI.openPanel, closePanel = UI.closePanel;
  var showView = UI.showView;
  var renderParts = UI.renderParts, renderMap = UI.renderMap, renderCoach = UI.renderCoach;
  var openProfile = UI.openProfile, openTranscript = UI.openTranscript;
  var askMaterial = UI.askMaterial, splitLines = UI.splitLines, tagList = UI.tagList;
  function currentView() { return UI.currentView(); }

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

  /* How one pair's readings moved over the rounds they have been through.
     The profile keeps only the latest reading and the one before it, so the
     timeline shows at most two points a side - what was actually recorded,
     in the order it was recorded, never a back-filled curve. */
  function feelingHistorySheet(aSlug, bSlug) {
    var a = ST.getPart(aSlug), b = ST.getPart(bSlug);
    if (!a || !b) return;
    var hist = S.feelingHistory(a, b);
    if (!hist.length) { toast("No readings between these two yet - a round of the table records the first"); return; }
    function dots(rating) {
      var tone = S.feelingTone(rating);
      var out = "";
      for (var i = 1; i <= 5; i++) out += '<i class="fdot ' + tone + (i <= rating ? " on" : "") + '"></i>';
      return out;
    }
    openSheet(
      '<h2 class="sheet-title serif">' + esc(a.name) + " &amp; " + esc(b.name) + "</h2>" +
      '<p class="dim">Every round of the table asks each part how it feels toward the others. This is what they have said so far - one side at a time, latest last.</p>' +
      hist.map(function (h) {
        return '<div class="hist-dir"><div class="hist-who">' + esc(h.from) +
          ' <span class="dim">&rarr; ' + esc(h.to) + '</span>' +
          (h.rounds > 1 ? ' <span class="dim">&middot; asked ' + h.rounds + ' times</span>' : "") + "</div>" +
          h.steps.map(function (s) {
            return '<div class="hist-step"><span class="hist-dots">' + dots(s.rating) + "</span>" +
              '<span class="hist-lab">' + esc(S.feelingLabel(s.rating).toLowerCase()) + "</span>" +
              '<span class="dim">' + (s.date ? esc(s.date) : "an earlier round") + "</span></div>";
          }).join("") + "</div>";
      }).join("") +
      '<button class="btn btn-soft btn-big" id="histClose">Close</button>'
    );
    bind("#histClose", closeSheet);
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
      if (currentView() === "map") renderMap();
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
      '<span class="kicker">' + window.IFS.icon("table", 15) + " Your meeting room</span>" +
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

  window.IFS.ui.renderTable = renderTable;
  window.IFS.ui.offerRound = offerRound;
  window.IFS.ui.roundOfTheTable = roundOfTheTable;
  window.IFS.ui.likertRowHTML = likertRowHTML;
  window.IFS.ui.bindLikert = bindLikert;
  window.IFS.ui.readLikert = readLikert;
  window.IFS.ui.applyRound = applyRound;
  window.IFS.ui.openMeeting = openMeeting;
  window.IFS.ui.buildTable = buildTable;
  window.IFS.ui.feelingHistorySheet = feelingHistorySheet;
})();
