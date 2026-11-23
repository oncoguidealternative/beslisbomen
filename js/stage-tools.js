/* Bediening op het werkvlak van het diagram:
   - zoomknoppen rechtsonder: inzoomen, uitzoomen, passend maken en terug naar de beginweergave;
   - de bron linksonder (richtlijn, module, beoordelingsdatum); een klik opent de volledige bronvermelding.
   Raakt geen keuzes aan.

   API:
     const tools = StageTools.create({ container, onZoomIn, onZoomOut, onFit, onStart, onBron });
     tools.setBron(text | null)     tekst van de bronregel (null = verbergen)
     tools.setVisible(bool)         alleen tonen bij een zoombaar diagram */
const StageTools = (function () {
  'use strict';

  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    home: '<path d="M4 11 12 4l8 7"/><path d="M6.5 9.5V20h11V9.5"/>'
  };

  function button(cls, label, icon, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'st-btn ' + cls;
    b.setAttribute('aria-label', label);
    b.title = label;
    b.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' + ICONS[icon] + '</svg>';
    b.addEventListener('click', onClick);
    return b;
  }

  function create(o) {
    const zoom = document.createElement('div');
    zoom.className = 'st-zoom';
    zoom.setAttribute('role', 'group');
    zoom.setAttribute('aria-label', 'Zoomen');
    zoom.appendChild(button('st-in', 'Inzoomen', 'plus', o.onZoomIn));
    zoom.appendChild(button('st-out', 'Uitzoomen', 'minus', o.onZoomOut));
    zoom.appendChild(button('st-fit', 'Passend maken: alles in beeld', 'fit', o.onFit));
    zoom.appendChild(button('st-start', 'Beginweergave', 'home', o.onStart));

    const bron = document.createElement('button');
    bron.type = 'button';
    bron.className = 'st-bron';
    bron.hidden = true;
    bron.addEventListener('click', function (ev) { o.onBron({ element: bron, event: ev }); });

    o.container.appendChild(bron);
    o.container.appendChild(zoom);

    return {
      setBron: function (text) {
        bron.hidden = !text;
        bron.textContent = text ? 'Bron: ' + text : '';
        bron.title = text ? 'Bron: ' + text + ' (klik voor de volledige bronvermelding)' : '';
        if (text) bron.setAttribute('aria-label', 'Bron: ' + text + '. Toon de volledige bronvermelding');
      },
      setVisible: function (on) { zoom.hidden = !on; }
    };
  }

  return { create: create };
})();
