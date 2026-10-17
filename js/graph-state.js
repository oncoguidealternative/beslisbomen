/* Generieke graph-berekeningen voor interactieve beslisbomen.
   Leest uitsluitend de graph (nodes + edges met id/from/to/value) en de selecties die worden meegegeven.
   Raakt geen DOM aan, tekent niets en bevat geen medische beslislogica.

   Begrippen:
   - keuzenode: node met interactive: true en options.
   - bereikt (reached): vanaf een startnode gevolgd via de gekozen edges; een onbeantwoorde keuzenode is bereikt, maar wordt niet verder gevolgd.
   - mogelijk (possible): alles wat nog bereikt kan worden als de onbeantwoorde keuzes nog alle kanten op kunnen.

   Statussen:
   - selected: ligt op de gekozen route (beantwoorde keuzenode, gekozen edge, bereikte outcome)
   - available: bereikte, nog onbeantwoorde keuzenode
   - inactive: nog mogelijk, maar nog niet bereikt
   - excluded: door eerdere keuzes niet meer mogelijk
   - normal: geen bijzondere status */
const GraphState = (function () {
  'use strict';

  function isChoice(node) {
    return !!node && node.interactive === true && Array.isArray(node.options);
  }

  function hasValue(selections, id) {
    return selections[id] !== undefined && selections[id] !== null;
  }

  /* Bouwt opzoektabellen. Alleen edges met id, from en to doen mee. */
  function buildModel(graph) {
    var nodes = {}, out = {}, incoming = {}, connected = {}, edges = [];
    graph.nodes.forEach(function (n) { nodes[n.id] = n; });
    graph.edges.forEach(function (e) {
      if (!e.id || !e.from || !e.to) return;
      edges.push(e);
      (out[e.from] = out[e.from] || []).push(e);
      incoming[e.to] = (incoming[e.to] || 0) + 1;
      connected[e.from] = true;
      connected[e.to] = true;
    });
    var starts = graph.nodes
      .filter(function (n) { return out[n.id] && !incoming[n.id]; })
      .map(function (n) { return n.id; });
    return { nodes: nodes, out: out, edges: edges, connected: connected, starts: starts };
  }

  function isInteractive(graph) {
    return graph.nodes.some(isChoice);
  }

  /* Generieke traversal. optimistic = false: onbeantwoorde keuzenodes stoppen het volgen (bereikt).
     optimistic = true: onbeantwoorde keuzenodes volgen alle edges (nog mogelijk). */
  function traverse(model, selections, optimistic) {
    var seen = {};
    var stack = model.starts.slice();
    while (stack.length) {
      var id = stack.pop();
      if (seen[id]) continue;
      seen[id] = true;
      var node = model.nodes[id];
      var outs = model.out[id] || [];
      if (isChoice(node)) {
        if (hasValue(selections, id)) {
          outs = outs.filter(function (e) { return e.value === selections[id]; });
        } else if (!optimistic) {
          continue;
        }
      }
      outs.forEach(function (e) { stack.push(e.to); });
    }
    return seen;
  }

  /* Verwijdert selecties die niet (meer) geldig zijn: de node wordt niet meer bereikt of de waarde bestaat niet.
     Selecties die bereikbaar blijven (ook via een andere route) blijven staan.
     Selecties voor nodes die niet in deze graph voorkomen blijven onaangeroerd. */
  function pruneWithModel(model, selections) {
    var current = {};
    Object.keys(selections).forEach(function (id) { current[id] = selections[id]; });
    var removed = [];
    var changed = true;
    while (changed) {
      changed = false;
      var reached = traverse(model, current, false);
      Object.keys(current).forEach(function (id) {
        var node = model.nodes[id];
        if (!node) return;
        var valid = isChoice(node) && reached[id] === true &&
          node.options.some(function (o) { return o.value === current[id]; });
        if (!valid) {
          delete current[id];
          removed.push(id);
          changed = true;
        }
      });
    }
    return { selections: current, removed: removed };
  }

  function prune(graph, selections) {
    return pruneWithModel(buildModel(graph), selections);
  }

  /* Berekent de status van alle verbonden nodes en alle edges met een id. */
  function compute(graph, selections) {
    var model = buildModel(graph);
    var clean = pruneWithModel(model, selections).selections;
    var reached = traverse(model, clean, false);
    var possible = traverse(model, clean, true);
    var nodeStatus = {}, edgeStatus = {}, available = [];

    graph.nodes.forEach(function (n) {
      if (!model.connected[n.id]) { nodeStatus[n.id] = 'normal'; return; }
      if (!possible[n.id]) { nodeStatus[n.id] = 'excluded'; return; }
      if (isChoice(n)) {
        if (!reached[n.id]) nodeStatus[n.id] = 'inactive';
        else if (hasValue(clean, n.id)) nodeStatus[n.id] = 'selected';
        else { nodeStatus[n.id] = 'available'; available.push(n.id); }
      } else if (n.type === 'outcome') {
        nodeStatus[n.id] = reached[n.id] ? 'selected' : 'inactive';
      } else {
        nodeStatus[n.id] = 'normal';
      }
    });

    model.edges.forEach(function (e) {
      var from = model.nodes[e.from];
      if (!possible[e.from]) { edgeStatus[e.id] = 'excluded'; return; }
      if (isChoice(from)) {
        if (hasValue(clean, e.from)) {
          edgeStatus[e.id] = (reached[e.from] && e.value === clean[e.from]) ? 'selected' : 'excluded';
        } else {
          edgeStatus[e.id] = reached[e.from] ? 'normal' : 'inactive';
        }
      } else {
        edgeStatus[e.id] = reached[e.from] ? 'normal' : 'inactive';
      }
    });

    return { nodes: nodeStatus, edges: edgeStatus, available: available, selections: clean };
  }

  /* Volgt na een keuze op nodeId de gekozen edge en geeft het eerstvolgende relevante punt terug:
     {kind: 'available', id} (onbeantwoorde keuzenode), {kind: 'outcome', id} of {kind: 'end', id} / null.
     Reeds beantwoorde keuzenodes onderweg worden gevolgd via hun gekozen edge. */
  function nextTarget(graph, selections, nodeId) {
    var model = buildModel(graph);
    var clean = pruneWithModel(model, selections).selections;
    var start = (model.out[nodeId] || []).filter(function (e) { return e.value === clean[nodeId]; })[0];
    if (!start) return null;
    var seen = {};
    var id = start.to;
    while (id && !seen[id]) {
      seen[id] = true;
      var node = model.nodes[id];
      if (isChoice(node)) {
        if (!hasValue(clean, id)) return { kind: 'available', id: id };
        var chosen = (model.out[id] || []).filter(function (e) { return e.value === clean[id]; })[0];
        id = chosen ? chosen.to : null;
        continue;
      }
      if (node && node.type === 'outcome') return { kind: 'outcome', id: id };
      var next = (model.out[id] || [])[0];
      if (!next) return { kind: 'end', id: id };
      id = next.to;
    }
    return null;
  }

  /* Leesbare naam van een node voor meldingen: het label, of het eerste blok van de tekst
     (tot een lege regel of '---') op één regel, zonder opmaakcodes. */
  function describeNode(node) {
    if (!node) return '';
    if (node.label) return node.label;
    var text = '';
    if (node.items && node.items.length) text = node.items[0].text || '';
    else if (node.text) text = node.text;
    var lines = [];
    var parts = text.split('\n');
    for (var i = 0; i < parts.length; i++) {
      var line = parts[i].trim();
      if (line === '' || line === '---') {
        if (lines.length) break;
        continue;
      }
      lines.push(line);
    }
    return lines.join(' ').replace(/\{i\}/g, '').replace(/\{a:([^|}]*)\|[^}]*\}/g, '$1').trim();
  }

  return {
    isChoice: isChoice,
    isInteractive: isInteractive,
    prune: prune,
    compute: compute,
    nextTarget: nextTarget,
    describeNode: describeNode
  };
})();
