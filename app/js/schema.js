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

  /* The five schema edge types read as three tones on the map and in the
     relationship sheet. The schema stays the source of truth - this is only
     how they are grouped for a person choosing between them. */
  var EDGE_TONE = {
    "protects": "positive",
    "protected-by": "positive",
    "allied-with": "positive",
    "polarized-with": "negative",
    "conflicts-with": "negative"
  };
  var TONE_LABELS = { positive: "Supportive", negative: "In tension", unknown: "Not mapped yet" };

  var NARRATIVE_SECTIONS = [
    { key: "in_its_own_words", title: "In its own words" },
    { key: "origin_story", title: "Origin story" },
    { key: "what_activates_it", title: "What activates it" },
    { key: "relates_to_others", title: "How it relates to other parts" },
    { key: "what_it_needs", title: "What it needs" },
    { key: "session_notes", title: "Session notes" }
  ];

  /* The letter shown in a part's circle. Skips a leading article and any
     punctuation, so "The Final Boss" is F rather than yet another T. */
  function initial(name) {
    var s = String(name || "").replace(/^\s*(the|a|an)\s+/i, "").replace(/[^A-Za-z0-9]/g, "");
    return (s.charAt(0) || "?").toUpperCase();
  }

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

  /* How developed a part has to be before it can take a seat and speak.
     The bar used to be a checklist of coverage flags running alongside the
     development % without ever meeting it, so a part could read 80% and stay
     barred, or clear the bar reading 17%. One measure now: the light comes on
     when a part has a name, an intent to act from, and enough of itself
     written down for its answers to be its own rather than the model's. */
  var READY_AT = 0.5;

  function readiness(part) {
    var missing = [];
    if (!part.name) missing.push("a name");
    if (!part.positive_intent) missing.push("a positive intent");
    var score = coverageScore(part);   // hoisted; defined below
    if (score < READY_AT) {
      missing.push("more of itself written down - " + Math.round(score * 100) +
        "% of the " + Math.round(READY_AT * 100) + "% it takes to join the table");
    }
    return { ready: missing.length === 0, missing: missing, score: score };
  }

  /* Which fields actually carry a category's content. The coverage flag says
     a topic was explored; this says something was written down. A profile
     imported as markdown, or typed in by hand, arrives full of content with
     every flag still untouched - so a number built on flags alone floats
     free of the part it describes. */
  var EVIDENCE = {
    introduction: { need: 3, of: function (p) {
      return [p.age, p.location, p.appearance, p.type !== "unknown", p.narrative.in_its_own_words];
    } },
    history_origin: { need: 2, of: function (p) { return [p.origin, p.narrative.origin_story]; } },
    emotions_feelings: { need: 3, of: function (p) {
      return (p.emotions || []).concat([p.narrative.what_activates_it]);
    } },
    beliefs_motivations: { need: 4, of: function (p) {
      return (p.fears || []).concat(p.hopes_goals || [], p.behaviors || []);
    } },
    relationships: { need: 2, of: function (p) {
      return (p.relationships || []).map(function (r) { return r.notes || r.part; })
        .concat([p.narrative.relates_to_others]);
    } },
    communication_needs: { need: 3, of: function (p) {
      return (p.wants_needs || []).concat([p.narrative.what_it_needs]);
    } },
    positive_intent: { need: 1, of: function (p) { return [p.positive_intent]; } },
    changes_healing: { need: 1, of: function (p) { return [p.unburdened_vision]; } },
    integration_harmony: { need: 2, of: function (p) {
      return [p.trust_in_self !== "unknown", p.narrative.relates_to_others];
    } }
  };

  /* Depth, not just presence. "shame" and a sentence that says when the shame
     arrives and what it costs are both entries in the same field, and counting
     them the same is how a profile of one-word stubs reads as finished. A flag
     that is simply set (a type, a trust level) counts whole - there is no
     shallower way to record it. */
  function signalWeight(v) {
    if (v === true) return 1;
    if (v === false) return 0;   // not String(false) - "false" is five characters
    var s = String(v == null ? "" : v).trim();
    if (!s) return 0;
    if (s.length < 12) return 0.4;    // a word or two
    if (s.length < 40) return 0.75;   // a phrase
    return 1;                          // a thought
  }

  /* 0..1: how much of this category the part actually has written down. */
  function dataScore(part, category) {
    var spec = EVIDENCE[category];
    if (!spec) return 0;
    var depth = spec.of(part).reduce(function (sum, v) { return sum + signalWeight(v); }, 0);
    return Math.min(1, depth / spec.need);
  }

  /* 0..1 development score for the ring and the "% developed" label.
     Per category, the better of two honest signals: what the coverage map
     says was explored, and what the profile actually holds. Either alone
     lies - a topic can be explored and produce nothing recordable, and a
     profile can be full of content nobody has run a session over. */
  function coverageScore(part) {
    var pts = 0, denom = 0;
    CATEGORIES.forEach(function (c) {
      var s = part.coverage[c];
      if (s === "declined") return; // declined topics don't count against the part
      denom += 1;
      var flag = s === "complete" ? 1 : (s === "partial" ? 0.5 : 0);
      pts += Math.max(flag, dataScore(part, c));
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

  /* Fold two profiles of the same part into one.
     Different from applying a model's rewrite: there both sides describe the
     same session and the newer text supersedes, so mergeParts lets the
     incoming narrative win. Here both sides are real history that happened to
     get recorded twice, so nothing may be dropped - narrative sections are
     joined and both session logs are kept.
     `keep` supplies the surviving name, slug and type; `absorb` fills gaps. */
  function mergeDuplicate(keep, absorb) {
    var out = mergeParts(absorb, keep);

    NARRATIVE_SECTIONS.forEach(function (sec) {
      var a = (keep.narrative[sec.key] || "").trim();
      var b = (absorb.narrative[sec.key] || "").trim();
      out.narrative[sec.key] = (a && b && a !== b) ? a + "\n\n" + b : (a || b);
    });

    var seen = {}, sessions = [];
    (absorb.sessions || []).concat(keep.sessions || []).forEach(function (s) {
      var k = s.date + "|" + s.mode + "|" + (s.note || "");
      if (!seen[k]) { seen[k] = 1; sessions.push(s); }
    });
    sessions.sort(function (x, y) { return String(x.date).localeCompare(String(y.date)); });
    out.sessions = sessions;

    // an edge between the two halves would now point at the merged part itself
    out.relationships = (out.relationships || []).filter(function (r) {
      return r.part !== absorb.slug && r.part !== keep.slug;
    });
    return out;
  }

  /* Coerce an arbitrary object into a well-formed part, or null if it isn't
     one. A backup file is just JSON someone can hand-edit, and a part missing
     `coverage` or `narrative` makes readiness() and coverageScore() throw
     inside renderParts - which bricks the Parts tab on every later boot. */
  function normalizePart(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.name !== "string" || !raw.name.trim()) return null;
    var p = blankPart(raw.name);
    p.slug = (typeof raw.slug === "string" && raw.slug) ? raw.slug : slugify(raw.name);
    ["type", "age", "location", "appearance", "origin", "positive_intent",
     "unburdened_vision", "trust_in_self"].forEach(function (k) {
      if (typeof raw[k] === "string") p[k] = raw[k];
    });
    if (PART_TYPES.indexOf(p.type) < 0) p.type = "unknown";
    if (TRUST_LEVELS.indexOf(p.trust_in_self) < 0) p.trust_in_self = "unknown";
    ["emotions", "fears", "hopes_goals", "behaviors", "wants_needs"].forEach(function (k) {
      if (Array.isArray(raw[k])) {
        p[k] = raw[k].filter(function (x) { return typeof x === "string" && x.trim(); });
      }
    });
    if (Array.isArray(raw.relationships)) {
      p.relationships = raw.relationships.filter(function (r) {
        return r && typeof r === "object" && typeof r.part === "string" && r.part &&
          EDGE_TYPES.indexOf(r.type) >= 0;
      }).map(function (r) {
        return { part: r.part, type: r.type, notes: typeof r.notes === "string" ? r.notes : "" };
      });
    }
    if (raw.coverage && typeof raw.coverage === "object") {
      CATEGORIES.forEach(function (c) {
        if (COVERAGE_STATUSES.indexOf(raw.coverage[c]) >= 0) p.coverage[c] = raw.coverage[c];
      });
    }
    if (Array.isArray(raw.sessions)) {
      p.sessions = raw.sessions.filter(function (s) { return s && typeof s === "object" && s.date; })
        .map(function (s) {
          return { date: String(s.date), mode: s.mode || "checkin",
                   categories: Array.isArray(s.categories) ? s.categories : [],
                   note: typeof s.note === "string" ? s.note : "" };
        });
    }
    if (raw.narrative && typeof raw.narrative === "object") {
      NARRATIVE_SECTIONS.forEach(function (sec) {
        if (typeof raw.narrative[sec.key] === "string") p.narrative[sec.key] = raw.narrative[sec.key];
      });
    }
    return p;
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
    EDGE_TONE: EDGE_TONE,
    TONE_LABELS: TONE_LABELS,
    NARRATIVE_SECTIONS: NARRATIVE_SECTIONS,
    slugify: slugify,
    initial: initial,
    blankPart: blankPart,
    readiness: readiness,
    READY_AT: READY_AT,
    dataScore: dataScore,
    signalWeight: signalWeight,
    coverageScore: coverageScore,
    mergeParts: mergeParts,
    mergeDuplicate: mergeDuplicate,
    normalizePart: normalizePart,
    todayISO: todayISO
  };
})();
