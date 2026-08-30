"use strict";

// ---------- Storage key (must match app.js / decks.js) ----------
const STORAGE_KEY = "ptcg.storage.v1";

// ---------- Element refs ----------
const $ = (sel) => document.querySelector(sel);
const cardsGrid = $("#cards-grid");
const noCards = $("#no-cards");
const cardsSearch = $("#cards-search");

let cardsQuery = "";

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
// normalized here so we can group by category without migrating every card.
function storageEntry(v) {
  if (v && typeof v === "object" && typeof v.count === "number") {
    return { count: v.count, category: v.category || null };
  }
  if (typeof v === "number") return { count: v, category: null };
  return { count: 0, category: null };
}

// Display order: Pokémon first, then Trainer (Support), then Energy. Cards with
// no known category (added before categories existed) come last.
const CATEGORY_RANK = { pokemon: 0, trainer: 1, energy: 2 };
function categoryRank(category) {
  return category in CATEGORY_RANK ? CATEGORY_RANK[category] : 3;
}
const CATEGORY_LABEL = { 0: "Pokémon", 1: "Trainer / Support", 2: "Energy", 3: "Other" };

// ---------- Build a card object from a storage key "name|setCode|number" ----------
function cardFromKey(key) {
  const [name, setCode, number] = key.split("|");
  return { name, setCode, number };
}

// ---------- Render each stored card as an image with +/-- controls above ----------
async function renderCards() {
  const storage = loadStorage();
  const keys = Object.keys(storage).sort((a, b) => a.localeCompare(b));

  if (keys.length === 0) {
    cardsGrid.innerHTML = "";
    noCards.classList.remove("hidden");
    noCards.textContent = "No cards yet. Paste a deck list on the Tracker and apply it to your card storage.";
    return;
  }
  noCards.classList.add("hidden");

  // Include each card's category so we can group them, then order by
  // Pokémon -> Trainer -> Energy -> Other. Unknown-category (legacy) cards
  // land in the "Other" group at the end.
  const cards = keys
    .map((key) => {
      const entry = storageEntry(storage[key]);
      return { key, count: entry.count, category: entry.category };
    })
    .filter((c) => c.count > 0)
    .filter((c) => {
      if (!cardsQuery) return true;
      return c.key.toLowerCase().includes(cardsQuery);
    });

  // No cards match the current search, but cards do exist.
  if (cards.length === 0) {
    cardsGrid.innerHTML = "";
    noCards.classList.remove("hidden");
    noCards.textContent = "No cards match your search.";
    return;
  }

  // Show a loading indicator while images resolve on the first pass.
  if (cardsGrid.dataset.loaded !== "1") {
    cardsGrid.innerHTML = '<div class="loading">Loading your cards&hellip;</div>';
  }

  cards.sort((a, b) => {
    const dr = categoryRank(a.category) - categoryRank(b.category);
    if (dr !== 0) return dr;
    return a.key.localeCompare(b.key);
  });

  // Group cards by rank so we can insert a heading before each block.
  const groups = new Map(); // rank -> [cards]
  for (const c of cards) {
    const rank = categoryRank(c.category);
    if (!groups.has(rank)) groups.set(rank, []);
    groups.get(rank).push(c);
  }

  // Resolve every card image in parallel so a slow card doesn't block the rest.
  const ready = await Promise.all(
    cards.map(async ({ key, count }) => {
      const { name, setCode, number } = cardFromKey(key);
      const card = document.createElement("div");
      card.className = "owned-card";
      card.dataset.key = key;

      const controls = document.createElement("div");
      controls.className = "card-controls";
      const minus = document.createElement("button");
      minus.className = "small";
      minus.textContent = "−";
      minus.dataset.delta = "-1";
      const countEl = document.createElement("span");
      countEl.className = "card-count";
      countEl.textContent = count;
      const plus = document.createElement("button");
      plus.className = "small";
      plus.textContent = "+";
      plus.dataset.delta = "1";
      controls.appendChild(minus);
      controls.appendChild(countEl);
      controls.appendChild(plus);

      const img = await createCardImg({ name, setCode, number });

      const label = document.createElement("div");
      label.className = "label";
      label.textContent = `${name} ${setCode}`;

      card.appendChild(controls);
      card.appendChild(img);
      card.appendChild(label);
      return card;
    })
  );

  // Build groups in order, each with a heading, into a fragment.
  const frag = document.createDocumentFragment();
  const cardByKey = new Map();
  cards.forEach((c, i) => cardByKey.set(c.key, ready[i]));
  const ranks = [...groups.keys()].sort((a, b) => a - b);
  for (const rank of ranks) {
    const heading = document.createElement("div");
    heading.className = "cards-section";
    heading.textContent = CATEGORY_LABEL[rank];
    frag.appendChild(heading);
    for (const c of groups.get(rank)) {
      frag.appendChild(cardByKey.get(c.key));
    }
  }
  cardsGrid.innerHTML = "";
  cardsGrid.appendChild(frag);
  cardsGrid.dataset.loaded = "1";
}

// ---------- Events ----------
cardsSearch.addEventListener("input", () => {
  const query = cardsSearch.value.trim().toLowerCase();
  if (query === cardsQuery) return;
  cardsQuery = query;
  // Reset the loading flag so a fresh (filtered) grid shows the indicator
  // instead of briefly reusing stale cards.
  delete cardsGrid.dataset.loaded;
  renderCards();
});

cardsGrid.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const cardEl = btn.closest(".owned-card");
  if (!cardEl) return;
  const key = cardEl.dataset.key;
  const delta = parseInt(btn.dataset.delta, 10);

  const storage = loadStorage();
  const entry = storageEntry(storage[key]);
  let cur = entry.count;
  cur = Math.max(0, cur + delta);
  if (cur === 0) delete storage[key];
  else storage[key] = { count: cur, category: entry.category };
  saveStorage(storage);

  await renderCards();
});

// ---------- Init ----------
renderCards();
