/* Begeleide reis: na een keuze beweegt de viewport naar de volgende stap (een onbeantwoorde keuzenode of een
   uitkomst), licht die stap kort op en zet de toetsenbordfocus goed.

   Gebruik:
     const journey = Journey.create({ viewport, getGraph });
     journey.start(target, sourceNodeId);   // target uit GraphState.nextTarget
     journey.cancel();                       // stopt een lopende beweging
     journey.clearGuidedTarget();            // haalt de tijdelijke markering weg */
const Journey = (function () {
  'use strict';

  const GUIDED_HIGHLIGHT_MS = 1600;

  function create(options) {
    const viewport = options.viewport;
    const getGraph = options.getGraph;
    let guidedTimer = null;

    function cancel() {
      viewport.cancelMove();
    }

    function clearGuidedTarget() {
      clearTimeout(guidedTimer);
      guidedTimer = null;
      Renderer.setGuidedTarget(null);
    }

    // Start de reis naar het volgende punt na een nieuwe of gewijzigde keuze.
    function start(target, sourceNodeId) {
      cancel();
      clearGuidedTarget();
      function finish() {
        if (target.kind === "available") {
          Renderer.setGuidedTarget(target.id);
          guidedTimer = setTimeout(function () { Renderer.setGuidedTarget(null); }, GUIDED_HIGHLIGHT_MS);
          viewport.focusWithoutPan(target.id);
        } else {
          // Een outcome is niet interactief: de focus keert terug naar de node waar de keuze is gemaakt,
          // zonder dat de viewport terugpant van de gecentreerde uitkomst.
          viewport.focusWithoutPan(sourceNodeId);
        }
      }
      // Een outcome of een nog niet interactieve node waar de route stopt ('end') wordt alleen gecentreerd
      // als die onvoldoende zichtbaar is.
      const graph = getGraph();
      if (graph && graph.native && viewport.needsMove(target.id, target.kind === "available" ? "available" : "outcome")) {
        viewport.movePanTo(viewport.centeredPan(target.id), finish);
      } else {
        finish();
      }
    }

    return { start: start, cancel: cancel, clearGuidedTarget: clearGuidedTarget };
  }

  return { create: create };
})();
