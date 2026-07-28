/* Inner Table - schema constants and helpers.
   Mirrors schema/part-schema.md in the ifs-agents repo. */
(function () {
  "use strict";

  var CATEGORIES = [
    "introduction",
    "history_origin",
    "emotions_feelings",
    "beliefs_motivations",
    "relationships",
    "communication_needs",
    "positive_intent",
    "changes_healing",
    "integration_harmony"
  ];

  var CATEGORY_LABELS = {
    introduction: "Introduction",
    history_origin: "History & origin",
    emotions_feelings: "Emotions & feelings",
    beliefs_motivations: "Beliefs & motivations",
    relationships: "Relationships",
    communication_needs: "Communication & needs",
    positive_intent: "Positive intent",
    changes_healing: "Changes & healing",
    integration_harmony: "Integration & harmony"
  };

  var COVERAGE_STATUSES = ["untouched", "partial", "complete", "declined"];
  var PART_TYPES = ["manager", "firefighter", "exile", "unknown"];
  var TRUST_LEVELS = ["unknown", "none", "low", "growing", "high"];
  var EDGE_TYPES = ["protects", "protected-by", "polarized-with", "allied-with", "conflicts-with"];
  var EDGE_MIRROR = {
    "protects": "protected-by",
    "protected-by": "protects",
    "polarized-with": "polarized-with",
    "allied-with": "allied-with",
    "conflicts-with": "conflicts-with"
  };

  var NARRATIVE_SECTIONS = [
    { key: "in_its_own_words", title: "In its own words" },
    { key: "origin_story", title: "Origin story" },
    { key: "what_activates_it", title: "What activates it" },
    { key: "relates_to_others", title: "How it relates to other parts" },
    { key: "what_it_needs", title: "What it needs" },
    { key: "session_notes", title: "Session notes" }
  ];

  function slugify(name) {
    return String(name || "").toLowerCase().trim()
      .replace(/['".,!?()]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unnamed-part";
  }

  function blankPart(name) {
    var coverage = {};
    CATEGORIES.forEach(function (c) { coverage[c] = "untouched"; });
    return {
      slug: slugify(name || ""),
      name: name || "",
      type: "unknown",
      age: "",
      location: "",
      appearance: "",
      origin: "",
      emotions: [],
      fears: [],
      hopes_goals: [],
      behaviors: [],
      wants_needs: [],
      positive_intent: "",
      unburdened_vision: "",
      trust_in_self: "unknown",
      relationships: [],
      coverage: coverage,
      sessions: [],
      narrative: {
        in_its_own_words: "",
        origin_story: "",
        what_activates_it: "",
        relates_to_others: "",
        what_it_needs: "",
        session_notes: ""
      }
    };
  }

  /* Compile-readiness bar, verbatim from the schema:
     name set, positive_intent non-empty, introduction partial/complete,
     positive_intent category partial/complete, plus 2 more categories touched. */
  function readiness(part) {
    var touched = function (c) {
      return part.coverage[c] === "partial" || part.coverage[c] === "complete";
    };
    var missing = [];
    if (!part.name) missing.push("a name");
    if (!part.positive_intent) missing.push("a positive intent");
    if (!touched("introduction")) missing.push("the introduction category");
    if (!touched("positive_intent")) missing.push("the positive-intent category");
    var others = CATEGORIES.filter(function (c) {
      return c !== "introduction" && c !== "positive_intent" && touched(c);
    });
    if (others.length < 2) missing.push((2 - others.length) + " more explored categor" + (others.length === 1 ? "y" : "ies"));
    return { ready: missing.length === 0, missing: missing };
  }

  /* 0..1 development score for the coverage ring */
  function coverageScore(part) {
    var pts = 0, denom = 0;
    CATEGORIES.forEach(function (c) {
      var s = part.coverage[c];
      if (s === "declined") return; // declined topics don't count against the part
      denom += 2;
      if (s === "partial") pts += 1;
      if (s === "complete") pts += 2;
    });
    return denom ? pts / denom : 0;
  }

  /* Merge an incoming profile (from an LLM or an import) onto a stored one.
     An omitted field means "the model didn't mention it", never "delete it" -
     so empties never overwrite, lists union, and coverage only ever climbs.
     Direct edits in the app bypass this and write straight through. */
  var COV_RANK = { untouched: 0, partial: 1, complete: 2 };

  function unionList(a, b) {
    var out = (a || []).slice();
    var seen = {};
    out.forEach(function (x) { seen[String(x).toLowerCase().trim()] = 1; });
    (b || []).forEach(function (x) {
      var k = String(x).toLowerCase().trim();
      if (k && !seen[k]) { seen[k] = 1; out.push(x); }
    });
    return out;
  }

  function mergeParts(base, incoming) {
    if (!base) return incoming;
    var out = JSON.parse(JSON.stringify(incoming));

    ["name", "age", "location", "appearance", "origin", "positive_intent", "unburdened_vision"]
      .forEach(function (k) { if (!out[k]) out[k] = base[k]; });
    if (out.type === "unknown") out.type = base.type;
    if (out.trust_in_self === "unknown") out.trust_in_self = base.trust_in_self;

    ["emotions", "fears", "hopes_goals", "behaviors", "wants_needs"]
      .forEach(function (k) { out[k] = unionList(base[k], out[k]); });

    CATEGORIES.forEach(function (c) {
      var b = base.coverage[c], i = out.coverage[c];
      if (b === "declined" && i !== "complete") out.coverage[c] = "declined";
      else if (COV_RANK[i] < COV_RANK[b]) out.coverage[c] = b;
    });

    // edges: keep every mapped relationship, incoming wins where both name one
    var edges = (out.relationships || []).slice();
    var have = {};
    edges.forEach(function (r) { have[r.part] = 1; });
    (base.relationships || []).forEach(function (r) { if (!have[r.part]) edges.push(r); });
    out.relationships = edges;

    NARRATIVE_SECTIONS.forEach(function (sec) {
      if (!out.narrative[sec.key]) out.narrative[sec.key] = base.narrative[sec.key] || "";
    });
    return out;
  }

  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  window.IFS = window.IFS || {};
  window.IFS.schema = {
    CATEGORIES: CATEGORIES,
    CATEGORY_LABELS: CATEGORY_LABELS,
    COVERAGE_STATUSES: COVERAGE_STATUSES,
    PART_TYPES: PART_TYPES,
    TRUST_LEVELS: TRUST_LEVELS,
    EDGE_TYPES: EDGE_TYPES,
    EDGE_MIRROR: EDGE_MIRROR,
    NARRATIVE_SECTIONS: NARRATIVE_SECTIONS,
    slugify: slugify,
    blankPart: blankPart,
    readiness: readiness,
    coverageScore: coverageScore,
    mergeParts: mergeParts,
    todayISO: todayISO
  };
})();
