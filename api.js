"use strict";

// Shared card-image resolution via the Pokémon TCG API.
// Deck lists use set abbreviations (e.g. SCR) which are the API's ptcgoCode
// values. We map ptcgoCode -> API set.id, then resolve images by set + number.

const PTCG_API = "https://api.pokemontcg.io/v2";
const SETMAP_KEY = "ptcg.setmap.v1";
const IMGCACHE_KEY = "ptcg.imgcache.v1";
const CACHE_MS = 1000 * 60 * 60 * 24; // 24h

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
  const cached = loadCache(SETMAP_KEY, null);
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.map;
  }
  const map = {};
  let page = 1;
  while (true) {
    let r = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const resp = await fetch(`${PTCG_API}/sets?page=${page}&pageSize=100`);
        if (resp.ok) {
          r = await resp.json();
          break;
        }
        await sleep(600 * (attempt + 1));
      } catch (e) {
        await sleep(600 * (attempt + 1));
      }
    }
    if (!r || !r.data) break;
    for (const s of r.data) {
      if (s.ptcgoCode) map[s.ptcgoCode.toLowerCase()] = s.id;
    }
    if (r.data.length < 100) break;
    page++;
  }
  saveCache(SETMAP_KEY, { fetchedAt: Date.now(), map });
  return map;
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

// ---- Resolve card image ----
async function fetchJson(url) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url);
      if (resp.status === 429 || resp.status === 500 || resp.status === 502) {
        // rate limited / transient: back off and retry
        lastErr = resp.status;
        await sleep(700 * (attempt + 1));
        continue;
      }
      if (!resp.ok) return null;
      return await resp.json();
    } catch (e) {
      lastErr = e;
      await sleep(700 * (attempt + 1));
    }
  }
  return { error: lastErr };
}

async function resolveCardImage(c) {
  const key = cardKey(c);
  const imgCache = getImgCache();
  if (imgCache[key] && imgCache[key] !== "NULL") return imgCache[key];
  if (imgCache[key] === "NULL") return null;

  const url = await findImage(c);

  if (url) putImgCache(key, url);
  else putImgCache(key, "NULL");

  return url;
}

async function findImage(c) {
  // Preferred: set.id via ptcgoCode map + card number.
  const setMap = await getSetMap();
  const apiSet = setMap[(c.setCode || "").toLowerCase()];
  if (apiSet && c.number) {
    const q = `set.id:${apiSet} number:${c.number}`;
    const data = await fetchJson(`${PTCG_API}/cards?q=${encodeURIComponent(q)}&pageSize=3`);
    if (data && data.data && data.data.length > 0) {
      return imageOf(data.data[0]);
    }
  }

  // Fallback: search by name, prefer a match on card number.
  const q = `name:"${c.name}"`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const data = await fetchJson(`${PTCG_API}/cards?q=${encodeURIComponent(q)}&pageSize=250`);
    if (data && data.data) {
      if (c.number) {
        const exact = data.data.find((x) => x.number === c.number);
        if (exact) return imageOf(exact);
      }
      if (data.data.length > 0) return imageOf(data.data[0]);
      return null;
    }
    if (data && data.error === 429) {
      await sleep(1000);
      continue;
    }
  }
  return null;
}

function imageOf(card) {
  return card.images && (card.images.large || card.images.small) || null;
}
