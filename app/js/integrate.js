/* Inner Table - writing a finished conversation into its parts.

   A "just talk" conversation leaves a note naming the parts it was about, and
   each of them is written into - as is any part a check-in or a mapping
   session was about whose closing reply left it out: the connected AI reads
   the transcript and writes that part's update, which is merged straight in
   (schema.mergeSession - nothing is erased). ui.js decides when - right after
   a session closes, for any part its closing reply skipped, and when the app
   opens, for conversations from before - and says how it went; this owns the
   writing.

   One part per call, answered as a small JSON object of what is new
   (templates.integrateSystem). A whole profile file per part was the longest
   and most exacting thing the app asked a model to write, and the free
   models dropped it: they ran out of room, or bent the YAML until it no
   longer read, so nothing merged. A reply that writes a profile file anyway
   is still read as one.

   Every save here also lands on the map: a relationship is pointed at the
   real part it names and mirrored onto that part (schema.resolveEdges,
   schema.mirrorEdges), the way the map's own "name this thread" writes it. */
(function () {
  "use strict";
  var S = window.IFS.schema;
  var MD = window.IFS.md;
  var ST = window.IFS.store;
  var T = window.IFS.templates;
  var LLM = window.IFS.llm;

  var nameKey = S.nameKey;

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
     old rather than replacing it (schema.mergeSession). Each relationship
     goes to the part it means, on both sides. Returns the parts as stored. */
  function saveMerge(incoming) {
    var roster = ST.listParts();
    incoming.forEach(function (p) { S.resolveEdges(p, roster); });
    var merged = incoming.map(function (p) { return S.mergeSession(ST.getPart(p.slug), p); });
    merged.forEach(function (p) { ST.upsertPart(p); });
    S.mirrorEdges(incoming, ST.getPart).forEach(function (p) { ST.upsertPart(p); });
    return merged.map(function (p) { return ST.getPart(p.slug) || p; });
  }

  /* ---------------- reading a reply ---------------- */

  var UPDATE_KEYS = ["part", "name", "note", "session_note", "own_words", "emotions", "fears", "hopes_goals", "behaviors",
    "wants_needs", "what_activates_it", "what_it_needs", "relates_to_others", "origin_story", "relationships", "coverage"];

  /* Every JSON object in a reply that reads as an update - the whole reply,
     a fenced block, or one with prose or a model's thinking around it. A
     {parts: [...]} wrapper is opened. */
  function readJSON(text) {
    var t = String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "");
    var objs = [];
    var depth = 0, start = -1, inStr = false, esc = false;
    for (var i = 0; i < t.length; i++) {
      var c = t[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { if (depth) inStr = true; }
      else if (c === "{") { if (!depth) start = i; depth++; }
      else if (c === "}" && depth) {
        depth--;
        if (!depth) { try { objs.push(JSON.parse(t.slice(start, i + 1))); } catch (e) { /* not JSON */ } }
      }
    }
    var out = [];
    objs.forEach(function (o) {
      if (!o || typeof o !== "object" || Array.isArray(o)) return;
      if (Array.isArray(o.parts)) o.parts.forEach(function (u) { if (u && typeof u === "object") out.push(u); });
      else out.push(o);
    });
    return out.filter(function (u) { return UPDATE_KEYS.some(function (k) { return k in u; }); });
  }

  /* A JSON update, as a part to merge: only what it says, checked the way
     an imported profile is (schema.normalizePart's rules), logged on the
     conversation's date. Null when it says nothing at all. */
  function fromJSON(u, part, date) {
    var str = function (v) { return typeof v === "string" ? v.trim() : ""; };
    var list = function (v) {
      var a = Array.isArray(v) ? v : typeof v === "string" && v.trim() ? [v] : [];
      return a.filter(function (x) { return typeof x === "string" && x.trim(); }).map(function (x) { return x.trim(); });
    };
    var p = S.blankPart(part.name);
    p.slug = part.slug;
    var said = 0;
    ["emotions", "fears", "hopes_goals", "behaviors", "wants_needs"].forEach(function (k) { p[k] = list(u[k]); said += p[k].length; });
    ["age", "location", "appearance", "origin", "positive_intent", "unburdened_vision"].forEach(function (k) { p[k] = str(u[k]); if (p[k]) said++; });
    var type = str(u.type).toLowerCase();
    if (S.PART_TYPES.indexOf(type) >= 0) p.type = type;
    var trust = str(u.trust_in_self).toLowerCase();
    if (S.TRUST_LEVELS.indexOf(trust) >= 0) p.trust_in_self = trust;
    p.narrative.in_its_own_words = list(u.own_words).map(function (w) {
      return /^["“]/.test(w) ? w : '"' + w + '"';
    }).join("\n");
    ["what_activates_it", "what_it_needs", "relates_to_others", "origin_story"].forEach(function (k) {
      p.narrative[k] = str(u[k]);
      if (p.narrative[k]) said++;
    });
    if (p.narrative.in_its_own_words) said++;
    p.relationships = (Array.isArray(u.relationships) ? u.relationships : []).filter(function (r) {
      return r && typeof r === "object" && str(r.part) && S.EDGE_TYPES.indexOf(str(r.type).toLowerCase()) >= 0;
    }).map(function (r) { return { part: str(r.part), type: str(r.type).toLowerCase(), notes: str(r.notes) }; });
    said += p.relationships.length;
    // only ground the conversation covered, and never a category the part declined
    var cov = u.coverage && typeof u.coverage === "object" ? u.coverage : {};
    var touched = [];
    S.CATEGORIES.forEach(function (c) {
      var v = str(cov[c]).toLowerCase();
      if ((v === "partial" || v === "complete") && (part.coverage || {})[c] !== "declined") { p.coverage[c] = v; touched.push(c); }
    });
    var note = str(u.note), story = str(u.session_note);
    if (!said && !note && !story) return null;
    p.narrative.session_notes = date + " - " + (story || note || "Written in from a conversation.");
    p.sessions = [{ date: date, mode: "checkin", categories: touched, note: note || "Conversation written into the profile" }];
    return p;
  }

  /* This part's update in a reply, or null. Asked for one part and handed
     one update: that is the part, whatever it was called. */
  function updateFor(reply, part, date) {
    var keys = [nameKey(part.name), nameKey(part.slug)];
    var pick = function (list, names) {
      return list.filter(function (x) {
        return names(x).some(function (n) { return keys.indexOf(nameKey(n)) >= 0; });
      })[0] || (list.length === 1 ? list[0] : null);
    };
    var json = pick(readJSON(reply), function (u) { return [str0(u.part), str0(u.name)]; });
    if (json) return fromJSON(json, part, date);
    var found = [];
    try { found = MD.extractProfiles(reply); } catch (e) { console.error(e); }
    var hit = pick(found, function (p) { return [p.name, p.slug]; });
    if (!hit) return null;
    hit.slug = part.slug;
    hit.name = part.name;
    return hit;
  }
  function str0(v) { return typeof v === "string" ? v : ""; }

  /* ---------------- writing ---------------- */

  /* Write transcript t into each of these parts, one call each, with the
     connection ai. Returns the parts written. A part the AI wrote nothing
     for - an empty reply, a declined one, or no update in it - counts a try
     (ui.js stops asking after three). A call that fails outright - offline,
     rate-limited, the day's free allowance used - throws and counts nothing,
     so it is tried again later; the parts written before it stay written. */
  async function transcript(ai, t, slugs) {
    var saved = [];
    // a mapping session was about the pair: their relationship comes first
    var pair = t.mode === "mapping"
      ? (t.parts || []).map(ST.getPart).filter(Boolean).map(function (p) { return p.name; })
      : [];
    for (var i = 0; i < slugs.length; i++) {
      var part = ST.getPart(slugs[i]);
      if (!part) continue;
      var reply = "";
      try {
        reply = await LLM.chat(ai, T.integrateSystem([part], ST.listParts()),
          [{ role: "user", text: T.integrateAsk([part.name], t.text, t.date, { pair: pair }) }], { json: true });
      } catch (e) {
        if (!e.empty) throw e;
        console.warn("nothing written into " + part.name + ": " + e.message);
      }
      var update = updateFor(reply, part, t.date);
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

  window.IFS.integrate = {
    transcript: transcript, saveMerge: saveMerge, updatedOn: updatedOn, nameKey: nameKey,
    _readJSON: readJSON, _updateFor: updateFor // for tests
  };
})();
