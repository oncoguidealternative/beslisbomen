/* Homepage (index.html): toont een kaart per tumor uit data/tumoren.json.
   - status "available": de kaart linkt naar zorgpad.html?tumor=<id>
   - andere status: de kaart opent een melding dat het zorgpad later volgt
   Kaarten staan op alfabetische volgorde van de titel.
   - "pictogram" in tumoren.json kiest een eigen pictogram per orgaan (zie ICONS); anders de afbeelding.
   - Onder de titel: het aantal beslisbomen, of "In voorbereiding" als er nog geen zijn.
   - Zoeken over alle beslisbomen (js/search.js) en "Recent geopend" (js/recent.js). */
(function () {
  'use strict';

  const TUMOREN_URL = './data/tumoren.json';

  /* Pictogrammen in lijnstijl (wit op blauw), 100 x 100. Het orgaan waar het zorgpad over gaat is gevuld; de rest
     van de baarmoeder staat er dun omheen voor de herkenning. */
  const UTERUS = '<path class="f" d="M36 30C36 23 64 23 64 30C64 44 58 54 55 60H45C42 54 36 44 36 30Z"/>' +
    '<path class="f" d="M45 60H55L54 72H46Z"/>' +
    '<path class="f" d="M37 31C30 25 23 27 19 34M63 31C70 25 77 27 81 34"/>' +
    '<ellipse class="f" cx="19" cy="42" rx="5.5" ry="7"/><ellipse class="f" cx="81" cy="42" rx="5.5" ry="7"/>';
  const ICONS = {
    cervix: UTERUS + '<path class="s" d="M45 60H55L54 72H46Z"/>',
    endometrium: UTERUS + '<path class="s" d="M42 32C45 29 55 29 58 32C57 41 53 49 51 54H49C47 49 43 41 42 32Z"/>',
    ovarium: UTERUS + '<ellipse class="s" cx="19" cy="42" rx="7" ry="9"/><ellipse class="s" cx="81" cy="42" rx="7" ry="9"/>',
    'ovarium-groot': UTERUS + '<circle class="s" cx="80" cy="44" r="13"/><ellipse class="s" cx="19" cy="42" rx="5.5" ry="7"/>',
    vulva: UTERUS + '<path class="f" d="M46 72V82M54 72V82"/><path class="s" d="M50 80C56 80 58 86 58 89C58 94 54 97 50 97C46 97 42 94 42 89C42 86 44 80 50 80Z"/>',
    trofoblast: UTERUS + '<circle class="s" cx="50" cy="40" r="8"/><circle class="h" cx="50" cy="40" r="3"/>',
    cellen: '<circle class="f2" cx="34" cy="40" r="15"/><circle class="s" cx="34" cy="40" r="4.5"/>' +
      '<circle class="f2" cx="66" cy="34" r="13"/><circle class="s" cx="66" cy="34" r="4"/>' +
      '<circle class="f2" cx="56" cy="68" r="15"/><circle class="s" cx="56" cy="68" r="4.5"/>',
    'cellen-afwijkend': '<circle class="f2" cx="34" cy="40" r="15"/><circle class="s" cx="34" cy="40" r="4.5"/>' +
      '<circle class="f2" cx="66" cy="34" r="13"/><circle class="s" cx="66" cy="34" r="4"/>' +
      '<circle class="f2" cx="56" cy="68" r="16"/><path class="s" d="M48 64C50 57 61 58 63 63C66 70 60 77 54 75C49 74 46 70 48 64Z"/>'
  };

  function init() {
    const grid = document.getElementById('tumor-grid');
    const errorMessage = document.getElementById('tumor-error');
    const dialog = document.getElementById('coming-soon-dialog');
    const dialogText = document.getElementById('coming-soon-text');
    const closeDialogButton = document.getElementById('close-dialog');
    if (!grid) return;

    let lastTrigger = null;

    function showComingSoon(tumor, card) {
      lastTrigger = card;
      const text = 'Het zorgpad ' + tumor.titel + ' wordt later toegevoegd.';
      if (dialog && typeof dialog.showModal === 'function') {
        dialogText.textContent = text;
        dialog.showModal();
      } else {
        window.alert(text);
      }
    }

    function makeCard(tumor) {
      const available = tumor.status === 'available';
      const card = document.createElement('a');
      card.className = 'tumor-card' + (available ? ' is-available' : ' is-coming-soon');
      card.href = available ? './zorgpad.html?tumor=' + encodeURIComponent(tumor.id) : '#';
      card.setAttribute('aria-label', available ? tumor.titel + ' openen' : tumor.titel + ', nog niet beschikbaar');

      if (tumor.pictogram && ICONS[tumor.pictogram]) {
        const icon = document.createElement('span');
        icon.className = 'tumor-icon';
        icon.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true">' + ICONS[tumor.pictogram] + '</svg>';
        card.appendChild(icon);
      } else if (tumor.afbeelding) {
        const image = document.createElement('img');
        image.className = 'tumor-image';
        image.src = './' + String(tumor.afbeelding).replace(/^\.\//, '');
        image.alt = '';
        image.width = 200;
        image.height = 200;
        image.loading = 'lazy';
        card.appendChild(image);
      }

      const title = document.createElement('span');
      title.className = 'tumor-title';
      title.textContent = tumor.titel;
      card.appendChild(title);
      const meta = document.createElement('span');
      meta.className = 'tumor-meta';
      meta.setAttribute('data-meta-for', tumor.id);
      card.appendChild(meta);

      if (!available) {
        card.addEventListener('click', function (event) {
          event.preventDefault();
          showComingSoon(tumor, card);
        });
      }
      return card;
    }

    function render(data) {
      const tumors = Array.isArray(data.tumoren) ? data.tumoren.slice() : [];
      tumors.sort(function (a, b) {
        return a.titel.localeCompare(b.titel, 'nl', { sensitivity: 'base' });
      });
      grid.replaceChildren();
      tumors.forEach(function (tumor) { grid.appendChild(makeCard(tumor)); });
      if (!tumors.length) showError('Er zijn nog geen zorgpaden beschikbaar.');
      addCounts();
    }

    // Aantal beslisbomen per zorgpad (uit dezelfde index als het zoeken). Zonder bomen: "In voorbereiding".
    function addCounts() {
      if (typeof Search === 'undefined') return;
      Search.index('./').then(function (items) {
        items.filter(function (it) { return !it.treeId; }).forEach(function (it) {
          const meta = grid.querySelector('[data-meta-for="' + it.tumorId + '"]');
          if (!meta) return;
          meta.textContent = it.trees ? it.trees + ' beslisbomen' : 'In voorbereiding';
          if (!it.trees) meta.closest('.tumor-card').classList.add('is-preparing');
        });
      }).catch(function () { /* zonder aantallen is de pagina ook bruikbaar */ });
    }

    // Recent geopende beslisbomen (in deze browser).
    function renderRecent() {
      const section = document.getElementById('recent');
      const list = document.getElementById('recent-list');
      if (!section || !list || typeof Recent === 'undefined') return;
      const items = Recent.list();
      list.replaceChildren();
      items.forEach(function (r) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.className = 'recent-item';
        a.href = './zorgpad.html?tumor=' + encodeURIComponent(r.tumorId) + '#/' + encodeURIComponent(r.treeId);
        const t = document.createElement('span');
        t.className = 'recent-name';
        t.textContent = r.title;
        const sub = document.createElement('span');
        sub.className = 'recent-sub';
        sub.textContent = r.tumorTitle;
        a.appendChild(t);
        a.appendChild(sub);
        li.appendChild(a);
        list.appendChild(li);
      });
      section.hidden = !items.length;
    }
    renderRecent();

    const searchInput = document.getElementById('home-search');
    if (searchInput && typeof Search !== 'undefined') Search.attach(searchInput, { base: './' });

    function showError(text) {
      if (!errorMessage) return;
      errorMessage.hidden = false;
      errorMessage.textContent = text;
    }

    fetch(TUMOREN_URL)
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(render)
      .catch(function (error) {
        console.error('Tumoren laden mislukt:', error);
        showError('De zorgpaden konden niet worden geladen. Probeer de pagina opnieuw te openen.');
      });

    if (dialog) {
      if (closeDialogButton) closeDialogButton.addEventListener('click', function () { dialog.close(); });
      dialog.addEventListener('close', function () { if (lastTrigger) lastTrigger.focus(); });
      dialog.addEventListener('click', function (event) { if (event.target === dialog) dialog.close(); });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
