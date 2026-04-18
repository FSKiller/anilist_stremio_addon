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

const KITSU_API_URL = 'https://kitsu.io/api/edge';
const KITSU_BATCH_SIZE = 20;

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
  'alternative_titles'
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
 * Fetches a user's currently watching anime from MAL.
 *
 * @async
 * @param {string} username - MAL username
 * @param {string} clientId - MAL API Client ID
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

    return data.map(entry => transformToStremioMeta(entry, kitsuIdMap));

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

  return {
    id,
    type: 'anime',
    name: title,
    poster: attrs.posterImage?.large || attrs.posterImage?.medium,
    posterShape: POSTER_SHAPES.PORTRAIT,
    background: attrs.coverImage?.large || attrs.coverImage?.original,
    description: cleanDescription,
    imdbRating: rating,
    releaseInfo: year ? `${year}` : undefined,
    year
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

  const map = {};
  const chunks = [];
  for (let i = 0; i < malIds.length; i += KITSU_BATCH_SIZE) {
    chunks.push(malIds.slice(i, i + KITSU_BATCH_SIZE));
  }

  await Promise.all(chunks.map(async (chunk) => {
    try {
      // Build URL manually — axios encodes commas as %2C in params,
      // but Kitsu requires literal commas for multi-value filters.
      const qs = `filter[externalSite]=myanimelist/anime&filter[externalId]=${chunk.join(',')}&include=item&page[limit]=${KITSU_BATCH_SIZE}`;
      const url = `${KITSU_API_URL}/mappings?${qs}`;
      console.log(`Kitsu batch URL: ${url}`);
      const response = await axios.get(url, {
        headers: { 'Accept': 'application/vnd.api+json' },
        timeout: 10000
      });
      console.log(`Kitsu batch returned ${response.data?.data?.length ?? 0} mappings`);

      for (const item of response.data?.data || []) {
        const malId = item.attributes?.externalId;
        const kitsuId = item.relationships?.item?.data?.id;
        if (kitsuId && malId != null) {
          map[String(malId)] = String(kitsuId);
        }
      }
    } catch (err) {
      console.warn(`Kitsu ID batch lookup failed: ${err.message}`);
    }
  }));

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
  const kitsuId = kitsuIdMap[String(anime.id)] || null;
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
 * Updates the user's progress for an anime on MyAnimeList
 * 
 * This function increments the progress (episodes watched) for a specific
 * anime in the user's MyAnimeList. Requires authentication.
 * 
 * @async
 * @param {string} animeId - MAL anime ID
 * @param {number} episode - Episode number that was watched
 * @param {string} username - User's MAL username
 * @param {string} clientId - MAL Client ID
 * @returns {Promise<void>}
 * @throws {Error} If progress update fails
 * 
 * @example
 * await updateProgress("12345", 5, "myusername", "client_id");
 */
async function updateProgress(animeId, episode, username, clientId) {
  try {
    console.log(`Updating progress for MAL anime ${animeId}: episode ${episode} for user ${username}`);
    
    // Get user's access token
    const tokens = tokenManager.getTokens('mal', username);
    if (!tokens) {
      throw new Error('User not authenticated with MyAnimeList');
    }
    
    const response = await axios.patch(
      `${MAL_API_URL}/anime/${animeId}/my_list_status`,
      { num_watched_episodes: episode },
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

module.exports = {
  getAnimeList,
  getAnimeMeta,
  updateProgress
};
