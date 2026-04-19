/**
 * AniList API Service
 * 
 * This module handles all interactions with the AniList GraphQL API,
 * including fetching user's currently watching anime and anime metadata.
 * 
 * @module services/anilist
 */

const axios = require('axios');
const { ANILIST_API_URL, ANILIST_STATUS, POSTER_SHAPES } = require('../config/constants');
const mappingsStore = require('../config/mappings');
const { buildMultiSeasonVideos } = require('./meta');

/**
 * GraphQL query to fetch user's currently watching anime
 * 
 * This query retrieves all anime from a user's list with CURRENT status,
 * including comprehensive metadata needed for Stremio display.
 * 
 * @constant {string}
 */
// Cache viewer info so we only look it up once per token
const viewerCache = new Map();

// Cache kitsu ID → AniList ID, populated from catalog fetches
const kitsuAnilistCache = new Map();

// Cache AniList ID → root { anilistId, kitsuId } to avoid redundant traversal API calls
const rootMediaCache = new Map();

// Cache Cinemeta metadata keyed by "type:ttId" to avoid redundant fetches
const cinemetaCache = new Map();

// Fribb anime-lists: maps AniList IDs to IMDB/Kitsu IDs.
// Loaded once lazily from GitHub on first catalog request.
let fribbMap = null; // Map<anilistId, { imdb_id, kitsu_id }>
let fribbImdbReverseMap = null; // Map<imdb_id, anilistId>
let fribbKitsuToImdbMap = null; // Map<kitsu_id, imdb_id>
let fribbLoadPromise = null;

async function loadFribbMap() {
  if (fribbMap) return fribbMap;
  if (fribbLoadPromise) return fribbLoadPromise;
  fribbLoadPromise = (async () => {
    try {
      console.log('Loading Fribb anime-lists mapping...');
      const resp = await axios.get(
        'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json',
        { timeout: 15000 }
      );
      fribbMap = new Map();
      fribbImdbReverseMap = new Map();
      fribbKitsuToImdbMap = new Map();
      for (const entry of resp.data) {
        if (entry.anilist_id) {
          const kitsuId = entry.kitsu_id ? String(entry.kitsu_id) : null;
          fribbMap.set(entry.anilist_id, {
            imdb_id: entry.imdb_id || null,
            kitsu_id: kitsuId
          });
          if (entry.imdb_id) {
            // Keep the lowest AniList ID for each IMDB ID — lowest = oldest = root season
            const existing = fribbImdbReverseMap.get(entry.imdb_id);
            if (!existing || entry.anilist_id < parseInt(existing, 10)) {
              fribbImdbReverseMap.set(entry.imdb_id, String(entry.anilist_id));
            }
          }
          if (kitsuId && entry.imdb_id) {
            fribbKitsuToImdbMap.set(kitsuId, entry.imdb_id);
          }
        }
      }
      console.log(`Fribb anime-lists loaded: ${fribbMap.size} AniList entries`);
      return fribbMap;
    } catch (err) {
      console.error('Failed to load Fribb anime-lists:', err.message);
      fribbMap = new Map();
      fribbImdbReverseMap = new Map();
      fribbKitsuToImdbMap = new Map();
      return fribbMap;
    }
  })();
  return fribbLoadPromise;
}

/**
 * Returns the IMDB ID for a given Kitsu ID using the Fribb map.
 * Returns null if the map isn't loaded yet or no mapping exists.
 *
 * @param {string} kitsuId
 * @returns {string|null}
 */
function getImdbForKitsuId(kitsuId) {
  if (!fribbKitsuToImdbMap) return null;
  return fribbKitsuToImdbMap.get(String(kitsuId)) || null;
}

/**
 * Looks up the IMDB ID for a Kitsu ID by querying the Kitsu mappings API.
 * Result (including "not found") is stored in the persistent mappings store
 * so the API is only ever called once per Kitsu ID.
 *
 * @param {string} kitsuId
 * @returns {Promise<string|null>}
 */
