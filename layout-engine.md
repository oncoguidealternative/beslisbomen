Layout-engine
Met de layout-engine beschrijf je een zorgpad of beslisboom met relaties tussen blokken. De positie (x, y),
de afstanden, de uitlijning en de verbindingslijnen worden automatisch berekend. De bestaande manieren om
te positioneren blijven werken en kunnen door elkaar worden gebruikt.
Bestanden: `js/layout-engine.js` (de berekening, zonder DOM) en `js/renderer.js` (roept de engine aan).
Voorbeeld: `data/layout-voorbeeld/zorgpad.json`.
1. Drie manieren om een blok te plaatsen
Prioriteit van hoog naar laag:
Model	Velden	Betekenis
Absoluut	`x`, `y`	SVG-eenheden (pixels), zoals voorheen
Raster	`gridX`, `gridY`	Rasterhokjes. 1 hokje = `layout.unit` pixels
Relatie	`below`, `rightOf`, `childOf`, `recommendationOf`	Afhankelijk van een ander blok (id)
Een zorgpad zonder `layout`, `gridX/gridY` of relaties wordt niet aangeraakt: de engine geeft dan dezelfde graph
terug en de weergave is identiek aan voorheen. Een blok mag maar één relatie hebben.
2. Layoutmodel
```json
"layout": {
  "unit": 25,
  "blockWidth": 8,
  "blockHeight": 4,
  "horizontalGap": 1,
  "titleGap": 2,
  "itemGap": 4,
  "recommendationGap": 2,
  "margin": 2
}
```
Alle velden zijn optioneel; hierboven staan de standaardwaarden. Alle afstanden zijn in rasterhokjes.
Een afstand is de vrije ruimte tussen de randen van twee blokken.
Standaardblok: 8 hokjes breed en 4 hoog (bij `unit` 25: 200 × 100 px).
`unit`: pixels per hokje. Ontbreekt `unit` maar staat er een `nodeSize`, dan is `unit = nodeSize[0] / blockWidth`.
`nodeSize`: wordt afgeleid uit `blockWidth × blockHeight × unit` als het ontbreekt.
`viewBox`: wordt afgeleid uit de inhoud plus `margin` hokjes rondom als het ontbreekt (dan wordt alles zo verschoven
dat de marge links en boven klopt). Een expliciete `viewBox` wordt nooit verschoven.
Een blok mag een eigen `width` en `height` hebben (in hokjes) en een eigen `gap` (in hokjes) die de standaardafstand overschrijft.
3. Nodetypes
Layout-rol	Type in de JSON	Wordt in de renderer
Beslisboomtitel	`title` (of `root`, `start`)	`root` in een boom (blauwe pil, min-icoon, terug naar overzicht), `start` in het overzicht
Data-item	`dataItem` (of `item`, `criterion`)	`criterion`
Aanbeveling	`recommendation` (of `outcome`)	`outcome`
Verwijzing naar volgende beslisboom	`reference` (of `link`)	`link` met pijl-icoon
De bestaande namen (`root`, `criterion`, `outcome`, `link`) blijven gewoon werken. De nieuwe namen worden bij het
laden omgezet (`LayoutEngine.normalize`), zodat renderer, validator en route-engine dezelfde types zien.
Velden die je zelf opgeeft (zoals `tone`, `icon`, `to`) winnen van de standaardwaarden.
4. Relaties
Relatie	Plaatsing
`below: "id"`	Onder dat blok, horizontaal midden op midden. Met een verbinding.
`rightOf: "id"`	Rechts van dat blok, verticaal midden op midden, `horizontalGap` ertussen. Zonder verbinding.
`childOf: "id"`	Kind van dat blok. Alle kinderen van één ouder staan op één rij onder de ouder. Met een verbinding.
`recommendationOf: "id"`	Aanbeveling bij dat blok; werkt als `childOf` en krijgt standaard type `recommendation`. Met een verbinding.
`order` (getal) bepaalt de volgorde van kinderen; zonder `order` geldt de volgorde in de JSON.
`connector: false` onderdrukt de automatische verbinding van een blok.
Verticale afstanden
De afstand onder een blok hangt af van de rol van het blok erboven:
Blok erboven	Vrije ruimte
Titel	`titleGap` (2 hokjes)
Data-item of verwijzing	`itemGap` (4 hokjes)
Aanbeveling	`recommendationGap` (2 hokjes)
Dus: titel → eerste data-item 2, data-item → data-item 4, aanbeveling → vervolgboom 2.
Horizontale afstanden en kinderen
Blokken naast elkaar staan op elk niveau minimaal `horizontalGap` (1 hokje) uit elkaar. Onderbomen schuiven per
niveau zo dicht mogelijk naar elkaar toe en de ouder staat precies midden boven zijn eerste en laatste kind.
Kinderen van één ouder staan op één rij (bovenzijden gelijk).
5. Verbindingen
Een expliciete edge (`from`, `to`, eventueel `id`, `value`, `label`) zonder `points` wordt automatisch gerouteerd.
Met `label` krijgt hij ook een `dot`. Edges met `points` blijven precies zoals ze zijn.
Impliciete verbindingen ontstaan voor `below`, `childOf` en `recommendationOf` als er niet al een expliciete edge
tussen die twee blokken staat. Ze hebben geen `id` en doen niet mee aan de interactie.
Interactieve zorgpaden hebben nog steeds expliciete edges met `id`, `from`, `to` en `value` nodig
(zie `docs/interactive-tree-schema.md`). Je hoeft alleen geen `points` meer te tekenen.
Route: een kind recht onder de ouder krijgt een rechte pijl; een kind naast de ouder verlaat de ouder via
de zijkant en gaat dan omlaag; een blok rechts of links ernaast krijgt een horizontale pijl.
Een edge naar een blok dat niet onder de bron staat, of die door andere blokken heen zou lopen, geef je zelf `points`.
6. Meldingen
Fouten in de relaties maken de boom niet onbruikbaar. De boom wordt getekend en de console meldt (één keer per boom,
met het voorvoegsel `[LayoutEngine]`): onbekende doelnode, meerdere relaties, cyclische relatie, halve coördinaten,
dubbele id's, blokken zonder positie, overlappende blokken en edges die niet getekend kunnen worden.
Blokken die niet geplaatst kunnen worden komen op de oorsprong te staan. Edges zonder bruikbaar pad worden niet getekend.
7. Een nieuw zorgpad met relaties maken
Maak `data/<id>/zorgpad.json` en voeg de tumor toe aan `data/tumoren.json`.
Geef een `title` en plaats de rest met relaties (zie het voorbeeld).
Open de pagina en kijk in de console (F12) naar `[LayoutEngine]`- en `[GraphValidator]`-meldingen.
Minimaal voorbeeld:
```json
{
  "id": "mijn-zorgpad",
  "titel": "Mijn zorgpad",
  "overview": {
    "nodes": [
      { "id": "start", "type": "title", "label": "Mijn zorgpad" },
      { "id": "boom-1", "drill": true, "label": "Eerste beslisboom", "below": "start" }
    ]
  },
  "trees": {
    "boom-1": {
      "nodes": [
        { "id": "titel", "type": "title", "label": "Eerste beslisboom" },
        { "id": "a", "type": "recommendation", "text": "Aanbeveling", "below": "titel" },
        { "id": "vervolg", "type": "reference", "label": "Naar de volgende boom", "to": "boom-2", "below": "a" }
      ]
    }
  }
}
```
8. Beperkingen
Eén relatie per blok; een blok kan maar op één plek staan.
Rijen worden per niveau uitgelijnd; blokken van een andere hoogte in dezelfde rij worden bovenaan uitgelijnd.
De automatische routes zijn eenvoudig en orthogonaal. Samenvloeiende routes (twee edges naar hetzelfde blok) en
`selectedPoints` worden niet automatisch gemaakt; geef daarvoor zelf `points` en `selectedPoints`.
Bestaande tumoren zijn niet gemigreerd.
