/* Inner Table - UI: choosing and framing a picture.

   One sheet to see what is there and change it, a second to frame a new one:
   drag to move, pinch or slide to zoom, with - for a part - the circle it will
   usually be seen in drawn over the top. portrait.js does the work of opening
   the file and shrinking the chosen frame; this is only the screen. Shared
   shell helpers arrive through window.IFS.ui._share, like ui-table.js.

   There are two things a picture can be of: a part, and the meeting room on
   the Table tab. Everything below is the same for both; a "subject" says which
   object carries the picture, how it is written back, what to call things on
   screen, and what shape it is framed to. */
(function () {
  "use strict";
  var UI = window.IFS.ui._share;
  var S = window.IFS.schema;
  var ST = window.IFS.store;
  var P = window.IFS.portrait;
  var icon = window.IFS.icon;
  var esc = UI.esc, toast = UI.toast, bind = UI.bind, buzz = UI.buzz, $ = UI.$;
  var openSheet = UI.openSheet, closeSheet = UI.closeSheet;

  var ZOOM_MAX = 4;

  /* A picture shows in the library, on the table and on the map, whichever of
     them is behind the sheet; the caller refreshes whatever it opened from. */
  function refreshViews() {
    UI.renderParts();
    var v = UI.currentView();
    if (v === "table") window.IFS.ui.renderTable();
    if (v === "map") UI.renderMap();
  }

  function finish(onDone, message) {
    closeSheet(); buzz(12);
    refreshViews();
    if (onDone) onDone();
    toast(message);
  }

  /* ---- what the picture is of ---- */

  function partSubject(slug) {
    var p = ST.getPart(slug);
    if (!p) return null;
    return {
      shape: "part", noun: "picture",
      title: "A picture of " + p.name,
      lede: "A photo, a drawing, a screenshot &mdash; anything that helps you see " + esc(p.name) +
        ". It is kept small, follows your account to your other devices, and stays out of AI sessions and exported .md profiles.",
      frameTitle: "Frame " + p.name,
      frameHint: "Drag to move it, pinch or use the slider to zoom. The circle is how it will usually be seen.",
      removeLede: esc(p.name) + " goes back to showing its initial. The picture itself is not kept anywhere &mdash; " +
        "to have it again you would choose it again.",
      gone: "That part is no longer here",
      target: function () { return ST.getPart(slug); },
      commit: function (cur) { ST.upsertPart(cur); },
      saved: function (cur) { return "Picture saved to " + cur.name; },
      preview: function (cur) {
        return '<span class="pic-big avatar' + P.cls(cur) + '">' + P.face(cur, "Picture of " + cur.name) + "</span>";
      }
    };
  }

  /* The room's photo is kept on the table object itself, beside its name and
     its description. */
  function roomSubject() {
    var name = ST.state.table.name || "the room";
    return {
      shape: "room", noun: "photo",
      title: "A photo of " + name,
      lede: "A photo, a drawing, a picture of a place &mdash; anything that helps you see where your parts meet. " +
        "It is kept small, follows your account to your other devices, and stays out of AI sessions.",
      frameTitle: "Frame the room",
      frameHint: "Drag to move it, pinch or use the slider to zoom.",
      removeLede: "The room goes back to having no photo. The photo itself is not kept anywhere &mdash; " +
        "to have it again you would choose it again.",
      gone: "The room is no longer here",
      target: function () { return ST.state.table.built ? ST.state.table : null; },
      commit: function (cur) { ST.saveTable({ image: cur.image, image_at: cur.image_at }); },
      saved: function () { return "Photo saved to the room"; },
      preview: function (cur) {
        return '<span class="pic-room' + (P.has(cur) ? "" : " empty") + '">' +
          (P.has(cur) ? P.face(cur, "Photo of " + name) : icon("table", 34)) + "</span>";
      }
    };
  }

  /* ---- step one: what is there now, and the ways to change it ---- */
  function show(subject, onDone) {
    var cur = subject.target();
    if (!cur) return;
    var has = P.has(cur);
    var chooseLabel = function () {
      return icon("camera", 18) + (has ? "Choose a different " : "Choose a ") + subject.noun;
    };
    openSheet(
      '<h2 class="sheet-title serif">' + esc(subject.title) + "</h2>" +
      '<div class="pic-now">' + subject.preview(cur) + "</div>" +
      '<p class="dim">' + subject.lede + "</p>" +
      '<button class="btn btn-primary btn-big" id="picChoose">' + chooseLabel() + "</button>" +
      (has ? '<button class="btn btn-ghost btn-big" id="picRemove">Remove the ' + subject.noun + "</button>" : "") +
      '<div id="picMsg"></div>'
    );

    bind("#picChoose", function () {
      P.pick(function (file) {
        var btn = $("#picChoose");
        if (!btn) return;                    // the sheet was put away while picking
        btn.disabled = true;
        btn.textContent = "Opening…";
        P.open(file).then(function (work) {
          if (!$("#picChoose")) return;      // ...or while it was being read
          frame(subject, work, onDone);
        }, function (err) {
          var b = $("#picChoose");
          if (b) { b.disabled = false; b.innerHTML = chooseLabel(); }
          var msg = $("#picMsg");
          if (msg) msg.innerHTML = '<div class="readiness no" style="margin-top:12px">' + esc(err.message) + "</div>";
        });
      });
    });

    bind("#picRemove", function () { confirmRemove(subject, onDone); });
  }

  function confirmRemove(subject, onDone) {
    if (!subject.target()) return;
    openSheet(
      '<h2 class="sheet-title serif">Remove the ' + subject.noun + "?</h2>" +
      '<p class="dim">' + subject.removeLede + "</p>" +
      '<button class="btn btn-danger btn-big" id="picRemoveYes">Remove it</button>' +
      '<button class="btn btn-ghost btn-big" id="picRemoveNo">Keep it</button>'
    );
    bind("#picRemoveNo", function () { show(subject, onDone); });
    bind("#picRemoveYes", function () {
      var cur = subject.target();
      if (cur) {
        S.setImage(cur, "");
        subject.commit(cur);
      }
      finish(onDone, subject.noun.charAt(0).toUpperCase() + subject.noun.slice(1) + " removed");
    });
  }

  /* ---- step two: frame it ----
     The working copy is a canvas the size of the (capped) original, moved
     and scaled with a CSS transform inside a window of the shape the picture
     will have. Nothing is redrawn while it is dragged; the crop is only cut
     when "Use this ..." is pressed. All the geometry is in the window's own
     pixels: `ox`/`oy` is where the picture's top-left sits in the window, and
     the picture is never allowed to leave a gap at any edge of it. */
  function frame(subject, work, onDone) {
    if (!subject.target()) return;
    var shape = P.SHAPES[subject.shape];
    openSheet(
      '<h2 class="sheet-title serif">' + esc(subject.frameTitle) + "</h2>" +
      '<p class="dim">' + subject.frameHint + "</p>" +
      '<div class="crop' + (shape.aspect === 1 ? "" : " wide") + '" id="cropBox" style="aspect-ratio:' + shape.aspect +
      '" tabindex="0" role="group" aria-label="Framing. Arrow keys move it, plus and minus zoom.">' +
      (shape.ring ? '<div class="crop-ring" aria-hidden="true"></div>' : "") + "</div>" +
      '<label class="fieldlabel" for="cropZoom">Zoom</label>' +
      '<input id="cropZoom" class="crop-zoom" type="range" min="1" max="' + ZOOM_MAX + '" step="0.01" value="1">' +
      '<div style="height:14px"></div>' +
      '<button class="btn btn-primary btn-big" id="cropSave">Use this ' + subject.noun + "</button>" +
      '<button class="btn btn-ghost btn-big" id="cropBack">Choose another</button>' +
      '<div id="cropMsg"></div>'
    );

    var box = $("#cropBox");
    var slider = $("#cropZoom");
    var vw = box.clientWidth || 280;                                  // the window
    var vh = box.clientHeight || Math.round(vw / shape.aspect);
    var iw = work.width, ih = work.height;
    var base = Math.max(vw / iw, vh / ih);                            // just covers the window
    var zoom = 1;
    var ox = (vw - iw * base) / 2, oy = (vh - ih * base) / 2;

    work.className = "crop-img";
    work.style.width = iw + "px";
    work.style.height = ih + "px";
    box.insertBefore(work, box.firstChild);

    function scale() { return base * zoom; }
    function clamp() {
      ox = Math.min(0, Math.max(vw - iw * scale(), ox));
      oy = Math.min(0, Math.max(vh - ih * scale(), oy));
    }
    function paint() {
      work.style.transform = "translate(" + ox + "px," + oy + "px) scale(" + scale() + ")";
      slider.value = zoom;
    }
    // zoom about a point in the window, so what is under the finger stays there
    function zoomTo(z, fx, fy) {
      z = Math.max(1, Math.min(ZOOM_MAX, z));
      var u = (fx - ox) / scale(), v = (fy - oy) / scale();
      zoom = z;
      ox = fx - u * scale();
      oy = fy - v * scale();
      clamp(); paint();
    }
    clamp(); paint();

    // The sheet closes on a long downward swipe anywhere on it (ui.js). That
    // is the gesture for moving a picture down, so touches that start in the
    // window are not the sheet's to see.
    box.addEventListener("touchstart", function (e) { e.stopPropagation(); }, { passive: true });

    var pts = {};
    var pinch = null;
    var dist = function (a, b) { return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
    var mid = function (a, b) {
      var r = box.getBoundingClientRect();
      return { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
    };

    box.addEventListener("pointerdown", function (e) {
      try { box.setPointerCapture(e.pointerId); } catch (err) {}
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pts);
      if (ids.length === 2) {
        var a = pts[ids[0]], b = pts[ids[1]];
        pinch = { d: dist(a, b), zoom: zoom, mid: mid(a, b) };
      }
    });
    box.addEventListener("pointermove", function (e) {
      var pt = pts[e.pointerId];
      if (!pt) return;
      var ids = Object.keys(pts);
      if (ids.length === 1) {
        ox += e.clientX - pt.x;
        oy += e.clientY - pt.y;
        clamp(); paint();
      } else if (ids.length === 2 && pinch) {
        pt.x = e.clientX; pt.y = e.clientY;
        var a = pts[ids[0]], b = pts[ids[1]];
        var m = mid(a, b);
        zoomTo(pinch.zoom * dist(a, b) / pinch.d, pinch.mid.x, pinch.mid.y);
        // two fingers travelling together carry the picture with them
        ox += m.x - pinch.mid.x;
        oy += m.y - pinch.mid.y;
        pinch.mid = m;
        clamp(); paint();
      }
      pt.x = e.clientX; pt.y = e.clientY;
    });
    function lift(e) {
      delete pts[e.pointerId];
      if (Object.keys(pts).length < 2) pinch = null;
    }
    box.addEventListener("pointerup", lift);
    box.addEventListener("pointercancel", lift);

    box.addEventListener("wheel", function (e) {
      e.preventDefault();
      var r = box.getBoundingClientRect();
      zoomTo(zoom * (e.deltaY > 0 ? 0.92 : 1.09), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    box.addEventListener("keydown", function (e) {
      var step = e.shiftKey ? 40 : 10;
      var moved = true;
      if (e.key === "ArrowLeft") ox += step;
      else if (e.key === "ArrowRight") ox -= step;
      else if (e.key === "ArrowUp") oy += step;
      else if (e.key === "ArrowDown") oy -= step;
      else if (e.key === "+" || e.key === "=") zoomTo(zoom * 1.1, vw / 2, vh / 2);
      else if (e.key === "-" || e.key === "_") zoomTo(zoom / 1.1, vw / 2, vh / 2);
      else moved = false;
      if (!moved) return;
      e.preventDefault();
      clamp(); paint();
    });

    slider.addEventListener("input", function () { zoomTo(parseFloat(slider.value) || 1, vw / 2, vh / 2); });

    bind("#cropBack", function () { show(subject, onDone); });
    bind("#cropSave", function () {
      var cur = subject.target();
      if (!cur) { closeSheet(); toast(subject.gone); return; }
      // the window, in the working copy's own pixels
      var k = scale();
      var url = P.encode(work, { x: -ox / k, y: -oy / k, w: vw / k, h: vh / k }, subject.shape);
      if (!url || !S.setImage(cur, url)) {
        $("#cropMsg").innerHTML = '<div class="readiness no" style="margin-top:12px">' +
          "That " + subject.noun + " could not be made small enough to keep. Try zooming in, or a simpler one.</div>";
        return;
      }
      subject.commit(cur);
      finish(onDone, subject.saved(cur));
    });
  }

  window.IFS.ui.pictureSheet = function (slug, onDone) {
    var subject = partSubject(slug);
    if (subject) show(subject, onDone);
  };
  window.IFS.ui.roomPictureSheet = function (onDone) { show(roomSubject(), onDone); };
})();
