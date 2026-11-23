/* Balk onder in het werkvlak met de volgende vraag van de beslisboom, en sneltoetsen.
   - Er is een onbeantwoorde vraag op de route: "Volgende vraag: <gegeven>" met de opties als knoppen (1, 2, 3 ...).
     Een klik op de naam brengt het blok in beeld; een klik op een optie kiest die meteen.
   - Er is een aanbeveling bereikt en er zijn geen vragen meer: "Aanbeveling bereikt" met een knop naar het
     aanbevelingenoverzicht.
   - Sneltoetsen (niet in een invoerveld of open venster): 1 t/m 9 kiest de optie van de volgende vraag,
     Backspace maakt de laatste keuze ongedaan.
   De volgende vraag is dezelfde als in de mobiele vragenlijst: de eerste bereikte, onbeantwoorde keuzenode in de
   invulvolgorde (GraphState.choiceOrder). Bevat geen medische inhoud.

   API:
     const next = NextStep.create({ container, onChoose(node, option), onLocate(nodeId), onShowOutcome(nodeId),
                                    onSubtree(node, { tree }), onUndo(), isBlocked() });
     next.update(graph, status)   graph null = verbergen (overzicht of boom zonder vragen) */
const NextStep = (function () {
  'use strict';

  function make(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function pretty(s) {
    return String(s === undefined || s === null ? '' : s).replace(/<=/g, '≤').replace(/>=/g, '≥').replace(/\s+/g, ' ').trim();
  }

  function create(o) {
    const bar = make('div', 'ns-bar');
    bar.hidden = true;
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Volgende stap');
    o.container.appendChild(bar);

    let question = null;   // de keuzenode die nu aan de beurt is
    let outcome = null;    // de bereikte aanbeveling als er geen vragen meer zijn
    let enabled = false;   // een interactieve boom is getoond (dan werken de sneltoetsen)

    function render() {
      bar.textContent = '';
      if (question) {
        const label = make('button', 'ns-label');
        label.type = 'button';
        label.innerHTML = '';
        label.appendChild(make('span', 'ns-kicker', 'Volgende vraag'));
        label.appendChild(make('span', 'ns-name', pretty(GraphState.describeNode(question))));
        label.title = 'Breng dit blok in beeld';
        label.addEventListener('click', function () { o.onLocate(question.id); });
        bar.appendChild(label);
        const opts = make('div', 'ns-options');
        opts.setAttribute('role', 'group');
        opts.setAttribute('aria-label', 'Kies voor ' + pretty(GraphState.describeNode(question)));
        question.options.forEach(function (opt, i) {
          const b = make('button', 'ns-opt');
          b.type = 'button';
          if (i < 9) b.appendChild(make('kbd', 'ns-key', String(i + 1)));
          b.appendChild(make('span', null, pretty(opt.label !== undefined ? opt.label : opt.value)));
          if (i < 9) b.setAttribute('aria-keyshortcuts', String(i + 1));
          b.addEventListener('click', function () { o.onChoose(question, opt); });
          opts.appendChild(b);
        });
        bar.appendChild(opts);
        // Vraag met een hulpbeslisboom: die is ook vanuit deze balk te openen.
        const sub = GraphState.subtreeOf(question);
        if (sub && o.onSubtree) {
          const sb = make('button', 'ns-sub', 'Bepalen met hulpbeslisboom');
          sb.type = 'button';
          sb.addEventListener('click', function () { o.onSubtree(question, sub); });
          bar.appendChild(sb);
        }
        bar.hidden = false;
      } else if (outcome) {
        bar.appendChild(make('span', 'ns-done', 'Aanbeveling bereikt'));
        const b = make('button', 'ns-opt ns-show', 'Toon in het aanbevelingenoverzicht');
        b.type = 'button';
        b.addEventListener('click', function () { o.onShowOutcome(outcome.id); });
        bar.appendChild(b);
        bar.hidden = false;
      } else {
        bar.hidden = true;
      }
    }

    function update(graph, status) {
      question = null;
      outcome = null;
      enabled = !!(graph && status && GraphState.isInteractive(graph));
      if (enabled) {
        const byId = {};
        graph.nodes.forEach(function (n) { byId[n.id] = n; });
        GraphState.choiceOrder(graph).some(function (id) {
          if (status.nodes[id] === 'available') { question = byId[id]; return true; }
          return false;
        });
        if (!question) {
          outcome = graph.nodes.filter(function (n) { return n.type === 'outcome' && status.nodes[n.id] === 'selected'; })[0] || null;
        }
      }
      render();
    }

    document.addEventListener('keydown', function (ev) {
      if (!enabled || ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const t = ev.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (o.isBlocked && o.isBlocked()) return;
      if (/^[1-9]$/.test(ev.key) && question) {
        const opt = question.options[Number(ev.key) - 1];
        if (!opt) return;
        ev.preventDefault();
        o.onChoose(question, opt);
      } else if (ev.key === 'Backspace') {
        if (o.onUndo()) ev.preventDefault();
      }
    });

    return { update: update };
  }

  return { create: create };
})();
