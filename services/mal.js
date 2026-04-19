/**
 * MyAnimeList API Service
 *
 * Handles all interactions with the MAL REST API v2, including fetching
 * a user's currently watching anime and individual anime metadata.
 *
 * Requires a MAL Client ID — register an app at:
 * https://myanimelist.net/apiconfig
 *
 * @module services/mal
 */

const axios = require('axios');
const { MAL_API_URL, POSTER_SHAPES } = require('../config/constants');
const tokenManager = require('../config/tokens');
const mappingsStore = require('../config/mappings');
const { mapKitsuToAniList } = require('./anilist');
const { buildMultiSeasonVideos } = require('./meta');

const KITSU_API_URL = 'https://kitsu.io/api/edge';
const KITSU_BATCH_SIZE = 20;

// Cache MAL ID → root Kitsu ID to avoid redundant traversal API calls
const rootMalKitsuCache = new Map();

/**
 * Fields to request from the MAL anime list endpoint
 * @constant {string}
 */
const LIST_FIELDS = [
  'list_status',
  'main_picture',
  'synopsis',
  'genres',
  'mean',
  'num_episodes',
  'start_season',
  'status',
  'media_type',
  'alternative_titles',
  'related_anime'
].join(',');

/**
 * Fields to request from the MAL single-anime endpoint
 * @constant {string}
 */
const META_FIELDS = [
  'id',
  'title',
  'main_picture',
  'synopsis',
  'genres',
  'mean',
  'num_episodes',
  'start_season',
  'status',
  'background',
  'media_type',
  'alternative_titles'
].join(',');

/**
 * Fetches a user's anime list from MAL.
 *
 * @async
 * @param {string} username - MAL username
 * @param {string} clientId - MAL API Client ID
 * @param {string} status - MAL list status filter
 * @returns {Promise<Array<Object>>} Array of Stremio meta objects
 * @throws {Error} If the MAL API request fails
 */
async function getAnimeList(username, clientId, status) {
  try {
    console.log(`Fetching ${status} anime from MAL for user: ${username}`);

    const response = await axios.get(
      `${MAL_API_URL}/users/${encodeURIComponent(username)}/animelist`,
      {
        params: {
          status,
          fields: LIST_FIELDS,
          limit: 1000,
          nsfw: true
        },
        headers: {
          'X-MAL-CLIENT-ID': clientId
        },
        timeout: 10000
      }
    );

    const data = response.data?.data;
    if (!Array.isArray(data)) {
      throw new Error('Invalid response structure from MAL API');
    }

    console.log(`Found ${data.length} ${status} anime on MAL`);

    // Build a map of MAL ID -> Kitsu ID so stream addons can find streams
    const malIds = data.map(entry => entry.node.id);
    const kitsuIdMap = await fetchKitsuIdMap(malIds);
    console.log(`Kitsu ID mapping: ${Object.keys(kitsuIdMap).length}/${malIds.length} resolved`);

    // Deduplicate: if both a root season and its sequel(s) are in the list,
    // only keep the root so Stremio shows one multi-season entry per franchise.
    const allMalIds = new Set(data.map(e => String(e.node.id)));
    const sequelMalIds = new Set();
    for (const entry of data) {
      for (const rel of entry.node.related_anime || []) {
        if (rel.relation_type === 'sequel' && allMalIds.has(String(rel.node.id))) {
          sequelMalIds.add(String(rel.node.id));
        }
      }
    }
    const rootEntries = data.filter(e => !sequelMalIds.has(String(e.node.id)));
    if (sequelMalIds.size > 0) {
      console.log(`Deduped ${sequelMalIds.size} MAL sequel entries — showing ${rootEntries.length} root entries`);
    }

    // For entries that survived dedup but are still non-root (their prequel is in a
    // different status list e.g. Completed), find the root's Kitsu ID.
    // Run sequentially to avoid hammering the MAL API with parallel requests.
    const finalEntries = [];
    for (const entry of rootEntries) {
      const prequelRel = (entry.node.related_anime || []).find(r => r.relation_type === 'prequel');
      if (!prequelRel) {
        finalEntries.push(entry);
        continue;
      }
      const rootKitsuId = await findRootMalKitsuId(prequelRel.node.id, clientId);
      if (!rootKitsuId) {
        finalEntries.push(entry);
        continue;
      }
      console.log(`Non-root MAL:${entry.node.id} → root kitsu:${rootKitsuId}`);
      finalEntries.push({ ...entry, _rootKitsuId: rootKitsuId });
    }

    return finalEntries.map(entry => transformToStremioMeta(entry, kitsuIdMap));

  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const message = error.response.data?.message || 'Unknown API error';

      console.error(`MAL API error (${status}): ${message}`);

      if (status === 400) {
        throw new Error(`MAL user "${username}" not found or list is private.`);
      } else if (status === 401) {
        throw new Error('MAL Client ID is invalid or missing. Check your MAL_CLIENT_ID in .env.');
      } else if (status === 403) {
        throw new Error(`MAL user "${username}"'s anime list is not public.`);
      } else if (status === 404) {
        throw new Error(`MAL user "${username}" not found.`);
      } else if (status === 429) {
        throw new Error('MAL API rate limit exceeded. Please try again later.');
      } else {
        throw new Error(`MAL API error (${status}): ${message}`);
      }
    } else if (error.request) {
      throw new Error('Unable to connect to MAL API. Please check your internet connection.');
    } else {
      throw new Error(`Failed to fetch MAL anime list: ${error.message}`);
    }
  }
}

