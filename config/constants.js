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
 * MyAnimeList REST API v2 base URL
 * @constant {string}
 */
const MAL_API_URL = 'https://api.myanimelist.net/v2';

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
  version: '1.3.0',
  name: 'AniList Sync',
  description: 'Syncs your AniList Currently Watching anime to Stremio library',
  types: ['anime'],
  resources: ['catalog', 'meta'],
  contactEmail: 'contact@example.com'
};

/**
 * Stremio addon manifest for MyAnimeList
 * @constant {Object}
 */
const MAL_MANIFEST = {
  id: 'community.mal-stremio',
  version: '1.3.0',
  name: 'MyAnimeList Sync',
  description: 'Syncs your MyAnimeList Currently Watching anime to Stremio library',
  types: ['anime'],
  resources: ['catalog', 'meta'],
  contactEmail: 'contact@example.com'
};

/**
 * Catalog configuration for the AniList addon
 * @constant {Array<Object>}
 */
// Status options for each service's top filter button
const ANILIST_STATUS_OPTIONS = [
  'Currently Watching',
  'On Hold',
  'Plan to Watch',
  'Dropped',
  'Completed',
  'Rewatching'
];

const MAL_STATUS_OPTIONS = [
  'Currently Watching',
  'On Hold',
  'Plan to Watch',
  'Dropped',
  'Completed'
];

const ANILIST_CATALOGS = [
  {
    type: 'anime',
    id: 'anilist.list',
    name: 'AniList',
    extra: [
      { name: 'genre', options: ANILIST_STATUS_OPTIONS, isRequired: true }
    ]
  }
];

const MAL_CATALOGS = [
  {
    type: 'anime',
    id: 'mal.list',
    name: 'MyAnimeList',
    extra: [
      { name: 'genre', options: MAL_STATUS_OPTIONS, isRequired: true }
    ]
  }
];

// Keep CATALOGS as alias for AniList catalogs (backwards compat)
const CATALOGS = ANILIST_CATALOGS;

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
  MAL_API_URL,
  DEFAULT_PORT,
  ADDON_MANIFEST,
  MAL_MANIFEST,
  CATALOGS,
  ANILIST_CATALOGS,
  MAL_CATALOGS,
  ANILIST_STATUS,
  POSTER_SHAPES,
  HTTP_STATUS
};

// Made with Bob
