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
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#080810;color:#e0e0e0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem}
    body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 80% 60% at 50% -10%,rgba(91,106,245,.18) 0%,transparent 70%);pointer-events:none}
    .card{background:rgba(18,18,28,.95);border:1px solid rgba(91,106,245,.25);border-radius:16px;padding:2.5rem;max-width:480px;width:100%;box-shadow:0 0 40px rgba(91,106,245,.08),0 8px 32px rgba(0,0,0,.5)}
    .logo{display:flex;align-items:center;gap:.75rem;margin-bottom:.35rem}
    .logo-icon{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#5b6af5,#a855f7);display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0}
    h1{font-size:1.45rem;font-weight:700;color:#fff;letter-spacing:-.02em}
    .subtitle{color:#666;font-size:.88rem;margin-bottom:2rem;padding-left:48px}
    .tabs{display:flex;gap:.4rem;margin-bottom:2rem;background:#0d0d1a;border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:.3rem}
    .tab{flex:1;padding:.5rem 0;text-align:center;border-radius:7px;cursor:pointer;font-size:.85rem;font-weight:500;color:#555;transition:all .2s;user-select:none;border:none;background:none}
    .tab.active{background:linear-gradient(135deg,#5b6af5,#7c3aed);color:#fff;box-shadow:0 2px 12px rgba(91,106,245,.4)}
    .tab.disabled{opacity:.3;cursor:not-allowed}
    .panel{display:none}
    .panel.active{display:block}
    .warn{background:rgba(42,31,0,.8);border:1px solid rgba(85,68,.6);border-radius:10px;padding:.75rem 1rem;font-size:.82rem;color:#ffcc55;margin-bottom:1.2rem;line-height:1.5}
    .warn a{color:#ffd97a}
    .err-box{background:rgba(42,16,16,.8);border:1px solid rgba(85,34,34,.8);border-radius:10px;padding:.75rem 1rem;font-size:.82rem;color:#ff8888;margin-bottom:1rem}
    .url-box{display:none}
    .actions{display:flex;gap:.6rem;flex-wrap:wrap}
    .btn{padding:.6rem 1.25rem;border-radius:8px;font-size:.88rem;font-weight:600;cursor:pointer;border:none;text-decoration:none;display:inline-flex;align-items:center;gap:.4rem;transition:all .2s;letter-spacing:.01em}
    .btn:active{transform:scale(.97)}
    .btn-login{background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;width:100%;justify-content:center;padding:.75rem;font-size:.95rem;border-radius:10px;box-shadow:0 4px 16px rgba(37,99,235,.3)}
    .btn-login:hover{box-shadow:0 4px 20px rgba(37,99,235,.5);opacity:1;filter:brightness(1.1)}
    .btn-copy{background:rgba(255,255,255,.06);color:#ccc;border:1px solid rgba(255,255,255,.1)}
    .btn-copy:hover{background:rgba(255,255,255,.1);color:#fff}
    .btn-stremio{background:linear-gradient(135deg,#5b6af5,#7c3aed);color:#fff;box-shadow:0 4px 14px rgba(91,106,245,.3)}
    .btn-stremio:hover{box-shadow:0 4px 18px rgba(91,106,245,.5);opacity:1;filter:brightness(1.1)}
    .btn-switch{background:none;color:#444;font-size:.78rem;font-weight:400;padding:.3rem 0;margin-top:.9rem;text-decoration:underline;text-underline-offset:3px;cursor:pointer;border:none}
    .btn-switch:hover{color:#888}
    .hint{font-size:.78rem;color:#555;margin-top:.35rem;min-height:1.2em}
    .hint.err{color:#e05555}
    label{display:block;font-size:.82rem;color:#888;margin-bottom:.4rem;font-weight:500;letter-spacing:.02em;text-transform:uppercase;font-size:.72rem}
    input{width:100%;padding:.65rem .9rem;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:9px;color:#fff;font-size:1rem;outline:none;transition:border-color .2s,box-shadow .2s}
    input:focus{border-color:#5b6af5;box-shadow:0 0 0 3px rgba(91,106,245,.15)}
    input.invalid{border-color:#e05555}
    .result{margin-top:1.5rem}
    .copied{color:#4ade80;font-size:.8rem;margin-top:.5rem;min-height:1.1em}
    .divider{height:1px;background:rgba(255,255,255,.06);margin:1.5rem 0}
    .note{font-size:.75rem;color:#3a3a4a;margin-top:1.5rem;line-height:1.6;text-align:center}
    .pre-hint{font-size:.78rem;color:#444;margin-top:.75rem;text-align:center;line-height:1.5}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <div class="logo-icon">&#x1F3AC;</div>
      <h1>Anime Stremio Addon</h1>
    </div>
    <p class="subtitle">Sync your anime list to Stremio &mdash; all statuses.</p>

    <div class="tabs">
      <div class="tab active" id="tab-anilist" onclick="switchTab('anilist')">AniList</div>
      <div class="tab${malOk ? '' : ' disabled'}" id="tab-mal" onclick="switchTab('mal')">MyAnimeList</div>
    </div>

    <!-- AniList panel -->
    <div class="panel active" id="panel-anilist">
      ${!anilistOk ? '<div class="err-box"><strong>ANILIST_CLIENT_ID not set.</strong> Add it to .env and restart.</div>' : ''}
      <div id="al-pre"${!anilistOk ? ' style="display:none"' : ''}>
        <button class="btn btn-login" onclick="alLogin()">&#x1F511;&nbsp; Login with AniList</button>
        <p class="pre-hint">You will be redirected to AniList to authorize,<br>then returned here automatically.</p>
      </div>
      <div id="al-post" style="display:none" class="result">
        <div class="url-box" id="al-url"></div>
        <div class="actions">
          <button class="btn btn-copy" onclick="alCopy()">&#x1F4CB;&nbsp; Copy URL</button>
          <a class="btn btn-stremio" id="al-stremio" href="#">&#x25B6;&nbsp; Open in Stremio</a>
        </div>
        <p class="copied" id="al-copied"></p>
        <button class="btn-switch" onclick="alReset()">Switch account</button>
      </div>
    </div>

    <!-- MAL panel -->
    <div class="panel" id="panel-mal">
      ${!malOk ? '<div class="warn">MAL support requires <strong>MAL_CLIENT_ID</strong> in .env.<br>Register at <a href="https://myanimelist.net/apiconfig" target="_blank" rel="noopener">myanimelist.net/apiconfig</a>.</div>' : ''}
      <label for="mal-username">MyAnimeList username</label>
      <input type="text" id="mal-username" placeholder="e.g. Mitsukuri"
             autocomplete="off" spellcheck="false" maxlength="20"${!malOk ? ' disabled' : ''}>
      <p class="hint" id="mal-hint">Letters, numbers, hyphens and underscores (2&ndash;20 chars).</p>
      <div id="mal-result" style="display:none" class="result">
        <div class="url-box" id="mal-url"></div>
        <div class="actions">
          <button class="btn btn-copy" onclick="malCopy()">&#x1F4CB;&nbsp; Copy URL</button>
          <a class="btn btn-stremio" id="mal-stremio" href="#">&#x25B6;&nbsp; Open in Stremio</a>
        </div>
        <p class="copied" id="mal-copied"></p>
      </div>
    </div>

    <p class="note">Currently Watching &bull; On Hold &bull; Plan to Watch &bull; Dropped &bull; Completed &bull; Rewatching</p>
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

    function alReset() {
      document.getElementById('al-post').style.display = 'none';
      document.getElementById('al-url').textContent = '';
      document.getElementById('al-stremio').href = '#';
      document.getElementById('al-copied').textContent = '';
      document.getElementById('al-pre').style.display = 'block';
    }

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
