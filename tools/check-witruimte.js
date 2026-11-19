#!/usr/bin/env node
/* Zoekt aanbevelingen die (veel) hoger zijn dan hun tekst nodig heeft, en maakt ze passend.

   Gebruik (vanuit de hoofdmap van de repository):
     npm install --no-save playwright      (eenmalig)
     node tools/check-witruimte.js          alleen melden
     node tools/check-witruimte.js --fix    ook aanpassen
     node tools/check-witruimte.js --fix vulva endometrium   alleen deze tumoren

   Een aanbeveling is te hoog als er meer dan 20 px over is boven de tekst plus binnenmarge (12 px boven en onder).
   Met --fix wordt de hoogte de gemeten hoogte (afgerond op een hokje, nooit lager dan het standaardblok) en:
     - lijnen die onder het blok begonnen, beginnen weer aan de onderrand;
     - een verwijzing of ander eindblok recht eronder schuift mee omhoog tot de afgesproken 50 px;
     - in bomen zonder vaste lijnen worden de rijen opnieuw op het raster gelegd (zie tools/oncoguide/convert.js).
   Draai daarna node tools/check.js, node tools/check-raster.js en node tools/check-tekst.js. */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const {normalizeRows} = require('./oncoguide/convert.js');
const {alignReferences} = require('./raster.js');

const ROOT = path.resolve(__dirname, '..');
const TOLERANCE = 20;   // px die er mag over zijn
const GAP_BELOW = 50;   // px tussen een aanbeveling en het blok eronder

const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml'};

async function main() {
  let chromium;
  try { chromium = require('playwright').chromium; }
  catch (e) { console.error('Playwright ontbreekt. Installeer met: npm install --no-save playwright'); process.exit(2); }
  const args = process.argv.slice(2);
  const fix = args.includes('--fix');
  const only = args.filter(function (a) { return !a.startsWith('--'); });
  const tumoren = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tumoren.json'), 'utf8')).tumoren
    .map(function (t) { return t.id; })
    .filter(function (id) { return !only.length || only.includes(id); });

  const server = http.createServer(function (req, res) {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream'});
    fs.createReadStream(p).pipe(res);
  });
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  let browser;
  try { browser = await chromium.launch(); } catch (e) { browser = await chromium.launch({channel: 'chrome'}); }
  const page = await browser.newPage({viewport: {width: 1400, height: 900}});
  const base = 'http://127.0.0.1:' + server.address().port + '/zorgpad.html';

  let found = 0, fixed = 0;
  for (const id of tumoren) {
    const file = path.join(ROOT, 'data', id, 'zorgpad.json');
    if (!fs.existsSync(file)) continue;
    const z = JSON.parse(fs.readFileSync(file, 'utf8'));
    let changed = false;
    for (const k of Object.keys(z.trees || {})) {
      const tree = z.trees[k];
      if (!tree || !Array.isArray(tree.nodes)) continue;
      await page.goto('about:blank');
      await page.goto(base + '?tumor=' + id + '#/' + k);
      await page.waitForSelector('g.node', {timeout: 10000}).catch(function () {});
      await page.waitForTimeout(150);
      // Gemeten in SVG-eenheden: nodige hoogte en huidige hoogte per aanbeveling
      const m = await page.evaluate(function () {
        const out = {};
        document.querySelectorAll('g.node.t-outcome').forEach(function (g) {
          const rect = g.querySelector(':scope > rect');
          const ts = Array.prototype.slice.call(g.querySelectorAll(':scope > text')).filter(function (t) { return t.textContent.trim(); });
          if (!rect || !ts.length) return;
          const s = (+rect.getAttribute('width')) / 179;
          const top = Math.min.apply(null, ts.map(function (t) { return t.getBBox().y; }));
          const bot = Math.max.apply(null, ts.map(function (t) { const b = t.getBBox(); return b.y + b.height; }));
          out[g.getAttribute('data-node-id')] = {need: bot - top + 2 * 12 * s + 4, h: +rect.getAttribute('height')};
        });
        return out;
      });
      const unit = (tree.layout && tree.layout.unit) || 1;
      const blockH = (tree.layout && tree.layout.blockHeight) || 20;
      const hasPoints = tree.edges.some(function (e) { return e.points; });
      const shrunk = [];
      tree.nodes.forEach(function (n) {
        const r = m[n.id];
        if (!r || n.height === undefined || r.h - r.need <= TOLERANCE) return;
        const newH = Math.max(blockH, Math.ceil(r.need / unit));
        if (newH >= n.height) return;
        found++;
        console.log(id + ' / ' + k + ' / ' + n.id + ': ' + Math.round(r.h) + ' px hoog, tekst heeft ' + Math.round(r.need) + ' px nodig');
        if (!fix) return;
        shrunk.push({n: n, oldH: n.height, newH: newH});
      });
      if (!fix || !shrunk.length) continue;
      shrunk.forEach(function (sh) {
        const n = sh.n;
        const oldBottom = (n.gridY + sh.oldH) * unit, newBottom = (n.gridY + sh.newH) * unit;
        n.height = sh.newH;
        if (!hasPoints) return;
        tree.edges.filter(function (e) { return e.from === n.id && e.points; }).forEach(function (e) {
          if (e.points[0][1] === oldBottom) e.points[0][1] = newBottom;
          // Eindblok recht eronder (zelfde kolom, alleen deze lijn erheen, zelf geen lijnen eruit): mee omhoog
          const t = tree.nodes.find(function (x) { return x.id === e.to; });
          const straight = e.points.every(function (p) { return p[0] === e.points[0][0]; });
          const incoming = tree.edges.filter(function (x) { return x.to === e.to; }).length;
          const outgoing = tree.edges.filter(function (x) { return x.from === e.to; }).length;
          if (!t || !straight || incoming !== 1 || outgoing || t.gridX !== n.gridX) return;
          const want = Math.round((newBottom + GAP_BELOW) / unit);
          if (t.gridY > want) {
            t.gridY = want;
            e.points[e.points.length - 1][1] = want * unit;
          }
        });
      });
      const standard = tree.layout && tree.layout.unit === 5 && tree.layout.blockWidth === 40 && tree.layout.blockHeight === 20;
      if (!hasPoints && standard) normalizeRows(tree);
      if (standard) alignReferences(tree);
      fixed += shrunk.length;
      changed = true;
    }
    if (changed) fs.writeFileSync(file, JSON.stringify(z, null, 2) + '\n');
  }
  await browser.close();
  server.close();
  console.log('\n' + found + ' aanbeveling(en) met te veel witruimte' + (fix ? ', ' + fixed + ' aangepast.' : '. Draai met --fix om ze passend te maken.'));
  process.exit(!fix && found ? 1 : 0);
}

main().catch(function (e) { console.error(e); process.exit(2); });
