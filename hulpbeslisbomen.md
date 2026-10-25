# Hulpbeslisbomen (sub-beslisbomen)

Een hulpbeslisboom leidt uit een aantal kenmerken één waarde af voor een keuzenode in een andere beslisboom
(voorbeeld: "cN" uit papabele klieren, fixatie, ulceratie en lateraliteit). De gebruiker klikt op de node met het
(+), beantwoordt de vragen in de hulpbeslisboom, klikt op de bereikte uitkomst en komt terug in de oorspronkelijke
beslisboom, waar de bijbehorende connector gekozen en gemarkeerd is.

Alles volgt uit de data. Er is geen tumorspecifieke code; nieuwe tumoren en bomen werken zonder codewijziging.

## 1. Schema

Op de **keuzenode** in de beslisboom van herkomst (de node met het +):

```json
{ "id": "cn", "type": "criterion", "label": "cN", "interactive": true,
  "options": [ { "value": "cn0", "label": "cN0", "edge": "edge-cn-cn0" },
               { "value": "gte-cn1", "label": ">= cN1", "edge": "edge-cn-gte-cn1" } ],
  "subtree": { "tree": "cn-hulp",
               "map": { "o-cn0": "cn0", "o-cn1": "gte-cn1", "o-cn2": "gte-cn1", "o-cn3": "gte-cn1" } } }
```

| Veld | Betekenis |
|---|---|
| `subtree.tree` | id van de hulpbeslisboom: een gewone boom onder `trees`. Hij hoeft niet in het overzicht te staan. Korte schrijfwijze: `"subtree": "cn-hulp"`. |
| `subtree.map` | per uitkomst (outcome-id) van de hulpbeslisboom de `value` van een **optie van deze node**. |
| `value` op een outcome | alternatief voor de map: de optiewaarde staat dan bij de uitkomst zelf. De map op de node wint. |

De map staat bij de node, niet in de hulpbeslisboom, omdat dezelfde hulpbeslisboom in verschillende bomen andere
connectorwaarden kan opleveren (bijvoorbeeld `cn` in `primair`: `0`, `1-2`, `3`; in `adjuvant`: `cn0`, `gte-cn1`).
Een uitkomst zonder (geldige) koppeling is zichtbaar maar niet over te nemen.

De hulpbeslisboom zelf is een gewone interactieve boom: een `root` (het minus-icoon gaat een niveau omhoog),
interactieve criteria met `options` en edges, en `outcome`-nodes als uitkomst.

## 2. Gedrag

- Klik of Enter/Spatie op de node met `subtree` (alleen als die beschikbaar of beantwoord is) opent de hulpbeslisboom.
  Zonder `icon` krijgt zo'n node automatisch het plus-icoon (`plus-light`). De connectoren van de node blijven
  rechtstreeks klikbaar.
- In de hulpbeslisboom staat linksboven een balk: "Terug naar ...", uitleg over de bereikte uitkomst, en
  "Keuze ... wissen" zolang er in de beslisboom van herkomst een keuze staat.
- Een bereikte uitkomst met koppeling krijgt een gestippelde rand en is aanklikbaar. Klikken kiest de gekoppelde waarde
  in de beslisboom van herkomst, gaat terug en laat de gewone begeleide reis naar het volgende punt zien.
- Het minus-icoon op de wortel en de knop "Terug naar ..." gaan een niveau omhoog. Het kruimelpad ("Zorgpad") gaat
  naar het overzicht.
- De antwoorden in de hulpbeslisboom blijven bewaard (per tumor, alleen in het geheugen), ook voor een volgend bezoek
  vanuit een andere boom. Het wijzigen van antwoorden past de keuze in de beslisboom van herkomst pas aan als de
  gebruiker opnieuw een uitkomst aanklikt.
- Het aanbevelingenoverzicht (Sprint 13) werkt ook in een hulpbeslisboom.

## 3. URL

`zorgpad.html?tumor=vulva#/cn-hulp?from=adjuvant:cn` — na `from=` staan de beslisboom en de node van herkomst.
Herladen en terugkeren werken daardoor. Ontbreekt `from`, dan wordt de herkomst alleen gebruikt als precies
één node naar de hulpbeslisboom verwijst; anders is er geen "Terug"-balk en gaat het minus-icoon naar het overzicht.

## 4. Meldingen (console, `[GraphValidator]`)

Onbekende hulpbeslisboom, `subtree` op een node die niet interactief is, map-sleutel die geen uitkomst is,
map-waarde die geen optie is, uitkomst zonder gekoppelde waarde, en een cyclus (een boom die zichzelf aanwijst).
Een foutieve koppeling blokkeert niets: de rest van de boom blijft werken.

## 5. Nieuwe hulpbeslisboom toevoegen

1. Voeg de boom toe aan `trees` (zoals elke boom; zie `docs/layout-engine.md`).
2. Zet `subtree` op de keuzenode(s) die hem gebruiken, met de map per node.
3. Open de pagina, controleer de console en doorloop de hulpbeslisboom.

## 6. Voorbeeld: cN (gemeten uit de screenshot)

