"use strict";

// ---------- Storage keys ----------
const STORAGE_KEY = "ptcg.storage.v1";
const EXCLUDE_ENERGY_KEY = "ptcg.excludeEnergy";
const DECKS_KEY = "ptcg.decks.v1";

// ---------- Element refs ----------
const $ = (sel) => document.querySelector(sel);

const deckInput = $("#deck-input");
const excludeEnergy = $("#exclude-energy");
const parseBtn = $("#parse-btn");
const summaryPanel = $("#summary-panel");
const summaryTargets = $("#summary-targets");
const applyBtn = $("#apply-btn");
const saveDeckBtn = $("#save-deck-btn");
const printBtn = $("#print-btn");
const resultMsg = $("#result-msg");
const storagePanel = $("#storage-panel");
const storageList = $("#storage-list");
const clearStorage = $("#clear-storage");
const printPanel = $("#print-panel");
const printGrid = $("#print-grid");
const sendPrint = $("#send-print");

// ---------- State ----------
let parsedCards = []; // {name, setCode, number, count, category}

// ---------- Card storage (localStorage) ----------
function loadStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return typeof data === "object" && data !== null ? data : {};
  } catch (e) {
    return {};
  }
}

function saveStorage(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ---------- Saved decks (localStorage) ----------
function loadDecks() {
  try {
    const raw = localStorage.getItem(DECKS_KEY);
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

function saveDecks(decks) {
  localStorage.setItem(DECKS_KEY, JSON.stringify(decks));
}

// ---------- Deck list parser ----------
function isEnergyLine(line) {
  return /energy/i.test(line);
}

function parseDeckList(text) {
  const cards = [];
  const lines = (text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (const line of lines) {
    // Format: <count> <Card Name> <SETCODE> <number>
    // The set code is a short fully-uppercase token (e.g. SCR, MEG, SSP).
    const m = line.match(/^(\d+)\s+(.+?)\s+([A-Z]{2,4})\s+([A-Za-z0-9]+)$/);
    if (!m) continue;
    const count = parseInt(m[1], 10);
    const name = m[2].replace(/['\u2019]/g, "'");
    const setCode = m[3];
    const number = m[4];
    const category = isEnergyLine(line) ? "energy" : "pokemon";
    cards.push({ name, setCode, number, count, category });
  }

  return cards;
}

// ---------- Card identity helpers ----------
function cardKey(c) {
  return `${c.name}|${c.setCode}|${c.number || ""}`;
}

// ---------- Render ----------
function renderTargets() {
  const storage = loadStorage();
  const rows = parsedCards.map((c) => {
    const key = cardKey(c);
    const owned = storage[key] || 0;
    return { card: c, owned, key };
  });

  const thead = `
    <thead>
      <tr>
        <th>Card</th><th>Set</th><th>In Deck</th><th>In Storage</th><th>To Add</th><th>Status</th>
      </tr>
    </thead>`;

  const tbody = rows
    .map((r) => {
      const c = r.card;
      const toAdd = c.category === "energy" ? 0 : Math.max(0, c.count - r.owned);
      let tag;
      if (c.category === "energy") {
        tag = '<span class="tag energy">Energy</span>';
      } else if (toAdd === 0) {
        tag = '<span class="tag ok">Have it</span>';
      } else {
        tag = '<span class="tag topup">Add ' + toAdd + "</span>";
      }
      return `<tr>
        <td>${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.setCode)}</td>
        <td>${c.count}</td>
        <td>${r.owned}</td>
        <td>${toAdd}</td>
        <td>${tag}</td>
      </tr>`;
    })
    .join("");

  summaryTargets.innerHTML = `<table>${thead}<tbody>${tbody}</tbody></table>`;
  return rows;
}

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------- Apply to storage (top up) ----------
function applyToStorage() {
  const storage = loadStorage();
  const exclude = excludeEnergy.checked;
  const rows = parsedCards.map((c) => {
    const key = cardKey(c);
    return { card: c, key, owned: storage[key] || 0 };
  });

  let added = 0;
  let already = 0;
  let energies = 0;

  for (const r of rows) {
    const c = r.card;
    if (c.category === "energy") {
      if (exclude) {
        energies++;
        continue;
      }
      storage[r.key] = c.count;
      continue;
    }
    const toAdd = Math.max(0, c.count - r.owned);
    if (toAdd === 0) {
      already++;
    } else {
      storage[r.key] = r.owned + toAdd;
      added += toAdd;
    }
  }

  saveStorage(storage);
  const excludeNote = exclude ? ` and skipped ${energies} energy card type(s)` : "";
  resultMsg.className = "ok";
  resultMsg.textContent =
    `Done! Added ${added} card(s) to storage, ${already} already in storage.` + excludeNote + ".";
  showMsg(resultMsg);
}

// ---------- Proxy print sheet ----------
async function buildPrintSheet() {
  const storage = loadStorage();
  const cards = parsedCards
    .filter((c) => c.category !== "energy")
    .map((c) => ({ key: cardKey(c), name: c.name, setCode: c.setCode, count: c.count }));

  // One card per unique card (no duplicates) for proxy printing.
  const unique = new Map();
  for (const c of cards) {
    if (!unique.has(c.key)) unique.set(c.key, c);
  }
  const uniques = Array.from(unique.values());

  printGrid.innerHTML = '<div class="hint">Loading card images from the Pokémon TCG API&hellip;</div>';
  printPanel.classList.remove("hidden");
  printPanel.scrollIntoView({ behavior: "smooth" });

  let count = 0;
  let failed = 0;
  for (const c of uniques) {
    const url = await resolveCardImage(c);
    if (url) {
      const card = document.createElement("div");
      card.className = "print-card";
      const img = document.createElement("img");
      img.src = url;
      img.alt = c.name;
      const label = document.createElement("div");
      label.className = "label";
      label.textContent = `${c.name} ${c.setCode}`;
      card.appendChild(img);
      card.appendChild(label);
      printGrid.appendChild(card);
      count++;
    } else {
      failed++;
    }
  }

  if (count === 0) {
    printGrid.innerHTML =
      '<div class="hint">No card images could be loaded from the API for this deck.</div>';
  } else if (failed > 0) {
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = `Loaded ${count} unique card(s). ${failed} could not be resolved.`;
    printGrid.prepend(hint);
  }
}

// Resolve card image from Pokémon TCG API by name + set code.
async function resolveCardImage(c) {
  const query = `name:"${c.name}" set.id:${c.setCode.toLowerCase()}`;
  const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(query)}&pageSize=5`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.data || data.data.length === 0) return null;
    return data.data[0].images.large || data.data[0].images.small || null;
  } catch (e) {
    return null;
  }
}

// ---------- Storage render ----------
function renderStorage() {
  const storage = loadStorage();
  const entries = Object.entries(storage).sort((a, b) => a[0].localeCompare(b[0]));

  if (entries.length === 0) {
    storageList.innerHTML =
      '<p class="hint">No cards in storage yet. Paste a deck list and apply it.</p>';
    return;
  }

  const thead = `
    <thead>
      <tr><th>Card</th><th>Owned</th></tr>
    </thead>`;
  const tbody = entries
    .map(([key, count]) => {
      const [name, setCode, num] = key.split("|");
      const label = num ? `${name} ${setCode} ${num}` : `${name} ${setCode}`;
      return `<tr>
        <td>${escapeHtml(label)}</td>
        <td><button class="small" data-key="${escapeHtml(key)}" data-delta="1">+</button>
            ${count}
            <button class="small" data-key="${escapeHtml(key)}" data-delta="-1">-</button>
            <button class="small danger" data-key="${escapeHtml(key)}" data-delta="0">x</button></td>
      </tr>`;
    })
    .join("");
  storageList.innerHTML = `<table>${thead}<tbody>${tbody}</tbody></table>`;
}

// ---------- Events ----------
parseBtn.addEventListener("click", () => {
  const cards = parseDeckList(deckInput.value);
  if (cards.length === 0) {
    resultMsg.className = "err";
    resultMsg.textContent =
      "Couldn't parse any cards. Make sure each line is like: 4 Slowpoke SCR 57";
    showMsg(resultMsg);
    return;
  }
  parsedCards = cards;
  resultMsg.textContent = "";
  resultMsg.classList.remove("ok", "err");
  renderTargets();
  summaryPanel.classList.remove("hidden");
  storagePanel.classList.remove("hidden");
  summaryPanel.scrollIntoView({ behavior: "smooth" });
  renderStorage();
});

applyBtn.addEventListener("click", () => {
  applyToStorage();
  renderStorage();
});

saveDeckBtn.addEventListener("click", () => {
  if (!parsedCards || parsedCards.length === 0) return;
  const name = prompt("Name this deck:");
  if (!name || !name.trim()) return;
  const trimmed = name.trim();
  const decks = loadDecks();
  if (decks.some((d) => d.name.toLowerCase() === trimmed.toLowerCase())) {
    const ok = confirm(
      `A deck named "${trimmed}" already exists. Overwrite it?`
    );
    if (!ok) return;
    for (let i = 0; i < decks.length; i++) {
      if (decks[i].name.toLowerCase() === trimmed.toLowerCase()) {
        decks[i].cards = parsedCards;
        decks[i].savedAt = Date.now();
        break;
      }
    }
  } else {
    decks.push({ name: trimmed, cards: parsedCards, savedAt: Date.now() });
  }
  saveDecks(decks);
  resultMsg.className = "ok";
  resultMsg.textContent = `Deck "${trimmed}" saved. You can view it on the My Decks page.`;
  showMsg(resultMsg);
});

printBtn.addEventListener("click", buildPrintSheet);

clearStorage.addEventListener("click", () => {
  if (confirm("Clear ALL cards from storage? This cannot be undone.")) {
    saveStorage({});
    renderStorage();
  }
});

storageList.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const key = btn.dataset.key;
  const delta = parseInt(btn.dataset.delta, 10);
  const storage = loadStorage();
  let cur = storage[key] || 0;
  if (delta === 0) {
    delete storage[key];
  } else {
    cur = Math.max(0, cur + delta);
    if (cur === 0) delete storage[key];
    else storage[key] = cur;
  }
  saveStorage(storage);
  renderStorage();
});

sendPrint.addEventListener("click", () => window.print());

excludeEnergy.addEventListener("change", () => {
  localStorage.setItem(EXCLUDE_ENERGY_KEY, excludeEnergy.checked ? "1" : "0");
});

function showMsg(el) {
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 8000);
}

// ---------- Init ----------
(function init() {
  const saved = localStorage.getItem(EXCLUDE_ENERGY_KEY);
  if (saved !== null) excludeEnergy.checked = saved === "1";
  if (loadStorage() && Object.keys(loadStorage()).length > 0) {
    storagePanel.classList.remove("hidden");
    renderStorage();
  }
})();
