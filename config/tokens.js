/**
 * Token Storage and Management
 *
 * Handles secure storage and retrieval of OAuth tokens for AniList and MAL,
 * and lightweight in-memory watch-session tracking for progress dedup.
 *
 * @module config/tokens
 */

const fs = require('fs');
const path = require('path');

const TOKENS_FILE = path.join(__dirname, '..', 'data', 'tokens.json');

function ensureDataDir() {
  const dataDir = path.dirname(TOKENS_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function loadTokens() {
  try {
    ensureDataDir();
    if (fs.existsSync(TOKENS_FILE)) {
      const data = fs.readFileSync(TOKENS_FILE, 'utf8').trim();
      if (!data) return {};
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading tokens:', error.message);
    try { fs.writeFileSync(TOKENS_FILE, '{}'); } catch (_) {}
  }
  return {};
}

function saveTokens(tokens) {
  try {
    ensureDataDir();
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
  } catch (error) {
    console.error('Error saving tokens:', error.message);
  }
}

function getUserKey(service, username) {
  return `${service}:${username.toLowerCase()}`;
}

/**
 * Store OAuth tokens for a user (persisted to tokens.json)
 */
function storeTokens(service, username, tokenData) {
  const tokens = loadTokens();
  const userKey = getUserKey(service, username);
  tokens[userKey] = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: Date.now() + (tokenData.expires_in * 1000),
    updated_at: Date.now()
  };
  saveTokens(tokens);
  console.log(`Stored tokens for ${service} user: ${username}`);
}

/**
 * Store OAuth credentials (client_id + client_secret) for a user
 */
function storeCredentials(service, username, credentials) {
  const tokens = loadTokens();
  const userKey = getUserKey(service, username);
  if (!tokens[userKey]) tokens[userKey] = {};
  tokens[userKey].credentials = {
    client_id: credentials.client_id,
    client_secret: credentials.client_secret,
    updated_at: Date.now()
  };
  saveTokens(tokens);
  console.log(`Stored credentials for ${service} user: ${username}`);
}

/**
 * Retrieve stored OAuth credentials for a user
 */
function getCredentials(service, username) {
  const tokens = loadTokens();
  const userKey = getUserKey(service, username);
  return tokens[userKey]?.credentials || null;
}

/**
 * Retrieve OAuth tokens for a user — returns null if missing or expired
 */
function getTokens(service, username) {
  const tokens = loadTokens();
  const userKey = getUserKey(service, username);
  const userTokens = tokens[userKey];

  if (!userTokens || !userTokens.access_token || !userTokens.expires_at) {
    return null;
  }

  if (Date.now() >= userTokens.expires_at) {
    console.log(`Tokens expired for ${service} user: ${username}`);
    delete tokens[userKey].access_token;
    delete tokens[userKey].refresh_token;
    delete tokens[userKey].expires_at;
    saveTokens(tokens);
    return null;
  }

  return userTokens;
}

/**
 * Remove all tokens for a user
 */
function removeTokens(service, username) {
  const tokens = loadTokens();
  const userKey = getUserKey(service, username);
  if (tokens[userKey]) {
    delete tokens[userKey];
    saveTokens(tokens);
    console.log(`Removed tokens for ${service} user: ${username}`);
  }
}

/**
 * Returns true if the user has a valid (non-expired) access token
 */
function hasValidTokens(service, username) {
  return getTokens(service, username) !== null;
}

// ---------------------------------------------------------------------------
// Opaque MAL addon token store — maps a random 64-char hex token to a username
// Persisted to tokens.json so addon URLs survive server restarts.
// ---------------------------------------------------------------------------

function storeOpaqueToken(opaqueToken, username) {
  const tokens = loadTokens();
  tokens[`mal_link:${opaqueToken}`] = username.toLowerCase();
  saveTokens(tokens);
  console.log(`Stored opaque MAL token for user: ${username}`);
}

function resolveOpaqueToken(opaqueToken) {
  const tokens = loadTokens();
  return tokens[`mal_link:${opaqueToken}`] || null;
}

function hasValidTokensByOpaqueToken(opaqueToken) {
  const username = resolveOpaqueToken(opaqueToken);
  if (!username) return false;
  return hasValidTokens('mal', username);
}

// In-memory PKCE verifier store (ephemeral, keyed by random session ID)
const _pkceStore = {};

/**
 * Store a PKCE code_verifier for a MAL OAuth flow, keyed by session ID.
 */
function storePkceVerifier(sessionId, verifier) {
  _pkceStore[sessionId] = verifier;
  // Auto-expire after 10 minutes
  setTimeout(() => { delete _pkceStore[sessionId]; }, 10 * 60 * 1000);
}

/**
 * Retrieve and delete a stored PKCE code_verifier by session ID.
 */
function getPkceVerifier(sessionId) {
  const verifier = _pkceStore[sessionId] || null;
  delete _pkceStore[sessionId];
  return verifier;
}

// ---------------------------------------------------------------------------
// In-memory watch-session tracking (for progress dedup — not persisted)
// ---------------------------------------------------------------------------

const watchSessions = {};

function _sessionKey(service, token, animeId, episode) {
  const userTag = String(token).slice(0, 32);
  return `${service}:${userTag}:${animeId}:${episode}`;
}

function storeWatchSession(service, token, animeId, episode) {
  const key = _sessionKey(service, token, animeId, episode);
  const isNew = !watchSessions[key];
  watchSessions[key] = {
    startTime: watchSessions[key]?.startTime ?? Date.now(),
    lastAccess: Date.now(),
    lastUpdated: watchSessions[key]?.lastUpdated ?? 0
  };
  console.log(`Watch session stored: anime ${animeId} ep ${episode}`);
  return isNew;
}

function shouldUpdateProgress(service, token, animeId, episode) {
  const key = _sessionKey(service, token, animeId, episode);
  const session = watchSessions[key];
  if (!session) return false;
  // Must have been watching for at least 5 minutes
  const WATCH_THRESHOLD_MS = 5 * 60 * 1000;
  if (Date.now() - session.startTime < WATCH_THRESHOLD_MS) return false;
  // Don't re-update within 60 seconds of the last update
  if (session.lastUpdated > 0 && (Date.now() - session.lastUpdated) < 60 * 1000) return false;
  return true;
}

function markProgressUpdated(service, token, animeId, episode) {
  const key = _sessionKey(service, token, animeId, episode);
  if (watchSessions[key]) watchSessions[key].lastUpdated = Date.now();
}

function updateWatchSessionAccess(service, token, animeId, episode) {
  const key = _sessionKey(service, token, animeId, episode);
  if (watchSessions[key]) watchSessions[key].lastAccess = Date.now();
}

function cleanupOldSessions(service, token) {
  const userTag = String(token).slice(0, 32);
  const prefix = `${service}:${userTag}:`;
  const oneDay = 24 * 60 * 60 * 1000;
  const now = Date.now();
  let cleaned = 0;
  for (const key of Object.keys(watchSessions)) {
    if (key.startsWith(prefix) && now - watchSessions[key].lastAccess > oneDay) {
      delete watchSessions[key];
      cleaned++;
    }
  }
  if (cleaned) console.log(`Cleaned ${cleaned} old watch session(s)`);
}

module.exports = {
  storeTokens,
  getTokens,
  removeTokens,
  hasValidTokens,
  getUserKey,
  storeCredentials,
  getCredentials,
  storePkceVerifier,
  getPkceVerifier,
  storeWatchSession,
  shouldUpdateProgress,
  markProgressUpdated,
  updateWatchSessionAccess,
  cleanupOldSessions,
  storeOpaqueToken,
  resolveOpaqueToken,
  hasValidTokensByOpaqueToken
};
