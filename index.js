/**
 * Stremio AniList Addon Server
 * 
 * This is the main entry point for the Stremio addon server. It sets up
 * an Express HTTP server that handles Stremio protocol requests and serves
 * the addon manifest, catalogs, and metadata.
 * 
 * @module index
 */

const express = require('express');
const addonInterface = require('./addon');
const config = require('./config/env');
const { HTTP_STATUS } = require('./config/constants');

// Initialize Express application
const app = express();

/**
 * CORS Middleware
 * 
 * Enables Cross-Origin Resource Sharing (CORS) to allow Stremio clients
 * from any origin to access the addon. This is required for Stremio to
 * communicate with the addon server.
 */
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

/**
 * Request Logging Middleware
 * 
 * Logs all incoming requests for debugging and monitoring purposes.
 * Only active in development mode to reduce noise in production.
 */
if (config.isDevelopment) {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });
}

/**
 * GET /manifest.json
 * 
 * Serves the addon manifest, which describes the addon's capabilities,
 * supported content types, and available resources to Stremio.
 * 
 * @route GET /manifest.json
 * @returns {Object} 200 - Addon manifest object
 * @returns {Object} 500 - Error response
 */
app.get('/manifest.json', (req, res) => {
  try {
    console.log('Serving addon manifest');
    res.json(addonInterface.manifest);
  } catch (error) {
    console.error('Error serving manifest:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: 'Failed to load manifest' 
    });
  }
});

/**
 * GET /catalog/:type/:id/:extra?.json
 * 
 * Serves catalog content for a specific type and ID. This endpoint is called
 * by Stremio when displaying a catalog (e.g., "Currently Watching" list).
 * 
 * @route GET /catalog/:type/:id/:extra?.json
 * @param {string} type - Content type (e.g., "anime", "movie")
 * @param {string} id - Catalog identifier (e.g., "anilist.watching")
 * @param {string} [extra] - Optional extra parameters (pagination, filters)
 * @returns {Object} 200 - Catalog response with metas array
 * @returns {Object} 400 - Bad request error
 * @returns {Object} 500 - Internal server error
 * 
 * @example
 * GET /catalog/anime/anilist.watching.json
 * Response: { metas: [{ id: "anilist:12345", name: "...", ... }] }
 */
app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
  try {
    const { type, id, extra } = req.params;
    
    // Validate required parameters
    if (!type || !id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
        error: 'Missing required parameters: type and id' 
      });
    }

    // Fetch catalog from addon interface
    const catalog = await addonInterface.getCatalog(type, id, extra);
    
    res.json(catalog);
  } catch (error) {
    console.error('Catalog error:', error.message);
    
    // Return appropriate error status
    const statusCode = error.message.includes('not found') 
      ? HTTP_STATUS.NOT_FOUND 
      : HTTP_STATUS.INTERNAL_SERVER_ERROR;
    
    res.status(statusCode).json({ 
      error: error.message || 'Failed to fetch catalog' 
    });
  }
});

/**
 * GET /meta/:type/:id.json
 * 
 * Serves detailed metadata for a specific content item. This endpoint is
 * called by Stremio when displaying detailed information about an anime.
 * 
 * @route GET /meta/:type/:id.json
 * @param {string} type - Content type (e.g., "anime", "movie")
 * @param {string} id - Content identifier (e.g., "anilist:12345")
 * @returns {Object} 200 - Meta response with meta object
 * @returns {Object} 400 - Bad request error
 * @returns {Object} 404 - Content not found
 * @returns {Object} 500 - Internal server error
 * 
 * @example
 * GET /meta/anime/anilist:12345.json
 * Response: { meta: { id: "anilist:12345", name: "...", ... } }
 */
app.get('/meta/:type/:id.json', async (req, res) => {
  try {
    const { type, id } = req.params;
    
    // Validate required parameters
    if (!type || !id) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
        error: 'Missing required parameters: type and id' 
      });
    }

    // Fetch metadata from addon interface
    const meta = await addonInterface.getMeta(type, id);
    
    res.json(meta);
  } catch (error) {
    console.error('Meta error:', error.message);
    
    // Return appropriate error status
    const statusCode = error.message.includes('not found') 
      ? HTTP_STATUS.NOT_FOUND 
      : HTTP_STATUS.INTERNAL_SERVER_ERROR;
    
    res.status(statusCode).json({ 
      error: error.message || 'Failed to fetch metadata' 
    });
  }
});

/**
 * GET /
 * 
 * Root endpoint that provides basic information about the addon
 * and instructions for installation.
 */
app.get('/', (req, res) => {
  res.json({
    name: addonInterface.manifest.name,
    version: addonInterface.manifest.version,
    description: addonInterface.manifest.description,
    installUrl: `http://localhost:${config.port}/manifest.json`,
    message: 'Add this URL to Stremio to install the addon'
  });
});

/**
 * 404 Handler
 * 
 * Catches all unmatched routes and returns a 404 error.
 */
app.use((req, res) => {
  res.status(HTTP_STATUS.NOT_FOUND).json({ 
    error: 'Endpoint not found',
    path: req.url
  });
});

/**
 * Global Error Handler
 * 
 * Catches any unhandled errors in the application and returns
 * a generic error response to prevent server crashes.
 */
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
    error: 'Internal server error' 
  });
});

/**
 * Start the Express server
 * 
 * Binds the server to the configured port and begins listening for requests.
 * Displays helpful information about how to install the addon in Stremio.
 */
app.listen(config.port, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 Stremio AniList Addon Server Started');
  console.log('='.repeat(60));
  console.log(`📡 Server listening on port ${config.port}`);
  console.log(`👤 AniList user: ${config.anilistUsername}`);
  console.log(`🌍 Environment: ${config.nodeEnv}`);
  console.log('\n📦 Installation URL:');
  console.log(`   http://localhost:${config.port}/manifest.json`);
  console.log('\n📖 Instructions:');
  console.log('   1. Open Stremio');
  console.log('   2. Go to Settings → Addons');
  console.log('   3. Click "Install from URL"');
  console.log('   4. Paste the installation URL above');
  console.log('   5. Click "Install"');
  console.log('='.repeat(60) + '\n');
});

/**
 * Graceful Shutdown Handler
 * 
 * Handles SIGINT (Ctrl+C) and SIGTERM signals to gracefully shut down
 * the server, allowing ongoing requests to complete.
 */
process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n🛑 Shutting down gracefully...');
  process.exit(0);
});

// Made with Bob
