# Schema van een zorgpad en zijn beslisbomen

Dit document beschrijft hoe een zorgpad in JSON wordt vastgelegd: de blokken (nodes), de verbindingen (edges), de keuzes die een gebruiker kan maken en de bronvermelding. Alle zorgpaden gebruiken hetzelfde formaat. De website, de validator en het controlescript (`tools/check.js`) gaan hiervan uit.

Verwante documenten:
- [`layout-engine.md`](layout-engine.md): hoe posities, afstanden en lijnen worden berekend
- [`hulpbeslisbomen.md`](hulpbeslisbomen.md): een keuze laten bepalen door een aparte, kleinere beslisboom

---

## 1. Bestanden

| Bestand | Inhoud |
|---|---|
| `data/tumoren.json` | De lijst van tumoren op de homepage |
| `data/<tumor-id>/zorgpad.json` | Het zorgpad van één tumor: het overzicht en alle beslisbomen |

In `tumoren.json`:

```json
{
  "tumoren": [
    { "id": "vulva", "titel": "Vulvacarcinoom", "afbeelding": "images/Gynaecologie_vierkant.png", "status": "available" }
  ]
}
```

- `id`: alleen kleine letters, cijfers, `-` en `_`. Moet **exact** gelijk zijn aan de mapnaam onder `data/`.
- `status`: `"available"` maakt de kaart klikbaar. Elke andere waarde toont "wordt later toegevoegd".

---

## 2. Opbouw van `zorgpad.json`

```json
{
  "id": "vulva",
  "titel": "Zorgpad vulvacarcinoom",
  "bron": { … },
  "overview": { … },
  "trees": {
    "aanvullend": { … },
    "primair": { … }
  }
}
```

| Veld | Verplicht | Betekenis |
|---|---|---|
| `id` | ja | Gelijk aan de mapnaam en het id in `tumoren.json` |
| `titel` | ja | Naam van het zorgpad (kruimelpad, paginatitel) |
| `bron` | aanbevolen | Bronvermelding, zie §7 |
| `overview` | ja | Het overzicht: de stappen van het zorgpad |
| `trees` | nee | De beslisbomen, met als sleutel het boom-id |

Het overzicht en elke beslisboom zijn een **graph** met dezelfde opbouw (§3).

---

## 3. Een graph (overzicht of beslisboom)

```json
{
  "layout": { "unit": 5, "blockWidth": 40, "blockHeight": 20, "margin": 10 },
  "nodes": [ … ],
  "edges": [ … ]
}
```

| Veld | Betekenis |
|---|---|
| `layout` | Het raster. `unit` = pixels per rasterhokje, `blockWidth`/`blockHeight` = standaardblok in hokjes. Zie `layout-engine.md`. |
| `nodes` | De blokken |
| `edges` | De verbindingen tussen blokken |
| `wrap` | Optioneel: maximaal aantal tekens per regel bij automatisch afbreken |
| `same` | Optioneel: `"same": "<boom-id>"` hergebruikt een andere boom (zelfde tekening, eigen keuzes). Een boom met `same` heeft geen eigen `nodes`. |
| `bron` | Optioneel: bronvermelding van deze boom (vult die van het zorgpad aan) |

**Eén manier van tekenen.** Posities staan altijd op het raster (`gridX`/`gridY`). Gebruik geen `x`/`y`, `viewBox`, `nodeSize` of `gridSizeX`. De layout-engine rekent die zelf uit. Het controlescript waarschuwt als je dat toch doet.

---

## 4. Nodes

```json
{ "id": "tumorgedrag", "type": "dataItem", "label": "Tumorgedrag", "gridX": 115, "gridY": 32 }
```

### Velden voor alle nodes