/**
 * Fetches detailed metadata for a single anime by MAL ID.
 *
 * @async
 * @param {string} id - Anime ID in "mal:{id}" format
 * @param {string} clientId - MAL API Client ID
 * @returns {Promise<Object>} Stremio meta object
 * @throws {Error} If the MAL API request fails
 */
async function getAnimeMeta(id, clientId) {
  try {
    // kitsu: IDs come through when the catalog entry was resolved to a Kitsu ID
    if (id.startsWith('kitsu:')) {
      return await fetchKitsuMeta(id);
    }

    const malId = id.replace('mal:', '');
    console.log(`Fetching MAL metadata for anime ID: ${malId}`);

    const response = await axios.get(
      `${MAL_API_URL}/anime/${encodeURIComponent(malId)}`,
      {
        params: { fields: META_FIELDS },
        headers: { 'X-MAL-CLIENT-ID': clientId },
        timeout: 10000
      }
    );

    const anime = response.data;
    if (!anime || !anime.id) {
      throw new Error('Invalid response structure from MAL API');
    }

    return transformSingleToMeta(anime);

  } catch (error) {
    if (error.response?.status === 404) {
      throw new Error(`Anime "${id}" not found on MAL.`);
    }
    if (error.response?.status === 401) {
      throw new Error('MAL Client ID is invalid or missing.');
    }
    console.error(`Error fetching MAL meta for ${id}:`, error.message);
    throw new Error(`Failed to fetch MAL anime metadata: ${error.message}`);
  }
}

/**
 * Fetches metadata for a Kitsu anime ID via the Kitsu REST API.
 *
 * @async
 * @private
 * @param {string} id - Anime ID in "kitsu:{id}" format
 * @returns {Promise<Object>} Stremio meta object
 */
async function fetchKitsuMeta(id) {
  const kitsuId = id.replace('kitsu:', '');
  console.log(`Fetching Kitsu metadata for MAL-sourced anime ID: ${kitsuId}`);

  const response = await axios.get(
    `${KITSU_API_URL}/anime/${encodeURIComponent(kitsuId)}`,
    {
      headers: { 'Accept': 'application/vnd.api+json' },
      timeout: 10000
    }
  );

  const anime = response.data?.data;
  if (!anime) throw new Error('Invalid response from Kitsu API');

  const attrs = anime.attributes;
  const title = attrs.titles?.en || attrs.titles?.en_jp || attrs.canonicalTitle;
  const rating = attrs.averageRating
    ? (parseFloat(attrs.averageRating) / 10).toFixed(1)
    : null;
  const year = attrs.startDate ? parseInt(attrs.startDate.substring(0, 4), 10) : null;
  const cleanDescription = attrs.synopsis
    ? attrs.synopsis.replace(/<[^>]*>/g, '').trim()
    : '';

  // Build multi-season videos by mapping Kitsu→AniList and walking the SEQUEL chain.
  // This surfaces all seasons even when Kitsu only knows about the root entry.
  let videos;
  try {
    const anilistId = await mapKitsuToAniList(kitsuId);
    if (anilistId) {
      videos = await buildMultiSeasonVideos(anilistId, id);
    }
  } catch (err) {
    console.warn(`fetchKitsuMeta: could not build videos for kitsu:${kitsuId}: ${err.message}`);
  }

  return {
    id,
    type: attrs.subtype === 'movie' ? 'movie' : 'series',
    name: title,
    poster: attrs.posterImage?.large || attrs.posterImage?.medium,
    posterShape: POSTER_SHAPES.PORTRAIT,
    background: attrs.coverImage?.large || attrs.coverImage?.original,
    description: cleanDescription,
    imdbRating: rating,
    releaseInfo: year ? `${year}` : undefined,
    year,
    ...(videos && videos.length > 0 && { videos })
  };
}

