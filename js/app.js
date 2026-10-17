(function () {
  "use strict";

  const TUMOREN_URL = "./data/tumoren.json";

  async function fetchText(url) {
    const response = await fetch(url);
    if (!response.ok) {
      const err = new Error("HTTP " + response.status);
      err.status = response.status;
      throw err;
    }
    return response.text();
  }

  async function loadJSON(url) {
    return JSON.parse(await fetchText(url));
  }

  function loadTumoren() {
    return loadJSON(TUMOREN_URL).then(function (data) {
      return Array.isArray(data.tumoren) ? data.tumoren : [];
    });
  }

  // ---------- Homepage ----------
  async function initHome() {
    const container = document.getElementById("tumor-cards");
    if (!container) return;

    try {
      const tumoren = await loadTumoren();
      container.textContent = "";

      tumoren.forEach(function (tumor) {
        const card = document.createElement("a");
        card.className = "card";
        card.href = "zorgpad.html?tumor=" + encodeURIComponent(tumor.id);

        const title = document.createElement("h3");
        title.textContent = tumor.titel;

        const desc = document.createElement("p");
        desc.textContent = tumor.beschrijving || "";

        card.appendChild(title);
        card.appendChild(desc);
        container.appendChild(card);
      });

      if (tumoren.length === 0) {
        container.innerHTML = '<p class="status">Geen zorgpaden beschikbaar.</p>';
      }
    } catch (err) {
      container.innerHTML = '<p class="status error"></p>';
      container.firstChild.textContent = "Fout bij laden van zorgpaden: " + err.message;
    }
  }

  // ---------- Zorgpadpagina ----------
  function isRenderable(zorgpad) {
    const o = zorgpad && zorgpad.overview;
    return !!(o && Array.isArray(o.viewBox) && Array.isArray(o.nodeSize) &&
      Array.isArray(o.nodes) && Array.isArray(o.edges));
  }

  const ZOOM_STEP = 0.2;
  const WHEEL_SENSITIVITY = 0.0015;
  const WHEEL_PINCH_SENSITIVITY = 0.01;
  const DRAG_THRESHOLD = 4;
  const FOCUS_MARGIN = 16;
  const JOURNEY_MIN_MS = 350;
  const JOURNEY_MAX_MS = 700;
  const VISIBLE_MARGIN = 24;
  const CENTER_TOLERANCE = 0.2;
  const GUIDED_HIGHLIGHT_MS = 1600;

  async function initZorgpad() {
    const refs = {
      main: document.getElementById("zp-main"),
      svg: document.getElementById("zp-chart"),
      message: document.getElementById("zp-message"),
      stage: document.getElementById("zp-stage"),
      back: document.getElementById("zp-back"),
      zoomIn: document.getElementById("zp-zin"),
      zoomOut: document.getElementById("zp-zout")
    };
    if (!refs.main || !refs.svg || !refs.message) return;

    function showMessage(text, isError) {
      refs.svg.classList.add("zp-hidden");
      refs.message.classList.remove("zp-hidden");
      refs.message.textContent = "";
      const p = document.createElement("p");
      if (isError) p.className = "error";
      p.textContent = text;
      refs.message.appendChild(p);
    }

    refs.svg.classList.add("zp-hidden");

    const tumorId = new URLSearchParams(window.location.search).get("tumor");

    // Alleen veilige id's toestaan (voorkomt ongewenste paden)
    if (!tumorId || !/^[a-z0-9_-]+$/i.test(tumorId)) {
      showMessage("Geen (geldige) tumor opgegeven in de URL.", true);
      return;
    }

    let zorgpad;
    try {
      const tumoren = await loadTumoren();
      if (!tumoren.some(function (t) { return t.id === tumorId; })) {
        showMessage("Onbekende tumor: " + tumorId, true);
        return;
      }
      zorgpad = await loadJSON("./data/" + tumorId + "/zorgpad.json");
    } catch (err) {
      if (err instanceof SyntaxError) {
        showMessage("Het zorgpadbestand bevat ongeldige JSON.", true);
      } else if (err.status === 404) {
        showMessage("Dit zorgpad is nog niet beschikbaar.", true);
      } else {
        showMessage("Fout bij laden van zorgpad: " + err.message, true);
      }
      return;
    }

    if (!zorgpad || typeof zorgpad !== "object" || typeof zorgpad.titel !== "string") {
      showMessage("Het zorgpadbestand heeft een ongeldige opbouw.", true);
      return;
    }

    setTumor(tumorId);
    document.title = zorgpad.titel + " – Gynaecologische zorgpaden";

    if (!zorgpad.overview) {
      // Nog geen renderbaar zorgpad (bv. endometrium in Sprint 3)
      refs.message.textContent = "";
      const label = document.createElement("p");
      label.className = "loaded-label";
      label.textContent = "Tumor geladen:";
      const title = document.createElement("h2");
      title.className = "loaded-title";
      title.textContent = zorgpad.titel;
      const note = document.createElement("p");
      note.textContent = "Het interactieve zorgpad " + zorgpad.titel.toLowerCase() + " wordt later toegevoegd.";
      refs.message.appendChild(label);
      refs.message.appendChild(title);
      refs.message.appendChild(note);
      refs.message.classList.remove("zp-hidden");
      return;
    }

    if (!isRenderable(zorgpad)) {
      showMessage("Het zorgpadbestand heeft een ongeldige opbouw.", true);
      return;
    }

    Renderer.init({main: refs.main, svg: refs.svg, message: refs.message});

    function navigate(target) {
      location.hash = target ? "#/" + target : "";
    }

    let currentGraph = null;

    // Leest de URL-hash, werkt de state bij en laat de renderer tekenen.
    function showRoute() {
      const id = location.hash.replace(/^#\//, "");
      const view = Renderer.resolve(zorgpad, id);
      currentGraph = view.graph;
      setTree(view.treeId);
      if (view.graph && view.graph.native) setZoom(Renderer.fitZoom(view.graph));
      document.title = view.treeId ? view.label + " – " + zorgpad.titel : zorgpad.titel;
      cancelJourney();
      clearGuidedTarget();
      ChoicePanel.close(false);
      Renderer.draw(view, { navigate: navigate, interact: interact });
      refreshGraph();
      if (view.treeId) window.scrollTo(0, 0);
    }

    // Een interactieve node: open het keuzevenster (of sluit het als het al voor deze node openstaat).
    function interact(item, anchor) {
      if (ChoicePanel.isOpenFor(item.id)) {
        ChoicePanel.close(true);
        return;
      }
      ChoicePanel.open({ nodeId: item.id, label: item.label, options: item.options, anchor: anchor });
    }

    // ----- Graph-status -----
    function graphIsInteractive() {
      return !!currentGraph && GraphState.isInteractive(currentGraph);
    }

    // Berekent de status uit graph + selecties en laat de renderer die toepassen.
    function refreshGraph() {
      if (!graphIsInteractive()) return;
      Renderer.applyStatus(GraphState.compute(currentGraph, getState().selections));
    }

    // Verwijdert keuzes die door een wijziging niet meer geldig of bereikbaar zijn (via de state-functies).
    function removeInvalidSelections() {
      if (!graphIsInteractive()) return [];
      const result = GraphState.prune(currentGraph, getState().selections);
      result.removed.forEach(function (id) { clearSelection(id); });
      return result.removed;
    }

    function nodeById(id) {
      return currentGraph.nodes.filter(function (n) { return n.id === id; })[0];
    }

    // ----- Begeleide viewportreis -----
    // Alleen tijdelijke animatiestatus; de eindpositie staat altijd in de centrale state (setPan).
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let journey = null;
    let guidedTimer = null;

    function cancelJourney() {
      if (journey) {
        cancelAnimationFrame(journey.raf);
        journey = null;
      }
    }

    function clearGuidedTarget() {
      clearTimeout(guidedTimer);
      guidedTimer = null;
      Renderer.setGuidedTarget(null);
    }

    function easeInOutCubic(t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    // Positie van de node in de zichtbare stage (pixels), uit SVG-coördinaten, zoom en pan.
    function nodeOnScreen(nodeId) {
      const box = Renderer.nodeBox(currentGraph, nodeId);
      const v = getState().viewport;
      const left = v.panX + box.x * v.zoom;
      const top = v.panY + box.y * v.zoom;
      return { left: left, top: top, right: left + box.w * v.zoom, bottom: top + box.h * v.zoom, box: box };
    }

    // Pan waarbij de node in het midden van het zichtbare tree-workspace (de stage) staat; zoom blijft ongewijzigd.
    function centeredPan(nodeId) {
      const box = Renderer.nodeBox(currentGraph, nodeId);
      const zoom = getState().viewport.zoom;
      return {
        x: refs.stage.clientWidth / 2 - (box.x + box.w / 2) * zoom,
        y: refs.stage.clientHeight / 2 - (box.y + box.h / 2) * zoom
      };
    }

    // Is een viewportbeweging nodig? Niet als de node volledig zichtbaar is (en bij een criterium ook redelijk centraal).
    function needsMove(nodeId, kind) {
      const r = nodeOnScreen(nodeId);
      const w = refs.stage.clientWidth;
      const h = refs.stage.clientHeight;
      const fullyVisible = r.left >= VISIBLE_MARGIN && r.right <= w - VISIBLE_MARGIN &&
        r.top >= VISIBLE_MARGIN && r.bottom <= h - VISIBLE_MARGIN;
      if (!fullyVisible) return true;
      if (kind === "outcome") return false;
      const dx = (r.left + r.right) / 2 - w / 2;
      const dy = (r.top + r.bottom) / 2 - h / 2;
      return Math.abs(dx) > CENTER_TOLERANCE * w || Math.abs(dy) > CENTER_TOLERANCE * h;
    }

    // Beweegt de viewport (alleen pan) naar de bestemming: vloeiend, of direct bij reduced motion.
    function movePanTo(end, onDone) {
      const start = getState().viewport;
      const distance = Math.hypot(end.x - start.panX, end.y - start.panY);
      if (reducedMotion.matches || distance < 1) {
        setPan(end.x, end.y);
        onDone();
        return;
      }
      const from = { x: start.panX, y: start.panY };
      const duration = Math.min(JOURNEY_MAX_MS, Math.max(JOURNEY_MIN_MS, distance * 0.5));
      const t0 = performance.now();
      const current = { raf: 0 };
      journey = current;
      function step(now) {
        if (journey !== current) return;
        const t = Math.min(1, (now - t0) / duration);
        const e = easeInOutCubic(t);
        setPan(from.x + (end.x - from.x) * e, from.y + (end.y - from.y) * e);
        if (t < 1) {
          current.raf = requestAnimationFrame(step);
        } else {
          journey = null;
          setPan(end.x, end.y);
          onDone();
        }
      }
      current.raf = requestAnimationFrame(step);
    }

    // Start de reis naar het volgende punt na een nieuwe of gewijzigde keuze.
    function startJourney(target, sourceNodeId) {
      cancelJourney();
      clearGuidedTarget();
      function finish() {
        if (target.kind === "available") {
          Renderer.setGuidedTarget(target.id);
          guidedTimer = setTimeout(function () { Renderer.setGuidedTarget(null); }, GUIDED_HIGHLIGHT_MS);
          Renderer.focusNode(target.id);
        } else {
          // Een outcome is niet interactief: de focus keert terug naar de node waar de keuze is gemaakt.
          Renderer.focusNode(sourceNodeId);
        }
      }
      if (currentGraph.native && (target.kind === "available" || target.kind === "outcome") &&
          needsMove(target.id, target.kind)) {
        movePanTo(centeredPan(target.id), finish);
      } else {
        finish();
      }
    }

    // Keuzevenster: een keuze gaat uitsluitend via de centrale state; SVG en venster volgen via subscribe.
    ChoicePanel.init({
      onSelect: function (nodeId, value, info) {
        if (getState().selections[nodeId] === value) return;
        cancelJourney();
        setSelection(nodeId, value);
        removeInvalidSelections();
        ChoicePanel.close(false);
        const target = GraphState.nextTarget(currentGraph, getState().selections, nodeId);
        let message = info.nodeLabel + ": " + info.optionLabel + " geselecteerd.";
        if (target && target.kind === "available") {
          message += " Volgende stap: " + GraphState.describeNode(nodeById(target.id)) + ".";
        } else if (target && target.kind === "outcome") {
          message += " Uitkomst bereikt: " + GraphState.describeNode(nodeById(target.id)) + ".";
        }
        ChoicePanel.announce(message);
        if (target) startJourney(target, nodeId);
      },
      onClear: function (nodeId, info) {
        cancelJourney();
        clearGuidedTarget();
        clearSelection(nodeId);
        removeInvalidSelections();
        ChoicePanel.announce("Keuze voor " + info.nodeLabel + " gewist.");
      }
    });

    // Eén abonnement voor de hele pagina: viewport en selecties worden toegepast zodra de state verandert.
    subscribe(function (snapshot, key) {
      if (key === "viewport") {
        Renderer.applyViewport();
        ChoicePanel.position();
      } else if (key === "selections") {
        refreshGraph();
        ChoicePanel.sync();
      }
    });

    // ----- Muisnavigatie (alleen voor native diagrammen) -----
    function navigationActive() {
      return refs.main.classList.contains("is-native") && !refs.svg.classList.contains("zp-hidden");
    }

    // Zoomt naar newZoom en houdt het punt (cx, cy) in stage-pixels onder de cursor.
    function zoomTo(newZoom, cx, cy) {
      const before = getState().viewport;
      setZoom(newZoom);
      const after = getState().viewport;
      if (after.zoom === before.zoom) return;
      const ux = (cx - before.panX) / before.zoom;
      const uy = (cy - before.panY) / before.zoom;
      setPan(cx - ux * after.zoom, cy - uy * after.zoom);
    }

    function stageCenter() {
      const r = refs.stage.getBoundingClientRect();
      return { x: r.width / 2, y: r.height / 2 };
    }

    function stepZoom(delta) {
      cancelJourney();
      const c = stageCenter();
      zoomTo(getState().viewport.zoom + delta, c.x, c.y);
    }

    refs.zoomIn.addEventListener("click", function () { stepZoom(ZOOM_STEP); });
    refs.zoomOut.addEventListener("click", function () { stepZoom(-ZOOM_STEP); });
    refs.back.addEventListener("click", function () { navigate(""); });
    window.addEventListener("hashchange", showRoute);

    // Muiswiel en touchpad: omhoog = inzoomen, omlaag = uitzoomen (pinch op touchpad komt als ctrl+wheel).
    refs.stage.addEventListener("wheel", function (ev) {
      if (!navigationActive()) return;
      ev.preventDefault();
      cancelJourney();
      let dy = ev.deltaY;
      if (ev.deltaMode === 1) dy *= 16;
      else if (ev.deltaMode === 2) dy *= 100;
      dy = Math.max(-120, Math.min(120, dy));
      const factor = Math.exp(-dy * (ev.ctrlKey ? WHEEL_PINCH_SENSITIVITY : WHEEL_SENSITIVITY));
      const r = refs.stage.getBoundingClientRect();
      zoomTo(getState().viewport.zoom * factor, ev.clientX - r.left, ev.clientY - r.top);
    }, { passive: false });

    // Slepen: linkermuisknop (of vinger) ingedrukt houden en bewegen.
    let drag = null;
    let suppressClick = false;

    refs.stage.addEventListener("pointerdown", function (ev) {
      if (!navigationActive() || !ev.isPrimary) return;
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      cancelJourney();
      const v = getState().viewport;
      drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, panX: v.panX, panY: v.panY, active: false };
    });

    refs.stage.addEventListener("pointermove", function (ev) {
      if (!drag || ev.pointerId !== drag.id) return;
      const dx = ev.clientX - drag.x;
      const dy = ev.clientY - drag.y;
      if (!drag.active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        drag.active = true;
        suppressClick = true;
        refs.stage.classList.add("is-dragging");
        refs.stage.setPointerCapture(ev.pointerId);
      }
      setPan(drag.panX + dx, drag.panY + dy);
    });

    function endDrag(ev) {
      if (!drag || ev.pointerId !== drag.id) return;
      if (drag.active) {
        refs.stage.classList.remove("is-dragging");
        if (refs.stage.hasPointerCapture(ev.pointerId)) refs.stage.releasePointerCapture(ev.pointerId);
        setTimeout(function () { suppressClick = false; }, 0);
      }
      drag = null;
    }
    refs.stage.addEventListener("pointerup", endDrag);
    refs.stage.addEventListener("pointercancel", endDrag);

    // Een sleepgebaar mag geen node of link activeren.
    refs.stage.addEventListener("click", function (ev) {
      if (!suppressClick) return;
      ev.stopPropagation();
      ev.preventDefault();
      suppressClick = false;
    }, true);

    // Dubbelklik op het diagram: terug naar standaardzoom en beginpositie.
    refs.stage.addEventListener("dblclick", function (ev) {
      if (!navigationActive() || ev.target.closest(".node.go, .node.is-interactive")) return;
      cancelJourney();
      resetViewport();
      if (currentGraph && currentGraph.native) setZoom(Renderer.fitZoom(currentGraph));
    });

    // Toetsenbordfocus: houd de gefocuste node in beeld door te pannen (het diagram scrolt zelf niet).
    refs.stage.addEventListener("focusin", function (ev) {
      if (!navigationActive()) return;
      refs.stage.scrollLeft = 0;
      refs.stage.scrollTop = 0;
      const s = refs.stage.getBoundingClientRect();
      const t = ev.target.getBoundingClientRect();
      let dx = 0, dy = 0;
      if (t.right > s.right - FOCUS_MARGIN) dx = s.right - FOCUS_MARGIN - t.right;
      if (t.left + dx < s.left + FOCUS_MARGIN) dx = s.left + FOCUS_MARGIN - t.left;
      if (t.bottom > s.bottom - FOCUS_MARGIN) dy = s.bottom - FOCUS_MARGIN - t.bottom;
      if (t.top + dy < s.top + FOCUS_MARGIN) dy = s.top + FOCUS_MARGIN - t.top;
      if (dx || dy) {
        const v = getState().viewport;
        setPan(v.panX + dx, v.panY + dy);
      }
    });

    try {
      showRoute();
    } catch (err) {
      showMessage("Fout bij weergeven van zorgpad: " + err.message, true);
    }
  }

  // ---------- Start ----------
  document.addEventListener("DOMContentLoaded", function () {
    const page = document.body.dataset.page;
    if (page === "home") initHome();
    if (page === "zorgpad") initZorgpad();
  });
})();
