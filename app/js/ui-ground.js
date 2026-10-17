/* Inner Table - UI: Ground me.
   The grounding page is the person's own, shaped like a safety plan: the
   signs that tell them they need it, the skills that ground them, the people
   and places that help, who to call. ui.js opens and closes the page (the
   breath, the session buttons); this draws the plan into #groundPlan and
   edits it in place - in place because the page sits above every sheet, and
   someone reaching for it should not be sent anywhere else. The plan is
   store.plan: it syncs, and sessions read it (templates.groundingBlock). */
(function () {
  "use strict";
  var UI = window.IFS.ui._share;
  var ST = window.IFS.store;
  var esc = UI.esc, toast = UI.toast, bind = UI.bind, buzz = UI.buzz, $ = UI.$;

  /* The plan's sections, in the order they are written. Shown in a different
     order: skills and people first, because that is what a bad moment needs. */
  var SECTIONS = [
    { key: "signs", title: "My warning signs",
      hint: "Thoughts, feelings or situations that tell me I need this page.",
      eg: "My chest gets tight and I stop answering messages" },
    { key: "skills", title: "What grounds me",
      hint: "Things I can do on my own, right now. One per line.",
      eg: "Cold water on my hands" },
    { key: "places", title: "People and places that help me settle",
      hint: "Company or a change of scene - not to talk about it, just to be somewhere else.",
      eg: "A walk round the block" },
    { key: "people", title: "People I can reach out to",
      hint: "One per line: a name, then a number. The number becomes a call button.",
      eg: "Sam 555 123 4567" },
    { key: "pros", title: "Professionals I can contact",
      hint: "A therapist, a doctor, a local crisis team. Name, then number.",
      eg: "Dr Rivera 555 987 6543" },
    { key: "safe", title: "Making my space safer",
      hint: "What I can do to keep myself safe when things are hard.",
      eg: "Ask someone to hold onto things for me" },
    { key: "reasons", title: "What matters to me",
      hint: "Reasons to keep going. People, plans, small things.",
      eg: "My dog, who needs a walk tomorrow" }
  ];

  /* Starters for an empty plan: one tap adds one, in the person's plan, to
     keep or change. Ordinary grounding, nothing clinical. */
  var STARTERS = [
    "Press my feet into the floor",
    "Breathe out longer than I breathe in",
    "Name 5 things I can see, 4 I can hear, 3 I can touch",
    "Cold water on my hands or face",
    "Hold something with a texture",
    "Say: a part of me is scared, and I'm here with it",
    "Step outside for a minute"
  ];

  function plan() { return ST.state.plan || {}; }
  function items(k) { return Array.isArray(plan()[k]) ? plan()[k] : []; }

  /* "Sam 555 123 4567" -> { label: "Sam", tel: "5551234567" }. A line with no
     number is still kept, it just has nothing to dial. */
  function contact(line) {
    var m = String(line).match(/\+?\d[\d\s().-]{4,}\d/);
    if (!m) return { label: line, tel: "" };
    var label = (line.slice(0, m.index) + line.slice(m.index + m[0].length))
      .replace(/^[\s:,\-–—]+|[\s:,\-–—]+$/g, "").trim();
    return { label: label || m[0].trim(), tel: m[0].replace(/[^\d+]/g, ""), shown: m[0].trim() };
  }

  function contactRow(line) {
    var c = contact(line);
    return '<div class="gp-contact"><span class="gp-who">' + esc(c.label) +
      (c.tel && c.label !== c.shown ? '<small>' + esc(c.shown) + "</small>" : "") + "</span>" +
      (c.tel
        ? '<a class="btn btn-soft" href="tel:' + esc(c.tel) + '">Call</a><a class="btn btn-soft" href="sms:' + esc(c.tel) + '">Text</a>'
        : "") + "</div>";
  }

  function list(arr) {
    return '<ul class="gp-list">' + arr.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
  }

  function render() {
    var box = $("#groundPlan");
    if (!box) return;
    var skills = items("skills");
    var reach = items("people").concat(items("pros"));
    var rest = ["signs", "places", "safe", "reasons"].filter(function (k) { return items(k).length; });
    var title = function (k) { return SECTIONS.filter(function (s) { return s.key === k; })[0].title; };

    box.innerHTML =
      '<section class="gp-card"><h3>My grounding skills</h3>' +
      (skills.length
        ? list(skills)
        : '<p class="dim">Add the ones that work for you &mdash; tap to keep one, or write your own.</p>' +
          '<div class="gp-starters">' + STARTERS.map(function (s, i) {
            return '<button class="chip chip-btn" data-starter="' + i + '">+ ' + esc(s) + "</button>";
          }).join("") + "</div>") +
      "</section>" +
      (reach.length
        ? '<section class="gp-card"><h3>People I can reach</h3>' + reach.map(contactRow).join("") + "</section>"
        : "") +
      (rest.length
        ? '<details class="gp-card gp-more"><summary>The rest of my plan</summary>' +
          rest.map(function (k) { return "<h4>" + esc(title(k)) + "</h4>" + list(items(k)); }).join("") + "</details>"
        : "") +
      '<button class="btn btn-soft btn-big" id="gpEdit">' + (skills.length || reach.length || rest.length ? "Edit my plan" : "Write my grounding plan") + "</button>";

    box.querySelectorAll("[data-starter]").forEach(function (b) {
      b.addEventListener("click", function () {
        var next = Object.assign({}, plan());
        next.skills = items("skills").concat([STARTERS[+b.dataset.starter]]);
        ST.setPlan(next);
        buzz();
        render();
      });
    });
    bind("#gpEdit", edit);
  }

  function edit() {
    var box = $("#groundPlan");
    box.innerHTML = '<section class="gp-card gp-edit"><h3>My grounding plan</h3>' +
      '<p class="dim">Write it while things are calm, so it is here when they aren&rsquo;t. Every part is optional. It stays in your account and syncs to your devices; sessions use your skills when you need grounding.</p>' +
      SECTIONS.map(function (s) {
        return '<label class="fieldlabel" for="gp-' + s.key + '">' + esc(s.title) + "</label>" +
          '<p class="dim gp-hint">' + esc(s.hint) + "</p>" +
          '<textarea id="gp-' + s.key + '" rows="3" placeholder="e.g. ' + esc(s.eg) + '">' + esc(items(s.key).join("\n")) + "</textarea>";
      }).join("") +
      '<button class="btn btn-primary btn-big" id="gpSave">Save my plan</button>' +
      '<button class="btn btn-ghost btn-big" id="gpCancel">Cancel</button></section>';
    box.scrollIntoView({ behavior: "smooth", block: "start" });
    bind("#gpSave", function () {
      var next = {};
      SECTIONS.forEach(function (s) { next[s.key] = UI.splitLines($("#gp-" + s.key).value); });
      ST.setPlan(next);
      buzz(12);
      toast("Your grounding plan is saved");
      render();
    });
    bind("#gpCancel", render);
  }

  window.IFS.ui.ground = { render: render, contact: contact, SECTIONS: SECTIONS };
})();
