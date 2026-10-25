/* Generieke graph-berekeningen voor interactieve beslisbomen.
   Leest uitsluitend de graph (nodes + edges met id/from/to/value) en de selecties die worden meegegeven.
   Raakt geen DOM aan, tekent niets en bevat geen medische beslislogica.

   Begrippen:
   - keuzenode: node met interactive: true en options.
   - bereikt (reached): vanaf een startnode gevolgd via de gekozen edges; een onbeantwoorde keuzenode is bereikt, maar wordt niet verder gevolgd.
   - mogelijk (possible): alles wat nog bereikt kan worden als de onbeantwoorde keuzes nog alle kanten op kunnen.
   - gemodelleerd (modelled): alles wat vanaf de root via edges met id/from/to bereikbaar is; de rest krijgt nooit een status.

   De functies krijgen de selecties van één beslisboom mee: { nodeId: waarde }.

   Statussen:
   - selected: ligt op de gekozen route (beantwoorde keuzenode, gekozen edge, bereikte outcome)
   - available: bereikte, nog onbeantwoorde keuzenode
   - inactive: nog mogelijk, maar nog niet bereikt
   - excluded: door eerdere keuzes niet meer mogelijk
   - normal: geen bijzondere status

   Aanbevelingenoverzicht (Sprint 13): recommendations(graph) leidt per outcome af welke combinaties van keuzes
   erheen leiden, uitsluitend uit de graph. describeConditions(conditions) maakt daar leesbare tekst van.

   Hulpbeslisbomen: subtreeOf(node) en subtreeValue(node, outcome) lezen de koppeling tussen een keuzenode en
   de uitkomsten van zijn hulpbeslisboom (zie docs/hulpbeslisbomen.md). */
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
    // Startnodes: de root van de boom. Alleen zonder enige root-node: nodes zonder inkomende edge.
    var starts = graph.nodes
      .filter(function (n) { return n.type === 'root'; })
      .map(function (n) { return n.id; });
    if (starts.length === 0) {
      starts = graph.nodes
        .filter(function (n) { return out[n.id] && !incoming[n.id]; })
        .map(function (n) { return n.id; });
    }
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
    // Alles wat vanaf de root via gemodelleerde edges bereikbaar is, ongeacht keuzes.
    // Delen van de boom die (nog) niet gemodelleerd zijn krijgen nooit een status.
    var modelled = traverse(model, {}, true);
    var nodeStatus = {}, edgeStatus = {}, available = [];

    graph.nodes.forEach(function (n) {
      if (!model.connected[n.id] || !modelled[n.id]) { nodeStatus[n.id] = 'normal'; return; }
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
      if (!modelled[e.from]) { edgeStatus[e.id] = 'normal'; return; }
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

  /* ===== Aanbevelingenoverzicht (Sprint 13) ===== */

  var MAX_ROUTES = 500;      // maximum aantal routes (root -> outcome) per boom
  var MAX_STEPS = 50000;     // veiligheidsgrens op het aantal bezochte nodes tijdens het afzoeken

  function clean(text) {
    return String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim();
  }

  function nodeName(node) {
    return clean(node && (node.label || describeNode(node) || node.id));
  }

  /* Alle waarden waaruit bij een node gekozen kan worden: de opties van een keuzenode, anders de uitgaande edges. */
  function valuesOf(model, node) {
    if (isChoice(node)) return node.options.map(function (o) { return o.value; });
    return (model.out[node.id] || []).map(function (e) { return e.value !== undefined ? e.value : e.id; });
  }

  function conditionKey(c) { return c.nodeId + '\u0000' + c.value; }

  function unionOf(a, b) {
    var seen = {}, out = [];
    a.concat(b).forEach(function (x) { if (!seen[x]) { seen[x] = true; out.push(x); } });
    return out;
  }

  /* Vereenvoudigt de routes naar één outcome (alleen op basis van de graph):
     - identieke voorwaardencombinaties worden samengevoegd;
     - een keuze waarvan alle opties (bij verder gelijke voorwaarden) hier samenkomen vervalt;
     - een route waarvan alle voorwaarden ook in een andere route staan is overbodig (die andere route volstaat).
     Het pad (nodeIds/edgeIds) van samengevoegde routes wordt bij elkaar genomen. */
  function simplifyRoutes(model, routes) {
    var changed = true;
    while (changed) {
      changed = false;

      // 1. identieke combinaties
      var byKey = {}, unique = [];
      routes.forEach(function (r) {
        var key = r.conditions.map(conditionKey).sort().join('|');
        if (byKey[key]) {
          byKey[key].nodeIds = unionOf(byKey[key].nodeIds, r.nodeIds);
          byKey[key].edgeIds = unionOf(byKey[key].edgeIds, r.edgeIds);
          changed = true;
        } else {
          byKey[key] = r;
          unique.push(r);
        }
      });
      routes = unique;

      // 2. een keuze die niet meer uitmaakt (alle opties leiden naar deze uitkomst)
      var merged = false;
      var nodeIds = [];
      routes.forEach(function (r) {
        r.conditions.forEach(function (c) { if (nodeIds.indexOf(c.nodeId) < 0) nodeIds.push(c.nodeId); });
      });
      for (var n = 0; n < nodeIds.length && !merged; n++) {
        var nodeId = nodeIds[n];
        var universe = model.nodes[nodeId] ? valuesOf(model, model.nodes[nodeId]) : [];
        if (!universe.length) continue;
        var groups = {};
        routes.forEach(function (r, i) {
          var mine = r.conditions.filter(function (c) { return c.nodeId === nodeId; })[0];
          if (!mine) return;
          var rest = r.conditions.filter(function (c) { return c !== mine; }).map(conditionKey).sort().join('|');
          (groups[rest] = groups[rest] || []).push({ index: i, value: mine.value });
        });
        var keys = Object.keys(groups);
        for (var k = 0; k < keys.length && !merged; k++) {
          var members = groups[keys[k]];
          var have = {};
          members.forEach(function (m) { have[m.value] = true; });
          var covers = universe.every(function (v) { return have[v] === true; });
          if (!covers) continue;
          var first = routes[members[0].index];
          var combined = {
            conditions: first.conditions.filter(function (c) { return c.nodeId !== nodeId; }),
            nodeIds: first.nodeIds,
            edgeIds: first.edgeIds
          };
          var drop = {};
          members.forEach(function (m, idx) {
            drop[m.index] = true;
            if (idx > 0) {
              combined.nodeIds = unionOf(combined.nodeIds, routes[m.index].nodeIds);
              combined.edgeIds = unionOf(combined.edgeIds, routes[m.index].edgeIds);
            }
          });
          var next = [];
          var placed = false;
          routes.forEach(function (r, i) {
            if (!drop[i]) next.push(r);
            else if (!placed) { next.push(combined); placed = true; }
          });
          routes = next;
          merged = true;
          changed = true;
        }
      }
      if (merged) continue;

      // 3. overbodige routes (een andere route met een deelverzameling van de voorwaarden volstaat al)
      var sets = routes.map(function (r) {
        var set = {};
        r.conditions.forEach(function (c) { set[conditionKey(c)] = true; });
        return set;
      });
      var kept = routes.filter(function (r, i) {
        return !routes.some(function (other, j) {
          if (i === j) return false;
          var keys2 = Object.keys(sets[j]);
          if (keys2.length >= Object.keys(sets[i]).length) return false;
          return keys2.every(function (key) { return sets[i][key] === true; });
        });
      });
      if (kept.length !== routes.length) { routes = kept; changed = true; }
    }
    return routes;
  }

  /* Leidt per aanbeveling (node met type 'outcome') af onder welke voorwaarden die wordt bereikt.
     Werkt vanaf de root(s) via de gemodelleerde edges (id/from/to); geen medische logica.
     Resultaat: { recommendations: [{ id, node, label, routes: [{ conditions, nodeIds, edgeIds }] }],
                  truncated: boolean }
     - conditions: [{ nodeId, nodeLabel, value, valueLabel }] in de volgorde van de route; binnen een route geldt EN.
     - routes van één aanbeveling zijn alternatieven (OF).
     - nodeIds/edgeIds: het pad in de graph (voor het markeren in de boom).
     - truncated: er zijn meer dan MAX_ROUTES routes (of te veel stappen); het overzicht is dan onvolledig.
     De routes worden per node berekend (en onthouden) en meteen vereenvoudigd, zodat samenvloeiende keuzes niet
     leiden tot een exponentieel aantal routes. Volgorde van de aanbevelingen: die van de nodes in de graph.
     Outcomes die niet vanaf de root bereikbaar zijn (nog niet gemodelleerd) komen niet voor.
     Een cyclus wordt per route maximaal één keer doorlopen. */
  function recommendations(graph) {
    var result = { recommendations: [], truncated: false };
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return result;
    var model = buildModel(graph);
    var memo = {};            // nodeId -> { map, cut }; alleen als er onderweg geen cyclus is afgekapt
    var onPath = {};
    var steps = 0;

    function trim(list) {
      if (list.length <= MAX_ROUTES) return list;
      result.truncated = true;
      return list.slice(0, MAX_ROUTES);
    }

    /* Geeft { map: { outcomeId: [route] }, cut } met routes relatief vanaf deze node. */
    function routesFrom(id) {
      if (memo[id]) return memo[id];
      var node = model.nodes[id];
      var map = {}, cut = false;
      if (!node || result.truncated) return { map: map, cut: false };
      if (++steps > MAX_STEPS) { result.truncated = true; return { map: map, cut: false }; }
      if (node.type === 'outcome') {
        map[id] = [{ conditions: [], nodeIds: [id], edgeIds: [] }];
        return (memo[id] = { map: map, cut: false });
      }
      var outs = model.out[id] || [];
      onPath[id] = true;
      outs.forEach(function (e) {
        if (onPath[e.to]) { cut = true; return; }
        var cond = null;
        if (isChoice(node)) {
          var option = node.options.filter(function (o) { return o.value === e.value; })[0];
          if (!option) return;   // edge zonder bijbehorende optie: niet te kiezen, dus geen route
          cond = {
            nodeId: id,
            nodeLabel: nodeName(node),
            value: e.value,
            valueLabel: clean(option.label !== undefined ? option.label : (e.label !== undefined ? e.label : e.value))
          };
        } else if (outs.length > 1 && e.label) {
          // Vertakking zonder keuzemetadata: alleen een voorwaarde als de edge zelf een label heeft.
          cond = { nodeId: id, nodeLabel: nodeName(node), value: e.id, valueLabel: clean(e.label) };
        }
        var sub = routesFrom(e.to);
        if (sub.cut) cut = true;
        Object.keys(sub.map).forEach(function (outcomeId) {
          sub.map[outcomeId].forEach(function (r) {
            (map[outcomeId] = map[outcomeId] || []).push({
              conditions: cond ? [cond].concat(r.conditions) : r.conditions,
              nodeIds: [id].concat(r.nodeIds),
              edgeIds: [e.id].concat(r.edgeIds)
            });
          });
        });
      });
      delete onPath[id];
      Object.keys(map).forEach(function (outcomeId) {
        map[outcomeId] = trim(simplifyRoutes(model, map[outcomeId]));
      });
      var entry = { map: map, cut: cut };
      if (!cut) memo[id] = entry;
      return entry;
    }

    var byOutcome = {};
    model.starts.forEach(function (start) {
      var r = routesFrom(start);
      Object.keys(r.map).forEach(function (outcomeId) {
        byOutcome[outcomeId] = (byOutcome[outcomeId] || []).concat(r.map[outcomeId]);
      });
    });

    graph.nodes.forEach(function (n) {
      if (n.type !== 'outcome' || !byOutcome[n.id]) return;
      result.recommendations.push({
        id: n.id,
        node: n,
        label: describeNode(n) || n.id,
        routes: trim(simplifyRoutes(model, byOutcome[n.id]))
      });
    });
    return result;
  }

  /* Leesbare tekst van één route: "Snijvlak: Snijvlak vrij en pN: >= pN1". Geen voorwaarden = altijd. */
  function describeConditions(conditions) {
    if (!conditions || !conditions.length) return 'Geen voorwaarden';
    return conditions.map(function (c) { return c.nodeLabel + ': ' + c.valueLabel; }).join(' en ');
  }

  /* Status van een route ten opzichte van de huidige keuzes ({ nodeId: waarde }, bij voorkeur de opgeschoonde
     selecties uit compute): 'reached' (alle voorwaarden gekozen), 'conflict' (een keuze wijkt af: route niet meer
     mogelijk) of 'open'. Per voorwaarde: 'met', 'conflict' of 'open'. */
  function routeStatus(conditions, selections) {
    var sel = selections || {};
    var states = (conditions || []).map(function (c) {
      if (!hasValue(sel, c.nodeId)) return 'open';
      return sel[c.nodeId] === c.value ? 'met' : 'conflict';
    });
    var state = 'reached';
    if (states.indexOf('conflict') >= 0) state = 'conflict';
    else if (states.some(function (s) { return s !== 'met'; })) state = 'open';
    return { state: state, conditions: states };
  }

  /* Volledige tekst van een node als regels (zonder opmaakcodes); lege regels scheiden blokken. */
  function describeNodeLines(node) {
    if (!node) return [];
    var raw = [];
    if (node.items && node.items.length) {
      node.items.forEach(function (it, i) {
        if (i) raw.push('', 'EN', '');
        String(it.text || '').split('\n').forEach(function (l) { raw.push(l); });
      });
    } else if (node.text !== undefined) {
      String(node.text).split('\n').forEach(function (l) { raw.push(l); });
    } else if (node.label) {
      raw.push(node.label);
    }
    var lines = [];
    raw.forEach(function (l) {
      var t = l.replace(/\{i\}/g, '').replace(/\{a:([^|}]*)\|[^}]*\}/g, '$1').trim();
      if (t === '---') t = '';
      if (t === '' && (!lines.length || lines[lines.length - 1] === '')) return;
      lines.push(t);
    });
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines;
  }

  /* ===== Hulpbeslisbomen ===== */

  /* Leest het veld subtree van een node: { tree, map } of null.
     Schrijfwijzen: "subtree": "<boom-id>"  of  "subtree": { "tree": "<boom-id>", "map": { "<outcome-id>": "<optiewaarde>" } }.
     map koppelt per uitkomst van de hulpbeslisboom een waarde (value) van een optie van deze node. */
  function subtreeOf(node) {
    if (!node || node.subtree === undefined || node.subtree === null) return null;
    var s = node.subtree;
    if (typeof s === 'string') return s.trim() ? { tree: s.trim(), map: {} } : null;
    if (typeof s === 'object' && !Array.isArray(s) && typeof s.tree === 'string' && s.tree.trim()) {
      return { tree: s.tree.trim(), map: (s.map && typeof s.map === 'object' && !Array.isArray(s.map)) ? s.map : {} };
    }
    return null;
  }

  /* De optiewaarde van keuzenode `node` die hoort bij een uitkomst van zijn hulpbeslisboom, of null.
     Volgorde: de map op de node, anders het veld "value" op de uitkomst zelf. De waarde moet een
     bestaande optie van de node zijn; anders is de uitkomst niet over te nemen. */
  function subtreeValue(node, outcome) {
    var cfg = subtreeOf(node);
    if (!cfg || !outcome || !isChoice(node)) return null;
    var v = Object.prototype.hasOwnProperty.call(cfg.map, outcome.id) ? cfg.map[outcome.id] : outcome.value;
    if (v === undefined || v === null) return null;
    return node.options.some(function (o) { return o.value === v; }) ? v : null;
  }

  return {
    isChoice: isChoice,
    isInteractive: isInteractive,
    prune: prune,
    compute: compute,
    nextTarget: nextTarget,
    describeNode: describeNode,
    describeNodeLines: describeNodeLines,
    recommendations: recommendations,
    describeConditions: describeConditions,
    routeStatus: routeStatus,
    subtreeOf: subtreeOf,
    subtreeValue: subtreeValue
  };
})();
