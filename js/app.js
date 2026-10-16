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

  async function initZorgpad() {
    const refs = {
      main: document.getElementById("zp-main"),
      svg: document.getElementById("zp-chart"),
      message: document.getElementById("zp-message"),
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

    state.currentTumor = zorgpad;
    document.title = zorgpad.titel + " – Gynaecologische zorgpaden";

    if (!zorgpad.overview) {
      // Nog geen renderbaar zorgpad (bv. endometrium in Sprint 2)
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

    try {
      Renderer.init(refs);
      Renderer.show(zorgpad);
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
