/* Inner Table - on-device persistence (localStorage).
   Everything stays local: parts, saved session transcripts, settings. */
(function () {
  "use strict";
  var S = window.IFS.schema;
  var KEY = "innertable.v1";

  var state = null;

  function defaults() {
    return {
      parts: {},        // slug -> part object
      transcripts: [],  // {id, date, mode, title, parts:[slugs], text}
      settings: {
        onboarded: false,
        theme: "auto",           // auto | dark | light
        provider: "manual",      // manual | gemini | anthropic
        geminiKey: "",
        geminiModel: "gemini-2.5-flash",
        anthropicKey: "",
        anthropicModel: "claude-sonnet-5",
        haptics: true
      }
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        state = defaults();
        if (parsed.parts) state.parts = parsed.parts;
        if (parsed.transcripts) state.transcripts = parsed.transcripts;
        if (parsed.settings) Object.assign(state.settings, parsed.settings);
        return;
      }
    } catch (e) { /* corrupted store: start fresh but keep old blob for rescue */
      try { localStorage.setItem(KEY + ".rescue", localStorage.getItem(KEY) || ""); } catch (e2) {}
    }
    state = defaults();
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.error("save failed", e); }
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

  function deletePart(slug) {
    delete state.parts[slug];
    // drop dangling edges pointing at the deleted part
    Object.keys(state.parts).forEach(function (k) {
      var p = state.parts[k];
      p.relationships = (p.relationships || []).filter(function (r) { return r.part !== slug; });
    });
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
      transcripts: state.transcripts
    }, null, 2);
  }

  function importAll(json) {
    var data = JSON.parse(json);
    if (!data || typeof data !== "object" || !data.parts) throw new Error("Not an Inner Table backup file.");
    var count = 0;
    Object.keys(data.parts).forEach(function (k) {
      var p = data.parts[k];
      if (p && p.slug && p.name) { upsertPart(p); count++; }
    });
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

  window.IFS.store = {
    load: load,
    save: save,
    get state() { return state; },
    listParts: listParts,
    getPart: getPart,
    upsertPart: upsertPart,
    deletePart: deletePart,
    addTranscript: addTranscript,
    deleteTranscript: deleteTranscript,
    exportAll: exportAll,
    importAll: importAll,
    wipe: wipe,
    SAMPLE_CRITIC: SAMPLE_CRITIC
  };
})();
