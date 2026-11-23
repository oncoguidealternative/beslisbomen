/* Vragenlijst-logica van de mobiele weergave.
   Zet een beslisboom (graph) plus de gekozen waarden om in: welke vragen zijn beantwoord, wat is de volgende
   vraag, welke aanbevelingen zijn bereikt of nog mogelijk, en naar welke vervolgbomen verwijst het eindpunt.

   Bevat geen eigen beslislogica: alles komt uit de gedeelde rekenkern js/graph-state.js (GraphState), dezelfde
   die de beslisbomen op de hoofdsite gebruiken. Daardoor geeft de vragenlijst altijd dezelfde uitkomst.
   Raakt geen DOM aan (ook te gebruiken in Node, zie mobiel/tools/check-flow.js). */
var Flow = (function () {
  'use strict';

  var GS = typeof GraphState !== 'undefined' ? GraphState : null;
  function use(graphState) { GS = graphState; }

  var recCache = typeof WeakMap === 'function' ? new WeakMap() : null;

  function byId(graph) {
    var m = {};
    graph.nodes.forEach(function (n) { m[n.id] = n; });
    return m;
  }

  function has(sel, id) { return sel[id] !== undefined && sel[id] !== null; }

  /* Alle aanbevelingen van de boom met hun routes (GraphState.recommendations), eenmaal per graph. */
  function recommendations(graph) {
    if (recCache && recCache.has(graph)) return recCache.get(graph);
    var r = GS.recommendations(graph);
    if (recCache) recCache.set(graph, r);
    return r;
  }

  /* Bereikte nodes in volgorde van bereiken (breedte-eerst vanaf de titel), langs de gekozen verbindingen.
     Een onbeantwoorde keuzenode wordt bereikt maar niet verder gevolgd (zelfde regel als GraphState). */
  function reachOrder(graph, sel) {
    var nodes = byId(graph), out = {}, incoming = {};
    graph.edges.forEach(function (e) {
      if (!e.id || !e.from || !e.to) return;
      (out[e.from] = out[e.from] || []).push(e);
      incoming[e.to] = true;
    });
    var starts = graph.nodes.filter(function (n) { return n.type === 'root'; }).map(function (n) { return n.id; });
    if (!starts.length) {
      starts = graph.nodes.filter(function (n) { return out[n.id] && !incoming[n.id]; }).map(function (n) { return n.id; });
    }
    var seen = {}, order = [], queue = starts.slice();
    starts.forEach(function (id) { seen[id] = true; });
    while (queue.length) {
      var id = queue.shift();
      order.push(id);
      var node = nodes[id];
      var outs = out[id] || [];
      if (GS.isChoice(node)) {
        if (!has(sel, id)) continue;
        outs = outs.filter(function (e) { return GS.edgeHas(e, sel[id]); });
      }
      outs.forEach(function (e) {
        if (!seen[e.to]) { seen[e.to] = true; queue.push(e.to); }
      });
    }
    return order;
  }

  function optionLabel(node, value) {
    var o = (node.options || []).filter(function (x) { return x.value === value; })[0];
    return o ? String(o.label !== undefined ? o.label : o.value) : String(value);
  }

  function hasContent(node) {
    return !!(node.label || node.text || (node.items && node.items.length));
  }

  /* De volledige toestand van de vragenlijst. */
  function view(graph, selections) {
    var nodes = byId(graph);
    var st = GS.compute(graph, selections || {});
    var sel = st.selections;
    var order = GS.choiceOrder(graph);
    var interactive = GS.isInteractive(graph);

    // Beantwoorde vragen, één regel per gegeven (Fertiliteit staat soms in twee takken; dat is één vraag).
    var answered = [], seenKeys = {};
    order.forEach(function (id) {
      if (!has(sel, id)) return;
      var node = nodes[id], key = GS.dataKey(node);
      if (seenKeys[key]) return;
      seenKeys[key] = true;
      answered.push({
        nodeId: id, node: node, label: GS.describeNode(node), value: sel[id], valueLabel: optionLabel(node, sel[id]),
        status: st.nodes[id]   // selected (op de route) of preselected (alvast ingevuld)
      });
    });

    // Volgende vraag: de eerste bereikte, onbeantwoorde keuzenode in de invulvolgorde.
    var question = null;
    order.some(function (id) {
      if (st.nodes[id] === 'available') { question = nodes[id]; return true; }
      return false;
    });

    var reached = reachOrder(graph, sel);
    var outcomes = [], steps = [], links = [];
    reached.forEach(function (id) {
      var n = nodes[id];
      if (!n) return;
      if (n.type === 'outcome') outcomes.push(n);
      else if (n.type === 'link') links.push(n);
      else if (n.type !== 'root' && n.type !== 'start' && !GS.isChoice(n) && hasContent(n)) steps.push(n);
    });

    var recs = recommendations(graph);
    var all = recs.recommendations.map(function (r) {
      var s = st.nodes[r.id];
      return {
        id: r.id, node: r.node, label: r.label, routes: r.routes,
        state: s === 'excluded' ? 'excluded' : (s === 'selected' ? 'reached' : 'possible')
      };
    });
    var remaining = all.filter(function (r) { return r.state !== 'excluded'; });

    return {
      interactive: interactive,
      selections: sel,
      status: st,
      answered: answered,
      question: question,
      done: !question,
      outcomes: outcomes,
      steps: steps,
      links: links,
      all: all,
      remaining: remaining,
      truncated: recs.truncated
    };
  }

  /* Antwoord op een vraag. Net als op de hoofdsite geldt het antwoord voor alle vragen over hetzelfde gegeven
     in deze boom (bv. "Fertiliteit" in twee takken). Geeft de opgeschoonde selecties terug. */
  function answer(graph, selections, nodeId, value) {
    var next = {};
    Object.keys(selections || {}).forEach(function (k) { next[k] = selections[k]; });
    GS.sameData(graph, nodeId).forEach(function (id) { delete next[id]; });
    GS.sameData(graph, nodeId, value).forEach(function (id) { next[id] = value; });
    return GS.compute(graph, next).selections;
  }

  /* Wist het antwoord op een vraag (en op dezelfde vraag elders in de boom). */
  function clear(graph, selections, nodeId) {
    var next = {};
    Object.keys(selections || {}).forEach(function (k) { next[k] = selections[k]; });
    GS.sameData(graph, nodeId).forEach(function (id) { delete next[id]; });
    return GS.compute(graph, next).selections;
  }

  /* Tekst van een aanbeveling als blokken voor de weergave. In de bron is de tekst afgebroken op de breedte van
     een blok in de boom; op een telefoon lopen regels van één alinea weer door.
     Blokken: {kind: 'p', text, info: bool, none: bool} | {kind: 'join', text: 'EN'|'OF'|...} | {kind: 'rule'} */
  var JOIN = /^\s*-*\s*(EN\/OF|EN|OF|GEVOLGD DOOR)\s*-*\s*$/i;
  function blocks(node) {
    var raw = [];
    if (node.items && node.items.length) {
      node.items.forEach(function (it, i) {
        if (i) raw.push('EN');
        String(it.text || '').split('\n').forEach(function (l) { raw.push(l); });
      });
    } else if (node.text !== undefined) {
      raw = String(node.text).split('\n');
    } else if (node.label) {
      raw = [String(node.label)];
    }
    var out = [], cur = null;
    function flush() { if (cur) { cur.text = cur.text.trim(); if (cur.text) out.push(cur); cur = null; } }
    raw.forEach(function (line) {
      var l = line.trim();
      if (!l) { flush(); return; }
      var m = JOIN.exec(l);
      if (m) { flush(); out.push({ kind: 'join', text: m[1].toUpperCase() }); return; }
      if (/^-{2,}$/.test(l)) { flush(); out.push({ kind: 'rule' }); return; }
      var info = l.indexOf('{i}') === 0, none = l.indexOf('{x}') === 0;
      if (info || none) { flush(); l = l.slice(3).trim(); cur = { kind: 'p', text: '', info: info, none: none }; }
      if (!cur) cur = { kind: 'p', text: '', info: false, none: false };
      if (cur.text && /[a-z]-$/.test(cur.text) && /^[a-z]/.test(l)) cur.text = cur.text.slice(0, -1) + l;
      else cur.text += (cur.text ? ' ' : '') + l;
    });
    flush();
    // Geen verbindingswoord aan het begin of eind, en niet twee achter elkaar.
    var clean = [];
    out.forEach(function (b) {
      var prev = clean[clean.length - 1];
      if ((b.kind === 'join' || b.kind === 'rule') && (!prev || prev.kind !== 'p')) return;
      clean.push(b);
    });
    while (clean.length && clean[clean.length - 1].kind !== 'p') clean.pop();
    return clean;
  }

  /* Platte tekst van een aanbeveling (voor de samenvatting). */
  function plain(node) {
    return blocks(node).map(function (b) {
      if (b.kind === 'join') return b.text;
      if (b.kind === 'rule') return '—';
      return (b.info ? '(i) ' : '') + (b.none ? 'Geen: ' : '') + inlineText(b.text);
    }).join('\n');
  }

  /* {a:tekst|url} wordt tekst; overige opmaakcodes verdwijnen. */
  function inlineText(s) {
    return String(s).replace(/\{a:([^|}]*)\|[^}]*\}/g, '$1').replace(/\{[ix]\}/g, '').replace(/\s+/g, ' ').trim();
  }

  /* Leesbare vergelijkingstekens: <= wordt ≤, >= wordt ≥. */
  function pretty(s) {
    return String(s).replace(/<=/g, '≤').replace(/>=/g, '≥').replace(/\s+/g, ' ').trim();
  }

  return {
    use: use,
    view: view,
    answer: answer,
    clear: clear,
    reachOrder: reachOrder,
    optionLabel: optionLabel,
    blocks: blocks,
    plain: plain,
    inlineText: inlineText,
    pretty: pretty
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Flow;
