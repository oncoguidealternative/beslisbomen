#!/usr/bin/env node
/* Controleert alle inhoud van de website vóórdat die live gaat.

   Gebruik (vanuit de hoofdmap van de repository, met Node.js 18 of nieuwer):
     node tools/check.js            fouten laten de controle mislukken, waarschuwingen niet
     node tools/check.js --strict   ook waarschuwingen laten de controle mislukken

   Draait ook automatisch bij elke push en pull request (zie .github/workflows/check.yml).

   Wat wordt gecontroleerd:
     1. data/tumoren.json: geldige JSON, unieke en veilige id's, een zorgpadbestand per beschikbare tumor
     2. elk data/<tumor>/zorgpad.json:
        - geldige JSON met id, titel en overzicht; het id gelijk aan de mapnaam
        - één manier van tekenen: rasterposities (gridX/gridY), geen x/y of gridSizeX
        - verwijzingen ("to", "drill", "same", "subtree") naar bomen die bestaan
        - verbindingen (edges) met from en to naar nodes die bestaan
        - de layout-engine en de validator van de website zelf (dezelfde code als in de browser)
        - bronvermelding ("bron"): datums als jjjj-mm-dd, url met https
     3. de HTML-pagina's: alle gekoppelde scripts en stylesheets bestaan en hebben hetzelfde versienummer (?v=)
     4. inhoudspagina's in data/pages: geldige JSON

   Gebruikt geen extra pakketten: alleen Node.js zelf. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const STRICT = process.argv.includes('--strict');
const SAFE_ID = /^[a-z0-9_-]+$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const errors = [];
const warnings = [];
function error(where, message) { errors.push(where + ': ' + message); }
function warn(where, message) { warnings.push(where + ': ' + message); }

function rel(p) { return path.relative(ROOT, p).split(path.sep).join('/'); }
function exists(p) { return fs.existsSync(path.join(ROOT, p)); }

function readJSON(file) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) { error(file, 'bestand ontbreekt'); return null; }
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (e) {
    error(file, 'ongeldige JSON (' + e.message + ')');
    return null;
  }
}

/* ---------- de rekenkern van de website laden, precies zoals de browser dat doet ---------- */
function loadEngine() {
  const context = vm.createContext({ console: { log() {}, warn() {}, error() {}, info() {} }, window: {} });
  ['js/graph-state.js', 'js/layout-engine.js', 'js/graph-validator.js', 'js/bron.js'].forEach(function (file) {
    if (file === 'js/bron.js' && !fs.existsSync(path.join(ROOT, file))) return;   // optioneel
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  });
  return vm.runInContext('({ GraphState, LayoutEngine, GraphValidator, Bron: typeof Bron === "undefined" ? null : Bron })', context);
}

