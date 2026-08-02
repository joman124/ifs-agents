/* Inner Table - the swarm map.
   A force-directed layout over SVG with mobile interactions:
   - drag nodes, pan the canvas, pinch to zoom
   - tap a part to highlight its relationships (labels appear on its edges,
     everything else dims) and surface an "open profile" card via onSelect
   Self sits pinned near the top, per the repo's mapping convention. */
(function () {
  "use strict";

  var sim = null;
  var refreshFn = null; // set by the active render; lets the UI re-apply the legend filter

  /* render() runs again on every visit to the map and after every edge saved,
     but the pan/pinch/wheel handlers live on the <svg> itself, which
     innerHTML = "" does not clear. Track them so each render replaces the
     previous set instead of stacking another one on an installed PWA. */
  var svgHandlers = [];
  function bindSvg(svg, type, fn, opts) {
    svg.addEventListener(type, fn, opts);
    svgHandlers.push([svg, type, fn, opts]);
  }
  function unbindSvg() {
    svgHandlers.forEach(function (h) { h[0].removeEventListener(h[1], h[2], h[3]); });
    svgHandlers = [];
  }

  /* How far from Self each seat sits, once a table has been built.
     "away" is absent: no pull, so it drifts with the rest of the swarm. */
  var SEAT_RADIUS = { table: 120, room: 200, adjoining: 280 };

  function buildGraph(parts) {
    var nodes = [{ id: "self", label: "Self", self: true }];
    var idx = { self: 0 };
    parts.forEach(function (p) {
      idx[p.slug] = nodes.length;
      nodes.push({ id: p.slug, label: p.name, type: p.type });
    });
    var edges = [];
    var seen = {};
    var mapped = {};                       // "slugA|slugB" (sorted) -> true
    var pairKey = function (x, y) { return [x, y].sort().join("|"); };
    parts.forEach(function (p) {
      (p.relationships || []).forEach(function (r) {
        if (!(r.part in idx)) return;
        var t = r.type;
        var a = p.slug, b = r.part;
        if (t === "protected-by") { t = "protects"; a = r.part; b = p.slug; }
        mapped[pairKey(p.slug, r.part)] = true;
        var key = t === "protects" ? "protects|" + a + "|" + b
                                   : t + "|" + [a, b].sort().join("|");
        if (seen[key]) return;
        seen[key] = 1;
        edges.push({ a: idx[a], b: idx[b], type: t, from: a, to: b });
      });
    });

    /* Parts that share an inner system already relate somehow - we just have
       not asked yet. Draw every unmapped pair as a faint "unknown" thread so
       the relationship is visible as a question, and tappable to answer.
       ponytail: every pair is O(n^2); past the cap the map would be a hairball
       and the per-frame cost real, so above it only mapped edges are drawn. */
    var IMPLICIT_CAP = 240;
    if ((parts.length * (parts.length - 1)) / 2 <= IMPLICIT_CAP) {
      for (var i = 0; i < parts.length; i++) {
        for (var j = i + 1; j < parts.length; j++) {
          if (mapped[pairKey(parts[i].slug, parts[j].slug)]) continue;
          edges.push({
            a: idx[parts[i].slug], b: idx[parts[j].slug],
            type: "unknown", implicit: true,
            from: parts[i].slug, to: parts[j].slug
          });
        }
      }
    }
    return { nodes: nodes, edges: edges };
  }

  function render(svg, parts, opts) {
    opts = opts || {};
    if (sim) { cancelAnimationFrame(sim.raf); sim = null; }
    unbindSvg();
    svg.innerHTML = "";
    var W = svg.clientWidth || 360, H = svg.clientHeight || 560;
    var g = buildGraph(parts);
    if (g.nodes.length <= 1) return false;

    var NS = "http://www.w3.org/2000/svg";
    var view = { x: 0, y: 0, w: W, h: H };
    function applyView() {
      svg.setAttribute("viewBox", view.x + " " + view.y + " " + view.w + " " + view.h);
    }
    applyView();

    /* client coords -> svg user coords (correct under any pan/zoom) */
    var pt = svg.createSVGPoint();
    function toSvg(ev) {
      pt.x = ev.clientX; pt.y = ev.clientY;
      var m = svg.getScreenCTM();
      if (!m) return { x: ev.clientX, y: ev.clientY };
      var p = pt.matrixTransform(m.inverse());
      return { x: p.x, y: p.y };
    }

    var defs = document.createElementNS(NS, "defs");
    defs.innerHTML = '<marker id="arrow" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" opacity=".7"/></marker>';
    svg.appendChild(defs);
    var edgeLayer = document.createElementNS(NS, "g");
    var nodeLayer = document.createElementNS(NS, "g");
    svg.appendChild(edgeLayer);
    svg.appendChild(nodeLayer);

    var typeColor = { manager: "var(--manager)", firefighter: "var(--firefighter)", exile: "var(--exile)", unknown: "var(--unknown)" };

    g.nodes.forEach(function (n, i) {
      if (n.self) { n.x = W / 2; n.y = Math.min(90, H * .16); n.pin = true; }
      else {
        var ang = (i / (g.nodes.length - 1)) * Math.PI * 2;
        n.x = W / 2 + Math.cos(ang) * Math.min(W, H) * .26;
        n.y = H * .55 + Math.sin(ang) * Math.min(W, H) * .22;
      }
      n.vx = 0; n.vy = 0;
    });

    var selected = null; // node index or null

    /* Tapping a part focuses it: its threads to every other part light up,
       mapped or not, so the next tap can name any of them. */
    function tapNode(ni) {
      select(ni);
    }

    var TONE = window.IFS.schema.EDGE_TONE;
    var toneOf = function (e) { return e.implicit ? "unknown" : (TONE[e.type] || "unknown"); };

    var edgeEls = g.edges.map(function (e, ei) {
      var line = document.createElementNS(NS, "line");
      line.setAttribute("class", "edge " + e.type + (e.implicit ? " implicit" : ""));
      line.style.color = "var(--manager)";
      edgeLayer.appendChild(line);
      // a fat invisible line under the thin one: a 2px stroke is not a touch target
      var hit = document.createElementNS(NS, "line");
      hit.setAttribute("class", "edge-hit");
      edgeLayer.appendChild(hit);
      hit.addEventListener("pointerdown", function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        if (opts.onEdge) opts.onEdge(e.from, e.to, e.implicit ? "" : e.type);
      });
      var label = document.createElementNS(NS, "text");
      label.setAttribute("class", "edgelabel");
      label.textContent = e.type.replace(/-/g, " ");
      label.style.display = "none"; // labels only for the selected part's edges
      edgeLayer.appendChild(label);
      return { line: line, hit: hit, label: label };
    });

    /* Visibility is two filters at once: which part is selected, and which
       legend tone is switched on. An edge shows only if it passes both. */
    function applySelection() {
      var tone = opts.tone && opts.tone();
      g.edges.forEach(function (e, i) {
        var touches = selected != null && (e.a === selected || e.b === selected);
        var inTone = !tone || toneOf(e) === tone;
        var el = edgeEls[i];
        var op;
        if (!inTone) op = 0;
        else if (selected == null) op = e.implicit ? .3 : 1;
        else if (touches) op = 1;
        else op = e.implicit ? 0 : .12;
        el.line.style.opacity = op;
        el.hit.style.pointerEvents = op ? "stroke" : "none";
        // only mapped edges get a label - "not mapped yet" on ten threads at
        // once is noise, and the sheet names both parts anyway
        el.label.style.display = touches && inTone && !e.implicit ? "" : "none";
      });
      g.nodes.forEach(function (n, i) {
        var neighbor = selected == null || i === selected || g.edges.some(function (e) {
          return (e.a === selected && e.b === i) || (e.b === selected && e.a === i);
        });
        nodeEls[i].style.opacity = neighbor ? "1" : ".22";
      });
      if (opts.onSelect) opts.onSelect(selected == null ? null : g.nodes[selected]);
    }
    refreshFn = applySelection;

    function select(i) {
      selected = (selected === i) ? null : i;
      applySelection();
    }

    var nodeEls = g.nodes.map(function (n, ni) {
      var grp = document.createElementNS(NS, "g");
      grp.setAttribute("class", "node" + (n.self ? " self" : ""));
      grp.style.transition = "opacity .2s";
      var r = n.self ? 26 : 22;
      var c = document.createElementNS(NS, "circle");
      c.setAttribute("r", r);
      if (!n.self) {
        c.setAttribute("fill", "var(--surface)");
        c.setAttribute("stroke", typeColor[n.type] || "var(--unknown)");
      }
      var initial = document.createElementNS(NS, "text");
      initial.setAttribute("dy", "5");
      initial.setAttribute("font-size", n.self ? "13" : "15");
      initial.textContent = n.self ? "Self" : window.IFS.schema.initial(n.label);
      var name = document.createElementNS(NS, "text");
      name.setAttribute("dy", r + 16);
      name.setAttribute("font-size", "11");
      // long names run off a phone screen; the full one is on the tap card
      name.textContent = n.self ? ""
        : (n.label.length > 18 ? n.label.slice(0, 17).trim() + "…" : n.label);
      grp.appendChild(c); grp.appendChild(initial); grp.appendChild(name);
      nodeLayer.appendChild(grp);

      // drag to move; a near-still press-and-release is a tap (select)
      grp.addEventListener("pointerdown", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        try { grp.setPointerCapture(ev.pointerId); } catch (e) {}
        n.drag = true;
        var start = { x: ev.clientX, y: ev.clientY };
        var moved = false;
        var move = function (mv) {
          if (Math.abs(mv.clientX - start.x) + Math.abs(mv.clientY - start.y) > 7) moved = true;
          if (!moved) return;
          var p = toSvg(mv);
          n.x = p.x; n.y = p.y;
          n.vx = 0; n.vy = 0;
          kick();
        };
        var up = function () {
          n.drag = false;
          grp.removeEventListener("pointermove", move);
          grp.removeEventListener("pointerup", up);
          grp.removeEventListener("pointercancel", up);
          if (!moved) tapNode(ni);
        };
        grp.addEventListener("pointermove", move);
        grp.addEventListener("pointerup", up);
        grp.addEventListener("pointercancel", up);
      });
      return grp;
    });

    /* ---- background: one pointer pans, two pointers pinch-zoom,
            a still tap clears the selection ---- */
    var pointers = {};
    var pinchStart = null;
    bindSvg(svg, "pointerdown", function (ev) {
      try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
      pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), view: { x: view.x, y: view.y, w: view.w, h: view.h } };
      }
    });
    bindSvg(svg, "pointermove", function (ev) {
      var p = pointers[ev.pointerId];
      if (!p) return;
      var ids = Object.keys(pointers);
      if (ids.length === 1) {
        var scale = view.w / svg.clientWidth;
        view.x -= (ev.clientX - p.x) * scale;
        view.y -= (ev.clientY - p.y) * scale;
        applyView();
      } else if (ids.length === 2 && pinchStart) {
        p.x = ev.clientX; p.y = ev.clientY;
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        var factor = pinchStart.d / d;
        var w = Math.max(W * .4, Math.min(W * 2.5, pinchStart.view.w * factor));
        var h = w * (H / W);
        // zoom around the pinch midpoint
        var mx = pinchStart.view.x + ((a.x + b.x) / 2 / svg.clientWidth) * pinchStart.view.w;
        var my = pinchStart.view.y + ((a.y + b.y) / 2 / svg.clientHeight) * pinchStart.view.h;
        view.w = w; view.h = h;
        view.x = mx - ((a.x + b.x) / 2 / svg.clientWidth) * w;
        view.y = my - ((a.y + b.y) / 2 / svg.clientHeight) * h;
        applyView();
      }
      p.x = ev.clientX; p.y = ev.clientY;
    });
    var endPointer = function (ev) {
      var p = pointers[ev.pointerId];
      if (p && Math.abs(ev.clientX - p.sx) + Math.abs(ev.clientY - p.sy) < 6 && Object.keys(pointers).length === 1) {
        selected = null;
        applySelection();
      }
      delete pointers[ev.pointerId];
      if (Object.keys(pointers).length < 2) pinchStart = null;
    };
    bindSvg(svg, "pointerup", endPointer);
    bindSvg(svg, "pointercancel", endPointer);

    // desktop nicety: wheel to zoom
    bindSvg(svg, "wheel", function (ev) {
      ev.preventDefault();
      var factor = ev.deltaY > 0 ? 1.1 : 0.9;
      var w = Math.max(W * .4, Math.min(W * 2.5, view.w * factor));
      var mx = view.x + (ev.offsetX / svg.clientWidth) * view.w;
      var my = view.y + (ev.offsetY / svg.clientHeight) * view.h;
      view.h = w * (H / W);
      view.x = mx - (ev.offsetX / svg.clientWidth) * w;
      view.y = my - (ev.offsetY / svg.clientHeight) * (view.h);
      view.w = w;
      applyView();
    }, { passive: false });

    var heat = 1;
    function kick() { heat = Math.max(heat, .5); }

    function step() {
      for (var i = 0; i < g.nodes.length; i++) {
        for (var j = i + 1; j < g.nodes.length; j++) {
          var a = g.nodes[i], b = g.nodes[j];
          var dx = b.x - a.x, dy = b.y - a.y;
          var d2 = dx * dx + dy * dy + 40;
          var f = 5200 / d2;
          var d = Math.sqrt(d2);
          var fx = f * dx / d, fy = f * dy / d;
          if (!a.pin && !a.drag) { a.vx -= fx; a.vy -= fy; }
          if (!b.pin && !b.drag) { b.vx += fx; b.vy += fy; }
        }
      }
      g.edges.forEach(function (e) {
        if (e.implicit) return; // unmapped threads are drawn, not sprung -
                                // otherwise every pair pulls and the map balls up
        var a = g.nodes[e.a], b = g.nodes[e.b];
        var dx = b.x - a.x, dy = b.y - a.y;
        var d = Math.sqrt(dx * dx + dy * dy) || 1;
        var want = 130;
        var f = (d - want) * 0.012;
        var fx = f * dx / d, fy = f * dy / d;
        if (!a.pin && !a.drag) { a.vx += fx; a.vy += fy; }
        if (!b.pin && !b.drag) { b.vx -= fx; b.vy -= fy; }
      });
      /* Seating from the Table tab, made literal: a part seated at the table
         is pulled close to Self, one at the side of the room sits further
         out, one in the adjoining room further still. "Who sits closest to
         you" becomes something you can see rather than only record. */
      var seats = opts.seats;
      if (seats) {
        var self = g.nodes[0];
        g.nodes.forEach(function (n) {
          if (n.self || n.pin || n.drag) return;
          var want = SEAT_RADIUS[seats[n.id]];
          if (!want) return;                       // not seated: left to the swarm
          var dx = n.x - self.x, dy = n.y - self.y;
          var d = Math.sqrt(dx * dx + dy * dy) || 1;
          var f = (d - want) * 0.02;
          n.vx -= f * dx / d; n.vy -= f * dy / d;
        });
      }

      g.nodes.forEach(function (n) {
        if (n.pin || n.drag) return;
        n.vx += (W / 2 - n.x) * 0.0015;
        n.vy += (H * .52 - n.y) * 0.0015;
        n.vx *= 0.82; n.vy *= 0.82;
        n.x += n.vx * heat; n.y += n.vy * heat;
        // keep the name under the circle on screen, not just the circle
        n.x = Math.max(52, Math.min(W - 52, n.x));
        n.y = Math.max(40, Math.min(H - 70, n.y));
      });
      heat *= 0.985;

      g.edges.forEach(function (e, i) {
        var a = g.nodes[e.a], b = g.nodes[e.b];
        var el = edgeEls[i];
        if (el.line.style.opacity === "0") return; // filtered out: skip the work
        el.line.setAttribute("x1", a.x); el.line.setAttribute("y1", a.y);
        el.line.setAttribute("x2", b.x); el.line.setAttribute("y2", b.y);
        el.hit.setAttribute("x1", a.x); el.hit.setAttribute("y1", a.y);
        el.hit.setAttribute("x2", b.x); el.hit.setAttribute("y2", b.y);
        if (el.label.style.display === "") {
          el.label.setAttribute("x", (a.x + b.x) / 2);
          el.label.setAttribute("y", (a.y + b.y) / 2 - 5);
        }
      });
      g.nodes.forEach(function (n, i) {
        nodeEls[i].setAttribute("transform", "translate(" + n.x + "," + n.y + ")");
      });

      sim.raf = requestAnimationFrame(step);
    }

    sim = { raf: 0 };
    step();
    return true;
  }

  function stop() {
    if (sim) { cancelAnimationFrame(sim.raf); sim = null; }
  }

  /* Re-apply the current selection and legend filter without rebuilding. */
  function refresh() {
    if (refreshFn) refreshFn();
  }

  window.IFS.graph = { render: render, stop: stop, refresh: refresh };
})();
