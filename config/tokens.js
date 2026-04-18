/**
 * Watch Session Tracking
 *
 * In-memory store for watch sessions only.
 * The server is otherwise stateless — AniList tokens live only in the browser
 * and are passed in the manifest URL path (implicit OAuth flow).
 *
 * @module config/tokens
 */

// Flat map: sessionKey -> { startTime, lastAccess }
const watchSessions = {};

function _sessionKey(service, token, animeId, episode) {
  // Use first 32 chars of token as user identifier (unique enough, avoids huge keys)
  const userTag = String(token).slice(0, 32);
  return `${service}:${userTag}:${animeId}:${episode}`;
}

function storeWatchSession(service, token, animeId, episode) {
  const key = _sessionKey(service, token, animeId, episode);
  watchSessions[key] = {
    startTime: watchSessions[key]?.startTime ?? Date.now(),
    lastAccess: Date.now()
  };
  console.log(`Watch session stored: anime ${animeId} ep ${episode}`);
}

function shouldUpdateProgress(service, token, animeId, episode) {
  const key = _sessionKey(service, token, animeId, episode);
  const session = watchSessions[key];
  if (!session) return false;
  const elapsed = Date.now() - session.startTime;
  const fiveMinutes = 5 * 60 * 1000;
  console.log(`Watch session ${animeId} ep ${episode}: ${Math.round(elapsed / 1000)}s elapsed (need ${Math.round(fiveMinutes / 1000)}s)`);
  return elapsed >= fiveMinutes;
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
  storeWatchSession,
  shouldUpdateProgress,
  updateWatchSessionAccess,
  cleanupOldSessions
};
