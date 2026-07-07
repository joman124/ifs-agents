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
  }
})();
