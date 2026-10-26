/* Inner Table - writing a finished conversation into its parts.

   A "just talk" conversation leaves a note naming the parts it was about, and
   each of them is written into: the connected AI reads the transcript and
   writes that part's profile update, which is merged straight in
   (schema.mergeSession - nothing is erased). ui.js decides when - right after
   a conversation closes, for any part its closing reply skipped, and when the
   app opens, for conversations from before - and says how it went; this owns
   the writing.

   One part per call. Each reply is a whole profile update, and asking for
   every part's at once was the longest thing the app asked a model to write:
   models that think before they answer, and free ones with small output
   limits, ran out of room and sent back an empty reply. */
(function () {
  "use strict";
  var S = window.IFS.schema;
  var MD = window.IFS.md;
  var ST = window.IFS.store;
  var T = window.IFS.templates;
  var LLM = window.IFS.llm;

  /* "The Wandering Magician", "Wandering Magician", "the wandering-magician"
     all name the same part. */
  function nameKey(n) { return String(n || "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, ""); }

  /* Whether a part already holds a profile update from that day: anything in
     its log but a conversation's line or a quick notice. This, not a mark on
     the transcript, is what says a conversation was written in - a mark can
     be left by an attempt that saved nothing. */
  function updatedOn(part, date) {
    return (part.sessions || []).some(function (x) { return x.date === date && x.mode !== "talk" && x.mode !== "notice"; });
  }

  /* What the model wrote, merged onto what's already stored - straight in,
     nothing to confirm. Anything the model left out is kept, so a thin
     reply can never quietly delete a field, and new text is added under the
     old rather than replacing it (schema.mergeSession). */
  function saveMerge(incoming) {
    var merged = incoming.map(function (p) { return S.mergeSession(ST.getPart(p.slug), p); });
    merged.forEach(function (p) { ST.upsertPart(p); });
    return merged;
  }

  /* This part's update in a reply, or null. Asked for one part and handed
     one profile: that is the part, whatever it was called. */
  function updateFor(reply, part) {
    var found = [];
    try { found = MD.extractProfiles(reply); } catch (e) { console.error(e); }
    var keys = [nameKey(part.name), nameKey(part.slug)];
    var hit = found.filter(function (p) { return keys.indexOf(nameKey(p.name)) >= 0 || keys.indexOf(nameKey(p.slug)) >= 0; })[0] ||
      (found.length === 1 ? found[0] : null);
    if (!hit) return null;
    hit.slug = part.slug;
    hit.name = part.name;
    return hit;
  }

  /* Write transcript t into each of these parts, one call each, with the
     connection ai. Returns the parts written. A part the AI wrote nothing
     for - an empty reply, a declined one, or no update in it - counts a try
     (ui.js stops asking after three). A call that fails outright - offline,
     rate-limited, the day's free allowance used - throws and counts nothing,
     so it is tried again later; the parts written before it stay written. */
  async function transcript(ai, t, slugs) {
    var saved = [];
    for (var i = 0; i < slugs.length; i++) {
      var part = ST.getPart(slugs[i]);
      if (!part) continue;
      var reply = "";
      try {
        reply = await LLM.chat(ai, T.integrateSystem([part], ST.listParts()),
          [{ role: "user", text: T.integrateAsk([part.name], t.text, t.date) }]);
      } catch (e) {
        if (!e.empty) throw e;
        console.warn("nothing written into " + part.name + ": " + e.message);
      }
      var update = updateFor(reply, part);
      if (!update) { ST.noteIntegrateTry(t.id, [part.slug]); continue; }
      var cur = saveMerge([update])[0];
      // the update's own line in the log, dated the day of the conversation,
      // in case the reply left its sessions entry out
      if (!updatedOn(cur, t.date)) {
        cur.sessions.push({ date: t.date, mode: "checkin", categories: [], note: "Conversation written into the profile" });
        ST.upsertPart(cur);
      }
      ST.markIntegrated(t.id, [cur.slug]);
      saved.push(cur);
    }
    return saved;
  }

  window.IFS.integrate = { transcript: transcript, saveMerge: saveMerge, updatedOn: updatedOn, nameKey: nameKey };
})();
