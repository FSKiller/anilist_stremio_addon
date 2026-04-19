/**
 * Multi-source metadata resolution — season chain walking and episode aggregation.
 *
 * Provides buildMultiSeasonVideos(rootAniListId, stremioId) which:
 *  1. Walks AniList's SEQUEL relation chain to discover all real seasons of a franchise.
 *  2. Fetches per-season episode data from Kitsu (episode titles + numbers).
 *  3. Assembles a Stremio `videos` array spanning all seasons.
 *
 * The resulting video IDs use the format "{stremioId}:{season}:{episode}", which is
 * already understood by the existing stream endpoint.
 *
 * @module services/meta
 */

const axios = require('axios');
const { ANILIST_API_URL } = require('../config/constants');
const mappingsStore = require('../config/mappings');

const KITSU_API_URL = 'https://kitsu.io/api/edge';

// In-memory caches with 1-hour TTL — season data is stable enough for this window.
const seasonChainCache = new Map(); // rootAniListId (string) → { chain, ts }
const kitsuEpisodesCache = new Map(); // kitsuId (string) → { episodes, ts }
const anilistKitsuCache = new Map(); // anilistId (string) → kitsuId (string|null)
const CACHE_TTL_MS = 60 * 60 * 1000;

function _isExpired(ts) {
  return Date.now() - ts > CACHE_TTL_MS;
}

// AniList formats that represent a full season (skip OVA, MOVIE, SPECIAL, MUSIC).
const SEASON_FORMATS = new Set(['TV', 'ONA', 'TV_SHORT']);

const SEASON_CHAIN_QUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      id
      title { english romaji }
      format
      episodes
      status
      seasonYear
      externalLinks { url site }
      relations {
        edges {
          relationType
          node {
            id
            type
            format
          }
        }
      }
    }
  }
