/* Mobiele weergave: zorgpaden als lijst en beslisbomen als vragenlijst.
   Routes (in de hash, zodat elke stap een eigen, deelbare link heeft):
     #/                                    alle zorgpaden + zoeken
     #/<tumor>                             zorgpad als tijdlijn
     #/<tumor>/<boom>?<node>=<waarde>&...  beslisboom als vragenlijst, met de antwoorden in de link
       _from=<boom>:<node>&_ret=<query>    (hulpbeslisboom) voor welke vraag in welke boom, en de antwoorden daar
     #/info/<pagina>                       gebruiksvoorwaarden, over, privacy
   Elk antwoord is een nieuwe stap in de browsergeschiedenis: "terug" op de telefoon is "vorige vraag". */
(function () {
  'use strict';

  var main = document.getElementById('main');
  var up = document.getElementById('up');
  var upLabel = document.getElementById('up-label');
  var desktopLink = document.getElementById('desktop-link');
  var live = document.getElementById('live');
  var toastEl = document.getElementById('toast');

  var DATA = '../data/';
  var tumoren = null;               // [{id, titel, status}]
  var cache = {};                   // tumorId -> Promise<{zp, validation}>
  var lastHash = null;              // laatst getoonde route (hashchange en popstate kunnen allebei komen)
  var openEdit = null;              // nodeId van het antwoord dat open staat om te wijzigen

  /* ---------- hulpjes ---------- */

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function oneLine(s) { return Flow.pretty(Flow.inlineText(s || '')); }

  /* Tekst met {a:tekst|url}: een link als er een url is, anders gewone tekst. */
  function rich(s) {
    var out = '', last = 0, re = /\{a:([^|}]*)\|([^}]*)\}/g, m;
    s = String(s);
    while ((m = re.exec(s))) {
      out += esc(Flow.pretty(s.slice(last, m.index)));
      var url = m[2].trim();
      out += /^https?:\/\//.test(url)
        ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(m[1]) + '</a>'
        : esc(m[1]);
      last = re.lastIndex;
    }
    return out + esc(Flow.pretty(s.slice(last).replace(/\{[ix]\}/g, '')));
  }

  function loadJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ': ' + r.status);
      return r.json();
    });
  }

  function loadTumoren() {
    if (tumoren) return Promise.resolve(tumoren);
    return loadJSON(DATA + 'tumoren.json').then(function (d) { tumoren = d.tumoren || []; return tumoren; });
  }

  /* Zorgpad laden en voorbereiden zoals de hoofdsite dat doet: aliastypes normaliseren en de interactie
     valideren (alleen goedgekeurde keuzes worden vragen). */
  function loadZorgpad(id) {
    if (!cache[id]) {
      cache[id] = loadJSON(DATA + encodeURIComponent(id) + '/zorgpad.json').then(function (raw) {
        var zp = LayoutEngine.normalize(raw);
        var warn = console.warn, log = console.log, group = console.groupCollapsed, end = console.groupEnd;
        console.warn = console.log = console.groupCollapsed = console.groupEnd = function () {};
        var validation;
        try { validation = GraphValidator.validateTumor(zp, id); }
        finally { console.warn = warn; console.log = log; console.groupCollapsed = group; console.groupEnd = end; }
        return { zp: zp, validation: validation };
      });
      cache[id].catch(function () { delete cache[id]; });
    }
    return cache[id];
  }

  function graphOf(data, treeId) {
    var tree = data.zp.trees && data.zp.trees[treeId];
    if (!tree) return null;
    var raw = tree.same ? data.zp.trees[tree.same] : tree;
    if (!raw || !Array.isArray(raw.nodes)) return null;
    var v = data.validation.trees[treeId] || (tree.same && data.validation.trees[tree.same]);
    return v ? v.graph : raw;
  }

  function treeTitle(data, treeId) {
    var g = graphOf(data, treeId);
    var root = g && g.nodes.filter(function (n) { return n.type === 'root'; })[0];
    if (root && root.label) return oneLine(root.label);
    var ov = data.zp.overview && data.zp.overview.nodes.filter(function (n) { return (n.to || n.id) === treeId; })[0];
    return ov && ov.label ? oneLine(ov.label) : treeId;
  }

  function tumorTitle(id) {
    var t = (tumoren || []).filter(function (x) { return x.id === id; })[0];
    return t ? t.titel : id;
  }

  /* ---------- links ---------- */

  function treeHref(tumorId, treeId, sel, extra) {
    var q = new URLSearchParams();
    Object.keys(sel || {}).forEach(function (k) { q.append(k, sel[k]); });
    Object.keys(extra || {}).forEach(function (k) { if (extra[k]) q.append(k, extra[k]); });
    var qs = q.toString();
    return '#/' + encodeURIComponent(tumorId) + '/' + encodeURIComponent(treeId) + (qs ? '?' + qs : '');
  }

  function parseRoute() {
    var h = location.hash.replace(/^#\/?/, '');
    var qi = h.indexOf('?');
    var pathPart = qi >= 0 ? h.slice(0, qi) : h;
    var query = new URLSearchParams(qi >= 0 ? h.slice(qi + 1) : '');
    var parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
    var sel = {}, meta = {};
    query.forEach(function (v, k) { if (k.charAt(0) === '_') meta[k] = v; else sel[k] = v; });
    return { parts: parts, sel: sel, meta: meta };
  }

  /* ---------- kader van de pagina ---------- */

  function frame(opts) {
    up.hidden = !opts.up;
    if (opts.up) { up.href = opts.up.href; upLabel.textContent = opts.up.label; }
    desktopLink.href = opts.desktop || '../index.html';
    document.title = opts.title ? opts.title + ' – Zorgpaden mobiel' : 'Zorgpaden mobiel';
  }

  function show(html, keepScroll) {
    main.innerHTML = html;
    if (!keepScroll) {
      window.scrollTo(0, 0);
      var h1 = main.querySelector('h1');
      if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
    }
  }

  function announce(text) {
    live.textContent = '';
    setTimeout(function () { live.textContent = text; }, 30);
  }

  var toastTimer = null;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2400);
  }

  function failure(err) {
    console.error(err);
    frame({ up: { href: '#/', label: 'Alle zorgpaden' } });
    show('<h1 class="page-title">Dit kon niet worden geladen</h1><p class="lead">Controleer de verbinding en probeer het opnieuw.</p>' +
      '<p><a class="btn" href="#/">Naar alle zorgpaden</a></p>');
  }

  /* ---------- startpagina ---------- */

  function renderHome() {
    frame({ desktop: '../index.html' });
    loadTumoren().then(function (list) {
      show(
        '<h1 class="page-title">Gynaecologische zorgpaden</h1>' +
        '<p class="lead">Beantwoord een paar vragen en zie welke aanbeveling uit de richtlijn past.</p>' +
        '<div class="search"><label for="q" class="visually-hidden">Zoek een beslisboom</label>' +
        '<input id="q" type="search" autocomplete="off" placeholder="Zoek, bijv. ‘IB1’ of ‘follow-up’">' +
        '<ul id="hits" class="list hits" hidden></ul></div>' +
        '<h2 class="section-title">Zorgpaden</h2>' +
        '<ul class="list">' + list.map(function (t) {
          return '<li><a class="row" href="#/' + encodeURIComponent(t.id) + '"><span class="row-main">' + esc(t.titel) +
            '</span>' + chevron() + '</a></li>';
        }).join('') + '</ul>'
      );
      var input = document.getElementById('q');
      var timer = null;
      input.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () { search(input.value); }, 120);
      });
    }).catch(failure);
  }

  /* Zoeken over de titels van alle beslisbomen van alle zorgpaden (laadt de zorgpaden bij de eerste zoekopdracht). */
  function search(text) {
    var hits = document.getElementById('hits');
    if (!hits) return;
    var q = text.trim().toLowerCase();
    if (q.length < 2) { hits.hidden = true; hits.innerHTML = ''; return; }
    Promise.all(tumoren.map(function (t) {
      return loadZorgpad(t.id).then(function (d) { return { t: t, d: d }; }, function () { return null; });
    })).then(function (all) {
      var words = q.split(/\s+/);
      var found = [];
      all.forEach(function (x) {
        if (!x) return;
        Object.keys(x.d.zp.trees || {}).forEach(function (treeId) {
          var title = treeTitle(x.d, treeId);
          var hay = (title + ' ' + x.t.titel).toLowerCase();
          if (words.every(function (w) { return hay.indexOf(w) >= 0; })) found.push({ t: x.t, treeId: treeId, title: title });
        });
      });
      if (document.getElementById('q') && document.getElementById('q').value.trim().toLowerCase() !== q) return;
      hits.hidden = false;
      hits.innerHTML = found.length
        ? found.slice(0, 40).map(function (f) {
            return '<li><a class="row" href="' + treeHref(f.t.id, f.treeId) + '"><span class="row-main">' + esc(f.title) +
              '<span class="row-sub">' + esc(f.t.titel) + '</span></span>' + chevron() + '</a></li>';
          }).join('')
        : '<li class="row muted">Geen beslisboom gevonden</li>';
      announce(found.length + ' beslisbomen gevonden');
    });
  }

  function chevron() {
    return '<svg class="chev" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  /* ---------- zorgpad als tijdlijn ---------- */

  /* Leest het overzicht: de rechte lijn vanaf de start tot de eerste splitsing, de keuzemogelijkheden bij die
     splitsing, en daarna de overige stappen (elke boom één keer). Bomen die niet in het overzicht staan
     (hulpbeslisbomen, vervolgbomen) komen onder "Overige beslisbomen". */
  function overviewSections(data) {
    var ov = data.zp.overview, trees = data.zp.trees || {};
    var nodes = {}, out = {};
    ov.nodes.forEach(function (n) { nodes[n.id] = n; });
    (ov.edges || []).forEach(function (e) { if (e.from && e.to) (out[e.from] = out[e.from] || []).push(e.to); });
    var incoming = {};
    (ov.edges || []).forEach(function (e) { incoming[e.to] = true; });
    var start = ov.nodes.filter(function (n) { return n.type === 'start'; })[0] ||
      ov.nodes.filter(function (n) { return !incoming[n.id]; })[0];
    var used = {};
    function item(id) {
      var n = nodes[id], tid = n.to || n.id;
      if (!trees[tid] || used[tid]) return null;
      used[tid] = true;
      return { treeId: tid, label: oneLine(n.label || treeTitle(data, tid)) };
    }
    var chain = [], cur = start ? start.id : null, guard = 0;
    while (cur && (out[cur] || []).length === 1 && guard++ < 200) {
      cur = out[cur][0];
      var it = item(cur);
      if (it) chain.push(it);
    }
    var branchFrom = cur && (out[cur] || []).length > 1 ? nodes[cur] : null;
    var branch = branchFrom ? out[cur].map(item).filter(Boolean) : [];
    var after = [], queue = branchFrom ? out[cur].slice() : [], seen = {};
    while (queue.length) {
      var id = queue.shift();
      if (seen[id]) continue;
      seen[id] = true;
      (out[id] || []).forEach(function (to) {
        var x = item(to);
        if (x) after.push(x);
        queue.push(to);
      });
    }
    var others = Object.keys(trees).filter(function (tid) { return !used[tid]; })
      .map(function (tid) { return { treeId: tid, label: treeTitle(data, tid) }; });
    return { chain: chain, branchFrom: branchFrom, branch: branch, after: after, others: others };
  }

  function renderZorgpad(tumorId) {
    loadTumoren().then(function () { return loadZorgpad(tumorId); }).then(function (data) {
      var zp = data.zp;
      frame({ up: { href: '#/', label: 'Alle zorgpaden' }, title: zp.titel,
        desktop: '../zorgpad.html?tumor=' + encodeURIComponent(tumorId) });
      if (!zp.overview || !Object.keys(zp.trees || {}).length) {
        show('<h1 class="page-title">' + esc(zp.titel) + '</h1><p class="lead">Dit zorgpad wordt later toegevoegd.</p>');
        return;
      }
      var s = overviewSections(data);
      function rows(list, cls) {
        return list.map(function (it) {
          return '<li class="' + (cls || '') + '"><a class="step" href="' + treeHref(tumorId, it.treeId) + '">' +
            '<span class="step-dot" aria-hidden="true"></span><span class="row-main">' + esc(it.label) + '</span>' + chevron() + '</a></li>';
        }).join('');
      }
      var html = '<p class="eyebrow">Zorgpad</p><h1 class="page-title">' + esc(zp.titel) + '</h1>';
      if (s.chain.length) html += '<ol class="timeline">' + rows(s.chain) + '</ol>';
      if (s.branch.length) {
        html += '<h2 class="section-title">Daarna, afhankelijk van ' +
          (s.branchFrom && s.branchFrom.label ? '‘' + esc(oneLine(s.branchFrom.label)) + '’' : 'de uitkomst') +
          '<span class="section-sub">Kies één</span></h2><ul class="list choice-list">' + rows(s.branch, 'plain') + '</ul>';
      }
      if (s.after.length) html += '<h2 class="section-title">Verder in het zorgpad</h2><ol class="timeline">' + rows(s.after) + '</ol>';
      if (s.others.length) {
        html += '<details class="more"><summary>Overige beslisbomen (' + s.others.length + ')</summary><ul class="list">' +
          rows(s.others, 'plain') + '</ul></details>';
      }
      html += bronHtml(zp.bron, null);
      show(html);
    }).catch(failure);
  }

  function bronHtml(bron, treeBron) {
    if (!bron && !treeBron) return '';
    var parts = [];
    if (bron && bron.richtlijn) parts.push('Richtlijn ' + esc(bron.richtlijn) + (bron.organisatie ? ' (' + esc(bron.organisatie.replace(/\s*\(.*\)\s*$/, '')) + ')' : ''));
    if (treeBron && treeBron.module) parts.push('module ' + esc(treeBron.module));
    var dates = [];
    if (bron && bron.beoordeeldOp) dates.push('beoordeeld ' + esc(date(bron.beoordeeldOp)));
    else if (bron && bron.publicatiedatum) dates.push('gepubliceerd ' + esc(date(bron.publicatiedatum)));
    var url = (treeBron && treeBron.url) || (bron && bron.url);
    return '<aside class="bron"><p><strong>Bron:</strong> ' + parts.join(', ') + (dates.length ? ' · ' + dates.join(', ') : '') +
      (url ? ' · <a href="' + esc(url) + '" target="_blank" rel="noopener">Richtlijnendatabase</a>' : '') + '</p></aside>';
  }

  function date(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? m[3] + '-' + m[2] + '-' + m[1] : iso;
  }

  /* ---------- beslisboom als vragenlijst ---------- */

  function renderTree(tumorId, treeId, sel, meta, keepScroll) {
    loadTumoren().then(function () { return loadZorgpad(tumorId); }).then(function (data) {
      var graph = graphOf(data, treeId);
      if (!graph) { failure(new Error('Onbekende boom ' + treeId)); return; }
      var zp = data.zp;
      var title = treeTitle(data, treeId);
      var v = Flow.view(graph, sel);

      // De link houdt alleen geldige antwoorden vast (opgeschoond door de rekenkern).
      if (JSON.stringify(v.selections) !== JSON.stringify(sel)) {
        history.replaceState(history.state, '', treeHref(tumorId, treeId, v.selections, meta));
        lastHash = location.hash;
      }

      var parent = subtreeParent(data, meta);
      frame({
        up: parent ? { href: parent.href, label: parent.title }
                   : { href: '#/' + encodeURIComponent(tumorId), label: 'Zorgpad' },
        title: title,
        // De boomweergave leest de antwoorden uit dezelfde soort link: #/<boom>?<node>=<waarde>&...
        desktop: '../zorgpad.html?tumor=' + encodeURIComponent(tumorId) + '#/' + encodeURIComponent(treeId) +
          (Object.keys(v.selections).length ? '?' + new URLSearchParams(v.selections).toString() : '')
      });
      if (typeof Recent !== 'undefined' && !parent) Recent.add({ tumorId: tumorId, tumorTitle: zp.titel, treeId: treeId, title: title });

      var html = '';
      if (parent) {
        html += '<div class="subtree-note">Hulpbeslisboom voor de vraag <strong>‘' + esc(parent.question) + '’</strong> in ' +
          esc(parent.title) + '.</div>';
      }
      html += '<p class="eyebrow">' + esc(zp.titel) + '</p><h1 class="page-title">' + esc(title) + '</h1>';
      if (v.interactive) html += meter(v);

      if (!v.interactive) {
        html += staticTree(v, tumorId);
      } else {
        html += answersHtml(v);
        if (v.question) html += questionHtml(v, data, tumorId, treeId);
        else html += resultHtml(v, data, tumorId, treeId, parent);
        html += allRecsHtml(v);
      }
      var tree = zp.trees[treeId];
      html += bronHtml(zp.bron, (tree && tree.bron) || (tree && tree.same && zp.trees[tree.same] && zp.trees[tree.same].bron));
      show(html, keepScroll);
      bindTree(data, tumorId, treeId, graph, v, meta, parent);
    }).catch(failure);
  }

  function meter(v) {
    var total = v.all.length;
    if (!total) return '';
    var reached = v.all.filter(function (r) { return r.state === 'reached'; }).length;
    var text = reached && v.done
      ? (reached === 1 ? 'Aanbeveling gevonden' : reached + ' aanbevelingen van toepassing')
      : 'Nog ' + v.remaining.length + ' van ' + total + ' aanbevelingen mogelijk';
    return '<div class="meter" aria-label="' + esc(text) + '"><p class="meter-text">' + esc(text) + '</p>' +
      '<div class="meter-bar" aria-hidden="true">' + v.all.map(function (r) {
        return '<span class="seg seg-' + r.state + '"></span>';
      }).join('') + '</div></div>';
  }

  function answersHtml(v) {
    if (!v.answered.length) return '';
    return '<h2 class="section-title">Uw antwoorden</h2><ol class="answers">' + v.answered.map(function (a) {
      var isOpen = openEdit === a.nodeId;
      return '<li class="answer' + (a.status === 'preselected' ? ' is-later' : '') + '">' +
        '<button type="button" class="answer-btn" data-edit="' + esc(a.nodeId) + '" aria-expanded="' + isOpen + '">' +
          '<span class="answer-q">' + esc(oneLine(a.label)) + '</span>' +
          '<span class="answer-a">' + esc(Flow.pretty(a.valueLabel)) + '</span>' +
          '<span class="answer-edit">' + (isOpen ? 'Sluit' : 'Wijzig') + '</span>' +
        '</button>' +
        (a.status === 'preselected' ? '<p class="answer-note">Nog niet van toepassing bij de huidige antwoorden.</p>' : '') +
        (isOpen ? '<div class="answer-options">' + optionButtons(a.node, a.value) +
          '<button type="button" class="btn-link" data-clear="' + esc(a.nodeId) + '">Antwoord wissen</button></div>' : '') +
        '</li>';
    }).join('') + '</ol>';
  }

  function optionButtons(node, current) {
    return '<div class="options" role="group" aria-label="' + esc(oneLine(GraphState.describeNode(node))) + '">' +
      node.options.map(function (o) {
        var on = current !== undefined && o.value === current;
        return '<button type="button" class="opt' + (on ? ' is-on' : '') + '" aria-pressed="' + on + '" data-node="' +
          esc(node.id) + '" data-value="' + esc(o.value) + '">' + esc(Flow.pretty(o.label !== undefined ? o.label : o.value)) + '</button>';
      }).join('') + '</div>';
  }

  function questionHtml(v, data, tumorId, treeId) {
    var node = v.question;
    var n = v.answered.filter(function (a) { return a.status === 'selected'; }).length + 1;
    var html = '<section class="card q-card" id="vraag" aria-labelledby="q-title">' +
      '<p class="q-step">Vraag ' + n + '</p>' +
      '<h2 id="q-title" class="q-title">' + esc(oneLine(GraphState.describeNode(node))) + '</h2>' +
      optionButtons(node);
    var m = GraphState.measureOf(node);
    if (m) {
      html += '<form class="measure" data-measure="' + esc(node.id) + '"><label for="mval">Of vul de waarde in</label>' +
        '<div class="measure-row"><input id="mval" type="number" inputmode="decimal" step="any" required>' +
        '<span class="unit">' + esc(m.unit) + '</span><button type="submit" class="btn btn-small">Kies</button></div>' +
        '<p class="measure-error" hidden></p></form>';
    }
    var sub = GraphState.subtreeOf(node);
    if (sub && data.zp.trees[sub.tree]) {
      html += '<a class="subtree-link" href="' + treeHref(tumorId, sub.tree, {}, {
        _from: treeId + ':' + node.id, _ret: new URLSearchParams(v.selections).toString() || '-' }) + '">' +
        '<span>Weet u het niet? Bepaal het met de hulpbeslisboom <strong>' + esc(treeTitle(data, sub.tree)) + '</strong></span>' + chevron() + '</a>';
    }
    if (depth() > 0) html += '<button type="button" class="btn-link back" data-back>‹ Vorige vraag</button>';
    return html + '</section>';
  }

  function blocksHtml(node) {
    return Flow.blocks(node).map(function (b) {
      if (b.kind === 'join') return '<p class="join"><span>' + esc(b.text) + '</span></p>';
      if (b.kind === 'rule') return '<hr class="rule">';
      var cls = b.info ? 'para info' : (b.none ? 'para none' : 'para');
      var icon = b.info ? '<span class="i-icon" aria-label="Toelichting">i</span>' : (b.none ? '<span class="x-icon" aria-label="Geen">⊘</span>' : '');
      return '<p class="' + cls + '">' + icon + '<span>' + rich(b.text) + '</span></p>';
    }).join('');
  }

  function resultHtml(v, data, tumorId, treeId, parent) {
    var html = '<section class="result" id="vraag">';
    if (v.outcomes.length) {
      v.outcomes.forEach(function (n) {
        html += '<article class="card rec-card"><p class="rec-head">Aanbeveling</p><div class="rec-body">' + blocksHtml(n) + '</div></article>';
      });
    }
    v.steps.forEach(function (n) {
      html += '<article class="card rec-card step-card"><p class="rec-head">Stap</p><div class="rec-body">' + blocksHtml(n) + '</div></article>';
    });
    if (!v.outcomes.length && !v.steps.length && !v.links.length) {
      html += '<p class="lead">Bij deze antwoorden geeft de beslisboom geen aanbeveling.</p>';
    }

    // Hulpbeslisboom: de uitkomst overnemen in de vraag waar hij voor is.
    if (parent) {
      var take = null;
      v.outcomes.some(function (o) {
        var val = GraphState.subtreeValue(parent.node, o);
        if (val !== null) { take = { value: val, label: Flow.optionLabel(parent.node, val) }; return true; }
        return false;
      });
      if (take) {
        html += '<button type="button" class="btn btn-primary btn-wide" data-take="' + esc(take.value) + '">' +
          'Neem over: ' + esc(oneLine(parent.question)) + ' = ' + esc(Flow.pretty(take.label)) + '</button>';
      }
    }

    if (v.links.length) {
      html += '<h2 class="section-title">Volgende stap</h2><ul class="list">';
      var seen = {};
      v.links.forEach(function (l) {
        var tum = l.tumor || tumorId, tr = l.tree || l.to;
        if (!tr || seen[tum + '/' + tr]) return;
        seen[tum + '/' + tr] = true;
        html += '<li><a class="row next" href="' + treeHref(tum, tr) + '"><span class="row-main">' + esc(oneLine(l.label || tr)) +
          (l.tumor && l.tumor !== tumorId ? '<span class="row-sub">' + esc(tumorTitle(l.tumor)) + '</span>' : '') +
          '</span>' + chevron() + '</a></li>';
      });
      html += '</ul>';
    }

    if (v.answered.length && !parent) {
      html += '<div class="actions">' +
        '<button type="button" class="btn btn-primary" data-copy>Kopieer samenvatting</button>' +
        '<button type="button" class="btn" data-share>Deel link</button>' +
        '<a class="btn btn-quiet" href="' + treeHref(tumorId, treeId, {}) + '">Opnieuw</a>' +
        '</div>';
    }
    if (v.answered.length) {
      if (depth() > 0) html += '<button type="button" class="btn-link back" data-back>‹ Vorige vraag</button>';
    }
    return html + '</section>';
  }

  function routeText(r) {
    return r.routes.map(function (route) {
      return route.conditions.length
        ? route.conditions.map(function (c) { return oneLine(c.nodeLabel) + ': ' + Flow.pretty(c.valueLabel); }).join(' en ')
        : 'Altijd';
    });
  }

  function allRecsHtml(v) {
    if (!v.all.length) return '';
    var label = { reached: 'Van toepassing', possible: 'Nog mogelijk', excluded: 'Uitgesloten' };
    return '<details class="more all-recs"><summary>Alle aanbevelingen in deze boom (' + v.all.length + ')</summary><ul class="recs">' +
      v.all.map(function (r) {
        return '<li class="rec-item is-' + r.state + '"><span class="badge badge-' + r.state + '">' + label[r.state] + '</span>' +
          '<p class="rec-item-title">' + esc(oneLine(Flow.blocks(r.node).filter(function (b) { return b.kind === 'p'; }).map(function (b) { return b.text; })[0] || r.label)) + '</p>' +
          '<ul class="conds">' + routeText(r).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></li>';
      }).join('') + '</ul></details>';
  }

  /* Boom zonder (goedgekeurde) keuzes: alle aanbevelingen met hun voorwaarden, en de verwijzingen. */
  function staticTree(v, tumorId) {
    var always = v.all.every(function (r) { return r.routes.every(function (rt) { return !rt.conditions.length; }); });
    var html = always
      ? '<p class="lead">Bij deze stap zijn geen vragen te beantwoorden.</p>'
      : '<p class="lead">Deze beslisboom heeft (nog) geen vragen. Hieronder staat elke aanbeveling met de situatie waarin die geldt.</p>';
    v.all.forEach(function (r) {
      var head = always ? 'Aanbeveling' : 'Als ' + routeText(r).join(' — of — ');
      html += '<article class="card rec-card"><p class="rec-head">' + esc(head) + '</p><div class="rec-body">' + blocksHtml(r.node) + '</div></article>';
    });
    if (!v.all.length) {
      v.steps.forEach(function (n) {
        html += '<article class="card rec-card step-card"><p class="rec-head">Stap</p><div class="rec-body">' + blocksHtml(n) + '</div></article>';
      });
    }
    if (v.links.length) {
      var seen = {};
      html += '<h2 class="section-title">Vervolg</h2><ul class="list">' + v.links.map(function (l) {
        var tum = l.tumor || tumorId, tr = l.tree || l.to;
        if (!tr || seen[tum + '/' + tr]) return '';
        seen[tum + '/' + tr] = true;
        return '<li><a class="row next" href="' + treeHref(tum, tr) + '"><span class="row-main">' + esc(oneLine(l.label || tr)) + '</span>' + chevron() + '</a></li>';
      }).join('') + '</ul>';
    }
    return html;
  }

  /* Bij een hulpbeslisboom: de vraag en boom waarvoor hij wordt gebruikt. */
  function subtreeParent(data, meta) {
    if (!meta._from) return null;
    var i = meta._from.indexOf(':');
    if (i <= 0) return null;
    var treeId = meta._from.slice(0, i), nodeId = meta._from.slice(i + 1);
    var g = graphOf(data, treeId);
    var node = g && g.nodes.filter(function (n) { return n.id === nodeId; })[0];
    if (!node) return null;
    var ret = meta._ret && meta._ret !== '-' ? meta._ret : '';
    var sel = {};
    new URLSearchParams(ret).forEach(function (val, k) { sel[k] = val; });
    var tumorId = parseRoute().parts[0];
    return {
      treeId: treeId, node: node, graph: g, sel: sel, from: meta._from, ret: meta._ret,
      question: GraphState.describeNode(node), title: treeTitle(data, treeId),
      href: treeHref(tumorId, treeId, sel)
    };
  }

  function bindTree(data, tumorId, treeId, graph, v, meta, parent) {
    function go(sel) {
      openEdit = null;
      pendingFocus = true;
      navigate(treeHref(tumorId, treeId, sel, meta));
    }

    main.querySelectorAll('.opt').forEach(function (b) {
      b.addEventListener('click', function () {
        go(Flow.answer(graph, v.selections, b.getAttribute('data-node'), b.getAttribute('data-value')));
      });
    });
    main.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-edit');
        openEdit = openEdit === id ? null : id;
        renderTree(tumorId, treeId, v.selections, meta, true);
      });
    });
    main.querySelectorAll('[data-clear]').forEach(function (b) {
      b.addEventListener('click', function () { go(Flow.clear(graph, v.selections, b.getAttribute('data-clear'))); });
    });
    main.querySelectorAll('[data-back]').forEach(function (b) {
      b.addEventListener('click', function () { if (depth() > 0) { pendingFocus = true; openEdit = null; history.back(); } });
    });
    var form = main.querySelector('form[data-measure]');
    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var node = v.question, input = form.querySelector('input'), err = form.querySelector('.measure-error');
        var x = parseFloat(String(input.value).replace(',', '.'));
        var val = GraphState.optionForMeasure(node, x);
        if (val === null) {
          err.textContent = 'Deze waarde past bij geen van de keuzes.';
          err.hidden = false;
          return;
        }
        go(Flow.answer(graph, v.selections, node.id, val));
      });
    }
    var take = main.querySelector('[data-take]');
    if (take && parent) {
      take.addEventListener('click', function () {
        var sel = Flow.answer(parent.graph, parent.sel, parent.node.id, take.getAttribute('data-take'));
        pendingFocus = true;
        navigate(treeHref(tumorId, parent.treeId, sel));
        toast('Overgenomen');
      });
    }
    var copy = main.querySelector('[data-copy]');
    if (copy) copy.addEventListener('click', function () {
      writeClipboard(summary(data, tumorId, treeId, v)).then(function () { toast('Samenvatting gekopieerd'); },
        function () { toast('Kopiëren lukte niet'); });
    });
    var share = main.querySelector('[data-share]');
    if (share) share.addEventListener('click', function () {
      var url = location.href;
      function copyLink() {
        writeClipboard(url).then(function () { toast('Link gekopieerd'); }, function () { toast('Kopiëren lukte niet'); });
      }
      if (navigator.share) {
        // Afgebroken door de gebruiker: niets doen. Delen niet toegestaan of niet mogelijk: link kopiëren.
        navigator.share({ title: treeTitle(data, treeId), url: url }).catch(function (err) {
          if (!err || err.name !== 'AbortError') copyLink();
        });
      } else {
        copyLink();
      }
    });

    if (pendingFocus) {
      pendingFocus = false;
      var target = main.querySelector('#vraag');
      if (target) {
        var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        var focusEl = target.querySelector('.q-title, .rec-card') || target;
        focusEl.setAttribute('tabindex', '-1');
        focusEl.focus({ preventScroll: true });
      }
      announce(v.question
        ? 'Nog ' + v.remaining.length + ' aanbevelingen mogelijk. Volgende vraag: ' + oneLine(GraphState.describeNode(v.question))
        : (v.outcomes.length ? 'Aanbeveling gevonden.' : 'Einde van de vragen.'));
    }
  }
  var pendingFocus = false;

  /* Samenvatting om te plakken in een verslag of bericht. */
  function summary(data, tumorId, treeId, v) {
    var zp = data.zp, tree = zp.trees[treeId] || {};
    var lines = [zp.titel + ' – ' + treeTitle(data, treeId), ''];
    lines.push('Gegevens:');
    v.answered.filter(function (a) { return a.status === 'selected'; }).forEach(function (a) {
      lines.push('- ' + oneLine(a.label) + ': ' + Flow.pretty(a.valueLabel));
    });
    v.outcomes.forEach(function (o) {
      lines.push('', 'Aanbeveling:');
      Flow.plain(o).split('\n').forEach(function (l) { lines.push(Flow.pretty(l)); });
    });
    var bron = zp.bron, tb = tree.bron;
    if (bron) {
      lines.push('', 'Bron: richtlijn ' + bron.richtlijn + (tb && tb.module ? ', module ' + tb.module : '') +
        (bron.beoordeeldOp ? ' (beoordeeld ' + date(bron.beoordeeldOp) + ')' : ''));
      if ((tb && tb.url) || bron.url) lines.push((tb && tb.url) || bron.url);
    }
    var now = new Date();
    lines.push('', 'Opgesteld met Gynaecologische zorgpaden op ' + now.getDate() + '-' + (now.getMonth() + 1) + '-' + now.getFullYear() + ':');
    lines.push(location.href);
    return lines.join('\n');
  }

  function writeClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error('copy'));
    });
  }

  /* ---------- infopagina's ---------- */

  function renderInfo(page) {
    frame({ up: { href: '#/', label: 'Alle zorgpaden' } });
    loadJSON(DATA + 'pages/' + encodeURIComponent(page) + '.json').then(function (d) {
      var html = '<h1 class="page-title">' + esc(d.title || page) + '</h1>';
      if (d.version) html += '<p class="eyebrow">Versie ' + esc(d.version) + '</p>';
      (d.sections || []).forEach(function (s) {
        html += '<h2 class="section-title">' + esc((s.number ? s.number + '. ' : '') + (s.title || '')) + '</h2>';
        (s.blocks || []).forEach(function (b) {
          if (b.items) html += '<ul class="prose-list">' + b.items.map(function (it) { return '<li>' + esc(it.text || it) + '</li>'; }).join('') + '</ul>';
          if (b.text) html += '<p class="prose">' + esc((b.number ? b.number + ' ' : '') + b.text) + '</p>';
        });
      });
      show('<div class="page">' + html + '</div>');
    }).catch(failure);
  }

  /* ---------- router ---------- */

  function route() {
    var r = parseRoute();
    var p = r.parts;
    if (!p.length) return renderHome();
    if (p[0] === 'info' && p[1]) return renderInfo(p[1]);
    if (p.length === 1) return renderZorgpad(p[0]);
    return renderTree(p[0], p[1], r.sel, r.meta, false);
  }

  /* Elke stap in de vragenlijst is een eigen item in de geschiedenis; depth telt hoeveel stappen er in deze
     sessie aan voorafgaan, zodat "Vorige vraag" alleen verschijnt als terug ook echt een vorige vraag is. */
  function depth() { return (history.state && history.state.d) || 0; }
  function navigate(href) {
    history.pushState({ d: depth() + 1 }, '', href);
    onNav();
  }
  function onNav() {
    if (location.hash === lastHash) return;
    lastHash = location.hash;
    route();
  }

  window.addEventListener('hashchange', onNav);
  window.addEventListener('popstate', onNav);
  onNav();
})();
