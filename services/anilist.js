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
const CURRENTLY_WATCHING_QUERY = `
  query ($userName: String) {
    MediaListCollection(userName: $userName, type: ANIME, status: CURRENT) {
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
async function getCurrentlyWatchingAnime(username) {
  try {
    console.log(`Fetching currently watching anime for user: ${username}`);
    
    // Make GraphQL request to AniList API
    const response = await axios.post(
      ANILIST_API_URL,
      {
        query: CURRENTLY_WATCHING_QUERY,
        variables: { userName: username }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 10000 // 10 second timeout
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
      console.log('No currently watching anime found for user');
      return [];
    }

    const entries = mediaListCollection.lists[0]?.entries || [];
    console.log(`Found ${entries.length} currently watching anime`);

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
    type: 'anime',
    name: title,
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
async function getAnimeMeta(id) {
  try {
    // Extract numeric ID from "anilist:12345" format
    const anilistId = id.replace('anilist:', '');
    
    console.log(`Fetching metadata for anime ID: ${anilistId}`);
    
    // TODO: Implement full metadata fetch from AniList
    // For now, return basic structure
    return {
      id,
      type: 'anime',
      name: 'Anime Title',
      description: 'Detailed anime information would be fetched here'
    };
  } catch (error) {
    console.error(`Error fetching anime meta for ${id}:`, error.message);
    throw new Error(`Failed to fetch anime metadata: ${error.message}`);
  }
}

module.exports = {
  getCurrentlyWatchingAnime,
  getAnimeMeta
};

// Made with Bob
