#!/usr/bin/env node
/* Controleert in een echte browser of de tekst in elk blok past, in alle zorgpaden en beslisbomen.

   Gebruik (vanuit de hoofdmap van de repository):
     npm install --no-save playwright      (eenmalig; Chrome of Chromium moet geïnstalleerd zijn)
     node tools/check-tekst.js             alle tumoren
     node tools/check-tekst.js vulva       alleen deze tumor(en)

   Meldt per blok:
     - tekst die links of rechts buiten het blok (of in de binnenmarge) valt
     - tekst die over het icoon (pijl, plus, min) loopt of er minder dan 3 px vanaf staat
     - tekst die onder of boven buiten het blok valt
   Mislukt (exitcode 1) als er iets gevonden wordt.

   Dit script is een aanvulling op tools/check.js: dat controleert de inhoud zonder browser,
   dit script meet de tekst zoals een bezoeker die ziet. */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2'};

function serve() {
  return new Promise(function (resolve) {
    const server = http.createServer(function (req, res) {
      const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, {'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream'});
      fs.createReadStream(p).pipe(res);
    });
    server.listen(0, '127.0.0.1', function () { resolve(server); });
  });
}

/* Draait in de pagina: meet elk blok. Marge in px op schaal 1 (de renderer gebruikt 14). */
function measure() {
  const out = [];
  document.querySelectorAll('g.node').forEach(function (g) {
    const rect = g.querySelector(':scope > rect');
    if (!rect) return;
    const w = +rect.getAttribute('width'), h = +rect.getAttribute('height');
    const s = w / 179 || 1;
    const icon = g.querySelector(':scope > g.icon');
    const iconBox = icon ? icon.getBBox() : null;
    let iconLeft = null;
    if (icon) {
      // Het icoon staat via transform op de rand; reken de linkerkant om naar blokcoördinaten.
      const m = icon.transform.baseVal.consolidate().matrix;
      iconLeft = m.e + iconBox.x * m.a;
    }
    const problems = [];
    g.querySelectorAll(':scope > text').forEach(function (t) {
      if (!t.textContent.trim()) return;
      const b = t.getBBox();
      const tol = 0.5;
      if (b.x < 4 * s - tol || b.x + b.width > w - 4 * s + tol) problems.push('buiten het blok: "' + t.textContent + '"');
      else if (iconLeft !== null && b.x + b.width > iconLeft - 3 * s + tol &&
               b.y + b.height > (h / 2 - 16 * s) && b.y < (h / 2 + 16 * s)) problems.push('over het icoon: "' + t.textContent + '"');
      if (b.y < -tol || b.y + b.height > h + tol) problems.push('onder/boven buiten het blok: "' + t.textContent + '"');
    });
    if (problems.length) out.push({id: g.getAttribute('data-node-id'), problems: problems});
  });
  return out;
}

async function main() {
  let chromium;
  try { chromium = require('playwright').chromium; }
  catch (e) { console.error('Playwright ontbreekt. Installeer met: npm install --no-save playwright'); process.exit(2); }

  const only = process.argv.slice(2);
  const tumoren = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tumoren.json'), 'utf8')).tumoren
    .filter(function (t) { return t.status === 'available' && (!only.length || only.includes(t.id)); });

  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port + '/zorgpad.html';
  let browser;
  try { browser = await chromium.launch(); }
  catch (e) { browser = await chromium.launch({channel: 'chrome'}); }
  const page = await browser.newPage({viewport: {width: 1400, height: 900}});
  page.on('pageerror', function (e) { console.error('  scriptfout: ' + e.message); });

  let total = 0, checked = 0;
  for (const t of tumoren) {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', t.id, 'zorgpad.json'), 'utf8'));
    const views = [''].concat(Object.keys(data.trees || {}));
    for (const tree of views) {
      const url = base + '?tumor=' + t.id + (tree ? '#/' + tree : '');
      await page.goto('about:blank');
      await page.goto(url);
      await page.waitForSelector('g.node', {timeout: 10000}).catch(function () {});
      await page.waitForTimeout(150);
      const found = await page.evaluate(measure);
      checked++;
      found.forEach(function (f) {
        f.problems.forEach(function (p) {
          total++;
          console.log(t.id + (tree ? ' / ' + tree : ' / overzicht') + ' / ' + f.id + ': ' + p);
        });
      });
    }
  }
  await browser.close();
  server.close();
  console.log('\n' + checked + ' weergaven gecontroleerd, ' + total + ' probleem/problemen gevonden.');
  process.exit(total ? 1 : 0);
}

main().catch(function (e) { console.error(e); process.exit(2); });
