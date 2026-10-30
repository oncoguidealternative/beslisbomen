/* Bronvermelding van een zorgpad of beslisboom, getoond in het informatiepaneel (ContentPanel).

   Gegevens in data/<tumor>/zorgpad.json:
     "bron": {                       // voor het hele zorgpad
       "richtlijn": "Vulvacarcinoom",
       "organisatie": "NVOG",
       "publicatiedatum": "2021-11-22",
       "beoordeeldOp": "2021-12-30",  // beoordeeld op geldigheid (door de richtlijnorganisatie)
       "versie": "…",                 // optioneel
       "url": "https://richtlijnendatabase.nl/…",
       "bijgewerkt": "2026-10-30",    // wanneer dit zorgpad op deze website is gecontroleerd tegen de richtlijn
       "opmerking": "…"               // optioneel
     }
   Een beslisboom kan in zijn eigen "bron" velden aanvullen of overschrijven, bijvoorbeeld "module" en een "url"
   naar de module. Datums in de vorm jjjj-mm-dd; ze worden getoond als dd-mm-jjjj.
   Bevat geen medische inhoud en raakt het diagram niet aan. */
const Bron = (function () {
  'use strict';

  const FIELDS = [
    { key: 'richtlijn', label: 'Richtlijn' },
    { key: 'module', label: 'Module' },
    { key: 'organisatie', label: 'Organisatie' },
    { key: 'versie', label: 'Versie' },
    { key: 'publicatiedatum', label: 'Publicatiedatum', date: true },
    { key: 'beoordeeldOp', label: 'Beoordeeld op geldigheid', date: true },
    { key: 'bijgewerkt', label: 'Gecontroleerd voor deze website', date: true }
  ];

  function isObject(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

  function formatDate(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
    return m ? m[3] + '-' + m[2] + '-' + m[1] : String(value);
  }

  function isSafeUrl(url) {
    return typeof url === 'string' && /^https?:\/\//i.test(url);
  }

  /* De bron voor een boom: die van het zorgpad, aangevuld of overschreven door die van de boom. */
  function resolve(zorgpad, treeId) {
    const base = isObject(zorgpad && zorgpad.bron) ? zorgpad.bron : {};
    const tree = treeId && zorgpad && zorgpad.trees ? zorgpad.trees[treeId] : null;
    // Een hergebruikte boom ("same") gebruikt de bron van zijn bronboom, tenzij hij er zelf een heeft.
    let own = tree && isObject(tree.bron) ? tree.bron : null;
    if (!own && tree && tree.same && zorgpad.trees[tree.same] && isObject(zorgpad.trees[tree.same].bron)) {
      own = zorgpad.trees[tree.same].bron;
    }
    return Object.assign({}, base, own || {});
  }

  /* Paginadata voor ContentPanel.showData. title: naam van het zorgpad of de beslisboom. */
  function page(bron, title) {
    const items = [];
    FIELDS.forEach(function (f) {
      const v = bron[f.key];
      if (v === undefined || v === null || v === '') return;
      items.push({ term: f.label, definition: f.date ? formatDate(v) : String(v) });
    });
    const blocks = [];
    if (items.length) {
      blocks.push({ type: 'definitionList', items: items });
    } else {
      blocks.push({ type: 'paragraph', text: 'Voor dit onderdeel is nog geen bron vastgelegd.' });
    }
    if (bron.opmerking) blocks.push({ type: 'paragraph', text: String(bron.opmerking) });
    if (isSafeUrl(bron.url)) {
      blocks.push({ type: 'paragraph', text: 'Lees de volledige tekst bij de bron:', links: [{ href: bron.url, label: 'Open de richtlijn' }] });
    }
    blocks.push({
      type: 'paragraph',
      text: 'Deze website is een hulpmiddel en vervangt de richtlijn niet. Bij twijfel of verschil is de tekst van de richtlijn leidend.'
    });
    return {
      title: 'Bron en verantwoording',
      meta: title || '',
      sections: [{ blocks: blocks }]
    };
  }

  /* Opent het informatiepaneel met de bron van het zorgpad (treeId leeg) of van een beslisboom. */
  function show(zorgpad, treeId, title, trigger) {
    if (typeof ContentPanel === 'undefined' || !ContentPanel.showData) return;
    ContentPanel.showData(page(resolve(zorgpad, treeId), title), trigger);
  }

  return { resolve: resolve, page: page, show: show };
})();
