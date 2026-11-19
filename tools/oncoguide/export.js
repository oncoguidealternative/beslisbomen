/* Exporteert een project uit Oncoguide als JSON-bestand, voor tools/oncoguide/convert.js.

   Gebruik:
     1. Open het project op https://oncoguide.nl (bijv. https://oncoguide.nl/#!/projects/53/tree/10491)
        en wacht tot de beslisboom zichtbaar is.
     2. Open de ontwikkelaarsconsole (F12 → Console), plak de inhoud van dit bestand en druk op Enter.
     3. De browser downloadt "oncoguide-<project>.json". Zet dat bestand in de map tools/oncoguide/exports/
        en maak een configuratie in tools/oncoguide/configs/ (zie docs/oncoguide-import.md).

   Het script leest alleen de gegevens die de pagina al heeft geladen; het verandert niets in Oncoguide. */
(function () {
  var m = /projects\/(\d+)/.exec(location.hash);
  if (!m) throw new Error('Open eerst een project in Oncoguide (de adresbalk moet "projects/<nummer>" bevatten).');
  var projectId = m[1];
  var svc = angular.element(document.body).injector().get('oncoService');
  var pub = svc.cache && svc.cache[projectId] && svc.cache[projectId][0];
  if (!pub) throw new Error('De gegevens van project ' + projectId + ' zijn nog niet geladen. Wacht tot de boom zichtbaar is.');
  var d = pub.data;
  // Opmaak (style/class) weglaten: die is niet nodig en maakt het bestand veel groter
  var clean = function (h) {
    return String(h || '').replace(/\s(style|class|target|rel)="[^"]*"/g, '').replace(/<\/?(span|strong|em|b|u)>/g, '');
  };
  var out = {
    source: {
      site: 'oncoguide.nl', project: Number(projectId), name: d.projectName,
      publishID: pub.publishID, publishDate: pub.publishDate, exported: new Date().toISOString()
    },
    dataitems: d.dataitems.map(function (x) {
      return {id: x.id, name: x.name, unit: x.unit, type: x.type,
        values: x.values.map(function (v) { return {id: v.id, name: v.name, index: v.index}; })};
    }),
    trees: d.trees.map(function (t) {
      return {
        id: t.id, name: t.name, type: t.type, dataItemID: t.dataItemID, rootID: t.rootID,
        isMenuTree: t.isMenuTree, inOverview: t.inOverview, information: clean(t.information),
        nodes: t.nodes.map(function (n) {
          return {id: n.id, name: n.name, left: n.pos.left, top: n.pos.top, type: n.type,
            dataItem: n.dataItem, referenceId: n.referenceId, projectId: n.projectId, ranges: n.ranges};
        }),
        connections: t.connections.map(function (c) {
          return {source: c.sourceNodeID, target: c.targetNodeID, name: c.name || '', ranges: c.ranges};
        })
      };
    })
  };
  var blob = new Blob([JSON.stringify(out, null, 1)], {type: 'application/json'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'oncoguide-' + projectId + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  console.log('Geëxporteerd: ' + d.projectName + ' (' + out.trees.length + ' bomen)');
  return out;
})();
