"use strict";

// Shared card-image resolution for the Pokémon TCG.
//
// Deck lists use set abbreviations (e.g. SCR) which correspond to the API's
// ptcgoCode. We map those abbreviations to an API set.id, then build the image
// URL directly from the pokemontcg.io CDN (no API call) for the common case.
// Only cards whose images aren't on the CDN (a few promo "me" sets hosted on
// scrydex.com) need a slow API lookup, which callers trigger on img error.

const PTCG_API = "https://api.pokemontcg.io/v2";
const IMG_CDN = "https://images.pokemontcg.io";
const SETMAP_KEY = "ptcg.setmap.v1";
const IMGCACHE_KEY = "ptcg.imgcache.v1";
const SUPERTYPE_KEY = "ptcg.supertp.v1";
const SETSUPERTYPE_KEY = "ptcg.setsupertp.v1";
const CACHE_MS = 1000 * 60 * 60 * 24; // 24h

// Built-in map of common set abbreviations -> API set.id, so the first load
// can build image URLs immediately without waiting on the API. Cached/API
// results are merged on top of this at runtime.
const BUILTIN_SETMAP = {
  svi: "sv1", obt: "sv2", obf: "sv3", par: "sv4", tef: "sv5",
  twm: "sv6", scr: "sv7", ssp: "sv8", jtg: "sv9", dri: "sv10",
  sfa: "sv6pt5", pal: "sv2", ori: "sv3pt5", pald: "sv4pt5",
  prf: "sv5pt5", tfr: "sv6pt5", sip: "sv7pt5", pre: "sv8pt5",
  mew: "sv3pt5", tgr: "sv6pt5", "151": "sv3pt5",
  sv01: "sv1", sv02: "sv2", sv03: "sv3", sv04: "sv4",
  ace: "sv8pt5", prm: "piv", sve: "sve", svp: "svp",
  meg: "me1", pfl: "me2", por: "me3", cri: "me4", pbl: "me5",
  asc: "me2pt5",
};

// ---- Rate limiter (falls back for API lookups) ----
let lastRequest = 0;
let queue = Promise.resolve();
const MIN_GAP = 300;
const MAX_RETRIES = 5;

function throttledFetch(url, maxRetries) {
  const limit = typeof maxRetries === "number" ? maxRetries : MAX_RETRIES;
  const run = async () => {
    const wait = Math.max(0, lastRequest + MIN_GAP - Date.now());
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    for (let attempt = 0; attempt < limit; attempt++) {
      try {
        const resp = await fetch(url);
        if (resp.status === 429 || resp.status === 500 || resp.status === 502) {
          await sleep(700 * (attempt + 1));
          continue;
        }
        if (!resp.ok) return null;
        const text = await resp.text();
        return text ? JSON.parse(text) : null;
      } catch (e) {
        await sleep(700 * (attempt + 1));
      }
    }
    return null;
  };
  const result = queue.then(run, run);
  queue = result.then(() => {}, () => {});
  return result;
}

async function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function loadCache(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function saveCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    /* ignore quota errors */
  }
}

// ---- Set map: ptcgoCode (lowercase) -> API set.id ----
async function getSetMap() {
  const map = Object.assign({}, BUILTIN_SETMAP);
  const cached = loadCache(SETMAP_KEY, null);

  // Refresh the API set list occasionally, but never block on it.
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return Object.assign(map, cached.map);
  }

  // Fire the refresh in the background; return with what we have now.
  (async () => {
    try {
      const fresh = {};
      let page = 1;
      for (let tries = 0; tries < 3; tries++) {
        const r = await throttledFetch(`${PTCG_API}/sets?page=${page}&pageSize=100`);
        if (!r || !r.data) break;
        for (const s of r.data) fresh[s.ptcgoCode.toLowerCase()] = s.id;
        if (r.data.length < 100) break;
        page++;
      }
      saveCache(SETMAP_KEY, { fetchedAt: Date.now(), map: Object.assign({}, BUILTIN_SETMAP, fresh) });
    } catch (e) {
      /* keep current set map */
    }
  })();

  return Object.assign(map, cached ? cached.map : {});
}

