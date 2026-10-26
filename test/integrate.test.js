/* A finished conversation, written into the parts it was about
   (app/js/integrate.js). What must hold: each part is asked for on its own,
   as a small JSON update of what is new, so no reply has to carry a whole
   profile file; a reply that writes a profile file anyway still lands; a
   part the AI wrote nothing for counts a try, so it is not asked for again
   at every open; a call that fails outright counts nothing and keeps what
   was already written; every update is merged, never written over; and a
   relationship lands on the map - on the part it means, on both sides. */
"use strict";
var H = require("./harness.js");

function json(obj, status) {
  return Promise.resolve({ ok: !status || status < 400, status: status || 200,
    json: function () { return Promise.resolve(obj); }, text: function () { return Promise.resolve(JSON.stringify(obj)); } });
}
function said(text) { return json({ choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }] }); }
function update(obj) { return said(JSON.stringify(obj)); }
function profile(name, fear) {
  return "```markdown\n---\nname: " + name + "\nfears:\n  - " + fear + "\n---\n```";
}

module.exports = async function (t) {
  var asked = [];
  var answer = null;
  var env = H.load(["schema", "questions", "reference", "markdown", "store", "templates", "llm", "integrate"], {
    fetch: function (url, opts) {
      var b = JSON.parse(opts.body);
      var msgs = b.messages || [];
      var ask = b.system !== undefined ? b.messages[b.messages.length - 1].text : msgs[msgs.length - 1].content;
      var who = (/only these: (.*?)\. The conversation/.exec(ask) || [])[1];
      asked.push({ who: who, system: b.system !== undefined ? b.system : msgs[0].content, ask: ask, body: b, url: String(url) });
      return answer(who);
    }
  });
  var S = env.IFS.schema, ST = env.IFS.store, IN = env.IFS.integrate;
  var ai = { provider: "openai", key: "sk-k", model: "" };

  ST.load();
  ["The Wandering Magician", "Dr. John", "The Sleeper"].forEach(function (n) {
    var p = S.blankPart(n);
    p.fears = ["being left behind"];
    ST.upsertPart(p);
  });
  var talk = function (date, mode, parts) {
    var id = ST.addTranscript({ date: date, mode: mode || "talk", title: "Just talk", parts: parts || [], text: "YOU: The Magician wanted out. Dr. John kept score." });
    return ST.state.transcripts.filter(function (x) { return x.id === id; })[0];
  };
  var log = function (slug, date) { return ST.getPart(slug).sessions.filter(function (s) { return s.date === date; }); };
  var edge = function (from, to) { return (ST.getPart(from).relationships || []).filter(function (r) { return r.part === to; })[0] || null; };

  /* --- every part, one call each, answered as JSON --- */
  var t1 = talk("2026-10-20");
  answer = function (who) {
    return who === "Dr. John"
      ? update({ part: "Dr. John", note: "Kept score of everything.", fears: ["losing at work"], own_words: ["Someone has to keep count"],
          coverage: { emotions_feelings: "partial", nonsense: "complete" }, type: "manager" })
      : update({ part: who, note: "Wanted out.", fears: ["being stuck indoors"] });
  };
  var saved = await IN.transcript(ai, t1, ["the-wandering-magician", "dr-john"]);
  t.eq(asked.map(function (a) { return a.who; }), ["The Wandering Magician", "Dr. John"], "each part is asked for in a call of its own");
  t.ok(/## The Wandering Magician, as its profile stands now/.test(asked[0].system) && !/## Dr\. John, as its profile/.test(asked[0].system),
    "...carrying only that part's profile");
  t.ok(/one JSON object and nothing else/.test(asked[0].system) && !/```markdown/.test(asked[0].system),
    "...and asking for a small JSON update of what is new, not a whole profile file");
  t.ok(/- dr-john \(Dr\. John\)/.test(asked[0].system) && !/- the-wandering-magician \(/.test(asked[0].system),
    "...with the other parts' slugs, for relationships");
  t.ok(/YOU: The Magician wanted out/.test(asked[1].ask) && /2026-10-20, not today/.test(asked[1].ask), "...with the whole transcript, dated the day it happened");
  t.eq(saved.map(function (p) { return p.slug; }), ["the-wandering-magician", "dr-john"], "both are written");
  var john = ST.getPart("dr-john");
  t.eq(john.fears, ["being left behind", "losing at work"], "an update is merged in - what was there stays");
  t.eq([john.type, john.narrative.in_its_own_words, john.coverage.emotions_feelings], ["manager", "\"Someone has to keep count\"", "partial"],
    "...its own words quoted, its kind and coverage taken (an unknown category is not)");
  t.ok(/^2026-10-20 - Kept score of everything\./.test(john.narrative.session_notes), "...with a Session notes entry dated the day of the conversation");
  t.ok(log("dr-john", "2026-10-20").some(function (s) { return s.mode === "checkin" && s.note === "Kept score of everything." && s.categories.join() === "emotions_feelings"; }),
    "and the part's log shows the conversation reached it, on its date, with what it covered");
  t.eq(t1.integrated, ["the-wandering-magician", "dr-john"], "the transcript knows both are written in");

  /* --- JSON with things around it, or a profile file instead --- */
  var R = IN._readJSON;
  t.eq(R('<think>maybe {"part": "x"}?</think>Here you go:\n```json\n{"part": "Dr. John", "note": "a {brace} and a \\"quote\\""}\n```').map(function (u) { return u.note; }),
    ["a {brace} and a \"quote\""], "JSON is found in a fence, after prose, past a model's thinking, braces in strings and all");
  t.eq(R('{"parts": [{"part": "A", "note": "1"}, {"part": "B", "note": "2"}]}').length, 2, "a {parts: [...]} wrapper is opened");
  t.eq(R("Thank you for sharing that.").length, 0, "and a reply with no update in it has none");
  var md = IN._updateFor(profile("Dr John", "the rain"), ST.getPart("dr-john"), "2026-10-20");
  t.ok(md && md.slug === "dr-john" && md.fears[0] === "the rain", "a reply that wrote a profile file anyway is still read as one");

  /* --- an empty reply for one part: counted, and the next part still written --- */
  asked = [];
  var t2 = talk("2026-10-21");
  answer = function (who) {
    return who === "The Wandering Magician"
      ? json({ choices: [{ message: { role: "assistant", content: "" }, finish_reason: "length" }] })
      : update({ part: "John", note: "The quarterly review.", fears: ["the quarterly review"] });
  };
  saved = await IN.transcript(ai, t2, ["the-wandering-magician", "dr-john"]);
  t.eq(saved.map(function (p) { return p.slug; }), ["dr-john"], "a part the AI wrote nothing for does not stop the next one");
  t.ok(ST.getPart("dr-john").fears.indexOf("the quarterly review") >= 0, "...and one update back for one part asked is that part, whatever it was called");
  t.eq(t2.writeTries, { "the-wandering-magician": 1 }, "an empty reply counts as a try, so it is not asked for again forever");
  t.eq(log("the-wandering-magician", "2026-10-21").length, 0, "and nothing is logged for a part that was not written");

  answer = function () { return said("Thank you for sharing that. How are you feeling now?"); };
  await IN.transcript(ai, t2, ["the-wandering-magician"]);
  answer = function () { return update({ part: "The Wandering Magician" }); };
  await IN.transcript(ai, t2, ["the-wandering-magician"]);
  t.eq(t2.writeTries["the-wandering-magician"], 3, "a reply with no update in it counts too, and one that says nothing at all - three, and the app stops asking");

  /* --- a call that fails outright: nothing counted, nothing lost --- */
  asked = [];
  var t3 = talk("2026-10-22");
  answer = function (who) {
    return who === "Dr. John" ? json({ error: { message: "invalid key" } }, 401) : update({ part: who, note: "Rain.", fears: ["rain"] });
  };
  var threw = null;
  try { await IN.transcript(ai, t3, ["the-wandering-magician", "dr-john"]); } catch (e) { threw = e; }
  t.ok(threw && /rejected/.test(threw.message), "a call that fails outright is said, not swallowed");
  t.ok(ST.getPart("the-wandering-magician").fears.indexOf("rain") >= 0 && IN.updatedOn(ST.getPart("the-wandering-magician"), "2026-10-22"),
    "...and the part written before it stays written");
  t.eq(t3.writeTries || {}, {}, "...and no try is counted, so the rest is tried again next time");
  t.ok(!IN.updatedOn(ST.getPart("dr-john"), "2026-10-22"), "...for the part it did not reach");

  /* --- relationships land on the map, both sides --- */
  asked = [];
  var t4 = talk("2026-10-23", "mapping", ["the-wandering-magician", "the-sleeper"]);
  answer = function (who) {
    return who === "The Wandering Magician"
      ? update({ part: who, note: "Named how it treats the Sleeper.",
          relationships: [{ part: "Sleeper", type: "protects", notes: "keeps it out of sight" },
            { part: "the-wandering-magician", type: "allied-with" }, { part: "Nobody Here", type: "conflicts-with" },
            { part: "dr-john", type: "befriends" }] })
      : update({ part: who, note: "Said little.", fears: ["being woken"] });
  };
  await IN.transcript(ai, t4, ["the-wandering-magician", "the-sleeper"]);
  t.ok(/This session mapped how The Wandering Magician and The Sleeper relate/.test(asked[0].ask),
    "a mapping session's write-in asks for the relationship between the pair");
  t.eq(edge("the-wandering-magician", "the-sleeper"), { part: "the-sleeper", type: "protects", notes: "keeps it out of sight" },
    "an edge to \"Sleeper\" is pointed at the real part, the-sleeper");
  t.eq(edge("the-sleeper", "the-wandering-magician"), { part: "the-wandering-magician", type: "protected-by", notes: "keeps it out of sight" },
    "...and mirrored onto it, though its own update said nothing about the Magician");
  t.eq([ST.getPart("the-wandering-magician").coverage.relationships, ST.getPart("the-sleeper").coverage.relationships], ["partial", "partial"],
    "...which counts as relationship ground covered, on both sides, as a thread named on the map does");
  t.ok(!edge("the-wandering-magician", "the-wandering-magician"), "an edge to the part itself is dropped");
  t.ok(edge("the-wandering-magician", "Nobody Here") && !edge("the-wandering-magician", "dr-john"),
    "one naming no part stays as written (not in the library yet); one of no known type is dropped");
  t.ok(ST.getPart("the-sleeper").fears.indexOf("being woken") >= 0, "and the other part's own update still lands");

  /* a later save that names the pair again, from the other side, wins on both */
  answer = function () {
    return update({ part: "The Sleeper", note: "Pushes back now.", relationships: [{ part: "The Wandering Magician", type: "conflicts-with", notes: "won't be hidden" }] });
  };
  await IN.transcript(ai, talk("2026-10-24"), ["the-sleeper"]);
  t.eq([edge("the-sleeper", "the-wandering-magician").type, edge("the-wandering-magician", "the-sleeper").type], ["conflicts-with", "conflicts-with"],
    "a newer edge replaces the pair's old one on both sides, never sits beside it");
  t.eq((ST.getPart("the-wandering-magician").relationships || []).filter(function (r) { return r.part === "the-sleeper"; }).length, 1,
    "...one edge per pair");

  /* the same save speaking for both sides: each keeps what it said */
  var both = IN.saveMerge([
    (function () { var p = S.blankPart("Dr. John"); p.relationships = [{ part: "the-sleeper", type: "protects", notes: "a" }]; return p; })(),
    (function () { var p = S.blankPart("The Sleeper"); p.relationships = [{ part: "Dr John", type: "allied-with", notes: "b" }]; return p; })()
  ]);
  t.eq([edge("dr-john", "the-sleeper").type, edge("the-sleeper", "dr-john").type], ["protects", "allied-with"],
    "where one save speaks for both sides, neither is overwritten by the other's mirror");
  t.eq(both.map(function (p) { return p.slug; }), ["dr-john", "the-sleeper"], "and the parts come back as stored");

  /* --- the free AI is asked for JSON --- */
  asked = [];
  answer = function (who) { return update({ part: who, note: "ok" }); };
  await IN.transcript({ provider: "free", key: "session", model: "" }, talk("2026-10-25"), ["dr-john"]);
  t.eq([asked[0].url, asked[0].body.json], ["/api/free-ai", true], "through the free AI, a write-in asks its server to hold the model to JSON");
};
