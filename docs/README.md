Gynaecologische zorgpaden
Een webapplicatie voor het weergeven van interactieve zorgpaden en beslisbomen voor gynaecologische tumoren.

De applicatie is opgebouwd als een generiek platform. Verschillende tumorsoorten gebruiken dezelfde HTML-pagina en SVG-renderer. De inhoud van de zorgpaden en beslisbomen wordt geladen vanuit afzonderlijke JSON-bestanden.

Live applicatie
De actuele versie is beschikbaar via GitHub Pages:

https://oncoguidealternative.github.io/beslisbomen/

Huidige status
Beschikbaar
Homepage met overzicht van tumorsoorten
Zorgpaden voor tien gynaecologische tumoren (in verschillende stadia van uitwerking)
Navigatie tussen zorgpad en beslisbomen, en tussen opeenvolgende beslisbomen
Zoomen en slepen; toetsenbordbediening van klikbare onderdelen
Interactief kiezen van waarden bij dataknooppunten, in vrije volgorde
Markeren van het gekozen pad en uitfaden van uitgesloten routes
Aanbevelingenoverzicht per beslisboom
Hulpbeslisbomen die een keuze bepalen
Paneel met patiëntinformatie: alle gegevens van een beslisboom invullen vanuit één lijst
Bronvermelding per zorgpad en beslisboom (klik op de titel)
Automatische controle van alle inhoud (tools/check.js, ook op GitHub)
In voorbereiding
Endometriumcarcinoom opnieuw opbouwen op het raster
Bronvermelding voor alle zorgpaden
Technische uitgangspunten
De applicatie gebruikt uitsluitend:

HTML
CSS
JavaScript
SVG
JSON
Er worden geen frameworks, externe bibliotheken, buildtools, backend of database gebruikt. De applicatie kan daardoor rechtstreeks via GitHub Pages worden gepubliceerd.

Projectstructuur
index.html                 homepage
zorgpad.html               zorgpadpagina (overzicht en beslisbomen)

css/
  styles.css

js/
  home.js                  homepage: tumorkaarten
  app.js                   zorgpadpagina: laden, navigatie, keuzes
  state.js                 centrale status (keuzes, viewport)
  graph-state.js           rekenkern: gekozen, bereikt, mogelijk, uitgesloten
  graph-validator.js       controle van de interactiegegevens
  layout-engine.js         posities en lijnen op het raster
  renderer.js              tekenen als SVG
  viewport.js              zoomen, slepen, passend maken
  journey.js               begeleiding naar de volgende stap
  subtrees.js              hulpbeslisbomen
  choice-panel.js          keuzevenster
  patient-panel.js         paneel met patiëntinformatie
  recommendations-panel.js aanbevelingenoverzicht
  bron.js                  bronvermelding
  content-panel.js         informatiepaneel
  breadcrumb.js            kruimelpad

data/
  tumoren.json             lijst van tumoren
  <tumor-id>/zorgpad.json  zorgpad per tumor
  pages/                   inhoudspagina's (over, FAQ, privacy, voorwaarden)

docs/
  interactive-tree-schema.md   het JSON-formaat van een zorgpad
  layout-engine.md             posities en lijnen
  hulpbeslisbomen.md           keuzes via een hulpbeslisboom

tools/
  check.js                 controle van alle inhoud: node tools/check.js

.github/workflows/check.yml    draait de controle bij elke wijziging op GitHub

Publiceren
Verhoog bij elke publicatie het versienummer ?v=… in index.html en zorgpad.html (alle regels tegelijk),
zodat bezoekers de nieuwe versie krijgen in plaats van een oude uit hun browsercache.