// ---- Image cache: card key -> url ----
function getImgCache() {
  return loadCache(IMGCACHE_KEY, {});
}

function putImgCache(key, url) {
  const c = getImgCache();
  c[key] = url;
  saveCache(IMGCACHE_KEY, c);
}

function cardKey(c) {
  return `${c.name}|${c.setCode}|${c.number || ""}`;
}

// ---- Direct URL from set.id + number (fast path, no API call) ----
function directImageUrl(c, setMap) {
  const id = (c.setCode || "").toLowerCase();
  const apiSet = setMap[id];
  // Promo "me" sets (me1-me5, me2pt5) are not on the images.pokemontcg.io
  // CDN; they 404 there and live on scrydex.com instead. Skip the direct URL
  // so we go straight to the reliable API/scrydex lookup.
  if ((apiSet || "").toLowerCase().startsWith("me")) return null;
  if (apiSet && c.number) {
    return `${IMG_CDN}/${apiSet}/${c.number}_hires.png`;
  }
  return null;
}

// ---- Resolve image: prefer cached, then direct URL, then API lookups ----
async function resolveCardImage(c) {
  const key = cardKey(c);
  const imgCache = getImgCache();

  // 1. Known good cached URL.
  if (imgCache[key] && imgCache[key] !== "NULL") {
    // Ignore stale CDN URLs for promo "me" sets (they 404; scrydex is correct).
    const setMap0 = await getSetMap();
    const id0 = (c.setCode || "").toLowerCase();
    const apiSet0 = setMap0[id0];
    const isMeSet = (apiSet0 || "").toLowerCase().startsWith("me");
    const isStandardCdn = imgCache[key].indexOf(IMG_CDN + "/") === 0;
    if (!(isMeSet && isStandardCdn)) return imgCache[key];
  }
  // 2. Known-bad (already tried API and failed).
  if (imgCache[key] === "NULL") return null;

  // 3. Direct CDN URL (fast).
  const setMap = await getSetMap();
  const direct = directImageUrl(c, setMap);
  if (direct) {
    putImgCache(key, direct);
    return direct;
  }

  // 4. Slow API fallback (only for cards we could not map directly).
  const url = await findImageViaApi(c);
  if (url) putImgCache(key, url);
  else putImgCache(key, "NULL");
  return url;
}

// Called by callers' onerror handler when the fast direct URL failed to load
// (e.g. scrydex-only sets). Runs the slow API lookup for this one card.
async function resolveCardImageViaApi(c) {
  const key = cardKey(c);
  const url = await findImageViaApi(c);
  if (url) putImgCache(key, url);
  else putImgCache(key, "NULL");
  return url;
}

async function findImageViaApi(c) {
  const setMap = await getSetMap();
  const apiSet = setMap[(c.setCode || "").toLowerCase()];
  if (apiSet && c.number) {
    const q = `set.id:${apiSet} number:${c.number}`;
    const data = await throttledFetch(`${PTCG_API}/cards?q=${encodeURIComponent(q)}&pageSize=3`);
    if (data && data.data && data.data.length > 0) return imageOf(data.data[0]);
  }
  const q = `name:"${c.name}"`;
  const data = await throttledFetch(`${PTCG_API}/cards?q=${encodeURIComponent(q)}&pageSize=250`);
  if (data && data.data) {
    if (c.number) {
      const exact = data.data.find((x) => x.number === c.number);
      if (exact) return imageOf(exact);
    }
    if (data.data.length > 0) return imageOf(data.data[0]);
  }
  return null;
}

function imageOf(card) {
  return card.images && (card.images.large || card.images.small) || null;
}

// ---- Supertype classification (pokemon / support / energy) ----
// Classify in bulk by set: fetch each set's full card list once (a handful of
// requests) and record every card's supertype, so a deck needs only ~1-3 API
// calls regardless of card count. All results are cached in localStorage.

function mapSupertype(st) {
  const s = (st || "").toLowerCase().replace(/[éÉ]/g, "e");
  if (s === "trainer") return "support";
  if (s === "pokemon") return "pokemon";
  if (s === "energy") return "energy";
  // Unlikely, but default to pokemon if we cannot tell.
  return "pokemon";
}

