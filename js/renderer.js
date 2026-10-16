/* Generieke SVG-renderer voor zorgpaden en beslisbomen.
   Bevat geen tumor- of medische inhoud; alles komt uit de zorgpaddata. */
const Renderer = (function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var els = null;       // DOM-verwijzingen (via init)
  var data = null;      // volledige zorgpaddata
  var current = null;   // huidige graph (overzicht of boom)
  var listening = false;

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

  function applyZoom() {
    if (current && current.native) {
      els.svg.setAttribute('width', Math.round(current.viewBox[0] * state.zoom));
    } else {
      els.svg.removeAttribute('width');
    }
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

  function go(target) { location.hash = target ? '#/' + target : ''; }

  function render(graph, label) {
    var svg = els.svg;
    var size = graph.nodeSize, s = size[0] / 179, maxChars = graph.wrap || 24;
    svg.innerHTML = '';
    svg.setAttribute('viewBox', '0 0 ' + graph.viewBox[0] + ' ' + graph.viewBox[1]);
    svg.setAttribute('aria-label', label);
    current = graph;
    els.main.classList.toggle('is-native', !!graph.native);
    if (graph.native) {
      var fit = (els.main.clientWidth - 24) / graph.viewBox[0];
      state.zoom = graph.zoom || Math.max(0.6, Math.min(1, fit));
    }
    applyZoom();

    var defs = el('defs', {}, svg);
    var mw = el('marker', {id: 'ah', viewBox: '0 0 10 10', refX: 10, refY: 5, markerUnits: 'userSpaceOnUse',
      markerWidth: 13 * s, markerHeight: 13 * s, orient: 'auto'}, defs);
    el('path', {d: 'M0,0 L10,5 L0,10 z', fill: '#fff'}, mw);
    var mg = el('marker', {id: 'ah-green', viewBox: '0 0 10 10', refX: 0, refY: 5, markerUnits: 'userSpaceOnUse',
      markerWidth: 22, markerHeight: 22, orient: 'auto'}, defs);
    el('path', {d: 'M0,0 L10,5 L0,10 z', fill: '#5cb85c'}, mg);

    graph.edges.forEach(function (e) {
      var d = e.points.map(function (p, i) { return (i ? 'L' : 'M') + p[0] + ',' + p[1]; }).join(' ');
      var a = {d: d, 'class': 'edge' + (e.color === 'green' ? ' green' : ''), 'stroke-width': e.width || 1.5};
      if (e.arrow) a['marker-end'] = e.color === 'green' ? 'url(#ah-green)' : 'url(#ah)';
      el('path', a, svg);
    });

    graph.edges.forEach(function (e) {
      if (!e.dot) return;
      el('circle', {'class': 'edot', cx: e.dot[0], cy: e.dot[1], r: 9.3 * s}, svg);
      if (e.label) {
        var parts = e.label.split('\n'), step = 12.5 * s * 1.45;
        parts.forEach(function (txt, i) {
          var lt = el('text', {'class': 'elabel', x: e.dot[0],
            y: e.dot[1] - 17 * s - (parts.length - 1 - i) * step, 'font-size': 12.5 * s}, svg);
          lt.textContent = txt;
        });
      }
    });

    graph.nodes.forEach(function (n) {
      var w = size[0], h = n.h || size[1];
      var target = n.to !== undefined ? n.to : (n.drill ? n.id : null);
      var icon = n.icon || (n.drill ? 'down' : null);
      var type = n.type || 'step';
      var g = el('g', {'class': 'node t-' + type + (n.tone ? ' tone-' + n.tone : '') + (target !== null ? ' go' : ''),
        transform: 'translate(' + n.x + ',' + n.y + ')'}, svg);
      if (target !== null) {
        g.setAttribute('role', 'link');
        g.setAttribute('tabindex', '0');
        g.setAttribute('aria-label', target === '' ? 'Terug naar overzicht' : n.label);
        g.addEventListener('click', function () { go(target); });
        g.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(target); }
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
  }

  function showMessage(text) {
    els.message.textContent = text;
    els.message.classList.remove('zp-hidden');
  }

  function route() {
    if (!data) return;
    var id = location.hash.replace(/^#\//, '');
    var node = data.overview.nodes.filter(function (x) { return x.id === id && x.drill; })[0];
    if (!node) {
      els.main.classList.remove('in-detail');
      els.message.classList.add('zp-hidden');
      els.svg.classList.remove('zp-hidden');
      document.title = data.titel;
      state.currentTree = null;
      render(data.overview, data.titel);
      return;
    }
    els.main.classList.add('in-detail');
    document.title = node.label + ' – ' + data.titel;
    state.currentTree = id;
    var tree = data.trees && data.trees[id];
    if (tree && tree.same) tree = data.trees[tree.same];
    if (tree) {
      els.message.classList.add('zp-hidden');
      els.svg.classList.remove('zp-hidden');
      render(tree, node.label);
    } else {
      els.svg.classList.add('zp-hidden');
      showMessage(node.label + ': de beslisboom van deze stap is nog niet toegevoegd.');
    }
    window.scrollTo(0, 0);
  }

  /* refs: {main, svg, message, back, zoomIn, zoomOut} */
  function init(refs) {
    els = refs;
    if (listening) return;
    listening = true;
    els.zoomIn.addEventListener('click', function () {
      state.zoom = Math.min(2, state.zoom + 0.2); applyZoom();
    });
    els.zoomOut.addEventListener('click', function () {
      state.zoom = Math.max(0.3, state.zoom - 0.2); applyZoom();
    });
    els.back.addEventListener('click', function () { go(''); });
    window.addEventListener('hashchange', route);
  }

  /* Toont het zorgpad uit de volledige zorgpaddata. */
  function show(zorgpad) {
    data = zorgpad;
    route();
  }

  return { init: init, show: show };
})();