| Veld | Betekenis |
|---|---|
| `id` | Uniek binnen de graph. Wordt gebruikt in edges, keuzes en de URL; **wijzig het niet** zonder alle verwijzingen mee te wijzigen. |
| `type` | Zie hieronder |
| `gridX`, `gridY` | Positie linksboven, in rasterhokjes |
| `width`, `height` | Optioneel: afmeting in hokjes (anders `blockWidth` × `blockHeight`) |
| `label` | Korte tekst (één regel, wordt automatisch afgebroken) |
| `text` | Langere tekst met eigen regels (`\n`). Heeft voorrang op `label` voor de weergave. |
| `items` | Optioneel: lijst `[{ "text": "…" }]`, getoond met "EN" ertussen |
| `tone`, `icon`, `rx`, `wrap` | Optioneel: opmaak (kleur, icoon, afronding, regellengte) |

**Opmaakcodes in `text`:**
- `{i}` aan het begin van een regel: info-icoon
- `{x}` aan het begin van een regel: "geen"-symbool (doorgestreepte cirkel)
- `{a:tekst|url}`: een link
- Een lege regel scheidt blokken; een regel met alleen `---` werkt als scheiding

### Types

| Type | Betekenis | Op de website |
|---|---|---|
| `title` | Titel van het zorgpad of de beslisboom | Zorgpad: een klik toont de **bronvermelding** (§7). Beslisboom: een klik toont de **onderbouwing** (§7b); het min-icoon brengt je terug naar het overzicht. |
| `dataItem` | Een gegeven of vraag (bv. "Tumorgedrag") | Met `interactive: true` een keuze, zie §6 |
| `recommendation` | Een aanbeveling (uitkomst) | Wordt groen als de route ernaartoe is gekozen |
| `reference` | Verwijzing naar een volgende beslisboom | Klikbaar, met pijl-icoon |
| `decision` | Statisch blok met een opsomming | Alleen tekst |

De oudere namen `root`/`start`, `criterion`, `outcome` en `link` werken ook. Gebruik in nieuwe bestanden de namen uit de tabel.

### Navigatie

| Veld | Betekenis |
|---|---|
| `"drill": true` | In het overzicht: een klik opent de beslisboom met **hetzelfde id** als deze node |
| `"to": "<boom-id>"` | Een klik opent die beslisboom. `"to": ""` = terug naar het overzicht. |
| `"tumor": "<tumor-id>"` (+ `"tree"`) | Een klik opent het zorgpad (en eventueel een boom) van een **andere** tumor |

Verwijst een stap naar een boom die nog niet bestaat, dan toont de website "de beslisboom van deze stap is nog niet toegevoegd". Dat is toegestaan; het controlescript meldt het als waarschuwing.

---

## 5. Edges (verbindingen)

```json
{
  "id": "edge-tumorgedrag-maligne",
  "from": "tumorgedrag",
  "to": "histo",
  "value": "maligne",
  "label": "Maligne",
  "points": [[780, 210], [1185, 210], [1185, 315]],
  "dot": [925, 210],
  "arrow": true
}
```

| Veld | Verplicht | Betekenis |
|---|---|---|
| `id` | ja | Uniek binnen de graph. Gebruik `edge-<from>-<waarde>`. |
| `from`, `to` | ja | Id's van de begin- en eindnode |
| `value` | bij een keuze | De waarde van de optie die deze verbinding kiest (§6) |
| `label` | nee | Tekst bij de verbinding (bv. "Maligne"); met `dot` wordt het een klikbare connector |
| `points` | nee | Het lijnverloop in pixels. Ontbreekt het, dan tekent de layout-engine een rechte route. |
| `selectedPoints` | nee | Ander lijnverloop als de verbinding gekozen is |
| `dot` | nee | Positie van het klikbare bolletje |
| `arrow` | nee | Pijlpunt aan het eind |

**Samenvloeiende lijnen.** Een lijn die op een andere lijn uitkomt (in plaats van op een blok) krijgt toch `from` en `to`: het blok waar de route vandaan komt en het blok waar die uiteindelijk heen gaat. Zo blijft voor de website duidelijk welke stappen met elkaar verbonden zijn.

---

## 6. Keuzes (interactieve nodes)