// In-flight set fetches so parallel calls don't double-request a set.
const setInflight = {};

function getSetSupertypeCache() {
  return loadCache(SETSUPERTYPE_KEY, {});
}

function putSetSupertypeCache(setId, map) {
  const c = getSetSupertypeCache();
  c[setId] = { fetchedAt: Date.now(), cards: map };
  saveCache(SETSUPERTYPE_KEY, c);
}

// Return { [number]: "pokemon"|"support"|"energy" } for a set id.
async function resolveSetSupertypes(setId) {
  const cache = getSetSupertypeCache();
  const cached = cache[setId];
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return cached.cards;
  if (setInflight[setId]) return setInflight[setId];

  setInflight[setId] = (async () => {
    const map = {};
    let page = 1;
    for (;;) {
      const r = await throttledFetch(
        `${PTCG_API}/cards?q=${encodeURIComponent(`set.id:${setId}`)}&page=${page}&pageSize=250`,
        2
      );
      if (!r || !r.data || r.data.length === 0) break;
      for (const card of r.data) {
        if (card.number) map[card.number] = mapSupertype(card.supertype);
      }
      if (r.data.length < 250) break;
      page++;
    }
    putSetSupertypeCache(setId, map);
    return map;
  })().finally(() => {
    delete setInflight[setId];
  });

  return setInflight[setId];
}

// Return "pokemon", "support" or "energy" for a card.
async function resolveCardCategory(c) {
  const key = cardKey(c);
  const cache = getSupertypeCache();
  if (cache[key]) return cache[key];

  // Energy is determinable from the deck line itself.
  if ((c.category || "").toLowerCase() === "energy") {
    putSupertypeCache(key, "energy");
    return "energy";
  }

  let cat = "pokemon";
  const setMap = await getSetMap();
  const apiSet = setMap[(c.setCode || "").toLowerCase()];
  if (apiSet) {
    // One bulk request classifies every card in the set.
    const setCats = await resolveSetSupertypes(apiSet);
    if (setCats[c.number]) cat = setCats[c.number];
  }

  // Fallback: single name-based lookup if the set path gave us nothing.
  if (c.category !== "energy" && !(apiSet && getSetSupertpHas(apiSet, c.number))) {
    const q = `name:"${c.name}"`;
    const data = await throttledFetch(`${PTCG_API}/cards?q=${encodeURIComponent(q)}&pageSize=5`, 1);
    if (data && data.data) {
      const hit =
        data.data.find((x) => !c.number || x.number === c.number) || data.data[0];
      if (hit) {
        const m = mapSupertype(hit.supertype);
        if (m !== "pokemon") cat = m;
      }
    }
  }

  putSupertypeCache(key, cat);
  return cat;
}

function getSetSupertpHas(setId, number) {
  const c = getSetSupertypeCache();
  return !!(c[setId] && c[setId].cards && c[setId].cards[number]);
}

// ---- Build an <img> for a card with automatic API fallback ----
// Fast path uses the direct CDN URL (no API call). If that image fails to
// load (rare scrydex-only sets), we fall back to a slow API lookup for just
// that card and swap the src.
async function createCardImg(c, alt) {
  const img = document.createElement("img");
  img.alt = alt || c.name || "";
  let triedFallback = false;

  // Resolve the primary (cached/direct) source.
  const src = await resolveCardImage(c);
  if (!src) {
    img.alt = "no image: " + (alt || c.name || "");
    return img;
  }
  img.src = src;

  img.addEventListener("error", () => {
    if (triedFallback) {
      img.alt = "no image: " + (alt || c.name || "");
      img.removeAttribute("src");
      return;
    }
    triedFallback = true;
    // Retry this one card through the slow API path (e.g. scrydex sets).
    resolveCardImageViaApi(c).then((url) => {
      if (url) img.src = url;
      else {
        img.alt = "no image: " + (alt || c.name || "");
        img.removeAttribute("src");
      }
    });
  });

  return img;
}
