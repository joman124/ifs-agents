/* Inner Table - getting text off a picked file and into the app.

   The mirror of the export path in ui.js, and just as device-dependent.

   Two things break a file picker on a phone. First, iOS turns `accept` into a
   list of UTIs, and an extension it cannot resolve becomes a dynamic type that
   matches nothing on disk - no stock iPhone resolves "md", so every .md file in
   the Files picker came up greyed out and untappable, which is what "cannot
   upload md files" turned out to mean. Second, an <input> that was never put in
   the document can be collected while its picker is still open, and several
   in-app browsers refuse to open one at all; the export path already appends
   its <a> to the document for the same reason.

   So: no accept list on iOS, because breadth beats a filter that hides the very
   file being looked for; the input lives in the document until the pick is over;
   and every read says what actually happened rather than failing mute. */
(function () {
  "use strict";

  var TEXT_ACCEPT = ".md,.markdown,.txt,.text,text/markdown,text/plain";

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  /* opts: { accept, multiple, onStart }. onDone gets the result of
     readTextFiles. Dismissing the picker calls nothing, which is correct: the
     person changed their mind, there is nothing to report. */
  function pickTextFiles(opts, onDone) {
    opts = opts || {};
    var inp = document.createElement("input");
    inp.type = "file";
    inp.multiple = !!opts.multiple;
    if (opts.accept && !isIOS()) inp.accept = opts.accept;
    // in the document but out of sight - display:none inputs are ignored by
    // some older WebKit builds, an off-screen one never is
    inp.style.cssText =
      "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
    var drop = function () { if (inp.parentNode) inp.parentNode.removeChild(inp); };
    inp.addEventListener("cancel", drop);
    inp.addEventListener("change", function () {
      var files = Array.prototype.slice.call(inp.files || []);
      drop();
      if (!files.length) return;
      if (opts.onStart) opts.onStart(files);
      readTextFiles(files).then(onDone);
    });
    document.body.appendChild(inp);
    inp.click();
  }

  /* Blob.text() only exists from iOS 14 and Chrome 76 on, and a file that lives
     in iCloud or Drive but has not been downloaded yet rejects with
     NotReadableError. Both used to surface as an unhandled rejection behind a
     button that simply did nothing. */
  function readOneFile(f) {
    if (f && typeof f.text === "function") {
      return f.text().then(function (t) { return String(t == null ? "" : t); },
        function () { return readViaFileReader(f); });
    }
    return readViaFileReader(f);
  }

  function readViaFileReader(f) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result == null ? "" : fr.result)); };
      fr.onerror = function () { reject(fr.error || new Error("unreadable")); };
      try { fr.readAsText(f); } catch (e) { reject(e); }
    });
  }

  /* Without an accept filter the iOS picker offers photos and PDFs too, and a
     file tapped by mistake should be named and set aside rather than poured
     into the box as mojibake. A NUL byte, or a crowd of replacement characters
     left by decoding binary as text, is not a profile. */
  function looksBinary(text) {
    var head = String(text == null ? "" : text).slice(0, 4096);
    if (!head) return false;
    var bad = 0;
    for (var i = 0; i < head.length; i++) {
      var c = head.charCodeAt(i);
      if (c === 0) return true;
      if (c === 0xFFFD || (c < 0x20 && c !== 9 && c !== 10 && c !== 13)) bad++;
    }
    return bad / head.length > 0.05;
  }

  /* Never rejects: resolves to { text, failed, skipped } so the caller always
     has something honest to put on screen. One unreadable file among several
     must not cost the person the ones that read fine. Joining with a blank line
     is what lets a whole parts/ folder import at once - analyze() reads many
     profiles out of one blob. */
  function readTextFiles(files) {
    return Promise.all(Array.prototype.map.call(files, function (f) {
      return readOneFile(f).then(
        function (txt) { return { name: f.name, text: txt }; },
        function () { return { name: f.name, failed: true }; }
      );
    })).then(function (results) {
      var texts = [], failed = [], skipped = [];
      results.forEach(function (r) {
        if (r.failed) failed.push(r.name || "that file");
        else if (looksBinary(r.text)) skipped.push(r.name || "that file");
        else texts.push(r.text);
      });
      return { text: texts.join("\n\n"), failed: failed, skipped: skipped };
    });
  }

  /* One plain sentence naming what did not come through, "" if it all did. */
  function trouble(res) {
    var bits = [];
    if (res.failed.length) bits.push("Could not read " + res.failed.join(", "));
    if (res.skipped.length) bits.push("Skipped " + res.skipped.join(", ") + " - not text");
    return bits.join(". ");
  }

  window.IFS = window.IFS || {};
  window.IFS.files = {
    TEXT_ACCEPT: TEXT_ACCEPT, isIOS: isIOS, pickTextFiles: pickTextFiles,
    readTextFiles: readTextFiles, looksBinary: looksBinary, trouble: trouble
  };
})();