/**
 * Fetches Kitsu IDs for an array of MAL IDs in batches.
 * Returns a map of { malId (string) -> kitsuId (string) }.
 * Entries with no Kitsu match are omitted; callers fall back to mal: IDs.
 *
 * @async
 * @private
 * @param {number[]} malIds
 * @returns {Promise<Object>}
 */
async function fetchKitsuIdMap(malIds) {
  if (!malIds.length) return {};

  // Seed from persistent store — skip any IDs we already know
  const persistent = mappingsStore.getMalKitsuMap();
  const map = {};
  const missing = [];
  for (const id of malIds) {
    const stored = persistent[String(id)];
    if (stored !== undefined) {
      if (stored) map[String(id)] = stored; // null = known-no-mapping, skip
    } else {
      missing.push(id);
    }
  }

  if (missing.length === 0) {
    console.log(`Kitsu ID mapping: ${Object.keys(map).length}/${malIds.length} from cache (no API calls needed)`);
    return map;
  }

  console.log(`Kitsu ID mapping: ${malIds.length - missing.length} cached, fetching ${missing.length} from Kitsu API`);

  const newEntries = {};
  const chunks = [];
  for (let i = 0; i < missing.length; i += KITSU_BATCH_SIZE) {
    chunks.push(missing.slice(i, i + KITSU_BATCH_SIZE));
  }

  await Promise.all(chunks.map(async (chunk) => {
    try {
      // Build URL manually — axios encodes commas as %2C in params,
      // but Kitsu requires literal commas for multi-value filters.
      const qs = `filter[externalSite]=myanimelist/anime&filter[externalId]=${chunk.join(',')}&include=item&page[limit]=${KITSU_BATCH_SIZE}`;
      const url = `${KITSU_API_URL}/mappings?${qs}`;
      const response = await axios.get(url, {
        headers: { 'Accept': 'application/vnd.api+json' },
        timeout: 10000
      });
      console.log(`Kitsu batch returned ${response.data?.data?.length ?? 0} mappings`);

      for (const item of response.data?.data || []) {
        const malId = item.attributes?.externalId;
        const kitsuId = item.relationships?.item?.data?.id;
        if (kitsuId && malId != null) {
          newEntries[String(malId)] = String(kitsuId);
          map[String(malId)] = String(kitsuId);
        }
      }
    } catch (err) {
      console.warn(`Kitsu ID batch lookup failed: ${err.message}`);
    }
  }));

  // Store null sentinel for IDs confirmed to have no Kitsu mapping so we
  // don't re-query them on the next catalog load.
  for (const id of missing) {
    if (!(String(id) in newEntries)) newEntries[String(id)] = null;
  }
  mappingsStore.setMalKitsuEntries(newEntries);

  return map;
}

/**
 * Transforms a MAL animelist entry into Stremio meta format.
 *
 * @private
 * @param {Object} entry - MAL list entry ({ node, list_status })
 * @param {Object} kitsuIdMap - map of malId -> kitsuId
 * @returns {Object} Stremio-compatible meta object
 */
function transformToStremioMeta(entry, kitsuIdMap = {}) {
  const anime = entry.node;
  const listStatus = entry.list_status;
  // Use root kitsu ID if this entry was identified as a non-root sequel
  const kitsuId = entry._rootKitsuId || kitsuIdMap[String(anime.id)] || null;
  return buildMeta(anime, listStatus?.num_episodes_watched ?? 0, kitsuId);
}

