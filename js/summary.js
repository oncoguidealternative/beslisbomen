/* Samenvatting van een beslisboom als platte tekst, om te plakken in een verslag, het EPD of een bericht.
   Inhoud: zorgpad en beslisboom, de ingevulde gegevens, de bereikte aanbeveling(en), de bron en de link.
   Leest alleen de graph, de keuzes en de status (GraphState.compute); bevat zelf geen medische inhoud.

   API:
     Summary.text({ zorgpad, treeId, label, graph, selections, status, url })   → tekst
     Summary.bronLine(zorgpad, treeId)                                           → { text, url } of null
     Summary.feedbackUrl({ zorgpad, treeId, label, node, url })                  → link naar een nieuwe melding op GitHub */
const Summary = (function () {
  'use strict';

  const REPO = 'https://github.com/oncoguidealternative/beslisbomen';

  function pretty(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/<=/g, '≤').replace(/>=/g, '≥').replace(/\s+/g, ' ').trim();
  }

  function date(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? m[3] + '-' + m[2] + '-' + m[1] : (iso || '');
  }

  function treeOf(zorgpad, treeId) {
    const t = zorgpad && zorgpad.trees && zorgpad.trees[treeId];
    if (t && t.same && zorgpad.trees[t.same]) return { own: t, source: zorgpad.trees[t.same] };
    return { own: t || null, source: t || null };
  }

  function optionLabel(node, value) {
    const o = (node.options || []).filter(function (x) { return x.value === value; })[0];
    return o ? (o.label !== undefined ? o.label : o.value) : value;
  }

  /* Eén regel per gegeven, in de invulvolgorde van de boom. */
  function answers(graph, selections, status) {
    const nodes = {};
    graph.nodes.forEach(function (n) { nodes[n.id] = n; });
    const seen = {}, out = [];
    GraphState.choiceOrder(graph).forEach(function (id) {
      if (selections[id] === undefined || selections[id] === null) return;
      const node = nodes[id], key = GraphState.dataKey(node);
      if (seen[key]) return;
      seen[key] = true;
      out.push({
        label: pretty(GraphState.describeNode(node)),
        value: pretty(optionLabel(node, selections[id])),
        ahead: status && status.nodes[id] === 'preselected'
      });
    });
    return out;
  }

  /* Tekst van een aanbeveling als regels voor platte tekst. In de bron is de tekst afgebroken op de breedte van een
     blok in de boom; regels van één alinea worden weer samengevoegd. Verbindingswoorden (EN, OF, ook als
     "---EN---") komen op een eigen regel, een toelichting ({i}) krijgt "Toelichting:" ervoor. */
  const JOIN = /^\s*-*\s*(EN\/OF|EN|OF|GEVOLGD DOOR)\s*-*\s*$/i;
  function paragraphs(node) {
    let raw = [];
    if (node.items && node.items.length) {
      node.items.forEach(function (it, i) { if (i) raw.push('EN'); raw = raw.concat(String(it.text || '').split('\n')); });
    } else if (node.text !== undefined) raw = String(node.text).split('\n');
    else if (node.label) raw = [String(node.label)];
    const out = [];
    let cur = null;
    function flush() { if (cur !== null && cur.trim()) out.push(pretty(cur)); cur = null; }
    raw.forEach(function (line) {
      let l = line.trim();
      if (!l) { flush(); return; }
      const m = JOIN.exec(l);
      if (m) { flush(); if (out.length && !JOIN.test(out[out.length - 1])) out.push(m[1].toUpperCase()); return; }
      if (/^-{2,}$/.test(l)) { flush(); return; }
      const info = l.indexOf('{i}') === 0;
      if (info || l.indexOf('{x}') === 0) { flush(); l = l.slice(3).trim(); cur = info ? 'Toelichting: ' : ''; }
      l = l.replace(/\{a:([^|}]*)\|[^}]*\}/g, '$1').replace(/\{[ix]\}/g, '');
      if (cur === null) cur = '';
      if (/[a-z]-$/.test(cur) && /^[a-z]/.test(l)) cur = cur.slice(0, -1) + l;
      else cur += (cur && !/: $/.test(cur) ? ' ' : '') + l;
    });
    flush();
    while (out.length && JOIN.test(out[out.length - 1])) out.pop();
    return out;
  }

  function bronLine(zorgpad, treeId) {
    const b = zorgpad && zorgpad.bron;
    const tb = treeId ? (treeOf(zorgpad, treeId).own || {}).bron || (treeOf(zorgpad, treeId).source || {}).bron : null;
    if (!b && !tb) return null;
    const parts = [];
    if (b && b.richtlijn) {
      const org = b.organisatie ? String(b.organisatie).replace(/\s*\(.*\)\s*$/, '') : '';
      parts.push('Richtlijn ' + b.richtlijn + (org ? ' (' + org + ')' : ''));
    }
    if (tb && tb.module) parts.push('module ' + tb.module);
    let text = parts.join(', ');
    if (b && b.beoordeeldOp) text += ' · beoordeeld ' + date(b.beoordeeldOp);
    else if (b && b.publicatiedatum) text += ' · gepubliceerd ' + date(b.publicatiedatum);
    return { text: text, url: (tb && tb.url) || (b && b.url) || '' };
  }

  function text(o) {
    const lines = [o.zorgpad.titel + ' – ' + pretty(o.label), ''];
    const a = answers(o.graph, o.selections || {}, o.status);
    if (a.length) {
      lines.push('Gegevens:');
      a.forEach(function (x) { lines.push('- ' + x.label + ': ' + x.value + (x.ahead ? ' (alvast ingevuld)' : '')); });
    } else {
      lines.push('Nog geen gegevens ingevuld.');
    }
    const reached = o.graph.nodes.filter(function (n) {
      return n.type === 'outcome' && o.status && o.status.nodes[n.id] === 'selected';
    });
    reached.forEach(function (n) {
      lines.push('', 'Aanbeveling:');
      paragraphs(n).forEach(function (l) { lines.push(l); });
    });
    if (!reached.length && a.length) lines.push('', 'Nog geen aanbeveling bereikt.');
    const bron = bronLine(o.zorgpad, o.treeId);
    if (bron) {
      lines.push('', 'Bron: ' + bron.text);
      if (bron.url) lines.push(bron.url);
    }
    const now = new Date();
    lines.push('', 'Opgesteld met Gynaecologische zorgpaden op ' + now.getDate() + '-' + (now.getMonth() + 1) + '-' + now.getFullYear() + ':');
    lines.push(o.url);
    return lines.join('\n');
  }

  function feedbackUrl(o) {
    const what = o.node ? pretty(GraphState.describeNode(o.node)) : pretty(o.label);
    const title = 'Melding: ' + o.zorgpad.titel + ' – ' + pretty(o.label) + (o.node ? ' – ' + what : '');
    const body = [
      '**Zorgpad:** ' + o.zorgpad.titel,
      '**Beslisboom:** ' + pretty(o.label) + (o.treeId ? ' (`' + o.treeId + '`)' : ''),
      o.node ? '**Aanbeveling:** ' + what + ' (`' + o.node.id + '`)' : '',
      '**Link:** ' + o.url,
      '',
      '**Wat klopt er niet?**',
      '',
      '',
      '**Wat zou het moeten zijn (met bron)?**',
      ''
    ].filter(function (l, i) { return l !== '' || i > 3; }).join('\n');
    return REPO + '/issues/new?title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body);
  }

  return { text: text, bronLine: bronLine, feedbackUrl: feedbackUrl, pretty: pretty };
})();
