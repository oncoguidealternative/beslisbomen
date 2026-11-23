/* Uitleg en gebruiksvoorwaarden op de zorgpadpagina.

   Uitleg: bij het eerste bezoek aan een beslisboom verschijnt een korte uitleg in drie stappen. Daarna is die
   terug te halen met de knop "Uitleg" in de kop.

   Gebruiksvoorwaarden: de balk onderaan ("U bent akkoord met de gebruiksvoorwaarden") staat er tot de gebruiker
   op "Begrepen" klikt. Daarna verdwijnt de balk, zodat het diagram meer ruimte heeft, en staan de
   gebruiksvoorwaarden als link in de kop. Beide keuzes worden onthouden in deze browser (localStorage); zonder
   opslag blijft de balk gewoon staan.

   API:
     Help.init({ helpButton, termsLink, footer, onLayout })   onLayout(): de hoogte van het werkvlak is veranderd
     Help.treeShown()                                         aanroepen als er een beslisboom wordt getoond */
const Help = (function () {
  'use strict';

  const SEEN_KEY = 'zp-uitleg-gezien';
  const TERMS_KEY = 'zp-voorwaarden-begrepen';

  function read(key) { try { return window.localStorage.getItem(key) === '1'; } catch (e) { return false; } }
  function write(key) { try { window.localStorage.setItem(key, '1'); return true; } catch (e) { return false; } }

  let dialog = null, opener = null, onLayout = function () {};

  const STEPS = [
    ['Kies wat u weet over de patiënt',
      'Klik op een wit blok, gebruik de balk onderin met de volgende vraag (toets 1, 2, 3 …), of vul alles in via Patiëntinformatie links.'],
    ['Volg de route',
      'De gekozen route kleurt groen; wat niet meer kan, vervaagt. Backspace maakt de laatste keuze ongedaan. Zoomen kan met het muiswiel of de knoppen rechtsonder.'],
    ['Bekijk de aanbeveling',
      'Klik op een lichtblauw blok of op Aanbevelingen. Daar ziet u de voorwaarden per aanbeveling, en kopieert u een samenvatting of de link met uw keuzes.']
  ];

  function build() {
    dialog = document.createElement('div');
    dialog.className = 'help-card';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-labelledby', 'help-title');
    dialog.hidden = true;
    const h = document.createElement('h2');
    h.id = 'help-title';
    h.textContent = 'Zo werkt een beslisboom';
    const ol = document.createElement('ol');
    ol.className = 'help-steps';
    STEPS.forEach(function (s) {
      const li = document.createElement('li');
      const strong = document.createElement('strong');
      strong.textContent = s[0];
      const p = document.createElement('p');
      p.textContent = s[1];
      li.appendChild(strong);
      li.appendChild(p);
      ol.appendChild(li);
    });
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'help-ok';
    ok.textContent = 'Begrepen';
    ok.addEventListener('click', hide);
    dialog.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { ev.stopPropagation(); hide(); } });
    dialog.appendChild(h);
    dialog.appendChild(ol);
    dialog.appendChild(ok);
    const main = document.getElementById('zp-main') || document.body;
    main.appendChild(dialog);
  }

  function show(focus) {
    if (!dialog) build();
    dialog.hidden = false;
    if (focus) dialog.querySelector('.help-ok').focus();
  }

  function hide() {
    if (!dialog || dialog.hidden) return;
    const hadFocus = dialog.contains(document.activeElement);
    dialog.hidden = true;
    write(SEEN_KEY);
    if (hadFocus && opener) opener.focus();
  }

  function init(o) {
    onLayout = o.onLayout || onLayout;
    opener = o.helpButton || null;
    if (o.helpButton) o.helpButton.addEventListener('click', function () {
      if (dialog && !dialog.hidden) hide(); else show(true);
    });
    const footer = o.footer, termsLink = o.termsLink;
    if (!footer) return;
    function accepted() {
      footer.hidden = true;
      if (termsLink) termsLink.hidden = false;
    }
    if (read(TERMS_KEY)) { accepted(); return; }
    const okButton = footer.querySelector('[data-terms-ok]');
    if (okButton) okButton.addEventListener('click', function () {
      if (!write(TERMS_KEY)) { okButton.hidden = true; return; }   // geen opslag: balk blijft staan
      accepted();
      if (termsLink) termsLink.focus();
      onLayout();
    });
  }

  function treeShown() {
    if (!read(SEEN_KEY)) show(false);
  }

  return { init: init, treeShown: treeShown, show: show, hide: hide };
})();
