/* Inner Table - UI: the Learn section.

The reference library - short pages about the framework behind the app,
reachable from the topbar anywhere. An IIFE off window.IFS like every other
module; shared shell helpers arrive through window.IFS.ui._share. */
(function () {
  "use strict";
  var UI = window.IFS.ui._share;
  var R = window.IFS.reference;
  var esc = UI.esc, bind = UI.bind;
  var openSheet = UI.openSheet, closeSheet = UI.closeSheet;
  var openPanel = UI.openPanel, closePanel = UI.closePanel;

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

  window.IFS.ui.learnSheet = learnSheet;
  window.IFS.ui.learnPage = learnPage;
})();
