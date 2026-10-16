Gynaecologische zorgpaden
Een webapplicatie voor het weergeven van interactieve zorgpaden en beslisbomen voor gynaecologische tumoren.

De applicatie is opgebouwd als een generiek platform. Verschillende tumorsoorten gebruiken dezelfde HTML-pagina en SVG-renderer. De inhoud van de zorgpaden en beslisbomen wordt geladen vanuit afzonderlijke JSON-bestanden.

Live applicatie
De actuele versie is beschikbaar via GitHub Pages:

https://oncoguidealternative.github.io/beslisbomen/

Huidige status
Beschikbaar
Homepage met overzicht van tumorsoorten
Zorgpad vulvacarcinoom
Onderliggende beslisbomen voor vulvacarcinoom
Navigatie tussen zorgpad en beslisbomen
Navigatie tussen opeenvolgende beslisbomen
Zoomfunctie voor grote beslisbomen
Horizontaal scrollen bij brede beslisbomen
Toetsenbordbediening van klikbare onderdelen
Generieke zorgpadpagina voor meerdere tumorsoorten
In voorbereiding
Zorgpad endometriumcarcinoom
Interactief kiezen van waarden bij dataknooppunten
Markeren van het gekozen pad
Uitfaden van uitgesloten routes
Paneel met patiëntinformatie
Synchronisatie tussen beslisboom en patiëntinformatiepaneel
Technische uitgangspunten
De applicatie gebruikt uitsluitend:

HTML
CSS
JavaScript
SVG
JSON
Er worden geen frameworks, externe bibliotheken, buildtools, backend of database gebruikt. De applicatie kan daardoor rechtstreeks via GitHub Pages worden gepubliceerd.

Projectstructuur
index.html
zorgpad.html

css/
  styles.css

js/
  app.js
  renderer.js
  state.js

data/
  tumoren.json

  vulva/
    zorgpad.json

  endometrium/
    zorgpad.json
