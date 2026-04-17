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
 * Validates an AniList username from the URL path.
 * Only allows alphanumeric characters, underscores, and hyphens (2-20 chars).
 */
function isValidUsername(username) {
  return /^[a-zA-Z0-9_-]{2,20}$/.test(username);
}

/**
 * GET /
 *
 * Configure page — lets users enter their AniList username and get a
 * personalised install URL for Stremio.
 */
app.get('/', (req, res) => {
  const host = req.headers.host || `localhost:${config.port}`;
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const baseUrl = `${protocol}://${host}`;

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AniList Stremio Addon</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f0f0f;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 12px;
      padding: 2.5rem;
      max-width: 480px;
      width: 100%;
    }
    h1 { font-size: 1.5rem; margin-bottom: 0.4rem; color: #fff; }
    .subtitle { color: #888; font-size: 0.9rem; margin-bottom: 2rem; }
    label { display: block; font-size: 0.85rem; color: #aaa; margin-bottom: 0.4rem; }
    input {
      width: 100%;
      padding: 0.65rem 0.9rem;
      background: #111;
      border: 1px solid #333;
      border-radius: 8px;
      color: #fff;
      font-size: 1rem;
      outline: none;
      transition: border-color 0.15s;
    }
    input:focus { border-color: #5b6af5; }
    input.error { border-color: #e05555; }
    .hint { font-size: 0.78rem; color: #666; margin-top: 0.35rem; min-height: 1.1em; }
    .hint.err { color: #e05555; }
    .result { margin-top: 1.5rem; display: none; }
    .result.visible { display: block; }
    .url-box {
      background: #111;
      border: 1px solid #2a2a2a;
      border-radius: 8px;
      padding: 0.7rem 0.9rem;
      font-family: monospace;
      font-size: 0.82rem;
      color: #a0c4ff;
      word-break: break-all;
      margin-bottom: 0.8rem;
    }
    .actions { display: flex; gap: 0.6rem; flex-wrap: wrap; }
    button, .stremio-btn {
      padding: 0.55rem 1.1rem;
      border-radius: 7px;
      font-size: 0.88rem;
      cursor: pointer;
      border: none;
      font-weight: 500;
      text-decoration: none;
      display: inline-block;
      transition: opacity 0.15s;
    }
    button:hover, .stremio-btn:hover { opacity: 0.85; }
    .copy-btn { background: #2a2a2a; color: #e0e0e0; }
    .stremio-btn { background: #5b6af5; color: #fff; }
    .copied { color: #4caf7d; font-size: 0.82rem; margin-top: 0.4rem; min-height: 1.1em; }
  </style>
</head>
<body>
  <div class="card">
    <h1>AniList Stremio Addon</h1>
    <p class="subtitle">Syncs your AniList &ldquo;Currently Watching&rdquo; list to Stremio.</p>

    <label for="username">Your AniList username</label>
    <input
      type="text"
      id="username"
      placeholder="e.g. MyUsername"
      autocomplete="off"
      spellcheck="false"
      maxlength="20"
    >
    <p class="hint" id="hint">Letters, numbers, hyphens and underscores (2&ndash;20 chars).</p>

    <div class="result" id="result">
      <label style="margin-top:1rem">Your install URL</label>
      <div class="url-box" id="url-display"></div>
      <div class="actions">
        <button class="copy-btn" onclick="copyUrl()">Copy URL</button>
        <a class="stremio-btn" id="stremio-link" href="#">Open in Stremio</a>
      </div>
      <p class="copied" id="copied-msg"></p>
    </div>
  </div>

  <script>
    const BASE = '${baseUrl}';
    const input = document.getElementById('username');
    const result = document.getElementById('result');
    const urlDisplay = document.getElementById('url-display');
    const stremioLink = document.getElementById('stremio-link');
    const hint = document.getElementById('hint');
    const copiedMsg = document.getElementById('copied-msg');
    const VALID = /^[a-zA-Z0-9_-]{2,20}$/;

    input.addEventListener('input', () => {
      const val = input.value.trim();
      copiedMsg.textContent = '';
      if (!val) {
        input.classList.remove('error');
        hint.textContent = 'Letters, numbers, hyphens and underscores (2\\u201320 chars).';
        hint.classList.remove('err');
        result.classList.remove('visible');
        return;
      }
      if (!VALID.test(val)) {
        input.classList.add('error');
        hint.textContent = 'Invalid username \\u2014 only letters, numbers, hyphens and underscores allowed.';
        hint.classList.add('err');
        result.classList.remove('visible');
        return;
      }
      input.classList.remove('error');
      hint.textContent = '';
      hint.classList.remove('err');
      const manifestUrl = BASE + '/' + encodeURIComponent(val) + '/manifest.json';
      urlDisplay.textContent = manifestUrl;
      stremioLink.href = 'stremio://' + manifestUrl.replace(/^https?:\\/\\//, '');
      result.classList.add('visible');
    });

    function copyUrl() {
      const url = urlDisplay.textContent;
      if (!url) return;
      navigator.clipboard.writeText(url).then(() => {
        copiedMsg.textContent = 'Copied!';
        setTimeout(() => { copiedMsg.textContent = ''; }, 2000);
      });
    }
  </script>
</body>
</html>`);
});

/**
 * GET /:username/manifest.json
 *
 * Serves the addon manifest for a specific AniList user.
 */
app.get('/:username/manifest.json', (req, res) => {
  const { username } = req.params;

  if (!isValidUsername(username)) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid username' });
  }

  try {
    res.json(addonInterface.manifest);
  } catch (error) {
    console.error('Error serving manifest:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to load manifest' });
  }
});

/**
 * GET /:username/catalog/:type/:id/:extra?.json
 */
app.get('/:username/catalog/:type/:id/:extra?.json', async (req, res) => {
  const { username, type, id, extra } = req.params;

  if (!isValidUsername(username)) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid username' });
  }

  try {
    const catalog = await addonInterface.getCatalog(type, id, extra, username);
    res.json(catalog);
  } catch (error) {
    console.error('Catalog error:', error.message);
    const statusCode = error.message.includes('not found')
      ? HTTP_STATUS.NOT_FOUND
      : HTTP_STATUS.INTERNAL_SERVER_ERROR;
    res.status(statusCode).json({ error: error.message || 'Failed to fetch catalog' });
  }
});

/**
 * GET /:username/meta/:type/:id.json
 */
app.get('/:username/meta/:type/:id.json', async (req, res) => {
  const { username, type, id } = req.params;

  if (!isValidUsername(username)) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid username' });
  }

  if (!type || !id) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Missing required parameters: type and id' });
  }

  try {
    const meta = await addonInterface.getMeta(type, id, username);
    res.json(meta);
  } catch (error) {
    console.error('Meta error:', error.message);
    const statusCode = error.message.includes('not found')
      ? HTTP_STATUS.NOT_FOUND
      : HTTP_STATUS.INTERNAL_SERVER_ERROR;
    res.status(statusCode).json({ error: error.message || 'Failed to fetch metadata' });
  }
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
  console.log(`🌍 Environment: ${config.nodeEnv}`);
  console.log('\n📦 Configure page:');
  console.log(`   http://localhost:${config.port}/`);
  console.log('\n📜 Per-user install URL format:');
  console.log(`   http://localhost:${config.port}/<username>/manifest.json`);
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