Posities en edges zijn gemeten uit de aangeleverde screenshot van de cN-hulpbeslisboom (825 x 796 px, 1:1).
**De koppeling uit de map (cN1, cN2 en cN3 naar `gte-cn1`, cN0 naar `cn0`) is afgeleid uit de connectoren
`cN0` en `>= cN1` in de screenshots en moet medisch worden bevestigd.** Optiewaarden en edge-id's zijn hier gekozen
zodat ze bij `adjuvant` passen; voor `primair` (`0`, `1-2`, `3`) is een andere map nodig.

```json
"cn-hulp": {
  "viewBox": [825, 796], "nodeSize": [150, 78], "native": true,
  "nodes": [
    {"id": "root", "type": "root", "tone": "blue", "label": "cN", "x": 265, "y": 2, "icon": "minus-light", "to": "", "rx": 40},
    {"id": "papabel", "type": "criterion", "label": "Papabel suspecte klieren", "x": 265, "y": 115, "interactive": true, "options": [{"value": "afwezig", "label": "Afwezig", "edge": "edge-papabel-afwezig"}, {"value": "aanwezig", "label": "Aanwezig", "edge": "edge-papabel-aanwezig"}]},
    {"id": "gefixeerd", "type": "criterion", "label": "Gefixeerde klier", "x": 265, "y": 265, "interactive": true, "options": [{"value": "gefixeerd", "label": "Gefixeerd", "edge": "edge-gefixeerd-gefixeerd"}, {"value": "niet-gefixeerd", "label": "Niet gefixeerd", "edge": "edge-gefixeerd-niet-gefixeerd"}]},
    {"id": "ulcererend", "type": "criterion", "label": "Ulcererende klier", "x": 265, "y": 415, "interactive": true, "options": [{"value": "ulcererend", "label": "Ulcererend", "edge": "edge-ulcererend-ulcererend"}, {"value": "niet-ulcererend", "label": "Niet ulcererend", "edge": "edge-ulcererend-niet-ulcererend"}]},
    {"id": "lateraliteit", "type": "criterion", "label": "Lateraliteit", "x": 265, "y": 565, "interactive": true, "options": [{"value": "bilateraal", "label": "Bilateraal", "edge": "edge-lateraliteit-bilateraal"}, {"value": "unilateraal", "label": "Unilateraal", "edge": "edge-lateraliteit-unilateraal"}]},
    {"id": "o-cn0", "type": "outcome", "text": "cN0", "x": 78, "y": 714},
    {"id": "o-cn1", "type": "outcome", "text": "cN1", "x": 265, "y": 714},
    {"id": "o-cn2", "type": "outcome", "text": "cN2", "x": 452, "y": 714},
    {"id": "o-cn3", "type": "outcome", "text": "cN3", "x": 640, "y": 714}
  ],
  "edges": [
    {"id": "edge-root-papabel", "from": "root", "to": "papabel", "points": [[340, 80], [340, 115]], "arrow": true},
    {"id": "edge-papabel-afwezig", "from": "papabel", "to": "o-cn0", "points": [[265, 153], [153, 153], [153, 714]], "arrow": true, "value": "afwezig", "label": "Afwezig", "dot": [208, 153]},
    {"id": "edge-papabel-aanwezig", "from": "papabel", "to": "gefixeerd", "points": [[340, 192], [340, 265]], "arrow": true, "value": "aanwezig", "label": "Aanwezig", "dot": [340, 227]},
    {"id": "edge-gefixeerd-gefixeerd", "from": "gefixeerd", "to": "o-cn3", "points": [[414, 303], [715, 303], [715, 714]], "arrow": true, "value": "gefixeerd", "label": "Gefixeerd", "dot": [565, 303]},
    {"id": "edge-gefixeerd-niet-gefixeerd", "from": "gefixeerd", "to": "ulcererend", "points": [[340, 342], [340, 415]], "arrow": true, "value": "niet-gefixeerd", "label": "Niet gefixeerd", "dot": [340, 377]},
    {"id": "edge-ulcererend-ulcererend", "from": "ulcererend", "to": "o-cn3", "points": [[414, 453], [715, 453], [715, 714]], "arrow": true, "value": "ulcererend", "label": "Ulcererend", "dot": [565, 453]},
    {"id": "edge-ulcererend-niet-ulcererend", "from": "ulcererend", "to": "lateraliteit", "points": [[340, 493], [340, 565]], "arrow": true, "value": "niet-ulcererend", "label": "Niet ulcererend", "dot": [340, 527]},
    {"id": "edge-lateraliteit-bilateraal", "from": "lateraliteit", "to": "o-cn2", "points": [[414, 603], [527, 603], [527, 714]], "arrow": true, "value": "bilateraal", "label": "Bilateraal", "dot": [471, 603]},
    {"id": "edge-lateraliteit-unilateraal", "from": "lateraliteit", "to": "o-cn1", "points": [[340, 643], [340, 714]], "arrow": true, "value": "unilateraal", "label": "Unilateraal", "dot": [340, 677]}
  ]
}
```
