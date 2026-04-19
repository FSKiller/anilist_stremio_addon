/**
 * Persistent ID Mapping Store
 *
 * Saves cross-service ID mappings and season chain data to data/mappings.json
 * so they survive process restarts. API calls are skipped for any IDs already
 * present in the store.
 *
 * Sections:
 *   malToKitsu     — MAL ID (string) → Kitsu ID (string), kept indefinitely
 *   kitsuToAnilist — Kitsu ID (string) → AniList ID (string), kept indefinitely
 *   seasonChain    — AniList root ID → { chain, ts }, refreshed after 7 days
 *
 * Writes are debounced (5 s) so rapid sequential updates don't hammer disk I/O.
 *
 * @module config/mappings
 */

const fs = require('fs');
const path = require('path');

const MAPPINGS_FILE = path.join(__dirname, '..', 'data', 'mappings.json');
const SEASON_CHAIN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let _data = null;
let _saveTimer = null;

function _load() {
  if (_data) return _data;
  try {
    if (fs.existsSync(MAPPINGS_FILE)) {
      const raw = fs.readFileSync(MAPPINGS_FILE, 'utf8').trim();
      if (raw) _data = JSON.parse(raw);
    }
  } catch (e) {
    console.error('[mappings] Failed to load:', e.message);
  }
  if (!_data || typeof _data !== 'object') _data = {};
  if (!_data.malToKitsu) _data.malToKitsu = {};
  if (!_data.kitsuToAnilist) _data.kitsuToAnilist = {};
  if (!_data.kitsuToImdb) _data.kitsuToImdb = {};
  if (!_data.seasonChain) _data.seasonChain = {};
  console.log(
    `[mappings] Loaded — ` +
    `${Object.keys(_data.malToKitsu).length} MAL→Kitsu, ` +
    `${Object.keys(_data.kitsuToAnilist).length} Kitsu→AniList, ` +
    `${Object.keys(_data.kitsuToImdb).length} Kitsu→IMDB, ` +
    `${Object.keys(_data.seasonChain).length} season chain(s)`
  );
  return _data;
}

function _flush() {
  _saveTimer = null;
  if (!_data) return;
  try {
    const dir = path.dirname(MAPPINGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(MAPPINGS_FILE, JSON.stringify(_data));
  } catch (e) {
    console.error('[mappings] Failed to save:', e.message);
  }
}

function _scheduleSave() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(_flush, 5000);
}

// ─── MAL → Kitsu ────────────────────────────────────────────────────────────

/**
 * Returns the full persisted mal→kitsu map (object of malId → kitsuId).
 * @returns {Object}
 */
function getMalKitsuMap() {
  return _load().malToKitsu;
}

/**
 * Merges new malId→kitsuId entries into the persistent store.
 * Only writes if at least one entry is new or changed.
 * @param {Object} entries — { [malId: string]: kitsuId: string }
 */
function setMalKitsuEntries(entries) {
  const d = _load();
  let changed = false;
  for (const [k, v] of Object.entries(entries)) {
    if (d.malToKitsu[String(k)] !== v) {
      d.malToKitsu[String(k)] = v;
      changed = true;
    }
  }
  if (changed) _scheduleSave();
}

// ─── Kitsu → AniList ────────────────────────────────────────────────────────

/**
 * Returns the persisted AniList ID for a Kitsu ID, or null if not stored.
 * @param {string} kitsuId
 * @returns {string|null}
 */
function getKitsuAnilistId(kitsuId) {
  return _load().kitsuToAnilist[String(kitsuId)] || null;
}

/**
 * Persists a Kitsu→AniList mapping.
 * @param {string} kitsuId
 * @param {string} anilistId
 */
function setKitsuAnilistId(kitsuId, anilistId) {
  const d = _load();
  if (d.kitsuToAnilist[String(kitsuId)] !== String(anilistId)) {
    d.kitsuToAnilist[String(kitsuId)] = String(anilistId);
    _scheduleSave();
  }
}

// ─── Kitsu → IMDB ────────────────────────────────────────────────────────────

/**
 * Returns the persisted IMDB ID for a Kitsu ID, or null if not stored.
 * A stored empty string means "confirmed no mapping" (don't re-query).
 * @param {string} kitsuId
 * @returns {string|null|undefined} string = found, null = confirmed absent, undefined = unknown
 */
function getKitsuImdbId(kitsuId) {
  const val = _load().kitsuToImdb[String(kitsuId)];
  if (val === undefined) return undefined; // never looked up
  return val || null;                      // '' → null (confirmed absent)
}

/**
 * Persists a Kitsu→IMDB mapping.  Pass null/'' to record "no mapping found".
 * @param {string} kitsuId
 * @param {string|null} imdbId
 */
function setKitsuImdbId(kitsuId, imdbId) {
  const d = _load();
  const stored = String(imdbId || '');
  if (d.kitsuToImdb[String(kitsuId)] !== stored) {
    d.kitsuToImdb[String(kitsuId)] = stored;
    _scheduleSave();
  }
}

// ─── Season chain (AniList root ID → ordered season list) ───────────────────

/**
 * Returns the persisted season chain for an AniList root ID, or null if
 * not stored / older than 7 days.
 * @param {string|number} anilistId
 * @returns {Array|null}
 */
function getSeasonChain(anilistId) {
  const entry = _load().seasonChain[String(anilistId)];
  if (!entry) return null;
  if (Date.now() - entry.ts > SEASON_CHAIN_TTL_MS) return null; // stale
  return entry.chain;
}

/**
 * Persists the season chain for an AniList root ID (with current timestamp).
 * @param {string|number} anilistId
 * @param {Array} chain
 */
function setSeasonChain(anilistId, chain) {
  _load().seasonChain[String(anilistId)] = { chain, ts: Date.now() };
  _scheduleSave();
}

// Flush on process exit (handles graceful shutdowns)
process.on('exit', _flush);

module.exports = {
  getMalKitsuMap,
  setMalKitsuEntries,
  getKitsuAnilistId,
  setKitsuAnilistId,
  getKitsuImdbId,
  setKitsuImdbId,
  getSeasonChain,
  setSeasonChain
};
