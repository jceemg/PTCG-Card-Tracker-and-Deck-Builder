"use strict";

// ---------- Storage key (must match app.js / decks.js) ----------
const STORAGE_KEY = "ptcg.storage.v1";

// ---------- Element refs ----------
const $ = (sel) => document.querySelector(sel);
const cardsGrid = $("#cards-grid");
const noCards = $("#no-cards");

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
    return;
  }
  noCards.classList.add("hidden");

  const cards = keys
    .map((key) => ({ key, count: storage[key] || 0 }))
    .filter((c) => c.count > 0);

  // Show a loading indicator while images resolve on the first pass.
  if (cardsGrid.dataset.loaded !== "1") {
    cardsGrid.innerHTML = '<div class="loading">Loading your cards&hellip;</div>';
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

  const frag = document.createDocumentFragment();
  for (const card of ready) frag.appendChild(card);
  cardsGrid.innerHTML = "";
  cardsGrid.appendChild(frag);
  cardsGrid.dataset.loaded = "1";
}

// ---------- Events ----------
cardsGrid.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const cardEl = btn.closest(".owned-card");
  if (!cardEl) return;
  const key = cardEl.dataset.key;
  const delta = parseInt(btn.dataset.delta, 10);

  const storage = loadStorage();
  let cur = storage[key] || 0;
  cur = Math.max(0, cur + delta);
  if (cur === 0) delete storage[key];
  else storage[key] = cur;
  saveStorage(storage);

  await renderCards();
});

// ---------- Init ----------
renderCards();
