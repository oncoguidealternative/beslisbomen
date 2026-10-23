/* Layout-engine voor zorgpaden en beslisbomen (zie docs/layout-engine.md).
   - Raakt geen DOM aan en wijzigt nooit de invoer: resolve() geeft een nieuwe graph terug.
   - Een graph zonder layout-velden (alleen { x, y } met viewBox, nodeSize en edge-points) komt ongewijzigd terug
     (hetzelfde object): bestaande zorgpaden veranderen dus niet.

   Drie manieren om een node te plaatsen (prioriteit van hoog naar laag):
     1. { x, y }          absolute posities in SVG-eenheden (pixels)
     2. { gridX, gridY }  posities in rasterhokjes; 1 hokje = layout.unit pixels
     3. relaties:         below | rightOf | childOf | recommendationOf  (verwijzen naar de id van een andere node)

   Alle afstanden staan in rasterhokjes. Een afstand is de vrije ruimte tussen de randen van twee blokken.
   Blokken naast elkaar staan op elk niveau minimaal horizontalGap uit elkaar; onderbomen schuiven zo dicht mogelijk naar
   elkaar toe en de ouder staat midden boven zijn eerste en laatste kind. */
const LayoutEngine = (function () {
  'use strict';

  var DEFAULTS = {
    unit: 25,              // pixels per rasterhokje (alleen als nodeSize ontbreekt of layout.unit ontbreekt)
    blockWidth: 8,
    blockHeight: 4,
    horizontalGap: 1,      // tussen blokken naast elkaar
    titleGap: 2,           // onder een titel
    itemGap: 4,            // onder een data-item (en onder een verwijzing)
    recommendationGap: 2,  // onder een aanbeveling (bijvoorbeeld naar de vervolgboom)
    margin: 2              // rondom de inhoud als de viewBox automatisch wordt bepaald
  };
  var NUMERIC_KEYS = ['unit', 'blockWidth', 'blockHeight', 'horizontalGap', 'titleGap', 'itemGap', 'recommendationGap', 'margin'];
  var RELATIONS = ['childOf', 'recommendationOf', 'below', 'rightOf'];   // volgorde = prioriteit bij meerdere relaties
  var cache = typeof WeakMap === 'function' ? new WeakMap() : null;

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  function round(v) { return Math.round(v * 1000) / 1000; }

  /* ---------- nodetypes ---------- */

  // De vier layout-rollen en hun bestaande renderer-types.
  //   title (beslisboomtitel) = root | start      data-item = criterion
  //   aanbeveling = outcome                        verwijzing naar volgende beslisboom = link
  function roleOf(type) {
    if (type === 'title' || type === 'root' || type === 'start') return 'title';
    if (type === 'recommendation' || type === 'outcome') return 'recommendation';
    if (type === 'reference' || type === 'link') return 'reference';
    return 'dataItem';     // dataItem, item, criterion, decision en onbekend/ontbrekend
  }

  /* Zet alias-types (title, dataItem, item, recommendation, reference) om naar de bestaande types, in alle
     graphs van een zorgpad, zodat renderer, validator en route-engine dezelfde types zien.
     Vult ontbrekende nodes/edges-arrays aan. Geeft hetzelfde object terug als er niets te doen is. */
  function normalize(zorgpad) {
    if (!isObj(zorgpad)) return zorgpad;
    var changed = false;
    var out = Object.assign({}, zorgpad);
    if (isObj(zorgpad.overview)) {
      var o = normalizeGraph(zorgpad.overview, 'overview');
      if (o !== zorgpad.overview) { out.overview = o; changed = true; }
    }
    if (isObj(zorgpad.trees)) {
      var trees = {}, treesChanged = false;
      Object.keys(zorgpad.trees).forEach(function (id) {
        var g = zorgpad.trees[id];
        if (isObj(g) && Array.isArray(g.nodes)) {
          var n = normalizeGraph(g, 'tree');
          trees[id] = n;
          if (n !== g) treesChanged = true;
        } else {
          trees[id] = g;
        }
      });
      if (treesChanged) { out.trees = trees; changed = true; }
    }
    return changed ? out : zorgpad;
  }

  function normalizeGraph(graph, kind) {
    var changed = false;
    var nodes = graph.nodes.map(function (node) {
      var t = node.type, patch = null;
      if (t === 'title') {
        // Titel van een beslisboom: blauwe pil met "terug naar overzicht". Titel van het overzicht: gewone startpil.
        patch = kind === 'tree'
          ? { type: 'root', tone: 'blue', icon: 'minus-light', to: '', rx: 30 }
          : { type: 'start' };
      } else if (t === 'dataItem' || t === 'item') {
        patch = { type: 'criterion' };
      } else if (t === 'recommendation') {
        patch = { type: 'outcome' };
      } else if (t === 'reference') {
        patch = { type: 'link', icon: 'down' };
      }
      if (!patch) return node;
      var copy = Object.assign({}, node);
      Object.keys(patch).forEach(function (k) {
        if (k === 'type' || copy[k] === undefined) copy[k] = patch[k];   // expliciete velden van de auteur winnen
      });
      changed = true;
      return copy;
    });
    var needsEdges = !Array.isArray(graph.edges);
    if (!changed && !needsEdges) return graph;
    return Object.assign({}, graph, { nodes: nodes, edges: needsEdges ? [] : graph.edges });
  }

  /* ---------- wanneer is layout nodig? ---------- */

  function relationOf(node) {
    for (var i = 0; i < RELATIONS.length; i++) {
      var key = RELATIONS[i];
      if (node[key] !== undefined && node[key] !== null) return { kind: key, target: node[key] };
    }
    return null;
  }

  function needsLayout(graph) {
    if (!graph || !Array.isArray(graph.nodes)) return false;
    if (isObj(graph.layout)) return true;
    if (!Array.isArray(graph.viewBox) || !Array.isArray(graph.nodeSize)) return true;
    var i;
    for (i = 0; i < graph.nodes.length; i++) {
      var n = graph.nodes[i];
      if (n.gridX !== undefined || n.gridY !== undefined || relationOf(n)) return true;
    }
    var edges = Array.isArray(graph.edges) ? graph.edges : [];
    for (i = 0; i < edges.length; i++) {
      var e = edges[i];
      if (!Array.isArray(e.points) && e.from !== undefined && e.to !== undefined) return true;
    }
    return false;
  }

  /* ---------- hoofdberekening ---------- */

  function compute(graph) {
    var issues = [];
    function warn(message) { issues.push(message); }

    // -- configuratie en eenheden --
    var given = isObj(graph.layout) ? graph.layout : {};
    var cfg = Object.assign({}, DEFAULTS);
    NUMERIC_KEYS.forEach(function (k) {
      if (given[k] === undefined) return;
      if (isNum(given[k]) && given[k] >= 0 && (k !== 'unit' && k !== 'blockWidth' && k !== 'blockHeight' || given[k] > 0)) cfg[k] = given[k];
      else warn('layout.' + k + ' moet een getal zijn (' + JSON.stringify(given[k]) + ' genegeerd).');
    });
    var nodeSize = (Array.isArray(graph.nodeSize) && isNum(graph.nodeSize[0]) && isNum(graph.nodeSize[1])) ? graph.nodeSize.slice() : null;
    var unit = (isNum(given.unit) && given.unit > 0) ? given.unit : (nodeSize ? nodeSize[0] / cfg.blockWidth : DEFAULTS.unit);
    if (!nodeSize) nodeSize = [round(cfg.blockWidth * unit), round(cfg.blockHeight * unit)];

    // -- nodes kopiëren (de invoer wordt nooit gewijzigd) --
    var nodes = [], byId = {};
    graph.nodes.forEach(function (n) {
      var c = Object.assign({}, n);
      if (isNum(n.width) && !isNum(n.w)) c.w = round(n.width * unit);
      if (isNum(n.height) && !isNum(n.h)) c.h = round(n.height * unit);
      nodes.push(c);
      if (byId[c.id] === undefined) byId[c.id] = c;
      else warn('Dubbele node-id "' + c.id + '"; de eerste wordt gebruikt voor relaties.');
    });
    function wOf(n) { return isNum(n.w) ? n.w : nodeSize[0]; }
    function hOf(n) { return isNum(n.h) ? n.h : nodeSize[1]; }

    // -- ankers: absolute posities --
    var placed = {};          // id -> true
    var rel = {};             // id -> {kind, target} (alleen voor nodes zonder eigen positie)
    nodes.forEach(function (n) {
      var r = relationOf(n);
      var extra = RELATIONS.filter(function (k) { return n[k] !== undefined && n[k] !== null; });
      if (extra.length > 1) warn('Node "' + n.id + '" heeft meerdere relaties (' + extra.join(', ') + '); alleen "' + extra[0] + '" wordt gebruikt.');
      if (isNum(n.x) && isNum(n.y)) {
        placed[n.id] = true;
        if (r) warn('Node "' + n.id + '" heeft { x, y } en een relatie ("' + r.kind + '"); de relatie wordt genegeerd.');
      } else if (isNum(n.gridX) && isNum(n.gridY)) {
        n.x = round(n.gridX * unit);
        n.y = round(n.gridY * unit);
        placed[n.id] = true;
        if (r) warn('Node "' + n.id + '" heeft { gridX, gridY } en een relatie ("' + r.kind + '"); de relatie wordt genegeerd.');
      } else {
        if (isNum(n.x) || isNum(n.y) || isNum(n.gridX) || isNum(n.gridY)) {
          warn('Node "' + n.id + '" heeft maar één coördinaat; geef x én y (of gridX én gridY) op.');
        }
        if (r) rel[n.id] = r;
      }
    });

    // -- kinderrijen (childOf en recommendationOf) --
    var children = {};        // parentId -> [node]
    Object.keys(rel).forEach(function (id) {
      var r = rel[id];
      if (r.kind !== 'childOf' && r.kind !== 'recommendationOf') return;
      (children[r.target] = children[r.target] || []).push(byId[id]);
    });
    Object.keys(children).forEach(function (pid) {
      var list = children[pid];
      if (list.some(function (c) { return isNum(c.order); })) {
        // stabiel sorteren op "order"; nodes zonder order behouden hun volgorde achteraan
        var idx = {};
        list.forEach(function (c, i) { idx[c.id] = i; });
        list.sort(function (a, b) {
          var ao = isNum(a.order) ? a.order : Infinity, bo = isNum(b.order) ? b.order : Infinity;
          return ao === bo ? idx[a.id] - idx[b.id] : ao - bo;
        });
      }
    });

    // Standaardtype voor nodes die via een relatie worden geplaatst en zelf geen type hebben.
    nodes.forEach(function (n) {
      if (n.type !== undefined || !rel[n.id]) return;
      n.type = rel[n.id].kind === 'recommendationOf' ? 'outcome' : 'criterion';
    });

    var hgap = cfg.horizontalGap * unit;

    // Contouren per onderboom (links/rechts-rand per niveau, relatief aan het midden van de node; niveau 0 = de node zelf).
    // Onderbomen worden per niveau zo dicht mogelijk naast elkaar gezet, met minimaal horizontalGap ertussen,
    // en de ouder komt precies midden boven zijn eerste en laatste kind. Het resultaat is per node onafhankelijk
    // van de absolute positie, dus ook bruikbaar voor ouders die via x/y, gridX/gridY of een andere relatie staan.
    var contourMemo = {};
    function contour(id, guard) {
      if (contourMemo[id]) return contourMemo[id];
      var node = byId[id], half = wOf(node) / 2;
      if (guard[id]) return { L: [-half], R: [half], rel: [] };      // cyclus: als blad behandelen
      guard[id] = true;
      var kids = children[id] || [], L = [-half], R = [half], rel = [];
      if (kids.length) {
        var accL = [], accR = [];
        kids.forEach(function (k, i) {
          var ck = contour(k.id, guard), off = 0, d;
          if (i > 0) {
            off = -Infinity;
            for (d = 0; d < Math.min(accR.length, ck.L.length); d++) off = Math.max(off, accR[d] - ck.L[d] + hgap);
          }
          rel.push(off);
          for (d = 0; d < ck.L.length; d++) {
            var l = ck.L[d] + off, r = ck.R[d] + off;
            if (d < accL.length) { accL[d] = Math.min(accL[d], l); accR[d] = Math.max(accR[d], r); }
            else { accL.push(l); accR.push(r); }
          }
        });
        var mid = (rel[0] + rel[rel.length - 1]) / 2;
        rel = rel.map(function (v) { return v - mid; });
        for (var d2 = 0; d2 < accL.length; d2++) { L.push(accL[d2] - mid); R.push(accR[d2] - mid); }
      }
      guard[id] = false;
      contourMemo[id] = { L: L, R: R, rel: rel };
      return contourMemo[id];
    }

    function gapAfter(parent, child) {
      if (isNum(child.gap)) return child.gap;
      var role = roleOf(parent.type);
      if (role === 'title') return cfg.titleGap;
      if (role === 'recommendation') return cfg.recommendationGap;
      return cfg.itemGap;
    }

    // -- plaatsen --
    var anyPlaced = Object.keys(placed).length > 0;
    if (!anyPlaced) {
      for (var oi = 0; oi < nodes.length; oi++) {
        if (!rel[nodes[oi].id]) { nodes[oi].x = 0; nodes[oi].y = 0; placed[nodes[oi].id] = true; break; }
      }
    }
    var progress = true;
    while (progress) {
      progress = false;
      // rijen met kinderen onder een geplaatste ouder
      Object.keys(children).forEach(function (pid) {
        var parent = byId[pid];
        if (!parent || !placed[pid]) return;
        var todo = children[pid].filter(function (c) { return !placed[c.id]; });
        if (todo.length === 0) return;
        var rowGap = 0;
        todo.forEach(function (c) { rowGap = Math.max(rowGap, gapAfter(parent, c)); });
        var rowY = parent.y + hOf(parent) + rowGap * unit;
        var pcx = parent.x + wOf(parent) / 2;
        var rels = contour(pid, {}).rel;
        children[pid].forEach(function (c, i) {
          if (placed[c.id]) return;
          c.x = round(pcx + rels[i] - wOf(c) / 2);
          c.y = round(rowY);
          placed[c.id] = true;
        });
        progress = true;
      });
      // below en rightOf
      nodes.forEach(function (n) {
        var r = rel[n.id];
        if (placed[n.id] || !r || (r.kind !== 'below' && r.kind !== 'rightOf')) return;
        var t = byId[r.target];
        if (!t || !placed[t.id]) return;
        if (r.kind === 'below') {
          n.x = round(t.x + wOf(t) / 2 - wOf(n) / 2);
          n.y = round(t.y + hOf(t) + gapAfter(t, n) * unit);
        } else {
          n.x = round(t.x + wOf(t) + (isNum(n.gap) ? n.gap : cfg.horizontalGap) * unit);
          n.y = round(t.y + hOf(t) / 2 - hOf(n) / 2);
        }
        placed[n.id] = true;
        progress = true;
      });
    }
    var fallback = {};
    nodes.forEach(function (n) {
      if (placed[n.id]) return;
      fallback[n.id] = true;
      var r = rel[n.id];
      if (r && byId[r.target] === undefined) warn('Node "' + n.id + '": ' + r.kind + ' verwijst naar onbekende node "' + r.target + '".');
      else if (r) warn('Node "' + n.id + '" kon niet worden geplaatst (cyclische of onopgeloste relatie via "' + r.target + '").');
      else warn('Node "' + n.id + '" heeft geen positie en geen relatie.');
      n.x = 0; n.y = 0;
    });

    // -- overlap controleren --
    var overlaps = 0;
    for (var a = 0; a < nodes.length && overlaps < 20; a++) {
      for (var b = a + 1; b < nodes.length && overlaps < 20; b++) {
        var A = nodes[a], B = nodes[b];
        if (fallback[A.id] || fallback[B.id]) continue;      // al gemeld als "niet geplaatst"
        if (A.x < B.x + wOf(B) - 0.01 && B.x < A.x + wOf(A) - 0.01 && A.y < B.y + hOf(B) - 0.01 && B.y < A.y + hOf(A) - 0.01) {
          warn('Nodes "' + A.id + '" en "' + B.id + '" overlappen.');
          overlaps++;
        }
      }
    }

    // -- viewBox: expliciet houden, anders afleiden uit de inhoud (met marge) --
    var edgesIn = Array.isArray(graph.edges) ? graph.edges : [];
    var viewBox = Array.isArray(graph.viewBox) ? graph.viewBox.slice() : null;
    var shiftX = 0, shiftY = 0;
    if (!viewBox) {
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      nodes.forEach(function (n) {
        minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + wOf(n)); maxY = Math.max(maxY, n.y + hOf(n));
      });
      edgesIn.forEach(function (e) {
        (Array.isArray(e.points) ? e.points : []).forEach(function (p) {
          minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]);
        });
      });
      var m = cfg.margin * unit;
      if (!isFinite(minX)) { minX = 0; minY = 0; maxX = nodeSize[0]; maxY = nodeSize[1]; }
      shiftX = round(m - minX);
      shiftY = round(m - minY);
      viewBox = [round(maxX - minX + 2 * m), round(maxY - minY + 2 * m)];
    }
    if (shiftX !== 0 || shiftY !== 0) {
      nodes.forEach(function (n) { n.x = round(n.x + shiftX); n.y = round(n.y + shiftY); });
    }

    // -- edges: expliciete points blijven staan; ontbrekende worden automatisch gerouteerd --
    function shiftPoints(list) { return list.map(function (p) { return [round(p[0] + shiftX), round(p[1] + shiftY)]; }); }
    function rectOf(n) { return { l: n.x, t: n.y, r: n.x + wOf(n), b: n.y + hOf(n), w: wOf(n), h: hOf(n), cx: n.x + wOf(n) / 2, cy: n.y + hOf(n) / 2 }; }

    // Orthogonale route van node A naar node B. Geeft {points, dot} (dot = midden van het langste stuk).
    function route(A, B) {
      var a = rectOf(A), b = rectOf(B), pts;
      if (b.t >= a.b - 0.01) {                                   // B ligt onder A
        var pad = a.w * 0.15;
        if (Math.abs(b.cx - a.cx) < 0.5) pts = [[a.cx, a.b], [b.cx, b.t]];
        else if (b.cx >= a.l + pad && b.cx <= a.r - pad) pts = [[b.cx, a.b], [b.cx, b.t]];
        else if (b.cx < a.l) pts = [[a.l, a.cy], [b.cx, a.cy], [b.cx, b.t]];
        else if (b.cx > a.r) pts = [[a.r, a.cy], [b.cx, a.cy], [b.cx, b.t]];
        else { var my = (a.b + b.t) / 2; pts = [[a.cx, a.b], [a.cx, my], [b.cx, my], [b.cx, b.t]]; }
      } else if (b.l >= a.r - 0.01) {                            // B ligt rechts van A
        pts = Math.abs(b.cy - a.cy) < 0.5 ? [[a.r, a.cy], [b.l, b.cy]] : [[a.r, a.cy], [(a.r + b.l) / 2, a.cy], [(a.r + b.l) / 2, b.cy], [b.l, b.cy]];
      } else if (b.r <= a.l + 0.01) {                            // B ligt links van A
        pts = Math.abs(b.cy - a.cy) < 0.5 ? [[a.l, a.cy], [b.r, b.cy]] : [[a.l, a.cy], [(a.l + b.r) / 2, a.cy], [(a.l + b.r) / 2, b.cy], [b.r, b.cy]];
      } else {                                                   // B ligt boven A of overlapt
        var my2 = (a.t + b.b) / 2;
        pts = [[a.cx, a.t], [a.cx, my2], [b.cx, my2], [b.cx, b.b]];
      }
      pts = pts.map(function (p) { return [round(p[0]), round(p[1])]; });
      var best = 0, dot = null;
      for (var i = 0; i < pts.length - 1; i++) {
        var len = Math.abs(pts[i + 1][0] - pts[i][0]) + Math.abs(pts[i + 1][1] - pts[i][1]);
        if (len > best) { best = len; dot = [round((pts[i][0] + pts[i + 1][0]) / 2), round((pts[i][1] + pts[i + 1][1]) / 2)]; }
      }
      return { points: pts, dot: dot };
    }

    var edges = edgesIn.map(function (e) {
      var c = Object.assign({}, e);
      if (Array.isArray(e.points) && e.points.length >= 2) {
        if (shiftX !== 0 || shiftY !== 0) {
          c.points = shiftPoints(e.points);
          if (Array.isArray(e.selectedPoints)) c.selectedPoints = shiftPoints(e.selectedPoints);
          if (Array.isArray(e.dot)) c.dot = [round(e.dot[0] + shiftX), round(e.dot[1] + shiftY)];
        }
        return c;
      }
      if (e.from === undefined || e.to === undefined) {
        if (e.from !== undefined || e.to !== undefined || e.id !== undefined) warn('Edge "' + (e.id || '?') + '" heeft geen points en geen from/to; wordt niet getekend.');
        return c;
      }
      if (byId[e.from] === undefined || byId[e.to] === undefined) {
        warn('Edge "' + (e.id || (e.from + '→' + e.to)) + '" verwijst naar een onbekende node; wordt niet getekend.');
        return c;
      }
      var r = route(byId[e.from], byId[e.to]);
      c.points = r.points;
      if (c.arrow === undefined) c.arrow = true;
      if (c.label !== undefined && c.dot === undefined) c.dot = r.dot;
      return c;
    });

    // Impliciete verbindingen voor below, childOf en recommendationOf (tenzij er al een expliciete edge is of connector: false).
    var explicitPair = {};
    edgesIn.forEach(function (e) { if (e.from !== undefined && e.to !== undefined) explicitPair[e.from + '\u0000' + e.to] = true; });
    nodes.forEach(function (n) {
      var r = rel[n.id];
      if (!r || r.kind === 'rightOf' || n.connector === false || byId[r.target] === undefined) return;
      if (explicitPair[r.target + '\u0000' + n.id]) return;
      var rt = route(byId[r.target], n);
      edges.push({ from: r.target, to: n.id, points: rt.points, arrow: true, implicit: true });
    });

    // Edges die niet getekend kunnen worden (geen points en niet te routeren) blijven buiten de getekende graph,
    // zodat een fout in de data nooit de hele boom laat vastlopen.
    edges = edges.filter(function (e) { return Array.isArray(e.points) && e.points.length >= 2; });

    var out = Object.assign({}, graph, { nodes: nodes, edges: edges, viewBox: viewBox, nodeSize: nodeSize });
    return { graph: out, issues: issues, unit: unit };
  }

  /* ---------- publieke functies ---------- */

  /* Geeft {graph, issues}; de graph is de invoer zelf als er geen layout nodig is. Resultaat wordt per graph onthouden. */
  function layout(graph) {
    if (!graph || !Array.isArray(graph.nodes)) return { graph: graph, issues: [] };
    if (cache && cache.has(graph)) return cache.get(graph);
    var result = needsLayout(graph) ? compute(graph) : { graph: graph, issues: [] };
    if (cache) cache.set(graph, result);
    return result;
  }

  var warned = cache ? new WeakMap() : null;

  /* De graph met alle posities, afmetingen en edge-points ingevuld. Meldingen gaan één keer naar de console.
     options.silent = true onderdrukt de console. */
  function resolve(graph, options) {
    var result = layout(graph);
    if (result.issues.length && !(options && options.silent) && warned && !warned.has(graph)) {
      warned.set(graph, true);
      result.issues.forEach(function (m) { console.warn('[LayoutEngine]\n' + m); });
    }
    return result.graph;
  }

  return {
    DEFAULTS: DEFAULTS,
    needsLayout: needsLayout,
    layout: layout,
    resolve: resolve,
    normalize: normalize,
    roleOf: roleOf
  };
})();
