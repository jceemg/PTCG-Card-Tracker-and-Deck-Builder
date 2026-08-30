# PTCG Card Tracker & Deck Builder

A card collection tracker. Paste your deck list and the app checks your card storage: if you don't have enough copies of a card yet, it adds them; if you already do, it tells you — so you always know which cards you still need.

Web app with **no build step or server required**: open `index.html` in any modern browser and it just works. Each user's card storage lives in their **own browser's localStorage**, so everyone who uses it gets a separate, private collection.

## Features

- **Paste a deck list** — the app parses a standard list like this:

  ```
  4 Slowpoke SCR 57
  3 Slowking SCR 58
  3 Mega Kangaskhan ex MEG 104
  4 Poké Pad POR 81
  ...
  ```

- **Deck summary** — shows each card, how many the deck needs, how many you already own, and how many should be added.
- **Top-up to storage** — for every non-energy card, if you own fewer copies than the deck needs, it adds the missing amount to your card storage until you reach the deck count. If you already have enough, nothing is added.
- **Energy handling** — energy cards are shown and can be tracked, but are **never auto-added** to storage (toggleable).
- **Storage manager** — view all cards you own, with + / − / remove buttons.
- **Saved decks** — save your parsed deck under a name, then open the **My Decks** page to see them as thumbnails. Click a deck to view its full list with card images, rename, delete, or **remove the deck's cards from your card storage** (undoing the top-up).

## How the top-up rule works

For a card the deck needs `N` copies of:

| In storage | Added | Result in storage |
|-----------|-------|-------------------|
| 0 | N | N |
| 2 | N − 2 | N |
| N or more | 0 | unchanged |

## Files

- `index.html` — the tracker page structure
- `decks.html` — the My Decks page structure
- `styles.css` — styling
- `api.js` — shared Pokémon TCG API image resolution (set code mapping + caching)
- `app.js` — parsing, storage logic, API integration (tracker page)
- `decks.js` — saved-deck thumbnails, detail view, remove-from-storage (decks page)

## Note on the API

Card images come from the public Pokémon TCG API (no key needed for basic use). Deck list set abbreviations (e.g. `SCR`, `MEG`, `SSP`) are mapped to the API's set IDs via each set's `ptcgoCode`, then the exact card is found by its number. Resolved images are cached in localStorage for 24 hours so repeated viewings are fast and don't hit the API repeatedly.