async function fetchImdbForKitsuId(kitsuId) {
  // 1. Already in Fribb map (free, synchronous)
  const fribbImdb = getImdbForKitsuId(kitsuId);
  if (fribbImdb) return fribbImdb;

  // 2. Persistent store — undefined = never queried, null = confirmed absent
  const stored = mappingsStore.getKitsuImdbId(kitsuId);
  if (stored !== undefined) return stored; // null or a tt* string

  // 3. Ask Kitsu's mappings endpoint
  try {
    const resp = await axios.get(
      `https://kitsu.io/api/edge/anime/${encodeURIComponent(kitsuId)}/mappings`,
      { headers: { 'Accept': 'application/vnd.api+json' }, timeout: 8000 }
    );
    for (const item of resp.data?.data || []) {
      const site = item.attributes?.externalSite || '';
      const extId = item.attributes?.externalId || '';
      // Kitsu uses 'imdb' or 'imdb/shows' or 'imdb/movies'
      if (site.startsWith('imdb') && /^tt\d+/.test(extId)) {
        console.log(`Kitsu:${kitsuId} → IMDB:${extId} (kitsu mappings API)`);
        mappingsStore.setKitsuImdbId(kitsuId, extId);
        return extId;
      }
    }
  } catch (err) {
    console.warn(`fetchImdbForKitsuId(${kitsuId}): ${err.message}`);
  }
  // Record that no mapping exists so we don't retry
  mappingsStore.setKitsuImdbId(kitsuId, null);
  return null;
}

function fribbLookup(anilistId) {
  if (!fribbMap) return null;
  return fribbMap.get(anilistId) || null;
}

/**
 * Fetches root-level metadata from Cinemeta for an IMDB title.
 * Returns { name, poster, background, description, genres, imdbRating, releaseInfo, year }
 * or null on failure. Responses are cached permanently (scores/titles rarely change).
 */
async function fetchCinemetaMeta(imdbId, type) {
  const cacheKey = `${type}:${imdbId}`;
  if (cinemetaCache.has(cacheKey)) return cinemetaCache.get(cacheKey);
  try {
    const url = `https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`;
    const resp = await axios.get(url, { timeout: 5000 });
    const m = resp.data?.meta;
    if (m) {
      const result = {
        name: m.name,
        poster: m.poster,
        background: m.background,
        description: m.description,
        genres: m.genres,
        imdbRating: m.imdbRating,
        releaseInfo: m.releaseInfo,
        year: m.year
      };
      cinemetaCache.set(cacheKey, result);
      return result;
    }
  } catch (err) {
    console.log(`Cinemeta fetch failed for ${imdbId}: ${err.message}`);
  }
  cinemetaCache.set(cacheKey, null);
  return null;
}

const VIEWER_QUERY = `{ Viewer { id name } }`;

const UPDATE_PROGRESS_MUTATION = `
  mutation ($mediaId: Int, $progress: Int) {
    SaveMediaListEntry(mediaId: $mediaId, progress: $progress) {
      id
      progress
    }
  }
`;

async function getViewerInfo(token) {
  if (viewerCache.has(token)) return viewerCache.get(token);
  const response = await axios.post(
    ANILIST_API_URL,
    { query: VIEWER_QUERY },
    {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      timeout: 10000
    }
  );
  const viewer = response.data?.data?.Viewer;
  if (!viewer) throw new Error('Could not retrieve viewer info from AniList');
  viewerCache.set(token, viewer);
  return viewer;
}

const ANIME_META_QUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      id
      title {
        english
        romaji
      }
      description
      coverImage {
        large
        medium
      }
      bannerImage
      genres
      averageScore
      status
      format
      episodes
      seasonYear
      season
      externalLinks {
        url
        site
      }
    }
  }
`;

const ANIME_LIST_QUERY = `
  query ($userId: Int, $status: MediaListStatus) {
    MediaListCollection(userId: $userId, type: ANIME, status: $status) {
      lists {
        entries {
          id
          media {
            id
            idMal
            title {
              english
              romaji
            }
            description
            coverImage {
              large
              medium
            }
            bannerImage
            genres
            averageScore
            status
            format
            episodes
            seasonYear
            season
            externalLinks {
              url
              site
            }
            relations {
              edges {
                relationType
                node {
                  id
                  type
                  externalLinks {
                    url
                    site
                  }
                  relations {
                    edges {
                      relationType
                      node {
                        id
                        type
                        externalLinks { url site }
                      }
                    }
                  }
                }
              }
            }
          }
          status
          progress
        }
      }
    }
  }
