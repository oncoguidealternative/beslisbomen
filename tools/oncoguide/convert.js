#!/usr/bin/env node
/* Zet een export uit Oncoguide (zie export.js) om naar data/<tumor>/zorgpad.json.

   Gebruik (vanuit de hoofdmap van de repository):
     node tools/oncoguide/convert.js tools/oncoguide/configs/<tumor>.json
     node tools/oncoguide/convert.js tools/oncoguide/configs/<tumor>.json --measure

   --measure meet daarna in een echte browser hoe hoog elke aanbeveling moet zijn en past de hoogtes aan
   (nodig: npm install --no-save playwright). Zonder --measure worden de hoogtes geschat.

   Wat er gebeurt:
     - posities: Oncoguide-pixels 1:1 op het raster (unit 5), kleine scheefstanden rechtgetrokken (25 px)
     - titel, gegevens (keuzes), aanbevelingen en verwijzingen worden de types title, dataItem, recommendation, reference
     - keuzes worden interactief; metingen (getallen) krijgen een invoerveld met bereiken
     - een boom met een eigen gegeven in Oncoguide wordt een hulpbeslisboom bij dat gegeven
     - het menu (overzicht) van Oncoguide wordt het overzicht van het zorgpad
     - de toelichting per boom wordt de onderbouwing; de link naar de richtlijn wordt de bron
     - (i) wordt {i}, (/) wordt {x}; lege regels vallen weg
   Zie docs/oncoguide-import.md voor de configuratie en de werkwijze. */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SNAP = 25;          // Oncoguide-raster in px: posities worden hierop afgerond
const UNIT = 5;           // px per hokje in onze bestanden
const LAYOUT = {unit: UNIT, blockWidth: 40, blockHeight: 20, margin: 10};

/* ---------- tekst ---------- */

const ENTITIES = {nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", euml: 'ë', iuml: 'ï', eacute: 'é'};
function decode(s) {
  return s.replace(/&(#\d+|[a-z]+);/gi, function (m, e) {
    if (e[0] === '#') return String.fromCharCode(parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] !== undefined ? ENTITIES[e.toLowerCase()] : m;
  }).replace(/[​ ]/g, ' ');
}

function htmlLines(html) {
  // <br>, </p> en een gewone regelovergang (Oncoguide toont die ook) zijn nieuwe regels
  return decode(String(html || '').replace(/\r/g, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, ''))
    .split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); });
}

function fixText(s, cfg) {
  (cfg.vervang || []).forEach(function (r) { s = s.split(r[0]).join(r[1]); });
  return s;
}

// Tekst van een aanbeveling: één regel per regel, zonder lege regels, (i) → {i}, (/) → {x}
function recText(html, cfg) {
  return htmlLines(html).filter(Boolean).map(function (l) {
    return fixText(l.replace(/^\(i\)\s*/i, '{i} ').replace(/^\(\/\)\s*/, '{x} '), cfg);
  }).join('\n');
}

// Korte tekst (titel, gegeven, verwijzing): op één regel
function label(html, cfg) {
  return fixText(htmlLines(html).filter(Boolean).join(' '), cfg);
}

// Eenheid van een meting. Oncoguide laat die bij gehele getallen soms leeg; dan uit de configuratie
// ("eenheden": {"<naam van het gegeven>": "jaar"}) of een redelijke standaard.
function unitFor(item, cfg) {
  const name = label(item.name || '', cfg);
  if (cfg.eenheden && cfg.eenheden[name]) return cfg.eenheden[name];
  if (item.unit && String(item.unit).trim()) return String(item.unit).trim();
  if (/leeftijd/i.test(name)) return 'jaar';
  if (/kuren/i.test(name)) return 'kuren';
  if (/ovaria|ovarium/i.test(name)) return 'aantal';
  if (/performance|ecog|who/i.test(name)) return 'score';
  return 'getal';
}

