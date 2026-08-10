/* Inner Table - on-device persistence (localStorage).
   Everything stays local: parts, saved session transcripts, settings. */
(function () {
  "use strict";
  var S = window.IFS.schema;
  var KEY = "innertable.v1";

  var state = null;
  var listeners = [];

  /* Fires after every save() - lets sync.js push without store.js knowing
     sync exists. */
  function onChange(fn) { listeners.push(fn); }

  function defaults() {
    return {
      parts: {},        // slug -> part object
      transcripts: [],  // {id, date, mode, title, parts:[slugs], text}
      draft: null,      // in-progress session checkpoint {mode, slugs, material, messages, updated}
      table: {          // Fraser's Table: the room, built once and edited after
        built: false,
        name: "",       // what the person named the room, if they named it
        room: "",       // the room and the table, in their words
        details: "",    // what stood out on a second look
        tools: [],      // [{id, label, note}] - agreed tools in the room
        agreements: [], // ["only the part holding the stick speaks", ...]
        seats: {},      // slug -> "table" | "room" | "adjoining" | "away"
        log: []         // [{date, answers:{key:text}, note}] closing reflections
      },
      settings: {
        onboarded: false,
        theme: "auto",           // auto | dark | light
        provider: "manual",      // manual | gemini | anthropic | openai
        geminiKey: "",
        geminiModel: "gemini-2.5-flash",
        anthropicKey: "",
        anthropicModel: "claude-sonnet-5",
        openaiKey: "",
        openaiModel: "gpt-5.1",
        voiceOn: false,          // speak replies + hands-free mic in sessions
        elevenKey: "",           // optional: ElevenLabs TTS for a personal voice
        elevenVoiceId: "",
        elevenModel: "eleven_flash_v2_5",
        speechRate: 0.9,         // 0.7-1.2; spoken replies are slower than chat
        haptics: true,
        lastBackup: "",          // ISO date of last full export
        backupSnooze: "",        // ISO date the backup reminder was dismissed
        installSnooze: ""        // ISO date the add-to-home-screen nudge was dismissed
      }
    };
  }

  function adopt(parsed) {
    state = defaults();
    if (parsed.parts) state.parts = parsed.parts;
    if (parsed.transcripts) state.transcripts = parsed.transcripts;
    if (parsed.draft) state.draft = parsed.draft;
    if (parsed.table) Object.assign(state.table, parsed.table);
    if (parsed.settings) Object.assign(state.settings, parsed.settings);
  }

  function saveTable(t) {
    Object.assign(state.table, t);
    save();
    return state.table;
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) { adopt(JSON.parse(raw)); return; }
    } catch (e) { /* corrupted store: start fresh but keep old blob for rescue */
      try { localStorage.setItem(KEY + ".rescue", localStorage.getItem(KEY) || ""); } catch (e2) {}
    }
    state = defaults();
  }

  /* ---- IndexedDB mirror: a second copy of the state, restored from when
     localStorage comes up empty (cleared data, some eviction paths). ---- */
  var idb = null;
  function idbOpen() {
    return new Promise(function (res) {
      try {
        var rq = indexedDB.open("innertable", 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore("kv"); };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  function idbWrite() {
    if (!idb) return;
    try { idb.transaction("kv", "readwrite").objectStore("kv").put(JSON.stringify(state), "state"); }
    catch (e) { /* mirror is best-effort */ }
  }
  function idbRead() {
    return new Promise(function (res) {
      if (!idb) return res(null);
      try {
        var rq = idb.transaction("kv", "readonly").objectStore("kv").get("state");
        rq.onsuccess = function () { res(rq.result || null); };
        rq.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  /* Call once at boot, after load(). If local state is empty but the mirror
     has real data, restore from the mirror and invoke cb(true). */
  function initMirror(cb) {
    if (!("indexedDB" in window)) return;
    idbOpen().then(function (db) {
      idb = db;
      var empty = !Object.keys(state.parts).length && !state.transcripts.length;
      if (!empty) { idbWrite(); return; }
      idbRead().then(function (raw) {
        if (!raw) return;
        try {
          var parsed = JSON.parse(raw);
          if (parsed && parsed.parts && Object.keys(parsed.parts).length) {
            adopt(parsed);
            save();
            if (cb) cb(true);
          }
        } catch (e) {}
      });
    });
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.error("save failed", e); }
    idbWrite();
    listeners.forEach(function (fn) { fn(); });
  }

  /* ---- in-progress session checkpoint ---- */
  function setDraft(d) { state.draft = d; save(); }
  function clearDraft() { state.draft = null; save(); }

  function markBackup() {
    state.settings.lastBackup = S.todayISO();
    save();
  }

  function listParts() {
    return Object.keys(state.parts).sort().map(function (k) { return state.parts[k]; });
  }

  function getPart(slug) { return state.parts[slug] || null; }

  function upsertPart(part) {
    if (!part || !part.slug) return;
    var existing = state.parts[part.slug];
    if (existing) {
      // append-only session history: never lose previously logged sessions
      var seen = {};
      var merged = [];
      (existing.sessions || []).concat(part.sessions || []).forEach(function (s) {
        var k = s.date + "|" + s.mode + "|" + (s.note || "");
        if (!seen[k]) { seen[k] = 1; merged.push(s); }
      });
      part.sessions = merged;
    }
    state.parts[part.slug] = part;
    save();
  }

  /* Same as upsertPart, but for profiles that came back from a model or an
     import: fields it left out are kept rather than wiped. */
  function mergePart(part) {
    if (!part || !part.slug) return part;
    var merged = S.mergeParts(state.parts[part.slug], part);
    upsertPart(merged);
    return merged;
  }

  /* Fold one part into another and drop the absorbed slug. Edges elsewhere in
     the system that named the absorbed part are repointed at the survivor
     first - deletePart would otherwise throw those relationships away. */
  function absorbPart(keepSlug, absorbSlug) {
    var keep = state.parts[keepSlug], absorb = state.parts[absorbSlug];
    if (!keep || !absorb || keepSlug === absorbSlug) return null;
    var merged = S.mergeDuplicate(keep, absorb);

    Object.keys(state.parts).forEach(function (k) {
      if (k === keepSlug || k === absorbSlug) return;
      var p = state.parts[k];
      var out = [], seen = {};
      (p.relationships || []).forEach(function (r) {
        var target = r.part === absorbSlug ? keepSlug : r.part;
        if (seen[target]) return;   // both halves were linked to this part
        seen[target] = 1;
        out.push({ part: target, type: r.type, notes: r.notes || "" });
      });
      p.relationships = out;
    });

    // the survivor takes the chair if it had none of its own
    if (!state.table.seats[keepSlug] && state.table.seats[absorbSlug]) {
      state.table.seats[keepSlug] = state.table.seats[absorbSlug];
    }
    delete state.table.seats[absorbSlug];
    delete state.parts[absorbSlug];
    state.parts[keepSlug] = merged;
    save();
    return merged;
  }

  /* Move a part onto the slug its name now derives, carrying everything with
     it. deletePart must never be used for this: it strips every inbound edge
     and the part's seat, and upsertPart would overwrite whatever already sits
     on the destination. Returns null if that slug belongs to someone else -
     the caller decides (the UI offers a merge). */
  function renamePart(oldSlug, part) {
    var newSlug = S.slugify(part.name);
    if (newSlug === oldSlug) { part.slug = oldSlug; upsertPart(part); return part; }
    if (state.parts[newSlug]) return null;
    part.slug = newSlug;
    Object.keys(state.parts).forEach(function (k) {
      if (k === oldSlug) return;
      (state.parts[k].relationships || []).forEach(function (r) {
        if (r.part === oldSlug) r.part = newSlug;   // inbound edges follow it
      });
    });
    if (state.table.seats[oldSlug]) {              // and so does its chair
      state.table.seats[newSlug] = state.table.seats[oldSlug];
      delete state.table.seats[oldSlug];
    }
    delete state.parts[oldSlug];
    state.parts[newSlug] = part;
    save();
    return part;
  }

  function deletePart(slug) {
    delete state.parts[slug];
    // drop dangling edges pointing at the deleted part
    Object.keys(state.parts).forEach(function (k) {
      var p = state.parts[k];
      p.relationships = (p.relationships || []).filter(function (r) { return r.part !== slug; });
    });
    delete state.table.seats[slug]; // and its chair at the table
    save();
  }

  function addTranscript(t) {
    t.id = "t" + Math.random().toString(36).slice(2, 10);
    state.transcripts.unshift(t);
    if (state.transcripts.length > 200) state.transcripts.length = 200;
    save();
    return t.id;
  }

  function deleteTranscript(id) {
    state.transcripts = state.transcripts.filter(function (t) { return t.id !== id; });
    save();
  }

  function exportAll() {
    return JSON.stringify({
      app: "inner-table",
      version: 1,
      exported: new Date().toISOString(),
      parts: state.parts,
      transcripts: state.transcripts,
      table: state.table
    }, null, 2);
  }

  function importAll(json) {
    var data = JSON.parse(json);
    if (!data || typeof data !== "object" || !data.parts) throw new Error("Not an Inner Table backup file.");
    var count = 0;
    Object.keys(data.parts).forEach(function (k) {
      var p = data.parts[k];
      var clean = S.normalizePart(p);   // a hand-edited file must not brick the app
      if (clean) { mergePart(clean); count++; }
    });
    if (data.table && typeof data.table === "object") {
      var d = data.table, tb = {};
      ["name", "room", "details"].forEach(function (k) { if (typeof d[k] === "string") tb[k] = d[k]; });
      if (Array.isArray(d.tools)) tb.tools = d.tools.filter(function (x) { return x && typeof x.label === "string"; });
      if (Array.isArray(d.agreements)) tb.agreements = d.agreements.filter(function (x) { return typeof x === "string"; });
      if (d.seats && typeof d.seats === "object" && !Array.isArray(d.seats)) tb.seats = d.seats;
      if (Array.isArray(d.log)) tb.log = d.log.filter(function (x) { return x && x.date; });
      // built only counts if there is actually a room, or buildTable can loop
      tb.built = !!(tb.room || state.table.room);
      Object.assign(state.table, tb);
    }
    if (Array.isArray(data.transcripts)) {
      var have = {};
      state.transcripts.forEach(function (t) { have[t.id] = 1; });
      data.transcripts.forEach(function (t) { if (t && t.id && !have[t.id]) state.transcripts.push(t); });
      state.transcripts.sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
    }
    save();
    return count;
  }

  function wipe() {
    state = defaults();
    state.settings.onboarded = true;
    save();
  }

  var SAMPLE_CRITIC = [
    "---",
    'name: The Critic',
    "type: manager",
    'age: "about 40, older than my actual age"',
    "location: behind the eyes, slightly above",
    "appearance: a thin figure in a gray suit holding a red pen",
    "origin: showed up around age 9, after a spelling bee humiliation",
    "emotions:",
    "  - vigilance",
    "  - contempt (worn as armor)",
    "  - exhaustion (admitted reluctantly)",
    "fears:",
    "  - if I stop, the person becomes lazy and everyone finally sees it",
    "  - public humiliation",
    "  - being blamed when things fail",
    "hopes_goals:",
    "  - the person taken seriously by serious people",
    "  - work no one can find fault with",
    "behaviors:",
    "  - reads drafts aloud in a mocking tone before anyone else can",
    "  - compares the person to peers at 2am",
    "  - blocks publishing until things are \"ready\" (they are never ready)",
    "wants_needs:",
    "  - acknowledgment that its standards built the person's career",
    "  - to not be the only one guarding quality",
    "positive_intent: keep the person safe from public shame by finding every flaw first",
    "unburdened_vision: an editor, not a censor - sharpening work it believes in",
    "trust_in_self: low",
    "relationships:",
    "  - part: the-dreamer",
    "    type: polarized-with",
    "    notes: every big idea it floats, I have to sink before it embarrasses us",
    "coverage:",
    "  introduction: complete",
    "  history_origin: partial",
    "  emotions_feelings: partial",
    "  beliefs_motivations: partial",
    "  relationships: partial",
    "  communication_needs: untouched",
    "  positive_intent: complete",
    "  changes_healing: partial",
    "  integration_harmony: declined",
    "sessions:",
    "  - date: 2026-06-14",
    "    mode: intake",
    "    categories: [introduction, positive_intent, emotions_feelings]",
    "    note: first contact; suspicious but talkative",
    "  - date: 2026-06-21",
    "    mode: checkin",
    "    categories: [history_origin, changes_healing]",
    "    note: named the spelling bee; declined integration questions",
    "---",
    "",
    "# The Critic",
    "",
    "## In its own words",
    "",
    '"Someone has to hold the line. You think the world grades on effort? I grade first so the world grades kinder."',
    "",
    '"I am not cruel. I am early."',
    "",
    "## Origin story",
    "",
    "Appeared around age 9 after a public spelling failure. Decided no one would ever laugh like that again, and the way to guarantee it was to find every error first.",
    "",
    "## What activates it",
    "",
    "Publishing anything. Deadlines. Praise (suspicious of it). Other people's sloppy work being rewarded.",
    "",
    "## How it relates to other parts",
    "",
    "Locked in a long standoff with The Dreamer - each escalates because the other exists.",
    "",
    "## What it needs",
    "",
    "To be thanked for four decades of vigilance. Evidence that quality survives without punishment.",
    "",
    "## Session notes",
    "",
    "2026-06-21 - Willing to say the spelling bee out loud. Firmly closed the door on integration talk; respected.",
    "",
    "2026-06-14 - Chose its own name immediately. Wants credit before change.",
    ""
  ].join("\n");

  /* A new account opens onto an empty app, which is a hard place to begin.
     These three are the textbook IFS triangle: a critical manager and a
     reactive firefighter standing in front of the same exile, polarized with
     each other because each one's method undoes the other's. They are
     labelled examples on purpose - the point is to show what a mapped system
     looks like, not to tell anyone what is inside them. */
  var STARTERS = [
    {
      name: "The Perfectionist",
      type: "manager",
      age: "older than the person - it arrived early and never left",
      location: "behind the eyes, reading over their shoulder",
      origin: "showed up the first time being wrong happened in front of other people",
      emotions: ["vigilance", "contempt worn as armour", "a tiredness it will not admit to"],
      fears: ["that if it eases off, the shame underneath becomes visible to everyone"],
      hopes_goals: ["work nobody can fault", "the person taken seriously"],
      behaviors: ["rehearses conversations in advance", "finds the flaw before anyone else can"],
      wants_needs: ["acknowledgement that its standards have kept the person safe"],
      positive_intent: "keep the person from ever being humiliated again by getting there first",
      unburdened_vision: "an editor rather than a censor - sharpening work it believes in",
      trust_in_self: "low",
      relationships: [
        { part: "the-ashamed-one", type: "protects",
          notes: "I keep the standard high so nobody ever gets close enough to see it." },
        { part: "the-numbing-one", type: "polarized-with",
          notes: "Every time it checks out, I work twice as hard to cover for us - and the harder I push, the sooner it reaches for something." }
      ]
    },
    {
      name: "The Ashamed One",
      type: "exile",
      age: "young - somewhere around seven or eight",
      location: "low in the chest, curled small",
      origin: "the moment being wrong turned into being bad, with people watching",
      emotions: ["shame", "loneliness", "a wish to disappear"],
      fears: ["being seen exactly as it is and being left anyway"],
      hopes_goals: ["to be told it was never the unforgivable thing it believes it is"],
      behaviors: ["goes quiet", "makes itself smaller when attention arrives"],
      wants_needs: ["someone to stay after seeing it"],
      positive_intent: "hold the hurt so the rest of the system can keep functioning",
      unburdened_vision: "a child who can be looked at without flinching",
      trust_in_self: "none",
      relationships: [
        { part: "the-perfectionist", type: "protected-by",
          notes: "It never lets anyone get near enough to find me." },
        { part: "the-numbing-one", type: "protected-by",
          notes: "When it gets loud in here, that one makes it stop." }
      ]
    },
    {
      name: "The Numbing One",
      type: "firefighter",
      age: "arrived in adolescence, when the pressure first outran the coping",
      location: "hands and throat - the reach for something",
      origin: "the first time something took the feeling away and it worked",
      emotions: ["urgency", "relief", "the flatness afterwards"],
      fears: ["that without it the shame would simply not stop"],
      hopes_goals: ["a few hours where none of it can reach the person"],
      behaviors: ["reaches for a substance when the shame lands", "acts fast, argues later"],
      wants_needs: ["another way to stop the pain that works as quickly as this one does"],
      positive_intent: "put the fire out immediately, whatever it costs later",
      unburdened_vision: "rest that does not have to be bought",
      trust_in_self: "none",
      relationships: [
        { part: "the-ashamed-one", type: "protects",
          notes: "When the shame lands I put it out fast, with whatever is nearest." },
        { part: "the-perfectionist", type: "polarized-with",
          notes: "It never stops pushing. Somebody has to give us a way out, and it is never going to be them." }
      ]
    }
  ];

  function starterPart(spec) {
    var p = S.blankPart(spec.name);
    Object.keys(spec).forEach(function (k) { p[k] = spec[k]; });
    p.slug = S.slugify(spec.name);
    // an intro, an intent and a mapped relationship - deliberately short of
    // the compile-readiness bar, because the real work is still the person's
    ["introduction", "positive_intent", "relationships"].forEach(function (c) {
      p.coverage[c] = "partial";
    });
    p.narrative.session_notes = S.todayISO() +
      " - Example starter part, not from a session. Rename it, rewrite it, or " +
      "delete it. The parts that matter are the ones you meet yourself.";
    return p;
  }

  /* Only ever writes into an empty store: someone who used the app on this
     device before signing up must not find three strangers among their parts. */
  function seedStarters() {
    if (Object.keys(state.parts).length) return 0;
    STARTERS.forEach(function (spec) {
      var p = starterPart(spec);
      state.parts[p.slug] = p;
    });
    save();
    return STARTERS.length;
  }

  window.IFS.store = {
    load: load,
    save: save,
    onChange: onChange,
    seedStarters: seedStarters,
    initMirror: initMirror,
    saveTable: saveTable,
    renamePart: renamePart,
    setDraft: setDraft,
    clearDraft: clearDraft,
    markBackup: markBackup,
    get state() { return state; },
    listParts: listParts,
    getPart: getPart,
    upsertPart: upsertPart,
    mergePart: mergePart,
    absorbPart: absorbPart,
    deletePart: deletePart,
    addTranscript: addTranscript,
    deleteTranscript: deleteTranscript,
    exportAll: exportAll,
    importAll: importAll,
    wipe: wipe,
    SAMPLE_CRITIC: SAMPLE_CRITIC
  };
})();
