/* Homepage (index.html): toont een kaart per tumor uit data/tumoren.json.
   - status "available": de kaart linkt naar zorgpad.html?tumor=<id>
   - andere status: de kaart opent een melding dat het zorgpad later volgt
   Kaarten staan op alfabetische volgorde van de titel.
   - Onder de titel: het aantal beslisbomen, of "In voorbereiding" als er nog geen zijn.
   - Zoeken over alle beslisbomen (js/search.js) en "Recent geopend" (js/recent.js). */
(function () {
  'use strict';

  const TUMOREN_URL = './data/tumoren.json';


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

      if (tumor.afbeelding) {
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