// Waarde van een keuze: "<=IIA" wordt "lte-iia", ">= IIB" wordt "gte-iib"
function valueSlug(s) {
  return slug(String(s).replace(/<=/g, ' lte ').replace(/>=/g, ' gte ').replace(/</g, ' lt ').replace(/>/g, ' gt '));
}

function capital(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function slug(s) {
  return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function shortSlug(s, max) {
  const sl = slug(s);
  if (sl.length <= max) return sl;
  return sl.slice(0, max).replace(/-[^-]*$/, '');
}

function unique(id, used) {
  let out = id, k = 2;
  while (used.has(out)) out = id + '-' + (k++);
  used.add(out);
  return out;
}

// Toelichting → onderbouwing: alinea's, zonder de standaard-disclaimer. Geeft ook de link naar de richtlijn.
function onderbouwing(html, cfg) {
  const links = [];
  String(html || '').replace(/href="([^"]+)"/g, function (m, u) { links.push(decode(u).trim()); });
  const paras = String(html || '').split(/<\/p>|<br\s*\/?>\s*<br\s*\/?>/i)
    .map(function (p) { return label(p, cfg); })
    .filter(function (p) {
      return p && !/^disclaimer\s*:?\s*$/i.test(p) && !/^zie gebruiksvoorwaarden/i.test(p) &&
        !/^richtlijntekst is te vinden/i.test(p);
    })
    .map(function (p) {
      return p.replace(/\s*Disclaimer\s*:.*$/i, '').replace(/\s*Richtlijntekst is te vinden op\s*:?.*$/i, '').trim();
    })
    .filter(Boolean);
  // oncoline.nl bestaat niet meer: een link naar de richtlijnendatabase gaat voor
  const good = links.filter(function (u) { return /^https:\/\//.test(u); })
    .sort(function (a, b) { return /oncoline\.nl/.test(a) - /oncoline\.nl/.test(b); });
  return {text: paras.join('\n\n'), url: good[0] || null};
}

// Geschatte hoogte van een aanbeveling (hokjes); --measure meet het daarna precies na
function estimateHeight(text) {
  let n = 0;
  text.split('\n').forEach(function (l) { n += Math.max(1, Math.ceil(l.length / 27)); });
  return Math.max(LAYOUT.blockHeight, Math.ceil(n * 3.4 + 7));
}

/* ---------- omzetten ---------- */

/* register: Oncoguide-boomnummer → {tumor, tree, naam}; zie tools/oncoguide/register.json.
   bestaand: [{tumor, tree, titel}] van de bomen die al op de website staan (voor suggesties op naam). */
function convert(exp, cfg, register, bestaand, oudOverzicht) {
  const warnings = [];
  register = register || {};
  bestaand = bestaand || [];
  const di = {};
  exp.dataitems.forEach(function (d) { di[d.id] = d; });

  // Sleutels van de bomen: uit de configuratie, anders uit de naam
  const keys = {}, usedKeys = new Set();
  // Menuboom (overzicht): uit de configuratie ("menu": nummer), anders de eerste menuboom in de export
  const menu = cfg.menu ? exp.trees.find(function (t) { return t.id === cfg.menu; })
    : exp.trees.find(function (t) { return t.isMenuTree || t.type === 21; });
  if (cfg.menu && !menu) throw new Error('Menuboom ' + cfg.menu + ' staat niet in de export');
  // Alleen bomen die vanuit het menu bereikbaar zijn (via verwijzingen en hulpbeslisbomen). Zo blijven
  // testversies en anderstalige kopieën in hetzelfde Oncoguide-project buiten beschouwing.
  const reach = new Set();
  if (menu) {
    const byId = {}, bySub = {};
    exp.trees.forEach(function (t) { byId[t.id] = t; if (t.dataItemID) bySub[t.dataItemID] = t; });
    const todo = [menu];
    while (todo.length) {
      const t = todo.pop();
      if (reach.has(t.id)) continue;
      reach.add(t.id);
      t.nodes.forEach(function (n) {
        if (n.referenceId && byId[n.referenceId]) todo.push(byId[n.referenceId]);
        if (n.dataItem && bySub[n.dataItem]) todo.push(bySub[n.dataItem]);
      });
    }
    const skipped = exp.trees.filter(function (t) { return !reach.has(t.id); });
    if (skipped.length) warnings.push('niet bereikbaar vanuit het menu, overgeslagen: ' +
      skipped.map(function (t) { return t.id + ' ' + label(t.name, cfg); }).join('; '));
  }
  // Bomen die al bij een andere tumor staan (register) of in de configuratie onder "extern":
  // daar wordt naar verwezen, ze worden hier niet nog eens omgezet.
  const extern = {};
  Object.keys(register).forEach(function (id) {
    const r = register[id];
    if (r.tumor !== cfg.tumor) extern[id] = {tumor: r.tumor, tree: r.tree};
  });
  Object.assign(extern, cfg.extern || {});
  const own = exp.trees.filter(function (t) { return (t === menu || !extern[t.id]) && (!menu || reach.has(t.id)); });

  // Bestaand overzicht behouden: koppel elke stap aan de Oncoguide-boom met (bijna) dezelfde naam,
  // en geef die boom het id van de stap, zodat het overzicht blijft werken.
  const preferred = {}, overviewPatch = [];
  if (oudOverzicht && menu) {
    const words = function (str) { return new Set(slug(str).split('-').filter(function (w) { return w.length > 1; })); };
    const refs = menu.nodes.filter(function (n) { return n.type === 5 && n.referenceId; })
      .map(function (n) { return {ref: n.referenceId, label: label(n.name, cfg)}; });
    oudOverzicht.nodes.forEach(function (o) {
      if (!(o.drill || o.to !== undefined) || o.tumor) return;
      let best = null, bestScore = 0;
      refs.forEach(function (r) {
        if (slug(r.label) === slug(o.label || '')) { best = r; bestScore = 1; return; }
        const a = words(r.label), b = words(o.label || '');
        let same = 0; a.forEach(function (w) { if (b.has(w)) same++; });
        const score = same / Math.max(a.size, b.size, 1);
        if (score > bestScore && bestScore < 1) { best = r; bestScore = score; }
      });
      if (!best || bestScore < 0.5) { warnings.push('overzicht: stap "' + o.label + '" niet gevonden in het Oncoguide-menu'); return; }
      if (!extern[best.ref] && !preferred[best.ref]) preferred[best.ref] = o.to || o.id;
      overviewPatch.push({id: o.id, ref: best.ref});
    });
  }
  own.forEach(function (t) {
    if (t === menu) return;
    keys[t.id] = unique((cfg.bomen && cfg.bomen[t.id]) || preferred[t.id] || slug(label(t.name, cfg)), usedKeys);
  });
  const subtreeOf = {};  // dataItem-id → boomsleutel
  exp.trees.forEach(function (t) { if (t.dataItemID && keys[t.id]) subtreeOf[t.dataItemID] = keys[t.id]; });

  function target(refId, where) {
    if (extern[refId]) return Object.assign({}, extern[refId]);
    if (keys[refId]) return {to: keys[refId]};
    warnings.push(where + ': verwijzing naar Oncoguide-boom ' + refId + ' die niet in dit project zit en nog bij geen andere tumor staat; ' +
      'zet de juiste tumor en boom onder "extern" in de configuratie, of zet die tumor eerst om.');
    return {};
  }

  function graph(t, isOverview) {
    const where = isOverview ? 'overzicht' : keys[t.id];
    const used = new Set(), ids = {}, nodes = [], byOg = {};
    const pos = function (v) { return Math.round(v / SNAP) * SNAP; };
    const x0 = Math.min.apply(null, t.nodes.map(function (n) { return pos(n.left); }));
    const y0 = Math.min.apply(null, t.nodes.map(function (n) { return pos(n.top); }));
    const drilled = new Set();

    t.nodes.forEach(function (o) {
      const n = {};
      let id;
      if (o.type === 3) {
        id = isOverview ? 'start' : 'titel';
        Object.assign(n, {type: 'title', label: label(o.name, cfg)});
      } else if (o.type === 2) {
        id = slug(label(o.name, cfg));
        Object.assign(n, {type: 'dataItem', label: label(o.name, cfg)});
        n._di = o.dataItem;
      } else if (o.type === 5 && isOverview) {
        // Stap in het overzicht: opent de beslisboom (drill), of verwijst als die al eerder in het overzicht staat
        const tg = target(o.referenceId, where);
        Object.assign(n, {label: label(o.name, cfg)});
        if (tg.to && !drilled.has(tg.to)) { drilled.add(tg.to); id = tg.to; n.drill = true; }
        else { id = (tg.to || tg.tree || slug(n.label)); Object.assign(n, tg, {icon: 'down'}); }
      } else if (o.type === 5) {
        id = 'verwijzing-' + slug(label(o.name, cfg));
        Object.assign(n, {type: 'reference', label: label(o.name, cfg)}, target(o.referenceId, where));
      } else {
        // 1 = aanbeveling; 8 = aanbeveling met een link naar een andere boom
        const text = recText(o.name, cfg);
        const lines = text.split('\n').filter(function (l) {
          return l && l !== 'EN' && l !== 'OF' && !/^\{i\}/.test(l) && !/^Grondige/.test(l) && !/:$/.test(l);
        });
        let first = (lines[0] || text).replace(/^\{x\}\s*/, function () { return /^\{x\}\s*geen/i.test(lines[0]) ? '' : 'geen '; });
        id = 'aanbeveling-' + shortSlug(first, 44);
        if (/verwijdering tumordeposities/.test(text) && !/^Chirurgische/.test(lines[0] || '')) id += '-en-deposities';
        Object.assign(n, {type: 'recommendation', text: text, height: estimateHeight(text)});
        if (o.type === 8 && o.referenceId) Object.assign(n, target(o.referenceId, where), {icon: 'plus-light'});
        if (o.ranges && o.ranges.length) n._outcome = o.ranges.map(function (r) { return Number(r.min); });
      }
      n.id = unique(id, used);
      n.gridX = (pos(o.left) - x0) / UNIT;
      n.gridY = (pos(o.top) - y0) / UNIT;
      ids[o.id] = n.id; byOg[o.id] = n;
      nodes.push(n);
    });

    const edges = [], usedEdges = new Set();
    t.connections.forEach(function (c) {
      const from = byOg[c.source], to = byOg[c.target];
      if (!from || !to) { warnings.push(where + ': verbinding naar een onbekend blok overgeslagen'); return; }
      const e = {from: from.id, to: to.id};
      const name = capital(label(c.name, cfg));
      if (from._di && c.ranges && c.ranges.length) {
        const item = di[from._di] || {values: []};
        e.label = name;
        const numeric = c.ranges.some(function (r) { return !item.values.some(function (v) { return String(v.id) === String(r.min); }); });
        from._opts = from._opts || [];
        if (numeric) {
          // Meting: bereik uit min/max
          const r = c.ranges[0], opt = {value: slug(name.replace(/<=/g, 'lte ').replace(/>=/g, 'gte ').replace(/</g, 'lt ').replace(/>/g, 'gt ')), label: name};
          if (r.min !== '-Infinity' && r.min !== null) opt[r.minInclusive ? 'gte' : 'gt'] = Number(r.min);
          if (r.max !== 'Infinity' && r.max !== null) opt[r.maxInclusive ? 'lte' : 'lt'] = Number(r.max);
          from.measure = {unit: unitFor(item, cfg)};
          from._opts.push(opt);
          e.value = opt.value;
        } else {
          const names = {};
          item.values.forEach(function (v) { names[v.id] = capital(label(v.name, cfg)); });
          const vids = c.ranges.map(function (r) { return Number(r.min); });
          // Toont Oncoguide op de lijn een eigen antwoord (bv. "Ja" bij "1 ovarium in situ"), neem dat dan over
          if (name.indexOf(',') < 0 && vids.some(function (v) { return names[v] !== name; })) {
            vids.forEach(function (v) { names[v] = name; });
          }
          const vals = [];
          vids.forEach(function (v) {
            const val = valueSlug(names[v]);
            if (vals.indexOf(val) < 0) vals.push(val);
            let opt = from._opts.find(function (o) { return o.value === val; });
            if (!opt) {
              const idx = (item.values.find(function (x) { return x.id === v; }) || {index: 99}).index;
              opt = {value: val, label: names[v], _i: idx, _ids: []};
              from._opts.push(opt);
            }
            if (opt._ids && opt._ids.indexOf(v) < 0) opt._ids.push(v);
          });
          e.value = vals.length === 1 ? vals[0] : vals;
        }
      }
      const part = typeof e.value === 'string' ? e.value : (e.label && e.label.length < 30 ? slug(e.label.split(',')[0]) : e.to);
      e.id = unique('edge-' + e.from + '-' + part, usedEdges);
      e.arrow = true;
      edges.push(Object.assign({id: e.id}, e));
      if (e.value !== undefined) {
        [].concat(e.value).forEach(function (v) {
          from._opts.forEach(function (o) { if (o.value === v) o.edge = e.id; });
        });
      }
    });

    nodes.forEach(function (n) {
      if (n._di !== undefined) {
        if (n._opts && n._opts.length) {
          n.interactive = true;
          if (!n.measure) n._opts.sort(function (a, b) { return a._i - b._i; });
          else {
            // Metingen van klein naar groot
            const low = function (o) { return o.gt !== undefined ? o.gt : o.gte !== undefined ? o.gte : -Infinity; };
            n._opts.sort(function (a, b) { return low(a) - low(b); });
          }
          n._valueIds = {};
          n._opts.forEach(function (o) { (o._ids || []).forEach(function (id) { n._valueIds[id] = o.value; }); });
          n.options = n._opts.map(function (o) { delete o._i; delete o._ids; return o; });
          if (subtreeOf[n._di]) n._subtree = subtreeOf[n._di];
        }
        n._diKeep = n._di;
      }
      delete n._opts; delete n._di;
    });
    return {nodes: nodes, edges: edges};
  }

  const trees = {};
  own.forEach(function (t) {
    if (t === menu) return;
    const g = graph(t, false);
    const ob = onderbouwing(t.information, cfg);
    const tree = {};
    if (ob.text) tree.onderbouwing = ob.text;
    if (ob.url && ob.url !== (cfg.bron && cfg.bron.url)) tree.bron = {url: ob.url};
    tree.layout = Object.assign({}, LAYOUT);
    tree.nodes = g.nodes; tree.edges = g.edges;
    if (t.dataItemID) tree._dataItem = t.dataItemID;
    trees[keys[t.id]] = tree;
  });

  // Hulpbeslisbomen koppelen: uitkomst van de hulpboom → waarde van het gegeven
  Object.keys(trees).forEach(function (k) {
    trees[k].nodes.forEach(function (n) {
      if (n._subtree) {
        const sub = trees[n._subtree], item = di[n._diKeep], map = {};
        sub.nodes.forEach(function (o) {
          if (o._outcome === undefined) return;
          // De uitkomst hoort bij de keuze waarvan de lijn deze waarde bevat (ook als Oncoguide waarden
          // groepeert, zoals "<=IIA"); anders bij de keuze met dezelfde naam.
          let val = null;
          o._outcome.forEach(function (id) { if (!val && n._valueIds[id]) val = n._valueIds[id]; });
          if (!val) {
            const v = item && item.values.find(function (x) { return o._outcome.indexOf(x.id) >= 0; });
            const sv = v && valueSlug(label(v.name, cfg));
            if (sv && n.options.some(function (opt) { return opt.value === sv; })) val = sv;
          }
          if (val) map[o.id] = val;
          else warnings.push(k + ': uitkomst "' + (o.text || o.id) + '" van hulpbeslisboom ' + n._subtree + ' hoort bij geen enkele keuze van "' + n.label + '"');
        });
        n.subtree = {tree: n._subtree, map: map};
      }
      delete n._subtree; delete n._diKeep; delete n._valueIds;
    });
  });
  Object.keys(trees).forEach(function (k) {
    trees[k].nodes.forEach(function (n) { delete n._outcome; });
    delete trees[k]._dataItem;
  });

  let overview = null;
  if (menu && !oudOverzicht) {
    const g = graph(menu, true);
    overview = {layout: Object.assign({}, LAYOUT), nodes: g.nodes, edges: g.edges};
  } else if (!menu) warnings.push('geen menuboom (overzicht) gevonden in de export');
  // Suggestie: een boom die inhoudelijk grotendeels gelijk is aan een boom die al bij een andere tumor staat
  // (zelfde naam én minstens 60% dezelfde blokteksten). Niet automatisch: dat beslis je in de configuratie.
  const words = function (nodes) {
    return new Set(nodes.map(function (n) { return slug(n.text || n.label || ''); }).filter(Boolean));
  };
  Object.keys(trees).forEach(function (k) {
    const mine = words(trees[k].nodes);
    const titel = (trees[k].nodes.find(function (n) { return n.type === 'title'; }) || {}).label || '';
    const ogId = Object.keys(keys).find(function (id) { return keys[id] === k; });
    bestaand.forEach(function (b) {
      if (b.tumor === cfg.tumor || slug(b.titel) !== slug(titel)) return;
      let same = 0;
      mine.forEach(function (w) { if (b.woorden.has(w)) same++; });
      const score = same / Math.max(mine.size, b.woorden.size, 1);
      if (score >= 0.6) {
        warnings.push('"' + titel + '" (Oncoguide-boom ' + ogId + ') lijkt voor ' + Math.round(score * 100) + '% op ' + b.tumor + ' / ' + b.tree +
          '. Is het dezelfde boom? Zet dan in de configuratie onder "extern": "' + ogId + '": {"tumor": "' + b.tumor + '", "tree": "' + b.tree + '"}');
      }
    });
  });

  const ownTrees = {};
  own.forEach(function (t) { if (t !== menu) ownTrees[t.id] = {tree: keys[t.id], naam: label(t.name, cfg)}; });
  const linked = Object.keys(extern).filter(function (id) { return exp.trees.some(function (t) { return String(t.id) === id; }); })
    .map(function (id) { return extern[id]; });
  // Het bestaande overzicht laten wijzen naar de omgezette bomen (of naar de andere tumor)
  if (oudOverzicht) {
    overview = JSON.parse(JSON.stringify(oudOverzicht));
    overviewPatch.forEach(function (p) {
      const n = overview.nodes.find(function (x) { return x.id === p.id; });
      if (extern[p.ref]) {
        delete n.drill; delete n.to;
        Object.assign(n, extern[p.ref]); n.icon = n.icon || 'down';
      } else if (keys[p.ref] !== n.id) {
        n.to = keys[p.ref];
      } else delete n.to;
    });
  }
  return {overview: overview, trees: trees, warnings: warnings, ownTrees: ownTrees, linked: linked};
}

/* ---------- hoogtes nameten in de browser (--measure) ---------- */

async function measure(tumor, file, data) {
  let chromium;
  try { chromium = require('playwright').chromium; }
  catch (e) { console.error('Voor --measure is Playwright nodig: npm install --no-save playwright'); return false; }
  const http = require('http');
  const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png'};
  const server = http.createServer(function (req, res) {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'Content-Type': types[path.extname(p)] || 'application/octet-stream'});
    fs.createReadStream(p).pipe(res);
  });
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  let browser;
  try { browser = await chromium.launch(); } catch (e) { browser = await chromium.launch({channel: 'chrome'}); }
  const page = await browser.newPage({viewport: {width: 1400, height: 900}});
  const base = 'http://127.0.0.1:' + server.address().port + '/zorgpad.html?tumor=' + tumor;
  for (const k of Object.keys(data.trees)) {
    await page.goto('about:blank');
    await page.goto(base + '#/' + k);
    await page.waitForSelector('g.node', {timeout: 10000}).catch(function () {});
    await page.waitForTimeout(150);
    const need = await page.evaluate(function () {
      const out = {};
      document.querySelectorAll('g.node.t-outcome').forEach(function (g) {
        const rect = g.querySelector(':scope > rect');
        const ts = Array.prototype.slice.call(g.querySelectorAll(':scope > text'));
        if (!rect || !ts.length) return;
        const s = (+rect.getAttribute('width')) / 179;
        const top = Math.min.apply(null, ts.map(function (t) { return t.getBBox().y; }));
        const bot = Math.max.apply(null, ts.map(function (t) { const b = t.getBBox(); return b.y + b.height; }));
        out[g.getAttribute('data-node-id')] = bot - top + 2 * 12 * s + 4;
      });
      return out;
    });
    const tree = data.trees[k];
    tree.nodes.forEach(function (n) {
      if (need[n.id] === undefined) return;
      const h = Math.max(LAYOUT.blockHeight, Math.ceil(need[n.id] / UNIT));
      const old = n.height;
      n.height = h;
      // Wordt een aanbeveling hoger dan er ruimte is, schuif dan alles eronder in die kolom(men) mee omlaag
      const bottom = n.gridY + h + 4;
      tree.nodes.forEach(function (m) {
        if (m === n || m.gridY <= n.gridY) return;
        const overlapX = m.gridX < n.gridX + LAYOUT.blockWidth && n.gridX < m.gridX + LAYOUT.blockWidth;
        if (overlapX && m.gridY < bottom && h > old) {
          const delta = bottom - m.gridY;
          tree.nodes.forEach(function (q) { if (q.gridY >= m.gridY) q.gridY += delta; });
        }
      });
    });
  }
  await browser.close();
  server.close();
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  return true;
}

/* ---------- opdrachtregel ---------- */

async function main() {
  const args = process.argv.slice(2);
  const cfgFile = args.find(function (a) { return !a.startsWith('--'); });
  if (!cfgFile) { console.error('Gebruik: node tools/oncoguide/convert.js tools/oncoguide/configs/<tumor>.json [--measure]'); process.exit(2); }
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  const exp = JSON.parse(fs.readFileSync(path.resolve(path.dirname(cfgFile), cfg.export), 'utf8'));
  const regFile = path.join(__dirname, 'register.json');
  const register = fs.existsSync(regFile) ? JSON.parse(fs.readFileSync(regFile, 'utf8')) : {};
  const bestaand = [];
  fs.readdirSync(path.join(ROOT, 'data')).forEach(function (d) {
    const f = path.join(ROOT, 'data', d, 'zorgpad.json');
    if (d === cfg.tumor || !fs.existsSync(f)) return;
    const z = JSON.parse(fs.readFileSync(f, 'utf8'));
    Object.keys(z.trees || {}).forEach(function (k) {
      const t = (z.trees[k].nodes || []).find(function (n) { return n.type === 'title' || n.type === 'root'; });
      if (t) bestaand.push({tumor: d, tree: k, titel: t.label || '', woorden: new Set((z.trees[k].nodes || [])
        .map(function (n) { return slug(n.text || n.label || ''); }).filter(Boolean))});
    });
  });
  const file0 = path.join(ROOT, 'data', cfg.tumor, 'zorgpad.json');
  const old0 = fs.existsSync(file0) ? JSON.parse(fs.readFileSync(file0, 'utf8')) : {};
  const res = convert(exp, cfg, register, bestaand, cfg.behoudOverzicht ? old0.overview : null);

  const file = path.join(ROOT, 'data', cfg.tumor, 'zorgpad.json');
  const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const out = {
    id: cfg.tumor,
    titel: cfg.titel || old.titel || label(exp.source.name || cfg.tumor, cfg),
    bron: Object.assign({}, old.bron || {}, cfg.bron || {}),
    overview: res.overview || old.overview,
    trees: res.trees
  };
  if (!out.bron.opmerking && exp.source) {
    out.bron.opmerking = 'Omgezet uit Oncoguide (IKNL, project ' + exp.source.project +
      (exp.source.publishDate ? ', publicatie ' + exp.source.publishDate.slice(0, 10).split('-').reverse().join('-') : '') + ').';
  }
  if (cfg.overzicht) {
    // Aanpassingen per stap in het overzicht, bijv. een verwijzing naar een andere tumor
    out.overview.nodes.forEach(function (n) { if (cfg.overzicht[n.id]) Object.assign(n, cfg.overzicht[n.id]); });
    out.overview.nodes.forEach(function (n) { if (n.tumor || n.to !== undefined) { delete n.drill; n.icon = n.icon || 'down'; } });
  }
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  console.log('Geschreven: ' + path.relative(ROOT, file) + ' (' + Object.keys(out.trees).length + ' beslisbomen)');
  Object.keys(out.trees).forEach(function (k) { console.log('  ' + k + ': ' + out.trees[k].nodes.length + ' blokken'); });
  res.linked.forEach(function (l) { console.log('  → verwijst naar ' + l.tumor + (l.tree ? ' / ' + l.tree : '') + ' (niet gekopieerd)'); });
  res.warnings.forEach(function (w) { console.log('  ! ' + w); });

  // Register bijwerken: de bomen van deze tumor, zodat latere projecten ernaar verwijzen in plaats van te kopiëren
  Object.keys(register).forEach(function (id) { if (register[id].tumor === cfg.tumor) delete register[id]; });
  Object.keys(res.ownTrees).forEach(function (id) {
    register[id] = {tumor: cfg.tumor, tree: res.ownTrees[id].tree, naam: res.ownTrees[id].naam};
  });
  const sorted = {};
  Object.keys(register).sort(function (a, b) { return a - b; }).forEach(function (k) { sorted[k] = register[k]; });
  fs.writeFileSync(regFile, JSON.stringify(sorted, null, 2) + '\n');

  // Tumor op de homepage zetten als die er nog niet staat
  const tf = path.join(ROOT, 'data', 'tumoren.json');
  const tumoren = JSON.parse(fs.readFileSync(tf, 'utf8'));
  if (!tumoren.tumoren.some(function (t) { return t.id === cfg.tumor; })) {
    tumoren.tumoren.push({id: cfg.tumor, titel: out.titel.replace(/^Zorgpad\s+/i, ''), afbeelding: 'images/Gynaecologie_vierkant.png', status: 'available'});
    fs.writeFileSync(tf, JSON.stringify(tumoren, null, 2) + '\n');
    console.log('Toegevoegd aan data/tumoren.json: ' + cfg.tumor);
  }

  if (args.includes('--measure')) {
    if (await measure(cfg.tumor, file, out)) console.log('Hoogtes van de aanbevelingen nagemeten in de browser.');
  } else {
    console.log('Tip: draai opnieuw met --measure om de hoogtes van de aanbevelingen precies te maken.');
  }
  console.log('Controleer daarna: node tools/check.js && node tools/check-tekst.js ' + cfg.tumor);
}

if (require.main === module) main().catch(function (e) { console.error(e); process.exit(1); });
module.exports = {convert: convert, recText: recText, label: label, slug: slug};
