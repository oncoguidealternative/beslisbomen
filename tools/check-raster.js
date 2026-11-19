#!/usr/bin/env node
/* Controleert of de zorgpaden en beslisbomen het afgesproken raster volgen (zonder browser).

   Gebruik: node tools/check-raster.js [tumor ...]

   Afspraak (zie docs/layout-engine.md, "Het standaardraster"):
     - layout: unit 5, blok 40 x 20 hokjes = 200 x 100 px
     - blokken (behalve aanbevelingen, die mogen hoger zijn) zijn 200 x 100 px
     - naast elkaar minstens 25 px tussen blokken
     - onder de titel 50 px
     - in het overzicht 50 px tussen de stappen
     - in een beslisboom onder een gegeven 75 px, onder een aanbeveling of verwijzing 50 px (alleen gemeld
       als het minder is, want lijnen naar een andere kolom mogen verder doorlopen)
   Meldt per weergave wat afwijkt. Zorgpaden die (nog) een eigen raster hebben, worden apart genoemd.
   Mislukt (exitcode 1) als er afwijkingen zijn in zorgpaden op het standaardraster. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const ctx = {console: {warn: function () {}, log: function () {}}, WeakMap: WeakMap};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/layout-engine.js'), 'utf8') + ';this.LE = LayoutEngine;', ctx);
const LE = ctx.LE;

const W = 200, H = 100, HGAP = 25, TITLE_GAP = 50, STEP_GAP = 50;
const MIN_BELOW = {item: 75, other: 50};

const roleOf = function (n) {
  const t = n.type || 'step';
  if (/^(title|root|start)$/.test(t)) return 'title';
  if (/^(recommendation|outcome)$/.test(t)) return 'rec';
  if (/^decision$/.test(t)) return 'rec';   // groen tekstblok: mag hoger zijn, zoals een aanbeveling
  if (/^(dataItem|item|criterion)$/.test(t)) return 'item';
  return 'other';
};

function onStandard(g) {
  const l = g.layout || {};
  return l.unit === 5 && l.blockWidth === 40 && l.blockHeight === 20;
}

function check(g, isOverview) {
  const out = [];
  const r = LE.layout(JSON.parse(JSON.stringify(g)));
  const G = r.graph;
  const N = {};
  G.nodes.forEach(function (n) {
    N[n.id] = {id: n.id, role: roleOf(n), label: !!n.textOnly, x: n.x, y: n.y,
      w: n.w || G.nodeSize[0], h: n.h || G.nodeSize[1]};
  });
  Object.values(N).forEach(function (n) {
    if (n.w !== W) out.push(n.id + ': breedte ' + n.w + ' px (moet ' + W + ')');
    if (n.role !== 'rec' && n.h !== H) out.push(n.id + ': hoogte ' + n.h + ' px (moet ' + H + ')');
    if (n.role === 'rec' && n.h < H) out.push(n.id + ': aanbeveling lager dan ' + H + ' px');
  });
  // naast elkaar
  const rows = {};
  Object.values(N).forEach(function (n) { (rows[n.y] = rows[n.y] || []).push(n); });
  Object.keys(rows).forEach(function (y) {
    const row = rows[y].sort(function (a, b) { return a.x - b.x; });
    for (let i = 1; i < row.length; i++) {
      const gap = row[i].x - (row[i - 1].x + row[i - 1].w);
      if (gap < HGAP) out.push(row[i - 1].id + ' en ' + row[i].id + ': ' + gap + ' px naast elkaar (minstens ' + HGAP + ')');
    }
  });
  // onder elkaar, via de verbindingen
  (G.edges || []).forEach(function (e) {
    const a = N[e.from], b = N[e.to];
    if (!a || !b || b.y < a.y + a.h) return;
    const gap = b.y - (a.y + a.h);
    if (a.role === 'title') {
      if (gap !== TITLE_GAP) out.push(a.id + ' → ' + b.id + ': ' + gap + ' px onder de titel (moet ' + TITLE_GAP + ')');
    } else if (isOverview) {
      if (gap < STEP_GAP) out.push(a.id + ' → ' + b.id + ': ' + gap + ' px tussen stappen (minstens ' + STEP_GAP + ')');
    } else {
      const min = a.role === 'item' ? MIN_BELOW.item : MIN_BELOW.other;
      // een kind dat schuin onder het blok staat (andere kolom) mag dichterbij beginnen: de lijn loopt via de zijkant
      const sameColumn = b.x < a.x + a.w && a.x < b.x + b.w;
      if (sameColumn && gap < min) out.push(a.id + ' → ' + b.id + ': ' + gap + ' px eronder (minstens ' + min + ')');
    }
  });
  return out;
}

const only = process.argv.slice(2);
const tumoren = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tumoren.json'), 'utf8')).tumoren
  .map(function (t) { return t.id; })
  .filter(function (id) { return !only.length || only.includes(id); });

let problems = 0, checked = 0;
const eigen = [];
tumoren.forEach(function (id) {
  const f = path.join(ROOT, 'data', id, 'zorgpad.json');
  if (!fs.existsSync(f)) return;
  const z = JSON.parse(fs.readFileSync(f, 'utf8'));
  const views = [['overzicht', z.overview, true]].concat(Object.keys(z.trees || {}).map(function (k) { return [k, z.trees[k], false]; }));
  const anders = [];
  views.forEach(function (v) {
    if (!v[1] || !Array.isArray(v[1].nodes) || !v[1].nodes.length) return;
    if (!onStandard(v[1])) { anders.push(v[0]); return; }
    checked++;
    check(v[1], v[2]).forEach(function (m) { problems++; console.log(id + ' / ' + v[0] + ' / ' + m); });
  });
  if (anders.length) eigen.push(id + ' (' + anders.length + ' van ' + views.length + ' weergaven)');
});
console.log('\n' + checked + ' weergaven op het standaardraster gecontroleerd, ' + problems + ' afwijking(en).');
if (eigen.length) console.log('Nog met een eigen raster: ' + eigen.join(', ') + '.');
process.exit(problems ? 1 : 0);
