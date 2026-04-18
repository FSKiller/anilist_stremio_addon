/**
 * Stremio Addon Interface
 * 
 * This module defines the Stremio addon interface, including the manifest
 * and handlers for catalog and meta requests. It acts as the bridge between
 * Stremio and the AniList service.
 * 
 * @module addon
 */

const anilistService = require('./services/anilist');
const malService = require('./services/mal');
const { ADDON_MANIFEST, MAL_MANIFEST, ANILIST_CATALOGS, MAL_CATALOGS } = require('./config/constants');

// Maps the genre filter label to each service's status value
const ANILIST_STATUS_MAP = {
  'Currently Watching': 'CURRENT',
  'On Hold':            'PAUSED',
  'Plan to Watch':      'PLANNING',
  'Dropped':            'DROPPED',
  'Completed':          'COMPLETED',
  'Rewatching':         'REPEATING'
};

const MAL_STATUS_MAP = {
  'Currently Watching': 'watching',
  'On Hold':            'on_hold',
  'Plan to Watch':      'plan_to_watch',
  'Dropped':            'dropped',
  'Completed':          'completed',
  'Rewatching':         'rewatching'
};

/**
 * Returns the Stremio manifest for a given service.
 *
 * @param {string} service - 'anilist' or 'mal'
 * @returns {Object} Stremio manifest object
 */
function getManifest(service) {
  if (service === 'mal') {
    return { ...MAL_MANIFEST, catalogs: MAL_CATALOGS };
  }
  return { ...ADDON_MANIFEST, catalogs: ANILIST_CATALOGS };
}

// Legacy single manifest (AniList) for backwards compatibility
const manifest = getManifest('anilist');

/**
 * Handles catalog requests from Stremio
 * 
 * This function processes requests for catalog content. When Stremio requests
 * a catalog, this handler fetches the appropriate data from AniList and returns
 * it in Stremio's expected format.
 * 
 * @async
 * @param {string} type - Content type (e.g., "anime", "movie")
 * @param {string} id - Catalog identifier (e.g., "anilist.watching")
 * @param {string} [extra] - Optional extra parameters (pagination, filters, etc.)
 * @returns {Promise<Object>} Catalog response object
 * @returns {Array<Object>} return.metas - Array of meta objects for the catalog
 * 
 * @throws {Error} If catalog fetching fails
 * 
 * @example
 * const catalog = await getCatalog("anime", "anilist.watching");
 * // Returns: { metas: [{ id: "anilist:12345", name: "...", ... }] }
 */
async function getCatalog(type, id, extra, token, service, malClientId) {
  try {
    console.log(`Catalog request - Service: ${service}, Type: ${type}, ID: ${id}, Extra: ${extra || 'none'}`);    

    if (type !== 'anime' && type !== 'series') {
      console.warn(`Invalid type "${type}" for catalog "${id}". Expected "anime" or "series".`);
      return { metas: [] };
    }

    // Parse genre filter from extra string, e.g. "genre=On%20Hold"
    let genreFilter = 'Currently Watching';
    if (extra) {
      const match = extra.match(/genre=([^&]+)/);
      if (match) {
        genreFilter = decodeURIComponent(match[1]);
      }
    }

    if (service === 'mal' && id === 'mal.list') {
      const malStatus = MAL_STATUS_MAP[genreFilter] || 'watching';
      const metas = await malService.getAnimeList(token, malClientId, malStatus);
      console.log(`Returning ${metas.length} items for MAL catalog [${genreFilter}]`);
      return { metas };
    }

    if (service === 'anilist' && id === 'anilist.list') {
      const anilistStatus = ANILIST_STATUS_MAP[genreFilter] || 'CURRENT';
      const metas = await anilistService.getAnimeList(token, anilistStatus);
      console.log(`Returning ${metas.length} items for AniList catalog [${genreFilter}]`);
      return { metas };
    }

    console.warn(`Unknown catalog ID: ${id}`);
    return { metas: [] };

  } catch (error) {
    console.error(`Error in getCatalog (${type}/${id}):`, error.message);
    throw new Error(`Failed to fetch catalog: ${error.message}`);
  }
}

/**
 * Handles meta requests from Stremio
 * 
 * This function processes requests for detailed metadata about a specific
 * content item. When Stremio needs more information about an anime
 * (e.g., when user clicks on it), this handler fetches the details.
 * 
 * @async
 * @param {string} type - Content type (e.g., "anime", "movie")
 * @param {string} id - Content identifier (e.g., "anilist:12345")
 * @returns {Promise<Object>} Meta response object
 * @returns {Object} return.meta - Detailed metadata object
 * 
 * @throws {Error} If meta fetching fails
 * 
 * @example
 * const meta = await getMeta("anime", "anilist:12345");
 * // Returns: { meta: { id: "anilist:12345", name: "...", ... } }
 */
