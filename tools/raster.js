/* Hulpfuncties voor het standaardraster, gedeeld door tools/check-raster.js, tools/check-witruimte.js
   en tools/oncoguide/convert.js. Alles in rasterhokjes (layout.unit), zoals in de JSON. */
'use strict';

const REC = /^(recommendation|outcome)$/;
const REF = /^(reference|link)$/;

/* Afspraak: verwijzingen naar een vervolgboom onder een rij aanbevelingen staan op één lijn (dezelfde
   bovenkant), 50 px onder de onderkant van de laagste aanbeveling waar ze bij horen.

   Groep = alle verwijzingen waarvan elke inkomende lijn uit een aanbeveling komt, en waarvan die
   aanbevelingen op dezelfde rij staan (zelfde gridY). Geeft per groep {row, ids, top, wrong} terug. */
function referenceGroups(tree) {
  const unit = (tree.layout && tree.layout.unit) || 5;
  const gap = Math.round(50 / unit);
  const blockH = (tree.layout && tree.layout.blockHeight) || 20;
  const byId = {};
  tree.nodes.forEach(function (n) { byId[n.id] = n; });
  const groups = {};
  tree.nodes.forEach(function (n) {
    if (!REF.test(n.type || '')) return;
    const inc = tree.edges.filter(function (e) { return e.to === n.id; }).map(function (e) { return byId[e.from]; });
    if (!inc.length || inc.some(function (p) { return !p || !REC.test(p.type || ''); })) return;
    const rows = Array.from(new Set(inc.map(function (p) { return p.gridY; })));
    if (rows.length !== 1) return;
    const need = Math.max.apply(null, inc.map(function (p) { return p.gridY + (p.height || blockH) + gap; }));
    (groups[rows[0]] = groups[rows[0]] || []).push({node: n, need: need});
  });
  return Object.keys(groups).map(function (row) {
    const g = groups[row];
    const top = Math.max.apply(null, g.map(function (x) { return x.need; }));
    // per kolom telt alleen de bovenste verwijzing (andere kunnen eronder gestapeld staan)
    const blockW = (tree.layout && tree.layout.blockWidth) || 40;
    const tops = g.filter(function (x) {
      return !g.some(function (y) {
        return y !== x && y.node.gridY < x.node.gridY &&
          y.node.gridX < x.node.gridX + blockW && x.node.gridX < y.node.gridX + blockW;
      });
    });
    return {row: +row, members: g, top: top, wrong: tops.filter(function (x) { return x.node.gridY !== top; })};
  });
}

/* Zet de verwijzingen van elke groep op dezelfde bovenkant. Lijnen naar een verschoven blok lopen mee:
   het laatste punt (en het punt ervoor als dat recht erboven lag) schuift mee. Een verwijzing met eigen
   uitgaande lijnen wordt niet verschoven. Geeft het aantal verschoven blokken terug. */
function alignReferences(tree) {
  const unit = (tree.layout && tree.layout.unit) || 5;
  let moved = 0;
  const blockW = (tree.layout && tree.layout.blockWidth) || 40;
  const blockH = (tree.layout && tree.layout.blockHeight) || 20;
  const gap = Math.round(50 / unit);
  referenceGroups(tree).forEach(function (g) {
    // Verwijzingen die in dezelfde kolom onder elkaar staan: de bovenste komt op de lijn, de rest blijft eronder
    const placed = [];
    g.members.slice().sort(function (a, b) { return a.node.gridY - b.node.gridY; }).forEach(function (x) {
      const n = x.node;
      // Blokken die hier weer onder hangen (een keten van verwijzingen) schuiven mee; iets anders: niet verschuiven
      const chain = [], todo = [n.id];
      let ok = true;
      while (todo.length) {
        const id = todo.pop();
        tree.edges.forEach(function (e) {
          if (e.from !== id) return;
          const c = tree.nodes.find(function (q) { return q.id === e.to; });
          if (!c || !REF.test(c.type || '') || chain.indexOf(c) >= 0) { if (!c || !REF.test(c.type || '')) ok = false; return; }
          chain.push(c); todo.push(c.id);
        });
      }
      if (!ok) return;
      const above = placed.filter(function (p) {
        return p.node.gridX < n.gridX + blockW && n.gridX < p.node.gridX + blockW;
      });
      let target = g.top;
      if (above.length) {
        const p = above[above.length - 1];
        target = Math.max(p.newY + (n.gridY - p.oldY), p.newY + (p.node.height || blockH) + gap);
      }
      placed.push({node: n, oldY: n.gridY, newY: target});
      if (n.gridY === target) return;
      const delta = target - n.gridY;
      const oldTop = n.gridY * unit, newTop = target * unit;
      n.gridY = target;
      chain.forEach(function (c) { c.gridY += delta; });
      const inChain = function (id) { return chain.some(function (c) { return c.id === id; }); };
      tree.edges.forEach(function (e) {
        if (!(e.from === n.id || inChain(e.from)) || !e.points) return;
        ['points', 'selectedPoints'].forEach(function (key) {
          if (e[key]) e[key].forEach(function (pt) { pt[1] += delta * unit; });
        });
        if (Array.isArray(e.dot)) e.dot[1] += delta * unit;
      });
      tree.edges.forEach(function (e) {
        if (e.to !== n.id || !e.points) return;
        ['points', 'selectedPoints'].forEach(function (key) {
          const pts = e[key];
          if (!pts || !pts.length) return;
          const last = pts[pts.length - 1];
          if (last[1] === oldTop) last[1] = newTop;
        });
      });
      if (delta) moved++;
    });
  });
  return moved;
}

module.exports = {referenceGroups: referenceGroups, alignReferences: alignReferences};
