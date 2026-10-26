/* A finished conversation, written into the parts it was about
   (app/js/integrate.js). What must hold: each part is asked for on its own,
   so no reply has to carry every part's update at once; a part the AI wrote
   nothing for counts a try, so it is not asked for again at every open; a
   call that fails outright counts nothing and keeps what was already
   written; and every update is merged, never written over. */
"use strict";
var H = require("./harness.js");

function json(obj, status) {
  return Promise.resolve({ ok: !status || status < 400, status: status || 200,
    json: function () { return Promise.resolve(obj); }, text: function () { return Promise.resolve(JSON.stringify(obj)); } });
}
function said(text) { return json({ choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }] }); }
function profile(name, fear) {
  return "```markdown\n---\nname: " + name + "\nfears:\n  - " + fear + "\n---\n```";
}

module.exports = async function (t) {
  var asked = [];
  var answer = null;
  var env = H.load(["schema", "questions", "reference", "markdown", "store", "templates", "llm", "integrate"], {
    fetch: function (url, opts) {
      var b = JSON.parse(opts.body);
      var ask = b.messages[b.messages.length - 1].content;
      var who = (/only these: (.*?)\. Date/.exec(ask) || [])[1];
      asked.push({ who: who, system: b.messages[0].content, ask: ask });
      return answer(who);
    }
  });
  var S = env.IFS.schema, ST = env.IFS.store, IN = env.IFS.integrate;
  var ai = { provider: "openai", key: "sk-k", model: "" };

  ST.load();
  ["The Wandering Magician", "Dr. John"].forEach(function (n) {
    var p = S.blankPart(n);
    p.fears = ["being left behind"];
    ST.upsertPart(p);
  });
  var talk = function (date) {
    var id = ST.addTranscript({ date: date, mode: "talk", title: "Just talk", parts: [], text: "YOU: The Magician wanted out. Dr. John kept score." });
    return ST.state.transcripts.filter(function (x) { return x.id === id; })[0];
  };
  var log = function (slug, date) { return ST.getPart(slug).sessions.filter(function (s) { return s.date === date; }); };

  /* --- every part, one call each --- */
  var t1 = talk("2026-10-20");
  answer = function (who) { return said(profile(who, who === "Dr. John" ? "losing at work" : "being stuck indoors")); };
  var saved = await IN.transcript(ai, t1, ["the-wandering-magician", "dr-john"]);
  t.eq(asked.map(function (a) { return a.who; }), ["The Wandering Magician", "Dr. John"], "each part is asked for in a call of its own");
  t.ok(/name: The Wandering Magician/.test(asked[0].system) && !/name: Dr\. John/.test(asked[0].system),
    "...carrying only that part's profile, so the reply is one update, not all of them");
  t.ok(/YOU: The Magician wanted out/.test(asked[1].ask) && /2026-10-20, not today/.test(asked[1].ask), "...with the whole transcript, dated the day it happened");
  t.eq(saved.map(function (p) { return p.slug; }), ["the-wandering-magician", "dr-john"], "both are written");
  t.eq(ST.getPart("dr-john").fears, ["being left behind", "losing at work"], "an update is merged in - what was there stays");
  t.ok(log("dr-john", "2026-10-20").some(function (s) { return s.mode === "checkin"; }), "and the part's log shows the conversation reached it, on its date");
  t.eq(t1.integrated, ["the-wandering-magician", "dr-john"], "the transcript knows both are written in");

  /* --- an empty reply for one part: counted, and the next part still written --- */
  asked = [];
  var t2 = talk("2026-10-21");
  answer = function (who) {
    return who === "The Wandering Magician"
      ? json({ choices: [{ message: { role: "assistant", content: "" }, finish_reason: "length" }] })
      : said(profile("John", "the quarterly review"));
  };
  saved = await IN.transcript(ai, t2, ["the-wandering-magician", "dr-john"]);
  t.eq(saved.map(function (p) { return p.slug; }), ["dr-john"], "a part the AI wrote nothing for does not stop the next one");
  t.ok(ST.getPart("dr-john").fears.indexOf("the quarterly review") >= 0, "...and one profile back for one part asked is that part, whatever it was called");
  t.eq(t2.integrateTries, { "the-wandering-magician": 1 }, "an empty reply counts as a try, so it is not asked for again forever");
  t.eq(log("the-wandering-magician", "2026-10-21").length, 0, "and nothing is logged for a part that was not written");

  answer = function () { return said("Thank you for sharing that. How are you feeling now?"); };
  await IN.transcript(ai, t2, ["the-wandering-magician"]);
  await IN.transcript(ai, t2, ["the-wandering-magician"]);
  t.eq(t2.integrateTries["the-wandering-magician"], 3, "a reply with no update in it counts too - three, and the app stops asking");

  /* --- a call that fails outright: nothing counted, nothing lost --- */
  asked = [];
  var t3 = talk("2026-10-22");
  answer = function (who) {
    return who === "Dr. John" ? json({ error: { message: "invalid key" } }, 401) : said(profile(who, "rain"));
  };
  var threw = null;
  try { await IN.transcript(ai, t3, ["the-wandering-magician", "dr-john"]); } catch (e) { threw = e; }
  t.ok(threw && /rejected/.test(threw.message), "a call that fails outright is said, not swallowed");
  t.ok(ST.getPart("the-wandering-magician").fears.indexOf("rain") >= 0 && IN.updatedOn(ST.getPart("the-wandering-magician"), "2026-10-22"),
    "...and the part written before it stays written");
  t.eq(t3.integrateTries || {}, {}, "...and no try is counted, so the rest is tried again next time");
  t.ok(!IN.updatedOn(ST.getPart("dr-john"), "2026-10-22"), "...for the part it did not reach");
};
