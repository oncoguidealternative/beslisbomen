# Hulpbeslisbomen (subtree)

Een keuzenode (`interactive:true`) kan een hulpbeslisboom aanwijzen. De node toont een (+)-icoon; een klik opent de hulpboom één niveau dieper. Een bereikte uitkomst (outcome) van de hulpboom is aanklikbaar en neemt de gekoppelde waarde over in de bovenliggende boom.

## Schema
```json
{
  "id": "figo", "type": "dataItem", "label": "FIGO 2018", "interactive": true,
  "options": [{"value": "IB1", "label": "IB1", "edge": "e1"}],
  "subtree": {"tree": "figo-2018", "map": {"uitkomst-node-id": "IB1"}}
}
```
- `tree`: id in `trees` van de hulpboom.
- `map`: uitkomst-node-id van de hulpboom → `value` van een optie van de keuzenode.

## Gedrag
- URL: `zorgpad.html?tumor=<id>#/<hulpboom>?from=<bovenliggende-boom>:<node-id>`.
- Terugkeer: de gekozen uitkomst wordt overgenomen, de verbinding in de bovenliggende boom wordt gemarkeerd.
- Een node met `tumor` (en optioneel `tree`) linkt naar het zorgpad van een andere tumor.
- Aanbevelingenoverzicht (knop "Aanbevelingen (n)"): lijst routes per aanbeveling, klik markeert de route geel.

## Validator
`graph-validator.js` meldt: onbekende hulpboom, `map`-uitkomst die niet bestaat of geen outcome is, `map`-waarde zonder bijbehorende optie, opties zonder uitkomst.

## Een hulpboom toevoegen
1. Teken/modelleer de boom als nieuwe entry in `trees` (met raster: `gridX/gridY/width/height`).
2. Voeg `subtree` toe aan de keuzenode met de `map`.
3. Draai de validator; test `#/<boom>?from=...`.
