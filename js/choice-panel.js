/* HTML-keuzevenster voor interactieve data-items.
   Beheert alleen de weergave van het venster (openen, positioneren, radioknoppen, sluiten, focus).
   De gekozen waarden staan uitsluitend in state.js en worden via getState() gelezen. */
const ChoicePanel = (function () {
  'use strict';

  var MARGIN = 8;
  var GAP = 12;

  var panel = null, legend = null, optionsBox = null, clearBtn = null, closeBtn = null, live = null;
  var handlers = { onSelect: function () {}, onClear: function () {} };
  var open_ = null; // alleen UI: welke node het venster nu toont {nodeId, label, options, anchor}

  function make(tag, className, parent) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (parent) parent.appendChild(e);
    return e;
  }

  function build() {
    panel = make('div', 'choice-panel', document.body);
    panel.id = 'choice-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'choice-legend');
    panel.hidden = true;

    var fieldset = make('fieldset', 'choice-fieldset', panel);
    legend = make('legend', 'choice-legend', fieldset);
    legend.id = 'choice-legend';
    optionsBox = make('div', 'choice-options', fieldset);

    var actions = make('div', 'choice-actions', panel);
    clearBtn = make('button', 'zp-btn choice-clear', actions);
    clearBtn.type = 'button';
    clearBtn.textContent = 'Wissen';
    closeBtn = make('button', 'zp-btn choice-close', actions);
    closeBtn.type = 'button';
    closeBtn.textContent = 'Sluiten';

    live = make('div', 'visually-hidden', document.body);
    live.id = 'choice-live';
    live.setAttribute('aria-live', 'polite');

    optionsBox.addEventListener('change', function (ev) {
      if (!open_ || ev.target.type !== 'radio') return;
      var option = open_.options.filter(function (o) { return o.value === ev.target.value; })[0];
      handlers.onSelect(open_.nodeId, ev.target.value,
        { nodeLabel: open_.label, optionLabel: option ? option.label : ev.target.value });
    });

    clearBtn.addEventListener('click', function () {
      if (!open_) return;
      var info = { nodeLabel: open_.label };
      handlers.onClear(open_.nodeId, info);
      // De knop wordt uitgeschakeld; houd de focus binnen het venster.
      var first = optionsBox.querySelector('input[type="radio"]');
      if (first) first.focus();
    });

    closeBtn.addEventListener('click', function () { close(true); });

    // Focus blijft binnen het venster zolang het openstaat.
    panel.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Tab') return;
      var items = Array.prototype.filter.call(
        panel.querySelectorAll('input[type="radio"], button'),
        function (x) { return !x.disabled; });
      if (items.length === 0) return;
      var firstItem = items[0], lastItem = items[items.length - 1];
      if (ev.shiftKey && document.activeElement === firstItem) { ev.preventDefault(); lastItem.focus(); }
      else if (!ev.shiftKey && document.activeElement === lastItem) { ev.preventDefault(); firstItem.focus(); }
    });

    document.addEventListener('keydown', function (ev) {
      if (open_ && ev.key === 'Escape') { ev.preventDefault(); close(true); }
    });

    // Klikken buiten het venster sluit het (klikken op de activerende node wisselt via de aanroeper).
    document.addEventListener('pointerdown', function (ev) {
      if (!open_ || panel.contains(ev.target) || open_.anchor.contains(ev.target)) return;
      close(false);
    }, true);

    window.addEventListener('resize', position);
  }

  /* handlers: {onSelect(nodeId, value, info), onClear(nodeId, info)} */
  function init(h) {
    handlers = h;
    if (!panel) build();
  }

  function isOpenFor(nodeId) {
    return !!open_ && open_.nodeId === nodeId;
  }

  /* Plaatst het venster naast de node, binnen het zichtbare browservenster. */
  function position() {
    if (!open_) return;
    if (!open_.anchor.isConnected) { close(false); return; }
    var r = open_.anchor.getBoundingClientRect();
    var w = panel.offsetWidth, h = panel.offsetHeight;
    var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    var x = r.right + GAP;
    var y = r.top;
    if (x + w > vw - MARGIN) x = r.left - w - GAP;
    if (x < MARGIN) {
      x = r.left;
      y = r.bottom + GAP;
      if (y + h > vh - MARGIN) y = r.top - h - GAP;
    }
    x = Math.max(MARGIN, Math.min(x, vw - w - MARGIN));
    y = Math.max(MARGIN, Math.min(y, vh - h - MARGIN));
    panel.style.setProperty('--choice-x', Math.round(x) + 'px');
    panel.style.setProperty('--choice-y', Math.round(y) + 'px');
  }

  /* Werkt de radioknoppen en de Wissen-knop bij vanuit de centrale state. */
  function sync() {
    if (!open_) return;
    if (!open_.anchor.isConnected) { close(false); return; }
    var value = getState().selections[open_.nodeId];
    var has = value !== undefined && value !== null;
    optionsBox.querySelectorAll('input[type="radio"]').forEach(function (r) {
      r.checked = has && r.value === value;
    });
    clearBtn.disabled = !has;
  }

  /* spec: {nodeId, label, options: [{value, label}], anchor: SVG-element} */
  function open(spec) {
    if (!panel) return;
    if (open_) close(false);
    open_ = { nodeId: spec.nodeId, label: spec.label, options: spec.options, anchor: spec.anchor };
    legend.textContent = spec.label;
    optionsBox.textContent = '';
    spec.options.forEach(function (o) {
      var label = make('label', 'choice-option', optionsBox);
      var input = make('input', '', label);
      input.type = 'radio';
      input.name = 'choice-' + spec.nodeId;
      input.value = o.value;
      var text = make('span', '', label);
      text.textContent = o.label;
    });
    panel.hidden = false;
    sync();
    position();
    var target = optionsBox.querySelector('input:checked') || optionsBox.querySelector('input[type="radio"]');
    if (target) target.focus();
  }

  function close(restoreFocus) {
    if (!open_) return;
    var anchor = open_.anchor;
    open_ = null;
    panel.hidden = true;
    if (restoreFocus && anchor.isConnected) anchor.focus();
  }

  /* Korte melding voor schermlezers (aria-live="polite"). */
  function announce(text) {
    if (!live) return;
    live.textContent = '';
    setTimeout(function () { live.textContent = text; }, 30);
  }

  return { init: init, open: open, close: close, isOpenFor: isOpenFor,
           position: position, sync: sync, announce: announce };
})();