Een `dataItem` wordt een keuze met `interactive: true` en een lijst `options`. Elke optie hoort bij precies één uitgaande edge.

```json
{
  "id": "tumorgedrag",
  "type": "dataItem",
  "label": "Tumorgedrag",
  "gridX": 115, "gridY": 32,
  "interactive": true,
  "options": [
    { "value": "benigne", "label": "Benigne", "edge": "edge-tumorgedrag-benigne" },
    { "value": "in-situ", "label": "In situ", "edge": "edge-tumorgedrag-in-situ" },
    { "value": "maligne", "label": "Maligne", "edge": "edge-tumorgedrag-maligne" }
  ]
}
```

### Regels (gecontroleerd door de validator)

1. Elke optie heeft een unieke `value`, een `label` en een `edge`.
2. Die edge bestaat, heeft `from` gelijk aan deze node en `value` gelijk aan de `value` van de optie.
3. Elke optie heeft precies één edge. Meestal hoort een edge ook bij precies één optie. Leiden meerdere opties naar dezelfde plek, dan delen ze één edge met een **lijst** van waarden:

   ```json
   "options": [
     { "value": "0", "label": "0", "edge": "edge-cn-0" },
     { "value": "1", "label": "1", "edge": "edge-cn-1-2" },
     { "value": "2", "label": "2", "edge": "edge-cn-1-2" },
     { "value": "3", "label": "3", "edge": "edge-cn-3" }
   ]
   …
   { "id": "edge-cn-1-2", "from": "cn", "to": "ct-r", "value": ["1", "2"], "label": "1,2", … }
   ```

   In het keuzevenster en het paneel staan dan vier aparte waarden. De connector "1,2" wordt groen bij 1 én bij 2; een klik op die connector opent het keuzevenster om 1 of 2 te kiezen.
4. De keuzenode is vanaf de titel bereikbaar via edges met `id`, `from` en `to`.
5. Een `recommendation` heeft nooit `options`.

Klopt iets niet, dan wordt de boom **wel getekend**, maar blijft die node statisch (niet klikbaar). De melding staat in de browserconsole (F12) en in de uitvoer van `tools/check.js`.

### Gedrag op de website

- **Kiezen kan op drie manieren:** via het keuzevenster (klik op de node), door direct op een connector te klikken, of in het paneel met patiëntinformatie (zie hieronder). Alle drie gebruiken hetzelfde selectiepad en blijven altijd gelijk.
- **Vrije volgorde:** elke keuze die nog mogelijk is, kan worden ingevuld, ook als eerdere stappen nog leeg zijn. Zo'n vooruit ingevulde keuze is groen met een stippelrand. Zodra de eerdere keuzes de route ernaartoe leggen, wordt het een gewone gekozen stap.
- **Uitsluiten:** maakt een keuze een andere keuze onmogelijk, dan wordt die andere keuze gewist. De melding noemt welke.
- **Statussen** (CSS-klassen in de tekening): `is-selected` (op de gekozen route), `is-preselected` (alvast ingevuld), `is-available` (volgende stap), `is-inactive` (nog niet bereikt), `is-excluded` (niet meer mogelijk, vervaagd).
- **Aanbevelingen:** de knop "Aanbevelingen (n)" toont per aanbeveling welke combinaties van keuzes ertoe leiden. Dat wordt volledig afgeleid uit de edges; er staat geen medische logica in de code.

### Meetwaarden

Een gegeven dat een **meting** is (diameter, invasiediepte, lineaire extensie) vul je in als getal in plaats van te kiezen uit een lijst. Geef de keuzenode daarvoor `measure` met de eenheid, en elke optie een **bereik**:

```json
{
  "id": "diameter-tumor", "type": "dataItem", "label": "Diameter (tumor)", "interactive": true,
  "measure": { "unit": "mm" },
  "options": [
    { "value": "lte-20-mm", "label": "<=20 mm",  "edge": "edge-…", "lte": 20 },
    { "value": "20-40-mm",  "label": "20-40 mm", "edge": "edge-…", "gt": 20, "lte": 40 },
    { "value": "gt-40-mm",  "label": ">40 mm",   "edge": "edge-…", "gt": 40 }
  ]
}
```

