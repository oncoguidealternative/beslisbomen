/* Viewport van het diagram: passend maken, posities op het scherm, vloeiend pannen en de bediening met
   muis, touchpad, vinger en toetsenbord (zoomen, slepen, dubbelklik, focus in beeld houden).

   Raakt geen keuzes of medische inhoud aan. De eindpositie staat altijd in de centrale state (setZoom/setPan);
   hier staat alleen tijdelijke animatie- en sleepstatus.

   Gebruik:
     const viewport = Viewport.create({
       refs,              // { main, svg, stage, zoomIn?, zoomOut? }
       getGraph,          // () => de getoonde graph (of null)
       onUserMove,        // () => wordt aangeroepen zodra de gebruiker zelf zoomt of sleept
       onReset            // () => na dubbelklik op een leeg deel van het diagram (na het terugzetten naar de beginweergave)
     });
   Functies: start (beginweergave), fit, nodeOnScreen, isFullyVisible, centeredPan, needsMove, movePanTo, cancelMove, focusWithoutPan. */
const Viewport = (function () {
  'use strict';

  const ZOOM_STEP = 0.2;
  const WHEEL_SENSITIVITY = 0.0015;
  const WHEEL_PINCH_SENSITIVITY = 0.01;
  const DRAG_THRESHOLD = 4;
  const FOCUS_MARGIN = 16;
  const MOVE_MIN_MS = 350;
  const MOVE_MAX_MS = 700;
  const VISIBLE_MARGIN = 24;
  const CENTER_TOLERANCE = 0.2;
  // Beginweergave van elke boom en elk overzicht (zie start()):
  const START_BLOCK_PX = 180;  // breedte van een standaardblok op het scherm, in pixels; groter = verder ingezoomd
  const START_TOP_PX = 24;     // ruimte tussen de bovenrand van het werkvlak en de titel

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function create(options) {
    const refs = options.refs;
    const getGraph = options.getGraph;
    const onUserMove = options.onUserMove || function () {};
    const onReset = options.onReset || function () {};
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let animation = null;
    // Tijdens het programmatisch verplaatsen van de focus mag de viewport niet terugpannen.
    let suppressFocusPan = false;

    // ----- Beginweergave, passend maken en posities -----

    // Beginweergave: voor elke boom dezelfde afmetingen (een standaardblok is altijd START_BLOCK_PX breed, ongeacht
    // het raster van die boom) en de titel horizontaal in het midden, bovenaan het werkvlak.
    function start(graph) {
      const info = Renderer.startBox(graph);
      if (!info) { fit(graph); return; }
      setZoom(START_BLOCK_PX / info.blockWidth);
      const zoom = getState().viewport.zoom;   // na begrenzing door de state (ZOOM_MIN..ZOOM_MAX)
      setPan(refs.stage.clientWidth / 2 - (info.box.x + info.box.w / 2) * zoom, START_TOP_PX - info.box.y * zoom);
    }

    // Zet de door de renderer berekende passende zoom en pan in de centrale state.
    function fit(graph) {
      const f = Renderer.fitViewport(graph, refs.stage.clientWidth, refs.stage.clientHeight);
      setZoom(f.zoom);
      setPan(f.panX, f.panY);
    }

    // Positie van de node in de zichtbare stage (pixels), uit SVG-coördinaten, zoom en pan.
    function nodeOnScreen(nodeId) {
      const box = Renderer.nodeBox(getGraph(), nodeId);
      const v = getState().viewport;
      const left = v.panX + box.x * v.zoom;
      const top = v.panY + box.y * v.zoom;
      return { left: left, top: top, right: left + box.w * v.zoom, bottom: top + box.h * v.zoom, box: box };
    }

    // Staat de node volledig in beeld? insets: delen van de stage die afgedekt zijn (bv. door een paneel).
    function isFullyVisible(nodeId, insets) {
      const r = nodeOnScreen(nodeId);
      const w = refs.stage.clientWidth - ((insets && insets.right) || 0);
      const h = refs.stage.clientHeight - ((insets && insets.bottom) || 0);
      return r.left >= VISIBLE_MARGIN && r.right <= w - VISIBLE_MARGIN &&
        r.top >= VISIBLE_MARGIN && r.bottom <= h - VISIBLE_MARGIN;
    }

    // Pan waarbij de node in het midden van het (niet afgedekte) werkvlak staat; zoom blijft ongewijzigd.
    function centeredPan(nodeId, insets) {
      const box = Renderer.nodeBox(getGraph(), nodeId);
      const zoom = getState().viewport.zoom;
      const w = refs.stage.clientWidth - ((insets && insets.right) || 0);
      const h = refs.stage.clientHeight - ((insets && insets.bottom) || 0);
      return {
        x: w / 2 - (box.x + box.w / 2) * zoom,
        y: h / 2 - (box.y + box.h / 2) * zoom
      };
    }

    // Is een viewportbeweging nodig? Niet als de node volledig zichtbaar is (en bij een criterium ook redelijk centraal).
    function needsMove(nodeId, kind) {
      if (!isFullyVisible(nodeId)) return true;
      if (kind === "outcome") return false;
      const r = nodeOnScreen(nodeId);
      const w = refs.stage.clientWidth;
      const h = refs.stage.clientHeight;
      const dx = (r.left + r.right) / 2 - w / 2;
      const dy = (r.top + r.bottom) / 2 - h / 2;
      return Math.abs(dx) > CENTER_TOLERANCE * w || Math.abs(dy) > CENTER_TOLERANCE * h;
    }

    // ----- Vloeiend pannen -----

    function cancelMove() {
      if (animation) {
        cancelAnimationFrame(animation.raf);
        animation = null;
      }
    }

    // Beweegt de viewport (alleen pan) naar de bestemming: vloeiend, of direct bij reduced motion.
    function movePanTo(end, onDone) {
      cancelMove();
      onDone = onDone || function () {};
      const start = getState().viewport;
      const distance = Math.hypot(end.x - start.panX, end.y - start.panY);
      if (reducedMotion.matches || distance < 1) {
        setPan(end.x, end.y);
        onDone();
        return;
      }
      const from = { x: start.panX, y: start.panY };
      const duration = Math.min(MOVE_MAX_MS, Math.max(MOVE_MIN_MS, distance * 0.5));
      const t0 = performance.now();
      const current = { raf: 0 };
      animation = current;
      function step(now) {
        if (animation !== current) return;
        const t = Math.min(1, (now - t0) / duration);
        const e = easeInOutCubic(t);
        setPan(from.x + (end.x - from.x) * e, from.y + (end.y - from.y) * e);
        if (t < 1) {
          current.raf = requestAnimationFrame(step);
        } else {
          animation = null;
          setPan(end.x, end.y);
          onDone();
        }
      }
      current.raf = requestAnimationFrame(step);
    }

    function focusWithoutPan(nodeId) {
      suppressFocusPan = true;
      Renderer.focusNode(nodeId);
      suppressFocusPan = false;
    }

    // ----- Bediening (alleen voor native diagrammen) -----

    function navigationActive() {
      return refs.main.classList.contains("is-native") && !refs.svg.classList.contains("zp-hidden");
    }

    function userMove() {
      cancelMove();
      onUserMove();
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

    function stepZoom(delta) {
      userMove();
      const r = refs.stage.getBoundingClientRect();
      zoomTo(getState().viewport.zoom + delta, r.width / 2, r.height / 2);
    }

    if (refs.zoomIn) refs.zoomIn.addEventListener("click", function () { stepZoom(ZOOM_STEP); });
    if (refs.zoomOut) refs.zoomOut.addEventListener("click", function () { stepZoom(-ZOOM_STEP); });

    // Muiswiel en touchpad: omhoog = inzoomen, omlaag = uitzoomen (pinch op touchpad komt als ctrl+wheel).
    refs.stage.addEventListener("wheel", function (ev) {
      if (!navigationActive()) return;
      ev.preventDefault();
      userMove();
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
      userMove();
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

    // Dubbelklik op een leeg deel van het diagram: terug naar de beginweergave.
    refs.stage.addEventListener("dblclick", function (ev) {
      if (!navigationActive() || ev.target.closest(".node.go, .node.has-info, .node.is-interactive, .node.is-takeable, .edge-choice")) return;
      userMove();
      resetViewport();
      const graph = getGraph();
      if (graph && graph.native) {
        start(graph);
        onReset();
      }
    });

    // Toetsenbordfocus: houd de gefocuste node in beeld door te pannen (het diagram scrolt zelf niet).
    refs.stage.addEventListener("focusin", function (ev) {
      if (!navigationActive()) return;
      refs.stage.scrollLeft = 0;
      refs.stage.scrollTop = 0;
      if (suppressFocusPan) return;
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

    return {
      start: start,
      fit: fit,
      nodeOnScreen: nodeOnScreen,
      isFullyVisible: isFullyVisible,
      centeredPan: centeredPan,
      needsMove: needsMove,
      movePanTo: movePanTo,
      cancelMove: cancelMove,
      focusWithoutPan: focusWithoutPan
    };
  }

  return { create: create };
})();
