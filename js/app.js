(function () {
  "use strict";

  const TUMOREN_URL = "./data/tumoren.json";

  async function fetchText(url) {
    const response = await fetch(url);
    if (!response.ok) {
      const err = new Error("HTTP " + response.status);
      err.status = response.status;
      throw err;
    }
    return response.text();
  }

  async function loadJSON(url) {
    return JSON.parse(await fetchText(url));
  }

  function loadTumoren() {
    return loadJSON(TUMOREN_URL).then(function (data) {
      return Array.isArray(data.tumoren) ? data.tumoren : [];
    });
  }

  // ---------- Homepage ----------
  async function initHome() {
    const container = document.getElementById("tumor-cards");
    if (!container) return;

    try {
      const tumoren = await loadTumoren();
      container.textContent = "";

      tumoren.forEach(function (tumor) {
        const card = document.createElement("a");
        card.className = "card";
        card.href = "zorgpad.html?tumor=" + encodeURIComponent(tumor.id);

        const title = document.createElement("h3");
        title.textContent = tumor.titel;

        const desc = document.createElement("p");
        desc.textContent = tumor.beschrijving || "";

        card.appendChild(title);
        card.appendChild(desc);
        container.appendChild(card);
      });

      if (tumoren.length === 0) {
        container.innerHTML = '<p class="status">Geen zorgpaden beschikbaar.</p>';
      }
    } catch (err) {
      container.innerHTML = '<p class="status error"></p>';
      container.firstChild.textContent = "Fout bij laden van zorgpaden: " + err.message;
    }
  }

  // ---------- Zorgpadpagina ----------
  function isRenderable(zorgpad) {
    const o = zorgpad && zorgpad.overview;
    if (!o || !Array.isArray(o.nodes)) return false;
    // Met de layout-engine mogen viewBox, nodeSize en edges ontbreken (die worden dan afgeleid).
    if (typeof LayoutEngine !== "undefined") return true;
    return Array.isArray(o.viewBox) && Array.isArray(o.nodeSize) && Array.isArray(o.edges);
  }

  const ZOOM_STEP = 0.2;
  const WHEEL_SENSITIVITY = 0.0015;
  const WHEEL_PINCH_SENSITIVITY = 0.01;
  const DRAG_THRESHOLD = 4;
  const FOCUS_MARGIN = 16;
  const JOURNEY_MIN_MS = 350;
  const JOURNEY_MAX_MS = 700;
  const VISIBLE_MARGIN = 24;
  const CENTER_TOLERANCE = 0.2;
  const GUIDED_HIGHLIGHT_MS = 1600;

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

    const tumorId = new URLSearchParams(window.location.search).get("tumor");

    // Alleen veilige id's toestaan (voorkomt ongewenste paden)
    if (!tumorId || !/^[a-z0-9_-]+$/i.test(tumorId)) {
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

    // Alias-nodetypes (title, dataItem, recommendation, reference) omzetten naar de bestaande types, zodat
    // renderer, validator en route-engine hetzelfde zien. Zonder aliassen komt hetzelfde object terug.
    if (typeof LayoutEngine !== "undefined") zorgpad = LayoutEngine.normalize(zorgpad);

    setTumor(tumorId);
    document.title = zorgpad.titel + " – Gynaecologische zorgpaden";

    if (!zorgpad.overview) {
      // Nog geen renderbaar zorgpad (bv. endometrium in Sprint 3)
      refs.message.textContent = "";
      const label = document.createElement("p");
      label.className = "loaded-label";
      label.textContent = "Tumor geladen:";
      const title = document.createElement("h2");
      title.className = "loaded-title";
      title.textContent = zorgpad.titel;
      const note = document.createElement("p");
      note.textContent = "Het interactieve zorgpad " + zorgpad.titel.toLowerCase() + " wordt later toegevoegd.";
      refs.message.appendChild(label);
      refs.message.appendChild(title);
      refs.message.appendChild(note);
      refs.message.classList.remove("zp-hidden");
      return;
    }

    if (!isRenderable(zorgpad)) {
      showMessage("Het zorgpadbestand heeft een ongeldige opbouw.", true);
      return;
    }

    Renderer.init({main: refs.main, svg: refs.svg, message: refs.message});

    const SAFE_ID = /^[a-z0-9_-]+$/i;

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

    let currentGraph = null;
    let currentTreeId = null;
    // Hulpbeslisboom: { parentTreeId, nodeId, node, label } als de getoonde boom vanuit een keuzenode is geopend.
    let currentContext = null;
    // Na het overnemen van een uitkomst: { treeId, nodeId } waarvoor na terugkeren de volgende stap wordt getoond.
    let pendingReturn = null;

    // Zet de door de renderer berekende passende zoom en pan in de centrale state.
    function applyFit(graph) {
      const fit = Renderer.fitViewport(graph, refs.stage.clientWidth, refs.stage.clientHeight);
      setZoom(fit.zoom);
      setPan(fit.panX, fit.panY);
    }

    // Zorgt dat de eerste beschikbare keuzenode na het passend maken in beeld staat (bij een grote boom kan de
    // minimale zoom de bovenkant buiten het werkvlak laten vallen). Zoom blijft ongewijzigd; alleen de pan past aan.
    function ensureFirstAvailableVisible() {
      if (!graphIsInteractive() || !refs.stage.clientWidth) return;
      const status = GraphState.compute(currentGraph, getSelections(currentTreeId));
      const id = status.available[0];
      if (!id) return;
      const r = nodeOnScreen(id);
      const w = refs.stage.clientWidth;
      const h = refs.stage.clientHeight;
      const fullyVisible = r.left >= VISIBLE_MARGIN && r.right <= w - VISIBLE_MARGIN &&
        r.top >= VISIBLE_MARGIN && r.bottom <= h - VISIBLE_MARGIN;
      if (!fullyVisible) {
        const c = centeredPan(id);
        setPan(c.x, c.y);
      }
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
      currentContext = resolveContext(view, parsed.from);
      setTree(view.treeId);
      document.title = view.treeId ? view.label + " – " + zorgpad.titel : zorgpad.titel;
      updateBreadcrumb(view);
      cancelJourney();
      clearGuidedTarget();
      ChoicePanel.close(false);
      Renderer.draw(view, { navigate: navigate, interact: interact, select: selectEdge, subtree: enterSubtree, take: takeOutcome });
      Renderer.setTakeable(takeableItems());
      RecommendationsPanel.setTree({ treeId: view.treeId, graph: view.treeId && view.graph && GraphState.isInteractive(view.graph) ? view.graph : null });
      // Pas na het tekenen: pas dan heeft het werkvlak zijn (native) afmetingen.
      if (view.graph && view.graph.native) {
        applyFit(view.graph);
        ensureFirstAvailableVisible();
      }
      refreshGraph();
      refreshSubtreeBar();
      applyPendingReturn();
      if (view.treeId) window.scrollTo(0, 0);
    }

    // ----- Hulpbeslisbomen -----
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

    // Een klik op een keuzenode met hulpbeslisboom: open die boom, met de herkomst in de hash.
    function enterSubtree(info) {
      if (!currentTreeId) return;
      location.hash = "#/" + info.tree + "?from=" + currentTreeId + ":" + info.nodeId;
    }

    // Uitkomsten van de getoonde hulpbeslisboom die als waarde van de aanwijzende keuzenode zijn over te nemen.
    function takeableItems() {
      if (!currentContext || !currentGraph) return [];
      return currentGraph.nodes
        .filter(function (n) { return n.type === "outcome" && GraphState.subtreeValue(currentContext.node, n) !== null; })
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
    function takeOutcome(info) {
      const ctx = currentContext;
      if (!ctx || !currentGraph) return;
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
      if (currentContext) navigate(currentContext.parentTreeId);
    }

    // Terug in de oorspronkelijke boom: melding en begeleide reis naar de volgende stap.
    function applyPendingReturn() {
      if (!pendingReturn) return;
      const pr = pendingReturn;
      pendingReturn = null;
      if (pr.treeId !== currentTreeId || !graphIsInteractive()) return;
      const target = GraphState.nextTarget(currentGraph, getSelections(currentTreeId), pr.nodeId);
      let message = pr.nodeLabel + ": " + pr.optionLabel + " overgenomen uit de hulpbeslisboom.";
      if (target && target.kind === "available") {
        message += " Volgende stap: " + GraphState.describeNode(nodeById(target.id)) + ".";
      } else if (target && target.kind === "outcome") {
        message += " Uitkomst bereikt: " + GraphState.describeNode(nodeById(target.id)) + ".";
      }
      ChoicePanel.announce(message);
      if (target) startJourney(target, pr.nodeId);
      else focusWithoutPan(pr.nodeId);
    }

    // Balk boven het diagram in een hulpbeslisboom: terug, status, keuzes wissen. Alleen weergave; de state staat elders.
    const subBar = document.createElement("div");
    subBar.className = "sub-bar";
    subBar.hidden = true;
    subBar.setAttribute("role", "group");
    subBar.setAttribute("aria-label", "Hulpbeslisboom");
    const subBack = document.createElement("button");
    subBack.type = "button";
    subBack.className = "zp-btn sub-back";
    const subStatus = document.createElement("span");
    subStatus.className = "sub-status";
    subStatus.setAttribute("role", "status");
    subStatus.setAttribute("aria-live", "polite");
    const subClear = document.createElement("button");
    subClear.type = "button";
    subClear.className = "zp-btn sub-clear";
    subClear.textContent = "Keuzes wissen";
    subBar.appendChild(subBack);
    subBar.appendChild(subStatus);
    subBar.appendChild(subClear);
    refs.main.insertBefore(subBar, refs.stage);
    subBack.addEventListener("click", goUp);
    subClear.addEventListener("click", function () {
      if (!currentTreeId) return;
      cancelJourney();
      clearGuidedTarget();
      clearAllSelections(currentTreeId);
      ChoicePanel.announce("Keuzes in de hulpbeslisboom gewist.");
    });

    function refreshSubtreeBar(status) {
      if (!currentContext || !currentGraph) {
        subBar.hidden = true;
        refs.main.classList.remove("in-subtree");
        return;
      }
      subBar.hidden = false;
      refs.main.classList.add("in-subtree");
      subBack.textContent = "← Terug naar " + currentContext.parentLabel;
      subBack.setAttribute("aria-label", "Terug naar " + currentContext.parentLabel + " zonder uitkomst over te nemen");
      status = status || GraphState.compute(currentGraph, getSelections(currentTreeId));
      const reached = currentGraph.nodes.filter(function (n) { return n.type === "outcome" && status.nodes[n.id] === "selected"; });
      let text = "Beantwoord de vragen om een uitkomst te bereiken.";
      if (reached.length) {
        const name = reached.map(function (n) { return GraphState.describeNode(n); }).join(", ");
        const takeable = reached.filter(function (n) { return GraphState.subtreeValue(currentContext.node, n) !== null; });
        text = takeable.length
          ? "Uitkomst bereikt: " + name + ". Klik op de uitkomst om die over te nemen bij " + currentContext.label + "."
          : "Uitkomst bereikt: " + name + " (niet over te nemen).";
      }
      if (subStatus.textContent !== text) subStatus.textContent = text;
      subClear.disabled = Object.keys(getSelections(currentTreeId)).length === 0;
    }

    // ----- Aanbevelingenoverzicht -----
    function refreshRecommendations(status) {
      RecommendationsPanel.refresh(status);
    }

    // Markeert de route (nodes en connectors) in de boom en brengt de aanbeveling in beeld, buiten het paneel.
    function showRecommendation(target) {
      Renderer.setRouteHighlight(target);
      if (!currentGraph || !currentGraph.native || !target.targetId) return;
      cancelJourney();
      clearGuidedTarget();
      const ins = RecommendationsPanel.coveredInsets();
      const w = refs.stage.clientWidth - ins.right;
      const h = refs.stage.clientHeight - ins.bottom;
      const r = nodeOnScreen(target.targetId);
      const fullyVisible = r.left >= VISIBLE_MARGIN && r.right <= w - VISIBLE_MARGIN &&
        r.top >= VISIBLE_MARGIN && r.bottom <= h - VISIBLE_MARGIN;
      if (fullyVisible) return;
      const zoom = getState().viewport.zoom;
      movePanTo({
        x: w / 2 - (r.box.x + r.box.w / 2) * zoom,
        y: h / 2 - (r.box.y + r.box.h / 2) * zoom
      }, function () {});
    }

    RecommendationsPanel.init({
      host: refs.main,
      stage: refs.stage,
      onShow: showRecommendation,
      onClear: function () { Renderer.setRouteHighlight(null); }
    });

    // Een interactieve node: open het keuzevenster (of sluit het als het al voor deze node openstaat).
    function interact(item, anchor) {
      if (ChoicePanel.isOpenFor(currentTreeId, item.id)) {
        ChoicePanel.close(true);
        return;
      }
      ChoicePanel.open({ tumorId: tumorId, treeId: currentTreeId, nodeId: item.id, label: item.label, options: item.options, anchor: anchor });
    }

    // ----- Graph-status -----
    function graphIsInteractive() {
      return !!currentGraph && GraphState.isInteractive(currentGraph);
    }

    // Berekent de status uit graph + selecties en laat de renderer die toepassen.
    function refreshGraph() {
      if (!graphIsInteractive()) return;
      const values = getSelections(currentTreeId);
      const status = GraphState.compute(currentGraph, values);
      Renderer.applyStatus(status, values);
      refreshRecommendations(status);
      refreshSubtreeBar(status);
    }

    // Verwijdert keuzes die door een wijziging niet meer geldig of bereikbaar zijn (via de state-functies).
    function removeInvalidSelections() {
      if (!graphIsInteractive()) return [];
      const result = GraphState.prune(currentGraph, getSelections(currentTreeId));
      result.removed.forEach(function (id) { clearSelection(currentTreeId, id); });
      return result.removed;
    }

    function nodeById(id) {
      return currentGraph.nodes.filter(function (n) { return n.id === id; })[0];
    }

    // ----- Begeleide viewportreis -----
    // Alleen tijdelijke animatiestatus; de eindpositie staat altijd in de centrale state (setPan).
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let journey = null;
    let guidedTimer = null;
    // Tijdens het programmatisch verplaatsen van de focus na een reis mag de viewport niet terugpannen.
    let suppressFocusPan = false;

    function focusWithoutPan(nodeId) {
      suppressFocusPan = true;
      Renderer.focusNode(nodeId);
      suppressFocusPan = false;
    }

    function cancelJourney() {
      if (journey) {
        cancelAnimationFrame(journey.raf);
        journey = null;
      }
    }

    function clearGuidedTarget() {
      clearTimeout(guidedTimer);
      guidedTimer = null;
      Renderer.setGuidedTarget(null);
    }

    function easeInOutCubic(t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    // Positie van de node in de zichtbare stage (pixels), uit SVG-coördinaten, zoom en pan.
    function nodeOnScreen(nodeId) {
      const box = Renderer.nodeBox(currentGraph, nodeId);
      const v = getState().viewport;
      const left = v.panX + box.x * v.zoom;
      const top = v.panY + box.y * v.zoom;
      return { left: left, top: top, right: left + box.w * v.zoom, bottom: top + box.h * v.zoom, box: box };
    }

    // Pan waarbij de node in het midden van het zichtbare tree-workspace (de stage) staat; zoom blijft ongewijzigd.
    function centeredPan(nodeId) {
      const box = Renderer.nodeBox(currentGraph, nodeId);
      const zoom = getState().viewport.zoom;
      return {
        x: refs.stage.clientWidth / 2 - (box.x + box.w / 2) * zoom,
        y: refs.stage.clientHeight / 2 - (box.y + box.h / 2) * zoom
      };
    }

    // Is een viewportbeweging nodig? Niet als de node volledig zichtbaar is (en bij een criterium ook redelijk centraal).
    function needsMove(nodeId, kind) {
      const r = nodeOnScreen(nodeId);
      const w = refs.stage.clientWidth;
      const h = refs.stage.clientHeight;
      const fullyVisible = r.left >= VISIBLE_MARGIN && r.right <= w - VISIBLE_MARGIN &&
        r.top >= VISIBLE_MARGIN && r.bottom <= h - VISIBLE_MARGIN;
      if (!fullyVisible) return true;
      if (kind === "outcome") return false;
      const dx = (r.left + r.right) / 2 - w / 2;
      const dy = (r.top + r.bottom) / 2 - h / 2;
      return Math.abs(dx) > CENTER_TOLERANCE * w || Math.abs(dy) > CENTER_TOLERANCE * h;
    }

    // Beweegt de viewport (alleen pan) naar de bestemming: vloeiend, of direct bij reduced motion.
    function movePanTo(end, onDone) {
      const start = getState().viewport;
      const distance = Math.hypot(end.x - start.panX, end.y - start.panY);
      if (reducedMotion.matches || distance < 1) {
        setPan(end.x, end.y);
        onDone();
        return;
      }
      const from = { x: start.panX, y: start.panY };
      const duration = Math.min(JOURNEY_MAX_MS, Math.max(JOURNEY_MIN_MS, distance * 0.5));
      const t0 = performance.now();
      const current = { raf: 0 };
      journey = current;
      function step(now) {
        if (journey !== current) return;
        const t = Math.min(1, (now - t0) / duration);
        const e = easeInOutCubic(t);
        setPan(from.x + (end.x - from.x) * e, from.y + (end.y - from.y) * e);
        if (t < 1) {
          current.raf = requestAnimationFrame(step);
        } else {
          journey = null;
          setPan(end.x, end.y);
          onDone();
        }
      }
      current.raf = requestAnimationFrame(step);
    }

    // Start de reis naar het volgende punt na een nieuwe of gewijzigde keuze.
    function startJourney(target, sourceNodeId) {
      cancelJourney();
      clearGuidedTarget();
      function finish() {
        if (target.kind === "available") {
          Renderer.setGuidedTarget(target.id);
          guidedTimer = setTimeout(function () { Renderer.setGuidedTarget(null); }, GUIDED_HIGHLIGHT_MS);
          focusWithoutPan(target.id);
        } else {
          // Een outcome is niet interactief: de focus keert terug naar de node waar de keuze is gemaakt,
          // zonder dat de viewport terugpant van de gecentreerde uitkomst.
          focusWithoutPan(sourceNodeId);
        }
      }
      // Een outcome of een nog niet interactieve node waar de route stopt ('end') wordt alleen gecentreerd
      // als die onvoldoende zichtbaar is.
      if (currentGraph.native && needsMove(target.id, target.kind === "available" ? "available" : "outcome")) {
        movePanTo(centeredPan(target.id), finish);
      } else {
        finish();
      }
    }

    // Eén selectiepad voor een keuze, ongeacht de bron (radioknop in het keuzevenster of klik op een connector):
    // centrale state -> opschonen -> melding -> begeleide reis. SVG en venster volgen via subscribe.
    function selectOption(treeId, nodeId, value, info) {
      if (treeId !== currentTreeId || getSelections(treeId)[nodeId] === value) return;
      cancelJourney();
      setSelection(treeId, nodeId, value);
      removeInvalidSelections();
      ChoicePanel.close(false);
      const target = GraphState.nextTarget(currentGraph, getSelections(treeId), nodeId);
      let message = info.nodeLabel + ": " + info.optionLabel + " geselecteerd.";
      if (target && target.kind === "available") {
        message += " Volgende stap: " + GraphState.describeNode(nodeById(target.id)) + ".";
      } else if (target && target.kind === "outcome") {
        message += " Uitkomst bereikt: " + GraphState.describeNode(nodeById(target.id)) + ".";
      } else if (target && target.kind === "end") {
        message += " De route loopt verder bij: " + GraphState.describeNode(nodeById(target.id)) + ".";
      }
      ChoicePanel.announce(message);
      if (target) startJourney(target, nodeId);
    }

    // Klik of toets op een connector: dezelfde functie als de radioknop in het keuzevenster.
    function selectEdge(choice) {
      selectOption(currentTreeId, choice.nodeId, choice.value,
        { nodeLabel: choice.nodeLabel, optionLabel: choice.optionLabel });
    }

    // Keuzevenster (fallback): een keuze gaat uitsluitend via selectOption.
    ChoicePanel.init({
      onSelect: selectOption,
      onClear: function (treeId, nodeId, info) {
        if (treeId !== currentTreeId) return;
        cancelJourney();
        clearGuidedTarget();
        clearSelection(treeId, nodeId);
        removeInvalidSelections();
        ChoicePanel.announce("Keuze voor " + info.nodeLabel + " gewist.");
      }
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

    // ----- Muisnavigatie (alleen voor native diagrammen) -----
    function navigationActive() {
      return refs.main.classList.contains("is-native") && !refs.svg.classList.contains("zp-hidden");
    }

    // Zoomt naar newZoom en houdt het punt (cx, cy) in stage-pixels onder de cursor.
    function zoomTo(newZoom, cx, cy) {
      const before = getState().viewport;
      setZoom(newZoom);
      const after = getState().viewport;
      if (after.zoom === before.zoom) return;
      const ux = (cx - before.panX) / before.zoom;
      const uy = (cy - before.panY) / before.zoom;
      setPan(cx - ux * after.zoom, cy - uy * after.zoom);
    }

    function stageCenter() {
      const r = refs.stage.getBoundingClientRect();
      return { x: r.width / 2, y: r.height / 2 };
    }

    function stepZoom(delta) {
      cancelJourney();
      const c = stageCenter();
      zoomTo(getState().viewport.zoom + delta, c.x, c.y);
    }

    if (refs.zoomIn) refs.zoomIn.addEventListener("click", function () { stepZoom(ZOOM_STEP); });
    if (refs.zoomOut) refs.zoomOut.addEventListener("click", function () { stepZoom(-ZOOM_STEP); });
    if (typeof Breadcrumb !== "undefined") {
      Breadcrumb.init({ onCarepathNavigate: function () { navigate(""); } });
    }
    window.addEventListener("hashchange", showRoute);

    // Muiswiel en touchpad: omhoog = inzoomen, omlaag = uitzoomen (pinch op touchpad komt als ctrl+wheel).
    refs.stage.addEventListener("wheel", function (ev) {
      if (!navigationActive()) return;
      ev.preventDefault();
      cancelJourney();
      let dy = ev.deltaY;
      if (ev.deltaMode === 1) dy *= 16;
      else if (ev.deltaMode === 2) dy *= 100;
      dy = Math.max(-120, Math.min(120, dy));
      const factor = Math.exp(-dy * (ev.ctrlKey ? WHEEL_PINCH_SENSITIVITY : WHEEL_SENSITIVITY));
      const r = refs.stage.getBoundingClientRect();
      zoomTo(getState().viewport.zoom * factor, ev.clientX - r.left, ev.clientY - r.top);
    }, { passive: false });

    // Slepen: linkermuisknop (of vinger) ingedrukt houden en bewegen.
    let drag = null;
    let suppressClick = false;

    refs.stage.addEventListener("pointerdown", function (ev) {
      if (!navigationActive() || !ev.isPrimary) return;
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      cancelJourney();
      const v = getState().viewport;
      drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, panX: v.panX, panY: v.panY, active: false };
    });

    refs.stage.addEventListener("pointermove", function (ev) {
      if (!drag || ev.pointerId !== drag.id) return;
      const dx = ev.clientX - drag.x;
      const dy = ev.clientY - drag.y;
      if (!drag.active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        drag.active = true;
        suppressClick = true;
        refs.stage.classList.add("is-dragging");
        refs.stage.setPointerCapture(ev.pointerId);
      }
      setPan(drag.panX + dx, drag.panY + dy);
    });

    function endDrag(ev) {
      if (!drag || ev.pointerId !== drag.id) return;
      if (drag.active) {
        refs.stage.classList.remove("is-dragging");
        if (refs.stage.hasPointerCapture(ev.pointerId)) refs.stage.releasePointerCapture(ev.pointerId);
        setTimeout(function () { suppressClick = false; }, 0);
      }
      drag = null;
    }
    refs.stage.addEventListener("pointerup", endDrag);
    refs.stage.addEventListener("pointercancel", endDrag);

    // Een sleepgebaar mag geen node of link activeren.
    refs.stage.addEventListener("click", function (ev) {
      if (!suppressClick) return;
      ev.stopPropagation();
      ev.preventDefault();
      suppressClick = false;
    }, true);

    // Dubbelklik op het diagram: terug naar standaardzoom en beginpositie.
    refs.stage.addEventListener("dblclick", function (ev) {
      if (!navigationActive() || ev.target.closest(".node.go, .node.is-interactive, .node.is-takeable, .edge-choice")) return;
      cancelJourney();
      resetViewport();
      if (currentGraph && currentGraph.native) {
        applyFit(currentGraph);
        ensureFirstAvailableVisible();
      }
    });

    // Toetsenbordfocus: houd de gefocuste node in beeld door te pannen (het diagram scrolt zelf niet).
    refs.stage.addEventListener("focusin", function (ev) {
      if (!navigationActive()) return;
      refs.stage.scrollLeft = 0;
      refs.stage.scrollTop = 0;
      if (suppressFocusPan) return;
      const s = refs.stage.getBoundingClientRect();
      const t = ev.target.getBoundingClientRect();
      let dx = 0, dy = 0;
      if (t.right > s.right - FOCUS_MARGIN) dx = s.right - FOCUS_MARGIN - t.right;
      if (t.left + dx < s.left + FOCUS_MARGIN) dx = s.left + FOCUS_MARGIN - t.left;
      if (t.bottom > s.bottom - FOCUS_MARGIN) dy = s.bottom - FOCUS_MARGIN - t.bottom;
      if (t.top + dy < s.top + FOCUS_MARGIN) dy = s.top + FOCUS_MARGIN - t.top;
      if (dx || dy) {
        const v = getState().viewport;
        setPan(v.panX + dx, v.panY + dy);
      }
    });

    try {
      showRoute();
    } catch (err) {
      showMessage("Fout bij weergeven van zorgpad: " + err.message, true);
    }
  }

  // ---------- Start ----------
  document.addEventListener("DOMContentLoaded", function () {
    const page = document.body.dataset.page;
    if (page === "home") initHome();
    if (page === "zorgpad") initZorgpad();
  });
})();
