/* Inner Table - boot. */
(function () {
  "use strict";
  window.IFS.store.load();
  window.IFS.ui.init();

  // durability: mirror state into IndexedDB (restores if localStorage was
  // cleared) and ask the browser not to evict this origin's storage
  window.IFS.store.initMirror(function (restored) {
    if (restored) window.IFS.ui.refresh("Your parts were restored from the on-device backup mirror");
  });
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(function () {});
  }

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
