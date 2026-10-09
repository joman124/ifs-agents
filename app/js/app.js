/* Inner Table - boot. */
(function () {
  "use strict";
  // open the store belonging to whoever is signed in on this device - the
  // device store only when nobody is
  window.IFS.store.load(window.IFS.auth.isLoggedIn() ? window.IFS.auth.getUsername() : null);
  window.IFS.ui.init();

  // durability: mirror state into IndexedDB (restores if localStorage was
  // cleared) and ask the browser not to evict this origin's storage
  window.IFS.store.initMirror(function (restored) {
    if (restored) window.IFS.ui.refresh("Your parts were restored from the on-device backup mirror");
  });
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(function () {});
  }

  // if this device is signed in, fold in whatever the other device - or the
  // person's own AI, saving a session through their link - changed
  var lastPull = 0;
  function pullNow() {
    if (!window.IFS.auth.isLoggedIn()) return;
    lastPull = Date.now();
    window.IFS.sync.pull().then(function (changed) {
      var fromAi = window.IFS.sync.fromAi();
      if (fromAi.length) window.IFS.ui.refresh("Saved from your AI: " + fromAi.join(", "));
      else if (changed) window.IFS.ui.refresh("Synced with your other device");
    });
    // the AI connection is kept with the account too: connected or
    // disconnected on another device, this one follows
    window.IFS.sync.syncAi().then(function (changed) { if (changed) window.IFS.ui.renderSettings(); });
  }
  // back from OpenRouter's sign-in, the connection is already on the account
  if (/[?&](connected|connect_error)=/.test(location.search)) {
    lastPull = Date.now();
    window.IFS.sync.pull();
    window.IFS.ui.connect.handleReturn();
  } else {
    pullNow();
  }
  /* An installed app is rarely restarted - it is brought back from the
     background. Pull then too, so a session saved from another app in the
     meantime is here when the person looks, and is in before this device's
     next push. A minute between pulls is plenty. */
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && Date.now() - lastPull > 60000) pullNow();
  });

  // PWA: register the service worker when served over http(s)
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function (e) {
        console.warn("sw registration failed", e);
      });
    });
    // When a new version takes over, refresh once so updates appear right
    // away instead of on the next visit. If a session panel is open, don't
    // yank the page - just say the update is ready.
    var hadController = !!navigator.serviceWorker.controller;
    var swRefreshed = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (!hadController) { hadController = true; return; } // first install, page is already current
      if (swRefreshed) return;
      swRefreshed = true;
      var panel = document.getElementById("panel");
      if (panel && !panel.classList.contains("hidden")) {
        window.IFS.ui.toast("Update downloaded - it applies next time you open the app");
      } else {
        location.reload();
      }
    });
  }
})();