`;

/**
 * Fetches currently watching anime from AniList for the configured user
 * 
 * This function queries the AniList API to retrieve all anime that the user
 * has marked as "Currently Watching" and transforms them into Stremio-compatible
 * metadata objects.
 * 
 * @async
 * @returns {Promise<Array<Object>>} Array of Stremio meta objects
 * @returns {string} return[].id - Unique identifier in format "anilist:{id}"
 * @returns {string} return[].type - Content type (always "anime")
 * @returns {string} return[].name - Anime title (English or Romaji)
 * @returns {string} return[].poster - URL to anime poster image
 * @returns {string} return[].posterShape - Shape of poster (portrait/landscape/square)
 * @returns {string} return[].description - Anime description/synopsis
 * @returns {Array<string>} return[].genres - Array of genre names
 * @returns {string} return[].imdbRating - Rating converted from AniList score (0-10 scale)
 * @returns {number} return[].year - Year the anime aired
 * @returns {boolean} return[].watched - Whether user has watched any episodes
 * 
 * @throws {Error} If AniList API request fails
 * 
 * @example
 * const animeList = await getCurrentlyWatchingAnime();
 * // Returns: [{ id: "anilist:12345", name: "Attack on Titan", ... }]
 */
async function getAnimeList(token, status) {
  try {
    const viewer = await getViewerInfo(token);
    console.log(`Fetching ${status} anime for viewer: ${viewer.name} (id: ${viewer.id})`);
    
    const response = await axios.post(
      ANILIST_API_URL,
      {
        query: ANIME_LIST_QUERY,
        variables: { userId: viewer.id, status }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        timeout: 10000
      }
    );

    // Validate response structure
    if (!response.data || !response.data.data) {
      throw new Error('Invalid response structure from AniList API');
    }

    // Extract entries from nested response structure
    const mediaListCollection = response.data.data.MediaListCollection;
    
    // Handle case where user has no currently watching anime
    if (!mediaListCollection || !mediaListCollection.lists || mediaListCollection.lists.length === 0) {
      console.log(`No ${status} anime found for user`);
      return [];
    }

    const entries = mediaListCollection.lists[0]?.entries || [];
    console.log(`Found ${entries.length} ${status} anime on AniList`);

    // Deduplicate: if both a root season and its sequel(s) are in the list,
    // only keep the root so Stremio shows one multi-season entry per franchise.
    const allIds = new Set(entries.map(e => e.media.id));
    const sequelIds = new Set();
    for (const entry of entries) {
      for (const edge of entry.media.relations?.edges || []) {
        if (edge.relationType === 'SEQUEL' && edge.node?.type === 'ANIME' && allIds.has(edge.node.id)) {
          sequelIds.add(edge.node.id);
        }
      }
    }
    // Also check PREQUEL direction: if an entry's ancestor (up to 2 levels)
    // is already in the list, remove this entry (the ancestor/root wins).
    for (const entry of entries) {
      if (sequelIds.has(entry.media.id)) continue;
      for (const edge of entry.media.relations?.edges || []) {
        if (edge.relationType === 'PREQUEL' && edge.node?.type === 'ANIME') {
          if (allIds.has(edge.node.id)) {
            sequelIds.add(entry.media.id);
            break;
          }
          // Check grandparent (2 levels up)
          for (const edge2 of edge.node.relations?.edges || []) {
            if (edge2.relationType === 'PREQUEL' && edge2.node?.type === 'ANIME' && allIds.has(edge2.node.id)) {
              sequelIds.add(entry.media.id);
              break;
            }
          }
          if (sequelIds.has(entry.media.id)) break;
        }
      }
    }
    const rootEntries = entries.filter(e => !sequelIds.has(e.media.id));
    if (sequelIds.size > 0) {
      console.log(`Deduped ${sequelIds.size} sequel entries — showing ${rootEntries.length} root entries`);
    }

    // Load the Fribb anime-lists mapping (cached after first load)
    await loadFribbMap();

    // For each root entry, resolve the franchise-level IMDB and Kitsu IDs.
    // Priority for IMDB: Fribb DB (most reliable) > inline prequel traversal > own external links.
    // Priority for Kitsu: inline prequel traversal > own external links > Fribb DB.
    const finalEntries = [];
    for (const entry of rootEntries) {
      // Fribb lookup — directly maps this AniList ID to the root IMDB ID
      const fribb = fribbLookup(entry.media.id);
      const fribbImdbId = fribb?.imdb_id || null;
      const fribbKitsuId = fribb?.kitsu_id || null;

      // Inline prequel traversal (uses embedded relation data, no extra API calls)
      const inlineKitsuId = findRootKitsuIdInline(entry.media);
      const inlineImdbId = findRootImdbIdInline(entry.media) || extractImdbId(entry.media.externalLinks);

      const rootImdbId = fribbImdbId || inlineImdbId;
      const rootKitsuId = inlineKitsuId || extractKitsuId(entry.media.externalLinks) || fribbKitsuId;

      // Extra fallback: if Fribb / inline traversal gave no IMDB but we have a Kitsu ID,
      // ask Kitsu's own mappings endpoint (result persisted so it's only fetched once).
      let resolvedImdbId = rootImdbId;
      if (!resolvedImdbId && rootKitsuId) {
        resolvedImdbId = await fetchImdbForKitsuId(rootKitsuId);
      }

      if (!rootKitsuId && !resolvedImdbId) {
        finalEntries.push(entry);
        continue;
      }
      if (resolvedImdbId) console.log(`AniList:${entry.media.id} → IMDB:${resolvedImdbId} (${fribbImdbId ? 'fribb' : rootImdbId ? 'inline' : 'kitsu-api'})`);
      if (rootKitsuId) console.log(`AniList:${entry.media.id} → kitsu:${rootKitsuId}`);
      finalEntries.push({
        ...entry,
        ...(rootKitsuId ? { _rootKitsuId: rootKitsuId } : {}),
        ...(resolvedImdbId ? { _rootImdbId: resolvedImdbId } : {})
      });
    }

    // Deduplicate entries that resolved to the same IMDB ID (keeps first occurrence)
    const seenImdb = new Set();
    const imdbDeduped = [];
    for (const entry of finalEntries) {
      if (entry._rootImdbId) {
        if (seenImdb.has(entry._rootImdbId)) {
          console.log(`Dedup: dropping AniList:${entry.media.id} — duplicate IMDB:${entry._rootImdbId}`);
          continue;
        }
        seenImdb.add(entry._rootImdbId);
      }
      imdbDeduped.push(entry);
    }

    // Enrich entries with Cinemeta metadata so catalog cards show
    // root franchise info (all-seasons title, poster, year) instead of
    // the specific season's AniList metadata.
    await Promise.all(imdbDeduped.map(async (entry) => {
      if (entry._rootImdbId) {
        const cType = entry.media.format === 'MOVIE' ? 'movie' : 'series';
        const cinemeta = await fetchCinemetaMeta(entry._rootImdbId, cType);
        if (cinemeta) entry._cinemetaMeta = cinemeta;
      }
    }));

    // Transform AniList entries to Stremio meta format
    return imdbDeduped.map(entry => transformToStremioMeta(entry));

  } catch (error) {
    // Enhanced error handling with specific error types
    if (error.response) {
      // AniList API returned an error response
      const status = error.response.status;
      const message = error.response.data?.errors?.[0]?.message || 'Unknown API error';
      
      console.error(`AniList API error (${status}): ${message}`);
      
      if (status === 404) {
        throw new Error(`AniList user "${username}" not found. Please check your username.`);
      } else if (status === 429) {
        throw new Error('AniList API rate limit exceeded. Please try again later.');
      } else {
        throw new Error(`AniList API error: ${message}`);
      }
    } else if (error.request) {
      // Request was made but no response received
      console.error('No response from AniList API:', error.message);
      throw new Error('Unable to connect to AniList API. Please check your internet connection.');
    } else {
      // Error in request setup or processing
      console.error('Error fetching from AniList:', error.message);
      throw new Error(`Failed to fetch anime list: ${error.message}`);
    }
  }
}

/**
 * Transforms an AniList media entry into Stremio meta format
 * 
 * Converts the AniList API response structure into the format expected
 * by Stremio, including proper ID formatting, rating conversion, and
 * metadata extraction.
 * 
 * @private
 * @param {Object} entry - AniList media list entry
 * @param {Object} entry.media - Media information
 * @param {number} entry.media.id - AniList media ID
 * @param {Object} entry.media.title - Title information
 * @param {string} entry.media.title.english - English title
 * @param {string} entry.media.title.romaji - Romaji title
 * @param {string} entry.media.description - Anime description
 * @param {Object} entry.media.coverImage - Cover image URLs
 * @param {string} entry.media.coverImage.large - Large cover image URL
 * @param {Array<string>} entry.media.genres - Genre list
 * @param {number} entry.media.averageScore - Average score (0-100)
 * @param {number} entry.media.seasonYear - Year aired
 * @param {number} entry.progress - Episodes watched
 * @returns {Object} Stremio-compatible meta object
 */
/**
 * Extracts a numeric Kitsu ID from AniList external links.
 *
 * @private
 * @param {Array<Object>} externalLinks - AniList externalLinks array
 * @returns {string|null} Kitsu ID string, or null if not found
 */
function extractKitsuId(externalLinks) {
  if (!Array.isArray(externalLinks)) return null;
  const kitsuLink = externalLinks.find(
    link => link.site === 'Kitsu' && link.url
  );
  if (!kitsuLink) return null;
  const match = kitsuLink.url.match(/kitsu\.(?:io|app)\/anime\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Extracts an IMDB tt-ID from AniList external links.
 * Returns the full tt-prefixed ID (e.g. "tt9335498"), or null.
 *
 * @private
 * @param {Array<Object>} externalLinks - AniList externalLinks array
 * @returns {string|null} IMDB ID string (e.g. "tt9335498"), or null
 */
function extractImdbId(externalLinks) {
  if (!Array.isArray(externalLinks)) return null;
  const imdbLink = externalLinks.find(
    link => link.site?.toLowerCase() === 'imdb' && link.url
  );
  if (!imdbLink) return null;
  const match = imdbLink.url.match(/imdb\.com\/title\/(tt\d+)/);
  return match ? match[1] : null;
}

/**
 * Walks the inline relation data (up to 2 levels of PREQUELs) to find the
 * franchise root's Kitsu ID. Returns null if the entry is already a root
 * or no Kitsu ID could be resolved from the inline data.
 *
 * @param {Object} media - AniList media object with nested relations.edges[].node.externalLinks
 * @returns {string|null} Kitsu ID of the root, or null
 */
function findRootKitsuIdInline(media) {
  let current = media;
  for (let depth = 0; depth < 3; depth++) {
    const prequelEdge = current.relations?.edges?.find(
      e => e.relationType === 'PREQUEL' && e.node?.type === 'ANIME'
    );
    if (!prequelEdge) {
      // current IS the root — only return a kitsu ID if we actually traversed (depth > 0)
      if (depth === 0) return null;
      return extractKitsuId(current.externalLinks);
    }
    current = prequelEdge.node;
  }
  // Fell off the end (very deep chain) — use whatever we have
  return extractKitsuId(current.externalLinks) || null;
}

/**
 * Walks the inline relation data (up to 3 levels of PREQUELs) to find the
 * root entry's IMDB ID. Returns null if the entry is already a root
 * (own IMDB is handled separately in the caller).
 *
 * @param {Object} media - AniList media object with nested relations
 * @returns {string|null} IMDB tt-ID of the root ancestor, or null
 */
function findRootImdbIdInline(media) {
  let current = media;
  for (let depth = 0; depth < 3; depth++) {
    const prequelEdge = current.relations?.edges?.find(
      e => e.relationType === 'PREQUEL' && e.node?.type === 'ANIME'
    );
    if (!prequelEdge) {
      if (depth === 0) return null; // own IMDB handled by caller
      return extractImdbId(current.externalLinks);
    }
    current = prequelEdge.node;
  }
  return extractImdbId(current.externalLinks) || null;
}

function transformToStremioMeta(entry) {
  const media = entry.media;
  
  // Prefer English title, fallback to Romaji
  const title = media.title.english || media.title.romaji;

  // Build deduplicated aliases for Torrentio/search fallback
  const aliasSet = new Set();
  if (media.title.english) aliasSet.add(media.title.english);
  if (media.title.romaji) aliasSet.add(media.title.romaji);
  aliasSet.delete(title);
  const aliases = [...aliasSet].filter(Boolean);
  
  // Convert AniList score (0-100) to IMDb-style rating (0-10)
  const rating = media.averageScore 
    ? (media.averageScore / 10).toFixed(1) 
    : null;

  // Clean HTML tags from description
  const cleanDescription = media.description 
    ? media.description.replace(/<[^>]*>/g, '').trim()
    : '';

  // Prefer IMDB IDs so Cinemeta serves all-seasons metadata in one entry.
  // Fall back to kitsu: for stream addon compatibility, then anilist: as last resort.
  const imdbId = entry._rootImdbId || null;
  const kitsuId = entry._rootKitsuId || extractKitsuId(media.externalLinks);
  const id = imdbId ? imdbId : kitsuId ? `kitsu:${kitsuId}` : `anilist:${media.id}`;

  // Populate reverse cache so stream requests can map kitsu → anilist
  // Only cache own kitsu→anilist when not using an IMDB ID
  if (!imdbId && !entry._rootKitsuId && kitsuId) kitsuAnilistCache.set(kitsuId, String(media.id));

  // Use 'series'/'movie' for IMDB entries (Cinemeta routing), 'anime' otherwise
  const type = imdbId ? (media.format === 'MOVIE' ? 'movie' : 'series') : 'anime';

  // When Cinemeta data is available (IMDB-matched entries), use root franchise
  // metadata so the catalog card shows e.g. "That Time I Got Reincarnated as a Slime"
  // with "2018-" instead of "Season 3" with "2024".
  const cm = entry._cinemetaMeta;

  return {
    id,
    type,
    name: cm?.name || title,
    aliases,
    poster: cm?.poster || media.coverImage.large || media.coverImage.medium,
    posterShape: POSTER_SHAPES.PORTRAIT,
    background: cm?.background || media.bannerImage || media.coverImage.large,
    description: cm?.description || cleanDescription,
    genres: cm?.genres || media.genres || [],
    imdbRating: cm?.imdbRating || rating,
    releaseInfo: cm?.releaseInfo || (media.seasonYear ? `${media.seasonYear}` : undefined),
    year: cm?.year || media.seasonYear,
    // Mark as watched if user has made any progress
    watched: entry.progress > 0,
    // Additional metadata
    meta: {
      episodes: media.episodes,
      status: media.status,
      progress: entry.progress
    }
  };
}

/**
 * Fetches detailed metadata for a specific anime by ID
 * 
 * This function retrieves comprehensive information about a single anime
 * from AniList. Currently returns a placeholder but can be expanded to
 * fetch full details including episodes, characters, etc.
 * 
 * @async
 * @param {string} id - Anime ID in format "anilist:{id}"
 * @returns {Promise<Object>} Stremio meta object with anime details
 * @returns {string} return.id - The anime ID
 * @returns {string} return.type - Content type (always "anime")
 * @returns {string} return.name - Anime title
 * 
 * @example
 * const meta = await getAnimeMeta("anilist:12345");
 * // Returns: { id: "anilist:12345", type: "anime", name: "..." }
 */
async function getAnimeMeta(id) {
  try {
    const anilistId = parseInt(id.replace('anilist:', ''), 10);
    console.log(`Fetching metadata for anime ID: ${anilistId}`);

    const response = await axios.post(
      ANILIST_API_URL,
      { query: ANIME_META_QUERY, variables: { id: anilistId } },
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 10000
      }
    );

    const media = response.data?.data?.Media;
    if (!media) throw new Error('Anime not found on AniList');

    const title = media.title.english || media.title.romaji;
    const rating = media.averageScore ? (media.averageScore / 10).toFixed(1) : null;
    const cleanDescription = media.description
      ? media.description.replace(/<[^>]*>/g, '').trim()
      : '';

    // Build multi-season videos by walking the AniList SEQUEL chain.
    // This lets Stremio display all seasons even when Kitsu/Cinemeta only know about S1.
    const videos = await buildMultiSeasonVideos(anilistId, id);

    return {
      id,
      type: 'series',
      name: title,
      description: cleanDescription,
      poster: media.coverImage?.large || media.coverImage?.medium,
      background: media.bannerImage,
      genres: media.genres || [],
      imdbRating: rating,
      releaseInfo: media.seasonYear ? String(media.seasonYear) : undefined,
      ...(videos.length > 0 && { videos })
    };
  } catch (error) {
    console.error(`Error fetching anime meta for ${id}:`, error.message);
    throw new Error(`Failed to fetch anime metadata: ${error.message}`);
  }
}

// Cache AniList ID → Kitsu ID (populated by mapAniListToKitsu)
const anilistKitsuCache = new Map();

/**
 * Returns the Kitsu ID for a given AniList ID.
 * Checks Fribb map first; falls back to Kitsu mappings API.
 *
 * @param {string|number} anilistId
 * @returns {Promise<string|null>}
 */
async function mapAniListToKitsu(anilistId) {
  const key = String(anilistId);
  if (anilistKitsuCache.has(key)) return anilistKitsuCache.get(key);

  // 1. Fribb map (fast, no extra API call)
  const map = await loadFribbMap();
  const entry = map.get(parseInt(anilistId, 10));
  if (entry?.kitsu_id) {
    anilistKitsuCache.set(key, entry.kitsu_id);
    return entry.kitsu_id;
  }

  // 2. Kitsu mappings API fallback
  try {
    const qs = `filter[externalSite]=anilist/anime&filter[externalId]=${encodeURIComponent(anilistId)}&include=item&page[limit]=1`;
    const response = await axios.get(
      `https://kitsu.io/api/edge/mappings?${qs}`,
      { headers: { 'Accept': 'application/vnd.api+json' }, timeout: 10000 }
    );
    const kitsuId = response.data?.data?.[0]?.relationships?.item?.data?.id;
    const result = kitsuId ? String(kitsuId) : null;
    anilistKitsuCache.set(key, result);
    return result;
  } catch (err) {
    console.warn(`mapAniListToKitsu(${anilistId}): ${err.message}`);
    return null;
  }
}

