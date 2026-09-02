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
const exportBtn = $("#export-btn");
const importBtn = $("#import-btn");
const importFile = $("#import-file");
const backupMsg = $("#backup-msg");

// ---------- State ----------
let decks = [];
let current = null; // the open deck

// Guarantees only the most recent deck's image render is applied to the DOM.
// If the user switches decks while images are still loading, an older async
// render that finishes later must not overwrite the current deck's display.
let renderToken = 0;

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

// Storage entries hold {count, category}. Legacy (plain-number) entries are
// normalized here so we can read counts and preserve categories consistently.
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

// Sum owned copies across all sets for the same card name + number.
function ownedTotal(storage, name, number) {
  const id = `${(name || "").toLowerCase()}|${number || ""}`;
  let total = 0;
  for (const [key, val] of Object.entries(storage)) {
    const parts = key.split("|");
    const keyId = `${(parts[0] || "").toLowerCase()}|${parts[2] || ""}`;
    if (keyId === id) total += storageEntry(val).count;
  }
  return total;
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

// Pick the card used as a deck's thumbnail. The user can set an explicit
// coverIndex (index into deck.cards); otherwise fall back to the first
// non-energy card, or the first card, or null for an empty deck.
function coverCard(deck) {
  const cards = deck.cards || [];
  if (
    typeof deck.coverIndex === "number" &&
    Number.isInteger(deck.coverIndex) &&
    deck.coverIndex >= 0 &&
    deck.coverIndex < cards.length
  ) {
    return cards[deck.coverIndex];
  }
  return cards.find((c) => c.category !== "energy") || cards[0] || null;
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
    const cover = coverCard(deck);
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
      <tr><th>Card</th><th>Set</th><th>Count</th><th>In Storage</th><th>To Add</th><th>Status</th><th>Cover</th></tr>
    </thead>`;
  const tbody = current.cards
    .map((c, i) => {
      const owned = ownedTotal(storage, c.name, c.number);
      const toAdd = c.category === "energy" ? 0 : Math.max(0, c.count - owned);
      let tag;
      if (c.category === "energy") {
        tag = '<span class="tag energy">Energy</span>';
      } else if (toAdd === 0) {
        tag = '<span class="tag ok">Have it</span>';
      } else {
        tag = '<span class="tag topup">Add ' + toAdd + "</span>";
      }
      const isCover = coverCard(current) === c;
      const coverCell = isCover
        ? '<span class="cover-badge" title="This is the deck thumbnail">&bull; Cover</span>'
        : '<button class="cover-btn" data-cover="' + i + '">Set cover</button>';
      return `<tr>
        <td>${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.setCode)}</td>
        <td>${c.count}</td>
        <td>${owned}</td>
        <td>${toAdd}</td>
        <td>${tag}</td>
        <td>${coverCell}</td>
      </tr>`;
    })
    .join("");
  detailList.innerHTML = `<table>${thead}<tbody>${tbody}</tbody></table>`;
}

async function renderDetailImages() {
  // Claim this render; if a newer one starts while images are loading, this
  // one must not overwrite the display when it finishes.
  const token = ++renderToken;
  const deckName = current.name;

  // Clear any previous deck's images immediately and show a loading state so
  // stale cards from the last deck never show while this one is loading.
  detailImages.innerHTML = '<div class="loading">Loading card images&hellip;</div>';

  const uniques = new Map();
  for (const c of current.cards) {
    if (!uniques.has(cardKey(c))) uniques.set(cardKey(c), c);
  }
  const items = Array.from(uniques.values());

  // Resolve every card image in parallel so one slow card (e.g. a promo "me"
  // set) doesn't block the rest, then render them together. deckName is passed
  // to buildMiniCard so an image error that fires after the user switches
  // decks clears the right deck's image cache.
  const ready = await Promise.all(items.map(async (c) => buildMiniCard(c, deckName)));

  // Discard the result if the user switched decks while we were loading.
  if (token !== renderToken || current.name !== deckName) return;

  const frag = document.createDocumentFragment();
  for (const mini of ready) frag.appendChild(mini);
  detailImages.innerHTML = "";
  detailImages.appendChild(frag);
  imagesHtmlCache[deckName] = detailImages.innerHTML;
}

// Build one mini-card. Uses the cached URL when available so switching decks
// is instant; otherwise resolves it (with an error fallback). deckName is the
// deck this card belongs to, so error retries clear the correct image cache.
async function buildMiniCard(c, deckName) {
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
      delete imagesHtmlCache[deckName];
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
  return card;
}

// ResolveCardImage is defined in api.js (shared).

// ---------- Remove deck cards from storage ----------
// Removes across all sets that share the same name + number.
function removeFromStorage() {
  if (!current) return;
  const storage = loadStorage();

  // Sum deck needs by name+number identity.
  const deckNeeds = new Map();
  for (const c of current.cards) {
    const id = `${c.name.toLowerCase()}|${c.number}`;
    deckNeeds.set(id, (deckNeeds.get(id) || 0) + c.count);
  }

  let removed = 0;
  for (const [id, needed] of deckNeeds) {
    let remaining = needed;
    // Subtract from every storage entry matching this name+number.
    for (const [key, val] of Object.entries(storage)) {
      if (remaining <= 0) break;
      const parts = key.split("|");
      const keyId = `${(parts[0] || "").toLowerCase()}|${parts[2] || ""}`;
      if (keyId !== id) continue;
      const entry = storageEntry(val);
      const take = Math.min(entry.count, remaining);
      if (take >= entry.count) delete storage[key];
      else storage[key] = { count: entry.count - take, category: entry.category };
      remaining -= take;
      removed += take;
    }
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
    const total = ownedTotal(storage, c.name, c.number);
    const toAdd = Math.max(0, c.count - total);
    if (toAdd === 0) {
      already++;
    } else {
      const k = cardKey(c);
      const specific = storageCount(storage, k);
      setStorageEntry(storage, k, specific + toAdd, c.category);
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
  closeDeck();
});

applyStorageBtn.addEventListener("click", applyToStorage);
removeStorageBtn.addEventListener("click", removeFromStorage);

// Let the user choose which card of a deck becomes its thumbnail.
detailList.addEventListener("click", (e) => {
  const btn = e.target.closest(".cover-btn");
  if (!btn || !current) return;
  const idx = parseInt(btn.dataset.cover, 10);
  if (isNaN(idx) || idx < 0 || idx >= current.cards.length) return;
  current.coverIndex = idx;
  saveDecks(decks);
  renderDetailList();
  renderGrid();
});

// ---------- Backup & restore ----------
// Export wraps both storage and decks (the two things this app saves) so a
// single file can recreate the whole collection. Includes a version stamp for
// future-proofing.
exportBtn.addEventListener("click", () => {
  const backup = {
    app: "ptcg-tracker",
    version: 1,
    exported: new Date().toISOString(),
    storage: loadStorage(),
    decks: loadDecks()
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ptcg-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setMsg(backupMsg, "Backup downloaded.", "ok");
});

importBtn.addEventListener("click", () => importFile.click());

importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (
      !data ||
      typeof data !== "object" ||
      data.app !== "ptcg-tracker" ||
      !data.storage ||
      !Array.isArray(data.decks)
    ) {
      throw new Error("Not a PTCG Collection & Deck Builder backup file.");
    }
    if (!confirm(
      "Restore will REPLACE your current card storage and decks with the contents of this backup file. Continue?"
    )) {
      return;
    }
    saveStorage(data.storage);
    saveDecks(data.decks);
    // Drop in-memory render caches so re-opened decks show fresh images.
    for (const key of Object.keys(imagesHtmlCache)) delete imagesHtmlCache[key];
    current = null;
    detailPanel.classList.add("hidden");
    await renderGrid();
    setMsg(backupMsg, "Backup restored. Your cards and decks have been replaced.", "ok");
  } catch (e) {
    setMsg(backupMsg, "Could not restore: " + e.message, "err");
  } finally {
    importFile.value = "";
  }
});

// ---------- Init ----------
renderGrid();
