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
  /* ...and it is permission to write *as one account*. Holding the username
     the pull answered for means a push queued moments before an account
     switch can never land in the new account's slot. */
  var reconciledFor = null;

  /* Pictures sync on their own endpoint (see api/sync-images.js), so a set of
     photos too big for the server to take can never stop the profiles from
     syncing. The same rule as above applies to them: nothing goes up until a
     pull has said what the server holds, and `picturesAt` is the fingerprint
     of that - a push only happens when what is here no longer matches it. */
  var picturesKnown = false;
  var picturesAt = "";

  /* Sessions the person's own AI saved through their link arrive in an inbox
     beside the state (api/bridge.js). Each is folded in like a pasted
     profile - merged, never replacing - and acknowledged only on the push
     that carries it, so the server drops it once it is safely in the state. */
  var pendingAck = [];
  var lastFromAi = [];

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
    if (AUTH.getUsername() !== reconciledFor) return;   // account changed under us
    try {
      var ack = pendingAck.slice();
      var r = await fetch("/api/sync", { method: "POST", headers: authHeaders(),
        body: JSON.stringify({ state: ST.exportAll({ images: false }), ack: ack }) });
      lastStatus = r.ok ? "synced" : "sync failed";
      if (r.ok) pendingAck = pendingAck.filter(function (id) { return ack.indexOf(id) < 0; });
    } catch (e) { lastStatus = "offline"; return; }
    await pushPictures();
  }

  /* Best-effort and silent: pictures failing to sync is not "sync failed" -
     the profiles did sync - and the next push simply tries again, because
     `picturesAt` only moves on success. */
  async function pushPictures() {
    if (!picturesKnown) return;
    var mine = ST.imageFingerprint();
    if (mine === picturesAt) return;
    var who = AUTH.getUsername();
    try {
      var r = await fetch("/api/sync-images", { method: "POST", headers: authHeaders(), body: JSON.stringify({ images: ST.exportImages() }) });
      // the account may have changed while the request was in flight
      if (r.ok && AUTH.getUsername() === who && picturesKnown) picturesAt = mine;
    } catch (e) { /* offline, or too large: try again on the next push */ }
  }

  /* Fold the server's pictures into this device's, last writer wins by each
     picture's own stamp (ST.importImages). Runs after the profiles are in,
     because a picture only lands on a part that is here. A server that
     cannot be asked leaves `picturesKnown` false, and then pictures simply
     stay on this device for now rather than risking an overwrite. */
  async function pullPictures() {
    try {
      var r = await fetch("/api/sync-images", { headers: authHeaders() });
      if (!r.ok) return;
      var data = await r.json();
      if (data.images) {
        // like the profiles above, what comes down is not a local edit and
        // must not queue a push of its own
        suppressPush = true;
        try { ST.importImages(data.images); }
        finally { suppressPush = false; }
      }
      picturesAt = data.images ? ST.imageFingerprint(data.images) : "";
      picturesKnown = true;
    } catch (e) { /* offline, or a blob this build cannot read: leave it alone */ }
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
      reconciledFor = AUTH.getUsername();
      lastStatus = "synced";
      if (!data.state) {          // nothing up there yet: seed it from here
        await pullPictures();
        schedulePush();
        return false;
      }
      suppressPush = true;
      // a pull is another device's copy of this same account, so deletions
      // it has not heard about must not undo ones made here
      try { ST.importAll(data.state, { sync: true }); }
      finally { suppressPush = false; }
      applyInbox(data.inbox);
      await pullPictures();
      // importAll merges rather than replaces, so local now holds the union
      // of both devices - send that back so the server has it too
      schedulePush();
      return true;
    } catch (e) { lastStatus = "offline"; return false; }
  }

  /* A save is an edit made now, through the person's own AI: stamped as such
     (mergePart without keepStamp), so it outranks an older copy anywhere. */
  function applyInbox(inbox) {
    lastFromAi = [];
    (Array.isArray(inbox) ? inbox : []).forEach(function (entry) {
      if (!entry || typeof entry.id !== "string") return;
      (Array.isArray(entry.parts) ? entry.parts : []).forEach(function (raw) {
        var clean = window.IFS.schema.normalizePart(raw);
        if (!clean) return;
        // deleted here after the AI saved it: the deletion is the later word
        var stone = ST.state.deleted && ST.state.deleted.parts && ST.state.deleted.parts[clean.slug];
        if (stone && (clean.updated || "") <= stone) return;
        delete clean.image; delete clean.image_at;   // never carried; never cleared
        ST.mergePart(clean);
        if (lastFromAi.indexOf(clean.name) < 0) lastFromAi.push(clean.name);
      });
      // a meeting's card and a conversation's note travel the same way
      ST.mergeHistory({ meetings: entry.meetings, journal: entry.journal });
      if (Array.isArray(entry.meetings) && entry.meetings.length && lastFromAi.indexOf("a table meeting") < 0) lastFromAi.push("a table meeting");
      if (Array.isArray(entry.journal) && entry.journal.length && lastFromAi.indexOf("a conversation") < 0) lastFromAi.push("a conversation");
      if (pendingAck.indexOf(entry.id) < 0) pendingAck.push(entry.id);
    });
  }

  /* Signing out must also drop the permission to write. */
  function reset() {
    reconciled = false; reconciledFor = null; clearTimeout(pushTimer); lastStatus = "";
    pendingAck = []; lastFromAi = [];
    picturesKnown = false; picturesAt = "";
  }

  function status() { return lastStatus; }

  ST.onChange(schedulePush);

  window.IFS.sync = { push: push, pull: pull, reset: reset, status: status,
    // names of parts the last pull brought in from a session the person's AI saved
    fromAi: function () { return lastFromAi.slice(); } };
})();
