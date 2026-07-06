/* Inner Table - boot. */
(function () {
  "use strict";
  window.IFS.store.load();
  window.IFS.ui.init();

  // PWA: register the service worker when served over http(s)
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function (e) {
        console.warn("sw registration failed", e);
      });
    });
  }
})();
