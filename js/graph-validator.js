/* Validator voor interactieve beslisbomen (zie docs/interactive-tree-schema.md).
   - Raakt geen DOM aan en wijzigt nooit medische inhoud.
   - Voorkomt nooit dat een (statische) boom wordt weergegeven.
   - Geeft een gesaneerde kopie van de graph terug waarin alleen geldige nodes interactive zijn.
   - Schrijft duidelijke waarschuwingen naar de console; de eindgebruiker ziet geen technische foutmeldingen.

   Foutniveaus:
   - 'error' op een node: die node wordt niet interactief gemaakt.
   - 'error' op boomniveau (dubbele id's): geen enkele node in die boom wordt interactief.
   - 'warning': wordt gemeld, maar heeft geen invloed op de interactiviteit. */
const GraphValidator = (function () {
  'use strict';

  function isObject(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  function nonEmptyString(x) { return typeof x === 'string' && x.trim() !== ''; }

  /* graph: {nodes, edges}; ctx: {tumor, tree}
     Geeft {graph, issues, validInteractive, invalidInteractive}. */
  function validate(graph, ctx) {
    var issues = [];
    var tumor = (ctx && ctx.tumor) || '?';
    var tree = (ctx && ctx.tree) || '?';
    function add(level, nodeId, message, edgeId) {
      issues.push({ level: level, tumor: tumor, tree: tree, node: nodeId || null, edge: edgeId || null, message: message });
    }

    var nodes = Array.isArray(graph && graph.nodes) ? graph.nodes : [];
    var edges = Array.isArray(graph && graph.edges) ? graph.edges : [];
    var treeLevelError = false;
    var nodeErrors = {};          // nodeId -> true
    function nodeError(nodeId, message, edgeId) { nodeErrors[nodeId] = true; add('error', nodeId, message, edgeId); }

    // ---- dubbele id's ----
    var nodeById = {}, nodeCount = {};
    nodes.forEach(function (n) {
      nodeCount[n.id] = (nodeCount[n.id] || 0) + 1;
      if (!(n.id in nodeById)) nodeById[n.id] = n;
    });
    Object.keys(nodeCount).forEach(function (id) {
      if (nodeCount[id] > 1) { treeLevelError = true; add('error', id, 'Dubbele node-id "' + id + '" (' + nodeCount[id] + ' keer).'); }
    });
    var edgeById = {}, edgeCount = {};
    edges.forEach(function (e) {
      if (e.id === undefined) return;
      edgeCount[e.id] = (edgeCount[e.id] || 0) + 1;
      if (!(e.id in edgeById)) edgeById[e.id] = e;
    });
    Object.keys(edgeCount).forEach(function (id) {
      if (edgeCount[id] > 1) { treeLevelError = true; add('error', null, 'Dubbele edge-id "' + id + '" (' + edgeCount[id] + ' keer).', id); }
    });

    // ---- edge-controles ----
    var modelled = [];            // edges die de engine mag gebruiken
    var brokenEdgeIds = {};
    edges.forEach(function (e) {
      var hasAny = e.id !== undefined || e.from !== undefined || e.to !== undefined || e.value !== undefined;
      if (!hasAny) return;       // zuiver tekenwerk zonder metadata
      var label = e.id !== undefined ? e.id : '(zonder id)';
      var complete = true;
      if (!nonEmptyString(e.id)) { add('warning', e.from || null, 'Edge met metadata maar zonder id; wordt door de engine genegeerd.'); complete = false; }
      if (e.from === undefined) { add('warning', null, 'Edge "' + label + '" heeft geen "from".', e.id); complete = false; }
      else if (!(e.from in nodeById)) { add('warning', null, 'Edge "' + label + '": "from" verwijst naar onbekende node "' + e.from + '".', e.id); complete = false; }
      if (e.to === undefined) { add('warning', e.from || null, 'Edge "' + label + '" heeft geen "to".', e.id); complete = false; }
      else if (!(e.to in nodeById)) { add('warning', e.from || null, 'Edge "' + label + '": "to" verwijst naar onbekende node "' + e.to + '".', e.id); complete = false; }
      if (complete && e.from === e.to) { add('warning', e.from, 'Edge "' + label + '" is een directe zelflus op node "' + e.from + '".', e.id); }
      if (e.value !== undefined && complete) {
        var src = nodeById[e.from];
        if (!src || src.interactive !== true) add('warning', e.from, 'Edge "' + label + '" heeft een "value" maar node "' + e.from + '" is niet interactief (metadata buiten een geldige keuzenode).', e.id);
      }
      if (complete) modelled.push(e); else brokenEdgeIds[e.id] = true;
    });

    // ---- bereikbaarheid en cycli (alleen over gemodelleerde edges) ----
    var out = {}, incoming = {};
    modelled.forEach(function (e) {
      (out[e.from] = out[e.from] || []).push(e);
      incoming[e.to] = (incoming[e.to] || 0) + 1;
    });
    // Startpunt: de root-node(s). Alleen zonder enige root-node: nodes zonder inkomende edge.
    var roots = nodes.filter(function (n) { return n.type === 'root'; }).map(function (n) { return n.id; });
    if (roots.length === 0) {
      roots = nodes.filter(function (n) { return out[n.id] && !incoming[n.id]; }).map(function (n) { return n.id; });
    }
    var reachable = {};
    var stack = roots.slice();
    while (stack.length) {
      var id = stack.pop();
      if (reachable[id]) continue;
      reachable[id] = true;
      (out[id] || []).forEach(function (e) { stack.push(e.to); });
    }

    // cycli: iteratieve DFS met kleuren
    var color = {}, cycles = [];
    roots.forEach(function (r) {
      var path = [], iter = [];
      if (color[r]) return;
      color[r] = 1; path.push(r); iter.push(0);
      while (path.length) {
        var top = path[path.length - 1];
        var list = out[top] || [];
        var i = iter[iter.length - 1];
        if (i >= list.length) { color[top] = 2; path.pop(); iter.pop(); continue; }
        iter[iter.length - 1] = i + 1;
        var next = list[i].to;
        if (color[next] === 1) {
          if (next !== top) cycles.push(path.slice(path.indexOf(next)).concat(next));
        } else if (!color[next]) {
          color[next] = 1; path.push(next); iter.push(0);
        }
      }
    });
    cycles.forEach(function (c) {
      add('warning', c[0], 'Mogelijk onveilige cyclus in de route: ' + c.join(' → ') + '. De engine volgt elke node maximaal één keer, dus er ontstaat geen oneindige traversal.');
    });

    // ---- node-controles ----
    var interactiveIds = [];
    nodes.forEach(function (n) {
      var hasOptions = n.options !== undefined;
      if (n.interactive !== true) {
        if (hasOptions) add('warning', n.id, 'Node "' + n.id + '" heeft "options" maar niet "interactive": true; blijft statisch.');
        else if (n.type === 'criterion') {
          // Een criterion zonder interactiemetadata blijft bewust statisch; meld waarom (interactionNote) als dat bekend is.
          add('warning', n.id, 'Criterion-node "' + n.id + '" blijft statisch. ' +
            (n.interactionNote ? n.interactionNote : 'Er is geen interactiemetadata (interactive/options) toegevoegd.'));
        }
        return;
      }
      interactiveIds.push(n.id);
      if (n.type === 'outcome') { nodeError(n.id, 'Outcome "' + n.id + '" mag geen options hebben.'); return; }
      if (n.type !== 'criterion') add('warning', n.id, 'Node "' + n.id + '" is interactive maar heeft type "' + n.type + '" in plaats van "criterion".');
      if (!Array.isArray(n.options) || n.options.length === 0) { nodeError(n.id, 'Interactieve node "' + n.id + '" heeft geen (niet-lege) options-array.'); return; }

      var values = {}, usedEdges = {};
      n.options.forEach(function (o, idx) {
        var tag = 'Node "' + n.id + '": option ' + (nonEmptyString(o && o.value) ? '"' + o.value + '"' : '#' + (idx + 1));
        if (!isObject(o)) { nodeError(n.id, tag + ' is geen object.'); return; }
        if (!nonEmptyString(o.value)) nodeError(n.id, tag + ' heeft geen value.');
        else if (values[o.value]) nodeError(n.id, tag + ' komt dubbel voor (value moet uniek zijn binnen de node).');
        else values[o.value] = true;
        if (!nonEmptyString(o.label)) nodeError(n.id, tag + ' heeft geen label.');
        if (!nonEmptyString(o.edge)) { nodeError(n.id, tag + ' heeft geen edge.'); return; }
        if (usedEdges[o.edge]) nodeError(n.id, tag + ' gebruikt edge "' + o.edge + '" die al door een andere option wordt gebruikt.', o.edge);
        usedEdges[o.edge] = true;
        var e = edgeById[o.edge];
        if (!e) { nodeError(n.id, tag + ' verwijst naar onbekende edge "' + o.edge + '".', o.edge); return; }
        if (brokenEdgeIds[e.id]) { nodeError(n.id, tag + ': edge "' + o.edge + '" mist from/to of verwijst naar onbekende nodes.', o.edge); return; }
        if (e.from !== n.id) nodeError(n.id, tag + ': edge "' + o.edge + '" heeft from "' + e.from + '" in plaats van "' + n.id + '".', o.edge);
        if (e.value !== o.value) nodeError(n.id, tag + ': option.value en edge.value verschillen ("' + o.value + '" ≠ "' + e.value + '").', o.edge);
        if (e.from === e.to) nodeError(n.id, tag + ': edge "' + o.edge + '" is een directe zelflus.', o.edge);
        if (nonEmptyString(e.label) && nonEmptyString(o.label) && e.label.replace(/\s+/g, ' ').trim() !== o.label.replace(/\s+/g, ' ').trim()) {
          add('warning', n.id, tag + ': label "' + o.label + '" wijkt af van het edge-label "' + e.label.replace(/\s+/g, ' ').trim() + '".', o.edge);
        }
      });
      // meerdere edges voor dezelfde option: andere gemodelleerde edges met dezelfde from+value
      n.options.forEach(function (o) {
        if (!isObject(o) || !nonEmptyString(o.value)) return;
        var same = modelled.filter(function (e) { return e.from === n.id && e.value === o.value; });
        if (same.length > 1) nodeError(n.id, 'Node "' + n.id + '": option "' + o.value + '" heeft ' + same.length + ' edges (' + same.map(function (e) { return e.id; }).join(', ') + '); niet ondubbelzinnig.');
      });
      // edges van deze node met een value zonder option
      (out[n.id] || []).forEach(function (e) {
        if (e.value !== undefined && !values[e.value]) add('warning', n.id, 'Node "' + n.id + '": edge "' + e.id + '" heeft value "' + e.value + '" zonder bijbehorende option.', e.id);
      });
    });

    // ---- bereikbaarheid: een interactieve node moet vanaf de root bereikbaar zijn via gemodelleerde edges,
    // zonder te passeren langs een interactieve node die ongeldig is (die blijft statisch, dus de route erachter
    // zou een beslismoment overslaan). Herhaal tot er niets meer verandert.
    var changed = true;
    while (changed && !treeLevelError) {
      changed = false;
      var seen = {};
      var work = roots.slice();
      while (work.length) {
        var cur = work.pop();
        if (seen[cur]) continue;
        seen[cur] = true;
        if (nodeErrors[cur]) continue;               // ongeldige interactieve node: route erachter niet volgen
        (out[cur] || []).forEach(function (e) { work.push(e.to); });
      }
      interactiveIds.forEach(function (id) {
        if (!nodeErrors[id] && !seen[id]) {
          nodeError(id, 'Interactieve node "' + id + '" is niet bereikbaar vanaf de root via gemodelleerde edges (ontbrekende of onvolledige edge-metadata, of alleen bereikbaar via een node die niet interactief kan worden).');
          changed = true;
        }
      });
    }

    // ---- resultaat: gesaneerde kopie ----
    var valid = [], invalid = [];
    interactiveIds.forEach(function (id) { (treeLevelError || nodeErrors[id] ? invalid : valid).push(id); });
    var invalidSet = {};
    invalid.forEach(function (id) { invalidSet[id] = true; });
    var cleanNodes = nodes.map(function (n) {
      if (n.interactive === true && invalidSet[n.id]) {
        var copy = Object.assign({}, n);
        copy.interactive = false;
        return copy;
      }
      return n;
    });
    var cleanEdges = edges.map(function (e) {
      var brokenEdge = e.id !== undefined && brokenEdgeIds[e.id];
      // Uitgaande edges van een ongeldige interactieve node worden niet gemodelleerd: de engine mag er niet
      // doorheen lopen (anders zouden uitkomsten achter een overgeslagen beslismoment groen worden).
      var fromInvalid = e.from !== undefined && invalidSet[e.from];
      if (brokenEdge || fromInvalid) {
        var c = Object.assign({}, e);
        delete c.from; delete c.to;    // de engine negeert edges zonder from/to
        return c;
      }
      return e;
    });
    var cleanGraph = Object.assign({}, graph, { nodes: cleanNodes, edges: cleanEdges });
    return { graph: cleanGraph, issues: issues, validInteractive: valid, invalidInteractive: invalid };
  }

  function format(issue) {
    return '[GraphValidator][' + issue.tumor + '][' + issue.tree + ']\n' + issue.message;
  }

  /* Schrijft alle meldingen naar de console. */
  function report(result) {
    result.issues.forEach(function (issue) {
      if (issue.level === 'error') console.warn(format(issue));
      else console.warn(format(issue));
    });
  }

  /* Valideert alle bomen van een zorgpad (zonder de weergave te beïnvloeden). */
  function validateTumor(zorgpad, tumorId) {
    var summary = { trees: {}, issues: [] };
    Object.keys(zorgpad.trees || {}).forEach(function (treeId) {
      var t = zorgpad.trees[treeId];
      if (!t || t.same || !Array.isArray(t.nodes)) return;
      var r = validate(t, { tumor: tumorId, tree: treeId });
      summary.trees[treeId] = r;
      summary.issues = summary.issues.concat(r.issues);
    });
    return summary;
  }

  return { validate: validate, validateTumor: validateTumor, report: report, format: format };
})();
