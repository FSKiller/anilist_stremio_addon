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
const imdbService = require('./services/imdb');
const letterboxdService = require('./services/letterboxd');
const tokenManager = require('./config/tokens');
const { ADDON_MANIFEST, MAL_MANIFEST, IMDB_MANIFEST, LETTERBOXD_MANIFEST, ANILIST_CATALOGS, MAL_CATALOGS, IMDB_CATALOGS, LETTERBOXD_CATALOGS, COMBINED_ANIME_CATALOGS, COMBINED_MOVIE_CATALOGS } = require('./config/constants');

// Catalog result cache — keyed by a string of the request params.
// TTL: 5 minutes. Prevents hammering APIs on every Stremio scroll event.
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const catalogCache = new Map();

function getCatalogCacheKey(...args) {
  return args.map(a => (a && typeof a === 'object' ? JSON.stringify(a) : String(a ?? ''))).join('|');
}

function getCachedCatalog(key) {
  const entry = catalogCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CATALOG_CACHE_TTL_MS) {
    catalogCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCachedCatalog(key, value) {
  catalogCache.set(key, { value, ts: Date.now() });
}

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

const LETTERBOXD_STATUS_MAP = {
  'Watchlist': 'Watchlist',
  'Watched': 'Watched'
};

/**
 * Returns the Stremio manifest for a given service.
 *
 * @param {string} service - 'anilist', 'mal', or 'imdb'
 * @returns {Object} Stremio manifest object
 */
function getManifest(service) {
  if (service === 'mal') {
    return { ...MAL_MANIFEST, catalogs: MAL_CATALOGS };
  }
  if (service === 'imdb') {
    return { ...IMDB_MANIFEST, catalogs: IMDB_CATALOGS };
  }
  if (service === 'letterboxd') {
    return { ...LETTERBOXD_MANIFEST, catalogs: LETTERBOXD_CATALOGS };
  }
  return { ...ADDON_MANIFEST, catalogs: ANILIST_CATALOGS };
}

/**
 * Returns a combined Stremio manifest merging catalogs from multiple services
 * into ONE anime catalog entry and ONE movie catalog entry.
 *
 * @param {Object} serviceConfig - Map of service names to their tokens/usernames
 * @returns {Object} Combined Stremio manifest object
 */
function getCombinedManifest(serviceConfig) {
  const services = Object.keys(serviceConfig);
  const catalogs = [];
  const types = new Set();
  const idPrefixes = new Set();
  const resources = new Set(['catalog']);

  const hasAnimeService = services.some(s => s === 'anilist' || s === 'mal');
  const hasMovieService = services.some(s => s === 'letterboxd');
  const hasImdb = services.includes('imdb');

  if (hasAnimeService || hasImdb) {
    types.add('anime');
    types.add('series');
    catalogs.push(...COMBINED_ANIME_CATALOGS);
    if (hasAnimeService) {
      resources.add('meta');
      resources.add('stream');
    }
  }

  if (hasMovieService || hasImdb) {
    types.add('movie');
    catalogs.push(...COMBINED_MOVIE_CATALOGS);
  }

  if (services.includes('anilist')) { idPrefixes.add('anilist:'); idPrefixes.add('kitsu:'); }
  if (services.includes('mal')) { idPrefixes.add('kitsu:'); idPrefixes.add('mal:'); }
  if (hasImdb || hasMovieService) { idPrefixes.add('tt'); }
  if (services.includes('letterboxd')) { idPrefixes.add('letterboxd:'); }

  return {
    id: 'community.combined-stremio',
    version: '1.0.0',
    name: 'Combined Anime & Watchlist',
    description: 'AniList, MAL, IMDB, and Letterboxd in one addon',
    types: [...types],
    resources: [...resources],
    idPrefixes: [...idPrefixes],
    catalogs
  };
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
async function getCatalog(type, id, extra, username, service, malClientId, letterboxdClientId, letterboxdClientSecret) {
  try {
    console.log(`Catalog request - Service: ${service}, Type: ${type}, ID: ${id}, Extra: ${extra || 'none'}, User: ${username}`);

    if (type !== 'anime' && type !== 'series' && type !== 'movie') {
      console.warn(`Invalid type "${type}" for catalog "${id}". Expected "anime", "series" or "movie".`);
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

    const cacheKey = getCatalogCacheKey(service, id, type, genreFilter, username);
    const cached = getCachedCatalog(cacheKey);
    if (cached) {
      console.log(`[cache hit] ${service} catalog [${genreFilter}]: ${cached.metas.length} items`);
      return cached;
    }

    let result;

    if (service === 'mal' && id === 'mal.list') {
      const malStatus = MAL_STATUS_MAP[genreFilter] || 'watching';
      const metas = await malService.getAnimeList(username, malClientId, malStatus);
      console.log(`Returning ${metas.length} items for MAL catalog [${genreFilter}]`);
      result = { metas };
    } else if (service === 'anilist' && id === 'anilist.list') {
      const anilistStatus = ANILIST_STATUS_MAP[genreFilter] || 'CURRENT';
      const metas = await anilistService.getAnimeList(username, anilistStatus);
      console.log(`Returning ${metas.length} items for AniList catalog [${genreFilter}]`);
      result = { metas };
    } else if (service === 'imdb' && id === 'imdb.watchlist') {
      const allMetas = await imdbService.getWatchlist(username);
      const metas = allMetas.filter(m => m.type === type);
      console.log(`Returning ${metas.length} ${type} items for IMDB watchlist (${allMetas.length} total)`);
      result = { metas };
    } else if (service === 'letterboxd' && id === 'letterboxd.list') {
      const letterboxdStatus = LETTERBOXD_STATUS_MAP[genreFilter] || 'Watchlist';
      const metas = await letterboxdService.getCatalog(username, letterboxdStatus, letterboxdClientId, letterboxdClientSecret);
      console.log(`Returning ${metas.length} items for Letterboxd catalog [${letterboxdStatus}]`);
      result = { metas };
    } else {
      console.warn(`Unknown catalog ID: ${id}`);
      return { metas: [] };
    }

    setCachedCatalog(cacheKey, result);
    return result;

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
async function getMeta(type, id, username, service, malClientId) {
  try {
    console.log(`Meta request - Service: ${service}, Type: ${type}, ID: ${id}`);

    if (type !== 'anime' && type !== 'series' && type !== 'movie') {
      throw new Error(`Unsupported content type: ${type}`);
    }

    if (service === 'mal') {
      if (!id.startsWith('mal:') && !id.startsWith('kitsu:')) {
        return { meta: null };
      }
      const meta = await malService.getAnimeMeta(id, malClientId);
      return { meta };
    }

    if (service === 'imdb') {
      // Stremio natively handles tt* ID metadata
      const meta = await imdbService.getTitleMeta(id);
      return { meta };
    }

    if (service === 'letterboxd') {
      // Stremio can resolve tt* metadata natively for movie IDs.
      return { meta: null };
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
async function getStream(type, id, videoInfo, username, service, malClientId) {
  try {
    console.log(`Stream request - Service: ${service}, Type: ${type}, ID: ${id}, Video: ${JSON.stringify(videoInfo)}`);

    if (type !== 'anime' && type !== 'series' && type !== 'movie') {
      return { streams: [] };
    }

    // Extract anime ID from the content ID
    let animeId;
    let actualService = service;

    if (service === 'mal') {
      if (id.startsWith('mal:')) {
        animeId = id.split(':')[1];
        // Traverse sequel chain if watching a later season
        if (videoInfo.season > 1) {
          animeId = await malService.getSeasonMalId(animeId, videoInfo.season, malClientId).catch(() => animeId);
          console.log(`Season ${videoInfo.season} resolved to MAL ID ${animeId}`);
        }
      } else if (id.startsWith('kitsu:')) {
        // MAL catalog serves items with kitsu: IDs — map back to MAL ID for progress updates
        const kitsuId = id.split(':')[1];
        try {
          let malId = await malService.mapKitsuToMal(kitsuId);
          if (!malId) {
            console.log(`Could not map Kitsu ID ${kitsuId} to MAL ID`);
            return { streams: [] };
          }
          // Traverse sequel chain if watching a later season
          if (videoInfo.season > 1) {
            malId = await malService.getSeasonMalId(malId, videoInfo.season, malClientId).catch(() => malId);
            console.log(`Season ${videoInfo.season} resolved to MAL ID ${malId}`);
          }
          animeId = malId;
          console.log(`Mapped Kitsu ID ${kitsuId} to MAL ID ${animeId}`);
        } catch (mappingError) {
          console.error(`Failed to map Kitsu ID ${kitsuId} to MAL ID:`, mappingError.message);
          return { streams: [] };
        }
      } else {
        return { streams: [] };
      }
    } else {
      // Default: AniList - handle both anilist: and kitsu: IDs
      if (id.startsWith('anilist:')) {
        animeId = id.split(':')[1]; // just the numeric ID
        // Traverse sequel chain if watching a later season
        if (videoInfo.season > 1) {
          animeId = await anilistService.getSeasonAniListId(animeId, videoInfo.season).catch(() => animeId);
          console.log(`Season ${videoInfo.season} resolved to AniList ID ${animeId}`);
        }
      } else if (id.startsWith('kitsu:')) {
        // Extract Kitsu ID (may include season info like kitsu:46729:3)
        const kitsuId = id.split(':')[1];
        try {
          // Map Kitsu ID to AniList ID
          let anilistId = await anilistService.mapKitsuToAniList(kitsuId);
          if (!anilistId) {
            console.log(`Could not map Kitsu ID ${kitsuId} to AniList ID`);
            return { streams: [] };
          }
          // If watching a season beyond the first, traverse AniList's sequel chain
          if (videoInfo.season > 1) {
            anilistId = await anilistService.getSeasonAniListId(anilistId, videoInfo.season);
            console.log(`Season ${videoInfo.season} resolved to AniList ID ${anilistId}`);
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
          let anilistId = await anilistService.mapImdbToAniList(imdbId);
          if (!anilistId) {
            console.log(`Could not map IMDB ID ${id} to AniList ID`);
            return { streams: [] };
          }
          if (videoInfo.season > 1) {
            anilistId = await anilistService.getSeasonAniListId(anilistId, videoInfo.season).catch(() => anilistId);
            console.log(`Season ${videoInfo.season} resolved to AniList ID ${anilistId}`);
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
        tokenManager.cleanupOldSessions(actualService, username);
        const isNewSession = tokenManager.storeWatchSession(actualService, username, animeId, videoInfo.episode);

        // Only update after watching the same episode for 5+ minutes
        if (tokenManager.shouldUpdateProgress(actualService, username, animeId, videoInfo.episode)) {
          tokenManager.markProgressUpdated(actualService, username, animeId, videoInfo.episode);
          if (actualService === 'mal') {
            await malService.updateProgress(animeId, videoInfo.episode, username, malClientId);
          } else {
            await anilistService.updateProgress(animeId, videoInfo.episode, username);
          }
          console.log(`✅ Updated progress for ${actualService} anime ${animeId}: episode ${videoInfo.episode} (5min threshold met)`);
        } else {
          console.log(`⏳ Watch session for ${actualService} anime ${animeId} ep ${videoInfo.episode} - waiting for 5min threshold`);
          // Stremio only calls the stream endpoint once, so schedule a deferred update
          if (isNewSession) {
            const _svc = actualService;
            const _animeId = animeId;
            const _ep = videoInfo.episode;
            const _user = username;
            const _clientId = malClientId;
            setTimeout(async () => {
              if (tokenManager.shouldUpdateProgress(_svc, _user, _animeId, _ep)) {
                try {
                  tokenManager.markProgressUpdated(_svc, _user, _animeId, _ep);
                  if (_svc === 'mal') {
                    await malService.updateProgress(_animeId, _ep, _user, _clientId);
                  } else {
                    await anilistService.updateProgress(_animeId, _ep, _user);
                  }
                  console.log(`✅ Updated progress for ${_svc} anime ${_animeId}: episode ${_ep} (deferred 5min)`);
                } catch (e) {
                  console.error(`Deferred progress update failed for ${_svc} anime ${_animeId}:`, e.message);
                }
              }
            }, 5 * 60 * 1000 + 2000);
          }
        }
      } catch (progressError) {
        console.error(`Failed to update progress for ${actualService} anime ${animeId}:`, progressError.message);
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
 * Handles catalog requests for the combined merged addon.
 * Fetches from multiple services in parallel and deduplicates results.
 * - combined.anime.list: AniList + MAL + IMDB (IMDB only under "Currently Watching")
 * - combined.movie.list: Letterboxd + IMDB (IMDB only under "Watchlist")
 */
async function getCombinedCatalog(type, id, extra, serviceConfig, malClientId, letterboxdClientId, letterboxdClientSecret) {
  // User navigated back to catalog — cancel any pending progress timers
  cancelPendingTimers(_userKey(serviceConfig));

  let genreFilter = 'Currently Watching';
  if (extra) {
    const match = extra.match(/genre=([^&]+)/);
    if (match) genreFilter = decodeURIComponent(match[1]);
  }
  console.log(`Combined catalog request - ID: ${id}, Genre: ${genreFilter}`);

  const cacheKey = getCatalogCacheKey('combined', id, type, genreFilter, _userKey(serviceConfig));
  const cached = getCachedCatalog(cacheKey);
  if (cached) {
    console.log(`[cache hit] combined catalog [${genreFilter}]: ${cached.metas.length} items`);
    return cached;
  }

  let result;

  if (id === 'combined.anime.list') {
    const promises = [];

    if (serviceConfig.anilist) {
      const anilistStatus = ANILIST_STATUS_MAP[genreFilter] || 'CURRENT';
      promises.push(
        anilistService.getAnimeList(serviceConfig.anilist, anilistStatus)
          .catch(err => { console.error('AniList fetch error:', err.message); return []; })
      );
    }

    if (serviceConfig.mal) {
      const malStatus = MAL_STATUS_MAP[genreFilter] || 'watching';
      // serviceConfig.mal may be an opaque hex token — resolve to real username
      const malUsername = tokenManager.resolveOpaqueToken(serviceConfig.mal) || serviceConfig.mal;
      promises.push(
        malService.getAnimeList(malUsername, malClientId, malStatus)
          .catch(err => { console.error('MAL fetch error:', err.message); return []; })
      );
    }

    // IMDB has no status concept — only include under "Currently Watching"
    if (serviceConfig.imdb && genreFilter === 'Currently Watching') {
      promises.push(
        imdbService.getWatchlist(serviceConfig.imdb)
          .then(all => all.filter(m => m.type === 'anime'))
          .catch(err => { console.error('IMDB fetch error:', err.message); return []; })
      );
    }

    const results = await Promise.all(promises);
    const seenIds = new Set();
    const seenImdb = new Set();
    const seenNames = new Set();
    const metas = results.flat().filter(m => {
      if (seenIds.has(m.id)) return false;
      // Cross-service IMDB dedup: if a kitsu: entry maps to an IMDB ID that's
      // already been seen (e.g. from AniList resolving to tt…), skip it.
      if (/^tt\d+/.test(m.id)) {
        if (seenImdb.has(m.id)) return false;
        seenImdb.add(m.id);
      } else if (m.id.startsWith('kitsu:')) {
        const kitsuId = m.id.replace('kitsu:', '');
        const imdbId = anilistService.getImdbForKitsuId(kitsuId);
        if (imdbId && seenImdb.has(imdbId)) return false;
        if (imdbId) seenImdb.add(imdbId);
      }
      // Deduplicate across services by normalised name so e.g. an AniList
      // IMDB entry and a MAL Kitsu entry for the same franchise merge.
      const normName = m.name?.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normName && seenNames.has(normName)) return false;
      seenIds.add(m.id);
      if (normName) seenNames.add(normName);
      return true;
    });
    console.log(`Combined anime catalog [${genreFilter}]: ${metas.length} items`);
    result = { metas };
  } else if (id === 'combined.movie.list') {
    const promises = [];

    if (serviceConfig.letterboxd) {
      const letterboxdStatus = LETTERBOXD_STATUS_MAP[genreFilter] || 'Watchlist';
      promises.push(
        letterboxdService.getCatalog(serviceConfig.letterboxd, letterboxdStatus, letterboxdClientId, letterboxdClientSecret)
          .catch(err => { console.error('Letterboxd fetch error:', err.message); return []; })
      );
    }

    // IMDB has no status concept — only include under "Watchlist"
    if (serviceConfig.imdb && genreFilter === 'Watchlist') {
      promises.push(
        imdbService.getWatchlist(serviceConfig.imdb)
          .then(all => all.filter(m => m.type === 'movie'))
          .catch(err => { console.error('IMDB fetch error:', err.message); return []; })
      );
    }

    const results = await Promise.all(promises);
    const seen = new Set();
    const metas = results.flat().filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
    console.log(`Combined movie catalog [${genreFilter}]: ${metas.length} items`);
    result = { metas };
  } else {
    return { metas: [] };
  }

  setCachedCatalog(cacheKey, result);
  return result;
}

// Pending deferred progress-update timers, keyed by user identifier.
// When the user navigates away (new stream request), all pending timers for
// that user are cancelled so we don't update the episode they left.
const pendingTimers = new Map();

function _userKey(svcConfig) {
  const tag = svcConfig.anilist || svcConfig.mal || svcConfig.imdb || 'unknown';
  return String(tag).slice(0, 32);
}

function cancelPendingTimers(userKey) {
  const timers = pendingTimers.get(userKey);
  if (timers && timers.size > 0) {
    for (const t of timers) clearTimeout(t);
    console.log(`⏹ Cancelled ${timers.size} pending progress update(s) for user ${userKey.slice(0, 8)}...`);
    pendingTimers.set(userKey, new Set());
  }
}

/**
 * Handles stream requests for the combined addon.
 * Updates progress on ALL configured anime services (AniList + MAL) in parallel.
 */
async function getCombinedStream(type, id, videoInfo, svcConfig, malClientId) {
  try {
    console.log(`Combined stream request - Type: ${type}, ID: ${id}, Video: ${JSON.stringify(videoInfo)}`);

    if (type !== 'anime' && type !== 'series' && type !== 'movie') {
      return { streams: [] };
    }

    if (!videoInfo || !videoInfo.episode) {
      return { streams: [] };
    }

    const episode = videoInfo.episode;
    const userKey = _userKey(svcConfig);

    // Cancel any pending deferred updates — the user navigated to a new title
    cancelPendingTimers(userKey);
    if (!pendingTimers.has(userKey)) pendingTimers.set(userKey, new Set());

    // Resolve the content ID to per-service IDs in parallel
    let anilistId = null;
    let malId = null;

    if (id.startsWith('anilist:')) {
      anilistId = id.split(':')[1];
      if (svcConfig.mal) {
        malId = await anilistService.mapAniListToMal(anilistId).catch(() => null);
        if (malId) console.log(`Mapped AniList ID ${anilistId} to MAL ID ${malId}`);
      }
    } else if (id.startsWith('kitsu:')) {
      const kitsuId = id.split(':')[1];
      const [aId, mId] = await Promise.all([
        svcConfig.anilist ? anilistService.mapKitsuToAniList(kitsuId).catch(() => null) : Promise.resolve(null),
        svcConfig.mal    ? malService.mapKitsuToMal(kitsuId).catch(() => null)          : Promise.resolve(null)
      ]);
      anilistId = aId;
      malId = mId;
      if (anilistId) console.log(`Mapped Kitsu ID ${kitsuId} to AniList ID ${anilistId}`);
      if (malId)     console.log(`Mapped Kitsu ID ${kitsuId} to MAL ID ${malId}`);
    } else if (id.startsWith('mal:')) {
      malId = id.split(':')[1];
    } else if (/^tt\d+/.test(id)) {
      const imdbId = id.split(':')[0];
      if (svcConfig.anilist) {
        anilistId = await anilistService.mapImdbToAniList(imdbId).catch(() => null);
        if (anilistId) console.log(`Mapped IMDB ID ${imdbId} to AniList ID ${anilistId}`);
        // Also derive MAL ID from the resolved AniList ID
        if (anilistId && svcConfig.mal && !malId) {
          malId = await anilistService.mapAniListToMal(anilistId).catch(() => null);
          if (malId) console.log(`Derived MAL ID ${malId} from AniList ID ${anilistId}`);
        }
      }
    } else {
      return { streams: [] };
    }

    // If watching a season beyond S1, traverse sequel chains to get the correct entry
    const season = videoInfo.season || 1;
    if (season > 1) {
      if (anilistId) {
        anilistId = await anilistService.getSeasonAniListId(anilistId, season).catch(() => anilistId);
        console.log(`Season ${season} AniList ID resolved to ${anilistId}`);
      }
      if (malId) {
        malId = await malService.getSeasonMalId(malId, season, malClientId).catch(() => malId);
        console.log(`Season ${season} MAL ID resolved to ${malId}`);
      }
    }

    const updateNow = [];

    // Helper: schedule immediate + deferred update for a service
    function scheduleUpdate(svc, animeIdForSvc, token) {
      tokenManager.cleanupOldSessions(svc, token);
      const isNew = tokenManager.storeWatchSession(svc, token, animeIdForSvc, episode);
      if (tokenManager.shouldUpdateProgress(svc, token, animeIdForSvc, episode)) {
        tokenManager.markProgressUpdated(svc, token, animeIdForSvc, episode);
        const p = svc === 'mal'
          ? malService.updateProgress(animeIdForSvc, episode, token, malClientId)
          : anilistService.updateProgress(animeIdForSvc, episode, token);
        updateNow.push(
          p.then(() => console.log(`✅ Updated ${svc} anime ${animeIdForSvc}: episode ${episode}`))
           .catch(e => console.error(`${svc} progress update failed:`, e.message))
        );
      } else {
        const _svc = svc, _id = animeIdForSvc, _token = token;
        const timerId = setTimeout(async () => {
          pendingTimers.get(userKey)?.delete(timerId);
          if (tokenManager.shouldUpdateProgress(_svc, _token, _id, episode)) {
            tokenManager.markProgressUpdated(_svc, _token, _id, episode);
            try {
              if (_svc === 'mal') {
                await malService.updateProgress(_id, episode, _token, malClientId);
              } else {
                await anilistService.updateProgress(_id, episode, _token);
              }
              console.log(`✅ Updated ${_svc} anime ${_id}: episode ${episode} (deferred 5min)`);
            } catch (e) {
              console.error(`Deferred ${_svc} progress update failed:`, e.message);
            }
          }
        }, 5 * 60 * 1000 + 2000);
        pendingTimers.get(userKey).add(timerId);
      }
    }

    if (anilistId && svcConfig.anilist) {
      scheduleUpdate('anilist', anilistId, svcConfig.anilist);
    }

    if (malId && svcConfig.mal) {
      const malUsername = tokenManager.resolveOpaqueToken(svcConfig.mal) || svcConfig.mal;
      scheduleUpdate('mal', malId, malUsername);
    }

    await Promise.all(updateNow);
    return { streams: [] };

  } catch (error) {
    console.error(`Error in getCombinedStream (${type}/${id}):`, error.message);
    return { streams: [] };
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
  getCombinedManifest,
  getCombinedCatalog,
  getCombinedStream,
  getCatalog,
  getMeta,
  getStream
};

// Made with Bob
