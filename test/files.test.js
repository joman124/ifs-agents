/* The upload path. What matters here is not that a good file reads - it is
   that a phone can reach the file at all, and that a file which cannot be read
   says so instead of leaving a button that looks broken. Both were real: an
   accept list iOS could not resolve greyed every .md file out, and an
   unhandled rejection swallowed every read failure. */
"use strict";
var H = require("./harness.js");

/* A file the modern way: Blob.text(). */
function file(name, text) {
  return { name: name, text: function () { return Promise.resolve(text); } };
}
/* A file whose Blob.text() rejects - an iCloud or Drive file with no local copy. */
function unreadable(name) {
  return { name: name, text: function () { return Promise.reject(new Error("NotReadableError")); } };
}
/* Pre-iOS-14 WebKit: no Blob.text() at all, only FileReader. */
function legacy(name) { return { name: name }; }

/* readAsText resolves from `map`; a name missing from it fails the read. */
function makeFileReader(map) {
  return function () {
    var self = this;
    this.readAsText = function (f) {
      if (Object.prototype.hasOwnProperty.call(map, f.name)) {
        self.result = map[f.name];
        self.onload();
      } else {
        self.error = new Error("unreadable");
        self.onerror();
      }
    };
  };
}

function fakeDocument() {
  var made = [];
  var body = {
    kids: [],
    appendChild: function (el) {
      el.parentNode = {
        removeChild: function (x) { body.kids.splice(body.kids.indexOf(x), 1); x.parentNode = null; }
      };
      body.kids.push(el);
    }
  };
  return {
    made: made,
    body: body,
    createElement: function (tag) {
      var el = {
        tagName: tag, style: {}, parentNode: null, files: null,
        clickedWhileAttached: null, listeners: {},
        addEventListener: function (ev, fn) { (el.listeners[ev] = el.listeners[ev] || []).push(fn); },
        click: function () { el.clickedWhileAttached = !!el.parentNode; },
        fire: function (ev) { (el.listeners[ev] || []).forEach(function (fn) { fn(); }); }
      };
      made.push(el);
      return el;
    }
  };
}

/* Let every pending microtask in the module's promise chain settle. */
function flush() { return new Promise(function (r) { setTimeout(r, 0); }); }

function loadFiles(extra) { return H.load(["files"], extra).IFS.files; }

var IPHONE = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)", platform: "iPhone", maxTouchPoints: 5 };
var DESKTOP = { userAgent: "Mozilla/5.0 (X11; Linux x86_64)", platform: "Linux x86_64", maxTouchPoints: 0 };
var IPAD = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 5 };

