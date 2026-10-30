/* Generieke SVG-renderer voor zorgpaden en beslisbomen.
   De renderer tekent uitsluitend: hij beheert geen eigen applicatiestatus.
   Status (zoom, huidige boom, ...) wordt gelezen uit state.js via getState().
   Bevat geen tumor- of medische inhoud; alles komt uit de zorgpaddata. */
const Renderer = (function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  /* Posities, afmetingen en edge-points uit de layout-engine (js/layout-engine.js). Een graph zonder
     layout-velden komt ongewijzigd terug; ontbreekt de engine, dan werkt de renderer zoals voorheen. */
  function laidOut(graph) {
    return (graph && typeof LayoutEngine !== 'undefined') ? LayoutEngine.resolve(graph) : graph;
  }

  var els = null; // alleen DOM-verwijzingen: {main, svg, message}
  var onNavigate = function () {}; // callbacks van de aanroeper, geen applicatiestatus
  var onInteract = function () {};
  var onSelect = function () {}; // een klik op een connector (edge-label) van een interactief criterium
  var onSubtree = function () {}; // een klik op een node met een hulpbeslisboom (subtree)
  var onInfo = null;              // een klik op de titel van een zorgpad of beslisboom (bronvermelding); null = uit
  var onTake = function () {};    // activeren van een bereikte uitkomst in een hulpbeslisboom

  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function wrap(text, max) {
    var words = text.split(' '), lines = [], cur = '';
    words.forEach(function (w) {
      if ((cur + ' ' + w).trim().length > max) { lines.push(cur); cur = w; }
      else cur = (cur + ' ' + w).trim();
    });
    if (cur) lines.push(cur);
    return lines;
  }

  function setRich(t, str) {
    var re = /\{a:([^|}]*)\|([^}]*)\}/g, last = 0, m, has = false;
    while ((m = re.exec(str))) {
      has = true;
      if (m.index > last) t.appendChild(document.createTextNode(str.slice(last, m.index)));
      var sp = el('tspan', {'class': 'lnk'});
      sp.textContent = m[1];
      if (m[2]) {
        var a = el('a', {href: m[2], target: '_blank', rel: 'noopener'});
        a.appendChild(sp);
        t.appendChild(a);
      } else {
        t.appendChild(sp);
      }
      last = re.lastIndex;
    }
    if (!has) { t.textContent = str; return; }
    if (last < str.length) t.appendChild(document.createTextNode(str.slice(last)));
  }

  /* Past de viewport uit de state toe op de getekende SVG.
     Native diagrammen: zoom en pan worden als transform op de inhoudsgroep gezet (in SVG-eenheden = px).
     Andere diagrammen worden niet gezoomd of verschoven. De waarden komen uitsluitend uit state.js. */
  function applyViewport() {
    var vp = els.svg.querySelector('.vp');
    if (!vp) return;
    if (els.main.classList.contains('is-native')) {
      var v = getState().viewport;
      vp.setAttribute('transform', 'translate(' + v.panX + ' ' + v.panY + ') scale(' + v.zoom + ')');
    } else {
      vp.removeAttribute('transform');
    }
  }

  /* Berekent de werkelijke grenzen van alle nodes en edges.
     Ongebruikte ruimte in de viewBox telt daardoor niet mee. */
  function graphBounds(graph) {
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;

    var nodeWidth = graph.nodeSize[0];
    var nodeHeight = graph.nodeSize[1];

    graph.nodes.forEach(function (node) {
      var height = node.h || nodeHeight;
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + (node.w || nodeWidth));
      maxY = Math.max(maxY, node.y + height);
    });

    graph.edges.forEach(function (edge) {
      (edge.points || []).forEach(function (point) {
        minX = Math.min(minX, point[0]);
        minY = Math.min(minY, point[1]);
        maxX = Math.max(maxX, point[0]);
        maxY = Math.max(maxY, point[1]);
      });

      if (edge.dot) {
        minX = Math.min(minX, edge.dot[0]);
        minY = Math.min(minY, edge.dot[1]);
        maxX = Math.max(maxX, edge.dot[0]);
        maxY = Math.max(maxY, edge.dot[1]);
      }
    });

    if (!Number.isFinite(minX)) {
      return {
        x: 0,
        y: 0,
        width: graph.viewBox[0],
        height: graph.viewBox[1]
      };
    }

    return {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY)
    };
  }

  /* Berekent voor desktop de optimale beginzoom en begin-pan.
     De werkelijke boom wordt zo groot mogelijk en gecentreerd weergegeven. */
  function fitViewport(graph, stageWidth, stageHeight) {
    graph = laidOut(graph);
    var bounds = graphBounds(graph);
    var padding = 48;

    var availableWidth = Math.max(1, stageWidth - padding * 2);
    var availableHeight = Math.max(1, stageHeight - padding * 2);

    var zoomX = availableWidth / bounds.width;
    var zoomY = availableHeight / bounds.height;
    var zoom = Math.min(zoomX, zoomY);

    /* Desktop-first: groter dan 100% is toegestaan. */
    zoom = Math.max(0.75, Math.min(1.75, zoom));

    var panX =
      stageWidth / 2 -
      (bounds.x + bounds.width / 2) * zoom;

    var panY =
      stageHeight / 2 -
      (bounds.y + bounds.height / 2) * zoom;

    /* Past de boom niet in de hoogte, dan begint de weergave bovenaan: daar staan de titel (met de
       bronvermelding) en de eerste stap. Centreren zou juist die bovenkant buiten beeld laten vallen. */
    if (bounds.height * zoom > availableHeight) {
      panY = padding - bounds.y * zoom;
    }

    return {
      zoom: zoom,
      panX: panX,
      panY: panY,
      bounds: bounds
    };
  }

  /* Alle bomen die door een node als hulpbeslisboom worden aangewezen: { boom-id: titel }.
     De titel is het label van de root van die boom, anders het label van de aanwijzende node. */
  function subtreeLabels(zorgpad) {
    var out = {};
    var trees = (zorgpad && zorgpad.trees) || {};
    if (typeof GraphState === 'undefined') return out;
    Object.keys(trees).forEach(function (treeId) {
      var t = trees[treeId];
      if (!t || !Array.isArray(t.nodes)) return;
      t.nodes.forEach(function (n) {
        var ref = GraphState.subtreeOf(n);
        if (!ref || Object.prototype.hasOwnProperty.call(out, ref.tree)) return;
        var target = trees[ref.tree];
        if (target && target.same) target = trees[target.same];
        var root = target && Array.isArray(target.nodes)
          ? target.nodes.filter(function (x) { return x.type === 'root' || x.type === 'title'; })[0] : null;
        out[ref.tree] = (root && root.label) || n.label || ref.tree;
      });
    });
    return out;
  }

  /* Bepaalt wat getoond moet worden voor een boom-id (zonder iets te tekenen).
     Geeft {treeId, graph, label}; graph is null als de boom nog niet is toegevoegd.
     Een onbekende id valt terug op het overzicht (treeId = null). */
  function resolve(zorgpad, id) {
    var node = zorgpad.overview.nodes.filter(function (x) { return x.id === id && x.drill; })[0];
    if (!node) {
      // Elke andere boom in "trees" is ook te openen (een verwijzing "to" mag naar een boom wijzen die niet in het
      // overzicht staat). Een hulpbeslisboom (door een node met subtree aangewezen) krijgt daarnaast de vlag subtree.
      var helper = subtreeLabels(zorgpad);
      var trees = zorgpad.trees || {};
      if (Object.prototype.hasOwnProperty.call(trees, id) && trees[id]) {
        var sub = trees[id];
        if (sub.same) sub = trees[sub.same];
        if (sub && Array.isArray(sub.nodes)) {
          var isHelper = Object.prototype.hasOwnProperty.call(helper, id);
          var rootNode = sub.nodes.filter(function (x) { return x.type === 'root' || x.type === 'title'; })[0];
          return {treeId: id, graph: sub, label: isHelper ? helper[id] : ((rootNode && rootNode.label) || id), subtree: isHelper};
        }
      }
      return {treeId: null, graph: zorgpad.overview, label: zorgpad.titel};
    }
    var tree = zorgpad.trees && zorgpad.trees[id];
    if (tree && tree.same) tree = zorgpad.trees[tree.same];
    return {treeId: id, graph: tree || null, label: node.label};
  }

  function render(graph, label) {
    var source = graph; // oorspronkelijke graph: bevat from/value van de edges
    graph = laidOut(graph);
    var svg = els.svg;
    var size = graph.nodeSize, s = size[0] / 179, maxChars = graph.wrap || 24;
    svg.innerHTML = '';
    if (graph.native) {
      // Native: geen viewBox; 1 SVG-eenheid = 1 px, zoom en pan staan op de inhoudsgroep.
      svg.removeAttribute('viewBox');
    } else {
      svg.setAttribute('viewBox', '0 0 ' + graph.viewBox[0] + ' ' + graph.viewBox[1]);
    }
    svg.setAttribute('aria-label', label);
    els.main.classList.toggle('is-native', !!graph.native);

    var vp = el('g', {'class': 'vp'}, svg);
    var defs = el('defs', {}, vp);
    var mw = el('marker', {id: 'ah', viewBox: '0 0 10 10', refX: 10, refY: 5, markerUnits: 'userSpaceOnUse',
      markerWidth: 13 * s, markerHeight: 13 * s, orient: 'auto'}, defs);
    el('path', {d: 'M0,0 L10,5 L0,10 z', fill: '#fff'}, mw);
    var mg = el('marker', {id: 'ah-green', viewBox: '0 0 10 10', refX: 0, refY: 5, markerUnits: 'userSpaceOnUse',
      markerWidth: 22, markerHeight: 22, orient: 'auto'}, defs);
    el('path', {d: 'M0,0 L10,5 L0,10 z', fill: '#5cb85c'}, mg);
    var ms = el('marker', {id: 'ah-selected', viewBox: '0 0 10 10', refX: 10, refY: 5, markerUnits: 'userSpaceOnUse',
      markerWidth: 15 * s, markerHeight: 15 * s, orient: 'auto'}, defs);
    el('path', {d: 'M0,0 L10,5 L0,10 z', fill: '#5cb85c', 'class': 'marker-selected'}, ms);
    // Pijlpunt voor een gemarkeerde route (aanbevelingenoverzicht); gekozen via CSS (.edge.is-route).
    var mr = el('marker', {id: 'ah-route', viewBox: '0 0 10 10', refX: 10, refY: 5, markerUnits: 'userSpaceOnUse',
      markerWidth: 15 * s, markerHeight: 15 * s, orient: 'auto'}, defs);
    el('path', {d: 'M0,0 L10,5 L0,10 z', fill: '#FFD60A'}, mr);

    graph.edges.forEach(function (e) {
      var d = e.points.map(function (p, i) { return (i ? 'L' : 'M') + p[0] + ',' + p[1]; }).join(' ');
      var a = {d: d, 'class': 'edge' + (e.color === 'green' ? ' green' : ''), 'stroke-width': e.width || 1.5};
      if (e.arrow) a['marker-end'] = e.color === 'green' ? 'url(#ah-green)' : 'url(#ah)';
      if (e.id) {
        // Edge met id: statussen worden later per id toegepast (selected, available, inactive, excluded)
        a['data-edge-id'] = e.id;
        a['data-d'] = d;
        a['data-marker'] = a['marker-end'] || '';
        if (e.selectedPoints) {
          a['data-d-selected'] = e.selectedPoints.map(function (p, i) { return (i ? 'L' : 'M') + p[0] + ',' + p[1]; }).join(' ');
        }
        if (e.arrow || e.selectedPoints) a['data-selected-arrow'] = '1';
      }
      el('path', a, vp);
    });

    // Connectoren van interactieve criteria: edge met id, dot en een waarde die bij een optie van de from-node hoort.
    var srcEdges = {};
    ((source && source.edges) || []).forEach(function (se) { if (se.id) srcEdges[se.id] = se; });
    var nodesById = {};
    graph.nodes.forEach(function (nn) { nodesById[nn.id] = nn; });
    function choiceFor(e) {
      if (!e.id || !e.dot) return null;
      var se = srcEdges[e.id] || e;
      var from = se.from || e.from;
      var value = se.value !== undefined ? se.value : e.value;
      var parent = nodesById[from];
      if (value === undefined || value === null || !parent) return null;
      if (parent.interactive !== true || !Array.isArray(parent.options)) return null;
      var option = parent.options.filter(function (o) { return o.value === value; })[0];
      if (!option) return null;
      return {edgeId: e.id, nodeId: from, nodeLabel: parent.label || from, value: value,
        optionLabel: option.label !== undefined ? option.label : String(value)};
    }

    graph.edges.forEach(function (e) {
      if (!e.dot) return;
      var link = {};
      if (e.id) link = {'data-edge-id': e.id};
      var dotAttrs = {'class': 'edot', cx: e.dot[0], cy: e.dot[1], r: 9.3 * s};
      for (var dk in link) dotAttrs[dk] = link[dk];
      el('circle', dotAttrs, vp);
      if (e.label) {
        var parts = e.label.split('\n'), step = 12.5 * s * 1.45;
        parts.forEach(function (txt, i) {
          var labelAttrs = {'class': 'elabel', x: e.dot[0],
            y: e.dot[1] - 17 * s - (parts.length - 1 - i) * step, 'font-size': 12.5 * s};
          for (var lk in link) labelAttrs[lk] = link[lk];
          // Vlak in de achtergrondkleur achter het label: de lijn wordt over de hele hoogte van de tekst
          // onderbroken (met wat ruimte erboven en eronder), zodat het label goed leesbaar is.
          var bg = el('rect', {'class': 'elabel-bg'}, vp);
          var lt = el('text', labelAttrs, vp);
          lt.textContent = txt;
          var fsz = 12.5 * s, padX = 3 * s, padY = 3 * s, box = null;
          try { box = lt.getBBox(); } catch (err) { box = null; }
          if (!box || !box.width) {
            // Nog geen layout (bv. verborgen): schat de afmetingen uit de tekstlengte.
            var estW = txt.length * fsz * 0.55;
            box = { x: e.dot[0] - estW / 2, y: labelAttrs.y - fsz * 0.9, width: estW, height: fsz * 1.15 };
          }
          bg.setAttribute('x', box.x - padX);
          bg.setAttribute('y', box.y - padY);
          bg.setAttribute('width', box.width + 2 * padX);
          bg.setAttribute('height', box.height + 2 * padY);
        });
      }
      var choice = choiceFor(e);
      if (choice) drawEdgeChoice(vp, e, choice, s);
    });

    graph.nodes.forEach(function (n) {
      var w = n.w || size[0], h = n.h || size[1];
      // Een node met "tumor" (en eventueel "tree") verwijst naar het zorgpad van een andere tumor.
      var target = n.tumor ? {tumor: String(n.tumor), tree: n.tree ? String(n.tree) : ''}
        : (n.to !== undefined ? n.to : (n.drill ? n.id : null));
      var type = n.type || 'step';
      var interactive = n.interactive === true && Array.isArray(n.options);
      // Een keuzenode met een hulpbeslisboom krijgt standaard het plus-icoon; een klik opent de hulpbeslisboom.
      var subRef = (interactive && typeof GraphState !== 'undefined') ? GraphState.subtreeOf(n) : null;
      var icon = n.icon || (n.drill ? 'down' : (subRef ? 'plus-light' : null));
      var g = el('g', {'data-node-id': n.id, 'class': 'node t-' + type + (n.tone ? ' tone-' + n.tone : '') + (target !== null ? ' go' : '') +
        (interactive ? ' is-interactive' : ''),
        transform: 'translate(' + n.x + ',' + n.y + ')'}, vp);
      if (interactive) {
        var optionLabels = {};
        n.options.forEach(function (o) { optionLabels[o.value] = o.label; });
        var item = {id: n.id, label: n.label, options: n.options, subtree: subRef ? {tree: subRef.tree} : null};
        g.setAttribute('data-node-label', n.label);
        g.setAttribute('data-option-labels', JSON.stringify(optionLabels));
        g.setAttribute('role', 'button');
        if (subRef) g.setAttribute('data-subtree', subRef.tree);
        g.setAttribute('aria-haspopup', 'dialog');
        g.setAttribute('tabindex', '0');
        g.setAttribute('aria-label', 'Kies een waarde voor ' + n.label);
        var activate = function () {
          if (!isClickable(g)) return;
          // Ook bij een hulpbeslisboom eerst het keuzevenster; daarin staat de knop naar de hulpbeslisboom.
          onInteract(item, g);
        };
        g.addEventListener('click', activate);
        g.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); activate(); }
          else if (ev.key === ' ') { ev.preventDefault(); }
        });
        // Spatie activeert bij loslaten, zodat de keyup niet op de radioknop in het venster terechtkomt.
        g.addEventListener('keyup', function (ev) {
          if (ev.key === ' ') { ev.preventDefault(); activate(); }
        });
      }
      // De titel van het zorgpad (start) toont de bronvermelding, die van een beslisboom (root) de onderbouwing. Bij een root blijft
      // het min-icoon de weg terug naar het overzicht (zie het icoon hieronder).
      var infoNode = onInfo !== null && (type === 'start' || (type === 'root' && target === ''));
      if (infoNode) {
        g.classList.add('has-info');
        g.setAttribute('data-focusable', 'info');
        g.setAttribute('role', 'button');
        g.setAttribute('tabindex', '0');
        g.setAttribute('aria-haspopup', 'dialog');
        g.setAttribute('aria-label', (type === 'start' ? 'Bron en verantwoording: ' : 'Onderbouwing: ') + (n.label || ''));
        var openInfo = function () { onInfo({nodeId: n.id, label: n.label, element: g}); };
        g.addEventListener('click', openInfo);
        g.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openInfo(); }
        });
      } else if (target !== null) {
        g.setAttribute('data-focusable', 'link');
        g.setAttribute('role', 'link');
        g.setAttribute('tabindex', '0');
        g.setAttribute('aria-label', target === '' ? 'Terug naar overzicht' : n.label);
        g.addEventListener('click', function () { onNavigate(target); });
        g.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onNavigate(target); }
        });
      }
      el('rect', {width: w, height: h, rx: n.rx !== undefined ? n.rx :
        (type === 'start' ? 30 * s : type === 'root' ? 40 * s : type === 'criterion' ? 28 * s :
         (type === 'decision' || type === 'outcome') ? 0 : 5 * s)}, g);

      var fs = 12.5 * s, lh = 14.5 * s, lines = [];
      if (n.items) {
        var itemMax = Math.floor((w - 20) / (fs * 0.5));
        n.items.forEach(function (it, i) {
          if (i) lines.push({t: ''}, {t: 'EN'}, {t: ''});
          it.text.split('\n').forEach(function (seg) {
            var marked = seg.indexOf('{i}') === 0;
            wrap(seg.replace('{i}', ''), itemMax).forEach(function (l, j) {
              lines.push({t: l, info: marked && j === 0 ? (it.info || '') : null});
            });
          });
        });
      } else if (n.text !== undefined) {
        var textMax = Math.floor((w - 20) / (fs * 0.46));
        n.text.split('\n').forEach(function (seg) {
          if (seg === '') lines.push({t: ''});
          else if (seg.indexOf('{a:') >= 0) lines.push({t: seg});
          else {
            // {i} = info-icoon, {x} = "geen"-symbool (doorgestreepte cirkel) aan het begin van een regel
            var marker = seg.indexOf('{i}') === 0 ? 'i' : (seg.indexOf('{x}') === 0 ? 'x' : null);
            wrap(seg.replace(/^\{[ix]\}/, ''), textMax).forEach(function (l, j) {
              lines.push({t: l, info: marker && j === 0 ? '' : null, kind: marker});
            });
          }
        });
      } else {
        wrap(n.label, n.wrap || maxChars).forEach(function (l) { lines.push({t: l}); });
      }

      var y0 = h / 2 - ((lines.length - 1) * lh) / 2 + fs * 0.36;
      lines.forEach(function (l, i) {
        if (!l.t) return;
        var t = el('text', {x: w / 2, y: y0 + i * lh, 'font-size': fs}, g);
        setRich(t, l.t);
        if (l.info !== null && l.info !== undefined) {
          var d = 15 * s, gap = 5 * s, tl = t.getComputedTextLength();
          t.setAttribute('x', w / 2 + (d + gap) / 2);
          var ig = el('g', {'class': 'info', transform: 'translate(' + (w / 2 - (d + gap + tl) / 2 + d / 2) + ',' +
            (y0 + i * lh - fs * 0.36) + ') scale(' + s + ')'}, g);
          if (l.info) el('title', {}, ig).textContent = l.info;
          el('circle', {r: 7.5}, ig);
          if (l.kind === 'x') {
            ig.setAttribute('class', 'info no');
            el('path', {d: 'M-5.3,-5.3 L5.3,5.3'}, ig);
          } else {
            el('path', {d: 'M0,-0.5 V4'}, ig);
            el('circle', {'class': 'dot', cy: -3.8, r: 1.3}, ig);
          }
        }
      });

      if (infoNode) el('title', {}, g).textContent = type === 'start' ? 'Bron en verantwoording' : 'Onderbouwing';
      if (infoNode && type === 'start') {
        // Info-icoon rechtsboven op de hoek van de zorgpadtitel (alleen in het overzicht): laat zien dat die
        // klikbaar is en de bronvermelding toont. De tooltip staat op de hele node.
        var badge = el('g', {'class': 'info-badge', 'aria-hidden': 'true',
          transform: 'translate(' + (w - 6 * s) + ',' + (6 * s) + ') scale(' + s + ')'}, g);
        el('circle', {r: 11}, badge);
        el('path', {d: 'M0,-1 V5.5'}, badge);
        el('circle', {'class': 'dot', cy: -5, r: 1.6}, badge);
      }
      if (icon) {
        var ic = el('g', {'class': 'icon ' + icon,
          transform: 'translate(' + (w - 2) + ',' + (h / 2) + ') scale(' + s + ')'}, g);
        el('circle', {r: 16}, ic);
        el('path', {d: icon.indexOf('minus') === 0 ? 'M-8,0 H8' :
          icon.indexOf('plus') === 0 ? 'M-8,0 H8 M0,-8 V8' : 'M0,-8 V8 M-7,2 L0,9 L7,2'}, ic);
        if (infoNode && target !== null) {
          // Het icoon van een root met bronvermelding is een eigen link terug naar het overzicht.
          ic.classList.add('icon-link');
          ic.setAttribute('role', 'link');
          ic.setAttribute('tabindex', '0');
          ic.setAttribute('aria-label', 'Terug naar overzicht');
          el('title', {}, ic).textContent = 'Terug naar overzicht';
          var back = function (ev) { ev.stopPropagation(); ev.preventDefault(); onNavigate(target); };
          ic.addEventListener('click', back);
          ic.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') back(ev); });
        }
      }
    });

    applyViewport();
  }

  /* Onzichtbaar, klikbaar vlak over de dot en het label van een connector (alleen tekenen, geen logica).
     Een activatie wordt doorgegeven via onSelect; app.js gebruikt daarvoor dezelfde functie als het keuzevenster.
     De bedienbaarheid (tabindex, aria-disabled) volgt de status van de from-node in applyStatus. */
  function drawEdgeChoice(parent, e, choice, s) {
    var fs = 12.5 * s, step = fs * 1.45, r = 9.3 * s;
    var parts = e.label ? String(e.label).split('\n') : [];
    var longest = parts.reduce(function (m, t) { return Math.max(m, t.length); }, 0);
    var halfW = Math.max(r + 6, longest * fs * 0.3 + 8);
    var top = parts.length ? e.dot[1] - 17 * s - (parts.length - 1) * step - fs - 2 : e.dot[1] - r - 4;
    var bottom = e.dot[1] + r + 4;
    var g = el('g', {
      'class': 'edge-choice',
      'data-edge-id': choice.edgeId,
      'data-from': choice.nodeId,
      'data-value': String(choice.value),
      'data-node-label': choice.nodeLabel,
      'data-option-label': choice.optionLabel,
      'role': 'button',
      'aria-pressed': 'false',
      'aria-disabled': 'true',
      'aria-label': choice.nodeLabel + ': ' + choice.optionLabel
    }, parent);
    el('rect', {'class': 'edge-hit', x: e.dot[0] - halfW, y: top, width: halfW * 2, height: bottom - top, rx: 6}, g);
    var activate = function () {
      if (g.getAttribute('aria-disabled') === 'true') return;
      onSelect({nodeId: choice.nodeId, nodeLabel: choice.nodeLabel, value: choice.value, optionLabel: choice.optionLabel});
    };
    g.addEventListener('click', activate);
    g.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); activate(); }
      else if (ev.key === ' ') { ev.preventDefault(); }
    });
    g.addEventListener('keyup', function (ev) {
      if (ev.key === ' ') { ev.preventDefault(); activate(); }
    });
  }

  /* Bedienbaarheid en aria van een connector uit de status van de from-node (zelfde regel als bij de node zelf:
     elke keuzenode die nog mogelijk is, ook als die nog niet bereikt is: vrije volgorde). Beantwoorde keuzes
     blijven aanklikbaar om te wijzigen; alleen de eerstvolgende (available) keuzenode staat in de tabvolgorde. */
  function updateEdgeChoice(item, status, selections) {
    var from = item.getAttribute('data-from');
    var st = status.nodes[from] || 'normal';
    var nodeLabel = item.getAttribute('data-node-label');
    var optionLabel = item.getAttribute('data-option-label');
    var chosen = selections[from] !== undefined && selections[from] !== null &&
      String(selections[from]) === item.getAttribute('data-value');
    var text = nodeLabel + ': ' + optionLabel;
    if (isSelectableStatus(st)) {
      item.setAttribute('tabindex', st === 'available' ? '0' : '-1');
      item.removeAttribute('aria-disabled');
      if (chosen) text += st === 'preselected' ? ' (alvast gekozen)' : ' (huidige keuze)';
      else if (st === 'inactive') text += ' (alvast kiezen)';
    } else {
      item.removeAttribute('tabindex');
      item.setAttribute('aria-disabled', 'true');
      text += ' (niet meer mogelijk)';
    }
    item.setAttribute('aria-pressed', chosen ? 'true' : 'false');
    item.setAttribute('aria-label', text);
  }

  var STATUS_CLASSES = ['is-selected', 'is-preselected', 'is-available', 'is-inactive', 'is-excluded'];

  /* Een keuzenode (en zijn connectoren) is te bedienen zolang die nog mogelijk is: ook als die nog niet bereikt
     is, zodat waarden in willekeurige volgorde kunnen worden ingevuld. Alleen 'excluded' is niet te bedienen. */
  function isSelectableStatus(st) {
    return st === 'available' || st === 'selected' || st === 'preselected' || st === 'inactive';
  }

  function setStatusClass(element, status) {
    STATUS_CLASSES.forEach(function (c) { element.classList.remove(c); });
    if (status && status !== 'normal') element.classList.add('is-' + status);
  }

  function isClickable(g) {
    return !g.classList.contains('is-excluded');
  }

  /* Past een berekende graph-status toe als CSS-klassen op nodes, edges, dots en labels.
     status = {nodes: {id: status}, edges: {id: status}} (uit GraphState.compute);
     values = {nodeId: waarde} met de keuzes van de getoonde beslisboom (alleen voor de aria-labels).
     Gerichte update zonder rerender; de renderer bepaalt zelf geen route of keuze. */
  function applyStatus(status, values) {
    var selections = values || {};
    els.svg.querySelectorAll('.node[data-node-id]').forEach(function (g) {
      var id = g.getAttribute('data-node-id');
      var st = status.nodes[id] || 'normal';
      setStatusClass(g, st);
      if (g.getAttribute('data-takeable') === '1') { updateTakeable(g, st); return; }
      if (g.getAttribute('data-focusable') === 'link') {
        // Een navigatielink bij een uitgesloten uitkomst is niet bruikbaar: uit de tabvolgorde en niet aanklikbaar.
        if (st === 'excluded') { g.removeAttribute('tabindex'); g.setAttribute('aria-disabled', 'true'); }
        else { g.setAttribute('tabindex', '0'); g.removeAttribute('aria-disabled'); }
        return;
      }
      if (!g.classList.contains('is-interactive')) return;
      var label = g.getAttribute('data-node-label');
      var text = 'Kies een waarde voor ' + label + (g.hasAttribute('data-subtree') ? ' (of bepaal hem met de hulpbeslisboom)' : '');
      if (st === 'selected' || st === 'preselected') {
        var labels = JSON.parse(g.getAttribute('data-option-labels'));
        var value = selections[id];
        text += (st === 'preselected' ? ' (alvast gekozen: ' : ' (huidige keuze: ') + (labels[value] || value) + ')';
      } else if (st === 'inactive') {
        text += ' (nog niet bereikt, alvast in te vullen)';
      }
      if (isSelectableStatus(st)) {
        g.setAttribute('tabindex', '0');
        g.removeAttribute('aria-disabled');
      } else {
        g.removeAttribute('tabindex');
        g.setAttribute('aria-disabled', 'true');
        text = label + ': niet meer mogelijk';
      }
      g.setAttribute('aria-label', text);
    });
    els.svg.querySelectorAll('[data-edge-id]').forEach(function (item) {
      var st = status.edges[item.getAttribute('data-edge-id')] || 'normal';
      setStatusClass(item, st);
      if (item.classList.contains('edge-choice')) { updateEdgeChoice(item, status, selections); return; }
      if (item.tagName.toLowerCase() !== 'path') return;
      var on = st === 'selected';
      var selectedD = item.getAttribute('data-d-selected');
      item.setAttribute('d', on && selectedD ? selectedD : item.getAttribute('data-d'));
      var normalMarker = item.getAttribute('data-marker');
      if (on && item.getAttribute('data-selected-arrow') === '1') item.setAttribute('marker-end', 'url(#ah-selected)');
      else if (normalMarker) item.setAttribute('marker-end', normalMarker);
      else item.removeAttribute('marker-end');
    });
  }

  /* De beginnode van een boom (de titel: type root of start, anders de eerste node) en de breedte van een
     standaardblok, voor de beginweergave. Geeft { id, box: {x, y, w, h}, blockWidth } of null. */
  function startBox(graph) {
    graph = laidOut(graph);
    if (!graph || !graph.nodes || !graph.nodes.length) return null;
    var n = graph.nodes.filter(function (x) { return x.type === 'root' || x.type === 'start'; })[0] || graph.nodes[0];
    return {
      id: n.id,
      box: { x: n.x, y: n.y, w: n.w || graph.nodeSize[0], h: n.h || graph.nodeSize[1] },
      blockWidth: graph.nodeSize[0]
    };
  }

  /* Afmetingen van een node in SVG-coördinaten (voor het berekenen van de viewportbestemming). */
  function nodeBox(graph, id) {
    graph = laidOut(graph);
    var n = graph.nodes.filter(function (x) { return x.id === id; })[0];
    if (!n) return null;
    return { x: n.x, y: n.y, w: n.w || graph.nodeSize[0], h: n.h || graph.nodeSize[1] };
  }

  /* Tijdelijke, niet-pulserende highlight van een node (null haalt de highlight weg). */
  function setGuidedTarget(id) {
    els.svg.querySelectorAll('.node.is-guided-target').forEach(function (g) { g.classList.remove('is-guided-target'); });
    if (id === null || id === undefined) return;
    var g = els.svg.querySelector('.node[data-node-id="' + id + '"]');
    if (g) g.classList.add('is-guided-target');
  }

  /* Markeert een route in de boom (geel) uit {nodeIds, edgeIds}; null haalt de markering weg.
     Alleen klassen (is-route): geen eigen status, en applyStatus laat de markering ongemoeid.
     Na een nieuwe render (andere boom) is de markering vanzelf verdwenen. */
  function setRouteHighlight(route) {
    if (!els || !els.svg) return;
    els.svg.querySelectorAll('.is-route').forEach(function (item) { item.classList.remove('is-route'); });
    els.svg.classList.toggle('has-route', !!route);
    if (!route) return;
    var nodes = {}, edges = {};
    (route.nodeIds || []).forEach(function (id) { nodes[id] = true; });
    (route.edgeIds || []).forEach(function (id) { edges[id] = true; });
    els.svg.querySelectorAll('.node[data-node-id]').forEach(function (g) {
      if (nodes[g.getAttribute('data-node-id')]) g.classList.add('is-route');
    });
    els.svg.querySelectorAll('[data-edge-id]').forEach(function (item) {
      if (edges[item.getAttribute('data-edge-id')]) item.classList.add('is-route');
    });
  }

  /* Maakt uitkomsten (outcomes) van een hulpbeslisboom aanklikbaar: items = [{id, label}]. Aanroepen na draw().
     Alleen een bereikte uitkomst (status selected) is te activeren; de aanroeper bepaalt wat dat betekent (onTake). */
  function setTakeable(items) {
    if (!els || !els.svg) return;
    (items || []).forEach(function (it) {
      var g = els.svg.querySelector('.node[data-node-id="' + it.id + '"]');
      if (!g || g.getAttribute('data-takeable') === '1') return;
      g.setAttribute('data-takeable', '1');
      g.setAttribute('data-take-label', it.label || it.id);
      g.setAttribute('role', 'button');
      g.classList.add('is-takeable');
      var activate = function () {
        if (g.classList.contains('is-selected')) onTake({nodeId: it.id});
      };
      g.addEventListener('click', activate);
      g.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); activate(); }
        else if (ev.key === ' ') { ev.preventDefault(); }
      });
      g.addEventListener('keyup', function (ev) {
        if (ev.key === ' ') { ev.preventDefault(); activate(); }
      });
    });
  }

  function updateTakeable(g, st) {
    var label = g.getAttribute('data-take-label');
    if (st === 'selected') {
      g.setAttribute('tabindex', '0');
      g.removeAttribute('aria-disabled');
      g.setAttribute('aria-label', 'Uitkomst ' + label + ': neem deze waarde over in de beslisboom');
    } else {
      g.removeAttribute('tabindex');
      g.setAttribute('aria-disabled', 'true');
      g.setAttribute('aria-label', label + (st === 'excluded' ? ': niet meer mogelijk' : ': nog niet bereikt'));
    }
  }

  /* Verplaatst de toetsenbordfocus naar een node zonder de pagina te laten scrollen. */
  function focusNode(id) {
    var g = els.svg.querySelector('.node[data-node-id="' + id + '"]');
    if (g && g.hasAttribute('tabindex')) g.focus({ preventScroll: true });
  }

  function showMessage(text) {
    els.message.textContent = text;
    els.message.classList.remove('zp-hidden');
  }

  /* Tekent de view uit resolve(). handlers.navigate(target) wordt aangeroepen als een navigatienode
     wordt geactiveerd ('' = terug naar overzicht); handlers.interact(item, element) als een interactieve
     node wordt geactiveerd. De aanroeper bepaalt wat dat betekent. */
  function draw(view, handlers) {
    onNavigate = handlers.navigate;
    onInteract = handlers.interact;
    onSelect = handlers.select || function () {};
    onSubtree = handlers.subtree || function () {};
    onTake = handlers.take || function () {};
    onInfo = handlers.info || null;
    els.main.classList.toggle('in-detail', view.treeId !== null);
    if (view.graph) {
      els.message.classList.add('zp-hidden');
      els.svg.classList.remove('zp-hidden');
      render(view.graph, view.label);
    } else {
      els.svg.classList.add('zp-hidden');
      els.main.classList.remove('is-native');
      showMessage(view.label + ': de beslisboom van deze stap is nog niet toegevoegd.');
    }
  }

  /* refs: {main, svg, message} */
  function init(refs) { els = refs; }

  return {
    init: init,
    resolve: resolve,
    graphBounds: graphBounds,
    fitViewport: fitViewport,
    draw: draw,
    applyViewport: applyViewport,
    applyStatus: applyStatus,
    nodeBox: nodeBox,
    startBox: startBox,
    setGuidedTarget: setGuidedTarget,
    setRouteHighlight: setRouteHighlight,
    setTakeable: setTakeable,
    focusNode: focusNode
  };
})();
