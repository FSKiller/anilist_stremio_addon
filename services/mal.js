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
    return data.map(entry => transformToStremioMeta(entry));

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
 * Transforms a MAL animelist entry into Stremio meta format.
 *
 * @private
 * @param {Object} entry - MAL list entry ({ node, list_status })
 * @returns {Object} Stremio-compatible meta object
 */
function transformToStremioMeta(entry) {
  const anime = entry.node;
  const listStatus = entry.list_status;
  return buildMeta(anime, listStatus?.num_episodes_watched ?? 0);
}

/**
 * Transforms a single MAL anime object (from /anime/:id) into Stremio meta format.
 *
 * @private
 * @param {Object} anime - MAL anime object
 * @returns {Object} Stremio-compatible meta object
 */
function transformSingleToMeta(anime) {
  return buildMeta(anime, 0);
}

/**
 * Shared builder for Stremio meta objects from MAL data.
 *
 * @private
 */
function buildMeta(anime, progressEpisodes) {
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
    id: `mal:${anime.id}`,
    type: 'anime',
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

module.exports = {
  getAnimeList,
  getAnimeMeta
};
