/* Inner Table - the swarm map.
   A small force-directed layout over SVG with pointer-drag support.
   Self sits pinned near the top, per the repo's mapping convention. */
(function () {
  "use strict";
  var S = window.IFS.schema;

  var sim = null;

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
        // normalize protected-by to a protects edge from the other side
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

  function render(svg, parts) {
    if (sim) { cancelAnimationFrame(sim.raf); sim = null; }
    svg.innerHTML = "";
    var W = svg.clientWidth || 360, H = svg.clientHeight || 560;
    var g = buildGraph(parts);
    if (g.nodes.length <= 1) return false;

    var NS = "http://www.w3.org/2000/svg";
    var defs = document.createElementNS(NS, "defs");
    defs.innerHTML = '<marker id="arrow" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" opacity=".7"/></marker>';
    svg.appendChild(defs);
    var edgeLayer = document.createElementNS(NS, "g");
    var nodeLayer = document.createElementNS(NS, "g");
    svg.appendChild(edgeLayer);
    svg.appendChild(nodeLayer);

    var typeColor = { manager: "var(--manager)", firefighter: "var(--firefighter)", exile: "var(--exile)", unknown: "var(--unknown)" };

    // seed positions: Self up top, parts in a ring below
    g.nodes.forEach(function (n, i) {
      if (n.self) { n.x = W / 2; n.y = Math.min(90, H * .16); n.pin = true; }
      else {
        var ang = (i / (g.nodes.length - 1)) * Math.PI * 2;
        n.x = W / 2 + Math.cos(ang) * Math.min(W, H) * .26;
        n.y = H * .55 + Math.sin(ang) * Math.min(W, H) * .22;
      }
      n.vx = 0; n.vy = 0;
    });

    var edgeEls = g.edges.map(function (e) {
      var line = document.createElementNS(NS, "line");
      line.setAttribute("class", "edge " + e.type);
      line.style.color = "var(--manager)";
      edgeLayer.appendChild(line);
      var label = document.createElementNS(NS, "text");
      label.setAttribute("class", "edgelabel");
      label.textContent = e.type.replace(/-/g, " ");
      edgeLayer.appendChild(label);
      return { line: line, label: label };
    });

    var nodeEls = g.nodes.map(function (n) {
      var grp = document.createElementNS(NS, "g");
      grp.setAttribute("class", "node" + (n.self ? " self" : ""));
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

      // pointer drag
      grp.addEventListener("pointerdown", function (ev) {
        ev.preventDefault();
        grp.setPointerCapture(ev.pointerId);
        n.drag = true;
        var move = function (mv) {
          var rect = svg.getBoundingClientRect();
          n.x = mv.clientX - rect.left; n.y = mv.clientY - rect.top;
          n.vx = 0; n.vy = 0;
          kick();
        };
        var up = function () {
          n.drag = false;
          grp.removeEventListener("pointermove", move);
          grp.removeEventListener("pointerup", up);
          grp.removeEventListener("pointercancel", up);
        };
        grp.addEventListener("pointermove", move);
        grp.addEventListener("pointerup", up);
        grp.addEventListener("pointercancel", up);
      });
      return grp;
    });

    var heat = 1;
    function kick() { heat = Math.max(heat, .5); }

    function step() {
      // repulsion
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
      // springs
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
      // gentle gravity toward center column + integrate
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

      // paint
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

  window.IFS.graph = { render: render, stop: stop };
})();
