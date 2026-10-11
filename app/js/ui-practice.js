/* Inner Table - UI: the small daily practice around the sessions.

   - Notice a part: ten seconds, no AI. Which part showed up, a line about
     the moment, and how the person felt toward it. The commonest IFS practice
     is just this - noticing - and every notice becomes memory the next
     check-in starts from (schema.addNotice).
   - Looking back: the last 30 days in what IFS counts - who the person sat
     with, how their feeling toward each part moved, which threads between
     parts warmed - rather than how full the profiles are (schema.lookBack).
   An IIFE off window.IFS like every other module; shared shell helpers
   arrive through window.IFS.ui._share. */
(function () {
  "use strict";
  var UI = window.IFS.ui._share;
  var S = window.IFS.schema;
  var ST = window.IFS.store;
  var icon = window.IFS.icon;
  var esc = UI.esc, toast = UI.toast, bind = UI.bind, buzz = UI.buzz, $ = UI.$;

  var FEEL_HINT = {
    curious: "you want to know more", warm: "you feel for it", calm: "it can be here",
    neutral: "nothing much either way", impatient: "you want it to stop",
    annoyed: "it gets on your nerves", afraid: "it worries you", overwhelmed: "it takes over"
  };

  /* slug: preselect a part (from its profile, or the daily card). */
  function noticeSheet(slug) {
    var parts = ST.listParts();
    var chosen = slug || "";
    var feel = "";
    UI.openSheet(
      '<h2 class="sheet-title serif">Notice a part</h2>' +
      '<p class="dim">Ten seconds. Who showed up, and what was happening?</p>' +
      '<div class="nt-chips" id="ntParts">' +
      parts.map(function (p) {
        return '<button class="chip chip-btn' + (p.slug === chosen ? " on" : "") + '" data-slug="' + esc(p.slug) + '">' + esc(p.name) + "</button>";
      }).join("") +
      '<button class="chip chip-btn" data-slug="">' + icon("plus", 12) + " someone new</button></div>" +
      '<input id="ntNew" class="hidden" autocomplete="off" placeholder="A working name - the knot in my chest, the hurrier&hellip;">' +
      '<textarea id="ntText" rows="2" placeholder="Before the meeting it said I&rsquo;d mess it up."></textarea>' +
      '<label class="fieldlabel">How did you feel toward it?</label>' +
      '<div class="nt-chips" id="ntFeel">' +
      S.FEEL_TOWARD.map(function (f) {
        return '<button class="chip chip-btn tone-' + (f.tone > 0 ? "self" : f.tone < 0 ? "reactive" : "mid") + '" data-feel="' + f.key + '">' + f.key + "</button>";
      }).join("") + "</div>" +
      '<p class="dim nt-hint" id="ntHint">Curious, warm or calm is Self showing up. Anything else is welcome too &mdash; it usually means another part is near.</p>' +
      '<button class="btn btn-primary btn-big" id="ntSave">Note it</button>' +
      '<button class="btn btn-ghost btn-big" id="ntCancel">Not now</button>'
    );
    var newInput = $("#ntNew");
    if (!parts.length) { newInput.classList.remove("hidden"); }
    $("#ntParts").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      document.querySelectorAll("#ntParts .chip").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on");
      chosen = b.dataset.slug;
      newInput.classList.toggle("hidden", !!chosen);
      if (!chosen) newInput.focus();
      buzz();
    });
    $("#ntFeel").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      var on = b.classList.contains("on");
      document.querySelectorAll("#ntFeel .chip").forEach(function (x) { x.classList.remove("on"); });
      feel = on ? "" : b.dataset.feel;
      if (!on) b.classList.add("on");
      $("#ntHint").textContent = feel ? feel + " - " + FEEL_HINT[feel] + "." : "";
      buzz();
    });
    bind("#ntCancel", UI.closeSheet);
    bind("#ntSave", function () {
      var text = $("#ntText").value.trim();
      var slugTo = chosen;
      if (!slugTo) {
        var name = newInput.value.trim();
        if (!name) { toast(parts.length ? "Pick a part, or give the new one a working name" : "Give it a working name"); return; }
        slugTo = S.slugify(name);
        if (!ST.getPart(slugTo)) {
          var p = S.blankPart(name);
          p.coverage.introduction = "partial";
          ST.upsertPart(p);
        }
      }
      if (!text && !feel) { toast("A line about the moment, or how you felt toward it"); return; }
      var entry = ST.notice(slugTo, text, feel);
      if (!entry) { toast("Couldn't note that"); return; }
      UI.closeSheet();
      UI.renderParts();
      buzz(12);
      toast("Noted - " + ST.getPart(slugTo).name + (feel ? ", and you felt " + feel : ""));
    });
  }

  var ARROW = { warmer: "warmer", cooler: "cooler", different: "changed" };
  var SCALE = ["", "hostile", "wary", "neutral", "warm", "close"];

  /* The month as a small card on the Parts screen: shown only when there is
     something in it. */
  function lookBackCard() {
    var lb = S.lookBack(ST.listParts(), S.todayISO(), 30);
    if (!lb.sat.length) return "";
    var bits = [lb.sat.length + (lb.sat.length === 1 ? " part" : " parts") + " sat with"];
    var warmer = lb.shifts.filter(function (x) { return x.dir === "warmer"; }).length +
      lb.threads.filter(function (x) { return x.dir === "warmer"; }).length;
    if (warmer) bits.push(warmer + " softened");
    if (lb.notices) bits.push(lb.notices + (lb.notices === 1 ? " notice" : " notices"));
    return '<button class="lookback" id="lbOpen"><span class="lb-i">' + icon("clock", 18) + "</span>" +
      '<span class="lb-main"><b>Your last 30 days</b><span class="lb-sub">' + esc(bits.join(" · ")) + "</span></span>" +
      icon("chevron", 16) + "</button>";
  }

  function openLookBack() {
    var lb = S.lookBack(ST.listParts(), S.todayISO(), 30);
    var body = '<div class="view-pad">';
    body += '<div class="card"><h3>Who you sat with</h3>' + (lb.sat.length
      ? "<ul class=\"lb-list\">" + lb.sat.map(function (x) {
          return '<li><button class="linkbtn" data-slug="' + esc(x.slug) + '">' + esc(x.name) + "</button> &middot; " + x.count + (x.count === 1 ? " time" : " times") + "</li>";
        }).join("") + "</ul>"
      : '<p class="dim">Nobody yet this month.</p>') +
      '<p class="dim">' + lb.sessions + (lb.sessions === 1 ? " session" : " sessions") + " and " + lb.notices + (lb.notices === 1 ? " notice" : " notices") + ".</p></div>";
    body += '<div class="card"><h3>How you felt toward them</h3>' + (lb.shifts.length
      ? "<ul class=\"lb-list\">" + lb.shifts.map(function (x) {
          return "<li><b>" + esc(x.name) + "</b>: " + esc(x.from) + " &rarr; " + esc(x.to) + ' <span class="lb-dir ' + x.dir + '">' + ARROW[x.dir] + "</span></li>";
        }).join("") + "</ul>"
      : '<p class="dim">This shows once you have noted how you felt toward a part more than once this month &mdash; the feeling chips in <b>Notice a part</b>.</p>') + "</div>";
    body += '<div class="card"><h3>Between your parts</h3>' + (lb.threads.length
      ? "<ul class=\"lb-list\">" + lb.threads.map(function (x) {
          return "<li><b>" + esc(x.from) + "</b> toward <b>" + esc(x.to) + "</b>: " + SCALE[x.was] + " &rarr; " + SCALE[x.now] + ' <span class="lb-dir ' + x.dir + '">' + x.dir + "</span></li>";
        }).join("") + "</ul>"
      : '<p class="dim">No thread has moved this month. A table meeting&rsquo;s round of the table records how parts feel toward each other.</p>') + "</div>";
    body += '<p class="dim" style="margin:6px 4px 20px">Nothing here is a score. Warmer is not better every day &mdash; noticing a part that is hard to be with is the practice working.</p></div>';
    UI.openPanel("Looking back", "the last 30 days", body);
    document.querySelectorAll(".lb-list [data-slug]").forEach(function (b) {
      b.addEventListener("click", function () { UI.closePanel(); UI.openProfile(b.dataset.slug); });
    });
  }

  window.IFS.ui.practice = { notice: noticeSheet, lookBackCard: lookBackCard, openLookBack: openLookBack };
})();
