/* Controle van de mobiele vragenlijst tegen de rekenkern, voor alle beslisbomen van alle zorgpaden.
   Gebruik: node mobiel/tools/check-flow.js [tumor]

   Doorloopt per boom álle antwoordcombinaties zoals een gebruiker ze in de vragenlijst geeft (steeds de
   volgende vraag, elke optie) en controleert:
   - de vragenlijst eindigt altijd (geen lus);
   - elk eindpunt geeft iets: een aanbeveling, een stap of een verwijzing naar een vervolgboom;
   - de bereikte aanbevelingen zijn precies de aanbevelingen die de rekenkern als bereikt aanmerkt;
   - elke aanbeveling uit het aanbevelingenoverzicht is via de vragenlijst te bereiken.
   Fouten in de logica laten de controle falen; eindpunten zonder aanbeveling worden als inhoudelijke
   aandachtspunten gemeld (die zitten in de data, niet in de vragenlijst). */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
function load(file, name) {
  return new Function(fs.readFileSync(path.join(root, file), 'utf8') + '\n;return ' + name + ';')();
}
const GraphState = load('js/graph-state.js', 'GraphState');
global.GraphState = GraphState;
const GraphValidator = load('js/graph-validator.js', 'GraphValidator');
const LayoutEngine = load('js/layout-engine.js', 'LayoutEngine');
const Flow = require(path.join(root, 'mobiel', 'flow.js'));
Flow.use(GraphState);

const only = process.argv[2];
const tumoren = JSON.parse(fs.readFileSync(path.join(root, 'data/tumoren.json'), 'utf8')).tumoren;
let errors = 0, notes = [], trees = 0, paths = 0;
const LIMIT = 20000;

tumoren.forEach(function (t) {
  if (only && t.id !== only) return;
  const file = path.join(root, 'data', t.id, 'zorgpad.json');
  if (!fs.existsSync(file)) return;
  const zp = LayoutEngine.normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
  const origLog = console.log, origWarn = console.warn;
  console.log = console.warn = function () {};
  const validation = GraphValidator.validateTumor(zp, t.id);
  console.log = origLog; console.warn = origWarn;
  Object.keys(zp.trees || {}).forEach(function (treeId) {
    const tree = zp.trees[treeId];
    const raw = tree && tree.same ? zp.trees[tree.same] : tree;
    if (!raw || !Array.isArray(raw.nodes)) return;
    const graph = (validation.trees[treeId] || validation.trees[tree.same] || { graph: raw }).graph;
    trees++;
    const recIds = Flow.view(graph, {}).all.map(function (r) { return r.id; });
    const seenRecs = {};
    let count = 0, empty = 0;
    function walk(sel, depth) {
      if (count > LIMIT) return;
      if (depth > 60) { errors++; console.log('FOUT  ' + t.id + '/' + treeId + ': vragenlijst eindigt niet'); return; }
      const v = Flow.view(graph, sel);
      if (v.question) {
        v.question.options.forEach(function (o) { walk(Flow.answer(graph, sel, v.question.id, o.value), depth + 1); });
        return;
      }
      count++;
      const reachedByCore = v.all.filter(function (r) { return r.state === 'reached'; }).map(function (r) { return r.id; }).sort();
      const shown = v.outcomes.map(function (n) { return n.id; }).filter(function (id) { return recIds.indexOf(id) >= 0; }).sort();
      if (JSON.stringify(reachedByCore) !== JSON.stringify(shown)) {
        errors++;
        console.log('FOUT  ' + t.id + '/' + treeId + ': vragenlijst toont ' + shown + ', rekenkern zegt ' + reachedByCore);
      }
      v.outcomes.forEach(function (n) { seenRecs[n.id] = true; });
      if (!v.outcomes.length && !v.links.length && !v.steps.length) {
        empty++;
        if (empty === 1) notes.push(t.id + '/' + treeId + ': eindpunt zonder aanbeveling na ' +
          v.answered.map(function (a) { return a.label + ' = ' + a.valueLabel; }).join('; '));
      }
    }
    walk({}, 0);
    paths += count;
    if (count > LIMIT) notes.push(t.id + '/' + treeId + ': meer dan ' + LIMIT + ' paden, niet volledig doorlopen');
    else if (Flow.view(graph, {}).interactive) {
      recIds.forEach(function (id) {
        if (!seenRecs[id]) notes.push(t.id + '/' + treeId + ': aanbeveling ' + id + ' is via de vragenlijst niet te bereiken');
      });
    }
    if (empty > 1) notes.push(t.id + '/' + treeId + ': in totaal ' + empty + ' eindpunten zonder aanbeveling');
  });
});

notes.forEach(function (n) { console.log('LET OP ' + n); });
console.log((errors ? '✗' : '✓') + ' Vragenlijst: ' + trees + ' bomen, ' + paths + ' volledige paden, ' + errors + ' fouten, ' + notes.length + ' aandachtspunten.');
process.exit(errors ? 1 : 0);