module.exports = async function (t) {

  /* --- telling a profile from a photo --- */
  var F = loadFiles({ navigator: DESKTOP });
  t.ok(!F.looksBinary("---\nname: The Critic\n---\n\n# The Critic\n"), "a profile is not binary");
  t.ok(!F.looksBinary(""), "empty text is not binary");
  t.ok(!F.looksBinary("café — naïve “curly” 😀 dashes"),
    "accents, dashes and emoji are text");
  t.ok(!F.looksBinary("tabs\tand\r\nwindows newlines\n"), "tabs and CRLF are text");
  t.ok(F.looksBinary("PK\u0000\u0000binary"), "a NUL byte marks binary");
  t.ok(F.looksBinary("\uFFFD\uFFFD\uFFFD\uFFFD\uFFFDJFIF\uFFFD\uFFFD\uFFFD\uFFFD"),
    "a JPEG decoded as text is a crowd of replacement characters, and is caught");

  /* --- reading, and reporting what did not read --- */
  var res = await F.readTextFiles([file("a.md", "first"), file("b.md", "second")]);
  t.eq(res.text, "first\n\nsecond",
    "several files join with a blank line, so a whole parts/ folder imports at once");
  t.eq(res.failed, [], "and nothing is reported as failed");
  t.eq(res.skipped, [], "and nothing is skipped");

  res = await F.readTextFiles([file("good.md", "kept"), unreadable("icloud.md")]);
  t.eq(res.text, "kept", "one unreadable file does not cost the person the ones that read fine");
  t.eq(res.failed, ["icloud.md"], "and the unreadable one is named rather than swallowed");

  res = await F.readTextFiles([unreadable("one.md"), unreadable("two.md")]);
  t.eq(res.text, "", "when every file fails there is no text");
  t.eq(res.failed, ["one.md", "two.md"],
    "and every failure is named - this used to be an unhandled rejection");

  res = await F.readTextFiles([file("shot.png", "\u0000\u0000binary"), file("real.md", "profile")]);
  t.eq(res.text, "profile", "a photo tapped by mistake is kept out of the box");
  t.eq(res.skipped, ["shot.png"], "and named as skipped");

  /* Pre-iOS-14 WebKit has no Blob.text(); the FileReader fallback is what keeps
     the button from doing nothing at all on an older phone. */
  var Fold = loadFiles({ navigator: IPHONE, FileReader: makeFileReader({ "old.md": "from filereader" }) });
  res = await Fold.readTextFiles([legacy("old.md")]);
  t.eq(res.text, "from filereader", "a file with no Blob.text() is read through FileReader instead");
  res = await Fold.readTextFiles([legacy("missing.md")]);
  t.eq(res.failed, ["missing.md"], "and a FileReader error is reported, not thrown into the void");

  /* Blob.text() rejecting falls through to FileReader before giving up. */
  var Fboth = loadFiles({ navigator: IPHONE, FileReader: makeFileReader({ "x.md": "second chance" }) });
  res = await Fboth.readTextFiles([unreadable("x.md")]);
  t.eq(res.text, "second chance", "a rejected Blob.text() still gets a FileReader attempt");

  /* --- the sentence shown when something did not come through --- */
  t.eq(F.trouble({ failed: [], skipped: [] }), "", "a clean read says nothing");
  t.ok(/Could not read a\.md/.test(F.trouble({ failed: ["a.md"], skipped: [] })), "a failure is named");
  t.ok(/Skipped b\.png/.test(F.trouble({ failed: [], skipped: ["b.png"] })), "a skip is named");
  t.ok(/Could not read a\.md\. Skipped b\.png/.test(F.trouble({ failed: ["a.md"], skipped: ["b.png"] })),
    "and both are reported together");

  /* --- the picker itself --- */
  t.ok(loadFiles({ navigator: IPHONE }).isIOS(), "an iPhone is iOS");
  t.ok(loadFiles({ navigator: IPAD }).isIOS(), "so is an iPad, which reports itself as a Mac with a touchscreen");
  t.ok(!loadFiles({ navigator: DESKTOP }).isIOS(), "a desktop is not");

  var doc = fakeDocument();
  var Fdesk = loadFiles({ navigator: DESKTOP, document: doc });
  Fdesk.pickTextFiles({ accept: Fdesk.TEXT_ACCEPT, multiple: true }, function () {});
  var inp = doc.made[0];
  t.eq(inp.tagName, "input", "the picker makes an input");
  t.eq(inp.type, "file", "of type file");
  t.ok(inp.multiple, "which takes several files, so a parts/ folder goes in at once");
  t.eq(inp.accept, Fdesk.TEXT_ACCEPT, "off iOS the accept list narrows the picker");
  t.ok(inp.clickedWhileAttached,
    "and the input is in the document before it is clicked - a detached one can be collected mid-pick");
  t.eq(doc.body.kids.length, 1, "it stays in the document while the picker is open");

  /* The bug as reported: iOS maps accept entries to UTIs, cannot resolve "md",
     and greys out every .md file. No accept list is the only version a phone
     can actually select a profile from. */
  var idoc = fakeDocument();
  var Fios = loadFiles({ navigator: IPHONE, document: idoc });
  Fios.pickTextFiles({ accept: Fios.TEXT_ACCEPT, multiple: true }, function () {});
  t.ok(!idoc.made[0].accept, "on iOS no accept list is set, so .md files stay tappable");
  t.ok(idoc.made[0].clickedWhileAttached, "and the input is attached there too");

  /* Picking hands the text back and tidies the input away. */
  var doc2 = fakeDocument();
  var F2 = loadFiles({ navigator: DESKTOP, document: doc2 });
  var got = null, started = null;
  F2.pickTextFiles({ multiple: true, onStart: function (fs) { started = fs.length; } },
    function (r) { got = r; });
  var inp2 = doc2.made[0];
  inp2.files = [file("the-critic.md", "---\nname: The Critic\n---\n")];
  inp2.fire("change");
  t.eq(started, 1, "onStart reports how many files are being read, so the sheet can say so");
  t.eq(doc2.body.kids.length, 0, "the input is removed from the document once the pick is over");
  await flush();
  t.ok(got && /name: The Critic/.test(got.text), "and the file's text comes back to the caller");

  /* Dismissing the picker is not a failure and must report nothing. */
  var doc3 = fakeDocument();
  var F3 = loadFiles({ navigator: DESKTOP, document: doc3 });
  var called = false;
  F3.pickTextFiles({}, function () { called = true; });
  doc3.made[0].files = [];
  doc3.made[0].fire("change");
  await flush();
  t.ok(!called, "dismissing the picker reports nothing - the person just changed their mind");

  var doc4 = fakeDocument();
  var F4 = loadFiles({ navigator: DESKTOP, document: doc4 });
  F4.pickTextFiles({}, function () {});
  doc4.made[0].fire("cancel");
  t.eq(doc4.body.kids.length, 0, "and a cancelled pick leaves no stray input behind in the page");
};
