/* Zorgpadpagina (zorgpad.html): laadt het zorgpad, kiest de getoonde boom uit de URL en verbindt de onderdelen.

   Indeling van de code:
     state.js                 centrale status (keuzes, viewport) – bron van waarheid
     graph-state.js           rekenkern: wat is gekozen, bereikt, mogelijk of uitgesloten (geen DOM)
     graph-validator.js       controleert de interactiegegevens van een boom (geen DOM)
     layout-engine.js         rekent posities en lijnen uit (geen DOM)
     renderer.js              tekent een boom als SVG en past statussen toe
     viewport.js              zoomen, slepen, passend maken, vloeiend pannen
     journey.js               begeleide reis naar de volgende stap na een keuze
     subtrees.js              hulpbeslisbomen (openen, uitkomst overnemen, balk)
     choice-panel.js          keuzevenster bij een keuzenode
     patient-panel.js         paneel met patiëntinformatie (links, in- en uitklapbaar)
     recommendations-panel.js aanbevelingenoverzicht
     bron.js                  bronvermelding in het informatiepaneel
     app.js                   dit bestand: laden, navigatie en het selectiepad

   De homepage (index.html) gebruikt js/home.js. */
(function () {
  "use strict";

  const TUMOREN_URL = "./data/tumoren.json";
  const SAFE_ID = /^[a-z0-9_-]+$/i;

  async function loadJSON(url) {
    const response = await fetch(url);
    if (!response.ok) {
      const err = new Error("HTTP " + response.status);
      err.status = response.status;
      throw err;
    }
    return JSON.parse(await response.text());
  }

  function loadTumoren() {
    return loadJSON(TUMOREN_URL).then(function (data) {
      return Array.isArray(data.tumoren) ? data.tumoren : [];
    });
  }

  function isRenderable(zorgpad) {
    const o = zorgpad && zorgpad.overview;
    if (!o || !Array.isArray(o.nodes)) return false;
    // Met de layout-engine mogen viewBox, nodeSize en edges ontbreken (die worden dan afgeleid).
    if (typeof LayoutEngine !== "undefined") return true;
    return Array.isArray(o.viewBox) && Array.isArray(o.nodeSize) && Array.isArray(o.edges);
  }

  async function initZorgpad() {
    const refs = {
      main: document.getElementById("zp-main"),
      svg: document.getElementById("zp-chart"),
      message: document.getElementById("zp-message"),
      stage: document.getElementById("zp-stage"),
      // Optioneel: zoomknoppen bestaan alleen als ze in de HTML staan
      zoomIn: document.getElementById("zp-zin"),
      zoomOut: document.getElementById("zp-zout")
    };
    if (!refs.main || !refs.svg || !refs.message) return;

    // Het aanbevelingenpaneel is optioneel: ontbreekt js/recommendations-panel.js (nog) op de server, dan werkt het
    // zorgpad gewoon zonder dat paneel in plaats van te blijven hangen op "Laden…".
    const RP = (typeof RecommendationsPanel !== "undefined" && RecommendationsPanel) || {
      init: function () {}, setTree: function () {}, refresh: function () {}, coveredInsets: function () { return {right: 0, bottom: 0}; }
    };

    function showMessage(text, isError, homeLink) {
      refs.svg.classList.add("zp-hidden");
      refs.message.classList.remove("zp-hidden");
      refs.message.textContent = "";
      const p = document.createElement("p");
      if (isError) p.className = "error";
      p.textContent = text;
      refs.message.appendChild(p);
      if (homeLink) {
        const a = document.createElement("a");
        a.className = "zp-message-link";
        a.href = "index.html";
        a.textContent = "Terug naar alle zorgpaden";
        refs.message.appendChild(a);
      }
    }

    refs.svg.classList.add("zp-hidden");

    // ---------- Laden ----------
    const tumorId = new URLSearchParams(window.location.search).get("tumor");

    // Alleen veilige id's toestaan (voorkomt ongewenste paden)
    if (!tumorId || !SAFE_ID.test(tumorId)) {
      showMessage("Geen (geldige) tumor opgegeven in de URL.", true);
      return;
    }

    let zorgpad;
    let tumoren = [];
    try {
      tumoren = await loadTumoren();
      if (!tumoren.some(function (t) { return t.id === tumorId; })) {
        showMessage("Onbekende tumor: " + tumorId, true);
        return;
      }
      zorgpad = await loadJSON("./data/" + tumorId + "/zorgpad.json");
    } catch (err) {
      if (err instanceof SyntaxError) {
        showMessage("Het zorgpadbestand bevat ongeldige JSON.", true);
      } else if (err.status === 404) {
        // De tumor staat in de lijst, maar er is nog geen zorgpadbestand: geen fout, het zorgpad komt nog.
        const info = tumoren.filter(function (t) { return t.id === tumorId; })[0];
        showMessage("Het zorgpad " + (info && info.titel ? info.titel : tumorId) + " is nog in voorbereiding.", false, true);
      } else {
        showMessage("Fout bij laden van zorgpad: " + err.message, true);
      }
      return;
    }

    if (!zorgpad || typeof zorgpad !== "object" || typeof zorgpad.titel !== "string") {
      showMessage("Het zorgpadbestand heeft een ongeldige opbouw.", true);
      return;
    }

    // Centrale instelling: elk zorgpad en elke beslisboom (ook hulpbeslisbomen) is te zoomen en te pannen.
    // Een graph hoeft "native": true dus niet meer te zetten; alleen een expliciete "native": false schakelt het uit.
    [zorgpad.overview].concat(Object.keys(zorgpad.trees || {}).map(function (k) { return zorgpad.trees[k]; }))
      .forEach(function (gr) {
        if (gr && typeof gr === "object" && Array.isArray(gr.nodes) && gr.native === undefined) gr.native = true;
      });

    // Alias-nodetypes (title, dataItem, recommendation, reference) omzetten naar de bestaande types, zodat
    // renderer, validator en rekenkern hetzelfde zien.
    if (typeof LayoutEngine !== "undefined") zorgpad = LayoutEngine.normalize(zorgpad);

    setTumor(tumorId);
    document.title = zorgpad.titel + " – Gynaecologische zorgpaden";

    if (!zorgpad.overview) {
      showMessage("Het interactieve zorgpad " + zorgpad.titel.toLowerCase() + " wordt later toegevoegd.", false, true);
      return;
    }

    if (!isRenderable(zorgpad)) {
      showMessage("Het zorgpadbestand heeft een ongeldige opbouw.", true);
      return;
    }

    Renderer.init({main: refs.main, svg: refs.svg, message: refs.message});

    // ---------- Getoonde boom ----------
    let currentGraph = null;
    let currentTreeId = null;
    let currentLabel = "";

    function getGraph() { return currentGraph; }
    function getTreeId() { return currentTreeId; }

    function nodeById(id) {
      return currentGraph ? currentGraph.nodes.filter(function (n) { return n.id === id; })[0] : undefined;
    }

    function graphIsInteractive() {
      return !!currentGraph && GraphState.isInteractive(currentGraph);
    }

    // ---------- Onderdelen ----------
    const viewport = Viewport.create({
      refs: refs,
      getGraph: getGraph,
      onUserMove: function () {},
      onReset: ensureFirstAvailableVisible
    });
    const journey = Journey.create({ viewport: viewport, getGraph: getGraph });
    const subtrees = Subtrees.create({
      zorgpad: zorgpad,
      refs: refs,
      getGraph: getGraph,
      getTreeId: getTreeId,
      validatedGraph: validatedGraph,
      navigate: navigate,
      journey: journey,
      viewport: viewport,
      onClearAll: function () { journey.cancel(); journey.clearGuidedTarget(); }
    });
    // Paneel met patiëntinformatie: dezelfde keuzes als in de boom, als lijst met invoervelden.
    const patientPanel = PatientPanel.create({
      refs: refs,
      onSelect: function (treeId, nodeIds, value, info) { selectNodes(treeId, nodeIds, value, info); },
      onClear: function (treeId, nodeIds, info) { clearNodes(treeId, nodeIds, info); },
      onClearAll: function (treeId) {
        if (treeId !== currentTreeId) return;
        journey.cancel();
        journey.clearGuidedTarget();
        clearAllSelections(treeId);
        ChoicePanel.announce("Alle keuzes in " + currentLabel + " gewist.");
      },
      onLocate: function (nodeId) { journey.locate(nodeId); },
      onSubtree: function (info) { subtrees.enter(info); },
      // Het werkvlak wordt smaller of breder: houd het midden van het beeld op dezelfde plek.
      onResize: function (oldWidth, newWidth) {
        const v = getState().viewport;
        if (oldWidth && newWidth && oldWidth !== newWidth) setPan(v.panX + (newWidth - oldWidth) / 2, v.panY);
      }
    });

    // ---------- Navigatie ----------
    // target: boom-id ("" = overzicht) binnen dit zorgpad, of { tumor, tree } voor het zorgpad van een andere tumor.
    function navigate(target) {
      if (target && typeof target === "object") {
        if (!SAFE_ID.test(String(target.tumor))) return;
        let url = "zorgpad.html?tumor=" + encodeURIComponent(target.tumor);
        if (target.tree && SAFE_ID.test(String(target.tree))) url += "#/" + target.tree;
        location.href = url;
        return;
      }
      location.hash = target ? "#/" + target : "";
    }

    // Hash: #/<boom>[?from=<oudboom>:<node>]. "from" onthoudt vanuit welke node een hulpbeslisboom is geopend.
    function parseHash() {
      const raw = location.hash.replace(/^#\//, "");
      const q = raw.indexOf("?");
      const id = q < 0 ? raw : raw.slice(0, q);
      let from = null;
      if (q >= 0) {
        const value = new URLSearchParams(raw.slice(q + 1)).get("from");
        const i = value ? value.indexOf(":") : -1;
        if (i > 0) from = { treeId: value.slice(0, i), nodeId: value.slice(i + 1) };
      }
      return { id: id, from: from };
    }

    // Kruimelpad: zorgpadtitel uit de JSON; bij een beslisboom ook de titel van die boom.
    function updateBreadcrumb(view) {
      if (typeof Breadcrumb === "undefined") return;
      Breadcrumb.update({
        carepathTitle: zorgpad.titel,
        treeTitle: view.treeId ? view.label : "",
        isOverview: !view.treeId
      });
    }

    // Validatie van de interactiemetadata: eenmalig per zorgpad; meldingen alleen in de console.
    // Alleen nodes die de validator goedkeurt blijven interactief; de boom wordt altijd gewoon getekend.
    const validation = GraphValidator.validateTumor(zorgpad, tumorId);
    GraphValidator.report({ issues: validation.issues });

    function validatedGraph(treeId, graph) {
      if (!treeId || !graph) return graph;
      let result = validation.trees[treeId];
      if (!result) {
        // Hergebruikte boom (same): dezelfde graph, aparte keuzes; de meldingen staan al onder de bronboom.
        const source = zorgpad.trees[treeId] && zorgpad.trees[treeId].same;
        result = (source && validation.trees[source]) || GraphValidator.validate(graph, { tumor: tumorId, tree: treeId });
        validation.trees[treeId] = result;
      }
      return result.graph;
    }

    // Zorgt dat de eerste beschikbare keuzenode na het passend maken in beeld staat (bij een grote boom kan de
    // minimale zoom de bovenkant buiten het werkvlak laten vallen). Zoom blijft ongewijzigd; alleen de pan past aan.
    function ensureFirstAvailableVisible() {
      if (!graphIsInteractive() || !refs.stage.clientWidth) return;
      const status = GraphState.compute(currentGraph, getSelections(currentTreeId));
      const id = status.available[0];
      if (!id || viewport.isFullyVisible(id)) return;
      const c = viewport.centeredPan(id);
      setPan(c.x, c.y);
    }

    // Leest de URL-hash, werkt de state bij en laat de renderer tekenen.
    function showRoute() {
      const parsed = parseHash();
      const view = Renderer.resolve(zorgpad, parsed.id);
      view.graph = validatedGraph(view.treeId, view.graph);
      currentGraph = view.graph;
      currentTreeId = view.treeId;
      currentLabel = view.label;
      subtrees.setView(view, parsed.from);
      setTree(view.treeId);
      document.title = view.treeId ? view.label + " – " + zorgpad.titel : zorgpad.titel;
      updateBreadcrumb(view);
      journey.cancel();
      journey.clearGuidedTarget();
      ChoicePanel.close(false);
      Renderer.draw(view, {
        navigate: navigate,
        interact: interact,
        select: selectEdge,
        subtree: subtrees.enter,
        take: subtrees.take,
        info: showBron
      });
      Renderer.setTakeable(subtrees.takeableItems());
      patientPanel.setTree({ treeId: view.treeId, label: view.label, graph: view.treeId ? view.graph : null });
      RP.setTree({ treeId: view.treeId, graph: view.treeId && view.graph && GraphState.isInteractive(view.graph) ? view.graph : null });
      // Pas na het tekenen: pas dan heeft het werkvlak zijn (native) afmetingen.
      if (view.graph && view.graph.native) {
        viewport.fit(view.graph);
        ensureFirstAvailableVisible();
      }
      refreshGraph();
      subtrees.refreshBar();
      subtrees.applyPendingReturn();
      if (view.treeId) window.scrollTo(0, 0);
    }

    // Klik op de titel van het zorgpad of van een beslisboom: bronvermelding in het informatiepaneel.
    function showBron(info) {
      const title = currentTreeId ? currentLabel + " – " + zorgpad.titel : zorgpad.titel;
      Bron.show(zorgpad, currentTreeId, title, info && info.element);
    }

    // ---------- Aanbevelingenoverzicht ----------
    // Markeert de route (nodes en connectors) in de boom en brengt de aanbeveling in beeld, buiten het paneel.
    function showRecommendation(target) {
      Renderer.setRouteHighlight(target);
      if (!currentGraph || !currentGraph.native || !target.targetId) return;
      journey.cancel();
      journey.clearGuidedTarget();
      const insets = RP.coveredInsets();
      if (viewport.isFullyVisible(target.targetId, insets)) return;
      viewport.movePanTo(viewport.centeredPan(target.targetId, insets));
    }

    RP.init({
      host: refs.main,
      stage: refs.stage,
      onShow: showRecommendation,
      onClear: function () { Renderer.setRouteHighlight(null); }
    });

    // ---------- Keuzes ----------
    // Een interactieve node: open het keuzevenster (of sluit het als het al voor deze node openstaat).
    function interact(item, anchor) {
      if (ChoicePanel.isOpenFor(currentTreeId, item.id)) {
        ChoicePanel.close(true);
        return;
      }
      ChoicePanel.open({ tumorId: tumorId, treeId: currentTreeId, nodeId: item.id, label: item.label, options: item.options, anchor: anchor });
    }

    // Berekent de status uit graph + selecties en laat de renderer die toepassen.
    function refreshGraph() {
      if (!graphIsInteractive()) return;
      const values = getSelections(currentTreeId);
      const status = GraphState.compute(currentGraph, values);
      Renderer.applyStatus(status, values);
      RP.refresh(status);
      patientPanel.refresh(status, values);
      subtrees.refreshBar(status);
    }

    // Verwijdert keuzes die door een wijziging niet meer geldig of mogelijk zijn (via de state-functies).
    function removeInvalidSelections() {
      if (!graphIsInteractive()) return [];
      const result = GraphState.prune(currentGraph, getSelections(currentTreeId));
      result.removed.forEach(function (id) { clearSelection(currentTreeId, id); });
      return result.removed;
    }

    // Melding voor keuzes die door een nieuwe keuze niet meer mogelijk zijn en dus zijn gewist (leeg als er geen zijn).
    function removedMessage(removed) {
      if (!removed || !removed.length) return "";
      const names = removed.map(function (id) { return GraphState.describeNode(nodeById(id)) || id; });
      return " Niet meer van toepassing, keuze gewist: " + names.join(", ") + ".";
    }

    // Eén selectiepad voor een keuze, ongeacht de bron (keuzevenster, connector of paneel met patiëntinformatie):
    // centrale state -> opschonen -> melding -> begeleide reis. SVG, venster en paneel volgen via subscribe.
    // nodeIds: één node, of alle nodes van hetzelfde gegeven (het paneel vult een gegeven in elke tak in waar het
    // voorkomt). info: { nodeLabel, optionLabel, source }. Bij source "panel" blijft de toetsenbordfocus in het paneel.
    function selectNodes(treeId, nodeIds, value, info) {
      if (treeId !== currentTreeId || !nodeIds.length) return;
      const before = getSelections(treeId);
      const changed = nodeIds.filter(function (id) { return before[id] !== value; });
      if (!changed.length) return;
      const keepFocus = info.source === "panel";
      journey.cancel();
      changed.forEach(function (id) { setSelection(treeId, id, value); });
      // Nodes van hetzelfde gegeven die door deze keuze afvallen, worden stil gewist (het gegeven zelf staat er nog).
      const removed = removeInvalidSelections().filter(function (id) { return nodeIds.indexOf(id) < 0; });
      ChoicePanel.close(false);
      const vervallen = removedMessage(removed);
      const status = GraphState.compute(currentGraph, getSelections(treeId));
      // De node op de route; is er geen, dan is de keuze alvast ingevuld (vrije volgorde) en is er nog geen route
      // om te volgen. Die loopt automatisch door zodra de eerdere keuzes zijn gemaakt.
      const reached = nodeIds.filter(function (id) { return status.nodes[id] === "selected"; })[0];
      if (!reached) {
        journey.clearGuidedTarget();
        ChoicePanel.announce(info.nodeLabel + ": " + info.optionLabel + " alvast geselecteerd." + vervallen);
        if (!keepFocus) viewport.focusWithoutPan(nodeIds[0]);
        return;
      }
      const target = GraphState.nextTarget(currentGraph, getSelections(treeId), reached);
      let message = info.nodeLabel + ": " + info.optionLabel + " geselecteerd.";
      if (target && target.kind === "available") {
        message += " Volgende stap: " + GraphState.describeNode(nodeById(target.id)) + ".";
      } else if (target && target.kind === "outcome") {
        message += " Uitkomst bereikt: " + GraphState.describeNode(nodeById(target.id)) + ".";
      } else if (target && target.kind === "end") {
        message += " De route loopt verder bij: " + GraphState.describeNode(nodeById(target.id)) + ".";
      }
      ChoicePanel.announce(message + vervallen);
      if (target) journey.start(target, reached, { keepFocus: keepFocus });
    }

    function selectOption(treeId, nodeId, value, info) {
      selectNodes(treeId, [nodeId], value, info);
    }

    // Wist de keuze van één of meer nodes (keuzevenster of paneel) en wat daardoor niet meer geldig is.
    function clearNodes(treeId, nodeIds, info) {
      if (treeId !== currentTreeId) return;
      journey.cancel();
      journey.clearGuidedTarget();
      nodeIds.forEach(function (id) { clearSelection(treeId, id); });
      const removed = removeInvalidSelections();
      ChoicePanel.announce("Keuze voor " + info.nodeLabel + " gewist." + removedMessage(removed));
    }

    // Klik of toets op een connector: dezelfde functie als de radioknop in het keuzevenster.
    function selectEdge(choice) {
      selectOption(currentTreeId, choice.nodeId, choice.value,
        { nodeLabel: choice.nodeLabel, optionLabel: choice.optionLabel });
    }

    // Keuzevenster: een keuze gaat uitsluitend via selectOption.
    ChoicePanel.init({
      onSelect: selectOption,
      onClear: function (treeId, nodeId, info) { clearNodes(treeId, [nodeId], info); }
    });

    // Eén abonnement voor de hele pagina: viewport en selecties worden toegepast zodra de state verandert.
    subscribe(function (snapshot, key, detail) {
      if (key === "viewport") {
        Renderer.applyViewport();
        ChoicePanel.position();
      } else if (key === "selections") {
        // Alleen herberekenen als de wijziging de getoonde boom betreft (of alle bomen).
        if (!detail || !detail.treeId || detail.treeId === currentTreeId) {
          refreshGraph();
          ChoicePanel.sync();
        }
      }
    });

    if (typeof Breadcrumb !== "undefined") {
      Breadcrumb.init({ onCarepathNavigate: function () { navigate(""); } });
    }
    window.addEventListener("hashchange", showRoute);

    try {
      showRoute();
    } catch (err) {
      showMessage("Fout bij weergeven van zorgpad: " + err.message, true);
    }
  }

  // ---------- Start ----------
  document.addEventListener("DOMContentLoaded", function () {
    if (document.body.dataset.page !== "zorgpad") return;
    initZorgpad().catch(function (err) {
      const m = document.getElementById("zp-message");
      if (m) { m.textContent = ""; const p = document.createElement("p"); p.className = "error"; p.textContent = "Fout bij starten van het zorgpad: " + err.message; m.appendChild(p); }
      if (window.console) console.error(err);
    });
  });
})();
