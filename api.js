"use strict";

// Shared card-image resolution for the Pokémon TCG.
//
// Deck lists use set abbreviations (e.g. SCR) which correspond to the API's
// ptcgoCode. We map those abbreviations to an API set.id, then build the image
// URL directly from the pokemontcg.io CDN (no API call) for the common case.
// A few promo "me" sets (me3-me5, me2pt5) still aren't on the CDN and need a
// slow API lookup, which callers trigger on img error. me1/me2 are now on the
// CDN and use the fast path.

const PTCG_API = "https://api.pokemontcg.io/v2";
const IMG_CDN = "https://images.pokemontcg.io";
const SETMAP_KEY = "ptcg.setmap.v1";
const IMGCACHE_KEY = "ptcg.imgcache.v1";
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
  asc: "me2pt5", mee: "mee",
};

// Promo "me" sets whose images are NOT served by the pokemontcg.io CDN. Only
// these still need the slow API/scrydex fallback; the others (me1, me2) now
// exist on the CDN and can use the fast direct-URL path. The stored keys are
// the ptcgoCodes (lowercase) from BUILTIN_SETMAP.
const ME_CDN_MISSING = new Set(["por", "cri", "pbl", "asc", "mee"]);

// ---- Rate limiter (falls back for API lookups) ----
let lastRequest = 0;
let queue = Promise.resolve();
const MIN_GAP = 300;
const MAX_RETRIES = 5;

function throttledFetch(url) {
  const run = async () => {
    const wait = Math.max(0, lastRequest + MIN_GAP - Date.now());
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
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
// The result is memoized so the many cards being resolved at once share a
// single map lookup instead of each re-reading localStorage / re-checking the
// cache. Refreshes are still fired in the background, never blocking the UI.
let setMapPromise = null;
function getSetMap() {
  if (setMapPromise) return setMapPromise;

  const resolve = async () => {
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
      } finally {
        // Allow the next getSetMap() call to rebuild from the refreshed cache
        // instead of being stuck with this session's first snapshot forever.
        setMapPromise = null;
      }
    })();

    return Object.assign(map, cached ? cached.map : {});
  };

  setMapPromise = resolve();
  return setMapPromise;
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

// Synchronously return the cached image URL for a card, or null if it isn't
// cached yet. Lets callers render known images instantly without re-resolving.
function getCachedImageUrl(c) {
  const c2 = getImgCache();
  const url = c2[cardKey(c)];
  return url && url !== "NULL" ? url : null;
}

// Drop cached image URLs for a set of cards so they are re-resolved on the
// next load. Used for automatic retry when an image fails to load.
function clearImgCache(cards) {
  const c = getImgCache();
  let changed = false;
  for (const card of cards || []) {
    const k = cardKey(card);
    if (k in c) {
      delete c[k];
      changed = true;
    }
  }
  if (changed) saveCache(IMGCACHE_KEY, c);
}

function cardKey(c) {
  return `${c.name}|${c.setCode}|${c.number || ""}`;
}

// ---- Direct URL from set.id + number (fast path, no API call) ----
function directImageUrl(c, setMap) {
  const id = (c.setCode || "").toLowerCase();
  const apiSet = setMap[id];
  // A few promo "me" sets (me3-me5, me2pt5, mee) are still not on the CDN and
  // 404 there; they need the scrydex fallback. me1/me2 now work on the CDN.
  if (ME_CDN_MISSING.has(id)) return null;
  if (apiSet && c.number) {
    return `${IMG_CDN}/${apiSet}/${c.number}_hires.png`;
  }
  return null;
}

// Scrydex hosts the promo "me" sets (me3-me5, me2pt5, mee) that are missing
// from the pokemontcg.io CDN. It uses the same API set id + collector number,
// e.g. https://images.scrydex.com/pokemon/mee-5/large. Built directly, so it's
// fast (no API call) and reliable, unlike the API's imageOf() which returns the
// doomed CDN URL for these sets.
function scrydexImageUrl(c, setMap) {
  const id = (c.setCode || "").toLowerCase();
  if (!ME_CDN_MISSING.has(id)) return null;
  const apiSet = setMap[id];
  if (apiSet && c.number) {
    return `https://images.scrydex.com/pokemon/${apiSet}-${c.number}/large`;
  }
  return null;
}

// ---- Resolve image: prefer cached, then direct URL, then API lookups ----
async function resolveCardImage(c) {
  const key = cardKey(c);
  const imgCache = getImgCache();
  const code = (c.setCode || "").toLowerCase();

  // 1. Known good cached URL. This is the common case and must be fast, so we
  //    avoid awaiting the set map here. The only special case is stale CDN
  //    URLs for the few promo sets still missing from the CDN, which we can
  //    detect synchronously from the ptcgoCode.
  const cachedUrl = imgCache[key];
  if (cachedUrl && cachedUrl !== "NULL") {
    const isStandardCdn = cachedUrl.indexOf(IMG_CDN + "/") === 0;
    if (!(ME_CDN_MISSING.has(code) && isStandardCdn)) return cachedUrl;
  }

  // 2. Direct CDN URL (fast). Checked before honoring a cached "NULL" so a
  //    stale "known bad" entry (from before a set appeared on the CDN) can be
  //    replaced once the set actually has a valid direct URL.
  const setMap = await getSetMap();
  const direct = directImageUrl(c, setMap);
  if (direct) {
    putImgCache(key, direct);
    return direct;
  }

  // 2b. Scrydex fallback for promo sets missing from the CDN. Built directly
  //     (no API call) and caches fine, covering me3-me5 / me2pt5 / mee.
  const scrydex = scrydexImageUrl(c, setMap);
  if (scrydex) {
    putImgCache(key, scrydex);
    return scrydex;
  }

  // 3. Known-bad (already tried API and failed).
  if (imgCache[key] === "NULL") return null;

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

// ---- Lightbox: click any card image to view full-size ----
(function initLightbox() {
  const overlay = document.createElement("div");
  overlay.className = "lightbox";
  overlay.innerHTML =
    '<button class="lightbox-close" aria-label="Close">&times;</button>' +
    '<img class="lightbox-img" alt="Full-size card">';
  document.body.appendChild(overlay);

  const img = overlay.querySelector(".lightbox-img");
  const closeBtn = overlay.querySelector(".lightbox-close");

  function open(src, alt) {
    img.src = src;
    img.alt = alt || "";
    overlay.classList.add("open");
    document.body.style.overflow = "hidden";
  }
  function close() {
    overlay.classList.remove("open");
    img.src = "";
    document.body.style.overflow = "";
  }

  overlay.addEventListener("click", (e) => {
    if (e.target !== overlay) return;
    close();
  });
  closeBtn.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) close();
  });
  img.addEventListener("click", (e) => e.stopPropagation());

  document.addEventListener("click", (e) => {
    const target = e.target;
    if (target.tagName !== "IMG") return;
    if (target.closest(".lightbox")) return;
    const container = target.closest(".owned-card, .mini-card, .deck-thumb");
    if (!container) return;
    if (target.src) {
      e.preventDefault();
      open(target.src, target.alt);
    }
  });
})();
