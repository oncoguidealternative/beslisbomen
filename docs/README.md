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
Aanbevelingenoverzicht per beslisboom (ook te openen door op een aanbeveling in de boom te klikken; klapt vanzelf open als het pad compleet is en nog maar één aanbeveling over is)
Hulpbeslisbomen die een keuze bepalen
Overgang bij een klik op een vervolgboom: de huidige boom schuift omhoog weg, de volgende komt van onderen
Nieuwe keuze wist de oranje markering uit het aanbevelingenoverzicht
Paneel met patiëntinformatie: alle gegevens van een beslisboom invullen vanuit één lijst
Bronvermelding per zorgpad en beslisboom (klik op de titel)
Keuzes in de link: een link opent precies hetzelfde pad, en keuzes blijven bewaard bij verversen
Kopieer samenvatting (gegevens, aanbeveling, bron en link) en kopieer link, in het aanbevelingenoverzicht
Bron (richtlijn, module, beoordelingsdatum) linksonder in beeld en onderaan het aanbevelingenoverzicht
Per aanbeveling "Klopt dit niet? Meld het": opent een vooraf ingevulde melding op GitHub
Zoomknoppen (inzoomen, uitzoomen, passend maken, beginweergave); grotere beginweergave op brede schermen; zorgpadoverzicht zo veel mogelijk passend
Een bereikte aanbeveling komt na een keuze in beeld, ook als het aanbevelingenoverzicht open staat; van een lange aanbeveling het begin
Balk "Volgende vraag" onderin met de opties als knoppen; sneltoetsen 1 t/m 9 om te kiezen, Backspace om de laatste keuze ongedaan te maken
Gegevens uit eerdere beslisbomen van hetzelfde zorgpad worden voorgesteld om over te nemen (altijd na bevestiging)
Op een breed scherm (vanaf 1600 px) staat het aanbevelingenoverzicht naast het diagram, ook tegelijk met Patiëntinformatie
Zoeken over alle beslisbomen (startpagina en kop), Recent geopend op de startpagina; 'In voorbereiding' bij een zorgpad zonder beslisbomen
Uitleg in drie stappen bij het eerste bezoek aan een beslisboom (later terug te halen via Uitleg in de kop)
Gebruiksvoorwaarden: na "Begrepen" verdwijnt de balk onderaan en staan de voorwaarden als link in de kop
Automatische controle van alle inhoud (tools/check.js, ook op GitHub); ontbrekende inhoud (onderbouwing, bron) staat apart onder "Nog te doen"
Automatische controle van alle routes: elke combinatie van keuzes eindigt bij een aanbeveling (mobiel/tools/check-flow.js, ook op GitHub)
Automatische controle of alle tekst in de blokken past (tools/check-tekst.js, ook op GitHub)
Automatische controle van het raster: maten van blokken en afstanden (tools/check-raster.js, ook op GitHub)
In voorbereiding
Bronvermelding voor de overige zorgpaden (cervixcarcinoom, endometriumcarcinoom en vulvacarcinoom hebben er al een)
Varianten en experimenten
Alles staat in één repository, met één set inhoud (data/) en één rekenkern (js/graph-state.js):

index.html, zorgpad.html   hoofdsite met de beslisbomen
mobiel/                    experimentele mobiele weergave: zorgpaden als vragenlijst (zie mobiel/README.md)
lab/                       losse experimenten (zie lab/README.md)

GitHub Pages publiceert elke map op een eigen adres, bijvoorbeeld https://oncoguidealternative.github.io/beslisbomen/mobiel/

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
  summary.js               samenvatting, bronregel en link voor een melding
  stage-tools.js           zoomknoppen en bronregel op het werkvlak
  next-step.js             balk met de volgende vraag en sneltoetsen
  carry-over.js            gegevens uit eerdere bomen voorstellen om over te nemen
  search.js                zoeken over alle beslisbomen
  recent.js                recent geopende beslisbomen
  help.js                  uitleg bij het eerste bezoek; balk met de gebruiksvoorwaarden
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
  oncoguide-import.md          een zorgpad overnemen uit Oncoguide

tools/
  check.js                 controle van alle inhoud: node tools/check.js
  check-tekst.js           controle in een echte browser of alle tekst in de blokken past: node tools/check-tekst.js
  check-raster.js          controle of alle blokken en afstanden het standaardraster volgen: node tools/check-raster.js
  check-witruimte.js       aanbevelingen met te veel witruimte vinden en passend maken: node tools/check-witruimte.js [--fix]
  oncoguide/               een zorgpad overnemen uit Oncoguide (zie docs/oncoguide-import.md)

.github/workflows/check.yml    draait de controle bij elke wijziging op GitHub

Publiceren
Verhoog bij elke publicatie het versienummer ?v=… in index.html en zorgpad.html (alle regels tegelijk),
zodat bezoekers de nieuwe versie krijgen in plaats van een oude uit hun browsercache.
