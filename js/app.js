APP.JS - TWEE VOLLEDIGE VERVANGBLOKKEN

BELANGRIJK
Deze correcties horen bij de nieuwe Renderer.fitViewport()-functie.
Verwijder alle aanroepen van Renderer.fitZoom() uit app.js.

============================================================
1. VERVANG IN function showRoute() DE OUDE fitZoom-REGEL
============================================================

Verwijder:

if (view.graph && view.graph.native) setZoom(Renderer.fitZoom(view.graph));

Zet de viewportberekening PAS NA Renderer.draw().
Het volledige relevante deel van showRoute() moet worden:

function showRoute() {
  const id = location.hash.replace(/^#\//, "");
  const view = Renderer.resolve(zorgpad, id);
  view.graph = validatedGraph(view.treeId, view.graph);
  currentGraph = view.graph;
  currentTreeId = view.treeId;
  setTree(view.treeId);

  document.title = view.treeId
    ? view.label + " – " + zorgpad.titel
    : zorgpad.titel;

  if (refs.back) {
    refs.back.textContent = zorgpad.titel;
    refs.back.hidden = !view.treeId;
    refs.back.setAttribute(
      "aria-label",
      view.treeId ? "Terug naar " + zorgpad.titel : zorgpad.titel
    );
  }

  const breadcrumbCurrent = document.getElementById("breadcrumb-current");
  const breadcrumbSeparator = document.querySelector(".breadcrumb-separator");

  if (breadcrumbCurrent) {
    breadcrumbCurrent.textContent = view.treeId ? view.label : "";
    breadcrumbCurrent.hidden = !view.treeId;
  }

  if (breadcrumbSeparator) {
    breadcrumbSeparator.hidden = !view.treeId;
  }

  cancelJourney();
  clearGuidedTarget();
  ChoicePanel.close(false);

  Renderer.draw(view, {
    navigate: navigate,
    interact: interact
  });

  if (view.graph && view.graph.native) {
    const fittedViewport = Renderer.fitViewport(
      view.graph,
      refs.stage.clientWidth,
      refs.stage.clientHeight
    );

    setZoom(fittedViewport.zoom);
    setPan(
      fittedViewport.panX,
      fittedViewport.panY
    );
  }

  refreshGraph();

  if (view.treeId) {
    window.scrollTo(0, 0);
  }
}

============================================================
2. VERVANG DE VOLLEDIGE DUBBELKLIK-HANDLER
============================================================

Vervang het blok vanaf:

refs.stage.addEventListener("dblclick"

tot en met de bijbehorende afsluiting });

door:

refs.stage.addEventListener("dblclick", function (ev) {
  if (
    !navigationActive() ||
    ev.target.closest(".node.go, .node.is-interactive")
  ) {
    return;
  }

  cancelJourney();
  resetViewport();

  if (currentGraph && currentGraph.native) {
    const fittedViewport = Renderer.fitViewport(
      currentGraph,
      refs.stage.clientWidth,
      refs.stage.clientHeight
    );

    setZoom(fittedViewport.zoom);
    setPan(
      fittedViewport.panX,
      fittedViewport.panY
    );
  }
});

============================================================
3. BEHOUD DEZE VEILIGE EVENTLISTENERS
============================================================

Omdat de plus- en minknoppen uit de HTML zijn verwijderd, moeten deze
listeners op het bestaan van de elementen controleren:

if (refs.zoomIn) {
  refs.zoomIn.addEventListener("click", function () {
    stepZoom(ZOOM_STEP);
  });
}

if (refs.zoomOut) {
  refs.zoomOut.addEventListener("click", function () {
    stepZoom(-ZOOM_STEP);
  });
}

if (refs.back) {
  refs.back.addEventListener("click", function () {
    navigate("");
  });
}

window.addEventListener("hashchange", showRoute);

============================================================
EINDCONTROLE
============================================================

Zoeken in app.js op:

Renderer.fitZoom

Verwacht: 0 resultaten.

Zoeken in app.js op:

Renderer.fitViewport

Verwacht: 2 resultaten.

De eerste staat in showRoute().
De tweede staat in de dblclick-handler.