async function getMeta(type, id, token, service, malClientId) {
  try {
    console.log(`Meta request - Service: ${service}, Type: ${type}, ID: ${id} (token present: ${!!token})`);    

    if (type !== 'anime' && type !== 'series') {
      throw new Error(`Unsupported content type: ${type}`);
    }

    if (service === 'mal') {
      if (!id.startsWith('mal:')) {
        return { meta: null };
      }
      const meta = await malService.getAnimeMeta(id, malClientId);
      return { meta };
    }

    // Default: AniList
    if (!id.startsWith('anilist:')) {
      return { meta: null };
    }
    const meta = await anilistService.getAnimeMeta(id);
    return { meta };

  } catch (error) {
    console.error(`Error in getMeta (${type}/${id}):`, error.message);
    
    // Re-throw error to be handled by the HTTP layer
    throw new Error(`Failed to fetch metadata: ${error.message}`);
  }
}

/**
 * getStream - Handle stream requests with progress tracking
 * 
 * This function handles Stremio stream requests and implements progress updates
 * that only occur after 5 minutes of continuous watching.
 * 
 * @async
 * @param {string} type - Content type (should be 'anime')
 * @param {string} id - Content ID (e.g., 'anilist:12345')
 * @param {Object} videoInfo - Video information including episode number
 * @param {string} username - User's username
 * @param {string} service - Service type ('anilist' or 'mal')
 * @param {string} malClientId - MAL Client ID (for MAL service)
 * @returns {Promise<Object>} Stream response object
 */
async function getStream(type, id, videoInfo, token, service, malClientId) {
  try {
    console.log(`Stream request - Service: ${service}, Type: ${type}, ID: ${id}, Video: ${JSON.stringify(videoInfo)} (token present: ${!!token})`);    

    if (type !== 'anime' && type !== 'series') {
      throw new Error(`Unsupported content type: ${type}`);
    }

    // Extract anime ID from the content ID
    let animeId;
    let actualService = service;

    if (service === 'mal') {
      if (!id.startsWith('mal:')) {
        return { streams: [] };
      }
      animeId = id.substring(4); // Remove 'mal:' prefix
    } else {
      // Default: AniList - handle both anilist: and kitsu: IDs
      if (id.startsWith('anilist:')) {
        animeId = id.split(':')[1]; // just the numeric ID
      } else if (id.startsWith('kitsu:')) {
        // Extract Kitsu ID (may include season info like kitsu:46729:3)
        const kitsuId = id.split(':')[1];
        try {
          // Map Kitsu ID to AniList ID
          const anilistId = await anilistService.mapKitsuToAniList(kitsuId);
          if (!anilistId) {
            console.log(`Could not map Kitsu ID ${kitsuId} to AniList ID`);
            return { streams: [] };
          }
          animeId = anilistId;
          console.log(`Mapped Kitsu ID ${kitsuId} to AniList ID ${animeId}`);
        } catch (mappingError) {
          console.error(`Failed to map Kitsu ID ${kitsuId}:`, mappingError.message);
          return { streams: [] };
        }
      } else if (/^tt\d+/.test(id)) {
        // IMDB ID — bare (tt32550889) or series format (tt32550889:1:2)
        const imdbId = id.split(':')[0];
        try {
          const anilistId = await anilistService.mapImdbToAniList(imdbId);
          if (!anilistId) {
            console.log(`Could not map IMDB ID ${id} to AniList ID`);
            return { streams: [] };
          }
          animeId = anilistId;
          console.log(`Mapped IMDB ID ${id} to AniList ID ${animeId}`);
        } catch (mappingError) {
          console.error(`Failed to map IMDB ID ${id}:`, mappingError.message);
          return { streams: [] };
        }
      } else {
        return { streams: [] };
      }
    }

    // Handle progress update if videoInfo contains episode information
    if (videoInfo && videoInfo.episode) {
      try {
        const tokenManager = require('./config/tokens');
        
        // Clean up old watch sessions first
        tokenManager.cleanupOldSessions(actualService, token);

        // Start or update watch session
        tokenManager.storeWatchSession(actualService, token, animeId, videoInfo.episode);

        // [TESTING] 5-minute wait removed — update progress immediately
        if (actualService === 'mal') {
          await malService.updateProgress(animeId, videoInfo.episode, token, malClientId);
        } else {
          await anilistService.updateProgress(animeId, videoInfo.episode, token);
        }
        console.log(`✅ Updated progress for ${actualService} anime ${animeId}: episode ${videoInfo.episode}`);
      } catch (progressError) {
        console.error(`Failed to update progress for ${actualService} anime ${animeId}:`, progressError.message);
        // Don't fail the stream request if progress update fails
      }
    }

    // Return empty streams since this addon doesn't provide actual streaming
    // The main purpose is progress tracking
    return { streams: [] };

  } catch (error) {
    console.error(`Error in getStream (${type}/${id}):`, error.message);
    throw new Error(`Failed to process stream request: ${error.message}`);
  }
}

/**
 * Exported addon interface
 * 
 * This object provides the public API for the Stremio addon,
 * exposing the manifest and handler functions.
 */
module.exports = {
  manifest,
  getManifest,
  getCatalog,
  getMeta,
  getStream
};

// Made with Bob
