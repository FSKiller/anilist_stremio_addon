# Architecture Documentation

This document provides a comprehensive overview of the Anime Stremio Addon architecture, design decisions, and implementation details.

## 📐 System Architecture

### High-Level Overview

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Stremio   │ ◄─────► │  Express Server  │ ◄─────► │  AniList        │
│   Client    │  HTTP   │   (index.js)     │  HTTPS  │  GraphQL API    │
└─────────────┘         └──────────────────┘         ├─────────────────┤
                                │                     │  MAL REST API   │
                                │                     ├─────────────────┤
                                │                     │  Kitsu API      │
                        ┌───────▼────────┐            │  (ID mapping)   │
                        │  Addon Logic   │            └─────────────────┘
                        │  (addon.js)    │
                        └───────┬────────┘
                                │
               ┌────────────────┼────────────────┐
               ▼                ▼                ▼
        ┌────────────┐  ┌────────────┐  ┌────────────┐
        │ anilist.js │  │   mal.js   │  │  imdb.js   │
        └────────────┘  └────────────┘  └────────────┘
```

### Component Breakdown

#### 1. Express Server (`index.js`)
- **Purpose**: HTTP server that handles Stremio protocol requests
- **Responsibilities**:
  - Route handling for manifest, catalog, and meta endpoints
  - CORS configuration for cross-origin requests
  - Error handling and logging
  - Request validation
- **Key Features**:
  - Graceful shutdown handling
  - Development mode logging
  - Comprehensive error responses

#### 2. Addon Interface (`addon.js`)
- **Purpose**: Stremio addon protocol implementation
- **Responsibilities**:
  - Manifest definition
  - Catalog request handling
  - Meta request handling
  - Data transformation between AniList and Stremio formats
- **Key Features**:
  - Type validation
  - Error propagation
  - Modular handler functions

#### 3. Service Layer (`services/`)
- **`anilist.js`**: AniList GraphQL API — catalog, metadata, Kitsu→AniList ID mapping, progress updates via OAuth Bearer token
- **`mal.js`**: MAL REST API v2 — catalog, metadata, Kitsu→MAL ID mapping, progress updates via OAuth Bearer token, `GET /users/@me` for username discovery
- **`imdb.js`**: IMDB watchlist integration

#### 4. Configuration (`config/`)
- **Purpose**: Centralized configuration management
- **Components**:
  - `constants.js`: Application constants, manifests, catalog definitions
  - `env.js`: Environment variable loading and validation
  - `tokens.js`: OAuth token persistence (`data/tokens.json`) and in-memory watch-session tracking
- **Key Features**:
  - Startup validation
  - Clear error messages
  - PKCE verifier storage in-memory (keyed by random session ID, auto-expires)

## 🔄 Data Flow

### OAuth Login Flow (MAL example)

```
1. User clicks "Connect to MyAnimeList" on configure page
2. Browser → GET /auth/mal/connect
3. Server generates PKCE verifier + random sessionId, stores in memory
4. Server → 302 redirect to MAL OAuth (state=sessionId)
5. MAL → 302 redirect to /auth/mal/callback?code=...&state=sessionId
6. Server retrieves PKCE verifier by sessionId
7. Server exchanges code for access token with MAL token endpoint
8. Server calls MAL GET /users/@me to discover username
9. Server stores tokens under key "mal:{username}" in data/tokens.json
10. Server → 302 redirect to /configure#mal_username={username}
11. Browser reads hash, shows addon URL and "✅ Authenticated" status
```

### Catalog Request Flow

```
1. Stremio → GET /mal/{username}/catalog/series/mal.watching.json
2. index.js → Validates service + username params
3. index.js → Calls addon.getCatalog(type, id, extra, username, 'mal', malClientId)
4. addon.js → Maps catalog ID to MAL status string
5. addon.js → Calls malService.getAnimeList(username, clientId, status)
6. mal.js → GET /users/{username}/animelist from MAL API
7. mal.js → Batch-fetches Kitsu ID mappings for all MAL IDs
8. mal.js → Transforms entries to Stremio meta format (id: "kitsu:{id}")
9. addon.js → Returns { metas: [...] }
10. index.js → Returns JSON response to Stremio
```

### Episode Progress Update Flow

```
1. Stremio → GET /mal/{username}/stream/series/kitsu:46043:5.json
2. addon.js → Maps Kitsu ID to MAL ID via Kitsu API
3. addon.js → tokenManager.storeWatchSession('mal', username, malId, 5)
   - If new session: schedules setTimeout for 5min + 2s
