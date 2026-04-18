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

const ANIME_LIST_QUERY = `
  query ($userId: Int, $status: MediaListStatus) {
    MediaListCollection(userId: $userId, type: ANIME, status: $status) {
      lists {
        entries {
          id
          media {
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
            episodes
            seasonYear
            season
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
    console.log(`Found ${entries.length} ${status} anime`);

    // Transform AniList entries to Stremio meta format
    return entries.map(entry => transformToStremioMeta(entry));

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

  return {
    id: `anilist:${media.id}`,
    type: 'series',
    name: title,
    aliases,
    poster: media.coverImage.large || media.coverImage.medium,
    posterShape: POSTER_SHAPES.PORTRAIT,
    background: media.bannerImage || media.coverImage.large,
    description: cleanDescription,
    genres: media.genres || [],
    imdbRating: rating,
    releaseInfo: media.seasonYear ? `${media.seasonYear}` : undefined,
    year: media.seasonYear,
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
const ANIME_META_QUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      id
      title { english romaji }
      description(asHtml: false)
      coverImage { large medium }
      bannerImage
      genres
      averageScore
      status
      episodes
      seasonYear
      season
    }
  }
`;

async function getAnimeMeta(id) {
  try {
    const anilistId = parseInt(id.replace('anilist:', ''), 10);
    console.log(`Fetching metadata for anime ID: ${anilistId}`);

    const response = await axios.post(
      ANILIST_API_URL,
      { query: ANIME_META_QUERY, variables: { id: anilistId } },
      { headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, timeout: 10000 }
    );

    const media = response.data?.data?.Media;
    if (!media) throw new Error(`No media found for AniList ID ${anilistId}`);

    const title = media.title.english || media.title.romaji;
    const totalEpisodes = media.episodes || 0;
    const rating = media.averageScore ? (media.averageScore / 10).toFixed(1) : undefined;

    // Build episode list so Stremio shows episode buttons
    const videos = [];
    for (let ep = 1; ep <= totalEpisodes; ep++) {
      videos.push({
        id: `${id}:1:${ep}`,
        title: `Episode ${ep}`,
        season: 1,
        episode: ep,
        released: new Date(0).toISOString()
      });
    }

    return {
      id,
      type: 'series',
      name: title,
      description: media.description || '',
      poster: media.coverImage?.large || media.coverImage?.medium,
      background: media.bannerImage,
      genres: media.genres || [],
      imdbRating: rating,
      releaseInfo: media.seasonYear ? String(media.seasonYear) : undefined,
      videos
    };
  } catch (error) {
    console.error(`Error fetching anime meta for ${id}:`, error.message);
    throw new Error(`Failed to fetch anime metadata: ${error.message}`);
  }
}

async function updateProgress(animeId, episode, token) {
  try {
    const response = await axios.post(
      ANILIST_API_URL,
      {
        query: UPDATE_PROGRESS_MUTATION,
        variables: { mediaId: parseInt(animeId, 10), progress: parseInt(episode, 10) }
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
    console.log(`Updated AniList progress: anime ${animeId} → episode ${episode}`);
    return response.data;
  } catch (error) {
    const apiError = error.response?.data?.errors?.[0]?.message || error.message;
    console.error(`Failed to update AniList progress for anime ${animeId}:`, apiError);
    throw new Error(`AniList progress update failed: ${apiError}`);
  }
}

async function mapImdbToAniList(imdbId) {
  // 1. Try ARM (AniList Relation Map) — fast direct mapping
  try {
    const res = await axios.get(`https://arm.haglund.dev/api/v2/ids?source=imdb&id=${encodeURIComponent(imdbId)}`, {
      timeout: 8000
    });
    const anilistId = res.data?.anilist;
    if (anilistId) return String(anilistId);
  } catch (_) { /* fall through */ }

  // 2. Fetch title from Cinemeta, then search AniList by title
  try {
    const cinemetaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/series/${encodeURIComponent(imdbId)}.json`, {
      timeout: 8000
    });
    const title = cinemetaRes.data?.meta?.name;
    if (!title) return null;

    console.log(`ARM miss for ${imdbId} — searching AniList by title: "${title}"`);

    const searchQuery = `
      query ($search: String) {
        Media(search: $search, type: ANIME) { id title { romaji english } }
      }
    `;
    const searchRes = await axios.post(ANILIST_API_URL,
      { query: searchQuery, variables: { search: title } },
      { headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, timeout: 8000 }
    );
    const media = searchRes.data?.data?.Media;
    if (media?.id) {
      console.log(`Resolved ${imdbId} → AniList ${media.id} ("${media.title.english || media.title.romaji}")`);
      return String(media.id);
    }
  } catch (err) {
    console.error(`IMDB→AniList fallback error for ${imdbId}:`, err.message);
  }

  return null;
}

async function mapKitsuToAniList(kitsuId) {
  try {
    // 1. Try direct ID match on AniList
    const directQuery = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) { id title { romaji english } }
      }
    `;
    const directRes = await axios.post(ANILIST_API_URL,
      { query: directQuery, variables: { id: parseInt(kitsuId, 10) } },
      { headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, timeout: 10000 }
    );
    if (directRes.data?.data?.Media?.id) {
      return String(directRes.data.data.Media.id);
    }
  } catch (_) { /* fall through */ }

  try {
    // 2. Fetch title from Kitsu API, then search AniList by title
    const kitsuRes = await axios.get(`https://kitsu.io/api/edge/anime/${kitsuId}`, {
      headers: { 'Accept': 'application/vnd.api+json' }, timeout: 10000
    });
    const attrs = kitsuRes.data?.data?.attributes;
    const title = attrs?.titles?.en || attrs?.titles?.en_jp || attrs?.canonicalTitle;
    if (!title) return null;

    const searchQuery = `
      query ($search: String) {
        Media(search: $search, type: ANIME) { id title { romaji english } }
      }
    `;
    const searchRes = await axios.post(ANILIST_API_URL,
      { query: searchQuery, variables: { search: title } },
      { headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, timeout: 10000 }
    );
    const media = searchRes.data?.data?.Media;
    if (media?.id) return String(media.id);
  } catch (err) {
    console.error(`Kitsu→AniList mapping error for kitsuId ${kitsuId}:`, err.message);
  }

  return null;
}

module.exports = {
  getViewerInfo,
  getAnimeList,
  getAnimeMeta,
  updateProgress,
  mapKitsuToAniList,
  mapImdbToAniList
};

// Made with Bob