async function mapKitsuToAniList(kitsuId) {
  // 1. In-memory cache — populated by catalog fetches
  if (kitsuAnilistCache.has(kitsuId)) {
    return kitsuAnilistCache.get(kitsuId);
  }
  // 2. Persistent store — survives restarts
  const stored = mappingsStore.getKitsuAnilistId(kitsuId);
  if (stored) {
    kitsuAnilistCache.set(kitsuId, stored);
    return stored;
  }
  try {
    // Use ?include=mappings (standard JSON:API) to get mapping data
    const response = await axios.get(
      `https://kitsu.io/api/edge/anime/${kitsuId}?include=mappings`,
      {
        headers: { 'Accept': 'application/vnd.api+json' },
        timeout: 10000
      }
    );
    const included = response.data?.included || [];
    const anilistMapping = included.find(
      item => item.type === 'mappings' && item.attributes?.externalSite === 'anilist/anime'
    );
    if (anilistMapping) {
      const anilistId = anilistMapping.attributes.externalId;
      kitsuAnilistCache.set(kitsuId, anilistId);
      mappingsStore.setKitsuAnilistId(kitsuId, anilistId);
      return anilistId;
    }
    // Fallback: try MAL mapping → AniList idMal lookup
    const malMapping = included.find(
      item => item.type === 'mappings' && item.attributes?.externalSite === 'myanimelist/anime'
    );
    if (malMapping) {
      const anilistId = await mapMalIdToAniList(parseInt(malMapping.attributes.externalId, 10));
      if (anilistId) {
        kitsuAnilistCache.set(kitsuId, anilistId);
        mappingsStore.setKitsuAnilistId(kitsuId, anilistId);
        return anilistId;
      }
    }
    return null;
  } catch (err) {
    console.error(`mapKitsuToAniList(${kitsuId}):`, err.message);
    return null;
  }
}

