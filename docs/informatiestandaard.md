# Informatiestandaard per zorgpad

Naast elk `data/<tumor>/zorgpad.json` kan een `informatiestandaard.json` staan. Daarin staan alle
gegevens (data-items) van dat zorgpad met hun toegestane waarden, overgenomen uit de
informatiestandaard oncologische gynaecologie van IKNL in ART-DECOR (Nictiz).

De website zelf gebruikt het bestand (nog) niet. `tools/check.js` gebruikt het om het zorgpad
ermee te vergelijken.

## Opbouw

```json
{
  "bron": {
    "naam": "Informatiestandaard oncologische gynaecologie",
    "dataset": { "id": "…", "effectiveDate": "…" },
    "groep":   { "id": "…", "effectiveDate": "…", "naam": "Cervixcarcinoom" },
    "url": "https://decor.nictiz.nl/…",
    "opgehaald": "2026-10-30"
  },
  "dataitems": [
    {
      "id": "figo-2018",
      "naam": "FIGO 2018",
      "type": "keuze",
      "concept":  { "id": "2.16.840.1.113883.2.4.3.11.31.1.77.18.2.…", "effectiveDate": "…" },
      "valueSet": { "id": "2.16.840.1.113883.2.4.3.11.31.1.77.18.11.…", "effectiveDate": "…", "naam": "…" },
      "waarden": [
        { "waarde": "ia1", "naam": "IA1", "code": "…", "codeSystem": "2.16.840.1.113883.6.96" }
      ]
    },
    { "id": "diameter-tumor", "naam": "Diameter (tumor)", "type": "meting", "eenheid": "mm", "concept": { "…": "…" } }
  ]
}
```

| Veld | Betekenis |
|---|---|
| `id` | Korte naam (a-z, 0-9, `-`). Een keuzenode kan ernaar verwijzen met `"dataKey"`. |
| `naam` | Naam zoals in de informatiestandaard. Een keuzenode met hetzelfde label hoort automatisch bij dit gegeven (hoofdletters, regeleinden en "(UICC)" tellen niet mee). |
| `ookBekendAls` | Optioneel: andere labels waaronder het gegeven in het zorgpad staat. |
| `type` | `keuze` (een waarde uit een lijst) of `meting` (een getal). |
| `eenheid` | Bij een meting: de eenheid, gelijk aan `measure.unit` in het zorgpad. |
| `waarden` | Bij een keuze: `waarde` is de waarde die het zorgpad gebruikt (`options[].value`); `naam`, `code` en `codeSystem` komen uit de waardelijst. |

## Controle

`node tools/check.js` toont per zorgpad een lijst "Verschillen met de informatiestandaard":

- een keuzenode waarvan het gegeven niet in de informatiestandaard staat;
- een waarde in het zorgpad die niet in de waardelijst staat;
- een gegeven dat in de informatiestandaard een meting is, maar in het zorgpad een keuzelijst (of andersom), of een andere eenheid heeft.

Die lijst is ter informatie: de controle wordt er niet rood van. Een fout in de opbouw van het
bestand zelf (bijvoorbeeld een dubbele waarde of een meting zonder eenheid) is wel een fout.
