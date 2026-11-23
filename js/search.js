/* Zoeken over alle zorgpaden en beslisbomen (startpagina en kop van de zorgpadpagina).
   Typ bijvoorbeeld "IB1", "follow-up" of "recidief vulva": de titels van alle beslisbomen worden doorzocht, met de
   naam van het zorgpad erbij. De zorgpaden worden pas geladen bij de eerste zoekopdracht.
   Bediening als een combobox: pijltjes omhoog en omlaag, Enter opent, Escape sluit.

   API:
     Search.attach(input, { base: './' })   base: pad naar de map met zorgpad.html en data/
     Search.index(base)                      Promise<[{ tumorId, tumorTitle, treeId, title, href }]> (ook voor de startpagina) */
const Search = (function () {
  'use strict';

  let indexPromise = null;
  let counter = 0;

  function plain(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  function fetchJSON(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ': ' + r.status); return r.json(); });
  }

  /* Titel van een beslisboom: het label van de titelnode, anders het label in het overzicht. */
  function treeTitle(zp, treeId) {
    const t = zp.trees[treeId];
    const g = t && t.same ? zp.trees[t.same] : t;
    const root = g && Array.isArray(g.nodes) && g.nodes.filter(function (n) {
      return (n.type === 'title' || n.type === 'root' || n.type === 'start') && n.label;
    })[0];
    if (root) return clean(root.label);
    const ov = zp.overview && Array.isArray(zp.overview.nodes) &&
      zp.overview.nodes.filter(function (n) { return (n.to || n.id) === treeId && n.label; })[0];
    return ov ? clean(ov.label) : treeId;
  }

  function index(base) {
    base = base || './';
    if (indexPromise) return indexPromise;
    indexPromise = fetchJSON(base + 'data/tumoren.json').then(function (d) {
      const tumoren = d.tumoren || [];
      return Promise.all(tumoren.map(function (t) {
        return fetchJSON(base + 'data/' + encodeURIComponent(t.id) + '/zorgpad.json').then(function (zp) {
          const list = [{ tumorId: t.id, tumorTitle: t.titel, treeId: '', title: 'Zorgpad ' + t.titel,
            href: base + 'zorgpad.html?tumor=' + encodeURIComponent(t.id), trees: Object.keys(zp.trees || {}).length }];
          Object.keys(zp.trees || {}).forEach(function (treeId) {
            list.push({ tumorId: t.id, tumorTitle: t.titel, treeId: treeId, title: treeTitle(zp, treeId),
              href: base + 'zorgpad.html?tumor=' + encodeURIComponent(t.id) + '#/' + encodeURIComponent(treeId) });
          });
          return list;
        }, function () { return []; });
      })).then(function (lists) { return [].concat.apply([], lists); });
    });
    indexPromise.catch(function () { indexPromise = null; });
    return indexPromise;
  }

  function find(items, query) {
    const words = plain(query).split(' ').filter(Boolean);
    if (!words.length) return [];
    const hits = [];
    items.forEach(function (it) {
      const title = plain(it.title), hay = title + ' ' + plain(it.tumorTitle);
      if (!words.every(function (w) { return hay.indexOf(w) >= 0; })) return;
      let score = 0;
      if (title.indexOf(words[0]) === 0) score -= 3;
      if (words.every(function (w) { return title.indexOf(w) >= 0; })) score -= 2;
      if (!it.treeId) score -= 1;
      hits.push({ it: it, score: score });
    });
    hits.sort(function (a, b) { return a.score - b.score || a.it.title.localeCompare(b.it.title, 'nl'); });
    return hits.slice(0, 12).map(function (h) { return h.it; });
  }

  function attach(input, opts) {
    const base = (opts && opts.base) || './';
    const id = 'zoek-' + (++counter);
    const wrap = input.parentNode;
    const list = document.createElement('ul');
    list.className = 'search-results';
    list.id = id + '-lijst';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Zoekresultaten');
    list.hidden = true;
    wrap.appendChild(list);
    const status = document.createElement('span');
    status.className = 'visually-hidden';
    status.setAttribute('role', 'status');
    wrap.appendChild(status);

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', list.id);
    input.setAttribute('autocomplete', 'off');

    let results = [], active = -1, timer = null, seq = 0;

    function setActive(i) {
      active = i;
      Array.prototype.forEach.call(list.children, function (li, j) {
        li.setAttribute('aria-selected', j === i ? 'true' : 'false');
        if (j === i) li.scrollIntoView({ block: 'nearest' });
      });
      if (i >= 0 && list.children[i]) input.setAttribute('aria-activedescendant', list.children[i].id);
      else input.removeAttribute('aria-activedescendant');
    }

    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      setActive(-1);
    }

    function render(query) {
      list.textContent = '';
      results.forEach(function (r, i) {
        const li = document.createElement('li');
        li.id = id + '-' + i;
        li.setAttribute('role', 'option');
        li.className = 'search-result';
        const a = document.createElement('a');
        a.href = r.href;
        a.tabIndex = -1;
        const t = document.createElement('span');
        t.className = 'search-title';
        t.textContent = r.title;
        const s = document.createElement('span');
        s.className = 'search-sub';
        s.textContent = r.treeId ? r.tumorTitle : 'Zorgpad';
        a.appendChild(t);
        a.appendChild(s);
        li.appendChild(a);
        li.addEventListener('mousedown', function (ev) { ev.preventDefault(); });   // focus blijft in het veld
        list.appendChild(li);
      });
      if (!results.length) {
        const li = document.createElement('li');
        li.className = 'search-empty';
        li.textContent = 'Geen beslisboom gevonden voor ‘' + query + '’';
        list.appendChild(li);
      }
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      setActive(results.length ? 0 : -1);
      status.textContent = results.length ? results.length + ' resultaten' : 'Geen resultaten';
    }

    function run() {
      const q = input.value;
      if (plain(q).length < 2) { results = []; close(); return; }
      const mine = ++seq;
      index(base).then(function (items) {
        if (mine !== seq) return;
        results = find(items, q);
        render(q.trim());
      });
    }

    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 120); });
    input.addEventListener('focus', function () { if (plain(input.value).length >= 2) run(); else index(base); });
    input.addEventListener('blur', function () { setTimeout(close, 120); });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); if (list.hidden) run(); else if (results.length) setActive((active + 1) % results.length); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); if (results.length) setActive((active - 1 + results.length) % results.length); }
      else if (ev.key === 'Enter') {
        if (!list.hidden && results[active]) { ev.preventDefault(); location.href = results[active].href; close(); }
      } else if (ev.key === 'Escape') {
        if (!list.hidden) { ev.preventDefault(); ev.stopPropagation(); close(); } else { input.value = ''; }
      }
    });
    // Navigeren binnen hetzelfde zorgpad verandert alleen de hash: het veld leegmaken.
    window.addEventListener('hashchange', function () { input.value = ''; close(); });
  }

  return { attach: attach, index: index };
})();