const MAL_ID_QUERY = `
  query ($idMal: Int) {
    Media(idMal: $idMal, type: ANIME) {
      id
    }
  }
`;

async function mapMalIdToAniList(malId) {
  try {
    const response = await axios.post(
      ANILIST_API_URL,
      { query: MAL_ID_QUERY, variables: { idMal: malId } },
      {
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        timeout: 10000
      }
    );
    return response.data?.data?.Media?.id?.toString() || null;
  } catch (err) {
    console.error(`mapMalIdToAniList(${malId}):`, err.message);
    return null;
  }
}

async function mapImdbToAniList(imdbId) {
  try {
    // Use Fribb reverse map (imdb_id → anilist_id) — accurate and no extra API call
    await loadFribbMap();
    if (fribbImdbReverseMap?.has(imdbId)) {
      return fribbImdbReverseMap.get(imdbId);
    }
    console.log(`mapImdbToAniList(${imdbId}): not found in Fribb map`);
    return null;
  } catch (err) {
    console.error(`mapImdbToAniList(${imdbId}):`, err.message);
    return null;
  }
}

async function updateProgress(animeId, episode, token) {
  try {
    const response = await axios.post(
      ANILIST_API_URL,
      {
        query: UPDATE_PROGRESS_MUTATION,
        variables: { mediaId: parseInt(animeId, 10), progress: episode }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        timeout: 10000
      }
    );
    const saved = response.data?.data?.SaveMediaListEntry;
    if (!saved) throw new Error('No data returned from mutation');
    console.log(`Updated AniList progress: anime ${animeId} ep ${saved.progress}`);
    return saved;
  } catch (err) {
    console.error(`updateProgress(${animeId}, ep ${episode}):`, err.message);
    throw err;
  }
}

