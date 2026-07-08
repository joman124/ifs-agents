/* Inner Table - the swarm map.
   A force-directed layout over SVG with mobile interactions:
   - drag nodes, pan the canvas, pinch to zoom
   - tap a part to highlight its relationships (labels appear on its edges,
     everything else dims) and surface an "open profile" card via onSelect
   Self sits pinned near the top, per the repo's mapping convention. */
(function () {
  "use strict";

  var sim = null;
  var clearLinkFn = null; // set by the active render; lets the UI cancel a half-drawn link

  function buildGraph(parts) {
    var nodes = [{ id: "self", label: "Self", self: true }];
    var idx = { self: 0 };
    parts.forEach(function (p) {
      idx[p.slug] = nodes.length;
      nodes.push({ id: p.slug, label: p.name, type: p.type });
    });
    var edges = [];
    var seen = {};
    parts.forEach(function (p) {
      (p.relationships || []).forEach(function (r) {
        if (!(r.part in idx)) return;
        var t = r.type;
        var a = p.slug, b = r.part;
        if (t === "protected-by") { t = "protects"; a = r.part; b = p.slug; }
        var key = t === "protects" ? "protects|" + a + "|" + b
                                   : t + "|" + [a, b].sort().join("|");
        if (seen[key]) return;
        seen[key] = 1;
        edges.push({ a: idx[a], b: idx[b], type: t });
      });
    });
    return { nodes: nodes, edges: edges };
  }

  function render(svg, parts, opts) {
    opts = opts || {};
    if (sim) { cancelAnimationFrame(sim.raf); sim = null; }
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

    var selected = null;   // node index or null
    var linkSource = null; // node index of the first tapped part in link mode

    function clearLinkSource() {
      if (linkSource != null && nodeEls[linkSource]) nodeEls[linkSource].classList.remove("linksrc");
      linkSource = null;
    }
    clearLinkFn = clearLinkSource;

    /* In link mode a tap picks the two endpoints instead of selecting. */
    function tapNode(ni) {
      var n = g.nodes[ni];
      if (opts.linkMode && opts.linkMode()) {
        if (n.self) {
          if (opts.onLinkHint) opts.onLinkHint("Draw links between parts - Self holds the whole map");
          return;
        }
        if (linkSource == null) {
          linkSource = ni;
          nodeEls[ni].classList.add("linksrc");
          if (opts.onLinkHint) opts.onLinkHint("Now tap the other part");
        } else if (linkSource === ni) {
          clearLinkSource();
        } else {
          var fromId = g.nodes[linkSource].id;
          clearLinkSource();
          if (opts.onLink) opts.onLink(fromId, n.id);
        }
        return;
      }
      select(ni);
    }

    var edgeEls = g.edges.map(function (e) {
      var line = document.createElementNS(NS, "line");
      line.setAttribute("class", "edge " + e.type);
      line.style.color = "var(--manager)";
      edgeLayer.appendChild(line);
      var label = document.createElementNS(NS, "text");
      label.setAttribute("class", "edgelabel");
      label.textContent = e.type.replace(/-/g, " ");
      label.style.display = "none"; // labels only for the selected part's edges
      edgeLayer.appendChild(label);
      return { line: line, label: label };
    });

    function applySelection() {
      g.edges.forEach(function (e, i) {
        var on = selected == null || e.a === selected || e.b === selected;
        edgeEls[i].line.style.opacity = on ? "1" : ".12";
        edgeEls[i].label.style.display =
          (selected != null && (e.a === selected || e.b === selected)) ? "" : "none";
      });
      g.nodes.forEach(function (n, i) {
        var neighbor = selected == null || i === selected || g.edges.some(function (e) {
          return (e.a === selected && e.b === i) || (e.b === selected && e.a === i);
        });
        nodeEls[i].style.opacity = neighbor ? "1" : ".22";
      });
      if (opts.onSelect) opts.onSelect(selected == null ? null : g.nodes[selected]);
    }

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
      initial.textContent = n.self ? "Self" : (n.label || "?").trim().charAt(0).toUpperCase();
      var name = document.createElementNS(NS, "text");
      name.setAttribute("dy", r + 16);
      name.setAttribute("font-size", "11");
      name.textContent = n.self ? "" : n.label;
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
    svg.addEventListener("pointerdown", function (ev) {
      try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
      pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY, sx: ev.clientX, sy: ev.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), view: { x: view.x, y: view.y, w: view.w, h: view.h } };
      }
    });
    svg.addEventListener("pointermove", function (ev) {
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
        clearLinkSource(); // background tap cancels a half-drawn link
      }
      delete pointers[ev.pointerId];
      if (Object.keys(pointers).length < 2) pinchStart = null;
    };
    svg.addEventListener("pointerup", endPointer);
    svg.addEventListener("pointercancel", endPointer);

    // desktop nicety: wheel to zoom
    svg.addEventListener("wheel", function (ev) {
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
        var a = g.nodes[e.a], b = g.nodes[e.b];
        var dx = b.x - a.x, dy = b.y - a.y;
        var d = Math.sqrt(dx * dx + dy * dy) || 1;
        var want = 130;
        var f = (d - want) * 0.012;
        var fx = f * dx / d, fy = f * dy / d;
        if (!a.pin && !a.drag) { a.vx += fx; a.vy += fy; }
        if (!b.pin && !b.drag) { b.vx -= fx; b.vy -= fy; }
      });
      g.nodes.forEach(function (n) {
        if (n.pin || n.drag) return;
        n.vx += (W / 2 - n.x) * 0.0015;
        n.vy += (H * .52 - n.y) * 0.0015;
        n.vx *= 0.82; n.vy *= 0.82;
        n.x += n.vx * heat; n.y += n.vy * heat;
        n.x = Math.max(34, Math.min(W - 34, n.x));
        n.y = Math.max(40, Math.min(H - 60, n.y));
      });
      heat *= 0.985;

      g.edges.forEach(function (e, i) {
        var a = g.nodes[e.a], b = g.nodes[e.b];
        var el = edgeEls[i];
        el.line.setAttribute("x1", a.x); el.line.setAttribute("y1", a.y);
        el.line.setAttribute("x2", b.x); el.line.setAttribute("y2", b.y);
        el.label.setAttribute("x", (a.x + b.x) / 2);
        el.label.setAttribute("y", (a.y + b.y) / 2 - 5);
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

  function clearLink() {
    if (clearLinkFn) clearLinkFn();
  }

  window.IFS.graph = { render: render, stop: stop, clearLink: clearLink };
})();
