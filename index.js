const express = require('express');
const axios = require('axios');
const addonInterface = require('./addon');
const config = require('./config/env');
const { HTTP_STATUS, ANILIST_OAUTH } = require('./config/constants');

const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

if (config.isDevelopment) {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });
}

// AniList: long bearer token
function isValidAniListToken(token) {
  return typeof token === 'string' && token.length >= 10 && token.length <= 2048 && !/[<>"'\n\r]/.test(token);
}

// MAL: public username (2-20 alphanumeric/dash/underscore)
function isValidUsername(val) {
  return typeof val === 'string' && /^[a-zA-Z0-9_-]{2,20}$/.test(val);
}

function isValidServiceParam(service, param) {
  if (service === 'anilist') return isValidAniListToken(param);
  if (service === 'mal') return isValidUsername(param);
  return false;
}

const VALID_SERVICES = new Set(['anilist', 'mal']);

function configurePageHandler(req, res) {
  const host = req.headers.host || ('localhost:' + config.port);
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const baseUrl = protocol + '://' + host;
  const anilistOk = !!config.anilistClientId;
  const malOk = !!config.malClientId;

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Anime Stremio Addon</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f0f0f;color:#e0e0e0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem}
    .card{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:2.5rem;max-width:500px;width:100%}
    h1{font-size:1.5rem;margin-bottom:.4rem;color:#fff}
    .subtitle{color:#888;font-size:.9rem;margin-bottom:1.8rem}
    .tabs{display:flex;gap:.5rem;margin-bottom:1.8rem}
    .tab{flex:1;padding:.55rem 0;text-align:center;border-radius:8px;cursor:pointer;font-size:.88rem;font-weight:500;border:1px solid #2a2a2a;background:#111;color:#888;transition:all .15s;user-select:none}
    .tab.active{background:#5b6af5;color:#fff;border-color:#5b6af5}
    .tab.disabled{opacity:.4;cursor:not-allowed}
    .panel{display:none}
    .panel.active{display:block}
    .warn{background:#2a1f00;border:1px solid #554400;border-radius:8px;padding:.75rem 1rem;font-size:.82rem;color:#ffcc55;margin-bottom:1.2rem;line-height:1.5}
    .warn a{color:#ffd97a}
    .err-box{background:#2a1010;border:1px solid #552222;border-radius:8px;padding:.75rem 1rem;font-size:.82rem;color:#ff8888;margin-bottom:1rem}
    label{display:block;font-size:.85rem;color:#aaa;margin-bottom:.4rem}
    input{width:100%;padding:.65rem .9rem;background:#111;border:1px solid #333;border-radius:8px;color:#fff;font-size:1rem;outline:none;transition:border-color .15s}
    input:focus{border-color:#5b6af5}
    input.invalid{border-color:#e05555}
    .hint{font-size:.78rem;color:#666;margin-top:.35rem;min-height:1.2em}
    .hint.err{color:#e05555}
    .url-box{background:#111;border:1px solid #2a2a2a;border-radius:8px;padding:.7rem .9rem;font-family:monospace;font-size:.8rem;color:#a0c4ff;word-break:break-all;margin-bottom:.9rem}
    .actions{display:flex;gap:.6rem;flex-wrap:wrap;margin-top:.9rem}
    .btn{padding:.55rem 1.1rem;border-radius:7px;font-size:.88rem;font-weight:500;cursor:pointer;border:none;text-decoration:none;display:inline-block;transition:opacity .15s}
    .btn:hover{opacity:.85}
    .btn-grey{background:#2a2a2a;color:#e0e0e0}
    .btn-blue{background:#02a9ff;color:#fff;font-size:.95rem;font-weight:600}
    .btn-indigo{background:#5b6af5;color:#fff}
    .copied{color:#4caf7d;font-size:.82rem;margin-top:.4rem;min-height:1.1em}
    .result{margin-top:1.5rem}
    .note{font-size:.78rem;color:#555;margin-top:1.5rem;line-height:1.5}
  </style>
</head>
<body>
  <div class="card">
    <h1>Anime Stremio Addon</h1>
    <p class="subtitle">Sync your anime list to Stremio &mdash; all statuses included.</p>

    <div class="tabs">
      <div class="tab active" id="tab-anilist" onclick="switchTab('anilist')">AniList</div>
      <div class="tab${malOk ? '' : ' disabled'}" id="tab-mal" onclick="switchTab('mal')">MyAnimeList</div>
    </div>

    <!-- AniList panel -->
    <div class="panel active" id="panel-anilist">
      ${!anilistOk ? '<div class="err-box"><strong>ANILIST_CLIENT_ID not set.</strong> Add it to .env and restart the server.</div>' : ''}
      <div id="al-pre"${!anilistOk ? ' style="display:none"' : ''}>
        <button class="btn btn-blue" onclick="alLogin()">Login with AniList</button>
        <p style="font-size:.78rem;color:#555;margin-top:.8rem">You will be redirected to AniList, then returned here with your install URL.</p>
      </div>
      <div id="al-post" style="display:none" class="result">
        <label>Your AniList install URL</label>
        <div class="url-box" id="al-url"></div>
        <div class="actions">
          <button class="btn btn-grey" onclick="alCopy()">Copy URL</button>
          <a class="btn btn-indigo" id="al-stremio" href="#">Open in Stremio</a>
        </div>
        <p class="copied" id="al-copied"></p>
        <button class="btn btn-grey" style="margin-top:.8rem;font-size:.8rem" onclick="alLogin()">Login with a different account</button>
      </div>
    </div>

    <!-- MAL panel -->
    <div class="panel" id="panel-mal">
      ${!malOk ? '<div class="warn">MAL support requires <strong>MAL_CLIENT_ID</strong> in .env.<br>Register an app at <a href="https://myanimelist.net/apiconfig" target="_blank" rel="noopener">myanimelist.net/apiconfig</a>.</div>' : ''}
      <label for="mal-username">Your MyAnimeList username</label>
      <input type="text" id="mal-username" placeholder="e.g. Mitsukuri"
             autocomplete="off" spellcheck="false" maxlength="20"${!malOk ? ' disabled' : ''}>
      <p class="hint" id="mal-hint">Letters, numbers, hyphens and underscores (2&ndash;20 chars).</p>
      <div id="mal-result" style="display:none" class="result">
        <label>Your MAL install URL</label>
        <div class="url-box" id="mal-url"></div>
        <div class="actions">
          <button class="btn btn-grey" onclick="malCopy()">Copy URL</button>
          <a class="btn btn-indigo" id="mal-stremio" href="#">Open in Stremio</a>
        </div>
        <p class="copied" id="mal-copied"></p>
      </div>
    </div>

    <p class="note">Includes: Currently Watching &bull; On Hold &bull; Plan to Watch &bull; Dropped &bull; Completed &bull; Rewatching</p>
  </div>

  <script>
    var BASE = '${baseUrl}';
    var MAL_OK = ${malOk};
    var MAL_RE = /^[a-zA-Z0-9_-]{2,20}$/;

    function switchTab(name) {
      if (name === 'mal' && !MAL_OK) return;
      document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
      document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
      document.getElementById('tab-' + name).classList.add('active');
      document.getElementById('panel-' + name).classList.add('active');
    }

    // On return from /auth/anilist/callback the token comes back in the hash
    (function() {
      var params = new URLSearchParams(window.location.hash.substring(1));
      var token = params.get('anilist_token');
      if (token) {
        history.replaceState(null, '', window.location.pathname);
        showAlResult(decodeURIComponent(token));
      }
    })();

    function alLogin() { window.location.href = BASE + '/auth/anilist'; }

    function showAlResult(token) {
      var url = BASE + '/anilist/' + encodeURIComponent(token) + '/manifest.json';
      document.getElementById('al-url').textContent = url;
      document.getElementById('al-stremio').href = 'stremio://' + url.replace(/^https?:\\/\\//, '');
      document.getElementById('al-pre').style.display = 'none';
      document.getElementById('al-post').style.display = 'block';
    }

    function alCopy() {
      var url = document.getElementById('al-url').textContent;
      if (!url) return;
      navigator.clipboard.writeText(url).then(function() {
        var el = document.getElementById('al-copied');
        el.textContent = 'Copied!';
        setTimeout(function() { el.textContent = ''; }, 2000);
      });
    }

    document.getElementById('mal-username').addEventListener('input', function() {
      var val = this.value.trim();
      var hint = document.getElementById('mal-hint');
      var result = document.getElementById('mal-result');
      if (!val) {
        this.classList.remove('invalid'); hint.classList.remove('err');
        hint.textContent = 'Letters, numbers, hyphens and underscores (2\u201320 chars).';
        result.style.display = 'none'; return;
      }
      if (!MAL_RE.test(val)) {
        this.classList.add('invalid'); hint.classList.add('err');
        hint.textContent = 'Invalid username.'; result.style.display = 'none'; return;
      }
      this.classList.remove('invalid'); hint.classList.remove('err'); hint.textContent = '';
      var url = BASE + '/mal/' + encodeURIComponent(val) + '/manifest.json';
      document.getElementById('mal-url').textContent = url;
      document.getElementById('mal-stremio').href = 'stremio://' + url.replace(/^https?:\\/\\//, '');
      result.style.display = 'block';
    });

    function malCopy() {
      var url = document.getElementById('mal-url').textContent;
      if (!url) return;
      navigator.clipboard.writeText(url).then(function() {
        var el = document.getElementById('mal-copied');
        el.textContent = 'Copied!';
        setTimeout(function() { el.textContent = ''; }, 2000);
      });
    }
  </script>
</body>
</html>`);
}

app.get('/', configurePageHandler);
app.get('/configure', configurePageHandler);

// Initiate AniList OAuth authorization code flow
// Redirect URI registered in AniList app: http://localhost:3000/auth/anilist/callback
app.get('/auth/anilist', (req, res) => {
  if (!config.anilistClientId) {
    return res.status(400).send('<h2>ANILIST_CLIENT_ID not configured on this server.</h2>');
  }
  const host = req.headers.host || ('localhost:' + config.port);
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const redirectUri = protocol + '://' + host + '/auth/anilist/callback';
  res.redirect(
    ANILIST_OAUTH.AUTH_URL +
    '?client_id=' + encodeURIComponent(config.anilistClientId) +
    '&redirect_uri=' + encodeURIComponent(redirectUri) +
    '&response_type=code'
  );
});

// Exchange authorization code for token, return token to browser via URL hash
app.get('/auth/anilist/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('<h2>Missing authorization code.</h2><a href="/">Try again</a>');
  }
  const host = req.headers.host || ('localhost:' + config.port);
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const redirectUri = protocol + '://' + host + '/auth/anilist/callback';
  try {
    const { data } = await axios.post(ANILIST_OAUTH.TOKEN_URL, {
      grant_type: 'authorization_code',
      client_id: config.anilistClientId,
      client_secret: config.anilistClientSecret,
      redirect_uri: redirectUri,
      code
    }, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: 10000
    });
    // Token returned in hash — never sent in a request, never stored server-side
    res.redirect(protocol + '://' + host + '/configure#anilist_token=' + encodeURIComponent(data.access_token));
  } catch (err) {
    const detail = err.response && err.response.data
      ? JSON.stringify(err.response.data, null, 2)
      : err.message;
    res.status(400).send('<h2>AniList authentication failed</h2><pre>' + detail + '</pre><p><a href="/">Try again</a></p>');
  }
});

app.get('/:service/:token/manifest.json', (req, res) => {
  const { service, token } = req.params;
  if (!VALID_SERVICES.has(service)) return res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Unknown service.' });
  if (!isValidServiceParam(service, token)) return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid identifier.' });
  if (service === 'mal' && !config.malClientId) return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'MAL not configured on this server.' });
  try {
    res.json(addonInterface.getManifest(service));
  } catch (error) {
    console.error('Manifest error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to load manifest' });
  }
});

app.get('/:service/:token/catalog/:type/:id/:extra?.json', async (req, res) => {
  const { service, token, type, id, extra } = req.params;
  if (!VALID_SERVICES.has(service)) return res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Unknown service.' });
  if (!isValidServiceParam(service, token)) return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid identifier.' });
  if (service === 'mal' && !config.malClientId) return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'MAL not configured on this server.' });
  try {
    const catalog = await addonInterface.getCatalog(type, id, extra, token, service, config.malClientId);
    res.json(catalog);
  } catch (error) {
    console.error('Catalog error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: error.message || 'Failed to fetch catalog' });
  }
});

app.get('/:service/:token/meta/:type/:id.json', async (req, res) => {
  const { service, token, type, id } = req.params;
  if (!VALID_SERVICES.has(service)) return res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Unknown service.' });
  if (!isValidServiceParam(service, token)) return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid identifier.' });
  try {
    const meta = await addonInterface.getMeta(type, id, token, service, config.malClientId);
    res.json(meta);
  } catch (error) {
    console.error('Meta error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: error.message || 'Failed to fetch meta' });
  }
});

app.get('/:service/:token/stream/:type/:id.json', async (req, res) => {
  const { service, token, type, id } = req.params;
  if (!VALID_SERVICES.has(service)) return res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Unknown service.' });
  if (!isValidServiceParam(service, token)) return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid identifier.' });
  const idParts = id.split(':');
  // For anilist:id:season:episode use last segment; for kitsu:id:episode also last segment
  const lastPart = parseInt(idParts[idParts.length - 1], 10);
  const episode = idParts.length >= 3 && !isNaN(lastPart) ? lastPart : null;
  const videoInfo = episode ? { episode } : {};
  try {
    const stream = await addonInterface.getStream(type, id, videoInfo, token, service, config.malClientId);
    res.json(stream);
  } catch (error) {
    console.error('Stream error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: error.message || 'Failed to fetch stream' });
  }
});

app.use((req, res) => {
  res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Not found', path: req.url });
});

app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Internal server error' });
});

app.listen(config.port, () => {
  console.log('='.repeat(60));
  console.log('AniList Stremio Addon');
  console.log('='.repeat(60));
  console.log(`Port: ${config.port}`);
  console.log(`Configure: http://localhost:${config.port}/`);
  console.log(`Manifest:  http://localhost:${config.port}/anilist/<token>/manifest.json`);
  console.log('='.repeat(60));
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
