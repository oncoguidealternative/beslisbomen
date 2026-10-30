/* Paneel met patiëntinformatie: links naast het diagram, zelf in en uit te klappen.
   Een derde manier om keuzes in te voeren, naast het keuzevenster en de connectoren. Elke keuze gaat via hetzelfde
   selectiepad in app.js, dus boom, keuzevenster, aanbevelingen en dit paneel blijven altijd gelijk.

   Inhoud: de keuzenodes van de getoonde beslisboom, in invulvolgorde (GraphState.choiceOrder).
   Keuzenodes met hetzelfde gegeven worden één regel: een gegeven over de patiënt (bv. "Eerdere behandeling
   primaire tumor") kan in meerdere takken van de boom voorkomen. Hetzelfde gegeven = zelfde "dataKey" op de node,
   of anders hetzelfde label. Een keuze in het paneel geldt voor alle nodes van dat gegeven die de waarde kennen.

   Werkt voor elke beslisboom zonder extra gegevens; bevat geen medische of tumorspecifieke inhoud.

   API:
     PatientPanel.create({
       refs,                                   // { main, stage }
       onSelect(treeId, nodeIds, value, info), // info: { nodeLabel, optionLabel }
       onClear(treeId, nodeIds, info),
       onClearAll(treeId),
       onLocate(nodeId),                       // brengt een node in beeld (bij openklappen van een regel)
       onSubtree({ nodeId, tree, label }),     // opent de hulpbeslisboom van een node
       onResize(oldWidth, newWidth)            // het werkvlak is smaller of breder geworden
     })
     → { setTree({ treeId, label, graph }), refresh(status, values), isOpen(), open(), close() } */