const SEQUEL_QUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      relations {
        edges {
          relationType
          node {
            id
            type
          }
        }
      }
    }
  }
`;

const MEDIA_RELATIONS_QUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      id
      externalLinks { url site }
      relations {
        edges {
          relationType
          node { id type }
        }
      }
    }
  }
`;

/**
 * Traverses PREQUEL relations upward from a given AniList ID to find the
 * franchise root (S1). Returns { anilistId, kitsuId } for the root.
 * Results are cached to avoid redundant API calls.
 *
 * @param {number|string} startId - AniList ID to start traversal from
 * @returns {Promise<{anilistId:string, kitsuId:string|null}|null>}
 */
async function findRootMedia(startId) {
  const cacheKey = String(startId);
  if (rootMediaCache.has(cacheKey)) return rootMediaCache.get(cacheKey);

  let currentId = parseInt(startId, 10);
  for (let depth = 0; depth < 5; depth++) {
    // Retry up to 3 times on 429
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await axios.post(
          ANILIST_API_URL,
          { query: MEDIA_RELATIONS_QUERY, variables: { id: currentId } },
          { headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, timeout: 10000 }
        );
        break;
      } catch (err) {
        if (err.response?.status === 429 && attempt < 2) {
          const wait = (attempt + 1) * 2000;
          console.warn(`AniList 429 in findRootMedia(${currentId}), retrying in ${wait}ms...`);
          await new Promise(r => setTimeout(r, wait));
        } else {
          console.error(`findRootMedia traversal failed at AniList id ${currentId}:`, err.message);
          return null;
        }
      }
    }
    if (!response) return null;
    const media = response.data?.data?.Media;
    if (!media) break;
    const prequelEdge = media.relations?.edges?.find(
      e => e.relationType === 'PREQUEL' && e.node?.type === 'ANIME'
    );
    if (!prequelEdge) {
      // This node has no prequel — it IS the root
      const kitsuId = extractKitsuId(media.externalLinks);
      const result = { anilistId: String(media.id), kitsuId };
      rootMediaCache.set(cacheKey, result);
      rootMediaCache.set(String(media.id), result);
      return result;
    }
    currentId = prequelEdge.node.id;
  }
  return null;
}

