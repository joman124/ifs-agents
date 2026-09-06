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

  /* ---- How one part feels toward another, right now ----
     The practitioner's Self-check question - "how are you feeling toward this
     part right now?" - turned around and asked of a part about its neighbour,
     which is what a table meeting is in a position to answer. Five points,
     because the useful distinctions are hostile / wary / neutral / warm /
     close and a wider scale only invites false precision. A reading is
     directed and dated: what The Critic felt toward The Dreamer at the end of
     one meeting is not what The Dreamer felt back, and neither is permanent. */
  var FEELINGS = [
    { val: 1, key: "hostile", label: "Hostile", blurb: "I want it gone" },
    { val: 2, key: "wary", label: "Wary", blurb: "I do not trust it" },
    { val: 3, key: "neutral", label: "Neutral", blurb: "nothing much either way" },
    { val: 4, key: "warm", label: "Warm", blurb: "I am glad it is here" },
    { val: 5, key: "close", label: "Close", blurb: "I would stand with it" }
  ];

  function feeling(rating) {
    return FEELINGS.filter(function (f) { return f.val === Math.round(Number(rating)); })[0] || null;
  }
  function feelingLabel(rating) {
    var f = feeling(rating);
    return f ? f.label : "";
  }

  /* A reading lands on the same three tones the map legend already speaks.
     Neutral is deliberately not a tone: "they sat together and felt nothing
     much" is a real answer, and colouring it either way would be a claim. */
  function feelingTone(rating) {
    var v = Number(rating) || 0;
    if (v >= 4) return "positive";
    if (v >= 1 && v <= 2) return "negative";
    return "unknown";
  }

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
      /* When this part was last written. A deletion is recorded as a
         tombstone with its own time, so the two together decide whether a
         part that arrives from another device is a copy of something already
         deleted or a genuine re-creation made since. */
      updated: "",
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
      /* Directed readings of how this part feels toward another, one entry
         per other part: the latest rating, when it was taken, how many rounds
         this direction has been through, and the reading before it. */
      feelings: [],
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

    // the result is as recent as whichever side was written last
    out.updated = (base.updated || "") > (out.updated || "") ? base.updated : out.updated;

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

    /* Readings, same rule: a side the incoming profile is silent about is
       kept, never dropped. Where both hold the same direction the later
       reading stands, but `rounds` is a count of table meetings that
       happened and only ever climbs - a merge must not lose one. */
    var feels = (out.feelings || []).map(function (f) { return { part: f.part, rating: f.rating, date: f.date || "", rounds: f.rounds || 1, prev: f.prev || 0 }; });
    var haveF = {};
    feels.forEach(function (f) { haveF[f.part] = f; });
    (base.feelings || []).forEach(function (f) {
      var cur = haveF[f.part];
      if (!cur) { feels.push({ part: f.part, rating: f.rating, date: f.date || "", rounds: f.rounds || 1, prev: f.prev || 0 }); return; }
      if ((f.date || "") > (cur.date || "")) {
        cur.rating = f.rating; cur.date = f.date || ""; cur.prev = f.prev || 0;
      }
      cur.rounds = Math.max(cur.rounds || 1, f.rounds || 1);
    });
    out.feelings = feels;

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
    out.feelings = (out.feelings || []).filter(function (f) {
      return f.part !== absorb.slug && f.part !== keep.slug;
    });
    return out;
  }

  /* Readings arrive from a backup, a sync, or a hand-edited profile file, so
     a rating is whatever someone typed until this has been past it. Anything
     outside the scale is dropped rather than clamped: an unreadable reading
     is not a reading, and inventing one would put a thread on the map that
     nobody ever felt. One entry per direction - a duplicated slug keeps the
     later of the two and the larger round count. */
  function normalizeFeelings(raw) {
    var out = [], byPart = {};
    (raw || []).forEach(function (f) {
      if (!f || typeof f !== "object" || typeof f.part !== "string" || !f.part) return;
      var rating = Math.round(Number(f.rating));
      if (!(rating >= 1 && rating <= 5)) return;
      var rounds = Math.round(Number(f.rounds));
      var prev = Math.round(Number(f.prev));
      var entry = {
        part: f.part,
        rating: rating,
        date: typeof f.date === "string" ? f.date : "",
        rounds: rounds >= 1 ? rounds : 1,
        prev: (prev >= 1 && prev <= 5) ? prev : 0
      };
      var cur = byPart[entry.part];
      if (!cur) { byPart[entry.part] = entry; out.push(entry); return; }
      if (entry.date > cur.date) { cur.rating = entry.rating; cur.date = entry.date; cur.prev = entry.prev; }
      cur.rounds = Math.max(cur.rounds, entry.rounds);
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
     "unburdened_vision", "trust_in_self", "updated"].forEach(function (k) {
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
    if (Array.isArray(raw.feelings)) p.feelings = normalizeFeelings(raw.feelings);
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

  /* Whole days between two YYYY-MM-DD dates. Parsed at UTC midnight on both
     sides so the answer is a count of calendar days rather than a duration
     that drifts by an hour twice a year. */
  function daysBetween(fromISO, toISO) {
    var a = Date.parse(String(fromISO || "") + "T00:00:00Z");
    var b = Date.parse(String(toISO || todayISO()) + "T00:00:00Z");
    if (isNaN(a) || isNaN(b)) return 0;
    return Math.round((b - a) / 86400000);
  }

  function lastSessionISO(part) {
    var ss = (part && part.sessions) || [];
    var latest = "";
    ss.forEach(function (s) {
      if (s && s.date && String(s.date) > latest) latest = String(s.date);
    });
    return latest;
  }

  /* ---- Recency, as a number the map and the daily ritual can both read ----
     A part is not only more or less developed, it is more or less *present*:
     one you sat with yesterday is live in a way one you last met in March is
     not. Heat decays from 1 on the day of a session to a floor over HEAT_DAYS,
     so a system left alone visibly cools rather than looking identical to the
     day it was built. A part that has never been interviewed sits just above
     the floor - it is not cold from neglect, it was simply never warm. */
  var HEAT_DAYS = 30;
  var HEAT_FLOOR = 0.12;
  var HEAT_NEW = 0.2;

  /* The decay curve itself, so a part's recency and a reading's recency
     cool at the same rate rather than by two hand-rolled formulas. An
     absent date is not cold, it is nothing: 0, for callers to treat as
     "never happened". */
  function heatFrom(dateISO, today) {
    if (!dateISO) return 0;
    var d = daysBetween(dateISO, today);
    if (d <= 0) return 1;
    if (d >= HEAT_DAYS) return HEAT_FLOOR;
    return 1 - (d / HEAT_DAYS) * (1 - HEAT_FLOOR);
  }

  function partHeat(part, today) {
    var last = lastSessionISO(part);
    if (!last) return HEAT_NEW;
    return heatFrom(last, today);
  }

  /* ---- Readings: reading them back, and taking a new one ---- */

  function getFeeling(part, otherSlug) {
    return ((part && part.feelings) || []).filter(function (f) { return f.part === otherSlug; })[0] || null;
  }

  /* Record how `part` felt toward `otherSlug` on `dateISO`. The previous
     reading is kept as `prev` rather than overwritten, so the profile carries
     the direction of travel and not only where it ended up, and `rounds`
     counts how many times this direction has been asked - which is what lets
     a thread on the map thicken with each meeting instead of only once.

     A round can be recorded long after the meeting it belongs to, so a
     reading does not always arrive later than the one already stored.
     `rounds` climbs either way: that meeting happened, and the thread is
     that much better known for it. But the reading shown as *current* only
     ever moves forward in time - back-filling a table session from March
     must not present March's answer as where the two parts stand now. An
     older reading becomes the one before the current one instead, and only
     where nothing truer already sits there.

     Returns { entry, current } - `current` says whether this reading is now
     the one the map and the profile read out, which is what lets a caller
     report a back-filled round honestly. */
  function setFeeling(part, otherSlug, rating, dateISO) {
    if (!part || !otherSlug || otherSlug === part.slug) return null;
    var v = Math.round(Number(rating));
    if (!(v >= 1 && v <= 5)) return null;
    part.feelings = part.feelings || [];
    var when = dateISO || todayISO();
    var cur = getFeeling(part, otherSlug);
    if (!cur) {
      cur = { part: otherSlug, rating: v, date: when, rounds: 1, prev: 0 };
      part.feelings.push(cur);
      return { entry: cur, current: true };
    }
    var current = when >= (cur.date || "");
    if (current) {
      cur.prev = cur.rating;
      cur.rating = v;
      cur.date = when;
    } else if (!cur.prev) {
      cur.prev = v;
    }
    cur.rounds = (cur.rounds || 1) + 1;
    return { entry: cur, current: current };
  }

  /* Both directions of one pair at once. `ab` is how a feels toward b, `ba`
     the reverse, and either may be 0 - one part answering and the other not
     is the common case at a table, not an error. `rounds` is how many times
     this pair has been through a round, `date` the most recent reading. */
  function pairFeeling(a, b) {
    var ab = (a && b) ? getFeeling(a, b.slug) : null;
    var ba = (a && b) ? getFeeling(b, a.slug) : null;
    var sides = (ab ? 1 : 0) + (ba ? 1 : 0);
    var sum = (ab ? ab.rating : 0) + (ba ? ba.rating : 0);
    return {
      ab: ab ? ab.rating : 0,
      ba: ba ? ba.rating : 0,
      sides: sides,
      avg: sides ? sum / sides : 0,
      rounds: Math.max(ab ? (ab.rounds || 1) : 0, ba ? (ba.rounds || 1) : 0),
      date: [ab ? ab.date || "" : "", ba ? ba.date || "" : ""].sort().pop() || ""
    };
  }

  /* 0..1: how much the readings alone say about a pair. One side speaking is
     a claim and both sides an account - the same rule the written notes below
     follow - and every further round adds a little, flattening off after
     ROUND_CAP so a pair that meets weekly does not run away from the rest of
     the map. */
  var ROUND_CAP = 4;

  function feelingWeight(a, b) {
    var f = pairFeeling(a, b);
    if (!f.sides) return 0;
    return Math.min(1, 0.34 + (f.sides === 2 ? 0.22 : 0) +
      Math.min(Math.max(f.rounds - 1, 0), ROUND_CAP - 1) * 0.11);
  }

  /* Which tone a pair reads as on the map and in the legend. The named edge
     type wins where there is one - what two parts *are* to each other is
     structural, and one tense meeting does not turn a protector into an
     enemy. Where nothing has been named, the readings speak instead, which
     is how a meeting can give an unmapped thread a colour without anyone
     inventing an edge type for it. */
  function pairTone(a, b) {
    if (!a || !b) return "unknown";
    var r = ((a.relationships || []).filter(function (x) { return x.part === b.slug; })[0]) ||
            ((b.relationships || []).filter(function (x) { return x.part === a.slug; })[0]);
    if (r) return EDGE_TONE[r.type] || "unknown";
    var f = pairFeeling(a, b);
    return f.sides ? feelingTone(f.avg) : "unknown";
  }

  /* ---- How much has actually been said about a relationship ----
     Two parts can be "mapped" because someone tapped a thread once and picked
     a type, or because both of them have described what the other does to
     them. On the map those should not be the same line. Mapped at all earns a
     base; the depth of each side's note earns most of the rest; both sides
     having spoken earns the last of it - a relationship only one part
     describes is a claim, not yet a mutual account. Returns 0 for a pair
     nobody has mapped and nobody has taken a reading on, which is what keeps
     the faint threads faint. */
  function edgeWeight(a, b) {
    if (!a || !b || !a.slug || !b.slug) return 0;
    var depth = 0, sides = 0;
    [[a, b.slug], [b, a.slug]].forEach(function (pair) {
      var r = (pair[0].relationships || []).filter(function (x) { return x.part === pair[1]; })[0];
      if (!r) return;
      sides++;
      depth += signalWeight(r.notes);
    });
    var said = sides ? Math.min(1, 0.3 + (depth / 2) * 0.55 + (sides === 2 ? 0.15 : 0)) : 0;
    var felt = feelingWeight(a, b);
    /* Two independent accounts of the same thread: what was written about it
       in a mapping session, and what the parts said they felt in the room.
       Either carries a line on its own, and a pair that has both saturates
       faster than either would - combined so neither can push past 1 and a
       thread can only ever thicken as more is known. */
    return said + felt - said * felt;
  }

  /* Which part has gone quietest - the one the daily ritual offers first.
     Coldest wins; where two are equally cold the less developed one is the
     more useful invitation, because it has more left to say. */
  function quietestPart(parts, today) {
    var best = null, bestHeat = 2, bestScore = 2;
    (parts || []).forEach(function (p) {
      if (!p) return;
      var h = partHeat(p, today);
      var sc = coverageScore(p);
      if (h < bestHeat || (h === bestHeat && sc < bestScore)) {
        best = p; bestHeat = h; bestScore = sc;
      }
    });
    return best;
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
    FEELINGS: FEELINGS,
    feeling: feeling,
    feelingLabel: feelingLabel,
    feelingTone: feelingTone,
    NARRATIVE_SECTIONS: NARRATIVE_SECTIONS,
    slugify: slugify,
    initial: initial,
    blankPart: blankPart,
    readiness: readiness,
    READY_AT: READY_AT,
    dataScore: dataScore,
    signalWeight: signalWeight,
    coverageScore: coverageScore,
    normalizeFeelings: normalizeFeelings,
    mergeParts: mergeParts,
    mergeDuplicate: mergeDuplicate,
    normalizePart: normalizePart,
    todayISO: todayISO,
    daysBetween: daysBetween,
    lastSessionISO: lastSessionISO,
    HEAT_DAYS: HEAT_DAYS,
    heatFrom: heatFrom,
    partHeat: partHeat,
    getFeeling: getFeeling,
    setFeeling: setFeeling,
    pairFeeling: pairFeeling,
    feelingWeight: feelingWeight,
    pairTone: pairTone,
    edgeWeight: edgeWeight,
    quietestPart: quietestPart
  };
})();
