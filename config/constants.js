/**
 * Application Constants and Configuration
 * 
 * This file centralizes all configuration values and constants used throughout
 * the application, making it easier to maintain and modify settings.
 */

/**
 * AniList GraphQL API endpoint
 * @constant {string}
 */
const ANILIST_API_URL = 'https://graphql.anilist.co';

/**
 * Default port for the Express server
 * @constant {number}
 */
const DEFAULT_PORT = 3000;

/**
 * Stremio addon manifest configuration
 * @constant {Object}
 */
const ADDON_MANIFEST = {
  id: 'community.anilist-stremio',
  version: '1.2.0',
  name: 'AniList Sync',
  description: 'Syncs your AniList Currently Watching anime to Stremio library',
  types: ['anime'],
  resources: ['catalog', 'meta'],
  contactEmail: 'contact@example.com'
};

/**
 * Catalog configuration for the addon
 * @constant {Array<Object>}
 */
const CATALOGS = [
  {
    type: 'anime',
    id: 'anilist.watching',
    name: 'AniList - Currently Watching'
  }
];

/**
 * AniList media status types
 * @constant {Object}
 */
const ANILIST_STATUS = {
  CURRENT: 'CURRENT',
  PLANNING: 'PLANNING',
  COMPLETED: 'COMPLETED',
  DROPPED: 'DROPPED',
  PAUSED: 'PAUSED',
  REPEATING: 'REPEATING'
};

/**
 * Stremio poster shape options
 * @constant {Object}
 */
const POSTER_SHAPES = {
  PORTRAIT: 'portrait',
  LANDSCAPE: 'landscape',
  SQUARE: 'square'
};

/**
 * HTTP status codes used in the application
 * @constant {Object}
 */
const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500
};

module.exports = {
  ANILIST_API_URL,
  DEFAULT_PORT,
  ADDON_MANIFEST,
  CATALOGS,
  ANILIST_STATUS,
  POSTER_SHAPES,
  HTTP_STATUS
};

// Made with Bob
