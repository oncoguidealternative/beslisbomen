diff --git a/css/styles.css b/css/styles.css
index 0a17108..9a65733 100644
--- a/css/styles.css
+++ b/css/styles.css
@@ -271,7 +271,7 @@ body[data-page="zorgpad"] { line-height: normal; }
 .zp-stage .info .dot { fill: #FFFFFF; stroke: none; }
 
 /* ===== Interactieve route (Sprint 5 en 6) ===== */
-/* Statussen: is-selected, is-available, is-inactive, is-excluded; tijdelijk: is-guided-target */
+/* Statussen: is-selected, is-preselected, is-available, is-inactive, is-excluded; tijdelijk: is-guided-target */
 
 /* available: eerstvolgende criterium waarop een keuze gemaakt kan worden */
 .zp-stage .node.is-interactive.is-available,
@@ -309,8 +309,22 @@ body[data-page="zorgpad"] { line-height: normal; }
 .zp-stage .edge-choice:focus-visible .edge-hit { fill: rgba(255, 255, 255, .2); stroke: #FFFFFF; stroke-width: 3; }
 .zp-stage .edge-choice[aria-disabled="true"] { pointer-events: none; cursor: default; }
 
-/* inactive: nog niet bereikbaar; houdt de normale weergave maar is niet te bedienen */
-.zp-stage .node.is-interactive.is-inactive { cursor: default; }
+/* inactive: nog niet bereikt; houdt de normale weergave, maar een keuzenode is al in te vullen (vrije volgorde) */
+.zp-stage .node.is-interactive.is-inactive { cursor: pointer; }
+.zp-stage .node.is-interactive.is-inactive:hover rect,
+.zp-stage .node.is-interactive.is-inactive:focus rect { fill: var(--color-text-muted); }
+
+/* preselected: alvast ingevuld, maar nog niet bereikt. Groen zoals een gekozen node, met een gestippelde rand
+   en een gestippelde connector, zodat zichtbaar is dat de route er nog niet naartoe loopt. */
+.zp-stage .node.is-interactive.is-preselected { cursor: pointer; }
+.zp-stage .node.t-criterion.is-preselected rect,
+.zp-stage .node.t-criterion.is-preselected:hover rect,
+.zp-stage .node.t-criterion.is-preselected:focus rect {
+  fill: var(--color-success); stroke: #FFFFFF; stroke-width: 3; stroke-dasharray: 8 5;
+}
+.zp-stage .node.t-criterion.is-preselected:focus-visible rect { stroke: var(--color-text-dark); }
+.zp-stage .edge.is-preselected { stroke: var(--color-success); stroke-width: 3px; stroke-dasharray: 8 6; }
+.zp-stage .edot.is-preselected { fill: var(--color-success); stroke: #FFFFFF; stroke-width: 2; stroke-dasharray: 3 2; }
 
 /* excluded: door eerdere keuzes niet meer mogelijk; zichtbaar voor context */
 .zp-stage .node.is-excluded,
diff --git a/js/app.js b/js/app.js
index 24ce744..3f47f29 100644
--- a/js/app.js
+++ b/js/app.js
@@ -640,8 +640,17 @@
       if (treeId !== currentTreeId || getSelections(treeId)[nodeId] === value) return;
       cancelJourney();
       setSelection(treeId, nodeId, value);
-      removeInvalidSelections();
+      const removed = removeInvalidSelections();
       ChoicePanel.close(false);
+      const vervallen = removedMessage(removed);
+      // Vrije volgorde: een keuze bij een node die nog niet bereikt is, wordt alvast vastgelegd. Er is dan nog
+      // geen route om te volgen; die loopt automatisch door zodra de eerdere keuzes zijn gemaakt.
+      if (GraphState.compute(currentGraph, getSelections(treeId)).nodes[nodeId] === "preselected") {
+        clearGuidedTarget();
+        ChoicePanel.announce(info.nodeLabel + ": " + info.optionLabel + " alvast geselecteerd." + vervallen);
+        focusWithoutPan(nodeId);
+        return;
+      }
       const target = GraphState.nextTarget(currentGraph, getSelections(treeId), nodeId);
       let message = info.nodeLabel + ": " + info.optionLabel + " geselecteerd.";
       if (target && target.kind === "available") {
@@ -651,10 +660,17 @@
       } else if (target && target.kind === "end") {
         message += " De route loopt verder bij: " + GraphState.describeNode(nodeById(target.id)) + ".";
       }
-      ChoicePanel.announce(message);
+      ChoicePanel.announce(message + vervallen);
       if (target) startJourney(target, nodeId);
     }
 
+    // Melding voor keuzes die door een nieuwe keuze niet meer mogelijk zijn en dus zijn gewist (leeg als er geen zijn).
+    function removedMessage(removed) {
+      if (!removed || !removed.length) return "";
+      const names = removed.map(function (id) { return GraphState.describeNode(nodeById(id)) || id; });
+      return " Niet meer van toepassing, keuze gewist: " + names.join(", ") + ".";
+    }
+
     // Klik of toets op een connector: dezelfde functie als de radioknop in het keuzevenster.
     function selectEdge(choice) {
       selectOption(currentTreeId, choice.nodeId, choice.value,
@@ -669,8 +685,8 @@
         cancelJourney();
         clearGuidedTarget();
         clearSelection(treeId, nodeId);
-        removeInvalidSelections();
-        ChoicePanel.announce("Keuze voor " + info.nodeLabel + " gewist.");
+        const removed = removeInvalidSelections();
+        ChoicePanel.announce("Keuze voor " + info.nodeLabel + " gewist." + removedMessage(removed));
       }
     });
 
diff --git a/js/graph-state.js b/js/graph-state.js
index a87f21d..9f3a215 100644
--- a/js/graph-state.js
+++ b/js/graph-state.js
@@ -13,7 +13,9 @@
    Statussen:
    - selected: ligt op de gekozen route (beantwoorde keuzenode, gekozen edge, bereikte outcome)
    - available: bereikte, nog onbeantwoorde keuzenode
-   - inactive: nog mogelijk, maar nog niet bereikt
+   - preselected: keuzenode die al een waarde heeft maar nog niet bereikt is (alvast ingevuld, vooruitlopend
+     op eerdere keuzes); de gekozen edge krijgt ook deze status
+   - inactive: nog mogelijk, maar nog niet bereikt (een keuzenode is wel al te beantwoorden)
    - excluded: door eerdere keuzes niet meer mogelijk
    - normal: geen bijzondere status
 
@@ -84,8 +86,10 @@ const GraphState = (function () {
     return seen;
   }
 
-  /* Verwijdert selecties die niet (meer) geldig zijn: de node wordt niet meer bereikt of de waarde bestaat niet.
-     Selecties die bereikbaar blijven (ook via een andere route) blijven staan.
+  /* Verwijdert selecties die niet (meer) geldig zijn: de node is door andere keuzes niet meer mogelijk of de
+     waarde bestaat niet. Een keuze hoeft niet eerst bereikt te zijn: een nog niet bereikte keuzenode mag alvast
+     worden ingevuld (vrije volgorde) en blijft staan zolang die nog mogelijk is.
+     Selecties die mogelijk blijven (ook via een andere route) blijven staan.
      Selecties voor nodes die niet in deze graph voorkomen blijven onaangeroerd. */
   function pruneWithModel(model, selections) {
     var current = {};
@@ -94,11 +98,11 @@ const GraphState = (function () {
     var changed = true;
     while (changed) {
       changed = false;
-      var reached = traverse(model, current, false);
+      var possible = traverse(model, current, true);
       Object.keys(current).forEach(function (id) {
         var node = model.nodes[id];
         if (!node) return;
-        var valid = isChoice(node) && reached[id] === true &&
+        var valid = isChoice(node) && possible[id] === true &&
           node.options.some(function (o) { return o.value === current[id]; });
         if (!valid) {
           delete current[id];
@@ -129,7 +133,7 @@ const GraphState = (function () {
       if (!model.connected[n.id] || !modelled[n.id]) { nodeStatus[n.id] = 'normal'; return; }
       if (!possible[n.id]) { nodeStatus[n.id] = 'excluded'; return; }
       if (isChoice(n)) {
-        if (!reached[n.id]) nodeStatus[n.id] = 'inactive';
+        if (!reached[n.id]) nodeStatus[n.id] = hasValue(clean, n.id) ? 'preselected' : 'inactive';
         else if (hasValue(clean, n.id)) nodeStatus[n.id] = 'selected';
         else { nodeStatus[n.id] = 'available'; available.push(n.id); }
       } else if (n.type === 'outcome') {
@@ -145,7 +149,8 @@ const GraphState = (function () {
       if (!possible[e.from]) { edgeStatus[e.id] = 'excluded'; return; }
       if (isChoice(from)) {
         if (hasValue(clean, e.from)) {
-          edgeStatus[e.id] = (reached[e.from] && e.value === clean[e.from]) ? 'selected' : 'excluded';
+          if (e.value !== clean[e.from]) edgeStatus[e.id] = 'excluded';
+          else edgeStatus[e.id] = reached[e.from] ? 'selected' : 'preselected';
         } else {
           edgeStatus[e.id] = reached[e.from] ? 'normal' : 'inactive';
         }
diff --git a/js/renderer.js b/js/renderer.js
index a0ee0b7..fc7b174 100644
--- a/js/renderer.js
+++ b/js/renderer.js
@@ -445,8 +445,8 @@ const Renderer = (function () {
   }
 
   /* Bedienbaarheid en aria van een connector uit de status van de from-node (zelfde regel als bij de node zelf:
-     alleen bij een beschikbare of beantwoorde keuzenode). Beantwoorde keuzes blijven aanklikbaar om te wijzigen;
-     alleen de eerstvolgende (available) keuzenode staat in de tabvolgorde. */
+     elke keuzenode die nog mogelijk is, ook als die nog niet bereikt is: vrije volgorde). Beantwoorde keuzes
+     blijven aanklikbaar om te wijzigen; alleen de eerstvolgende (available) keuzenode staat in de tabvolgorde. */
   function updateEdgeChoice(item, status, selections) {
     var from = item.getAttribute('data-from');
     var st = status.nodes[from] || 'normal';
@@ -455,20 +455,27 @@ const Renderer = (function () {
     var chosen = selections[from] !== undefined && selections[from] !== null &&
       String(selections[from]) === item.getAttribute('data-value');
     var text = nodeLabel + ': ' + optionLabel;
-    if (st === 'available' || st === 'selected') {
+    if (isSelectableStatus(st)) {
       item.setAttribute('tabindex', st === 'available' ? '0' : '-1');
       item.removeAttribute('aria-disabled');
-      if (chosen) text += ' (huidige keuze)';
+      if (chosen) text += st === 'preselected' ? ' (alvast gekozen)' : ' (huidige keuze)';
+      else if (st === 'inactive') text += ' (alvast kiezen)';
     } else {
       item.removeAttribute('tabindex');
       item.setAttribute('aria-disabled', 'true');
-      text += st === 'excluded' ? ' (niet meer mogelijk)' : ' (nog niet beschikbaar)';
+      text += ' (niet meer mogelijk)';
     }
     item.setAttribute('aria-pressed', chosen ? 'true' : 'false');
     item.setAttribute('aria-label', text);
   }
 
-  var STATUS_CLASSES = ['is-selected', 'is-available', 'is-inactive', 'is-excluded'];
+  var STATUS_CLASSES = ['is-selected', 'is-preselected', 'is-available', 'is-inactive', 'is-excluded'];
+
+  /* Een keuzenode (en zijn connectoren) is te bedienen zolang die nog mogelijk is: ook als die nog niet bereikt
+     is, zodat waarden in willekeurige volgorde kunnen worden ingevuld. Alleen 'excluded' is niet te bedienen. */
+  function isSelectableStatus(st) {
+    return st === 'available' || st === 'selected' || st === 'preselected' || st === 'inactive';
+  }
 
   function setStatusClass(element, status) {
     STATUS_CLASSES.forEach(function (c) { element.classList.remove(c); });
@@ -476,7 +483,7 @@ const Renderer = (function () {
   }
 
   function isClickable(g) {
-    return g.classList.contains('is-available') || g.classList.contains('is-selected');
+    return !g.classList.contains('is-excluded');
   }
 
   /* Past een berekende graph-status toe als CSS-klassen op nodes, edges, dots en labels.
@@ -499,18 +506,20 @@ const Renderer = (function () {
       if (!g.classList.contains('is-interactive')) return;
       var label = g.getAttribute('data-node-label');
       var text = (g.hasAttribute('data-subtree') ? 'Open hulpbeslisboom voor ' : 'Kies een waarde voor ') + label;
-      if (st === 'selected') {
+      if (st === 'selected' || st === 'preselected') {
         var labels = JSON.parse(g.getAttribute('data-option-labels'));
         var value = selections[id];
-        text += ' (huidige keuze: ' + (labels[value] || value) + ')';
+        text += (st === 'preselected' ? ' (alvast gekozen: ' : ' (huidige keuze: ') + (labels[value] || value) + ')';
+      } else if (st === 'inactive') {
+        text += ' (nog niet bereikt, alvast in te vullen)';
       }
-      if (st === 'available' || st === 'selected') {
+      if (isSelectableStatus(st)) {
         g.setAttribute('tabindex', '0');
         g.removeAttribute('aria-disabled');
       } else {
         g.removeAttribute('tabindex');
         g.setAttribute('aria-disabled', 'true');
-        text = label + (st === 'excluded' ? ': niet meer mogelijk' : ': nog niet beschikbaar');
+        text = label + ': niet meer mogelijk';
       }
       g.setAttribute('aria-label', text);
     });
