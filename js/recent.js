/* Recent geopende beslisbomen (alleen in deze browser, via localStorage; gedeeld door de boomweergave en de
   mobiele weergave). Wordt getoond op de startpagina. Werkt ook zonder opslag: dan is de lijst gewoon leeg.

   API:
     Recent.add({ tumorId, tumorTitle, treeId, title })
     Recent.list() → [{ tumorId, tumorTitle, treeId, title, at }] (nieuwste eerst) */
const Recent = (function () {
  'use strict';

  const KEY = 'zp-recent';
  const MAX = 6;

  function list() {
    try {
      const v = JSON.parse(window.localStorage.getItem(KEY) || '[]');
      return Array.isArray(v) ? v.filter(function (x) { return x && x.tumorId && x.treeId && x.title; }) : [];
    } catch (e) { return []; }
  }

  function add(item) {
    if (!item || !item.tumorId || !item.treeId) return;
    const rest = list().filter(function (x) { return !(x.tumorId === item.tumorId && x.treeId === item.treeId); });
    rest.unshift({ tumorId: item.tumorId, tumorTitle: item.tumorTitle || '', treeId: item.treeId,
      title: item.title || item.treeId, at: Date.now() });
    try { window.localStorage.setItem(KEY, JSON.stringify(rest.slice(0, MAX))); } catch (e) { /* geen opslag */ }
  }

  return { add: add, list: list };
})();