`;

/**
 * Maps an AniList ID to its Kitsu ID using the Kitsu mappings API.
 * Results are cached in-memory for the process lifetime.
 *
 * @private
 * @param {string|number} anilistId
 * @returns {Promise<string|null>}
 */
async function _mapAniListToKitsu(anilistId) {
  const key = String(anilistId);
  if (anilistKitsuCache.has(key)) return anilistKitsuCache.get(key);
  try {
    const qs = `filter[externalSite]=anilist/anime&filter[externalId]=${encodeURIComponent(anilistId)}&include=item&page[limit]=1`;
    const response = await axios.get(
      `${KITSU_API_URL}/mappings?${qs}`,
      { headers: { 'Accept': 'application/vnd.api+json' }, timeout: 10000 }
    );
    const kitsuId = response.data?.data?.[0]?.relationships?.item?.data?.id;
    const result = kitsuId ? String(kitsuId) : null;
    anilistKitsuCache.set(key, result);
    return result;
  } catch (err) {
    console.warn(`_mapAniListToKitsu(${anilistId}): ${err.message}`);
    return null;
  }
}

/**
 * Extracts a numeric Kitsu ID from an AniList externalLinks array.
 * Uses the same URL pattern as services/anilist.js extractKitsuId().
 *
 * @private
 * @param {Array<{url:string, site:string}>} externalLinks
 * @returns {string|null}
 */
function _extractKitsuId(externalLinks) {
  if (!Array.isArray(externalLinks)) return null;
  const link = externalLinks.find(l => l.site === 'Kitsu' && l.url);
  if (!link) return null;
  const match = link.url.match(/kitsu\.(?:io|app)\/anime\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Walks the AniList SEQUEL chain from rootAniListId, collecting all TV/ONA/TV_SHORT
 * season entries in order. Results are cached for 1 hour.
 *
 * Each returned entry has:
 *   anilistId, title, format, episodes (may be null if airing), seasonYear, externalLinks
 *
 * @param {string|number} rootAniListId
 * @returns {Promise<Array<Object>>}
 */
async function getSeasonChain(rootAniListId) {
  const cacheKey = String(rootAniListId);

  // 1. In-memory cache (1-hour TTL)
  const cached = seasonChainCache.get(cacheKey);
  if (cached && !_isExpired(cached.ts)) return cached.chain;

  // 2. Persistent store (7-day TTL) — avoids re-walking the AniList API on restarts
  const persistent = mappingsStore.getSeasonChain(rootAniListId);
  if (persistent) {
    seasonChainCache.set(cacheKey, { chain: persistent, ts: Date.now() });
    return persistent;
  }

  const chain = [];
  const visited = new Set();
  let currentId = parseInt(rootAniListId, 10);

  for (let depth = 0; depth < 20; depth++) {
    if (visited.has(currentId)) break; // cycle guard
    visited.add(currentId);

    let response = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await axios.post(
          ANILIST_API_URL,
          { query: SEASON_CHAIN_QUERY, variables: { id: currentId } },
          {
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            timeout: 10000
          }
        );
        break;
      } catch (err) {
        if (err.response?.status === 429 && attempt < 2) {
          await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
        } else {
          console.error(`getSeasonChain: AniList request failed at id ${currentId}:`, err.message);
          break;
        }
      }
    }
    if (!response) break;

    const media = response.data?.data?.Media;
    if (!media) break;

    // Add this entry to the chain only if its format counts as a real season
    if (SEASON_FORMATS.has(media.format)) {
      chain.push({
        anilistId: String(media.id),
        title: media.title?.english || media.title?.romaji || `Season ${chain.length + 1}`,
        format: media.format,
        episodes: media.episodes || null,
        seasonYear: media.seasonYear || null,
        externalLinks: media.externalLinks || []
      });
    }

    // Walk to the next SEQUEL that is itself an ANIME entry
    const sequelEdge = (media.relations?.edges || []).find(
      e => e.relationType === 'SEQUEL' && e.node?.type === 'ANIME'
    );
    if (!sequelEdge) break;
    currentId = sequelEdge.node.id;
  }

  seasonChainCache.set(cacheKey, { chain, ts: Date.now() });
  mappingsStore.setSeasonChain(rootAniListId, chain);
  console.log(`getSeasonChain(${rootAniListId}): found ${chain.length} season(s)`);
  return chain;
}

/**
 * Fetches all episode data from Kitsu for a given numeric Kitsu ID.
 * Handles pagination automatically. Results are cached for 1 hour.
 *
 * @param {string} kitsuId - Numeric Kitsu anime ID
 * @returns {Promise<Array<{number:number, title:string|null}>>}
 */
async function fetchKitsuEpisodes(kitsuId) {
  const cached = kitsuEpisodesCache.get(kitsuId);
  if (cached && !_isExpired(cached.ts)) return cached.episodes;

  const episodes = [];
  let nextUrl = `${KITSU_API_URL}/anime/${encodeURIComponent(kitsuId)}/episodes?page[limit]=20&page[offset]=0&sort=number`;

  try {
    while (nextUrl) {
      const response = await axios.get(nextUrl, {
        headers: { 'Accept': 'application/vnd.api+json' },
        timeout: 10000
      });
      for (const ep of response.data?.data || []) {
        const num = ep.attributes?.number;
        if (num != null) {
          const title =
            ep.attributes?.titles?.en_us ||
            ep.attributes?.titles?.en_jp ||
            ep.attributes?.canonicalTitle ||
            null;
          episodes.push({ number: num, title });
        }
      }
      nextUrl = response.data?.links?.next || null;
      if (episodes.length > 2000) break; // safety cap
    }
  } catch (err) {
    console.warn(`fetchKitsuEpisodes(${kitsuId}): ${err.message}`);
  }

  kitsuEpisodesCache.set(kitsuId, { episodes, ts: Date.now() });
  return episodes;
}

/**
 * Builds a Stremio `videos` array for a multi-season franchise rooted at rootAniListId.
 *
 * Video IDs use the format "{stremioId}:{season}:{episode}", which the existing
 * stream endpoint already parses. Returns an empty array when the chain is empty
 * or only one season exists with an unknown episode count (let Kitsu handle those
 * natively in that case).
 *
 * @param {string|number} rootAniListId - AniList ID of the franchise root (S1)
 * @param {string} stremioId - Stremio catalog/meta ID for this entry (e.g. "kitsu:45483")
 * @returns {Promise<Array<Object>>} Stremio videos array
 */
async function buildMultiSeasonVideos(rootAniListId, stremioId) {
  const chain = await getSeasonChain(rootAniListId);
  if (chain.length === 0) return [];

  // If only one season with unknown episode count, Stremio can handle it via Kitsu natively
  if (chain.length === 1 && !chain[0].episodes) return [];

  const videos = [];
  // Cap total videos to avoid oversized JSON responses for very long franchises
  // (e.g. Pokemon has 1200+ episodes). Entries beyond the cap will be absent from the
  // videos array; Stremio will still show what it can.
  const MAX_TOTAL_VIDEOS = 3000;

  for (let seasonIdx = 0; seasonIdx < chain.length; seasonIdx++) {
    if (videos.length >= MAX_TOTAL_VIDEOS) break;
    const season = chain[seasonIdx];
    const seasonNumber = seasonIdx + 1;

    // Resolve the Kitsu ID for this season: prefer AniList externalLinks, fall back to Kitsu API lookup
    let kitsuId = _extractKitsuId(season.externalLinks);
    if (!kitsuId) {
      kitsuId = await _mapAniListToKitsu(season.anilistId).catch(() => null);
    }
    const kitsuEps = kitsuId ? await fetchKitsuEpisodes(kitsuId) : [];

    // Episode count priority: AniList (most accurate) > Kitsu list length > skip season
    const epCount = season.episodes || (kitsuEps.length > 0 ? kitsuEps.length : null);
    if (!epCount) {
      console.log(`buildMultiSeasonVideos: skipping season ${seasonNumber} — no episode count`);
      continue;
    }

    for (let ep = 1; ep <= epCount; ep++) {
      if (videos.length >= MAX_TOTAL_VIDEOS) break;
      const kitsuEp = kitsuEps.find(e => e.number === ep);
      const epTitle = kitsuEp?.title || null;
      // Use the per-season Kitsu ID so stream addons (Torrentio etc.) receive
      // kitsu:{seasonKitsuId}:{episode} — the format they expect for season-specific lookups.
      // Fall back to stremioId:ep (works for season 1 where stremioId = kitsu:{rootId}).
      const episodeId = kitsuId ? `kitsu:${kitsuId}:${ep}` : `${stremioId}:${ep}`;
      videos.push({
        id: episodeId,
        title: epTitle
          ? `S${seasonNumber}E${ep} - ${epTitle}`
          : `Season ${seasonNumber} Episode ${ep}`,
        season: seasonNumber,
        episode: ep,
        released: season.seasonYear
          ? new Date(season.seasonYear, 0, 1).toISOString()
          : undefined
      });
    }
  }

  console.log(`buildMultiSeasonVideos(${rootAniListId}): ${videos.length} total video entries across ${chain.length} season(s)`);
  return videos;
}

module.exports = { getSeasonChain, fetchKitsuEpisodes, buildMultiSeasonVideos };
