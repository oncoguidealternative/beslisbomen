# mobiel/ — zorgpaden als vragenlijst (experimenteel)

Een mobiele weergave zonder beslisbomen. In plaats van een diagram krijgt de gebruiker één vraag per keer,
ziet live hoeveel aanbevelingen er nog mogelijk zijn, en eindigt bij de aanbeveling.

Live: https://oncoguidealternative.github.io/beslisbomen/mobiel/

## Wat het doet

- **Startpagina**: alle zorgpaden, en zoeken over de titels van alle beslisbomen ("IB1", "follow-up").
- **Zorgpad**: een tijdlijn van de stappen, de keuze bij de eerste splitsing (bv. het stadium), en de
  stappen daarna. Hulp- en vervolgbomen staan onder "Overige beslisbomen".
- **Beslisboom als vragenlijst**:
  - één vraag per keer, met grote knoppen; bij een meetwaarde kan ook een getal worden ingevuld;
  - een meter: "Nog 3 van 5 aanbevelingen mogelijk";
  - "Uw antwoorden" met per antwoord *Wijzig* en *Antwoord wissen*;
  - de aanbeveling als kaart, met de toelichtingen ({i}) en verbindingswoorden (EN / OF) leesbaar opgemaakt;
  - "Volgende stap": de vervolgbomen waar de boom naar verwijst;
  - een vraag met een hulpbeslisboom krijgt de link "Weet u het niet? Bepaal het met de hulpbeslisboom",
    en de uitkomst daarvan is met één knop over te nemen;
  - "Alle aanbevelingen in deze boom", met per aanbeveling: van toepassing, nog mogelijk of uitgesloten;
  - een boom zonder vragen toont zijn aanbevelingen direct.
- **Deelbare link**: de antwoorden staan in de link (`#/cervixcarcinoom/stadium-ia1?lineaire-extension=lte-7-mm`),
  dus een collega opent precies hetzelfde pad. "Terug" op de telefoon is "vorige vraag".
- **Kopieer samenvatting**: de gegevens, de aanbeveling, de bron (richtlijn, module, beoordelingsdatum) en de link,
  als platte tekst om te plakken in een verslag of bericht.

## Eén bron van waarheid

De mobiele weergave heeft géén eigen inhoud en géén eigen beslisregels:

| Wat | Waar | Gedeeld met de hoofdsite |
|---|---|---|
| Inhoud van de zorgpaden | `../data/` | ja |
| Rekenkern (wat is gekozen, mogelijk, uitgesloten) | `../js/graph-state.js` | ja |
| Controle van de interactiegegevens | `../js/graph-validator.js` | ja |
| Normaliseren van nodetypes | `../js/layout-engine.js` (alleen `normalize`) | ja |
| Vraag-voor-vraag-logica | `flow.js` | nee, alleen mobiel |
| Weergave | `app.js`, `mobiel.css`, `index.html` | nee, alleen mobiel |

Een inhoudelijke correctie in `data/` geldt dus meteen voor beide weergaven.

## Controle

```
node mobiel/tools/check-flow.js            # alle zorgpaden
node mobiel/tools/check-flow.js vulva      # één zorgpad
```

Doorloopt in elke beslisboom álle antwoordcombinaties zoals een gebruiker ze in de vragenlijst geeft, en
controleert dat de vragenlijst altijd eindigt, dat elk eindpunt iets oplevert (aanbeveling, stap of vervolgboom),
dat de getoonde aanbeveling precies die van de rekenkern is, en dat elke aanbeveling bereikbaar is.

## Bewust nog niet

- Antwoorden meenemen naar een vervolgboom (bv. "Fertiliteit" opnieuw invullen). Dat vraagt een afspraak over
  welke gegevens in verschillende bomen echt hetzelfde betekenen.
- Het patiëntinformatiepaneel van de hoofdsite (alle gegevens van een boom in één lijst).