/**
 * Transforms a single MAL anime object (from /anime/:id) into Stremio meta format.
 *
 * @private
 * @param {Object} anime - MAL anime object
 * @returns {Object} Stremio-compatible meta object
 */
function transformSingleToMeta(anime) {
  return buildMeta(anime, 0, null);
}

/**
 * Shared builder for Stremio meta objects from MAL data.
 *
 * @private
 */
function buildMeta(anime, progressEpisodes, kitsuId) {
  const rating = anime.mean ? anime.mean.toFixed(1) : null;

  const cleanDescription = anime.synopsis
    ? anime.synopsis.replace(/<[^>]*>/g, '').trim()
    : '';

  const year = anime.start_season?.year ?? null;

  // Prefer English title; fall back to the default MAL title (usually romaji)
  const altTitles = anime.alternative_titles || {};
  const englishTitle = altTitles.en && altTitles.en.trim() !== '' ? altTitles.en.trim() : null;
  const primaryTitle = englishTitle || anime.title;

  // Build deduplicated aliases list for Torrentio/search fallback
  const aliasSet = new Set();
  if (englishTitle) aliasSet.add(englishTitle);
  if (anime.title) aliasSet.add(anime.title);
  if (altTitles.ja) aliasSet.add(altTitles.ja);
  (altTitles.synonyms || []).forEach(s => aliasSet.add(s));
  aliasSet.delete(primaryTitle);
  const aliases = [...aliasSet].filter(Boolean);

  return {
    id: kitsuId ? `kitsu:${kitsuId}` : `mal:${anime.id}`,
    type: anime.media_type === 'movie' ? 'movie' : 'series',
    name: primaryTitle,
    aliases,
    poster: anime.main_picture?.large || anime.main_picture?.medium || null,
    posterShape: POSTER_SHAPES.PORTRAIT,
    background: anime.main_picture?.large || null,
    description: cleanDescription,
    genres: (anime.genres || []).map(g => g.name),
    imdbRating: rating,
    releaseInfo: year ? `${year}` : undefined,
    year,
    watched: progressEpisodes > 0,
    meta: {
      episodes: anime.num_episodes,
      status: anime.status,
      progress: progressEpisodes
    }
  };
}

/**
 * Updates the user's progress for an anime on MyAnimeList.
 * Requires the user to have authenticated via OAuth (token stored in tokens.json).
 *
 * @async
 * @param {string} animeId - MAL anime ID
 * @param {number} episode - Episode number that was watched
 * @param {string} username - User's MAL username
 * @param {string} clientId - MAL Client ID (unused here, kept for signature compat)
 * @returns {Promise<void>}
 * @throws {Error} If progress update fails
 */
async function updateProgress(animeId, episode, username, clientId) {
  try {
    console.log(`Updating progress for MAL anime ${animeId}: episode ${episode} for user ${username}`);

    const tokens = tokenManager.getTokens('mal', username);
    if (!tokens) {
      throw new Error('User not authenticated with MyAnimeList. Please authenticate via the configure page.');
    }

    await axios.patch(
      `${MAL_API_URL}/anime/${animeId}/my_list_status`,
      new URLSearchParams({ num_watched_episodes: episode }),
      {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000
      }
    );

    console.log(`Successfully updated MAL progress for anime ${animeId} to episode ${episode}`);

  } catch (error) {
    console.error(`Error updating progress for anime ${animeId}:`, error.message);
    throw new Error(`Failed to update progress: ${error.message}`);
  }
}

/**
 * Traverses MAL's prequel chain upward from a given MAL ID to find the
 * franchise root (S1), then returns its Kitsu ID.
 *
 * @param {string|number} startMalId - MAL ID to start traversal from
 * @param {string} clientId - MAL API Client ID
 * @returns {Promise<string|null>} Kitsu ID of the root, or null
 */
