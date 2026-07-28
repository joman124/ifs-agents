/* Inner Table - the IFS question bank.
   Verbatim from docs/source/IFS Questions.docx, one list per coverage
   category. Both the guided questionnaire and the AI session prompts read
   from here, so the app and the model ask the same questions.

   Per question: `field` routes the answer into a scalar profile field,
   `list` into a list field, `sec` overrides which narrative section it lands
   in. Anything else appends to the category's default section.

   The doc's "What memories or traumas are associated with your presence?" is
   deliberately absent: docs/safety.md excludes trauma content, and a
   tap-through form has no interviewer to back off when it lands badly. */
(function () {
  "use strict";

  /* Where a category's free-text answers go when a question doesn't say. */
  var SECTION_FOR = {
    introduction: "in_its_own_words",
    history_origin: "origin_story",
    emotions_feelings: "in_its_own_words",
    beliefs_motivations: "in_its_own_words",
    relationships: "relates_to_others",
    communication_needs: "what_it_needs",
    positive_intent: "in_its_own_words",
    changes_healing: "what_it_needs",
    integration_harmony: "relates_to_others"
  };

  var QUESTIONS = {
    introduction: [
      { q: "What is your name or how would you like to be called?", field: "name" },
      { q: "How are you doing?" },
      { q: "Do you need anything?", list: "wants_needs" },
      { q: "What is your role or purpose in this person's system?", field: "positive_intent" },
      { q: "What do you want to tell us about yourself?" },
      { q: "How old are you?", field: "age" },
      { q: "Where are you embodied?", field: "location" },
      { q: "What do you look like, if you show yourself?", field: "appearance" }
    ],
    history_origin: [
      { q: "Can you tell me when you first came into existence?", field: "origin" },
      { q: "What past experiences or events led to your creation or activation?" }
    ],
    emotions_feelings: [
      { q: "What emotions do you carry or represent?", list: "emotions" },
      { q: "How do you typically express your emotions?", list: "behaviors", sec: "what_activates_it" },
      { q: "What are your primary concerns or fears?", list: "fears" },
      { q: "What are you afraid would happen if you stepped outside of your role — if you didn't do what you usually do?", list: "fears" }
    ],
    beliefs_motivations: [
      { q: "What beliefs or rules do you hold about how this person should behave or feel?" },
      { q: "What motivates you to take the actions you do?" },
      { q: "What do you believe is your purpose in this person's life?" }
    ],
    relationships: [
      { q: "How do you interact with other parts in this person's system?" },
      { q: "Are there parts you cooperate with, or parts you conflict with?" },
      { q: "What are you afraid would happen if the other part took over and won the argument?" }
    ],
    communication_needs: [
      { q: "How do you communicate with the person?" },
      { q: "What do you need or want from the person?", list: "wants_needs" },
      { q: "Are there any unmet needs that you would like to address?", list: "wants_needs" },
      { q: "Is there anything you might need from me in the future?" }
    ],
    positive_intent: [
      { q: "What do you believe is your positive intent for the person?", field: "positive_intent" },
      { q: "How do you see yourself as trying to protect or help the person?" },
      { q: "What do you want the person to understand about your intentions?" }
    ],
    changes_healing: [
      { q: "Are there any changes or transformations you would like to experience?", list: "hopes_goals" },
      { q: "If you didn't have to play that role anymore, what would you do instead?", field: "unburdened_vision" },
      { q: "What would it take for you to feel safe in this person's system?" }
    ],
    integration_harmony: [
      { q: "Can you imagine a way to work with the other parts to create a more balanced system?" },
      { q: "How do you feel about the idea of being connected to Self and the other parts?" },
      { q: "What would it mean to you to be in a state of harmony within this person?" }
    ]
  };

  /* The category a check-in should go for next: untouched before partial,
     declined never. Mirrors step 1 of the check-in template. */
  function nextCategory(part) {
    var order = window.IFS.schema.CATEGORIES;
    var partial = null;
    for (var i = 0; i < order.length; i++) {
      var st = part.coverage[order[i]];
      if (st === "untouched") return order[i];
      if (st === "partial" && !partial) partial = order[i];
    }
    return partial;
  }

  /* Write answered questions into a profile, in place.
     answers: [{ def, text }] in bank order. Coverage reads complete only when
     every question in the category got an answer - partial otherwise. */
  function applyAnswers(part, cat, answers) {
    var fallback = SECTION_FOR[cat];
    answers.forEach(function (a) {
      var def = a.def, text = String(a.text || "").trim();
      if (!text) return;
      if (def.field) part[def.field] = text;
      else if (def.list) {
        part[def.list] = part[def.list].concat(
          text.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean));
      } else {
        var key = def.sec || fallback;
        part.narrative[key] = (part.narrative[key] ? part.narrative[key] + "\n\n" : "") +
          def.q + "\n" + text;
      }
      // a question that fills a field AND names a section feeds both
      if (def.sec && (def.field || def.list)) {
        part.narrative[def.sec] = (part.narrative[def.sec] ? part.narrative[def.sec] + "\n\n" : "") + text;
      }
    });
    var answered = answers.filter(function (a) { return String(a.text || "").trim(); }).length;
    if (answered) part.coverage[cat] = answered >= (QUESTIONS[cat] || []).length ? "complete" : "partial";
    return answered;
  }

  window.IFS.questions = {
    QUESTIONS: QUESTIONS,
    SECTION_FOR: SECTION_FOR,
    nextCategory: nextCategory,
    applyAnswers: applyAnswers,
    forCategory: function (cat) { return QUESTIONS[cat] || []; }
  };
})();
