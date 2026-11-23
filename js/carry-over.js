/* Keuzes meenemen naar een vervolgboom.
   Een gegeven dat in een eerdere beslisboom van hetzelfde zorgpad al is ingevuld (bv. "Fertiliteit: Behouden"),
   komt vaak in de volgende boom terug. Deze module stelt voor om die waarde over te nemen; de gebruiker
   bevestigt dat met één klik. Er wordt nooit iets stil overgenomen.

   Wanneer is het "hetzelfde gegeven"?
   - dezelfde dataKey (of anders hetzelfde label) als in de andere boom (GraphState.dataKey), én
   - de nieuwe boom heeft een optie met dezelfde waarde én hetzelfde label.
   Komt een gegeven in meerdere eerdere bomen voor met verschillende waarden, dan wordt het niet voorgesteld.

   API:
     CarryOver.candidates({ graph, treeId, selectionsByTree, graphOf(treeId), titleOf(treeId) })
       → [{ nodeId, value, nodeLabel, optionLabel, fromTitle }]
     const bar = CarryOver.createBar({ container, before, onApply(list), onDismiss(), onHeight(px) });
       onHeight: de balk verschijnt of verdwijnt (hoogte in px, 0 = weg), zodat knoppen erboven kunnen opschuiven.
     bar.show(list) / bar.hide() */
const CarryOver = (function () {
  'use strict';

  function clean(s) { return String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function pretty(s) { return clean(s).replace(/<=/g, '≤').replace(/>=/g, '≥'); }

  function optionOf(node, value) {
    return (node.options || []).filter(function (o) { return o.value === value; })[0] || null;
  }
  function optionLabel(o) { return clean(o.label !== undefined ? o.label : o.value); }

  function candidates(o) {
    const graph = o.graph;
    if (!graph || !GraphState.isInteractive(graph)) return [];
    const own = o.selectionsByTree[o.treeId] || {};
    // Gegevens die in deze boom nog leeg zijn, per dataKey de eerste keuzenode in invulvolgorde.
    const byKey = {}, order = [];
    const nodes = {};
    graph.nodes.forEach(function (n) { nodes[n.id] = n; });
    GraphState.choiceOrder(graph).forEach(function (id) {
      const n = nodes[id], key = GraphState.dataKey(n);
      if (own[id] !== undefined) { byKey[key] = null; return; }   // al ingevuld in deze boom: niet voorstellen
      if (byKey[key] === undefined) { byKey[key] = n; order.push(key); }
    });
    // Bekende waarden uit de andere bomen.
    const known = {};   // key -> { value, label, from } of false bij tegenstrijdige waarden
    Object.keys(o.selectionsByTree).forEach(function (treeId) {
      if (treeId === o.treeId) return;
      const g = o.graphOf(treeId);
      if (!g) return;
      const sel = o.selectionsByTree[treeId];
      g.nodes.forEach(function (m) {
        if (!GraphState.isChoice(m) || sel[m.id] === undefined) return;
        const key = GraphState.dataKey(m);
        if (!byKey[key]) return;
        const opt = optionOf(m, sel[m.id]);
        if (!opt) return;
        const entry = { value: sel[m.id], label: optionLabel(opt), from: treeId };
        if (known[key] === undefined) known[key] = entry;
        else if (known[key] && (known[key].value !== entry.value || known[key].label !== entry.label)) known[key] = false;
      });
    });
    const out = [];
    order.forEach(function (key) {
      const n = byKey[key], k = known[key];
      if (!n || !k) return;
      const opt = optionOf(n, k.value);
      if (!opt || optionLabel(opt) !== k.label) return;   // zelfde waarde, ander label: niet zeker hetzelfde
      out.push({
        nodeId: n.id, value: k.value,
        nodeLabel: pretty(GraphState.describeNode(n)), optionLabel: pretty(k.label),
        fromTitle: o.titleOf(k.from)
      });
    });
    return out;
  }

  function createBar(o) {
    const bar = document.createElement('div');
    bar.className = 'carry-bar';
    bar.hidden = true;
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Gegevens uit eerdere beslisbomen');
    const text = document.createElement('p');
    text.className = 'carry-text';
    const actions = document.createElement('div');
    actions.className = 'carry-actions';
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'carry-apply';
    apply.textContent = 'Overnemen';
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'carry-dismiss';
    dismiss.textContent = 'Niet nu';
    actions.appendChild(apply);
    actions.appendChild(dismiss);
    bar.appendChild(text);
    bar.appendChild(actions);
    o.container.insertBefore(bar, o.before || null);

    let current = [];
    apply.addEventListener('click', function () { const l = current; hide(); o.onApply(l); });
    dismiss.addEventListener('click', function () { hide(); o.onDismiss(); });

    function show(list) {
      current = list || [];
      if (!current.length) { hide(); return; }
      text.textContent = '';
      const strong = document.createElement('strong');
      strong.textContent = 'Al bekend uit ' + (unique(current.map(function (c) { return c.fromTitle; })).join(', ')) + ': ';
      text.appendChild(strong);
      text.appendChild(document.createTextNode(current.map(function (c) { return c.nodeLabel + ': ' + c.optionLabel; }).join(' · ')));
      apply.textContent = current.length === 1 ? 'Overnemen' : 'Alle ' + current.length + ' overnemen';
      bar.hidden = false;
      if (o.onHeight) o.onHeight(bar.offsetHeight + 8);
    }
    function hide() {
      const was = !bar.hidden;
      bar.hidden = true;
      current = [];
      if (was && o.onHeight) o.onHeight(0);
    }
    function unique(list) { return list.filter(function (x, i) { return list.indexOf(x) === i; }); }

    return { show: show, hide: hide };
  }

  return { candidates: candidates, createBar: createBar };
})();