async function findRootMalKitsuId(startMalId, clientId) {
  const cacheKey = String(startMalId);
  if (rootMalKitsuCache.has(cacheKey)) return rootMalKitsuCache.get(cacheKey);

  let currentId = String(startMalId);
  for (let depth = 0; depth < 5; depth++) {
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await axios.get(
          `${MAL_API_URL}/anime/${encodeURIComponent(currentId)}`,
          {
            params: { fields: 'related_anime' },
            headers: { 'X-MAL-CLIENT-ID': clientId },
            timeout: 10000
          }
        );
        break;
      } catch (err) {
        if (err.response?.status === 429 && attempt < 2) {
          const wait = (attempt + 1) * 2000;
          console.warn(`MAL 429 in findRootMalKitsuId(${currentId}), retrying in ${wait}ms...`);
          await new Promise(r => setTimeout(r, wait));
        } else {
          console.error(`findRootMalKitsuId traversal failed at MAL id ${currentId}:`, err.message);
          return null;
        }
      }
    }
    if (!response) return null;
    const related = response.data?.related_anime || [];
    const prequelRel = related.find(r => r.relation_type === 'prequel');
    if (!prequelRel) {
      // currentId has no prequel — it IS the root; map to Kitsu
      const kitsuMap = await fetchKitsuIdMap([parseInt(currentId, 10)]);
      const kitsuId = kitsuMap[currentId] || null;
      rootMalKitsuCache.set(cacheKey, kitsuId);
      rootMalKitsuCache.set(currentId, kitsuId);
      return kitsuId;
    }
    currentId = String(prequelRel.node.id);
  }
  return null;
}

/**
 * Fetches the authenticated user's username from MAL using their access token.
 *
 * @async
 * @param {string} accessToken - MAL OAuth access token
 * @returns {Promise<string|null>} MAL username or null
 */
async function getAuthenticatedUsername(accessToken) {
  try {
    const response = await axios.get(`${MAL_API_URL}/users/@me`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
      timeout: 10000
    });
    return response.data?.name || null;
  } catch (err) {
    console.error('Failed to fetch MAL username from @me:', err.message);
    return null;
  }
}

module.exports = {
  getAnimeList,
  getAnimeMeta,
  updateProgress,
  mapKitsuToMal,
  getSeasonMalId,
  getAuthenticatedUsername
};

/**
 * Traverses MAL's sequel chain to find the MAL ID for a specific season.
 * Season 1 = rootMalId, Season 2 = first sequel, Season 3 = second sequel, etc.
 *
 * @param {string} rootMalId - MAL ID of the root/first season
 * @param {number} season - Season number (1-based)
 * @param {string} clientId - MAL API Client ID
 * @returns {Promise<string>} MAL ID for the requested season (or last known if chain ends early)
 */
async function getSeasonMalId(rootMalId, season, clientId) {
  if (!season || season <= 1) return rootMalId;
  let currentId = rootMalId;
  for (let i = 1; i < season; i++) {
    try {
      const response = await axios.get(
        `${MAL_API_URL}/anime/${encodeURIComponent(currentId)}`,
        {
          params: { fields: 'related_anime' },
          headers: { 'X-MAL-CLIENT-ID': clientId },
          timeout: 10000
        }
      );
      const related = response.data?.related_anime || [];
      const sequel = related.find(r => r.relation_type === 'sequel');
      if (!sequel) {
        console.log(`No sequel found for MAL ID ${currentId} at season ${i + 1}, using last resolved ID`);
        break;
      }
      currentId = String(sequel.node.id);
      console.log(`Season ${i + 1} resolved to MAL ID ${currentId}`);
    } catch (err) {
      console.error(`getSeasonMalId failed at season ${i + 1}:`, err.message);
      break;
    }
  }
  return currentId;
}

/**
 * Maps a Kitsu anime ID to a MAL anime ID.
 *
 * @async
 * @param {string} kitsuId - Kitsu anime ID
 * @returns {Promise<string|null>} MAL ID or null if not found
 */
async function mapKitsuToMal(kitsuId) {
  try {
    const response = await axios.get(
      `${KITSU_API_URL}/anime/${encodeURIComponent(kitsuId)}/mappings?filter[externalSite]=myanimelist/anime`,
      {
        headers: { 'Accept': 'application/vnd.api+json' },
        timeout: 10000
      }
    );
    const malId = response.data?.data?.[0]?.attributes?.externalId;
    return malId ? String(malId) : null;
  } catch (err) {
    console.warn(`Kitsu→MAL mapping failed for kitsuId ${kitsuId}: ${err.message}`);
    return null;
  }
}
