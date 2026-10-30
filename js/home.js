/* Homepage (index.html): toont een kaart per tumor uit data/tumoren.json.
   - status "available": de kaart linkt naar zorgpad.html?tumor=<id>
   - andere status: de kaart opent een melding dat het zorgpad later volgt
   Kaarten staan op alfabetische volgorde van de titel. */
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
    }

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
