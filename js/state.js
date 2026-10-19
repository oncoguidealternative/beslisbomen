/* Centrale applicatiestatus (bron van waarheid).
   - Lees de status via getState() (geeft een kopie terug).
   - Wijzig de status uitsluitend via de set/clear-functies hieronder.
   - subscribe(fn) meldt wijzigingen: fn(snapshot, key, detail)
     met key = 'tumor' | 'tree' | 'viewport' | 'selections'; bij 'selections' bevat detail {treeId}.

   Selecties zijn gescheiden per tumor en per beslisboom:
     state.selections[tumorId][treeId][nodeId] = waarde
   getState().selections is de kopie voor de huidige tumor: { [treeId]: { [nodeId]: waarde } }.
   Een node-id in de ene beslisboom beïnvloedt daardoor nooit een node met dezelfde id in een andere boom,
   en setTumor() wist alle selecties zodat keuzes nooit naar een andere tumor doorlekken. */
const state = {
  currentTumor: null,
  currentTree: null,

  viewport: {
    zoom: 1,
    panX: 0,
    panY: 0
  },

  selections: {}
};

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2;
const NO_TUMOR_KEY = '_';

const stateListeners = [];

function tumorKey() {
  return state.currentTumor || NO_TUMOR_KEY;
}

function treeSelectionsRef(treeId, create) {
  const tumor = tumorKey();
  if (!state.selections[tumor]) {
    if (!create) return null;
    state.selections[tumor] = {};
  }
  if (!state.selections[tumor][treeId]) {
    if (!create) return null;
    state.selections[tumor][treeId] = {};
  }
  return state.selections[tumor][treeId];
}

function copySelectionsOfCurrentTumor() {
  const source = state.selections[tumorKey()] || {};
  const copy = {};
  Object.keys(source).forEach(function (treeId) {
    copy[treeId] = Object.assign({}, source[treeId]);
  });
  return copy;
}

function getState() {
  return {
    currentTumor: state.currentTumor,
    currentTree: state.currentTree,
    viewport: {
      zoom: state.viewport.zoom,
      panX: state.viewport.panX,
      panY: state.viewport.panY
    },
    selections: copySelectionsOfCurrentTumor()
  };
}

/* Selecties van één beslisboom van de huidige tumor: { nodeId: waarde } (kopie). */
function getSelections(treeId) {
  const ref = treeSelectionsRef(treeId, false);
  return ref ? Object.assign({}, ref) : {};
}

function subscribe(listener) {
  stateListeners.push(listener);
  return function unsubscribe() {
    const i = stateListeners.indexOf(listener);
    if (i >= 0) stateListeners.splice(i, 1);
  };
}

function notifyState(key, detail) {
  const snapshot = getState();
  stateListeners.slice().forEach(function (fn) { fn(snapshot, key, detail || {}); });
}

function resetViewportValues() {
  state.viewport.zoom = 1;
  state.viewport.panX = 0;
  state.viewport.panY = 0;
}

/* Kiest een tumor (id) en zet alles wat daarvan afhangt terug, inclusief alle selecties. */
function setTumor(id) {
  state.currentTumor = id || null;
  state.currentTree = null;
  state.selections = {};
  resetViewportValues();
  notifyState('tumor');
}

/* Kiest een beslisboom (id) of het overzicht (null). Pan wordt teruggezet.
   Selecties van andere bomen blijven in het geheugen bewaard (alleen binnen deze paginasessie). */
function setTree(id) {
  state.currentTree = id || null;
  state.viewport.panX = 0;
  state.viewport.panY = 0;
  notifyState('tree');
}

/* Slaat de keuze voor een node van een beslisboom op. */
function setSelection(treeId, nodeId, value) {
  treeSelectionsRef(treeId, true)[nodeId] = value;
  notifyState('selections', { treeId: treeId });
}

function clearSelection(treeId, nodeId) {
  const ref = treeSelectionsRef(treeId, false);
  if (ref) delete ref[nodeId];
  notifyState('selections', { treeId: treeId });
}

/* Wist alle keuzes van één beslisboom, of van alle bomen van de huidige tumor als treeId ontbreekt. */
function clearAllSelections(treeId) {
  if (treeId === undefined || treeId === null) {
    state.selections[tumorKey()] = {};
  } else {
    const ref = treeSelectionsRef(treeId, false);
    if (ref) state.selections[tumorKey()][treeId] = {};
  }
  notifyState('selections', { treeId: treeId === undefined ? null : treeId });
}

function setZoom(value) {
  if (typeof value !== 'number' || !isFinite(value)) return;
  state.viewport.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value));
  notifyState('viewport');
}

function setPan(x, y) {
  if (typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y)) return;
  state.viewport.panX = x;
  state.viewport.panY = y;
  notifyState('viewport');
}

function resetViewport() {
  resetViewportValues();
  notifyState('viewport');
}
