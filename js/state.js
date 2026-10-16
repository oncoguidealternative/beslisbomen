/* Centrale applicatiestatus (bron van waarheid).
   - Lees de status via getState() (geeft een kopie terug).
   - Wijzig de status uitsluitend via de set/clear-functies hieronder.
   - subscribe(fn) meldt wijzigingen: fn(snapshot, key) met key = 'tumor' | 'tree' | 'viewport' | 'selections'. */
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

const stateListeners = [];

function getState() {
  return {
    currentTumor: state.currentTumor,
    currentTree: state.currentTree,
    viewport: {
      zoom: state.viewport.zoom,
      panX: state.viewport.panX,
      panY: state.viewport.panY
    },
    selections: Object.assign({}, state.selections)
  };
}

function subscribe(listener) {
  stateListeners.push(listener);
  return function unsubscribe() {
    const i = stateListeners.indexOf(listener);
    if (i >= 0) stateListeners.splice(i, 1);
  };
}

function notifyState(key) {
  const snapshot = getState();
  stateListeners.slice().forEach(function (fn) { fn(snapshot, key); });
}

function resetViewportValues() {
  state.viewport.zoom = 1;
  state.viewport.panX = 0;
  state.viewport.panY = 0;
}

/* Kiest een tumor (id) en zet alles wat daarvan afhangt terug. */
function setTumor(id) {
  state.currentTumor = id || null;
  state.currentTree = null;
  state.selections = {};
  resetViewportValues();
  notifyState('tumor');
}

/* Kiest een beslisboom (id) of het overzicht (null). Pan wordt teruggezet. */
function setTree(id) {
  state.currentTree = id || null;
  state.viewport.panX = 0;
  state.viewport.panY = 0;
  notifyState('tree');
}

/* Voorbereiding voor latere sprints: nog niet in gebruik. */
function setSelection(id, value) {
  state.selections[id] = value;
  notifyState('selections');
}

function clearSelection(id) {
  delete state.selections[id];
  notifyState('selections');
}

function clearAllSelections() {
  state.selections = {};
  notifyState('selections');
}

function setZoom(value) {
  if (typeof value !== 'number' || !isFinite(value)) return;
  state.viewport.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value));
  notifyState('viewport');
}

/* Voorbereiding voor latere sprints: waarden blijven voorlopig 0 en worden nog niet gebruikt. */
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
