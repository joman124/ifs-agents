/* Inner Table - UI: the free AI's one-time notice.

   Sessions run here on the free AI the deployment offers (api/free-ai.js),
   with nothing to set up. Before the first one the person is told, once,
   what it is and where the words go; yes is remembered (settings.freeAi) and
   never asked again. They can say no and copy the session into an AI chat
   of their own instead, which is remembered too - the copy screen offers the
   free AI back. An IIFE off window.IFS like every other module; shared shell
   helpers arrive through window.IFS.ui._share. */
(function () {
  "use strict";
  var UI = window.IFS.ui._share;
  var ST = window.IFS.store;
  var bind = UI.bind, buzz = UI.buzz;

  /* Where the words go, said the same way wherever it is asked. */
  var WHERE_WORDS_GO = "What you say passes through Inner Table&rsquo;s server to whichever free AI provider has room, " +
    "and some free providers keep or learn from what they are sent.";

  function sayYes() {
    ST.state.settings.freeAi = "on";
    ST.save();
  }

  /* start: what to run once they say yes. copy (optional): the session as a
     prompt for an AI chat of their own, offered as the other way. */
  function offerFree(start, copy) {
    UI.openSheet(
      '<h2 class="sheet-title serif">Talk here, for free</h2>' +
      '<p class="dim">Sessions run right here on free AI models &mdash; nothing to set up, nothing to pay, up to a daily limit.</p>' +
      '<p class="dim">' + WHERE_WORDS_GO + (copy ? " If you&rsquo;d rather not, copy the session into an AI chat you already use instead." : "") + "</p>" +
      '<button class="btn btn-primary btn-big" id="frStart">Start</button><div style="height:8px"></div>' +
      (copy ? '<button class="btn btn-soft btn-big" id="frCopy">Use my own AI chat instead</button>' : "") +
      '<button class="btn btn-ghost btn-big" id="frCancel">Not now</button>'
    );
    bind("#frStart", function () {
      sayYes();
      UI.closeSheet();
      buzz(12);
      setTimeout(start, 250);
    });
    bind("#frCopy", function () {
      ST.state.settings.copyPrompt = true;
      ST.save();
      UI.closeSheet();
      setTimeout(copy, 230);
    });
    bind("#frCancel", UI.closeSheet);
  }

  window.IFS.ui.connect = { offerFree: offerFree, sayYes: sayYes, WHERE_WORDS_GO: WHERE_WORDS_GO };
})();
