/* Inner Table - on-device persistence (localStorage).
   Everything stays local: parts, saved session transcripts, settings. */
(function () {
  "use strict";
  var S = window.IFS.schema;
  /* The device store: where every install kept its data before accounts
     existed, and where a signed-out person's parts once lived. Parts now live
     exclusively under an account's own key - the app requires sign-in and no
     longer writes parts here. What remains is a pre-sign-in holding area:
     onboarding chrome, and any parts left behind by that older signed-out use,
     offered once to the first account to sign in (see claimDeviceStore) and
     then cleared. */
  var KEY = "innertable.v1";
  /* Who, if anyone, has already taken the device store into their account.
     A device store that has been claimed is never offered to a second
     account - that offer is exactly how one person's parts reached another's
     library. */
  var CLAIM_KEY = "innertable.v1.claimedBy";

  /* Signed in, a person's parts live under their own key and nowhere else.
     One global key was the whole bug: sign-out deliberately leaves the data
     on the device, so the next account to sign in merged whatever the last
     one left behind and pushed the union up under its own name. */
  function keyFor(owner) { return owner ? KEY + ".u." + owner : KEY; }
  function idbKeyFor(owner) { return owner ? "state:u:" + owner : "state"; }

  var state = null;
  var owner = null;          // null = the device store, else a username
  var listeners = [];

  /* Fires after every save() - lets sync.js push without store.js knowing
     sync exists. */
  function onChange(fn) { listeners.push(fn); }

  function defaults() {
    return {
      parts: {},        // slug -> part object
      /* Deletions, remembered. Sync merges rather than replaces, so a part
         simply missing from an incoming blob means nothing - the other device
         may just not have it yet. Without a record that a deletion happened,
         every other signed-in device pushed the part straight back and the
         delete undid itself. A tombstone is that record, and it travels. */
      deleted: { parts: {}, transcripts: {} },  // slug/id -> ISO time of deletion
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
        log: [],        // [{date, answers:{key:text}, note}] closing reflections
        meetings: []    // [{id, date, topic, parts:[slugs], voices:[{name,line}], synthesis, transcript}]
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
        /* Voice is the point of a session: the answer to an IFS question
           arrives spoken, in the pause, long before anyone would type it.
           On where it is supported; the toggle is one tap away in-session. */
        voiceOn: true,           // speak replies + hands-free mic in sessions
        elevenKey: "",           // optional: ElevenLabs TTS for a personal voice
        elevenVoiceId: "",
        elevenModel: "eleven_flash_v2_5",
        speechRate: 0.9,         // 0.7-1.2; spoken replies are slower than chat
        haptics: true,
        lastBackup: "",          // ISO date of last full export
        backupSnooze: "",        // ISO date the backup reminder was dismissed
        installSnooze: "",       // ISO date the add-to-home-screen nudge was dismissed
        /* First-run teaching. Only ever switched on by a fresh onboarding or a
           signup, so someone who has been using the app for months does not
           suddenly get taught what a part is. `taught` records which cues have
           already fired; each one shows once and never again. */
        coachOn: false,
        taught: {},
        firstRun: "",            // ISO date the first run began; it lasts that day
        lastOpen: "",            // ISO date of the previous app open
        ritualDay: ""            // ISO date the daily check-in was answered or dismissed
      }
    };
  }

  function adopt(parsed) {
    state = defaults();
    if (parsed.parts) state.parts = parsed.parts;
    if (parsed.deleted && typeof parsed.deleted === "object") {
      if (parsed.deleted.parts) state.deleted.parts = parsed.deleted.parts;
      if (parsed.deleted.transcripts) state.deleted.transcripts = parsed.deleted.transcripts;
    }
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

  /* load(null) opens the device store; load("john") opens john's. Nothing is
     inherited across the boundary - an account with no store yet starts
     empty, and only an explicit claimDeviceStore() can change that. */
  function load(who) {
    owner = who || null;
    var key = keyFor(owner);
    try {
      var raw = localStorage.getItem(key);
      if (raw) { adopt(JSON.parse(raw)); return; }
    } catch (e) { /* corrupted store: start fresh but keep old blob for rescue */
      try { localStorage.setItem(key + ".rescue", localStorage.getItem(key) || ""); } catch (e2) {}
    }
    state = defaults();
    if (owner) inheritDeviceChrome();
  }

  /* An account opening for the first time on a device takes that device's
     look and feel with it - otherwise everyone who was already signed in gets
     walked through onboarding again by an update. Only chrome crosses: no
     parts, no transcripts, and no API keys, which are credentials and belong
     to whoever typed them in. */
  function inheritDeviceChrome() {
    var dev = null;
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) dev = JSON.parse(raw);
    } catch (e) { return; }
    if (!dev || !dev.settings) return;
    ["onboarded", "theme", "haptics", "voiceOn", "speechRate"].forEach(function (k) {
      if (dev.settings[k] !== undefined) state.settings[k] = dev.settings[k];
    });
  }

  /* Signing in or out swaps which store is open. It never carries state
     across: the outgoing owner's data is already saved under its own key,
     and the incoming one is read from its own. */
  function switchOwner(who) {
    if ((who || null) === owner) return false;
    load(who);
    idbSwitch();
    listeners.forEach(function (fn) { fn(); });
    return true;
  }

  function currentOwner() { return owner; }

  /* What is sitting in the device store, and whether anyone has taken it.
     The sign-in flow uses this to decide whether it may offer those parts to
     the account signing in. */
  function deviceStore() {
    var claimedBy = null;
    try { claimedBy = localStorage.getItem(CLAIM_KEY) || null; } catch (e) {}
    var parts = 0;
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var d = JSON.parse(raw);
        if (d && d.parts) parts = Object.keys(d.parts).length;
      }
    } catch (e) {}
    return { parts: parts, claimedBy: claimedBy };
  }

  /* Take the device store into the account that is open now - the person
     saying "yes, those are mine". The device store is emptied and marked
     claimed, so the same parts are never offered to anyone else. */
  function claimDeviceStore() {
    if (!owner) return 0;
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { return 0; }
    if (!raw) return 0;
    var n = 0;
    try {
      n = importAll(raw);
      // they just said this device's library is theirs, so their own settings
      // - provider keys included - come across with it
      var dev = JSON.parse(raw);
      if (dev && dev.settings) { Object.assign(state.settings, dev.settings); save(); }
    } catch (e) { return 0; }
    try {
      localStorage.removeItem(KEY);
      localStorage.setItem(CLAIM_KEY, owner);
    } catch (e) {}
    return n;
  }

  /* "Not mine" - the device store keeps its parts for signed-out use, but is
     marked resolved so no account is ever offered them again. Declining is
     recorded for the same reason accepting is: the offer must happen once. */
  function leaveDeviceStore() {
    if (!owner) return;
    try { localStorage.setItem(CLAIM_KEY, owner); } catch (e) {}
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
  /* The mirror is keyed by owner too. A single "state" record would undo the
     whole separation: it restores whenever the open store looks empty, so a
     fresh account on a shared device would be handed the last person's parts
     by the backup rather than by sync. */
  function idbWrite() {
    if (!idb) return;
    try { idb.transaction("kv", "readwrite").objectStore("kv").put(JSON.stringify(state), idbKeyFor(owner)); }
    catch (e) { /* mirror is best-effort */ }
  }
  function idbRead(who) {
    return new Promise(function (res) {
      if (!idb) return res(null);
      try {
        var rq = idb.transaction("kv", "readonly").objectStore("kv").get(idbKeyFor(who));
        rq.onsuccess = function () { res(rq.result || null); };
        rq.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }

  /* Mirror the open store, or restore it if it is empty and the mirror for
     this same owner has something. cb(true) when a restore actually landed. */
  function mirrorSync(cb) {
    if (!idb) return;
    var who = owner;
    var empty = !Object.keys(state.parts).length && !state.transcripts.length;
    if (!empty) { idbWrite(); return; }
    idbRead(who).then(function (raw) {
      if (!raw || who !== owner) return;   // owner changed while we were reading
      try {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.parts && Object.keys(parsed.parts).length) {
          adopt(parsed);
          save();
          if (cb) cb(true);
        }
      } catch (e) {}
    });
  }

  function idbSwitch() { mirrorSync(null); }

  /* Call once at boot, after load(). If local state is empty but the mirror
     has real data, restore from the mirror and invoke cb(true). */
  function initMirror(cb) {
    if (!("indexedDB" in window)) return;
    idbOpen().then(function (db) {
      idb = db;
      mirrorSync(cb);
    });
  }

  function save() {
    try { localStorage.setItem(keyFor(owner), JSON.stringify(state)); }
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

  var nowISO = function () { return new Date().toISOString(); };

  /* keepStamp is for the sync merge, which must not restamp a part just for
     travelling: the merged part keeps the time it was really last written, so
     a tombstone made after that still wins. Every other caller is an actual
     edit and gets stamped now, which is also what lets a deliberate
     re-creation beat an older deletion. */
  function upsertPart(part, keepStamp) {
    if (!part || !part.slug) return;
    var stone = state.deleted.parts[part.slug];
    if (!keepStamp) {
      /* Writing a part is the opposite of deleting it, so this write has to
         read as later than the deletion it overrides. Wall clocks have
         millisecond resolution and two devices do not share one, so "later"
         cannot be left to chance: if the stamp would tie with the tombstone,
         step past it. Otherwise a part deliberately met again could be buried
         by the ghost of the one deleted moments before. */
      var stamp = nowISO();
      if (stone && stamp <= stone) stamp = new Date(Date.parse(stone) + 1).toISOString();
      part.updated = stamp;
    }
    delete state.deleted.parts[part.slug];
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
  function mergePart(part, keepStamp) {
    if (!part || !part.slug) return part;
    var merged = S.mergeParts(state.parts[part.slug], part);
    upsertPart(merged, keepStamp);
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
    state.deleted.parts[slug] = nowISO();   // so every other device honours it
    // drop dangling edges pointing at the deleted part
    Object.keys(state.parts).forEach(function (k) {
      var p = state.parts[k];
      p.relationships = (p.relationships || []).filter(function (r) { return r.part !== slug; });
    });
    delete state.table.seats[slug]; // and its chair at the table
    save();
  }

  /* A meeting leaves a card behind on the Table tab. Capped like transcripts:
     the room keeps its history, but not without limit. */
  function addMeeting(m) {
    m.id = "m" + Math.random().toString(36).slice(2, 10);
    state.table.meetings.push(m);
    if (state.table.meetings.length > 60) state.table.meetings = state.table.meetings.slice(-60);
    save();
    return m.id;
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
    state.deleted.transcripts[id] = nowISO();
    save();
  }

  function exportAll() {
    return JSON.stringify({
      app: "inner-table",
      version: 1,
      exported: new Date().toISOString(),
      parts: state.parts,
      deleted: state.deleted,
      transcripts: state.transcripts,
      table: state.table
    }, null, 2);
  }

  /* Keep the later of two ISO stamps, "" meaning "no idea, treat as ancient". */
  function laterOf(a, b) { return (a || "") > (b || "") ? (a || "") : (b || ""); }

  /* A tombstone stops mattering long after every device has seen it. A year is
     far past any plausible offline gap and keeps the record from growing
     without limit. */
  var TOMBSTONE_TTL_MS = 365 * 24 * 60 * 60 * 1000;
  function pruneTombstones() {
    var cutoff = new Date(Date.now() - TOMBSTONE_TTL_MS).toISOString();
    ["parts", "transcripts"].forEach(function (kind) {
      var m = state.deleted[kind];
      Object.keys(m).forEach(function (k) { if (m[k] < cutoff) delete m[k]; });
    });
  }

  /* importAll(json)              - a person restoring their own backup file.
     importAll(json, {sync:true}) - a pull from the server.

     The difference is what a deletion means. Restoring a backup is someone
     asking for what is in that file, so the file wins and the tombstone for
     anything in it is lifted. A sync pull is another device's copy of the same
     account, which may simply not have heard about a deletion yet - so there,
     tombstones are honoured, and a part comes back only if it was genuinely
     written again *after* it was deleted. */
  function importAll(json, opts) {
    var data = JSON.parse(json);
    if (!data || typeof data !== "object" || !data.parts) throw new Error("Not an Inner Table backup file.");
    var viaSync = !!(opts && opts.sync);
    var count = 0;

    /* Deletions first, from both sides, so everything below already knows what
       has been deleted. After the merge would be too late: the part would be
       re-added, and the merge's own bookkeeping would make it look newer than
       the tombstone that should bury it. */
    if (viaSync && data.deleted && typeof data.deleted === "object") {
      ["parts", "transcripts"].forEach(function (kind) {
        var incoming = data.deleted[kind];
        if (!incoming || typeof incoming !== "object") return;
        Object.keys(incoming).forEach(function (k) {
          if (typeof incoming[k] !== "string") return;
          state.deleted[kind][k] = laterOf(state.deleted[kind][k], incoming[k]);
        });
      });
      // a deletion made elsewhere that this device had not heard about
      Object.keys(state.deleted.parts).forEach(function (slug) {
        var local = state.parts[slug];
        if (local && laterOf(local.updated, "") <= state.deleted.parts[slug]) delete state.parts[slug];
      });
      state.transcripts = state.transcripts.filter(function (t) {
        return !state.deleted.transcripts[t.id];
      });
    }

    Object.keys(data.parts).forEach(function (k) {
      var p = data.parts[k];
      var clean = S.normalizePart(p);   // a hand-edited file must not brick the app
      if (!clean) return;
      if (viaSync) {
        var stone = state.deleted.parts[clean.slug];
        // deleted, and not written again since: it stays deleted
        if (stone && laterOf(clean.updated, "") <= stone) return;
        mergePart(clean, true);         // travelling is not an edit, so no restamp
      } else {
        mergePart(clean);               // a restore is an explicit re-add
      }
      count++;
    });
    if (data.table && typeof data.table === "object") {
      var d = data.table, tb = {};
      ["name", "room", "details"].forEach(function (k) { if (typeof d[k] === "string") tb[k] = d[k]; });
      if (Array.isArray(d.tools)) tb.tools = d.tools.filter(function (x) { return x && typeof x.label === "string"; });
      if (Array.isArray(d.agreements)) tb.agreements = d.agreements.filter(function (x) { return typeof x === "string"; });
      if (d.seats && typeof d.seats === "object" && !Array.isArray(d.seats)) tb.seats = d.seats;
      if (Array.isArray(d.log)) tb.log = d.log.filter(function (x) { return x && x.date; });
      if (Array.isArray(d.meetings)) {
        // meetings are history, so a restore adds to what is here rather than
        // replacing it - same rule the transcripts below follow
        var haveM = {};
        state.table.meetings.forEach(function (m) { haveM[m.id] = 1; });
        d.meetings.forEach(function (m) {
          if (m && m.id && m.date && !haveM[m.id]) { haveM[m.id] = 1; state.table.meetings.push(m); }
        });
        state.table.meetings.sort(function (x, y) { return String(x.date).localeCompare(String(y.date)); });
        tb.meetings = state.table.meetings;
      }
      // built only counts if there is actually a room, or buildTable can loop
      tb.built = !!(tb.room || state.table.room);
      Object.assign(state.table, tb);
    }
    if (Array.isArray(data.transcripts)) {
      var have = {};
      state.transcripts.forEach(function (t) { have[t.id] = 1; });
      data.transcripts.forEach(function (t) {
        if (!t || !t.id || have[t.id]) return;
        if (viaSync && state.deleted.transcripts[t.id]) return;   // deleted on another device
        if (!viaSync) delete state.deleted.transcripts[t.id];     // a restore asks for it back
        state.transcripts.push(t);
      });
      state.transcripts.sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
    }
    pruneTombstones();
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
    switchOwner: switchOwner,
    owner: currentOwner,
    deviceStore: deviceStore,
    claimDeviceStore: claimDeviceStore,
    leaveDeviceStore: leaveDeviceStore,
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
    addMeeting: addMeeting,
    deleteTranscript: deleteTranscript,
    exportAll: exportAll,
    importAll: importAll,
    wipe: wipe,
    SAMPLE_CRITIC: SAMPLE_CRITIC
  };
})();
