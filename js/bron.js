/* Bron en onderbouwing, getoond in het informatiepaneel (ContentPanel).

   - Klik op de titel van het zorgpad (overzicht): "Bron en verantwoording" van het hele zorgpad.
   - Klik op de titel van een beslisboom: "Onderbouwing" van die beslisboom.

   Gegevens in data/<tumor>/zorgpad.json:

     "bron": {                         // voor het hele zorgpad
       "richtlijn": "Vulvacarcinoom",
       "organisatie": "NVOG",
       "publicatiedatum": "2021-11-22",
       "beoordeeldOp": "2021-12-30",    // beoordeeld op geldigheid (door de richtlijnorganisatie)
       "versie": "…",                   // optioneel
       "url": "https://richtlijnendatabase.nl/…",
       "bijgewerkt": "2026-10-30",      // wanneer dit zorgpad op deze website is gecontroleerd tegen de richtlijn
       "opmerking": "…"                 // optioneel
     }

     "trees": { "<boom-id>": {
       "onderbouwing": "Tekst. Een lege regel begint een nieuwe alinea.",
         // of uitgebreider, met dezelfde bloktypes als de pagina's in data/pages:
         // "onderbouwing": { "blocks": [ { "type": "paragraph", "text": "…" }, … ] }
         // of met kopjes: "onderbouwing": { "sections": [ { "title": "…", "blocks": [ … ] } ] }
       "bron": { "module": "Aanvullende diagnostiek", "url": "https://…" },   // optioneel: de module van de richtlijn
       …
     } }

   Datums in de vorm jjjj-mm-dd; ze worden getoond als dd-mm-jjjj.
   Bevat zelf geen medische inhoud en raakt het diagram niet aan. */
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

  const EMPTY_TEXT = 'Voor deze beslisboom is nog geen onderbouwing toegevoegd.';

  function isObject(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

  function formatDate(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
    return m ? m[3] + '-' + m[2] + '-' + m[1] : String(value);
  }

  function isSafeUrl(url) {
    return typeof url === 'string' && /^https?:\/\//i.test(url);
  }

  // De boom zelf, of bij een hergebruikte boom ("same") zijn bronboom als die het gevraagde veld heeft.
  function treeField(zorgpad, treeId, field) {
    const trees = (zorgpad && zorgpad.trees) || {};
    const tree = treeId ? trees[treeId] : null;
    if (!tree) return undefined;
    if (tree[field] !== undefined) return tree[field];
    if (tree.same && trees[tree.same]) return trees[tree.same][field];
    return undefined;
  }

  /* De bron voor een boom: die van het zorgpad, aangevuld of overschreven door die van de boom. */
  function resolve(zorgpad, treeId) {
    const base = isObject(zorgpad && zorgpad.bron) ? zorgpad.bron : {};
    const own = treeField(zorgpad, treeId, 'bron');
    return Object.assign({}, base, isObject(own) ? own : {});
  }

  /* De vaste melding bovenaan het paneel, met "richtlijn" als link naar de richtlijn (als die bekend is). */
  function notice(bron) {
    return {
      before: 'Deze website is een hulpmiddel en vervangt de ',
      linkText: 'richtlijn',
      href: isSafeUrl(bron.url) ? bron.url : '',
      after: ' niet. Bij twijfel of verschil is de tekst van de richtlijn leidend.'
    };
  }

  /* "Bron en verantwoording" van het zorgpad. title: naam van het zorgpad. */
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
      blocks.push({ type: 'paragraph', text: 'Voor dit zorgpad is nog geen bron vastgelegd.' });
    }
    if (bron.opmerking) blocks.push({ type: 'paragraph', text: String(bron.opmerking) });
    if (isSafeUrl(bron.url)) {
      blocks.push({ type: 'paragraph', text: 'Lees de volledige tekst bij de bron:', links: [{ href: bron.url, label: 'Open de richtlijn' }] });
    }
    return {
      title: 'Bron en verantwoording',
      meta: title || '',
      notice: notice(bron),
      sections: [{ blocks: blocks }]
    };
  }

  /* De onderbouwing van een boom als secties voor het paneel, of null als er (nog) geen is. */
  function onderbouwingSections(value) {
    if (typeof value === 'string' && value.trim()) {
      return [{
        blocks: value.split(/\n\s*\n/).map(function (t) { return t.trim(); }).filter(Boolean)
          .map(function (t) { return { type: 'paragraph', text: t }; })
      }];
    }
    if (isObject(value) && Array.isArray(value.sections) && value.sections.length) return value.sections;
    if (isObject(value) && Array.isArray(value.blocks) && value.blocks.length) return [{ blocks: value.blocks }];
    return null;
  }

  /* "Onderbouwing" van een beslisboom. title: naam van de beslisboom en het zorgpad. */
  function onderbouwingPage(zorgpad, treeId, title) {
    const bron = resolve(zorgpad, treeId);
    let sections = onderbouwingSections(treeField(zorgpad, treeId, 'onderbouwing'));
    if (!sections) {
      // Nog geen onderbouwing: een vaste tekst, en waar mogelijk de weg naar de richtlijn.
      const blocks = [{ type: 'paragraph', text: EMPTY_TEXT }];
      if (isSafeUrl(bron.url)) {
        blocks.push({ type: 'paragraph', text: 'De volledige tekst staat in de richtlijn:', links: [{ href: bron.url, label: bron.module ? 'Module ' + bron.module : 'Open de richtlijn' }] });
      }
      sections = [{ blocks: blocks }];
    } else if (bron.module || isSafeUrl(bron.url)) {
      // Met onderbouwing: onderaan de bron (de module van de richtlijn, als die is opgegeven).
      const label = bron.module ? 'Module ' + bron.module : 'Open de richtlijn';
      sections = sections.concat([{
        title: 'Bron',
        blocks: [isSafeUrl(bron.url)
          ? { type: 'paragraph', text: (bron.richtlijn ? 'Richtlijn ' + bron.richtlijn + '.' : ''), links: [{ href: bron.url, label: label }] }
          : { type: 'paragraph', text: label }]
      }]);
    }
    return {
      title: 'Onderbouwing',
      meta: title || '',
      notice: notice(bron),
      sections: sections
    };
  }

  /* Opent het informatiepaneel: de bron van het zorgpad (treeId leeg) of de onderbouwing van een beslisboom. */
  function show(zorgpad, treeId, title, trigger) {
    if (typeof ContentPanel === 'undefined' || !ContentPanel.showData) return;
    const data = treeId ? onderbouwingPage(zorgpad, treeId, title) : page(resolve(zorgpad, null), title);
    ContentPanel.showData(data, trigger);
  }

  return { resolve: resolve, page: page, onderbouwingPage: onderbouwingPage, show: show };
})();
