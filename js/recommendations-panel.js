/* Aanbevelingenoverzicht per beslisboom (HTML-paneel naast het diagram).
   - Toont alle aanbevelingen (outcomes) van de getoonde boom en per aanbeveling de combinaties van voorwaarden
     (binnen een route "en", tussen routes "of"), afgeleid door GraphState.recommendations.
   - Klik op een aanbeveling of route: de aanroeper (app.js) markeert de route in de boom en brengt de
     aanbeveling in beeld (callback onShow); nogmaals klikken of "Markering wissen" haalt de markering weg.
   - Houdt geen medische of tumorspecifieke kennis, en geen applicatiestatus: alles komt uit de graph en de
     status die app.js meegeeft. De actieve markering is alleen weergavestatus van dit paneel.

   API:
     init({ host, stage, onShow(target), onClear() })
       host: element waarin de knop en het paneel komen (moet position: relative hebben, zie CSS)
       stage: het werkvlak van het diagram (voor coveredInsets)
       target: { targetId, nodeIds, edgeIds, label }
     setTree({ treeId, graph })   berekent het overzicht voor de getoonde boom (graph null = geen overzicht)
     refresh(status)              werkt badges en voorwaarden bij; status = GraphState.compute(...)
     close(returnFocus), isOpen(), clearActive()
     coveredInsets()              { right, bottom }: hoeveel van het werkvlak het paneel (open) afdekt */
