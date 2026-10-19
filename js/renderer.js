/* Generieke SVG-renderer voor zorgpaden en beslisbomen.
   De renderer tekent uitsluitend: hij beheert geen eigen applicatiestatus.
   Status (zoom, huidige boom, ...) wordt gelezen uit state.js via getState().
   Bevat geen tumor- of medische inhoud; alles komt uit de zorgpaddata. */
const Renderer = (function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var els = null; // alleen DOM-verwijzingen: {main, svg, message}
  var onNavigate = function () {}; // callbacks van de aanroeper, geen applicatiestatus
  var onInteract = function () {};

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


  /* Achterwaarts compatibele grid-ondersteuning.
     Oude bomen gebruiken x/y; nieuwe bomen kunnen gridX/gridY gebruiken.
     gridSizeX en gridSizeY zijn per graph instelbaar en standaard 100. */
  function nodePosition(node, graph) {
    var gridSizeX = graph.gridSizeX || 100;
    var gridSizeY = graph.gridSizeY || 100;

    return {
      x: node.gridX !== undefined ? node.gridX * gridSizeX : node.x,
      y: node.gridY !== undefined ? node.gridY * gridSizeY : node.y
    };
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
      var pos = nodePosition(node, graph);

      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + nodeWidth);
      maxY = Math.max(maxY, pos.y + height);
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

    return {
      zoom: zoom,
      panX: panX,
      panY: panY,
      bounds: bounds
    };
  }

  /* Bepaalt wat getoond moet worden voor een boom-id (zonder iets te tekenen).
     Geeft {treeId, graph, label}; graph is null als de boom nog niet is toegevoegd.
     Een onbekende id valt terug op het overzicht (treeId = null). */
  function resolve(zorgpad, id) {
    var node = zorgpad.overview.nodes.filter(function (x) { return x.id === id && x.drill; })[0];
    if (!node) {
      return {treeId: null, graph: zorgpad.overview, label: zorgpad.titel};
    }
    var tree = zorgpad.trees && zorgpad.trees[id];
    if (tree && tree.same) tree = zorgpad.trees[tree.same];
    return {treeId: id, graph: tree || null, label: node.label};
  }

  function render(graph, label) {
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
          var lt = el('text', labelAttrs, vp);
          lt.textContent = txt;
        });
      }
    });

    graph.nodes.forEach(function (n) {
      var w = size[0], h = n.h || size[1];
      var target = n.to !== undefined ? n.to : (n.drill ? n.id : null);
      var icon = n.icon || (n.drill ? 'down' : null);
      var type = n.type || 'step';
      var interactive = n.interactive === true && Array.isArray(n.options);
      var pos = nodePosition(n, graph);
      var g = el('g', {'data-node-id': n.id, 'class': 'node t-' + type + (n.tone ? ' tone-' + n.tone : '') + (target !== null ? ' go' : '') +
        (interactive ? ' is-interactive' : ''),
        transform: 'translate(' + pos.x + ',' + pos.y + ')'}, vp);
      if (interactive) {
        var optionLabels = {};
        n.options.forEach(function (o) { optionLabels[o.value] = o.label; });
        var item = {id: n.id, label: n.label, options: n.options};
        g.setAttribute('data-node-label', n.label);
        g.setAttribute('data-option-labels', JSON.stringify(optionLabels));
        g.setAttribute('role', 'button');
        g.setAttribute('aria-haspopup', 'dialog');
        g.setAttribute('tabindex', '0');
        g.setAttribute('aria-label', 'Kies een waarde voor ' + n.label);
        var activate = function () { if (isClickable(g)) onInteract(item, g); };
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
      if (target !== null) {
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
            var marked = seg.indexOf('{i}') === 0;
            wrap(seg.replace('{i}', ''), textMax).forEach(function (l, j) {
              lines.push({t: l, info: marked && j === 0 ? '' : null});
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
          el('path', {d: 'M0,-0.5 V4'}, ig);
          el('circle', {'class': 'dot', cy: -3.8, r: 1.3}, ig);
        }
      });

      if (icon) {
        var ic = el('g', {'class': 'icon ' + icon,
          transform: 'translate(' + (w - 2) + ',' + (h / 2) + ') scale(' + s + ')'}, g);
        el('circle', {r: 16}, ic);
        el('path', {d: icon.indexOf('minus') === 0 ? 'M-8,0 H8' :
          icon.indexOf('plus') === 0 ? 'M-8,0 H8 M0,-8 V8' : 'M0,-8 V8 M-7,2 L0,9 L7,2'}, ic);
      }
    });

    applyViewport();
  }

  var STATUS_CLASSES = ['is-selected', 'is-available', 'is-inactive', 'is-excluded'];

  function setStatusClass(element, status) {
    STATUS_CLASSES.forEach(function (c) { element.classList.remove(c); });
    if (status && status !== 'normal') element.classList.add('is-' + status);
  }

  function isClickable(g) {
    return g.classList.contains('is-available') || g.classList.contains('is-selected');
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
      if (g.getAttribute('data-focusable') === 'link') {
        // Een navigatielink bij een uitgesloten uitkomst is niet bruikbaar: uit de tabvolgorde en niet aanklikbaar.
        if (st === 'excluded') { g.removeAttribute('tabindex'); g.setAttribute('aria-disabled', 'true'); }
        else { g.setAttribute('tabindex', '0'); g.removeAttribute('aria-disabled'); }
        return;
      }
      if (!g.classList.contains('is-interactive')) return;
      var label = g.getAttribute('data-node-label');
      var text = 'Kies een waarde voor ' + label;
      if (st === 'selected') {
        var labels = JSON.parse(g.getAttribute('data-option-labels'));
        var value = selections[id];
        text += ' (huidige keuze: ' + (labels[value] || value) + ')';
      }
      if (st === 'available' || st === 'selected') {
        g.setAttribute('tabindex', '0');
        g.removeAttribute('aria-disabled');
      } else {
        g.removeAttribute('tabindex');
        g.setAttribute('aria-disabled', 'true');
        text = label + (st === 'excluded' ? ': niet meer mogelijk' : ': nog niet beschikbaar');
      }
      g.setAttribute('aria-label', text);
    });
    els.svg.querySelectorAll('[data-edge-id]').forEach(function (item) {
      var st = status.edges[item.getAttribute('data-edge-id')] || 'normal';
      setStatusClass(item, st);
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

  /* Afmetingen van een node in SVG-coördinaten (voor het berekenen van de viewportbestemming). */
  function nodeBox(graph, id) {
    var n = graph.nodes.filter(function (x) { return x.id === id; })[0];
    if (!n) return null;
    var pos = nodePosition(n, graph);
    return {
      x: pos.x,
      y: pos.y,
      w: graph.nodeSize[0],
      h: n.h || graph.nodeSize[1]
    };
  }

  /* Tijdelijke, niet-pulserende highlight van een node (null haalt de highlight weg). */
  function setGuidedTarget(id) {
    els.svg.querySelectorAll('.node.is-guided-target').forEach(function (g) { g.classList.remove('is-guided-target'); });
    if (id === null || id === undefined) return;
    var g = els.svg.querySelector('.node[data-node-id="' + id + '"]');
    if (g) g.classList.add('is-guided-target');
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
    setGuidedTarget: setGuidedTarget,
    focusNode: focusNode
  };
})();
