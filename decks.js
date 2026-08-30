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
const applyStorageBtn = $("#apply-storage-btn");
const removeStorageBtn = $("#remove-storage-btn");
const deleteDeckBtn = $("#delete-deck-btn");
const detailMsg = $("#detail-msg");
const detailList = $("#detail-list");
const detailImages = $("#detail-images");
const reloadImagesBtn = $("#reload-images-btn");

// ---------- State ----------
let decks = [];
let current = null; // the open deck

// Rendered image HTML cached per deck name, so switching back to a deck you
// already opened is instant instead of re-loading every image.
const imagesHtmlCache = {};

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
  const cached = imagesHtmlCache[current.name];
  if (cached) {
    detailImages.innerHTML = cached;
    return;
  }
  await renderDetailImages();
}

function renderDetailList() {
  const storage = loadStorage();
  const thead = `
    <thead>
      <tr><th>Card</th><th>Set</th><th>Count</th><th>In Storage</th><th>To Add</th><th>Status</th></tr>
    </thead>`;
  const tbody = current.cards
    .map((c) => {
      const owned = storage[cardKey(c)] || 0;
      const toAdd = c.category === "energy" ? 0 : Math.max(0, c.count - owned);
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
        <td>${owned}</td>
        <td>${toAdd}</td>
        <td>${tag}</td>
      </tr>`;
    })
    .join("");
  detailList.innerHTML = `<table>${thead}<tbody>${tbody}</tbody></table>`;
}

async function renderDetailImages() {
  const uniques = new Map();
  for (const c of current.cards) {
    if (!uniques.has(cardKey(c))) uniques.set(cardKey(c), c);
  }
  const items = Array.from(uniques.values());

  // Render every card box immediately using the cached URL when available, so
  // switching pages is instant (no re-download from the browser cache). Only
  // previously-unseen cards fall through to resolve in the background.
  const frag = document.createDocumentFragment();
  for (const c of items) {
    const card = document.createElement("div");
    card.className = "mini-card";
    const img = document.createElement("img");
    img.alt = c.name;
    const cachedUrl = getCachedImageUrl(c);
    if (cachedUrl) {
      img.src = cachedUrl;
      // If a cached URL is stale/broken, refresh it via the API fallback.
      let tried = false;
      img.addEventListener("error", async () => {
        if (tried) {
          img.alt = "no image: " + (c.name || "");
          img.removeAttribute("src");
          return;
        }
        tried = true;
        clearImgCache([c]);
        delete imagesHtmlCache[current.name];
        const resolved = await createCardImg(c);
        if (resolved.getAttribute("src")) img.src = resolved.getAttribute("src");
        else {
          img.alt = "no image: " + (c.name || "");
          img.removeAttribute("src");
        }
      });
    } else {
      // Not cached yet: resolve now and attach the working image.
      const resolved = await createCardImg(c);
      if (resolved.getAttribute("src")) {
        img.src = resolved.getAttribute("src");
      } else {
        img.alt = "no image: " + c.name;
      }
      img.addEventListener("error", () => {
        img.alt = "no image: " + c.name;
        img.removeAttribute("src");
      });
    }
    card.appendChild(img);
    if (c.count && c.count > 0) {
      const badge = document.createElement("div");
      badge.className = "count-badge";
      badge.textContent = `${c.count}x`;
      card.appendChild(badge);
    }
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = `${c.name} ${c.setCode}`;
    card.appendChild(label);
    frag.appendChild(card);
  }
  detailImages.innerHTML = "";
  detailImages.appendChild(frag);
  imagesHtmlCache[current.name] = detailImages.innerHTML;
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
  renderDetailList();
}

// ---------- Apply deck cards to storage (top up missing) ----------
function applyToStorage() {
  if (!current) return;
  const storage = loadStorage();
  let added = 0;
  let already = 0;
  let energies = 0;
  for (const c of current.cards) {
    if (c.category === "energy") {
      energies++;
      continue;
    }
    const k = cardKey(c);
    const owned = storage[k] || 0;
    const toAdd = Math.max(0, c.count - owned);
    if (toAdd === 0) {
      already++;
    } else {
      storage[k] = owned + toAdd;
      added += toAdd;
    }
  }
  saveStorage(storage);
  const skipNote = energies > 0 ? ` and skipped ${energies} energy card type(s)` : "";
  setMsg(
    detailMsg,
    `Done! Added ${added} card(s) to storage, ${already} already in storage.${skipNote}.`,
    "ok"
  );
  renderDetailList();
}

// ---------- Navigation state ----------
function openDeck(name) {
  current = decks.find((d) => d.name === name) || null;
  if (!current) return;
  renderDetail();
  detailPanel.classList.remove("hidden");
  detailPanel.scrollIntoView({ behavior: "smooth" });
}

function closeDeck() {
  current = null;
  detailPanel.classList.add("hidden");
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
  const oldName = current.name;
  current.name = trimmed;
  if (imagesHtmlCache[oldName]) {
    imagesHtmlCache[trimmed] = imagesHtmlCache[oldName];
    delete imagesHtmlCache[oldName];
  }
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

applyStorageBtn.addEventListener("click", applyToStorage);
removeStorageBtn.addEventListener("click", removeFromStorage);

reloadImagesBtn.addEventListener("click", async () => {
  if (!current) return;
  clearImgCache(current.cards);
  delete imagesHtmlCache[current.name];
  await renderDetailImages();
  setMsg(detailMsg, "Card images reloaded.", "ok");
});

// ---------- Init ----------
renderGrid();
