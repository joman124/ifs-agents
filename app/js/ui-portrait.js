/* Inner Table - UI: choosing and framing a part's picture.

   One sheet to see what is there and change it, a second to frame a new one:
   drag to move, pinch or slide to zoom, with the circle it will usually be
   seen in drawn over the top. portrait.js does the work of opening the file
   and shrinking the chosen square; this is only the screen. Shared shell
   helpers arrive through window.IFS.ui._share, like ui-table.js. */
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

  /* ---- step one: what is there now, and the ways to change it ---- */
  function pictureSheet(slug, onDone) {
    var p = ST.getPart(slug);
    if (!p) return;
    var has = P.has(p);
    openSheet(
      '<h2 class="sheet-title serif">A picture of ' + esc(p.name) + "</h2>" +
      '<div class="pic-now"><span class="pic-big avatar' + P.cls(p) + '">' +
      P.face(p, "Picture of " + p.name) + "</span></div>" +
      '<p class="dim">A photo, a drawing, a screenshot &mdash; anything that helps you see ' + esc(p.name) +
      ". It is kept small, follows your account to your other devices, and stays out of AI sessions and exported .md profiles.</p>" +
      '<button class="btn btn-primary btn-big" id="picChoose">' + icon("camera", 18) +
      (has ? "Choose a different picture" : "Choose a picture") + "</button>" +
      (has ? '<button class="btn btn-ghost btn-big" id="picRemove">Remove the picture</button>' : "") +
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
          cropSheet(slug, work, onDone);
        }, function (err) {
          var b = $("#picChoose");
          if (b) { b.disabled = false; b.innerHTML = icon("camera", 18) + (has ? "Choose a different picture" : "Choose a picture"); }
          var msg = $("#picMsg");
          if (msg) msg.innerHTML = '<div class="readiness no" style="margin-top:12px">' + esc(err.message) + "</div>";
        });
      });
    });

    bind("#picRemove", function () { removeSheet(slug, onDone); });
  }

  function removeSheet(slug, onDone) {
    var p = ST.getPart(slug);
    if (!p) return;
    openSheet(
      '<h2 class="sheet-title serif">Remove the picture?</h2>' +
      '<p class="dim">' + esc(p.name) + " goes back to showing its initial. The picture itself is not kept anywhere &mdash; " +
      "to have it again you would choose it again.</p>" +
      '<button class="btn btn-danger btn-big" id="picRemoveYes">Remove it</button>' +
      '<button class="btn btn-ghost btn-big" id="picRemoveNo">Keep it</button>'
    );
    bind("#picRemoveNo", function () { pictureSheet(slug, onDone); });
    bind("#picRemoveYes", function () {
      var cur = ST.getPart(slug);
      if (cur) {
        S.setImage(cur, "");
        ST.upsertPart(cur);
      }
      finish(onDone, "Picture removed");
    });
  }

  /* ---- step two: frame it ----
     The working copy is a canvas the size of the (capped) original, moved
     and scaled with a CSS transform inside a square window. Nothing is
     redrawn while it is dragged; the crop is only cut when "Use this
     picture" is pressed. All the geometry is in the window's own pixels:
     `ox`/`oy` is where the picture's top-left sits in the window, and the
     picture is never allowed to leave a gap at any edge of it. */
  function cropSheet(slug, work, onDone) {
    var p = ST.getPart(slug);
    if (!p) return;
    openSheet(
      '<h2 class="sheet-title serif">Frame ' + esc(p.name) + "</h2>" +
      '<p class="dim">Drag to move it, pinch or use the slider to zoom. The circle is how it will usually be seen.</p>' +
      '<div class="crop" id="cropBox" tabindex="0" role="group" aria-label="Picture framing. Arrow keys move it, plus and minus zoom.">' +
      '<div class="crop-ring" aria-hidden="true"></div></div>' +
      '<label class="fieldlabel" for="cropZoom">Zoom</label>' +
      '<input id="cropZoom" class="crop-zoom" type="range" min="1" max="' + ZOOM_MAX + '" step="0.01" value="1">' +
      '<div style="height:14px"></div>' +
      '<button class="btn btn-primary btn-big" id="cropSave">Use this picture</button>' +
      '<button class="btn btn-ghost btn-big" id="cropBack">Choose another</button>' +
      '<div id="cropMsg"></div>'
    );

    var box = $("#cropBox");
    var slider = $("#cropZoom");
    var vs = Math.min(box.clientWidth, box.clientHeight) || 280;      // the window's side
    var iw = work.width, ih = work.height;
    var base = Math.max(vs / iw, vs / ih);                            // just covers the window
    var zoom = 1;
    var ox = (vs - iw * base) / 2, oy = (vs - ih * base) / 2;

    work.className = "crop-img";
    work.style.width = iw + "px";
    work.style.height = ih + "px";
    box.insertBefore(work, box.firstChild);

    function scale() { return base * zoom; }
    function clamp() {
      ox = Math.min(0, Math.max(vs - iw * scale(), ox));
      oy = Math.min(0, Math.max(vs - ih * scale(), oy));
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
      else if (e.key === "+" || e.key === "=") zoomTo(zoom * 1.1, vs / 2, vs / 2);
      else if (e.key === "-" || e.key === "_") zoomTo(zoom / 1.1, vs / 2, vs / 2);
      else moved = false;
      if (!moved) return;
      e.preventDefault();
      clamp(); paint();
    });

    slider.addEventListener("input", function () { zoomTo(parseFloat(slider.value) || 1, vs / 2, vs / 2); });

    bind("#cropBack", function () { pictureSheet(slug, onDone); });
    bind("#cropSave", function () {
      var cur = ST.getPart(slug);
      if (!cur) { closeSheet(); toast("That part is no longer here"); return; }
      // the window, in the working copy's own pixels
      var k = scale();
      var url = P.encode(work, -ox / k, -oy / k, vs / k);
      if (!url || !S.setImage(cur, url)) {
        $("#cropMsg").innerHTML = '<div class="readiness no" style="margin-top:12px">' +
          "That picture could not be made small enough to keep. Try zooming in, or a simpler picture.</div>";
        return;
      }
      ST.upsertPart(cur);
      finish(onDone, "Picture saved to " + cur.name);
    });
  }

  window.IFS.ui.pictureSheet = pictureSheet;
})();
