/* Inner Table - a part's picture, and the meeting room's photo.

   Two jobs, both free of any screen of their own:

   - drawing it. Everywhere the app shows a part as a circle with its initial
     in it, `face()` gives the inside of that circle: the picture if the part
     has one, the initial if not. The circle keeps its own size and colour, so
     a part with a picture and a part without sit side by side.

   - making it. Whatever the person picks - a phone photo can be ten
     megapixels - is cropped and shrunk to a small JPEG before anything is
     stored: a square for a part, a wide banner for the room. Pictures live
     inside the profile, in the backup, and on the server, so small is not an
     optimisation, it is what lets them live there at all. The picker UI that
     sits on top of this is ui-portrait.js. */
(function () {
  "use strict";
  var S = window.IFS.schema;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ================= drawing ================= */

  /* Checked here as well as at every way in (normalizePart, importImages,
     setImage): a picture ends up in an src, and the one place that matters is
     the last one before it is drawn. A part holding something that is not a
     picture is a part without one. */
  function has(p) { return !!(p && S.cleanImage(p.image)); }

  /* The inside of a part's circle. `alt` is empty by default because the
     name sits right beside almost every circle, and reading it out twice
     helps nobody; the profile's own portrait passes a real description. */
  function face(p, alt) {
    if (has(p)) {
      return '<img class="pic" src="' + esc(p.image) + '" alt="' + esc(alt || "") +
        '" draggable="false" decoding="async">';
    }
    return esc(S.initial(p && p.name));
  }

  /* " has-pic" for the circle's class list, so the stylesheet can let the
     picture fill it. */
  function cls(p) { return has(p) ? " has-pic" : ""; }

  /* A whole circle, for the places that have no markup of their own. */
  function avatar(p, className, alt) {
    return '<span class="' + esc(className) + cls(p) + '">' + face(p, alt) + "</span>";
  }

  /* A meeting is told in names - "**The Critic:**" - not in slugs, so a
     speaker's picture has to be found the way a reader would: by the name. */
  function partNamed(name) {
    var want = String(name || "").toLowerCase().trim();
    if (!want) return null;
    var parts = window.IFS.store.listParts();
    for (var i = 0; i < parts.length; i++) {
      if (String(parts[i].name).toLowerCase().trim() === want) return parts[i];
    }
    return null;
  }

  /* ================= making ================= */

  var SOURCE_MAX = 1280;          // long side of the working copy the cropper shows
  var INPUT_MAX_BYTES = 30 * 1024 * 1024;

  /* What a picture is framed to. A part is a square (it is mostly seen in a
     circle); the meeting room is a wide banner. `steps` run biggest and best
     first, each as [width in px, JPEG quality]; every step down trades a
     little of one for staying under `target`, in characters of data URL. A flat
     drawing lands on the first step and a busy photo usually does too. The
     room is allowed more than a part because there is only ever one of it, and
     both targets sit well under the ceiling the store applies (schema.js). */
  var SHAPES = {
    part: {
      aspect: 1, ring: true, target: 34000,
      steps: [[320, 0.88], [320, 0.78], [320, 0.68], [288, 0.68], [256, 0.66], [224, 0.62], [192, 0.6], [160, 0.55]]
    },
    room: {
      aspect: 16 / 9, ring: false, target: 56000,
      steps: [[640, 0.84], [640, 0.74], [640, 0.64], [560, 0.64], [480, 0.62], [400, 0.6], [320, 0.58]]
    }
  };

  /* Decode a picked file through an <img>: every browser applies the photo's
     EXIF rotation to those, so a portrait shot on a phone comes out upright
     without this code knowing what EXIF is. */
  function decode(file) {
    return new Promise(function (resolve, reject) {
      if (!file) { reject(new Error("Nothing was picked.")); return; }
      if (file.type && file.type.indexOf("image/") !== 0) { reject(new Error("That is not a picture.")); return; }
      if (file.size > INPUT_MAX_BYTES) { reject(new Error("That picture is too large to open here.")); return; }
      var url;
      try { url = URL.createObjectURL(file); }
      catch (e) { reject(new Error("This browser cannot open that picture.")); return; }
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("That picture could not be read - a JPEG or PNG always works."));
      };
      img.src = url;
    });
  }

  /* The working copy the cropper moves around: capped, so a twelve-megapixel
     photo is not held in memory at full size just to choose a frame from it,
     and filled white first so a transparent PNG becomes white and not the
     black a JPEG would turn it into. */
  function workingCopy(img) {
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error("That picture has no size.");
    var k = Math.min(1, SOURCE_MAX / Math.max(w, h));
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  function open(file) {
    return decode(file).then(workingCopy);
  }

  function renderRegion(src, sx, sy, sw, sh, w, h, quality) {
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
    return c.toDataURL("image/jpeg", quality);
  }

  /* Cut the chosen frame - `rect` ({x, y, w, h}, in the working copy's own
     pixels) - out of it and encode it as small as it will go without looking
     worse for it, to the proportions of `shape` ("part" or "room"). Returns ""
     if even the smallest step is over the store's ceiling, which only a
     pathological picture manages. */
  function encode(src, rect, shape) {
    var spec = SHAPES[shape || "part"];
    // never ask for more than the working copy has: the edge of the picture
    // is where the frame can end up, and a hair past it reads as a blank row
    var sx = Math.max(0, rect.x), sy = Math.max(0, rect.y);
    var sw = Math.max(1, Math.min(rect.w, src.width - sx));
    var sh = Math.max(1, Math.min(rect.h, src.height - sy));
    var url = "";
    for (var i = 0; i < spec.steps.length; i++) {
      var w = spec.steps[i][0];
      url = renderRegion(src, sx, sy, sw, sh, w, Math.round(w / spec.aspect), spec.steps[i][1]);
      if (url.length <= spec.target) break;
    }
    return S.cleanImage(url);
  }

  /* Choose a picture from the device. The input is put in the document and
     taken out again afterwards for the same reason files.js does it: several
     in-app browsers will not open one that was never attached, and an
     unattached one can be collected while its picker is still open. Dismissing
     the picker calls nothing - the person changed their mind. */
  function pick(onFile) {
    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.style.cssText =
      "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
    var drop = function () { if (inp.parentNode) inp.parentNode.removeChild(inp); };
    inp.addEventListener("cancel", drop);
    inp.addEventListener("change", function () {
      var f = inp.files && inp.files[0];
      drop();
      if (f) onFile(f);
    });
    document.body.appendChild(inp);
    inp.click();
  }

  window.IFS = window.IFS || {};
  window.IFS.portrait = {
    SHAPES: SHAPES,
    has: has, face: face, cls: cls, avatar: avatar, partNamed: partNamed,
    pick: pick, open: open, encode: encode
  };
})();
