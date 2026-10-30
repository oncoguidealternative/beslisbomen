/* Hulpbeslisbomen: een keuzenode kan naar een andere boom verwijzen (subtree). Een klik op die node opent de
   hulpbeslisboom; een bereikte uitkomst daar kan als waarde worden overgenomen in de oorspronkelijke boom.
   Zie docs/hulpbeslisbomen.md.

   Gebruik:
     const subtrees = Subtrees.create({
       zorgpad, refs,
       getGraph, getTreeId,          // () => de getoonde graph / boom-id
       validatedGraph,               // (treeId, graph) => gevalideerde graph
       navigate,                     // (boom-id) => naar een boom gaan
       journey, viewport,
       onClearAll                    // () => na "Keuzes wissen" (bv. reis en markering stoppen)
     });
   Functies: setView, context, enter, takeableItems, take, applyPendingReturn, refreshBar. */
const Subtrees = (function () {
  'use strict';

  function create(options) {
    const zorgpad = options.zorgpad;
    const refs = options.refs;
    const getGraph = options.getGraph;
    const getTreeId = options.getTreeId;
    const validatedGraph = options.validatedGraph;
    const navigate = options.navigate;
    const journey = options.journey;
    const viewport = options.viewport;
    const onClearAll = options.onClearAll || function () {};

    // { parentTreeId, nodeId, node, label, parentLabel } als de getoonde boom vanuit een keuzenode is geopend.
    let context = null;
    // Na het overnemen van een uitkomst: de stap waarvoor na terugkeren de volgende stap wordt getoond.
    let pendingReturn = null;

    function nodeById(id) {
      const graph = getGraph();
      return graph ? graph.nodes.filter(function (n) { return n.id === id; })[0] : undefined;
    }

    // Zoekt de keuzenode (in een andere boom) die deze boom als hulpbeslisboom aanwijst. Eerst de node uit "from",
    // anders de eerste node die naar deze boom verwijst.
    function resolveContext(view, from) {
      if (!view.treeId || !view.subtree) return null;
      function candidate(treeId, nodeId) {
        const parent = Renderer.resolve(zorgpad, treeId);
        if (!parent.treeId || parent.treeId === view.treeId || !parent.graph) return null;
        const node = parent.graph.nodes.filter(function (n) { return n.id === nodeId; })[0];
        const ref = GraphState.subtreeOf(node);
        if (!node || !GraphState.isChoice(node) || !ref || ref.tree !== view.treeId) return null;
        return { parentTreeId: parent.treeId, nodeId: node.id, node: node, label: GraphState.describeNode(node), parentLabel: parent.label };
      }
      if (from) {
        const found = candidate(from.treeId, from.nodeId);
        if (found) return found;
      }
      const trees = zorgpad.trees || {};
      const ids = Object.keys(trees);
      for (let i = 0; i < ids.length; i++) {
        const t = trees[ids[i]];
        if (!t || t.same || !Array.isArray(t.nodes)) continue;
        for (let j = 0; j < t.nodes.length; j++) {
          const found = candidate(ids[i], t.nodes[j].id);
          if (found) return found;
        }
      }
      return null;
    }

    // Aanroepen bij elke getoonde boom. from: { treeId, nodeId } uit de hash, of null.
    function setView(view, from) {
      context = resolveContext(view, from);
    }

    function getContext() {
      return context;
    }

    // Een klik op een keuzenode met hulpbeslisboom: open die boom, met de herkomst in de hash.
    function enter(info) {
      const treeId = getTreeId();
      if (!treeId) return;
      location.hash = "#/" + info.tree + "?from=" + treeId + ":" + info.nodeId;
    }

    // Uitkomsten van de getoonde hulpbeslisboom die als waarde van de aanwijzende keuzenode zijn over te nemen.
    function takeableItems() {
      const graph = getGraph();
      if (!context || !graph) return [];
      return graph.nodes
        .filter(function (n) { return n.type === "outcome" && GraphState.subtreeValue(context.node, n) !== null; })
        .map(function (n) { return { id: n.id, label: GraphState.describeNode(n) }; });
    }

    // Verwijdert keuzes van een andere boom die na een wijziging niet meer geldig zijn.
    function pruneTree(treeId) {
      const view = Renderer.resolve(zorgpad, treeId);
      if (!view.treeId || !view.graph) return;
      const graph = validatedGraph(view.treeId, view.graph);
      GraphState.prune(graph, getSelections(treeId)).removed.forEach(function (id) { clearSelection(treeId, id); });
    }

    // Neemt de bereikte uitkomst over als keuze van de aanwijzende node en keert terug naar de oorspronkelijke boom.
    function take(info) {
      const ctx = context;
      if (!ctx || !getGraph()) return;
      const outcome = nodeById(info.nodeId);
      const value = GraphState.subtreeValue(ctx.node, outcome);
      if (value === null) return;
      const option = ctx.node.options.filter(function (o) { return o.value === value; })[0];
      setSelection(ctx.parentTreeId, ctx.nodeId, value);
      pruneTree(ctx.parentTreeId);
      pendingReturn = { treeId: ctx.parentTreeId, nodeId: ctx.nodeId, nodeLabel: ctx.label, optionLabel: option ? option.label : String(value) };
      navigate(ctx.parentTreeId);
    }

    function goUp() {
      if (context) navigate(context.parentTreeId);
    }

    // Terug in de oorspronkelijke boom: melding en begeleide reis naar de volgende stap.
    function applyPendingReturn() {
      if (!pendingReturn) return;
      const pr = pendingReturn;
      pendingReturn = null;
      const graph = getGraph();
      if (pr.treeId !== getTreeId() || !graph || !GraphState.isInteractive(graph)) return;
      const selections = getSelections(pr.treeId);
      // Lag de overgenomen node nog niet op de route (vrije volgorde), dan is er geen volgende stap om naartoe te gaan.
      if (GraphState.compute(graph, selections).nodes[pr.nodeId] === "preselected") {
        ChoicePanel.announce(pr.nodeLabel + ": " + pr.optionLabel + " alvast overgenomen uit de hulpbeslisboom.");
        viewport.focusWithoutPan(pr.nodeId);
        return;
      }
      const target = GraphState.nextTarget(graph, selections, pr.nodeId);
      let message = pr.nodeLabel + ": " + pr.optionLabel + " overgenomen uit de hulpbeslisboom.";
      if (target && target.kind === "available") {
        message += " Volgende stap: " + GraphState.describeNode(nodeById(target.id)) + ".";
      } else if (target && target.kind === "outcome") {
        message += " Uitkomst bereikt: " + GraphState.describeNode(nodeById(target.id)) + ".";
      }
      ChoicePanel.announce(message);
      if (target) journey.start(target, pr.nodeId);
      else viewport.focusWithoutPan(pr.nodeId);
    }

    // ----- Balk boven het diagram in een hulpbeslisboom: terug, status, keuzes wissen -----
    // Alleen weergave; de state staat elders.
    const bar = document.createElement("div");
    bar.className = "sub-bar";
    bar.hidden = true;
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Hulpbeslisboom");
    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "zp-btn sub-back";
    const statusText = document.createElement("span");
    statusText.className = "sub-status";
    statusText.setAttribute("role", "status");
    statusText.setAttribute("aria-live", "polite");
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "zp-btn sub-clear";
    clearBtn.textContent = "Keuzes wissen";
    bar.appendChild(backBtn);
    bar.appendChild(statusText);
    bar.appendChild(clearBtn);
    refs.main.insertBefore(bar, refs.stage);
    backBtn.addEventListener("click", goUp);
    clearBtn.addEventListener("click", function () {
      const treeId = getTreeId();
      if (!treeId) return;
      onClearAll();
      clearAllSelections(treeId);
      ChoicePanel.announce("Keuzes in de hulpbeslisboom gewist.");
    });

    function refreshBar(status) {
      const graph = getGraph();
      if (!context || !graph) {
        bar.hidden = true;
        refs.main.classList.remove("in-subtree");
        return;
      }
      bar.hidden = false;
      refs.main.classList.add("in-subtree");
      backBtn.textContent = "← Terug naar " + context.parentLabel;
      backBtn.setAttribute("aria-label", "Terug naar " + context.parentLabel + " zonder uitkomst over te nemen");
      status = status || GraphState.compute(graph, getSelections(getTreeId()));
      const reached = graph.nodes.filter(function (n) { return n.type === "outcome" && status.nodes[n.id] === "selected"; });
      let text = "Beantwoord de vragen om een uitkomst te bereiken.";
      if (reached.length) {
        const name = reached.map(function (n) { return GraphState.describeNode(n); }).join(", ");
        const takeable = reached.filter(function (n) { return GraphState.subtreeValue(context.node, n) !== null; });
        text = takeable.length
          ? "Uitkomst bereikt: " + name + ". Klik op de uitkomst om die over te nemen bij " + context.label + "."
          : "Uitkomst bereikt: " + name + " (niet over te nemen).";
      }
      if (statusText.textContent !== text) statusText.textContent = text;
      clearBtn.disabled = Object.keys(getSelections(getTreeId())).length === 0;
    }

    return {
      setView: setView,
      context: getContext,
      enter: enter,
      takeableItems: takeableItems,
      take: take,
      applyPendingReturn: applyPendingReturn,
      refreshBar: refreshBar
    };
  }

  return { create: create };
})();