- Bereiken met `gt` (>), `gte` (>=), `lt` (<) en `lte` (<=), altijd in de eenheid van `measure`. Een label als "<=4 cm" kan dus gewoon blijven staan, met `"lte": 40` bij eenheid mm.
- Een klik op de node of op een van zijn connectoren opent een invoerveld met de eenheid. Na Enter kiest de site zelf het bereik waarin het getal valt. Een komma als decimaalteken mag (4,5).
- Nodes met hetzelfde gegeven en dezelfde eenheid in de boom krijgen elk hun **eigen** bereik voor hetzelfde getal: 32 mm wordt "20-40 mm" in de ene tak en "<=4 cm" in de andere.
- Valt het getal buiten alle bereiken van de gekozen node, dan meldt het venster dat en wordt er niets ingevuld.
- In het paneel met patiëntinformatie staat bij zo'n gegeven ook een invoerveld; de regel toont het getal met eenheid.
- De validator controleert dat elke optie een bereik heeft en dat bereiken elkaar niet overlappen, en waarschuwt bij een gat tussen twee bereiken.

### Paneel met patiëntinformatie

Links naast elke beslisboom met keuzes staat een in- en uitklapbaar paneel met alle gegevens die in die boom kunnen worden ingevuld. Het paneel wordt **automatisch** opgebouwd uit de keuzenodes; er is geen extra JSON nodig.

- **Volgorde:** van boven naar beneden zoals de boom loopt (vanaf de titel langs de verbindingen).
- **Eén gegeven, overal gelijk:** dit geldt niet alleen in het paneel. Ook een keuze in het keuzevenster, via een connector of vanuit een hulpbeslisboom wordt ingevuld in elke node met hetzelfde gegeven die die waarde kent. Kent een andere node de waarde niet (bijvoorbeeld "cT" met een andere indeling), dan wordt de oude waarde daar gewist, zodat er nooit twee tegenstrijdige waarden voor hetzelfde gegeven staan. Wissen geldt ook voor alle nodes van het gegeven.
- **Eén gegeven, meerdere takken:** komt hetzelfde gegeven in meerdere takken voor (bijvoorbeeld "Eerdere behandeling primaire tumor" onder zowel "Lokaal" als "Regionaal"), dan is dat één regel in het paneel. Een waarde die je daar kiest, wordt ingevuld in elke tak waar die waarde bestaat. Takken die later afvallen, worden vanzelf gewist.
- **Wanneer is het hetzelfde gegeven?** Standaard bij hetzelfde `label`. Verschillen de labels, of wil je juist twee gegevens met hetzelfde label apart houden, geef de nodes dan een `dataKey`:

```json
{ "id": "eerdere-beh-lokaal", "type": "dataItem", "label": "Eerdere behandeling primaire tumor",
  "dataKey": "eerdere-behandeling", "interactive": true, "options": [ … ] }
```

- Gegevens die door eerdere keuzes niet meer van toepassing zijn, staan grijs en zijn niet te kiezen. Dat geldt ook voor waarden die alleen in een uitgesloten tak voorkomen.
- Heeft een gegeven een hulpbeslisboom, dan staat er een knop **Bepalen met hulpbeslisboom**.
- Of het paneel open of dicht staat, onthoudt de browser van de gebruiker.

### Hulpbeslisboom

Een keuze kan worden bepaald door een aparte, kleinere beslisboom (`subtree`). Zie [`hulpbeslisbomen.md`](hulpbeslisbomen.md).

---

## 7. Bronvermelding

Elk zorgpad heeft een `bron`. Een klik op de titel van het zorgpad of van een beslisboom toont die in het informatiepaneel.

