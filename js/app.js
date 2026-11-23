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
     summary.js               samenvatting als tekst, bronregel en link voor een melding
     stage-tools.js           zoomknoppen en bronregel op het werkvlak
     next-step.js             balk met de volgende vraag en sneltoetsen
     carry-over.js            gegevens uit eerdere bomen voorstellen om over te nemen
     search.js, recent.js     zoeken over alle beslisbomen; recent geopend (startpagina)
     help.js                  uitleg bij het eerste bezoek; balk met de gebruiksvoorwaarden
     app.js                   dit bestand: laden, navigatie en het selectiepad

   De keuzes van de getoonde boom staan in de link (#/<boom>?<node>=<waarde>&...), zodat een link precies hetzelfde
   pad opent en de keuzes een verversing overleven.

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
      init: function () {}, setTree: function () {}, refresh: function () {},
      items: function () { return []; }, showFor: function () { return false; }, coveredInsets: function () { return {right: 0, bottom: 0}; }
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
      onReset: function () {}
    });
    const journey = Journey.create({ viewport: viewport, getGraph: getGraph, getInsets: function () { return RP.coveredInsets(); } });
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
      onMeasure: function (treeId, nodeId, number, info) { return selectMeasurement(treeId, nodeId, number, info); },
      // Het werkvlak wordt smaller of breder: houd het midden van het beeld op dezelfde plek.
      onResize: function (oldWidth, newWidth) {
        const v = getState().viewport;
        if (oldWidth && newWidth && oldWidth !== newWidth) setPan(v.panX + (newWidth - oldWidth) / 2, v.panY);
      }
    });

    // ---------- Bediening op het werkvlak ----------
    // Het paneel met patiëntinformatie heeft het werkvlak in een rij gezet: [paneel | kolom[balken, werkvlak]].
    const stageWrap = refs.stage.parentNode;
    const column = stageWrap.parentNode;
    const work = refs.stage.closest(".zp-work") || refs.main;
    const stageTools = (typeof StageTools !== "undefined") ? StageTools.create({
      container: stageWrap,
      onZoomIn: function () { viewport.zoomBy(0.2); },
      onZoomOut: function () { viewport.zoomBy(-0.2); },
      onFit: function () { if (currentGraph && currentGraph.native) { viewport.cancelMove(); viewport.fit(currentGraph); } },
      onStart: function () {
        if (!currentGraph || !currentGraph.native) return;
        viewport.cancelMove();
        if (currentTreeId) viewport.start(currentGraph); else viewport.startOverview(currentGraph);
      },
      onBron: function (info) { showBron(info); }
    }) : { setBron: function () {}, setVisible: function () {} };

    // Volgorde van de keuzes in deze boom (voor Backspace: laatste keuze ongedaan maken).
    let choiceHistory = [];
    const nextStep = (typeof NextStep !== "undefined") ? NextStep.create({
      container: stageWrap,
      // Een optie kiezen gaat via hetzelfde selectiepad als het keuzevenster (ook bij een meetwaarde: dan wordt
      // het bereik gekozen zonder getal).
      onChoose: function (node, option) {
        selectOption(currentTreeId, node.id, option.value, {
          nodeLabel: GraphState.describeNode(node),
          optionLabel: option.label !== undefined ? option.label : option.value
        });
      },
      onLocate: function (nodeId) { journey.locate(nodeId); },
      onShowOutcome: function (nodeId) { ChoicePanel.close(false); RP.showFor(nodeId); },
      onSubtree: function (node, ref) { subtrees.enter({ nodeId: node.id, tree: ref.tree, label: node.label }); },
      onUndo: undoLastChoice,
      isBlocked: function () { return ChoicePanel.isOpen ? ChoicePanel.isOpen() : false; }
    }) : { update: function () {} };

    // Gegevens die in een eerdere boom van dit zorgpad al zijn ingevuld: voorstellen om over te nemen.
    const carryDismissed = {};
    const carryBar = (typeof CarryOver !== "undefined") ? CarryOver.createBar({
      container: column,
      before: stageWrap,
      onApply: applyCarry,
      onDismiss: function () { if (currentTreeId) carryDismissed[currentTreeId] = true; },
      // De knoppen rechtsboven (Aanbevelingen) schuiven mee omlaag zolang de balk er staat.
      onHeight: function (px) { work.style.setProperty("--carry-h", px + "px"); }
    }) : { show: function () {}, hide: function () {} };

    function offerCarry() {
      if (typeof CarryOver === "undefined" || !currentTreeId || carryDismissed[currentTreeId] || !graphIsInteractive()) {
        carryBar.hide();
        return;
      }
      const list = CarryOver.candidates({
        graph: currentGraph,
        treeId: currentTreeId,
        selectionsByTree: getState().selections,
        graphOf: function (id) {
          const t = zorgpad.trees[id];
          const g = t && t.same ? zorgpad.trees[t.same] : t;
          return g && Array.isArray(g.nodes) ? validatedGraph(id, g) : null;
        },
        titleOf: function (id) { return treeTitleOf(id); }
      });
      carryBar.show(list);
    }

    function applyCarry(list) {
      if (!currentTreeId || !list.length) return;
      journey.cancel();
      list.forEach(function (c) {
        GraphState.sameData(currentGraph, c.nodeId, c.value).forEach(function (id) { setSelection(currentTreeId, id, c.value); });
        choiceHistory.push(c.nodeId);
      });
      removeInvalidSelections();
      ChoicePanel.announce("Overgenomen: " + list.map(function (c) { return c.nodeLabel + ": " + c.optionLabel; }).join(", ") + ".");
    }

    function treeTitleOf(id) {
      const t = zorgpad.trees[id];
      const g = t && t.same ? zorgpad.trees[t.same] : t;
      const root = g && Array.isArray(g.nodes) && g.nodes.filter(function (n) { return n.type === "root" && n.label; })[0];
      return root ? String(root.label).replace(/\s+/g, " ").trim() : id;
    }

    // Backspace: de laatst gemaakte keuze in deze boom ongedaan maken. Geeft true als er iets is gewist.
    function undoLastChoice() {
      if (!currentTreeId || !graphIsInteractive()) return false;
      const values = getSelections(currentTreeId);
      while (choiceHistory.length) {
        const id = choiceHistory.pop();
        if (values[id] === undefined) continue;
        const node = nodeById(id);
        clearNodes(currentTreeId, GraphState.sameData(currentGraph, id).filter(function (x) { return values[x] !== undefined; }),
          { nodeLabel: GraphState.describeNode(node) || id });
        return true;
      }
      return false;
    }

    // ---------- Keuzes in de link ----------
    let applyingUrl = false;

    function selectionsFromHash(params) {
      const sel = {};
      params.forEach(function (v, k) { if (k !== "from") sel[k] = v; });
      return sel;
    }

    // Zet de keuzes uit de link in de state (de link wint van wat er in het geheugen stond). Alleen bestaande
    // keuzenodes met een bestaande optie; de rekenkern schoont daarna op wat niet samen kan.
    function applyUrlSelections(treeId, sel) {
      if (!treeId || !graphIsInteractive() || !Object.keys(sel).length) return;
      const current = getSelections(treeId);
      const valid = {};
      Object.keys(sel).forEach(function (id) {
        const node = nodeById(id);
        if (GraphState.isChoice(node) && node.options.some(function (o) { return o.value === sel[id]; })) valid[id] = sel[id];
      });
      if (JSON.stringify(valid) === JSON.stringify(current)) return;
      applyingUrl = true;
      try {
        clearAllSelections(treeId);
        Object.keys(valid).forEach(function (id) { setSelection(treeId, id, valid[id]); choiceHistory.push(id); });
        removeInvalidSelections();
      } finally {
        applyingUrl = false;
      }
    }

    // De link volgt de keuzes: elke wijziging vervangt de huidige link (geen extra stap in de geschiedenis).
    function syncUrl() {
      if (applyingUrl || !currentTreeId) return;
      const parsed = parseHash();
      if (parsed.id !== currentTreeId) return;
      const q = new URLSearchParams();
      if (parsed.fromRaw) q.set("from", parsed.fromRaw);
      const sel = getSelections(currentTreeId);
      Object.keys(sel).forEach(function (k) { if (k !== "from") q.append(k, sel[k]); });
      const qs = q.toString();
      const hash = "#/" + currentTreeId + (qs ? "?" + qs : "");
      if (location.hash !== hash) history.replaceState(history.state, "", location.pathname + location.search + hash);
      updateMobileLink();
    }

    function updateMobileLink() {
      const a = document.getElementById("zp-mobile");
      if (!a) return;
      let href = "mobiel/#/" + encodeURIComponent(tumorId);
      if (currentTreeId) {
        href += "/" + encodeURIComponent(currentTreeId);
        const q = new URLSearchParams(getSelections(currentTreeId)).toString();
        if (q) href += "?" + q;
      }
      a.href = href;
    }

    function shareUrl() {
      return location.href;
    }

    // ---------- Navigatie ----------
    // target: boom-id ("" = overzicht) binnen dit zorgpad, of { tumor, tree } voor het zorgpad van een andere tumor.
    // Overgang bij een klik op een vervolgboom (zoals op Oncoguide): de huidige boom schuift omhoog weg en de
    // volgende komt van onderen in beeld. Niet bij terug naar het overzicht, het kruimelpad of andere tumoren, en
    // niet als de gebruiker minder beweging wil (prefers-reduced-motion).
    const LEAVE_MS = 260;
    let enterNext = false;
    function wantsMotion() {
      return !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }

    function navigate(target, opts) {
      if (opts && opts.via === "reference" && typeof target === "string" && target && refs.stage && wantsMotion()) {
        if (refs.stage.classList.contains("zp-leave")) return; // overgang loopt al
        refs.stage.classList.remove("zp-enter");
        refs.stage.classList.add("zp-leave");
        setTimeout(function () {
          enterNext = true;
          location.hash = "#/" + target;
        }, LEAVE_MS);
        return;
      }
      if (target && typeof target === "object") {
        if (!SAFE_ID.test(String(target.tumor))) return;
        let url = "zorgpad.html?tumor=" + encodeURIComponent(target.tumor);
        if (target.tree && SAFE_ID.test(String(target.tree))) url += "#/" + target.tree;
        location.href = url;
        return;
      }
      location.hash = target ? "#/" + target : "";
    }

    // Hash: #/<boom>[?from=<oudboom>:<node>][&<node>=<waarde>...]. "from" onthoudt vanuit welke node een
    // hulpbeslisboom is geopend; de overige parameters zijn de keuzes in de getoonde boom.
    function parseHash() {
      const raw = location.hash.replace(/^#\//, "");
      const q = raw.indexOf("?");
      const id = decodeURIComponent(q < 0 ? raw : raw.slice(0, q));
      const params = new URLSearchParams(q >= 0 ? raw.slice(q + 1) : "");
      let from = null;
      const value = params.get("from");
      const i = value ? value.indexOf(":") : -1;
      if (i > 0) from = { treeId: value.slice(0, i), nodeId: value.slice(i + 1) };
      return { id: id, from: from, fromRaw: i > 0 ? value : "", selections: selectionsFromHash(params) };
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
        info: showBron,
        recommendation: function (t) { ChoicePanel.close(false); RP.showFor(t.nodeId); }
      });
      Renderer.setTakeable(subtrees.takeableItems());
      patientPanel.setTree({ treeId: view.treeId, label: view.label, graph: view.treeId ? view.graph : null });
      RP.setTree({ treeId: view.treeId, graph: view.treeId && view.graph && GraphState.isInteractive(view.graph) ? view.graph : null });
      // Een klik op een aanbeveling (lichtblauw blok) opent hetzelfde paneel op die aanbeveling.
      if (Renderer.setRecommendable) Renderer.setRecommendable(RP.items());
      // Pas na het tekenen: pas dan heeft het werkvlak zijn (native) afmetingen. Elke boom begint op dezelfde manier:
      // vaste afmetingen, titel bovenaan in het midden (zie Viewport.start). Een overzicht zo veel mogelijk passend.
      if (view.graph && view.graph.native) {
        if (view.treeId) viewport.start(view.graph); else viewport.startOverview(view.graph);
      }
      stageTools.setVisible(!!(view.graph && view.graph.native));
      const bron = typeof Summary !== "undefined" ? Summary.bronLine(zorgpad, view.treeId) : null;
      stageTools.setBron(bron ? bron.text : null);
      choiceHistory = [];
      applyUrlSelections(view.treeId, parsed.selections);
      refreshGraph();
      syncUrl();
      updateMobileLink();
      offerCarry();
      if (view.treeId) {
        if (typeof Recent !== "undefined") Recent.add({ tumorId: tumorId, tumorTitle: zorgpad.titel, treeId: view.treeId, title: view.label });
        if (typeof Help !== "undefined") Help.treeShown();
      }
      subtrees.refreshBar();
      subtrees.applyPendingReturn();
      if (view.treeId) window.scrollTo(0, 0);
      if (refs.stage) {
        refs.stage.classList.remove("zp-leave");
        if (!enterNext) refs.stage.classList.remove("zp-enter");
        if (enterNext) {
          enterNext = false;
          refs.stage.classList.remove("zp-enter");
          void refs.stage.offsetWidth; // animatie opnieuw starten
          refs.stage.classList.add("zp-enter");
        }
      }
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
      host: work,
      stage: refs.stage,
      onShow: showRecommendation,
      onClear: function () { Renderer.setRouteHighlight(null); },
      summary: function () {
        if (!currentTreeId || !currentGraph || typeof Summary === "undefined") return "";
        const values = getSelections(currentTreeId);
        return Summary.text({ zorgpad: zorgpad, treeId: currentTreeId, label: currentLabel, graph: currentGraph,
          selections: values, status: GraphState.compute(currentGraph, values), url: shareUrl() });
      },
      link: shareUrl,
      bron: function () { return typeof Summary !== "undefined" ? Summary.bronLine(zorgpad, currentTreeId) : null; },
      feedbackUrl: function (nodeId) {
        return Summary.feedbackUrl({ zorgpad: zorgpad, treeId: currentTreeId, label: currentLabel, node: nodeById(nodeId), url: shareUrl() });
      },
      // Op een breed scherm staat het paneel naast het diagram: houd het midden van het beeld op dezelfde plek.
      onLayout: function (oldWidth, newWidth) {
        const v = getState().viewport;
        setPan(v.panX + (newWidth - oldWidth) / 2, v.panY);
      }
    });

    // ---------- Keuzes ----------
    // Een interactieve node: open het keuzevenster (of sluit het als het al voor deze node openstaat).
    function interact(item, anchor) {
      if (ChoicePanel.isOpenFor(currentTreeId, item.id)) {
        ChoicePanel.close(true);
        return;
      }
      ChoicePanel.open({ tumorId: tumorId, treeId: currentTreeId, nodeId: item.id, label: item.label, options: item.options, anchor: anchor, subtree: item.subtree,
        measure: GraphState.measureOf(nodeById(item.id)), measurement: getMeasurements(currentTreeId)[item.id] });
    }

    // Berekent de status uit graph + selecties en laat de renderer die toepassen.
    function refreshGraph() {
      if (!graphIsInteractive()) { nextStep.update(null, null); return; }
      const values = getSelections(currentTreeId);
      const status = GraphState.compute(currentGraph, values);
      Renderer.applyStatus(status, values);
      RP.refresh(status);
      patientPanel.refresh(status, values, getMeasurements(currentTreeId));
      subtrees.refreshBar(status);
      nextStep.update(currentGraph, status);
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
      journey.cancel();
      changed.forEach(function (id) { setSelection(treeId, id, value); });
      choiceHistory.push(nodeIds[0]);
      // Nodes met hetzelfde gegeven die deze waarde niet kennen (bv. "cT" met een andere indeling in een andere tak):
      // hun oude waarde zou tegenstrijdig zijn, dus die wordt gewist.
      const current = getSelections(treeId);
      nodeIds.forEach(function (id) {
        GraphState.sameData(currentGraph, id).forEach(function (other) {
          if (nodeIds.indexOf(other) < 0 && current[other] !== undefined) clearSelection(treeId, other);
        });
      });
      afterSelection(treeId, nodeIds, info);
    }

    // Meetwaarde: de gebruiker vult een getal in (bv. 32 mm). Elke node met hetzelfde gegeven in deze boom krijgt de
    // optie waarvan het bereik dat getal bevat (bv. "20-40 mm" in de ene tak, "<=4 cm" in de andere). Valt het getal
    // bij een andere node buiten alle bereiken, dan wordt die leeg gelaten. Geeft false als het getal bij de
    // gekozen node zelf nergens past.
    function selectMeasurement(treeId, nodeId, number, info) {
      if (treeId !== currentTreeId) return false;
      const node = nodeById(nodeId);
      const measure = GraphState.measureOf(node);
      if (!measure) return false;
      const unitText = measure.unit ? " " + measure.unit : "";
      if (GraphState.optionForMeasure(node, number) === null) {
        ChoicePanel.announce(info.nodeLabel + ": " + formatNumber(number) + unitText + " valt buiten de mogelijkheden van deze stap.");
        return false;
      }
      journey.cancel();
      const group = GraphState.sameData(currentGraph, nodeId).filter(function (id) {
        const m = GraphState.measureOf(nodeById(id));
        return m && m.unit === measure.unit;
      });
      const set = [];
      group.forEach(function (id) {
        const v = GraphState.optionForMeasure(nodeById(id), number);
        if (v === null) {
          if (getSelections(treeId)[id] !== undefined) clearSelection(treeId, id);
          return;
        }
        setMeasurement(treeId, id, number);
        setSelection(treeId, id, v);
        set.push(id);
      });
      const option = node.options.filter(function (o) { return o.value === GraphState.optionForMeasure(node, number); })[0];
      afterSelection(treeId, set, {
        nodeLabel: info.nodeLabel,
        optionLabel: formatNumber(number) + unitText + " (" + (option ? option.label : "") + ")",
        source: info.source
      });
      return true;
    }

    function formatNumber(n) {
      return String(n).replace(".", ",");
    }

    // Na het vastleggen van een keuze: opschonen, melding en begeleide reis naar de volgende stap.
    function afterSelection(treeId, nodeIds, info) {
      const keepFocus = info.source === "panel";
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
        if (!keepFocus && nodeIds.length) viewport.focusWithoutPan(nodeIds[0]);
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

    // Keuze in het keuzevenster of via een connector: geldt voor het hele gegeven, dus ook voor nodes met hetzelfde
    // gegeven in andere takken van de boom (bv. "Regio tumor" onder twee routes). De gekozen node gaat voor.
    function selectOption(treeId, nodeId, value, info) {
      selectNodes(treeId, GraphState.sameData(currentGraph, nodeId, value), value, info);
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

    // Klik of toets op een connector: dezelfde functie als de radioknop in het keuzevenster. Hoort de connector
    // bij meerdere waarden ("value": ["1", "2"]), dan opent het keuzevenster van de node om er één te kiezen.
    function selectEdge(choice) {
      const measured = GraphState.measureOf(nodeById(choice.nodeId));
      if (measured || (choice.values && choice.values.length > 1)) {
        const node = nodeById(choice.nodeId);
        const anchor = refs.svg.querySelector('.node[data-node-id="' + choice.nodeId + '"]');
        if (!node || !anchor) return;
        const ref = GraphState.subtreeOf(node);
        interact({ id: node.id, label: node.label, options: node.options, subtree: ref ? { tree: ref.tree } : null, measure: GraphState.measureOf(node) }, anchor);
        return;
      }
      selectOption(currentTreeId, choice.nodeId, choice.value,
        { nodeLabel: choice.nodeLabel, optionLabel: choice.optionLabel });
    }

    // Keuzevenster: een keuze gaat uitsluitend via selectOption.
    ChoicePanel.init({
      onSelect: selectOption,
      // Wissen geldt ook voor het hele gegeven: anders zou de andere tak de oude waarde houden.
      onClear: function (treeId, nodeId, info) {
        const values = getSelections(treeId);
        clearNodes(treeId, GraphState.sameData(currentGraph, nodeId).filter(function (id) { return values[id] !== undefined; }), info);
      },
      onSubtree: function (info) { if (info.treeId === currentTreeId) subtrees.enter({ nodeId: info.nodeId, tree: info.tree, label: info.label }); },
      onMeasure: function (treeId, nodeId, number, info) { return selectMeasurement(treeId, nodeId, number, info); }
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
          syncUrl();
        }
      }
    });

    if (typeof Breadcrumb !== "undefined") {
      Breadcrumb.init({ onCarepathNavigate: function () { navigate(""); } });
    }
    window.addEventListener("hashchange", showRoute);

    if (typeof Search !== "undefined") {
      const searchInput = document.getElementById("zp-search");
      if (searchInput) Search.attach(searchInput, { base: "./" });
    }
    if (typeof Help !== "undefined") {
      Help.init({
        helpButton: document.getElementById("zp-help"),
        termsLink: document.getElementById("zp-terms"),
        footer: document.getElementById("zp-footer")
      });
    }

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
