# Een zorgpad overnemen uit Oncoguide

Met de scripts in `tools/oncoguide/` zet je de beslisbomen van een project op [Oncoguide](https://oncoguide.nl) om naar een zorgpad op deze website. De blokken komen op dezelfde plek te staan als in Oncoguide, en alle keuzes, metingen, verwijzingen en hulpbeslisbomen werken meteen.

Voorbeeld: `tools/oncoguide/configs/borderline-ovarium.json` (Borderline ovariumtumoren, Oncoguide-project 53).

## Werkwijze

### 1. Exporteren uit Oncoguide

1. Open het project op oncoguide.nl, bijvoorbeeld `https://oncoguide.nl/#!/projects/53/tree/10491`, en wacht tot de boom zichtbaar is.
2. Open de console van de browser (F12 → Console).
3. Plak de inhoud van `tools/oncoguide/export.js` en druk op Enter.
4. De browser downloadt `oncoguide-<project>.json`. Zet dat bestand in `tools/oncoguide/exports/`.

Het script leest alleen wat de pagina al heeft geladen. Het verandert niets in Oncoguide.

### 2. Configuratie maken

Maak `tools/oncoguide/configs/<tumor-id>.json`:

```json
{
  "tumor": "borderline-ovarium",
  "export": "../exports/oncoguide-53.json",
  "titel": "Zorgpad borderline ovariumtumoren",
  "bron": {
    "richtlijn": "Borderline ovariumtumoren",
    "organisatie": "NVOG (Nederlandse Vereniging voor Obstetrie en Gynaecologie)",
    "url": "https://richtlijnendatabase.nl/richtlijn/borderline_ovariumtumoren/borderline_ovariumtumoren_-_startpagina.html"
  },
  "extern": {
    "11080": {"tumor": "vergroot-ovarium", "tree": "klinisch-vergroot-ovarium"}
  },
  "bomen": {"10487": "follow-up"},
  "vervang": [["cyctectomie", "cystectomie"]],
  "behoudOverzicht": false
}
```

| Veld | Betekenis |
|---|---|
| `tumor` | Id van de tumor: de map onder `data/` en het id in `data/tumoren.json` |
| `export` | Het exportbestand, ten opzichte van de configuratie |
| `titel` | Titel van het zorgpad (anders de naam uit Oncoguide) |
| `bron` | Bronvermelding (zie `interactive-tree-schema.md` §7). Een opmerking over de herkomst uit Oncoguide wordt automatisch toegevoegd. |
| `extern` | Optioneel: Oncoguide-bomen die bij een **andere tumor** staan maar (nog) niet in het register (zie hieronder). Een verwijzing ernaar gaat naar die tumor en boom; ze worden niet nog eens omgezet. Het nummer staat in de adresbalk van Oncoguide (`.../tree/<nummer>`). |
| `bomen` | Optioneel: een eigen id per Oncoguide-boom. Anders wordt het id gemaakt uit de naam. |
| `vervang` | Optioneel: tekstcorrecties, bijvoorbeeld tikfouten uit Oncoguide (`[oud, nieuw]`) |
| `overzicht` | Optioneel: aanpassingen per stap in het overzicht, bijvoorbeeld `{"stap-id": {"tumor": "…", "tree": "…"}}` |
| `behoudOverzicht` | `true`: het bestaande overzicht blijft staan; alleen de beslisbomen worden (opnieuw) gemaakt |

### 3. Omzetten

```
node tools/oncoguide/convert.js tools/oncoguide/configs/<tumor-id>.json --measure
```

- Het script schrijft `data/<tumor-id>/zorgpad.json`. Staat de tumor nog niet op de homepage, dan wordt hij aan `data/tumoren.json` toegevoegd.
- `--measure` opent elke beslisboom in een browser en maakt elke aanbeveling precies zo hoog als de tekst nodig heeft. Daarvoor is Playwright nodig (`npm install --no-save playwright`). Zonder `--measure` worden de hoogtes geschat.
- Verwijzingen naar bomen die niet in het project zitten en niet onder `extern` staan, worden als melding getoond.

### 4. Controleren

```
node tools/check.js
node tools/check-tekst.js <tumor-id>
```

Bekijk daarna de bomen op de website. Verhoog bij publicatie het versienummer (zie `README.md`).

## Verwijzen in plaats van kopiëren

Veel bomen komen in Oncoguide in meer projecten voor (bijvoorbeeld *Initieel beleid vergroot ovarium* in het project Borderline ovariumtumoren). Zo'n boom staat op de website maar **één keer**: andere zorgpaden verwijzen ernaar.

- `tools/oncoguide/register.json` houdt bij welke Oncoguide-boom (nummer) bij welke tumor staat. Het script werkt dit bestand na elke omzetting zelf bij.
- Een boom die in het register al bij een andere tumor staat, wordt **niet** opnieuw omgezet. Elke verwijzing ernaar (in een boom of in het overzicht) gaat naar die tumor. Het script meldt dit met `→ verwijst naar …`.
- Bomen die niet met het script zijn gemaakt, kun je met de hand in het register zetten (zoals de bomen van Vergroot ovarium), of per tumor onder `extern` in de configuratie. `extern` gaat voor het register.
- Lijkt een nieuwe boom sterk op een boom bij een andere tumor (zelfde naam en minstens 60% dezelfde blokteksten), dan geeft het script een melding met de regel die je onder `extern` kunt zetten. Dat gebeurt niet automatisch: bomen met dezelfde naam (zoals *Follow-up*) hebben per richtlijn vaak een andere inhoud.

## Wat het script omzet

| Oncoguide | Website |
|---|---|
| Positie van een blok (pixels) | `gridX`/`gridY`, 1 op 1 (unit 5). Kleine scheefstanden worden rechtgetrokken (25 px). |
| Titel van een boom | `title` |
| Gegeven (vraag) | `dataItem` met `interactive: true` en een optie per waarde |
| Meting (getal met eenheid) | `dataItem` met `measure` en bereiken (`gt`, `gte`, `lt`, `lte`) |
| Aanbeveling | `recommendation`; `(i)` wordt `{i}`, `(/)` wordt `{x}`, lege regels vervallen |
| Verwijzing naar een boom | `reference` met `to`, of `tumor`/`tree` bij `extern` |
| Boom die een gegeven bepaalt | Hulpbeslisboom: het gegeven krijgt `subtree` met de uitkomsten |
| Menuboom | Het overzicht (`drill` per stap; een stap die twee keer voorkomt krijgt `to`) |
| Toelichting bij een boom | `onderbouwing`, zonder de standaard-disclaimer; de link naar de richtlijn wordt de `bron` van de boom |
| Tekst op een lijn | `label` van de verbinding. Wijkt die af van de waarde (bijv. "Ja" bij "1 ovarium in situ"), dan wordt de tekst op de lijn de keuze. |

## Na het omzetten

Het resultaat is een gewoon `zorgpad.json`. Je kunt het daarna met de hand verder verbeteren. Let op: als je het script opnieuw draait, worden de beslisbomen opnieuw gemaakt en gaan handmatige wijzigingen in die bomen verloren. Zet blijvende correcties daarom in de configuratie (`vervang`, `bomen`, `extern`, `overzicht`).