4. After 5 minutes: setTimeout fires
5. tokenManager.shouldUpdateProgress() → true
6. malService.updateProgress(malId, 5, username) → PATCH /anime/{id}/my_list_status
7. MAL updates user's episode count
```

### Meta Request Flow

```
1. Stremio → GET /anilist/{token}/meta/anime/anilist:12345.json
2. index.js → Validates service + token params
3. index.js → Calls addon.getMeta(type, id, token, 'anilist')
4. addon.js → Validates type and ID format
5. addon.js → Calls anilistService.getAnimeMeta(id)
6. anilist.js → Fetches anime details (currently placeholder)
7. anilist.js → Returns meta object
8. addon.js → Wraps in { meta: {...} }
9. index.js → Returns JSON response to Stremio
```

## 🗂️ Data Models

### Stremio Meta Object

```javascript
{
  id: "anilist:12345",           // Unique identifier
  type: "anime",                  // Content type
  name: "Attack on Titan",        // Display name
  poster: "https://...",          // Poster image URL
  posterShape: "portrait",        // Poster aspect ratio
  background: "https://...",      // Background image URL
  description: "...",             // Synopsis (HTML stripped)
  genres: ["Action", "Drama"],    // Genre tags
  imdbRating: "8.5",             // Rating (0-10 scale)
  releaseInfo: "2013",           // Release year string
  year: 2013,                    // Release year number
  watched: false,                // Watch status
  meta: {                        // Additional metadata
    episodes: 25,
    status: "FINISHED",
    progress: 0
  }
}
```

### AniList API Response

```javascript
{
  MediaListCollection: {
    lists: [{
      entries: [{
        id: 123,
        media: {
          id: 12345,
          title: {
            english: "Attack on Titan",
            romaji: "Shingeki no Kyojin"
          },
          description: "<p>HTML description</p>",
          coverImage: {
            large: "https://...",
            medium: "https://..."
          },
          bannerImage: "https://...",
          genres: ["Action", "Drama"],
          averageScore: 85,
          status: "FINISHED",
          episodes: 25,
          seasonYear: 2013,
          season: "SPRING"
        },
        status: "CURRENT",
        progress: 5
      }]
    }]
  }
}
```

## 🔐 Security Considerations

### Environment Variables
- Sensitive data stored in `.env` file
- `.env` excluded from version control
- Validation on startup prevents runtime errors

### API Security
- No authentication tokens exposed
- Public AniList API used (no private data)
- Rate limiting handled by AniList API

### Error Handling
- Sensitive information not exposed in error messages
- Generic errors returned to clients
- Detailed errors logged server-side only

## 🚀 Performance Considerations

### Current Implementation
- **No caching**: Fresh data on every request
- **Synchronous processing**: One request at a time
- **Direct API calls**: No request batching

### Potential Optimizations

#### 1. Response Caching
```javascript
// Cache catalog responses for 5 minutes
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCachedCatalog(key) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}
```

#### 2. Request Batching
```javascript
// Batch multiple meta requests
async function batchGetMeta(ids) {
  const query = `
    query ($ids: [Int]) {
      Page(perPage: 50) {
        media(id_in: $ids) {
          // fields
        }
      }
    }
  `;
  // Execute single query for multiple IDs
}
```

#### 3. Connection Pooling
```javascript
// Reuse HTTP connections
const axios = require('axios');
const http = require('http');
const https = require('https');

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

axios.create({
  httpAgent,
  httpsAgent
});
```

## 🧪 Testing Strategy

### Manual Testing
1. **Unit Testing**: Test individual functions
2. **Integration Testing**: Test API interactions
3. **End-to-End Testing**: Test in Stremio client

### Test Scenarios

#### Catalog Endpoint
- ✓ Valid request returns anime list
- ✓ Invalid catalog ID returns empty list
- ✓ Invalid type returns empty list
- ✓ API error returns error response
- ✓ Empty list handled gracefully

#### Meta Endpoint
- ✓ Valid ID returns metadata
- ✓ Invalid ID format returns error
- ✓ Invalid type returns error
- ✓ Non-existent ID handled gracefully

#### Configuration
- ✓ Missing username throws error
- ✓ Invalid port throws error
- ✓ Valid config loads successfully

## 🔄 Future Enhancements

### Planned Features

1. **Additional Catalogs**
   - Completed anime
   - Plan to watch
   - Dropped anime
   - Custom lists

2. **Enhanced Metadata**
   - Episode information
   - Character details
   - Related anime
   - Recommendations

3. **Stream Integration**
   - Link to streaming sources
   - Episode tracking
   - Watch progress sync

4. **Performance Improvements**
   - Response caching
   - Request batching
   - Connection pooling

5. **User Features**
   - Multiple user support
   - Custom filters
   - Search functionality
   - Sorting options

### Technical Debt

1. **Testing**: Add automated tests
2. **Logging**: Implement structured logging
3. **Monitoring**: Add health check endpoint
4. **Documentation**: Add API documentation (OpenAPI/Swagger)

## 📚 Design Patterns

### Separation of Concerns
- **Server Layer**: HTTP handling (index.js)
- **Business Logic**: Addon protocol (addon.js)
- **Data Layer**: API integration (services/anilist.js)
- **Configuration**: Centralized config (config/)

### Error Handling Pattern
```javascript
try {
  // Operation
} catch (error) {
  console.error('Context:', error.message);
  throw new Error('User-friendly message');
}
```

### Async/Await Pattern
- All async operations use async/await
- No callback hell
- Clear error propagation

### Module Pattern
- Each file exports specific functionality
- Clear dependencies
- Easy to test and maintain

## 🔧 Development Guidelines

### Adding New Features

1. **Plan**: Document the feature in ARCHITECTURE.md
2. **Implement**: Follow existing patterns
3. **Document**: Add JSDoc comments
4. **Test**: Manual testing in Stremio
5. **Update**: Update README.md and CONTRIBUTING.md

### Code Review Checklist

- [ ] JSDoc comments added
- [ ] Error handling implemented
- [ ] Configuration externalized
- [ ] Logging added for debugging
- [ ] Documentation updated
- [ ] Manual testing completed

## 📖 References

- [Stremio Addon SDK](https://github.com/Stremio/stremio-addon-sdk)
- [AniList GraphQL API](https://anilist.gitbook.io/anilist-apiv2-docs/)
- [Express.js Documentation](https://expressjs.com/)
- [Axios Documentation](https://axios-http.com/)

---

**Last Updated**: 2026-04-19  
**Version**: 1.7.0