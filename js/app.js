(function () {
  "use strict";

  const TUMOREN_URL = "data/tumoren.json";

  async function loadJSON(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Kon " + url + " niet laden (" + response.status + ")");
    }
    return response.json();
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
  async function initZorgpad() {
    const target = document.getElementById("zorgpad-status");
    if (!target) return;

    function showError(message) {
      target.textContent = "";
      const p = document.createElement("p");
      p.className = "status error";
      p.textContent = message;
      target.appendChild(p);
    }

    const tumorId = new URLSearchParams(window.location.search).get("tumor");

    // Alleen veilige id's toestaan (voorkomt ongewenste paden)
    if (!tumorId || !/^[a-z0-9_-]+$/i.test(tumorId)) {
      showError("Geen (geldige) tumor opgegeven in de URL.");
      return;
    }

    try {
      const tumoren = await loadTumoren();
      if (!tumoren.some(function (t) { return t.id === tumorId; })) {
        showError("Onbekende tumor: " + tumorId);
        return;
      }

      const zorgpad = await loadJSON("data/" + tumorId + "/zorgpad.json");
      state.currentTumor = zorgpad;

      target.textContent = "";
      const label = document.createElement("p");
      label.className = "loaded-label";
      label.textContent = "Tumor geladen:";

      const title = document.createElement("h2");
      title.className = "loaded-title";
      title.textContent = zorgpad.titel;

      target.appendChild(label);
      target.appendChild(title);
      document.title = zorgpad.titel + " – Gynaecologische zorgpaden";
    } catch (err) {
      showError("Fout bij laden van zorgpad: " + err.message);
    }
  }

  // ---------- Start ----------
  document.addEventListener("DOMContentLoaded", function () {
    const page = document.body.dataset.page;
    if (page === "home") initHome();
    if (page === "zorgpad") initZorgpad();
  });
})();
