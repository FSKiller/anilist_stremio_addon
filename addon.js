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
const { ADDON_MANIFEST, CATALOGS } = require('./config/constants');

/**
 * Stremio addon manifest
 * 
 * The manifest defines the addon's identity, capabilities, and resources.
 * It tells Stremio what content types the addon supports and what
 * operations it can perform.
 * 
 * @constant {Object}
 * @property {string} id - Unique addon identifier
 * @property {string} version - Addon version (semver)
 * @property {string} name - Display name shown in Stremio
 * @property {string} description - Brief description of addon functionality
 * @property {Array<string>} types - Content types supported (e.g., "anime", "movie")
 * @property {Array<Object>} catalogs - Available catalogs
 * @property {Array<string>} resources - Supported resource types (catalog, meta, stream)
 * @property {string} contactEmail - Contact email for support
 */
const manifest = {
  ...ADDON_MANIFEST,
  catalogs: CATALOGS
};

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
async function getCatalog(type, id, extra) {
  try {
    console.log(`Catalog request - Type: ${type}, ID: ${id}, Extra: ${extra || 'none'}`);

    // Handle AniList currently watching catalog
    if (id === 'anilist.watching') {
      // Validate content type
      if (type !== 'anime') {
        console.warn(`Invalid type "${type}" for catalog "${id}". Expected "anime".`);
        return { metas: [] };
      }

      // Fetch currently watching anime from AniList
      const metas = await anilistService.getCurrentlyWatchingAnime();
      
      console.log(`Returning ${metas.length} items for catalog "${id}"`);
      return { metas };
    }

    // Unknown catalog ID
    console.warn(`Unknown catalog ID: ${id}`);
    return { metas: [] };

  } catch (error) {
    // Log error but don't crash - return empty catalog instead
    console.error(`Error in getCatalog (${type}/${id}):`, error.message);
    
    // Re-throw error to be handled by the HTTP layer
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
async function getMeta(type, id) {
  try {
    console.log(`Meta request - Type: ${type}, ID: ${id}`);

    // Validate content type
    if (type !== 'anime') {
      throw new Error(`Unsupported content type: ${type}`);
    }

    // Validate ID format
    if (!id.startsWith('anilist:')) {
      throw new Error(`Invalid ID format: ${id}. Expected format: "anilist:{number}"`);
    }

    // Fetch anime metadata from AniList
    const meta = await anilistService.getAnimeMeta(id);
    
    return { meta };

  } catch (error) {
    console.error(`Error in getMeta (${type}/${id}):`, error.message);
    
    // Re-throw error to be handled by the HTTP layer
    throw new Error(`Failed to fetch metadata: ${error.message}`);
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
  getCatalog,
  getMeta
};

// Made with Bob