const RecommendationsPanel = (function () {
  'use strict';

  var host = null, stage = null, handlers = { onShow: function () {}, onClear: function () {} };
  var bar, toggle, clearButton, panel, listEl, noteEl, live;
  var items = [];            // [{ rec, el, titleButton, badge, routes: [{ route, el, button, state, conds: [..] }] }]
  var active = null;         // { rec: index, route: index | null }
  var lastStatus = null;
  var built = false;

  function make(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function build() {
    if (built || !host) return;
    built = true;

    bar = make('div', 'rec-bar');
    bar.hidden = true;

    clearButton = make('button', 'zp-btn rec-clear', 'Markering wissen');
    clearButton.type = 'button';
    clearButton.hidden = true;
    clearButton.addEventListener('click', function () { clearActive(); announce('Markering gewist.'); });

    toggle = make('button', 'zp-btn rec-toggle', 'Aanbevelingen');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'rec-panel');
    toggle.addEventListener('click', function () { if (isOpen()) close(true); else open(); });

    bar.appendChild(clearButton);
    bar.appendChild(toggle);

    panel = make('section', 'rec-panel');
    panel.id = 'rec-panel';
    panel.hidden = true;
    panel.setAttribute('aria-labelledby', 'rec-panel-title');

    var head = make('div', 'rec-panel-head');
    var title = make('h2', 'rec-panel-title', 'Aanbevelingen');
    title.id = 'rec-panel-title';
    var closeButton = make('button', 'rec-close', '×');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Aanbevelingen sluiten');
    closeButton.addEventListener('click', function () { close(true); });
    head.appendChild(title);
    head.appendChild(closeButton);

    var hint = make('p', 'rec-hint', 'Klik op een aanbeveling of route om die in de beslisboom te markeren.');
    noteEl = make('p', 'rec-note');
    noteEl.hidden = true;
    listEl = make('ul', 'rec-list');
    live = make('div', 'visually-hidden');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');

    panel.appendChild(head);
    panel.appendChild(hint);
    panel.appendChild(noteEl);
    panel.appendChild(listEl);
    panel.appendChild(live);

    // Escape sluit het paneel, maar alleen als de focus in de knop of het paneel zit.
    function onKey(ev) {
      if (ev.key === 'Escape' && isOpen()) { ev.stopPropagation(); close(true); }
    }
    bar.addEventListener('keydown', onKey);
    panel.addEventListener('keydown', onKey);

    host.appendChild(bar);
    host.appendChild(panel);
  }

  function announce(text) {
    if (!live) return;
    live.textContent = '';
    // kort uitstellen zodat dezelfde tekst opnieuw wordt voorgelezen
    setTimeout(function () { live.textContent = text; }, 30);
  }

  function isOpen() { return !!panel && !panel.hidden; }

  function open() {
    if (!panel || !items.length) return;
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
  }

  function close(returnFocus) {
    if (!panel) return;
    var hadFocus = panel.contains(document.activeElement);
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (returnFocus && hadFocus) toggle.focus();
  }

  function unionOf(lists) {
    var seen = {}, out = [];
    lists.forEach(function (list) {
      list.forEach(function (x) { if (!seen[x]) { seen[x] = true; out.push(x); } });
    });
    return out;
  }

  function targetFor(index, routeIndex) {
    var entry = items[index];
    var routes = routeIndex === null ? entry.rec.routes : [entry.rec.routes[routeIndex]];
    return {
      targetId: entry.rec.id,
      label: entry.rec.label,
      nodeIds: unionOf(routes.map(function (r) { return r.nodeIds; })),
      edgeIds: unionOf(routes.map(function (r) { return r.edgeIds; }))
    };
  }

  function updateActiveMarks() {
    items.forEach(function (entry, i) {
      var titleOn = !!active && active.rec === i && active.route === null;
      entry.titleButton.setAttribute('aria-pressed', titleOn ? 'true' : 'false');
      entry.el.classList.toggle('is-active', !!active && active.rec === i);
      entry.routes.forEach(function (r, j) {
        var on = !!active && active.rec === i && active.route === j;
        r.button.setAttribute('aria-pressed', on ? 'true' : 'false');
        r.el.classList.toggle('is-active', on || titleOn);
      });
    });
    clearButton.hidden = !active;
  }

  function activate(index, routeIndex) {
    if (active && active.rec === index && active.route === routeIndex) {
      clearActive();
      announce('Markering gewist.');
      return;
    }
    active = { rec: index, route: routeIndex };
    updateActiveMarks();
    handlers.onShow(targetFor(index, routeIndex));
    var entry = items[index];
    announce(routeIndex === null
      ? 'Alle routes naar ' + entry.rec.label + ' gemarkeerd in de beslisboom.'
      : 'Route naar ' + entry.rec.label + ' gemarkeerd in de beslisboom.');
  }

  /* Haalt de markering weg (ook in de boom, via onClear). */
  function clearActive() {
    var had = !!active;
    active = null;
    if (built) updateActiveMarks();
    if (had) handlers.onClear();
  }

  function conditionText(c) { return c.nodeLabel + ': ' + c.valueLabel; }

  function buildItem(rec, index) {
    var entry = { rec: rec, routes: [] };
    var li = make('li', 'rec-item');
    entry.el = li;

    var head = make('div', 'rec-head');
    var titleButton = make('button', 'rec-title', rec.label);
    titleButton.type = 'button';
    titleButton.setAttribute('aria-pressed', 'false');
    titleButton.addEventListener('click', function () { activate(index, null); });
    var badge = make('span', 'rec-badge');
    badge.hidden = true;
    head.appendChild(titleButton);
    head.appendChild(badge);
    li.appendChild(head);
    entry.titleButton = titleButton;
    entry.badge = badge;

    // Volledige tekst van de aanbeveling, alleen als die meer bevat dan de titel.
    var lines = GraphState.describeNodeLines(rec.node);
    var full = lines.join(' ').replace(/\s+/g, ' ').trim();
    if (lines.length && full !== rec.label) {
      var details = make('details', 'rec-details');
      details.appendChild(make('summary', null, 'Volledige tekst'));
      var body = make('p', 'rec-fulltext', lines.join('\n'));
      details.appendChild(body);
      li.appendChild(details);
    }

    var routesEl = make('ul', 'rec-routes');
    rec.routes.forEach(function (route, j) {
      var item = make('li', 'rec-route-item');
      if (j > 0) item.appendChild(make('span', 'rec-or', 'of'));
      var button = make('button', 'rec-route');
      button.type = 'button';
      button.setAttribute('aria-pressed', 'false');
      var conds = [];
      if (!route.conditions.length) {
        button.appendChild(make('span', 'rec-cond rec-cond-none', 'Geen voorwaarden'));
      }
      route.conditions.forEach(function (c, k) {
        var span = make('span', 'rec-cond');
        span.setAttribute('data-node-id', c.nodeId);
        span.setAttribute('data-value', String(c.value));
        var mark = make('span', 'rec-mark');
        mark.setAttribute('aria-hidden', 'true');
        var text = make('span', 'rec-cond-text', (k > 0 ? 'en ' : '') + conditionText(c));
        var sr = make('span', 'visually-hidden');
        span.appendChild(mark);
        span.appendChild(text);
        span.appendChild(sr);
        button.appendChild(span);
        conds.push({ el: span, mark: mark, sr: sr, condition: c });
      });
      var state = make('span', 'rec-route-state');
      state.hidden = true;
      button.appendChild(state);
      button.addEventListener('click', function () { activate(index, j); });
      item.appendChild(button);
      routesEl.appendChild(item);
      entry.routes.push({ route: route, el: item, button: button, state: state, conds: conds });
    });
    li.appendChild(routesEl);
    return entry;
  }

  /* Bouwt het overzicht voor de getoonde boom (of verbergt het als er niets te tonen is). */
  function setTree(view) {
    build();
    if (!built) return;
    active = null;
    items = [];
    lastStatus = null;
    listEl.textContent = '';
    noteEl.hidden = true;
    close(false);

    var result = { recommendations: [], truncated: false };
    if (view && view.treeId && view.graph) {
      try {
        result = GraphState.recommendations(view.graph);
      } catch (err) {
        console.warn('[RecommendationsPanel] Aanbevelingen berekenen mislukt:', err);
      }
    }

    result.recommendations.forEach(function (rec, i) {
      var entry = buildItem(rec, i);
      items.push(entry);
      listEl.appendChild(entry.el);
    });

    if (result.truncated) {
      noteEl.textContent = 'Deze beslisboom heeft zeer veel routes; het overzicht is mogelijk onvolledig.';
      noteEl.hidden = false;
    }
    toggle.textContent = 'Aanbevelingen (' + items.length + ')';
    bar.hidden = items.length === 0;
    clearButton.hidden = true;
  }

  var BADGES = { selected: 'bereikt', excluded: 'niet meer mogelijk' };
  var ROUTE_TEXT = { reached: 'gevolgd', conflict: 'niet meer mogelijk' };
  var COND_MARK = { met: '✓', conflict: '✗', open: '' };
  var COND_SR = { met: ' (gekozen)', conflict: ' (andere keuze gemaakt)', open: '' };

  /* Werkt badges en voorwaarden bij met de status uit GraphState.compute (zonder het overzicht opnieuw op te bouwen). */
  function refresh(status) {
    if (!built || !status) return;
    lastStatus = status;
    var selections = status.selections || {};
    items.forEach(function (entry) {
      var st = (status.nodes && status.nodes[entry.rec.id]) || 'normal';
      var text = BADGES[st] || '';
      entry.badge.textContent = text;
      entry.badge.hidden = !text;
      entry.badge.className = 'rec-badge' + (text ? ' is-' + st : '');
      entry.el.classList.toggle('is-reached', st === 'selected');
      entry.el.classList.toggle('is-excluded', st === 'excluded');
      entry.routes.forEach(function (r) {
        var rs = GraphState.routeStatus(r.route.conditions, selections);
        r.el.classList.toggle('is-reached', rs.state === 'reached' && r.route.conditions.length > 0);
        r.el.classList.toggle('is-conflict', rs.state === 'conflict');
        var routeText = r.route.conditions.length ? (ROUTE_TEXT[rs.state] || '') : '';
        r.state.textContent = routeText;
        r.state.hidden = !routeText;
        r.conds.forEach(function (c, k) {
          var cs = rs.conditions[k];
          c.el.setAttribute('data-state', cs);
          c.mark.textContent = COND_MARK[cs] || '';
          c.sr.textContent = COND_SR[cs] || '';
        });
      });
    });
  }

  /* Hoeveel van het werkvlak het open paneel afdekt, zodat app.js een node in het vrije deel kan centreren. */
  function coveredInsets() {
    var none = { right: 0, bottom: 0 };
    if (!isOpen() || !stage) return none;
    var p = panel.getBoundingClientRect();
    var s = stage.getBoundingClientRect();
    var overlapX = Math.min(p.right, s.right) - Math.max(p.left, s.left);
    var overlapY = Math.min(p.bottom, s.bottom) - Math.max(p.top, s.top);
    if (overlapX <= 0 || overlapY <= 0) return none;
    // Een zijpaneel (rechts) dekt breedte af; een paneel onderin (smal scherm) dekt hoogte af.
    if (p.width < s.width * 0.8) return { right: Math.max(0, s.right - p.left), bottom: 0 };
    return { right: 0, bottom: Math.max(0, s.bottom - p.top) };
  }

  function init(options) {
    host = options.host;
    stage = options.stage || null;
    handlers.onShow = options.onShow || handlers.onShow;
    handlers.onClear = options.onClear || handlers.onClear;
    build();
  }

  return {
    init: init,
    setTree: setTree,
    refresh: refresh,
    close: close,
    isOpen: isOpen,
    clearActive: clearActive,
    coveredInsets: coveredInsets
  };
})();
