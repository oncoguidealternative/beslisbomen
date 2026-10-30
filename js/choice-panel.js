/* HTML-keuzevenster voor interactieve data-items.
   Beheert alleen de weergave van het venster (openen, positioneren, radioknoppen, sluiten, focus).
   Heeft de node een hulpbeslisboom, dan staat onderaan ook de knop "Hulpbeslisboom" (handlers.onSubtree).
   Is de node een meetwaarde (spec.measure), dan toont het venster één invoerveld met de eenheid in plaats van
   opties; Enter legt het getal vast (handlers.onMeasure).
   Sluiten: Escape of klikken buiten het venster.
   De gekozen waarden staan uitsluitend in state.js en worden via getState() gelezen. */
const ChoicePanel = (function () {
  'use strict';

  var MARGIN = 8;
  var GAP = 12;

  var panel = null, head = null, legend = null, measureBox = null, measureInput = null, measureUnit = null, measureMsg = null, optionsBox = null, clearBtn = null, subtreeBtn = null, live = null;
  var handlers = { onSelect: function () {}, onClear: function () {}, onSubtree: function () {}, onMeasure: function () { return false; } };
  var open_ = null; // alleen UI: welke node het venster nu toont {tumorId, treeId, nodeId, label, options, anchor}

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

    // Kop met de naam van het gegeven; de opties staan in een fieldset met die naam als legend (voor schermlezers).
    head = make('div', 'choice-head', panel);
    head.id = 'choice-legend';
    var fieldset = make('fieldset', 'choice-fieldset', panel);
    legend = make('legend', 'visually-hidden', fieldset);
    optionsBox = make('div', 'choice-options', fieldset);

    // Invoerveld voor een meetwaarde (alleen zichtbaar bij een node met "measure").
    measureBox = make('div', 'choice-measure', panel);
    measureBox.hidden = true;
    var measureRow = make('label', 'choice-measure-row', measureBox);
    measureInput = make('input', 'choice-measure-input', measureRow);
    measureInput.type = 'text';
    measureInput.setAttribute('inputmode', 'decimal');
    measureInput.setAttribute('autocomplete', 'off');
    measureInput.placeholder = 'Typ hier';
    measureUnit = make('span', 'choice-measure-unit', measureRow);
    measureMsg = make('p', 'choice-measure-msg', measureBox);
    measureMsg.setAttribute('role', 'status');
    measureInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); commitMeasure(); }
    });

    var actions = make('div', 'choice-actions', panel);
    subtreeBtn = make('button', 'choice-btn choice-subtree', actions);
    subtreeBtn.type = 'button';
    subtreeBtn.textContent = 'Hulpbeslisboom';
    subtreeBtn.hidden = true;
    clearBtn = make('button', 'choice-btn choice-clear', actions);
    clearBtn.type = 'button';
    clearBtn.textContent = 'Wissen';

    live = make('div', 'visually-hidden', document.body);
    live.id = 'choice-live';
    live.setAttribute('aria-live', 'polite');

    optionsBox.addEventListener('change', function (ev) {
      if (!open_ || ev.target.type !== 'radio') return;
      var option = open_.options.filter(function (o) { return o.value === ev.target.value; })[0];
      handlers.onSelect(open_.treeId, open_.nodeId, ev.target.value,
        { nodeLabel: open_.label, optionLabel: option ? option.label : ev.target.value });
    });

    clearBtn.addEventListener('click', function () {
      if (!open_) return;
      var info = { nodeLabel: open_.label };
      handlers.onClear(open_.treeId, open_.nodeId, info);
      // De knop wordt uitgeschakeld; houd de focus binnen het venster.
      var first = optionsBox.querySelector('input[type="radio"]');
      if (first) first.focus();
    });

    function commitMeasure() {
      if (!open_ || !open_.measure) return;
      var raw = measureInput.value.trim().replace(',', '.');
      if (raw === '') return;
      var number = Number(raw);
      if (!isFinite(number) || !/^-?\d+(\.\d+)?$/.test(raw)) {
        measureMsg.textContent = 'Vul een getal in, bijvoorbeeld 32 of 4,5.';
        return;
      }
      var ok = handlers.onMeasure(open_.treeId, open_.nodeId, number, { nodeLabel: open_.label });
      if (!ok) measureMsg.textContent = 'Deze waarde valt buiten de mogelijkheden van deze stap.';
    }

    subtreeBtn.addEventListener('click', function () {
      if (!open_ || !open_.subtree) return;
      var info = { treeId: open_.treeId, nodeId: open_.nodeId, tree: open_.subtree.tree, label: open_.label };
      close(false);
      handlers.onSubtree(info);
    });

    // Focus blijft binnen het venster zolang het openstaat.
    panel.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Tab') return;
      var items = Array.prototype.filter.call(
        panel.querySelectorAll('input[type="radio"], input[type="text"], button'),
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

  /* handlers: {onSelect(treeId, nodeId, value, info), onClear(treeId, nodeId, info), onSubtree({treeId, nodeId, tree, label})} */
  function init(h) {
    handlers = { onSelect: h.onSelect || function () {}, onClear: h.onClear || function () {}, onSubtree: h.onSubtree || function () {},
      onMeasure: h.onMeasure || function () { return false; } };
    if (!panel) build();
  }

  function isOpenFor(treeId, nodeId) {
    return !!open_ && open_.treeId === treeId && open_.nodeId === nodeId;
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
    var value = (getState().selections[open_.treeId] || {})[open_.nodeId];
    var has = value !== undefined && value !== null;
    optionsBox.querySelectorAll('input[type="radio"]').forEach(function (r) {
      r.checked = has && r.value === value;
    });
    clearBtn.disabled = !has;
    if (open_.measure && !has) measureInput.value = '';
  }

  /* spec: {tumorId, treeId, nodeId, label, options: [{value, label}], anchor: SVG-element, subtree?: {tree}}
     Alles wat getoond wordt komt uit de meegegeven node; er staat geen medische inhoud in dit bestand. */
  function open(spec) {
    if (!panel) return;
    if (open_) close(false);
    open_ = { tumorId: spec.tumorId, treeId: spec.treeId, nodeId: spec.nodeId, label: spec.label, options: spec.options, anchor: spec.anchor, subtree: spec.subtree || null, measure: spec.measure || null };
    panel.setAttribute('data-tumor', spec.tumorId || '');
    panel.setAttribute('data-tree', spec.treeId || '');
    legend.textContent = spec.label;
    head.textContent = spec.label;
    subtreeBtn.hidden = !open_.subtree;
    // Meetwaarde: invoerveld in plaats van opties.
    measureBox.hidden = !open_.measure;
    optionsBox.parentNode.hidden = !!open_.measure;
    measureMsg.textContent = '';
    if (open_.measure) {
      measureUnit.textContent = open_.measure.unit || '';
      measureInput.value = spec.measurement !== undefined && spec.measurement !== null ? String(spec.measurement).replace('.', ',') : '';
      measureInput.setAttribute('aria-label', spec.label + (open_.measure.unit ? ' in ' + open_.measure.unit : ''));
    }
    optionsBox.textContent = '';
    spec.options.forEach(function (o) {
      var label = make('label', 'choice-option', optionsBox);
      var input = make('input', '', label);
      input.type = 'radio';
      input.name = 'choice-' + spec.treeId + '-' + spec.nodeId;
      input.value = o.value;
      var text = make('span', '', label);
      text.textContent = o.label;
    });
    panel.hidden = false;
    sync();
    position();
    var target = open_.measure ? measureInput : (optionsBox.querySelector('input:checked') || optionsBox.querySelector('input[type="radio"]'));
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
