/* Inner Table - part profile <-> markdown round-trip.
   Serializes to and parses the exact parts/<slug>.md format used by the
   ifs-agents repo (YAML frontmatter + fixed narrative sections), so profiles
   move freely between this app and the Claude Code skills. */
(function () {
  "use strict";
  var S = window.IFS.schema;
  var UNNAMED = "(unnamed part)";

  /* ---------------- serialize ---------------- */

  function yStr(v) {
    v = String(v == null ? "" : v);
    if (v === "") return "";
    if (/[:#\[\]{}&*!|>'"%@`\n]/.test(v) || /^\s|\s$/.test(v) || /^-/.test(v)) {
      return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    }
    return v;
  }

  function yList(items, indent) {
    if (!items || !items.length) return " []";
    return "\n" + items.map(function (it) { return indent + "- " + yStr(it); }).join("\n");
  }

  function serialize(part) {
    var L = [];
    L.push("---");
    L.push("name: " + yStr(part.name));
    L.push("type: " + (part.type || "unknown"));
    L.push("age: " + yStr(part.age));
    L.push("location: " + yStr(part.location));
    L.push("appearance: " + yStr(part.appearance));
    L.push("origin: " + yStr(part.origin));
    L.push("emotions:" + yList(part.emotions, "  "));
    L.push("fears:" + yList(part.fears, "  "));
    L.push("hopes_goals:" + yList(part.hopes_goals, "  "));
    L.push("behaviors:" + yList(part.behaviors, "  "));
    L.push("wants_needs:" + yList(part.wants_needs, "  "));
    L.push("positive_intent: " + yStr(part.positive_intent));
    L.push("unburdened_vision: " + yStr(part.unburdened_vision));
    L.push("trust_in_self: " + (part.trust_in_self || "unknown"));
    if (part.relationships && part.relationships.length) {
      L.push("relationships:");
      part.relationships.forEach(function (r) {
        L.push("  - part: " + yStr(r.part));
        L.push("    type: " + r.type);
        L.push("    notes: " + yStr(r.notes || ""));
      });
    } else {
      L.push("relationships: []");
    }
    L.push("coverage:");
    S.CATEGORIES.forEach(function (c) {
      L.push("  " + c + ": " + (part.coverage[c] || "untouched"));
    });
    if (part.sessions && part.sessions.length) {
      L.push("sessions:");
      part.sessions.forEach(function (s) {
        L.push("  - date: " + s.date);
        L.push("    mode: " + s.mode);
        L.push("    categories: [" + (s.categories || []).join(", ") + "]");
        L.push("    note: " + yStr(s.note || ""));
      });
    } else {
      L.push("sessions: []");
    }
    L.push("---");
    L.push("");
    L.push("# " + (part.name || "(unnamed)"));
    S.NARRATIVE_SECTIONS.forEach(function (sec) {
      L.push("");
      L.push("## " + sec.title);
      L.push("");
      var body = (part.narrative && part.narrative[sec.key]) || "";
      if (body) L.push(body.trim());
    });
    L.push("");
    return L.join("\n");
  }

  /* ---------------- parse ---------------- */

  /* Drop a trailing YAML comment - but a # inside a quoted string is content,
     not a comment. "Captain — #10" must survive the round trip. */
  function stripComment(v) {
    var q = v.charAt(0);
    if (q === '"' || q === "'") {
      for (var i = 1; i < v.length; i++) {
        if (q === '"' && v.charAt(i) === "\\") { i++; continue; }
        if (v.charAt(i) === q) return v.slice(0, i + 1);
      }
      return v; // unterminated quote: leave it be rather than truncate
    }
    // ^ as well as \s: a value that is nothing but a comment is an empty value
    return v.replace(/(^|\s)#.*$/, "");
  }

  function unquote(v) {
    v = v.trim();
    if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') {
      return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    if (v.length >= 2 && v[0] === "'" && v[v.length - 1] === "'") {
      return v.slice(1, -1).replace(/''/g, "'");
    }
    return v;
  }

  /* Minimal YAML subset parser for the profile frontmatter:
     scalars, flat lists, list-of-maps, one-level nested maps, flow lists. */
  function parseFrontmatter(text) {
    var out = {};
    var lines = text.split(/\r?\n/);
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (!line.trim() || /^\s*#/.test(line)) { i++; continue; }
      var m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
      if (!m) { i++; continue; }
      var key = m[1];
      var rest = stripComment(m[2].trim()).trim();
      i++;
      if (rest === "[]") { out[key] = []; continue; }
      // coerce, not unquote: an inline flow list (emotions: [a, b]) is a list,
      // not the literal string "[a, b]"
      if (rest !== "") { out[key] = coerce(rest); continue; }
      // block value: list or map, by inspecting next indented lines
      var items = [];
      var map = {};
      var isList = false, isMap = false;
      while (i < lines.length) {
        var ln = lines[i];
        if (!ln.trim()) { i++; continue; }
        var ind = ln.match(/^(\s*)/)[1].length;
        if (ind === 0) break;
        var t = ln.trim();
        if (t[0] === "-") {
          isList = true;
          var itemBody = t.slice(1).trim();
          var kvm = itemBody.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
          if (kvm) {
            // list of maps: gather this item's keys
            var obj = {};
            obj[kvm[1]] = coerce(kvm[2]);
            i++;
            while (i < lines.length) {
              var sub = lines[i];
              if (!sub.trim()) { i++; continue; }
              var sind = sub.match(/^(\s*)/)[1].length;
              var st = sub.trim();
              if (sind <= ind || st[0] === "-") break;
              var skv = st.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
              if (skv) obj[skv[1]] = coerce(skv[2]);
              i++;
            }
            items.push(obj);
            continue;
          } else {
            items.push(unquote(itemBody));
            i++;
            continue;
          }
        } else {
          var nm = t.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
          if (nm) { isMap = true; map[nm[1]] = coerce(nm[2]); }
          i++;
        }
      }
      out[key] = isList ? items : (isMap ? map : "");
    }
    return out;
  }

  function coerce(v) {
    v = stripComment(v.trim()).trim();
    var fl = v.match(/^\[(.*)\]$/); // flow list
    if (fl) {
      if (!fl[1].trim()) return [];
      return fl[1].split(",").map(function (x) { return unquote(x.trim()); });
    }
    return unquote(v);
  }

  function parseNarrative(body) {
    var narrative = {};
    S.NARRATIVE_SECTIONS.forEach(function (sec) { narrative[sec.key] = ""; });
    var current = null;
    var buf = [];
    var flush = function () {
      if (current) narrative[current] = buf.join("\n").trim();
      buf = [];
    };
    body.split(/\r?\n/).forEach(function (line) {
      var h = line.match(/^##\s+(.+?)\s*$/);
      if (h) {
        flush();
        var title = h[1].toLowerCase();
        current = null;
        S.NARRATIVE_SECTIONS.forEach(function (sec) {
          if (sec.title.toLowerCase() === title) current = sec.key;
        });
        return;
      }
      if (/^#\s/.test(line)) return; // top-level heading = part name
      if (current) buf.push(line);
    });
    flush();
    return narrative;
  }

  function asList(v) {
    if (Array.isArray(v)) return v.filter(function (x) { return typeof x === "string" && x.trim(); });
    if (typeof v === "string" && v.trim()) return [v.trim()];
    return [];
  }

  /* A profile file may open with an HTML comment before its frontmatter -
     examples/parts/the-critic.md does, and a person pasting a file they were
     given shouldn't be told it isn't a profile because of a header note. */
  function stripLeadingComments(text) {
    return String(text == null ? "" : text)
      .replace(/^﻿?\s*(?:<!--[\s\S]*?-->\s*)+/, "");
  }

  function parse(markdown) {
    markdown = stripLeadingComments(markdown);
    // [ \t]* after the opening marker: an editor that left a trailing space on
    // the --- line still wrote a profile, and refusing it drops a clean import
    // into the degraded salvage path for a character nobody can see.
    var m = markdown.match(/^﻿?\s*---[ \t]*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
    if (!m) throw new Error("No YAML frontmatter found. Expected a profile in the parts/<slug>.md format.");
    return buildPart(parseFrontmatter(m[1]), m[2]);
  }

  function buildPart(fm, body) {
    var name = typeof fm.name === "string" ? fm.name.trim() : "";
    if (!name) {
      // A part that hasn't given a name yet is a real IFS state, not a broken
      // file - keep it if the block is otherwise clearly a profile, so an
      // import never silently drops one. The intro question can name it later.
      if (!fm.coverage && !fm.type && !fm.positive_intent) {
        throw new Error("Profile has no name field.");
      }
      name = UNNAMED;
    }
    var part = S.blankPart(name);
    part.slug = S.slugify(part.name);
    ["type", "age", "location", "appearance", "origin", "positive_intent", "unburdened_vision", "trust_in_self"]
      .forEach(function (k) { if (typeof fm[k] === "string") part[k] = fm[k]; });
    if (S.PART_TYPES.indexOf(part.type) < 0) part.type = "unknown";
    if (S.TRUST_LEVELS.indexOf(part.trust_in_self) < 0) part.trust_in_self = "unknown";
    ["emotions", "fears", "hopes_goals", "behaviors", "wants_needs"]
      .forEach(function (k) { part[k] = asList(fm[k]); });
    if (Array.isArray(fm.relationships)) {
      part.relationships = fm.relationships.filter(function (r) {
        return r && typeof r === "object" && r.part && S.EDGE_TYPES.indexOf(r.type) >= 0;
      }).map(function (r) {
        return { part: S.slugify(r.part), type: r.type, notes: r.notes || "" };
      });
    }
    if (fm.coverage && typeof fm.coverage === "object" && !Array.isArray(fm.coverage)) {
      S.CATEGORIES.forEach(function (c) {
        var v = fm.coverage[c];
        if (S.COVERAGE_STATUSES.indexOf(v) >= 0) part.coverage[c] = v;
      });
    }
    if (Array.isArray(fm.sessions)) {
      part.sessions = fm.sessions.filter(function (s) { return s && typeof s === "object" && s.date; })
        .map(function (s) {
          return {
            date: s.date,
            mode: s.mode || "checkin",
            categories: Array.isArray(s.categories) ? s.categories : [],
            note: s.note || ""
          };
        });
    }
    part.narrative = parseNarrative(body);
    return part;
  }

  /* Cut a run of concatenated bare profiles into one string each. A document
     ends where the next one's opening --- begins; tracking whether we are
     inside frontmatter keeps the closing --- from being mistaken for it.
     Without this, picking a whole parts/ folder parses as a single part whose
     body has swallowed every other file. */
  /* Does the --- on line i open a profile, or is it a markdown horizontal
     rule sitting in a narrative body? Frontmatter's first line is a YAML key;
     a rule is followed by prose, a heading, or the end of the file. Without
     this test every rule read as the start of a new document, and the tail it
     cut off - every section after it - parsed as nothing and was dropped,
     while the import still reported success. */
  function opensFrontmatter(lines, i) {
    for (var j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue;
      if (/^---[ \t]*$/.test(lines[j])) return false;
      return /^[A-Za-z_][A-Za-z0-9_]*:(\s|$)/.test(lines[j]);
    }
    return false;
  }

  function splitDocs(text) {
    var lines = text.split(/\r?\n/);
    var docs = [], cur = [], inFM = false, closedFM = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var marker = /^---[ \t]*$/.test(line);
      // outside frontmatter, a --- that opens nothing is the person's own
      // horizontal rule: it belongs to the body, not to a new document
      if (marker && !inFM && !opensFrontmatter(lines, i)) { cur.push(line); continue; }
      if (marker && !inFM && closedFM) {   // a fresh document starts here
        docs.push(cur.join("\n"));
        cur = []; closedFM = false;
      }
      if (marker) { if (inFM) { inFM = false; closedFM = true; } else inFM = true; }
      cur.push(line);
    }
    docs.push(cur.join("\n"));
    return docs.filter(function (d) { return d.trim(); });
  }

  /* Extract fenced profile blocks from an LLM reply that may contain prose
     around one or more ```markdown ...``` blocks each holding a profile.
     Falls back to bare profile text - one file, or a folder's worth. */
  function extractProfiles(text) {
    var found = [];
    var fence = /```(?:markdown|md|yaml)?\s*\n([\s\S]*?)```/g;
    var m;
    while ((m = fence.exec(text)) !== null) {
      var block = m[1];
      if (/^\s*---/.test(block) && /\nname\s*:/.test("\n" + block)) {
        try { found.push(parse(block)); } catch (e) { /* skip non-profile blocks */ }
      }
    }
    if (!found.length && /^﻿?\s*---/.test(stripLeadingComments(text))) {
      splitDocs(stripLeadingComments(text)).forEach(function (doc) {
        try { found.push(parse(doc)); } catch (e) { /* not a bare profile */ }
      });
    }
    return found;
  }

  /* Friendly import analysis: never throws. Returns
     { profiles: [...] }                              - clean import
     { profiles: [], salvage: part, missing: [...] }  - readable but incomplete; best-effort part
     { profiles: [], error: { title, hint } }         - nothing usable, with plain-English guidance */
  function analyze(text) {
    text = String(text == null ? "" : text).trim();
    if (!text) {
      return { profiles: [], error: {
        title: "Nothing to import yet",
        hint: "Paste the whole profile text (or the end-of-session output from your AI chat), or pick a .md file below."
      } };
    }
    var profiles = extractProfiles(text);
    if (profiles.length) return { profiles: profiles };

    var hasFM = /^﻿?\s*---/.test(stripLeadingComments(text)) || /```[\s\S]*?---/.test(text);
    var hasName = /^\s*name\s*:\s*\S/m.test(text);

    // Salvage: the frontmatter parser is line-based, so running it over the
    // whole text picks up any "key: value" profile lines wherever they are.
    if (hasName) {
      try {
        var fm = parseFrontmatter(text);
        if (typeof fm.name === "string" && fm.name.trim()) {
          var part = buildPart(fm, text);
          var missing = [];
          if (!part.positive_intent) missing.push("its positive intent");
          var touched = S.CATEGORIES.filter(function (c) { return part.coverage[c] !== "untouched"; });
          if (!touched.length) missing.push("any coverage record (which sections have been explored)");
          if (!part.narrative.in_its_own_words) missing.push("anything in its own words");
          return { profiles: [], salvage: part, missing: missing };
        }
      } catch (e) { /* fall through to guidance */ }
    }

    if (hasFM && !hasName) {
      return { profiles: [], error: {
        title: "Found a profile block, but no name",
        hint: "Every profile needs a 'name:' line in the block between the --- markers (for example: name: The Critic). Add one and try again, or create the part by hand below."
      } };
    }
    return { profiles: [], error: {
      title: "This doesn't look like a part profile yet",
      hint: "Profiles are the markdown files this system saves: they start with --- and a 'name:' line. If your AI session just ended, ask it to \"output the complete updated profile in a fenced markdown block\" and paste that here. Or skip files entirely and create the part by hand below."
    } };
  }

  /* ================= table meetings =================
     A meeting turn arrives as one blob of text with "**Name:**" markers in
     it. Splitting it is what turns a wall of prose into a room with people
     in it - the chat renders these as separate bubbles, and the summary card
     reads the same segments back to find what each part ended up saying. */
  function splitVoices(text) {
    var re = /\*\*([^*\n]{1,48}?):?\*\*:?\s*/g;
    var segs = [];
    var current = null, last = 0, m;
    var src = String(text == null ? "" : text);
    while ((m = re.exec(src)) !== null) {
      var chunk = src.slice(last, m.index);
      if (current) current.text += chunk;
      else if (chunk.trim()) segs.push({ name: null, text: chunk });
      current = { name: m[1].replace(/:$/, "").trim(), text: "" };
      segs.push(current);
      last = re.lastIndex;
    }
    var tail = src.slice(last);
    if (current) current.text += tail;
    else if (tail.trim()) segs.push({ name: null, text: tail });
    return segs.filter(function (s) { return s.name || s.text.trim(); });
  }

  /* Trim a part's words down to something that fits on a card without
     ending mid-word. Sentence boundaries first, a hard cap as backstop. */
  function firstSentences(text, count, cap) {
    var s = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
    if (!s) return "";
    var out = [], re = /[^.!?]+[.!?]*/g, m;
    while ((m = re.exec(s)) !== null && out.length < count) {
      var piece = m[0].trim();
      if (piece) out.push(piece);
    }
    var joined = out.join(" ") || s;
    if (joined.length > cap) joined = joined.slice(0, cap - 1).replace(/\s+\S*$/, "").trim() + "…";
    return joined;
  }

  /* A part's closing turn often opens with a concession fragment - "Fine.",
     "Alright.", "I suppose." - which is a real thing to say in a room and a
     poor thing to lead a summary card with. Drop leading scraps as long as
     there is something more substantial behind them. */
  function dropFillerLead(text) {
    var s = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
    var re = /^[^.!?]{1,14}[.!?]\s+(?=\S)/, m;
    while ((m = re.exec(s)) !== null && s.length - m[0].length > 20) s = s.slice(m[0].length);
    return s;
  }

  /* Build the summary a meeting leaves behind on the Table tab.
     The *last* thing a part said is the one worth keeping: a meeting that
     went anywhere ends closer to agreement than it started, so a part's
     closing line carries where it landed rather than where it came in.
     Self is pulled out separately - it chairs, so its final word is the
     synthesis rather than another voice in the list. */
  function summarizeMeeting(turns, names) {
    var segs = [];
    (turns || []).forEach(function (t) { segs = segs.concat(splitVoices(t)); });
    var byName = {};
    segs.forEach(function (s) {
      if (!s.name || !s.text.trim()) return;
      byName[s.name.toLowerCase().trim()] = s.text;   // later turns overwrite earlier
    });
    var voices = [];
    (names || []).forEach(function (n) {
      var t = byName[String(n).toLowerCase().trim()];
      if (t) voices.push({ name: n, line: firstSentences(dropFillerLead(t), 2, 160) });
    });
    var self = byName["self"];
    return { voices: voices, synthesis: self ? firstSentences(dropFillerLead(self), 3, 260) : "" };
  }

  window.IFS.md = {
    serialize: serialize, parse: parse, extractProfiles: extractProfiles, analyze: analyze,
    splitVoices: splitVoices, firstSentences: firstSentences, summarizeMeeting: summarizeMeeting
  };
})();
