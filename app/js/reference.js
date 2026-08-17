/* Inner Table - Fraser's Table protocol and the reference library.

   The table script is quoted from the "Fraser's Table" section of
   docs/source/IFS Questions.docx, in the order the document gives ("best
   applied in order"). The learn pages condense docs/ifs-primer.md so the app
   carries its own explanations instead of linking out.

   Nothing here writes to a part. The table is its own object in the store. */
(function () {
  "use strict";

  /* ---- Developing the Table: the room is built once, then edited ---- */
  var BUILD = [
    { key: "room",
      q: "Imagine a meeting place with a table in it. The room is pleasant, where no harm can come to you, and the table is one that feels safe or neutral to you. What can you tell me about the room and the table?",
      hint: "Take a moment first, and answer once you have the image in mind." },
    { key: "details",
      q: "Are there any other details that come forward as you examine the room or the table?",
      hint: "Focus on the aspects that emphasise safety and neutrality." },
    { key: "name",
      q: "You're welcome to name the room if you'd like.",
      hint: "Optional. Skip it and the room stays unnamed.",
      short: true }
  ];

  /* ---- Developing Tools: the document's suggestions, plus your own ---- */
  var TOOLS = [
    { id: "talking-stick", label: "A talking stick",
      blurb: "Only the part holding it gets to speak." },
    { id: "lighting", label: "Flexible lighting",
      blurb: "Candles around the table, a light at each seat, or lamps around the room — so a part that doesn't want to be seen yet still has somewhere to sit." },
    { id: "container", label: "A container",
      blurb: "A light field or chamber where a part can keep an experience safe when it is feeling too much, or isn't ready to share." },
    { id: "adjoining-room", label: "An adjoining room with windows",
      blurb: "Privacy for a part that wants to observe without being at the table." },
    { id: "break-signal", label: "A break signal",
      blurb: "A raised hand or a code word any part can use when it needs to stop or something feels unsafe." },
    { id: "notebook", label: "A notebook or message board",
      blurb: "Left in the room so parts can leave thoughts for each other, or for Self, between meetings." }
  ];

  /* ---- Where a part sits. The document is explicit that no part is forced
     to the table, and that being near but not participating is a real,
     respected choice - so it is a first-class seat here, not an absence. ---- */
  var SEATS = [
    { id: "table", label: "At the table", blurb: "seated and taking part" },
    { id: "room", label: "At the side of the room", blurb: "present, not seated" },
    { id: "adjoining", label: "In the adjoining room", blurb: "watching through the window" },
    { id: "away", label: "Not here today", blurb: "invited, and it declined" }
  ];

  /* ---- Closing Reflection ---- */
  var CLOSING = [
    { key: "showed_up", q: "Which parts showed up today, and how did they feel about it?" },
    { key: "shift", q: "Was there any shift in how the parts felt about each other?" },
    { key: "thanks", q: "Is there any part that wants to be thanked, honoured, or released before we end?" },
    { key: "hesitation", q: "Are there any doubts or hesitations about coming back to the table?",
      hint: "If so, those parts are valid, and the pace can follow them." },
    { key: "next_first", q: "Are there any parts who might want to speak first next time?" },
    { key: "more_time", q: "Is there a topic that needs more time and space than we had today?" },
    { key: "agreements", q: "Are there any agreements to carry forward for future meetings?",
      hint: "A talking stick, who sits closest to you, anything else that helped." }
  ];

  /* Read aloud at the end of a closing, straight from the document. */
  var FAREWELL = "Everyone is welcome to return another time. Even the parts who didn't speak today are still part of the system, and still matter.\n\nNow let's gently return from the table. You can imagine standing up, walking out of the room, and closing the door gently behind you. You might want to stretch, open your eyes, or just notice the feel of your body in the present moment.";

  /* ---- The reference library ---- */
  var LEARN = [
    { id: "table", title: "Fraser's Table", blurb: "The format this tab is built on",
      body: [
        ["p", "A group format for meeting several parts at once. You build a safe, neutral room with a table in it, invite parts to come — never forcing any of them — and use agreed tools so that everyone in the room feels respected."],
        ["h", "The ground rules"],
        ["l", ["It only works if you can visualise and hold imagery.",
               "Start from a safe place, then move to a neutral meeting place.",
               "The table should be new and neutral — not one loaded with history.",
               "Explore your own inner landscape. Don't borrow anyone else's parts as examples.",
               "More parts arrive as things stabilise. An empty-feeling room early on is normal."]],
        ["h", "Why nobody is made to sit"],
        ["p", "A part that stays at the side of the room, or watches from an adjoining room, is participating. Being invited and declining is a real answer, and this tab records it as one rather than treating it as a gap."]
      ] },
    { id: "self", title: "Self and the 8 Cs", blurb: "How to tell Self is present",
      body: [
        ["p", "Beneath and between the parts is Self — a core of consciousness that is not a part. Self can't be damaged and doesn't need protecting; it can only be obscured when a part blends with you."],
        ["h", "The 8 Cs"],
        ["l", ["Compassionate", "Curious", "Courageous", "Calm",
               "Clear", "Connected", "Creative", "Confident"]],
        ["p", "The practical test: ask how you feel toward a part right now. Curiosity and warmth mean Self is home. Feeling flooded, hostile, or merged means another part has blended with you — and the move is to ask that part for a little space, not to push through."]
      ] },
    { id: "6fs", title: "The 6 Fs of unblending", blurb: "How to get to know a part",
      body: [
        ["p", "The arc a session follows when it is going well. The interviews in this app walk it without naming it."],
        ["l", ["<b>Find</b> it — where is it in or around your body?",
               "<b>Focus</b> on it — turn your attention toward it and stay there.",
               "<b>Flesh it out</b> — what does it look like, how old does it feel?",
               "<b>Feel toward</b> it — how do you feel about it? This is the Self check.",
               "<b>Befriend</b> it — get its story, and let it know you heard it.",
               "<b>Fear</b> — what is it afraid would happen if it stopped doing its job?"]],
        ["p", "The last one is the question that most often changes a protector's mind about you."]
      ] },
    { id: "types", title: "Managers, firefighters, exiles", blurb: "The three roles",
      body: [
        ["l", ["<b>Managers</b> — proactive protectors. They organise, plan, criticise, perfect, please and control so that painful material is never triggered in the first place.",
               "<b>Firefighters</b> — reactive protectors. When pain breaks through anyway, they do whatever stops it now: numbing, bingeing, raging, dissociating, distracting. Costly methods, protective intent.",
               "<b>Exiles</b> — young, hurt parts carrying the burdens the protectors work to keep locked away."]],
        ["p", "Every part, including the ones causing problems, has a positive intent. There are no bad parts. A part will tell you what it is over time — which is why <i>unknown</i> is a perfectly good answer in a profile."]
      ] },
    { id: "burdens", title: "Burdens and legacy burdens", blurb: "What parts carry, and what they inherited",
      body: [
        ["p", "A burden is something a part carries that isn't native to it — a belief, an emotion, a rule it picked up from an experience. \"I am too much.\" \"It isn't safe to be seen.\" The part isn't the burden; it is weighed down by it."],
        ["h", "Legacy burdens"],
        ["p", "Some burdens were never yours to begin with. They arrive down a family line — inherited shame, a family's relationship to anger or money or grief, the residue of what happened to people before you. They can feel older and more impersonal than a burden that came from your own history, and they often show up in a part that seems disproportionate to anything you remember."],
        ["p", "Naming something as a possible legacy burden is a hypothesis to hold, not a conclusion to act on. It is a useful thing to notice and record, and a thing to explore with a practitioner rather than alone."],
        ["h", "Unburdening is not done here"],
        ["p", "The release itself is therapy, done with a trained professional. This app only records what a part says it <i>would</i> do if it no longer had to carry its role — its hope, in its own words."]
      ] },
    { id: "rules", title: "The working rules", blurb: "What this app is built to obey",
      body: [
        ["l", ["All parts are welcome.",
               "<b>We ask permission to communicate, always.</b>",
               "<b>Protectors set the pace.</b> You don't go around a protector to reach what it protects — you earn its trust.",
               "Parts will avoid overwhelming you if you communicate a boundary with them.",
               "Every person has a Self, and Self has the power to restabilise the system."]],
        ["h", "Polarisation"],
        ["p", "Two parts locked in opposing strategies, each escalating because the other exists — a strict manager against a rebellious firefighter. On the map these are the edges in tension."],
        ["h", "The 5 Ps"],
        ["p", "What the facilitating stance asks for, whether that's a therapist or you sitting with yourself: Presence, Patience, Perspective, Persistence, Playfulness."]
      ] },
    { id: "safety", title: "What this app will not do", blurb: "Boundaries, and where to go instead",
      body: [
        ["p", "This is a self-exploration and journalling tool that borrows IFS structure. It deliberately excludes therapeutic depth work: no trauma processing, no unburdening."],
        ["l", ["Anything can be declined, and a declined topic stays closed unless the part reopens it.",
               "Hesitation is a signal to back off, not to push.",
               "Stopping at any point is a fine outcome. Partial profiles are the norm.",
               "Feeling moved is normal. Feeling overwhelmed is the signal to close the session."]],
        ["p", "If you are in crisis, this is not the right support for the moment. Call or text <b>988</b> in the US, or find a line at <a href=\"https://findahelpline.com\" target=\"_blank\" rel=\"noopener\">findahelpline.com</a>."]
      ] },
    { id: "credits", title: "Where this comes from", blurb: "Credits",
      body: [
        ["p", "Internal Family Systems was developed by Richard C. Schwartz. For the real thing see the <a href=\"https://ifs-institute.com/\" target=\"_blank\" rel=\"noopener\">IFS Institute</a> or <i>No Bad Parts</i> (Schwartz, 2021)."],
        ["p", "The table format is modelled on Fraser's Table. The question set and the table protocol in this app are quoted from the practitioner notes this system was built from."],
        ["p", "Inner Table is the webapp of the open-source <a href=\"https://github.com/joman124/ifs-agents\" target=\"_blank\" rel=\"noopener\">ifs-agents</a> project. It is not affiliated with or endorsed by the IFS Institute."]
      ] }
  ];

  /* ---- Coach cues: the library, brought to the moment ----
     The reference library above only opens if someone taps the ⓘ, which means
     it is available exactly when a person is already comfortable and absent
     exactly when they are not. These are the same explanations, one line each,
     placed where the confusion actually happens: the first time a tab is
     opened, the first time a session starts. Each fires once, only for an
     account in its first run, and each offers the full page behind it. */
  var COACH = [
    { id: "parts", learn: "types",
      title: "There are no bad parts",
      text: "Every part here — even one whose methods cost you something — is trying to protect you with the best strategy it has. Managers get ahead of the pain, firefighters put it out once it lands, exiles carry it." },
    { id: "map", learn: "rules",
      title: "The faint threads are questions",
      text: "Any two parts in the same system already relate somehow; the dotted lines are the pairs you haven't named yet. Tap one to say how they get along — supportive, in tension, or still unknown." },
    { id: "table", learn: "table",
      title: "Nobody is made to sit",
      text: "You build a safe, neutral room and invite parts into it. A part that stays at the side, watches through a window, or declines outright is participating — this tab records that as an answer, not a gap." },
    { id: "session", learn: "6fs",
      title: "How a session goes",
      text: "Find it in your body, turn toward it, let it describe itself, then notice how you feel about it. Warmth and curiosity mean you have room for it. Anything can be declined, and stopping early is a fine outcome." },
    { id: "meeting", learn: "self",
      title: "You chair this",
      text: "In a meeting you sit as Self, not as any one part. The test is how you feel toward the parts at the table: curious and calm means Self is home. Flooded or hostile means a part has blended in — ask it for a little space." }
  ];

  /* ---- The daily invitation ----
     Rotated by date so the app asks the same question all day and a different
     one tomorrow. Deliberately open questions rather than tasks: the check-in
     is a door, not a streak to maintain. */
  var RITUAL_PROMPTS = [
    "Who is loudest in there today?",
    "Which part has been running the show this week?",
    "Is there a part that has been waiting for your attention?",
    "What showed up today that you recognise?",
    "Who came with you into this morning?",
    "Is anyone in there carrying more than usual right now?",
    "Which part would speak first if you gave it the floor?",
    "Has anything shifted since the last time you sat down with this?"
  ];

  /* Same prompt for the whole day, a different one tomorrow. Derived from the
     date itself so it survives a reload and needs nothing stored. */
  function ritualPrompt(iso) {
    var s = String(iso || "");
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return RITUAL_PROMPTS[h % RITUAL_PROMPTS.length];
  }

  window.IFS.reference = {
    BUILD: BUILD, TOOLS: TOOLS, SEATS: SEATS, CLOSING: CLOSING,
    FAREWELL: FAREWELL, LEARN: LEARN,
    COACH: COACH, RITUAL_PROMPTS: RITUAL_PROMPTS, ritualPrompt: ritualPrompt,
    coach: function (id) {
      return COACH.filter(function (x) { return x.id === id; })[0] || null;
    },
    seatLabel: function (id) {
      var s = SEATS.filter(function (x) { return x.id === id; })[0];
      return s ? s.label : SEATS[3].label;
    }
  };
})();