```json
"bron": {
  "richtlijn": "Vulvacarcinoom",
  "organisatie": "NVOG (Nederlandse Vereniging voor Obstetrie en Gynaecologie)",
  "publicatiedatum": "2021-11-22",
  "beoordeeldOp": "2021-12-30",
  "versie": "…",
  "url": "https://richtlijnendatabase.nl/richtlijn/vulvacarcinoom/…",
  "bijgewerkt": "2026-10-30",
  "opmerking": "…"
}
```

| Veld | Betekenis |
|---|---|
| `richtlijn` | Naam van de richtlijn |
| `organisatie` | Initiatiefnemer of eigenaar |
| `publicatiedatum` | Publicatiedatum van de richtlijn |
| `beoordeeldOp` | Datum waarop de richtlijn op geldigheid is beoordeeld |
| `versie` | Versie, als de richtlijn die noemt |
| `url` | Link naar de richtlijn (https) |
| `bijgewerkt` | Datum waarop **dit zorgpad op de website** is gecontroleerd tegen de richtlijn |
| `opmerking` | Vrije toelichting |
| `module` | Alleen bij een beslisboom: de module van de richtlijn |

Alle velden zijn optioneel. Datums schrijf je als `jjjj-mm-dd`; de website toont `dd-mm-jjjj`.

Een beslisboom kan een eigen `bron` hebben. Die **vult de bron van het zorgpad aan**: je hoeft alleen op te geven wat anders is, bijvoorbeeld de module en de link daarnaar.

```json
"trees": {
  "aanvullend": {
    "bron": { "module": "Aanvullende diagnostiek", "url": "https://richtlijnendatabase.nl/…" },
    "layout": { … }, "nodes": [ … ], "edges": [ … ]
  }
}
```

---

## 7b. Onderbouwing per beslisboom

Een klik op de titel van een **beslisboom** opent het paneel **Onderbouwing**. (De titel van het **zorgpad** in het overzicht opent "Bron en verantwoording", zie §7, en heeft als enige een ⓘ-icoon.)

Bovenaan dat paneel staat altijd de melding dat de website een hulpmiddel is en de richtlijn leidend is. Het woord "richtlijn" linkt naar de `url` uit de bron.

De onderbouwing zet je in de boom zelf, in het veld `onderbouwing`:

```json
"trees": {
  "aanvullend": {
    "onderbouwing": "Eerste alinea.\n\nTweede alinea, na een lege regel.",
    "bron": { "module": "Aanvullende diagnostiek", "url": "https://richtlijnendatabase.nl/…" },
    "layout": { … }, "nodes": [ … ], "edges": [ … ]
  }
}
```

- **Gewone tekst:** een lege regel (`\n\n`) begint een nieuwe alinea.
- **Uitgebreider:** dezelfde bloktypes als de pagina's in `data/pages` (`paragraph`, `definitionList`, `groupedList`, met links):
  ```json
  "onderbouwing": { "blocks": [ { "type": "paragraph", "text": "…", "links": [ { "href": "https://…", "label": "…" } ] } ] }
  ```
- **Met kopjes:** `"onderbouwing": { "sections": [ { "title": "Overwegingen", "blocks": [ … ] } ] }`
- Staat er in de boom een `bron` met `module` en/of `url`, dan verschijnt onderaan een kopje **Bron** met een link naar die module.
- **Nog geen onderbouwing?** Dan toont het paneel: *"Voor deze beslisboom is nog geen onderbouwing toegevoegd."*, met een link naar de richtlijn (of de module) als die bekend is.

Het controlescript meldt per zorgpad hoeveel beslisbomen nog geen onderbouwing hebben, zodat je kunt zien hoe ver je bent.

## 8. Controleren

Voer na elke wijziging uit, vanuit de hoofdmap van de repository:

```
node tools/check.js
```

Op GitHub gebeurt dit automatisch bij elke commit (groen vinkje of rood kruisje). Fouten moeten worden opgelost. Waarschuwingen zijn aandachtspunten, zoals nog ontbrekende bomen of bronnen.

In de browser zie je dezelfde meldingen in de console (F12), met de voorvoegsels `[GraphValidator]` en `[LayoutEngine]`.