/* ---------- 1. tumoren.json ---------- */
function checkTumoren() {
  const data = readJSON('data/tumoren.json');
  if (!data) return [];
  if (!Array.isArray(data.tumoren)) { error('data/tumoren.json', '"tumoren" moet een lijst zijn'); return []; }
  const seen = {};
  data.tumoren.forEach(function (t, i) {
    const where = 'data/tumoren.json [' + i + ']';
    if (!t || typeof t.id !== 'string' || !SAFE_ID.test(t.id)) { error(where, 'ongeldig id (alleen letters, cijfers, - en _)'); return; }
    if (seen[t.id]) error(where, 'id "' + t.id + '" komt dubbel voor');
    seen[t.id] = true;
    if (typeof t.titel !== 'string' || !t.titel.trim()) error(where, 'titel ontbreekt');
    if (t.afbeelding && !exists(String(t.afbeelding).replace(/^\.\//, ''))) error(where, 'afbeelding "' + t.afbeelding + '" bestaat niet');
    if (t.status === 'available' && !exists('data/' + t.id + '/zorgpad.json')) {
      error(where, 'tumor "' + t.id + '" is beschikbaar, maar data/' + t.id + '/zorgpad.json ontbreekt (klopt de mapnaam?)');
    }
  });
  // Mappen met een zorgpad die niet in de lijst staan, zijn op de website onbereikbaar.
  fs.readdirSync(path.join(ROOT, 'data'), { withFileTypes: true }).forEach(function (d) {
    if (d.isDirectory() && exists('data/' + d.name + '/zorgpad.json') && !seen[d.name]) {
      warn('data/' + d.name, 'zorgpad staat niet in data/tumoren.json en is dus niet te openen');
    }
  });
  return data.tumoren.filter(function (t) { return t && SAFE_ID.test(t.id) && exists('data/' + t.id + '/zorgpad.json'); });
}

/* ---------- 2. zorgpad.json ---------- */
function graphsOf(zorgpad) {
  const list = [];
  if (zorgpad.overview) list.push({ id: 'overview', graph: zorgpad.overview });
  Object.keys(zorgpad.trees || {}).forEach(function (id) { list.push({ id: id, graph: zorgpad.trees[id] }); });
  return list;
}

function checkFormat(file, treeId, graph, trees) {
  const where = file + ' [' + treeId + ']';
  if (!graph || typeof graph !== 'object') { error(where, 'boom is geen object'); return; }
  if (graph.same !== undefined) {
    if (!trees[graph.same] || trees[graph.same].same) error(where, '"same" verwijst naar "' + graph.same + '", die niet bestaat of zelf hergebruikt is');
    return;
  }
  if (!Array.isArray(graph.nodes)) { error(where, '"nodes" ontbreekt'); return; }
  if (graph.gridSizeX !== undefined || graph.gridSizeY !== undefined) {
    error(where, 'gridSizeX/gridSizeY wordt niet ondersteund; gebruik "layout": { "unit": 5, … }');
  }
  if (graph.viewBox || graph.nodeSize) warn(where, 'viewBox/nodeSize zijn niet meer nodig; de layout-engine bepaalt die zelf uit "layout"');

  const ids = {};
  const missing = [];   // verwijzingen naar beslisbomen die (nog) niet in dit zorgpad staan
  graph.nodes.forEach(function (n) {
    if (!n || typeof n.id !== 'string' || !n.id) { error(where, 'node zonder id'); return; }
    if (ids[n.id]) error(where, 'node-id "' + n.id + '" komt dubbel voor');
    ids[n.id] = true;
    if (n.x !== undefined || n.y !== undefined) warn(where, 'node "' + n.id + '" gebruikt x/y; gebruik gridX/gridY');
    // verwijzingen naar andere bomen
    const target = n.to !== undefined ? n.to : (n.drill ? n.id : undefined);
    if (typeof target === 'string' && target !== '' && !n.tumor && !trees[target]) missing.push(target);
    if (n.tumor && !exists('data/' + n.tumor + '/zorgpad.json')) {
      error(where, 'node "' + n.id + '" verwijst naar tumor "' + n.tumor + '", die geen zorgpad heeft');
    }
  });

  // De website toont bij zo'n stap "nog niet toegevoegd"; dat is geen fout, maar wel goed om te weten.
  if (missing.length) {
    warn(where, missing.length + ' stap(pen) verwijzen naar een beslisboom die nog niet is toegevoegd: ' + missing.join(', '));
  }

  (graph.edges || []).forEach(function (e, i) {
    const name = e && e.id ? '"' + e.id + '"' : '#' + i + (e && e.label ? ' ("' + String(e.label).replace(/\s+/g, ' ') + '")' : '');
    if (!e || typeof e !== 'object') { error(where, 'edge ' + name + ' is geen object'); return; }
    if (!e.from || !e.to) {
      warn(where, 'edge ' + name + ' heeft geen from én to; de verbinding is alleen een getekende lijn');
      return;
    }
    if (!ids[e.from]) error(where, 'edge ' + name + ': from "' + e.from + '" bestaat niet');
    if (!ids[e.to]) error(where, 'edge ' + name + ': to "' + e.to + '" bestaat niet');
  });
}

function checkBron(file, label, bron, Bron) {
  if (bron === undefined) return;
  const where = file + ' [bron' + (label ? ' ' + label : '') + ']';
  if (!bron || typeof bron !== 'object' || Array.isArray(bron)) { error(where, 'moet een object zijn'); return; }
  ['publicatiedatum', 'beoordeeldOp', 'bijgewerkt'].forEach(function (k) {
    if (bron[k] !== undefined && !DATE.test(String(bron[k]))) error(where, '"' + k + '" moet de vorm jjjj-mm-dd hebben');
  });
  if (bron.url !== undefined && !/^https:\/\//i.test(String(bron.url))) warn(where, '"url" begint niet met https://');
  if (Bron && !label && !bron.richtlijn) warn(where, '"richtlijn" ontbreekt');
}

function checkZorgpad(tumor, engine) {
  const file = 'data/' + tumor.id + '/zorgpad.json';
  const zorgpad = readJSON(file);
  if (!zorgpad) return;
  if (zorgpad.id !== tumor.id) error(file, 'id "' + zorgpad.id + '" is niet gelijk aan de mapnaam "' + tumor.id + '"');
  if (typeof zorgpad.titel !== 'string' || !zorgpad.titel.trim()) error(file, 'titel ontbreekt');
  if (!zorgpad.overview) { warn(file, 'nog geen overzicht ("overview")'); return; }

  const trees = zorgpad.trees || {};
  graphsOf(zorgpad).forEach(function (g) { checkFormat(file, g.id, g.graph, trees); });

  if (zorgpad.bron === undefined) warn(file, 'geen bronvermelding ("bron")');
  checkBron(file, '', zorgpad.bron, engine.Bron);
  Object.keys(trees).forEach(function (id) { if (trees[id]) checkBron(file, id, trees[id].bron, null); });

  // De layout-engine en validator van de website zelf.
  const normalized = engine.LayoutEngine.normalize(zorgpad);
  graphsOf(normalized).forEach(function (g) {
    if (!g.graph || !Array.isArray(g.graph.nodes)) return;
    engine.LayoutEngine.layout(g.graph).issues.forEach(function (m) {
      warn(file + ' [' + g.id + ']', 'layout: ' + m.replace(/\s+/g, ' '));
    });
  });
  engine.GraphValidator.validateTumor(normalized, tumor.id).issues.forEach(function (i) {
    const where = file + ' [' + i.tree + ']' + (i.node ? ' node "' + i.node + '"' : '');
    if (i.level === 'error') error(where, i.message);
    else warn(where, i.message);
  });
}

/* ---------- 3. HTML ---------- */
function checkHtml() {
  const versions = {};
  ['index.html', 'zorgpad.html'].forEach(function (file) {
    if (!exists(file)) { error(file, 'bestand ontbreekt'); return; }
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const re = /<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) {
      const url = m[1];
      if (/^(https?:)?\/\//.test(url)) continue;
      const clean = url.replace(/^\.\//, '').split(/[?#]/)[0];
      if (!exists(clean)) error(file, 'verwijst naar "' + clean + '", dat niet bestaat');
      const v = /[?&]v=([^&#]+)/.exec(url);
      if (/\.(js|css)$/.test(clean)) {
        if (!v) warn(file, '"' + clean + '" heeft geen versienummer (?v=); browsers kunnen een oude versie blijven gebruiken');
        else versions[v[1]] = (versions[v[1]] || []).concat(file + ' → ' + clean);
      }
    }
  });
  const list = Object.keys(versions);
  if (list.length > 1) {
    warn('HTML', 'verschillende versienummers (?v=) in gebruik: ' + list.join(', ') + '. Verhoog ze bij een publicatie allemaal tegelijk.');
  }
}

/* ---------- 4. inhoudspagina's ---------- */
function checkPages() {
  const dir = path.join(ROOT, 'data/pages');
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).filter(function (f) { return f.endsWith('.json'); }).forEach(function (f) {
    const page = readJSON('data/pages/' + f);
    if (page && !Array.isArray(page.sections)) error('data/pages/' + f, '"sections" ontbreekt');
  });
}

/* ---------- uitvoeren ---------- */
function main() {
  let engine;
  try {
    engine = loadEngine();
  } catch (e) {
    console.error('De code in js/ kon niet worden geladen: ' + e.message);
    process.exit(1);
  }
  const tumoren = checkTumoren();
  tumoren.forEach(function (t) { checkZorgpad(t, engine); });
  checkHtml();
  checkPages();

  const print = function (title, list, symbol) {
    if (!list.length) return;
    console.log('\n' + title + ' (' + list.length + ')');
    list.forEach(function (m) { console.log('  ' + symbol + ' ' + m); });
  };
  print('Waarschuwingen', warnings, '!');
  print('Fouten', errors, '✗');

  const failed = errors.length > 0 || (STRICT && warnings.length > 0);
  console.log('\n' + (failed ? '✗ Controle mislukt' : '✓ Controle geslaagd') +
    ': ' + tumoren.length + ' zorgpaden, ' + errors.length + ' fouten, ' + warnings.length + ' waarschuwingen' +
    (STRICT ? ' (strikt)' : '') + '.');
  process.exit(failed ? 1 : 0);
}

main();