/**
 * Traverses AniList's sequel chain to find the AniList ID for a specific season.
 * Season 1 = rootId, Season 2 = first sequel, Season 3 = second sequel, etc.
 *
 * @param {string} rootId - AniList ID of the root/first season
 * @param {number} season - Season number (1-based)
 * @returns {Promise<string>} AniList ID for the requested season (or last known if chain ends early)
 */
async function getSeasonAniListId(rootId, season) {
  if (!season || season <= 1) return rootId;
  let currentId = rootId;
  for (let i = 1; i < season; i++) {
    try {
      const response = await axios.post(
        ANILIST_API_URL,
        { query: SEQUEL_QUERY, variables: { id: parseInt(currentId, 10) } },
        {
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          timeout: 10000
        }
      );
      const edges = response.data?.data?.Media?.relations?.edges || [];
      const sequel = edges.find(e => e.relationType === 'SEQUEL' && e.node?.type === 'ANIME');
      if (!sequel) {
        console.log(`No ANIME sequel found for AniList ID ${currentId} at season ${i + 1}, using last resolved ID`);
        break;
      }
      currentId = String(sequel.node.id);
      console.log(`Season ${i + 1} resolved to AniList ID ${currentId}`);
    } catch (err) {
      console.error(`getSeasonAniListId failed at season ${i + 1}:`, err.message);
      break;
    }
  }
  return currentId;
}

const ANILIST_TO_MAL_QUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      idMal
    }
  }
`;

async function mapAniListToMal(anilistId) {
  try {
    const response = await axios.post(
      ANILIST_API_URL,
      { query: ANILIST_TO_MAL_QUERY, variables: { id: parseInt(anilistId, 10) } },
      {
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        timeout: 10000
      }
    );
    const idMal = response.data?.data?.Media?.idMal;
    return idMal ? String(idMal) : null;
  } catch (err) {
    console.error(`mapAniListToMal(${anilistId}):`, err.message);
    return null;
  }
}

module.exports = {
  getViewerInfo,
  getAnimeList,
  getAnimeMeta,
  mapKitsuToAniList,
  mapImdbToAniList,
  mapAniListToMal,
  getSeasonAniListId,
  updateProgress,
  getImdbForKitsuId
};

// Made with Bob
