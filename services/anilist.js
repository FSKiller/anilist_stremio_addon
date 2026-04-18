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
const tokenManager = require('../config/tokens');

/**
 * GraphQL query to search for anime by Kitsu ID in external links
 * 
 * @constant {string}
 */
const SEARCH_BY_KITSU_QUERY = `
  query ($search: String, $type: MediaType) {
    Page(page: 1, perPage: 10) {
      media(search: $search, type: $type) {
        id
        title {
          romaji
          english
        }
        externalLinks {
          site
          url
        }
      }
    }
  }
`;

/**
 * Maps a Kitsu anime ID to AniList anime ID
 * 
 * @async
 * @param {string} kitsuId - Kitsu anime ID (e.g., "46729")
 * @returns {Promise<string|null>} AniList ID or null if not found
 * @throws {Error} If mapping fails
 */
async function mapKitsuToAniList(kitsuId) {
  try {
    console.log(`Attempting to map Kitsu ID ${kitsuId} to AniList ID`);
    
    // Method 1: Try using Kitsu ID directly as AniList ID (sometimes they match)
    try {
      const directResponse = await axios.post(
        ANILIST_API_URL,
        {
          query: `
            query ($id: Int) {
              Media(id: $id, type: ANIME) {
                id
                title {
                  romaji
                  english
                }
              }
            }
          `,
          variables: { 
            id: parseInt(kitsuId, 10)
          }
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          timeout: 10000
        }
      );

      if (directResponse.data.data?.Media) {
        const media = directResponse.data.data.Media;
        console.log(`Successfully mapped Kitsu ID ${kitsuId} to AniList ID ${media.id} (${media.title.english || media.title.romaji})`);
        return media.id.toString();
      }
    } catch (directError) {
      console.log(`Direct mapping failed for Kitsu ID ${kitsuId}`);
    }

    // Method 2: Try to get anime title from Kitsu API and search AniList
    try {
      console.log(`Trying title-based search for Kitsu ID ${kitsuId}`);
      
      // Get anime title from Kitsu API
      const kitsuResponse = await axios.get(`https://kitsu.io/api/edge/anime/${kitsuId}`, {
        timeout: 10000,
        headers: {
          'Accept': 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json'
        }
      });

      if (kitsuResponse.data?.data?.attributes) {
        const kitsuTitle = kitsuResponse.data.data.attributes.canonicalTitle ||
                          kitsuResponse.data.data.attributes.titles?.en ||
                          kitsuResponse.data.data.attributes.titles?.en_jp;

        if (kitsuTitle) {
          console.log(`Found Kitsu title: "${kitsuTitle}" for ID ${kitsuId}`);

          // Search AniList by title
          const searchResponse = await axios.post(
            ANILIST_API_URL,
            {
              query: `
                query ($search: String, $type: MediaType) {
                  Page(page: 1, perPage: 5) {
                    media(search: $search, type: $type) {
                      id
                      title {
                        romaji
                        english
                      }
                      synonyms
                    }
                  }
                }
              `,
              variables: {
                search: kitsuTitle,
                type: 'ANIME'
              }
            },
            {
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              timeout: 10000
            }
          );

          const results = searchResponse.data.data?.Page?.media || [];
          if (results.length > 0) {
            // Take the first (best) match
            const match = results[0];
            console.log(`Title search matched AniList ID ${match.id} (${match.title.english || match.title.romaji}) for Kitsu title "${kitsuTitle}"`);
            return match.id.toString();
          } else {
            console.log(`No AniList matches found for Kitsu title "${kitsuTitle}"`);
          }
        }
      }
    } catch (titleError) {
      console.log(`Title-based search failed for Kitsu ID ${kitsuId}:`, titleError.message);
    }

    console.log(`Kitsu ID ${kitsuId} could not be mapped to any AniList ID`);
    return null;

  } catch (error) {
    console.error(`Error mapping Kitsu ID ${kitsuId}:`, error.message);
    throw new Error(`Failed to map Kitsu ID: ${error.message}`);
  }
}

const KITSU_API_URL = 'https://kitsu.io/api/edge';

/**
 * GraphQL query to fetch user's currently watching anime
 * 
 * This query retrieves all anime from a user's list with CURRENT status,
 * including comprehensive metadata needed for Stremio display.
 * 
 * @constant {string}
 */
const ANIME_LIST_QUERY = `
  query ($userName: String, $status: MediaListStatus) {
    MediaListCollection(userName: $userName, type: ANIME, status: $status) {
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
async function getAnimeList(username, status) {
  try {
    console.log(`Fetching ${status} anime for user: ${username}`);
    
    const response = await axios.post(
      ANILIST_API_URL,
      {
        query: ANIME_LIST_QUERY,
        variables: { userName: username, status }
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

  // Prefer kitsu: IDs so stream addons (Comet, MediaFusion, AIO Streams) can
  // find streams. Fall back to anilist: if no Kitsu link is available.
  const kitsuId = extractKitsuId(media.externalLinks);
  const id = kitsuId ? `kitsu:${kitsuId}` : `anilist:${media.id}`;

  // Use 'movie' for films, 'series' for everything else so stream addons
  // (Comet, MediaFusion, AIO Streams) recognise the content type.
  const type = media.format === 'MOVIE' ? 'movie' : 'series';

  return {
    id,
    type,
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
  console.log(`Fetching Kitsu metadata for anime ID: ${kitsuId}`);

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

async function getAnimeMeta(id) {
  try {
    if (id.startsWith('kitsu:')) {
      return await fetchKitsuMeta(id);
    }

    // Legacy anilist: ID — fetch from AniList
    const anilistId = id.replace('anilist:', '');
    console.log(`Fetching AniList metadata for anime ID: ${anilistId}`);

    // TODO: Implement full metadata fetch from AniList GraphQL
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

/**
 * Updates the user's progress for an anime on AniList
 * 
 * This function increments the progress (episodes watched) for a specific
 * anime in the user's AniList. Requires authentication.
 * 
 * @async
 * @param {string} animeId - AniList anime ID
 * @param {number} episode - Episode number that was watched
 * @param {string} username - User's AniList username
 * @returns {Promise<void>}
 * @throws {Error} If progress update fails
 * 
 * @example
 * await updateProgress("12345", 5, "myusername");
 */
async function updateProgress(animeId, episode, username) {
  try {
    console.log(`Updating progress for AniList anime ${animeId}: episode ${episode} for user ${username}`);
    
    // Get user's access token
    const tokens = tokenManager.getTokens('anilist', username);
    if (!tokens) {
      throw new Error('User not authenticated with AniList');
    }
    
    const mutation = `
      mutation ($mediaId: Int, $progress: Int) {
        SaveMediaListEntry (mediaId: $mediaId, progress: $progress) {
          id
          progress
          status
        }
      }
    `;
    
    const response = await axios.post(
      ANILIST_API_URL,
      {
        query: mutation,
        variables: { 
          mediaId: parseInt(animeId, 10), 
          progress: episode 
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 10000
      }
    );
    
    if (response.data.errors) {
      throw new Error(`AniList API error: ${response.data.errors[0].message}`);
    }
    
    console.log(`Successfully updated AniList progress for anime ${animeId} to episode ${episode}`);
    
  } catch (error) {
    console.error(`Error updating progress for anime ${animeId}:`, error.message);
    throw new Error(`Failed to update progress: ${error.message}`);
  }
}

module.exports = {
  getAnimeList,
  getAnimeMeta,
  updateProgress,
  mapKitsuToAniList
};

// Made with Bob
