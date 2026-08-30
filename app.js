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
const resultMsg = $("#result-msg");
const storagePanel = $("#storage-panel");
const storageList = $("#storage-list");
const storageSearch = $("#storage-search");
const clearStorage = $("#clear-storage");

// ---------- State ----------
let parsedCards = []; // {name, setCode, number, count, category}
let storageQuery = "";

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

// A storage entry holds {count, category}. Legacy entries (plain numbers) are
// normalized on read so we can sort by category without migrating every card.
function storageEntry(v) {
  if (v && typeof v === "object" && typeof v.count === "number") {
    return { count: v.count, category: v.category || null };
  }
  if (typeof v === "number") return { count: v, category: null };
  return { count: 0, category: null };
}

function storageCount(storage, key) {
  return storageEntry(storage[key]).count;
}

function setStorageEntry(storage, key, count, category) {
  storage[key] = { count, category: category || null };
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

// Detect a section heading line (e.g. "Pokémon: 21", "Trainer:", "ENERGY - 6")
// and return the matching category ("pokemon", "trainer", or "energy"), or
// null if the line isn't a heading. Card lines don't match these patterns.
function sectionOfLine(line) {
  const m = line.match(/^\s*([A-ZÉeé]+)\s*[:.\-]?\s*\d*\s*$/i);
  if (!m) return null;
  const h = m[1].toLowerCase().replace("é", "e");
  if (/^(pok[eé]mon|pokemon)$/i.test(h)) return "pokemon";
  if (/^(trainer|trainers|supporter|supporters|item|items|stadium|stadiums|tool|tools|instant|instants)$/.test(h)) return "trainer";
  if (/^energy$/.test(h)) return "energy";
  return null;
}

function parseDeckList(text) {
  const cards = [];
  const lines = (text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Cards are categorized by the section heading that precedes them (e.g.
  // "Pokémon:", "Trainer:", "Energy:"). If no heading was seen, guess from the
  // line (Energy matches by name; anything else defaults to Pokémon).
  let section = null;
  for (const line of lines) {
    const heading = sectionOfLine(line);
    if (heading) {
      section = heading;
      continue;
    }
    // Format: <count> <Card Name> <SETCODE> <number>
    // The set code is a short fully-uppercase token (e.g. SCR, MEG, SSP).
    const m = line.match(/^(\d+)\s+(.+?)\s+([A-Z]{2,4})\s+([A-Za-z0-9]+)$/);
    if (!m) continue;
    const count = parseInt(m[1], 10);
    const name = m[2].replace(/['\u2019]/g, "'");
    const setCode = m[3];
    const number = m[4];
    const category = section || (isEnergyLine(line) ? "energy" : "pokemon");
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
    const owned = storageCount(storage, key);
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
    return { card: c, key, owned: storageCount(storage, key) };
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
      setStorageEntry(storage, r.key, c.count, "energy");
      continue;
    }
    const toAdd = Math.max(0, c.count - r.owned);
    if (toAdd === 0) {
      already++;
    } else {
      setStorageEntry(storage, r.key, r.owned + toAdd, c.category);
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

// ResolveCardImage is defined in api.js (shared).

// ---------- Storage render ----------
function renderStorage() {
  const storage = loadStorage();
  const query = storageQuery.trim().toLowerCase();
  const entries = Object.entries(storage)
    .filter(([key, val]) => {
      if (!query) return true;
      // Match against the visible label (name + set + number) so searching by
      // card name, set code, or collector number all work.
      return key.toLowerCase().includes(query);
    })
    .sort((a, b) => a[0].localeCompare(b[0]));

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
    .map(([key, val]) => {
      const count = storageCount(storage, key);
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
  const entry = storageEntry(storage[key]);
  let cur = entry.count;
  if (delta === 0) {
    delete storage[key];
  } else {
    cur = Math.max(0, cur + delta);
    if (cur === 0) delete storage[key];
    else setStorageEntry(storage, key, cur, entry.category);
  }
  saveStorage(storage);
  renderStorage();
});

storageSearch.addEventListener("input", () => {
  storageQuery = storageSearch.value;
  if (loadStorage() && Object.keys(loadStorage()).length > 0) renderStorage();
});

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