const PatientPanel = (function () {
  'use strict';

  const STORAGE_KEY = 'zp-patientpanel-open';
  // Volgorde waarin de status van een gegeven wordt bepaald als het in meerdere nodes voorkomt.
  const RANK = { selected: 5, preselected: 4, available: 3, inactive: 2, normal: 1, excluded: 0 };

  function make(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function readOpen() {
    try { return window.localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { return false; }
  }
  function writeOpen(open) {
    try { window.localStorage.setItem(STORAGE_KEY, open ? '1' : '0'); } catch (e) { /* geen opslag: geen probleem */ }
  }

  function keyOf(node) {
    if (node.dataKey) return 'k:' + String(node.dataKey);
    return 'l:' + String(node.label || node.id).replace(/\s+/g, ' ').trim().toLowerCase();
  }

  let counter = 0;

  function create(options) {
    const refs = options.refs;
    const handlers = {
      onSelect: options.onSelect || function () {},
      onClear: options.onClear || function () {},
      onClearAll: options.onClearAll || function () {},
      onLocate: options.onLocate || function () {},
      onSubtree: options.onSubtree || function () {},
      onResize: options.onResize || function () {}
    };

    let treeId = null;
    let groups = [];          // [{ key, label, nodeIds, options: [{value,label}], subtree, el, ... }]
    let expandedKey = null;   // het opengeklapte gegeven (accordeon: één tegelijk)
    let lastValues = {};      // { groupKey: waarde } bij de vorige refresh, om "net beantwoord" te herkennen
    let lastStatus = null;
    let lastSelections = {};

    // ----- Opbouw -----
    // Het werkvlak (stage) komt samen met het paneel in een rij, zodat het paneel ruimte inneemt in plaats van
    // het diagram te bedekken.
    const work = make('div', 'zp-work');
    refs.stage.parentNode.insertBefore(work, refs.stage);

    const panel = make('aside', 'pp');
    panel.id = 'pp-panel';
    panel.hidden = true;
    panel.setAttribute('aria-labelledby', 'pp-title');

    const head = make('div', 'pp-head');
    const titleBox = make('div', 'pp-titlebox');
    const title = make('h2', 'pp-title', 'Patiëntinformatie');
    title.id = 'pp-title';
    const subtitle = make('p', 'pp-subtitle');
    titleBox.appendChild(title);
    titleBox.appendChild(subtitle);
    const collapse = make('button', 'pp-collapse');
    collapse.type = 'button';
    collapse.setAttribute('aria-label', 'Paneel patiëntinformatie inklappen');
    collapse.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M15 5 8 12l7 7"/></svg>';
    head.appendChild(titleBox);
    head.appendChild(collapse);

    const list = make('div', 'pp-list');
    const empty = make('p', 'pp-empty', 'Deze beslisboom heeft geen gegevens om in te vullen.');
    empty.hidden = true;

    const foot = make('div', 'pp-foot');
    const clearAll = make('button', 'pp-btn pp-clear-all', 'Alles wissen');
    clearAll.type = 'button';
    foot.appendChild(clearAll);

    panel.appendChild(head);
    panel.appendChild(list);
    panel.appendChild(empty);
    panel.appendChild(foot);

    const tab = make('button', 'zp-btn pp-tab');
    tab.type = 'button';
    tab.setAttribute('aria-controls', 'pp-panel');
    tab.setAttribute('aria-expanded', 'false');
    tab.innerHTML = '<span>Patiëntinformatie</span><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
    tab.hidden = true;

    work.appendChild(panel);
    work.appendChild(refs.stage);
    work.appendChild(tab);

    // Gebeurtenissen in het paneel mogen het diagram niet laten slepen of zoomen.
    ['pointerdown', 'wheel', 'dblclick'].forEach(function (type) {
      panel.addEventListener(type, function (ev) { ev.stopPropagation(); }, { passive: true });
    });

    // ----- Openen en sluiten -----
    function isOpen() { return !panel.hidden; }

    function setOpen(open, focus) {
      if (open === isOpen()) return;
      const before = refs.stage.clientWidth;
      panel.hidden = !open;
      tab.hidden = open || groups.length === 0;
      tab.setAttribute('aria-expanded', open ? 'true' : 'false');
      refs.main.classList.toggle('pp-open', open);
      writeOpen(open);
      handlers.onResize(before, refs.stage.clientWidth);
      if (focus) (open ? collapse : tab).focus();
    }

    tab.addEventListener('click', function () { setOpen(true, true); });
    collapse.addEventListener('click', function () { setOpen(false, true); });
    panel.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { ev.stopPropagation(); setOpen(false, true); }
    });

    clearAll.addEventListener('click', function () {
      if (treeId) handlers.onClearAll(treeId);
    });

    // ----- Inhoud per boom -----
    function buildGroups(graph) {
      const byKey = {};
      const out = [];
      GraphState.choiceOrder(graph).forEach(function (id) {
        const node = graph.nodes.filter(function (n) { return n.id === id; })[0];
        if (!node) return;
        const key = keyOf(node);
        let g = byKey[key];
        if (!g) {
          g = { key: key, label: node.label || GraphState.describeNode(node), nodeIds: [], options: [], optionNodes: {}, subtree: null };
          byKey[key] = g;
          out.push(g);
        }
        g.nodeIds.push(id);
        node.options.forEach(function (o) {
          (g.optionNodes[o.value] = g.optionNodes[o.value] || []).push(id);
          if (!g.options.some(function (x) { return x.value === o.value; })) g.options.push({ value: o.value, label: o.label });
        });
        const sub = GraphState.subtreeOf(node);
        if (sub && !g.subtree) g.subtree = { nodeId: id, tree: sub.tree, label: node.label };
      });
      return out;
    }

    function renderGroup(g) {
      const id = 'pp-g' + (++counter);
      const row = make('div', 'pp-row');
      const button = make('button', 'pp-row-head');
      button.type = 'button';
      button.id = id + '-head';
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-controls', id + '-body');
      const name = make('span', 'pp-label', g.label);
      const value = make('span', 'pp-value');
      const chevron = make('span', 'pp-chevron');
      chevron.setAttribute('aria-hidden', 'true');
      button.appendChild(name);
      button.appendChild(value);
      button.appendChild(chevron);

      const body = make('div', 'pp-row-body');
      body.id = id + '-body';
      body.hidden = true;
      const fieldset = make('fieldset', 'pp-options');
      const legend = make('legend', 'pp-sr', g.label);
      fieldset.appendChild(legend);
      const radios = [];
      g.options.forEach(function (o) {
        const label = make('label', 'pp-option');
        const input = make('input');
        input.type = 'radio';
        input.name = id;
        input.value = o.value;
        const text = make('span', null, o.label);
        label.appendChild(input);
        label.appendChild(text);
        fieldset.appendChild(label);
        radios.push({ input: input, label: label, option: o });
        input.addEventListener('change', function () {
          if (!input.checked || !treeId) return;
          handlers.onSelect(treeId, targetsFor(g, o.value), o.value, { nodeLabel: g.label, optionLabel: o.label, source: 'panel' });
        });
      });
      body.appendChild(fieldset);

      const actions = make('div', 'pp-actions');
      const clear = make('button', 'pp-btn pp-clear', 'Wissen');
      clear.type = 'button';
      clear.addEventListener('click', function () {
        if (!treeId) return;
        const withValue = g.nodeIds.filter(function (nid) { return lastSelections[nid] !== undefined; });
        if (withValue.length) handlers.onClear(treeId, withValue, { nodeLabel: g.label, source: 'panel' });
        radios.forEach(function (r) { r.input.checked = false; });
      });
      actions.appendChild(clear);
      if (g.subtree) {
        const sub = make('button', 'pp-btn pp-subtree', 'Bepalen met hulpbeslisboom');
        sub.type = 'button';
        sub.addEventListener('click', function () { handlers.onSubtree(g.subtree); });
        actions.appendChild(sub);
      }
      body.appendChild(actions);

      row.appendChild(button);
      row.appendChild(body);
      button.addEventListener('click', function () {
        const open = expandedKey !== g.key;
        expand(open ? g.key : null);
        if (open) handlers.onLocate(primaryNode(g));
      });

      g.el = row; g.button = button; g.value = value; g.body = body; g.radios = radios; g.clear = clear;
      return row;
    }

    function expand(key) {
      expandedKey = key;
      groups.forEach(function (g) {
        const open = g.key === key;
        g.body.hidden = !open;
        g.button.setAttribute('aria-expanded', open ? 'true' : 'false');
        g.el.classList.toggle('is-open', open);
      });
    }

    // De node(s) waarvoor een waarde wordt ingevuld: alle nodes van het gegeven die de waarde kennen en nog
    // mogelijk zijn. Valt alles af, dan de eerste node die de waarde kent.
    function targetsFor(g, value) {
      const graph = currentGraph;
      const knows = g.nodeIds.filter(function (nid) {
        const n = graph.nodes.filter(function (x) { return x.id === nid; })[0];
        return n && n.options.some(function (o) { return o.value === value; });
      });
      const possible = knows.filter(function (nid) { return !lastStatus || lastStatus.nodes[nid] !== 'excluded'; });
      return possible.length ? possible : knows.slice(0, 1);
    }

    // De node die het gegeven in de boom vertegenwoordigt: die op de route, anders de eerstvolgende.
    function primaryNode(g) {
      if (!lastStatus) return g.nodeIds[0];
      let best = g.nodeIds[0], rank = -1;
      g.nodeIds.forEach(function (nid) {
        const r = RANK[lastStatus.nodes[nid]] || 0;
        if (r > rank) { rank = r; best = nid; }
      });
      return best;
    }

    let currentGraph = null;

    function setTree(view) {
      treeId = view.treeId || null;
      currentGraph = view.graph || null;
      list.replaceChildren();
      groups = currentGraph && GraphState.isInteractive(currentGraph) ? buildGroups(currentGraph) : [];
      groups.forEach(function (g) { list.appendChild(renderGroup(g)); });
      subtitle.textContent = view.label || '';
      empty.hidden = groups.length > 0;
      foot.hidden = groups.length === 0;
      expandedKey = null;
      lastValues = {};
      lastStatus = null;
      // Zonder invoervelden geen paneel en geen tab; met invoervelden de laatst gekozen stand.
      const wantOpen = groups.length > 0 && readOpen();
      if (groups.length === 0) {
        if (isOpen()) { const before = refs.stage.clientWidth; panel.hidden = true; refs.main.classList.remove('pp-open'); handlers.onResize(before, refs.stage.clientWidth); }
        tab.hidden = true;
      } else {
        tab.hidden = wantOpen;
        if (wantOpen !== isOpen()) {
          panel.hidden = !wantOpen;
          refs.main.classList.toggle('pp-open', wantOpen);
          tab.setAttribute('aria-expanded', wantOpen ? 'true' : 'false');
        }
      }
    }

    // status = GraphState.compute(...), values = { nodeId: waarde } van de getoonde boom.
    function refresh(status, values) {
      if (!groups.length) return;
      lastStatus = status;
      lastSelections = values || {};
      let answeredOpenGroup = false;
      groups.forEach(function (g) {
        let st = 'excluded', rank = -1, val, valNode = null;
        g.nodeIds.forEach(function (nid) {
          const s = status.nodes[nid] || 'normal';
          if ((RANK[s] || 0) > rank) { rank = RANK[s] || 0; st = s; }
          if (lastSelections[nid] !== undefined && (valNode === null || s === 'selected')) { val = lastSelections[nid]; valNode = nid; }
        });
        const option = g.options.filter(function (o) { return o.value === val; })[0];
        const valueText = option ? option.label : '';
        g.value.textContent = valueText;
        g.el.dataset.state = st;
        g.el.classList.toggle('has-value', val !== undefined);
        g.el.classList.toggle('is-ahead', val !== undefined && st === 'preselected');
        const disabled = st === 'excluded' && val === undefined;
        g.button.disabled = disabled;
        g.button.setAttribute('aria-label', g.label + ': ' +
          (disabled ? 'niet van toepassing' : valueText ? valueText + (st === 'preselected' ? ' (alvast ingevuld)' : '') : 'nog niet ingevuld'));
        // Een waarde die alleen bestaat in takken die al zijn uitgesloten, is niet meer te kiezen.
        g.radios.forEach(function (r) {
          const possible = (g.optionNodes[r.option.value] || []).some(function (nid) { return status.nodes[nid] !== 'excluded'; });
          r.input.checked = r.option.value === val;
          r.input.disabled = disabled || (!possible && r.option.value !== val);
          r.label.classList.toggle('is-disabled', r.input.disabled);
        });
        g.clear.disabled = val === undefined;
        if (g.key === expandedKey && val !== undefined && lastValues[g.key] !== val) answeredOpenGroup = true;
        lastValues[g.key] = val;
      });
      clearAll.disabled = Object.keys(lastSelections).length === 0;
      // Eerste keer, of het opengeklapte gegeven is net beantwoord: door naar het eerstvolgende open gegeven.
      const current = groups.filter(function (g) { return g.key === expandedKey; })[0];
      if (!current || answeredOpenGroup || current.button.disabled) {
        // Stond de focus in de regel die nu dichtklapt, dan gaat hij mee naar de volgende regel (anders raakt hij kwijt).
        const focusInside = current && current.el.contains(document.activeElement);
        const next = groups.filter(function (g) { return g.el.dataset.state === 'available'; })[0];
        expand(next ? next.key : (answeredOpenGroup ? null : expandedKey));
        if (focusInside) {
          let target = current.button;
          if (next && next !== current) {
            const radio = next.radios.filter(function (r) { return !r.input.disabled; })[0];
            target = radio ? radio.input : next.button;
          }
          target.focus();
        }
      }
    }

    return { setTree: setTree, refresh: refresh, isOpen: isOpen, open: function () { setOpen(true, false); }, close: function () { setOpen(false, false); } };
  }

  return { create: create };
})();
