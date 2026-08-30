"use strict";

// ---------- Storage keys (must match app.js) ----------
const STORAGE_KEY = "ptcg.storage.v1";
const DECKS_KEY = "ptcg.decks.v1";

// ---------- Element refs ----------
const $ = (sel) => document.querySelector(sel);
const decksGrid = $("#decks-grid");
const noDecks = $("#no-decks");
const detailPanel = $("#detail-panel");
const detailTitle = $("#detail-title");
const backBtn = $("#back-btn");
const renameBtn = $("#rename-btn");
const removeStorageBtn = $("#remove-storage-btn");
const printBtn = $("#print-btn");
const deleteDeckBtn = $("#delete-deck-btn");
const detailMsg = $("#detail-msg");
const detailList = $("#detail-list");
const detailImages = $("#detail-images");
const printPanel = $("#print-panel");
const printGrid = $("#print-grid");
const sendPrint = $("#send-print");

// ---------- State ----------
let decks = [];
let current = null; // the open deck

// ---------- Storage ----------
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

// ---------- Helpers ----------
function cardKey(c) {
  return `${c.name}|${c.setCode}|${c.number || ""}`;
}

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setMsg(el, text, type) {
  el.textContent = text;
  el.className = type || "";
}

// ---------- Render deck grid (thumbnails) ----------
async function renderGrid() {
  decks = loadDecks();
  if (decks.length === 0) {
    decksGrid.innerHTML = "";
    noDecks.classList.remove("hidden");
    return;
  }
  noDecks.classList.add("hidden");

  const cards = [];
  for (const deck of decks) {
    const cover = deck.cards.find((c) => c.category !== "energy") || deck.cards[0];
    const el = document.createElement("div");
    el.className = "deck-card";
    el.dataset.name = deck.name;
    const thumb = document.createElement("div");
    thumb.className = "deck-thumb";
    if (cover) {
      const img = await createCardImg(cover);
      thumb.appendChild(img);
    } else {
      thumb.innerHTML = '<div class="thumb-placeholder">Deck</div>';
    }
    const name = document.createElement("div");
    name.className = "deck-name";
    name.textContent = deck.name;
    el.appendChild(thumb);
    el.appendChild(name);
    cards.push(el);
  }
  decksGrid.innerHTML = "";
  cards.forEach((c) => decksGrid.appendChild(c));
}

// ---------- Render deck detail ----------
async function renderDetail() {
  if (!current) return;
  detailTitle.textContent = current.name;
  renderDetailList();
  await renderDetailImages();
}

function renderDetailList() {
  const thead = `
    <thead>
      <tr><th>Card</th><th>Set</th><th>Count</th><th>Type</th></tr>
    </thead>`;
  const tbody = current.cards
    .map((c) => {
      const typeTag =
        c.category === "energy"
          ? '<span class="tag energy">Energy</span>'
          : '<span class="tag ok">Card</span>';
      return `<tr>
        <td>${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.setCode)}</td>
        <td>${c.count}</td>
        <td>${typeTag}</td>
      </tr>`;
    })
    .join("");
  detailList.innerHTML = `<table>${thead}<tbody>${tbody}</tbody></table>`;
}

async function renderDetailImages() {
  detailImages.innerHTML = '<div class="hint">Loading card images&hellip;</div>';
  const uniques = new Map();
  for (const c of current.cards) {
    if (!uniques.has(cardKey(c))) uniques.set(cardKey(c), c);
  }
  const frag = document.createDocumentFragment();
  for (const c of Array.from(uniques.values())) {
    const card = document.createElement("div");
    card.className = "mini-card";
    const img = await createCardImg(c);
    card.appendChild(img);
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = `${c.name} ${c.setCode}`;
    card.appendChild(label);
    frag.appendChild(card);
  }
  detailImages.innerHTML = "";
  detailImages.appendChild(frag);
}

// ResolveCardImage is defined in api.js (shared).

// ---------- Remove deck cards from storage ----------
function removeFromStorage() {
  if (!current) return;
  const storage = loadStorage();
  const counts = new Map();
  for (const c of current.cards) {
    const k = cardKey(c);
    counts.set(k, (counts.get(k) || 0) + c.count);
  }
  let removed = 0;
  for (const [k, amount] of counts) {
    const cur = storage[k] || 0;
    const next = cur - amount;
    if (next <= 0) delete storage[k];
    else storage[k] = next;
    removed += Math.min(cur, amount);
  }
  saveStorage(storage);
  setMsg(detailMsg, `Removed ${removed} card(s) from your card storage.`, "ok");
}

// ---------- Proxy print sheet for current deck ----------
async function buildPrintSheet() {
  if (!current) return;
  const uniques = new Map();
  for (const c of current.cards) {
    if (c.category === "energy") continue;
    if (!uniques.has(cardKey(c))) uniques.set(cardKey(c), c);
  }
  const arr = Array.from(uniques.values());

  printGrid.innerHTML = '<div class="hint">Loading card images from the Pokémon TCG API&hellip;</div>';
  printPanel.classList.remove("hidden");
  printPanel.scrollIntoView({ behavior: "smooth" });

  let count = 0;
  let failed = 0;
  for (const c of arr) {
    const img = await createCardImg(c);
    if (img.getAttribute("src")) {
      const card = document.createElement("div");
      card.className = "print-card";
      card.appendChild(img);
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

// ---------- Navigation state ----------
function openDeck(name) {
  current = decks.find((d) => d.name === name) || null;
  if (!current) return;
  printPanel.classList.add("hidden");
  renderDetail();
  detailPanel.classList.remove("hidden");
  detailPanel.scrollIntoView({ behavior: "smooth" });
}

function closeDeck() {
  current = null;
  detailPanel.classList.add("hidden");
  printPanel.classList.add("hidden");
  renderGrid();
}

// ---------- Events ----------
decksGrid.addEventListener("click", (e) => {
  const card = e.target.closest(".deck-card");
  if (card) openDeck(card.dataset.name);
});

backBtn.addEventListener("click", closeDeck);

renameBtn.addEventListener("click", () => {
  if (!current) return;
  const name = prompt("Rename this deck:", current.name);
  if (!name || !name.trim()) return;
  const trimmed = name.trim();
  if (decks.some((d) => d.name !== current.name && d.name.toLowerCase() === trimmed.toLowerCase())) {
    setMsg(detailMsg, `A deck named "${trimmed}" already exists.`, "err");
    return;
  }
  current.name = trimmed;
  saveDecks(decks);
  detailTitle.textContent = trimmed;
  setMsg(detailMsg, "Deck renamed.", "ok");
});

deleteDeckBtn.addEventListener("click", () => {
  if (!current) return;
  if (!confirm(`Delete deck "${current.name}"? The cards stay in your card storage.`)) return;
  decks = decks.filter((d) => d.name !== current.name);
  saveDecks(decks);
  setMsg(document.querySelector("#no-decks"), "", "");
  closeDeck();
});

removeStorageBtn.addEventListener("click", removeFromStorage);

printBtn.addEventListener("click", buildPrintSheet);
sendPrint.addEventListener("click", () => window.print());

// ---------- Init ----------
renderGrid();
