# lab/ — losse experimenten

Hier staan kleine proeven die (nog) geen eigen variant zijn: een andere kleur, een nieuwe knop, een
alternatieve startpagina. Elk experiment krijgt een eigen submap, bijvoorbeeld `lab/zoeken/`.

## Afspraken

- **Eén bron van inhoud.** Experimenten lezen de zorgpaden uit `../../data/` en gebruiken de rekenkern
  `../../js/graph-state.js`. Kopieer nooit data of rekenkern naar een experiment: een inhoudelijke correctie
  moet op één plek gebeuren en overal gelden.
- **De hoofdsite blijft ongemoeid.** Een experiment past geen bestanden buiten zijn eigen map aan.
  Lukt iets alleen met een wijziging in `js/` of `data/`, dan wordt dat een gewone wijziging aan de hoofdsite.
- **Zichtbaar als experiment.** Elke pagina heeft `<meta name="robots" content="noindex">` en een
  duidelijke balk "Experimenteel".
- **Bekijken.** GitHub Pages publiceert elke map automatisch, bijvoorbeeld
  `https://oncoguidealternative.github.io/beslisbomen/lab/zoeken/`.
- **Klaar of gestopt?** Een geslaagd experiment gaat over naar de hoofdsite (of naar een eigen variant zoals
  `mobiel/`); een gestopt experiment wordt verwijderd. Git bewaart de geschiedenis.
