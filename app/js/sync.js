/* Inner Table - pushes/pulls the whole state blob to the signed-in user's
   private slot via /api/sync, so edits on one device reach another.
   On-device storage stays the source of truth; sync is best-effort on top
   of it, and merges through store.importAll's existing merge logic rather
   than overwriting. */
(function () {
  "use strict";
  var ST = window.IFS.store;
  var AUTH = window.IFS.auth;
  var PUSH_DELAY = 1500;

  var pushTimer = null;
  var suppressPush = false;
  var lastStatus = "";
  /* Push sends the whole state, so it overwrites whatever the server holds.
     Until a pull has told us what that is, pushing could flatten another
     device's parts with this one's - so nothing goes up before a pull has
     come back. Signing out clears it, so a second account never inherits
     the first one's permission to write. */
  var reconciled = false;

  function authHeaders() {
    return { "Content-Type": "application/json", "Authorization": "Bearer " + AUTH.getToken() };
  }

  function schedulePush() {
    if (suppressPush || !AUTH.isLoggedIn()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, PUSH_DELAY);
  }

  async function push() {
    if (!AUTH.isLoggedIn() || !reconciled) return;
    try {
      var r = await fetch("/api/sync", { method: "POST", headers: authHeaders(), body: JSON.stringify({ state: ST.exportAll() }) });
      lastStatus = r.ok ? "synced" : "sync failed";
    } catch (e) { lastStatus = "offline"; }
  }

  /* Returns true if remote data changed anything locally, so the caller can
     decide whether to refresh the UI. suppressPush guards the save() that
     importAll triggers - otherwise a pull would immediately re-push the
     same data it just received. */
  async function pull() {
    if (!AUTH.isLoggedIn()) return false;
    try {
      var r = await fetch("/api/sync", { headers: authHeaders() });
      if (!r.ok) { lastStatus = "sync failed"; return false; }
      var data = await r.json();
      reconciled = true;          // we now know what the server holds
      lastStatus = "synced";
      if (!data.state) {          // nothing up there yet: seed it from here
        schedulePush();
        return false;
      }
      suppressPush = true;
      try { ST.importAll(data.state); }
      finally { suppressPush = false; }
      // importAll merges rather than replaces, so local now holds the union
      // of both devices - send that back so the server has it too
      schedulePush();
      return true;
    } catch (e) { lastStatus = "offline"; return false; }
  }

  /* Signing out must also drop the permission to write. */
  function reset() { reconciled = false; clearTimeout(pushTimer); lastStatus = ""; }

  function status() { return lastStatus; }

  ST.onChange(schedulePush);

  window.IFS.sync = { push: push, pull: pull, reset: reset, status: status };
})();
