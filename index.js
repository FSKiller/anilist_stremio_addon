const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const addonInterface = require('./addon');
const config = require('./config/env');
const { HTTP_STATUS, ANILIST_OAUTH, MAL_OAUTH } = require('./config/constants');
const tokenManager = require('./config/tokens');

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

// MAL: 64-char lowercase hex opaque token issued by this server after OAuth
function isValidMalToken(val) {
  return typeof val === 'string' && /^[a-f0-9]{64}$/.test(val);
}

// IMDB: user ID starts with "ur" + digits, or "p." + alphanumeric
function isValidImdbUserId(val) {
  return typeof val === 'string' && /^(ur\d{4,15}|p\.[a-z0-9]{10,50})$/.test(val);
}

function isValidServiceParam(service, param) {
  if (service === 'anilist') return isValidAniListToken(param);
  if (service === 'mal') return isValidMalToken(param);
  if (service === 'imdb') return isValidImdbUserId(param);
  return false;
}

// For MAL routes: resolve the opaque addon token to the stored username.
// For all other services the param is already the user-facing identifier.
function resolveServiceToken(service, token) {
  if (service !== 'mal') return token;
  return tokenManager.resolveOpaqueToken(token);
}

const VALID_SERVICES = new Set(['anilist', 'mal', 'imdb']);

function configurePageHandler(req, res) {
  const host = req.headers.host || ('localhost:' + config.port);
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const baseUrl = protocol + '://' + host;
  const anilistOk = !!config.anilistClientId;
  const malOauthOk = !!(config.malClientId && config.malClientSecret);

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
    .section{margin-bottom:2rem;padding-bottom:1.5rem;border-bottom:1px solid rgba(255,255,255,.06)}
    .section:last-of-type{border-bottom:none;margin-bottom:0;padding-bottom:0}
    .section-title{font-size:.95rem;font-weight:600;color:#fff;margin-bottom:1rem;display:flex;align-items:center;gap:.5rem}
    .section-badge{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;font-size:.75rem;flex-shrink:0}
    .badge-anilist{background:linear-gradient(135deg,#02a9ff,#0284c7)}
    .badge-mal{background:linear-gradient(135deg,#2e51a2,#1e3a7a)}
    .badge-imdb{background:linear-gradient(135deg,#f5c518,#e0a800);color:#000}
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

    <!-- AniList section -->
    <div class="section">
      <div class="section-title"><span class="section-badge badge-anilist">A</span> AniList</div>
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

    <!-- MAL section -->
    <div class="section">
      <div class="section-title"><span class="section-badge badge-mal">M</span> MyAnimeList</div>
      ${!malOauthOk ? '<div class="warn">MAL support requires <strong>MAL_CLIENT_ID</strong> and <strong>MAL_CLIENT_SECRET</strong> in .env.<br>Register at <a href="https://myanimelist.net/apiconfig" target="_blank" rel="noopener">myanimelist.net/apiconfig</a>.</div>' : ''}
      <div id="mal-pre"${!malOauthOk ? ' style="display:none"' : ''}>
        <button class="btn btn-login" onclick="malConnect()">&#x1F511;&nbsp; Connect to MyAnimeList</button>
        <p class="pre-hint">You will be redirected to MyAnimeList to authorize,<br>then returned here automatically.</p>
      </div>
      <div id="mal-post" style="display:none" class="result">
        <input type="hidden" id="mal-token" value="">
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:9px;padding:.65rem .9rem;font-family:monospace;font-size:.8rem;color:#a0c4ff;word-break:break-all;margin-bottom:.8rem" id="mal-url-display"></div>
        <div class="actions">
          <button class="btn btn-copy" onclick="malCopy()">&#x1F4CB;&nbsp; Copy URL</button>
          <a class="btn btn-stremio" id="mal-stremio" href="#">&#x25B6;&nbsp; Open in Stremio</a>
        </div>
        <p class="copied" id="mal-copied"></p>
        <p class="hint" id="mal-auth-status" style="margin-top:.5rem"></p>
        <button class="btn-switch" onclick="malReset()">Switch account</button>
      </div>
    </div>

    <!-- IMDB section -->
    <div class="section">
      <div class="section-title"><span class="section-badge badge-imdb">I</span> IMDB</div>
      <div id="imdb-form">
        <label for="imdb-userid">IMDB User ID</label>
        <input type="text" id="imdb-userid" placeholder="e.g. ur12345678 or paste profile URL"
               autocomplete="off" spellcheck="false" maxlength="60">
        <p class="hint" id="imdb-hint">Found in your <a href="https://www.imdb.com/user/" target="_blank" rel="noopener" style="color:#5b6af5">IMDB profile URL</a> (e.g. ur12345678 or p.xxxx). Your watchlist must be public.</p>

        <div id="imdb-result" style="display:none" class="result">
          <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:9px;padding:.65rem .9rem;font-family:monospace;font-size:.8rem;color:#f5c518;word-break:break-all;margin-bottom:.8rem" id="imdb-url-display"></div>
          <div class="actions">
            <button class="btn btn-copy" onclick="imdbCopy()">&#x1F4CB;&nbsp; Copy URL</button>
            <a class="btn btn-stremio" id="imdb-stremio" href="#">&#x25B6;&nbsp; Open in Stremio</a>
          </div>
          <p class="copied" id="imdb-copied"></p>
        </div>
      </div>
    </div>

    <!-- Install All section -->
    <div class="section" id="install-all-section" style="display:none">
      <a class="btn btn-stremio" id="install-all-btn" href="#" style="width:100%;justify-content:center;padding:.85rem;font-size:1rem;border-radius:10px;text-decoration:none">&#x25B6;&nbsp; Install in Stremio</a>
      <p class="hint" style="text-align:center;margin-top:.5rem">Installs one combined addon with all configured services.</p>
    </div>

    <p class="note">Currently Watching &bull; On Hold &bull; Plan to Watch &bull; Dropped &bull; Completed &bull; Rewatching</p>
  </div>

  <script>
    var BASE = '${baseUrl}';

    // On return from OAuth callbacks the result comes back in the hash
    (function() {
      var params = new URLSearchParams(window.location.hash.substring(1));
      var alToken = params.get('anilist_token');
      if (alToken) {
        history.replaceState(null, '', window.location.pathname);
        showAlResult(decodeURIComponent(alToken));
      }
      var malToken = params.get('mal_token');
      if (malToken && /^[a-f0-9]{64}$/.test(malToken)) {
        history.replaceState(null, '', window.location.pathname);
        showMalResult(malToken);
      }
    })();

    function alLogin() { window.location.href = BASE + '/auth/anilist'; }

    function alReset() {
      document.getElementById('al-post').style.display = 'none';
      document.getElementById('al-url').textContent = '';
      document.getElementById('al-stremio').href = '#';
      document.getElementById('al-copied').textContent = '';
      document.getElementById('al-pre').style.display = 'block';
      updateInstallAll();
    }

    function showAlResult(token) {
      var url = BASE + '/anilist/' + encodeURIComponent(token) + '/manifest.json';
      document.getElementById('al-url').textContent = url;
      document.getElementById('al-stremio').href = 'stremio://' + url.replace(/^https?:\\/\\//, '');
      document.getElementById('al-pre').style.display = 'none';
      document.getElementById('al-post').style.display = 'block';      updateInstallAll();    }

    function alCopy() {
      var url = document.getElementById('al-url').textContent;
      if (!url) return;
      navigator.clipboard.writeText(url).then(function() {
        var el = document.getElementById('al-copied');
        el.textContent = 'Copied!';
        setTimeout(function() { el.textContent = ''; }, 2000);
      });
    }

    // MAL — single Connect button triggers OAuth; username discovered automatically
    function malConnect() {
      window.location.href = BASE + '/auth/mal/connect';
    }

    function showMalResult(token) {
      var url = BASE + '/mal/' + token + '/manifest.json';
      document.getElementById('mal-token').value = token;
      document.getElementById('mal-url-display').textContent = url;
      document.getElementById('mal-stremio').href = 'stremio://' + url.replace(/^https?:\\/\\//, '');
      document.getElementById('mal-pre').style.display = 'none';
      document.getElementById('mal-post').style.display = 'block';
      // Check auth status
      fetch(BASE + '/auth/mal/' + token + '/status')
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var statusEl = document.getElementById('mal-auth-status');
          if (data.authenticated) {
            statusEl.textContent = '\u2705 Authenticated \u2014 progress updates enabled';
          }
        })
        .catch(function() {});
      try { localStorage.setItem('mal-token', token); } catch(e) {}
      updateInstallAll();
    }

    function malReset() {
      document.getElementById('mal-post').style.display = 'none';
      document.getElementById('mal-token').value = '';
      document.getElementById('mal-url-display').textContent = '';
      document.getElementById('mal-stremio').href = '#';
      document.getElementById('mal-copied').textContent = '';
      document.getElementById('mal-auth-status').textContent = '';
      document.getElementById('mal-pre').style.display = 'block';
      try { localStorage.removeItem('mal-token'); } catch(e) {}
      updateInstallAll();
    }

    function malCopy() {
      var url = document.getElementById('mal-url-display').textContent;
      if (!url) return;
      navigator.clipboard.writeText(url).then(function() {
        var el = document.getElementById('mal-copied');
        el.textContent = 'Copied!';
        setTimeout(function() { el.textContent = ''; }, 2000);
      });
    }

    // Restore MAL from localStorage
    (function() {
      if (document.getElementById('mal-post').style.display !== 'none') return;
      try {
        var saved = localStorage.getItem('mal-token');
        if (saved && /^[a-f0-9]{64}$/.test(saved)) showMalResult(saved);
      } catch(e) {}
    })();

    // IMDB — user ID input generates install URL
    var IMDB_RE = /^(ur\d{4,15}|p\.[a-z0-9]{10,50})$/;

    document.getElementById('imdb-userid') && document.getElementById('imdb-userid').addEventListener('input', imdbUserIdChanged);

    function imdbUserIdChanged() {
      var val = document.getElementById('imdb-userid').value.trim();
      var hint = document.getElementById('imdb-hint');
      var result = document.getElementById('imdb-result');
      if (!val) {
        hint.innerHTML = 'Found in your <a href="https://www.imdb.com/user/" target="_blank" rel="noopener" style="color:#5b6af5">IMDB profile URL</a> (e.g. ur12345678 or p.xxxx). Your watchlist must be public.';
        hint.classList.remove('err');
        result.style.display = 'none';
        updateInstallAll();
        return;
      }
      // Allow pasting full profile URL
      var urlMatch = val.match(/(ur\d{4,15}|p\.[a-z0-9]{10,50})/);
      if (urlMatch) {
        val = urlMatch[1];
        document.getElementById('imdb-userid').value = val;
      }
      if (!IMDB_RE.test(val)) {
        hint.textContent = 'Invalid IMDB User ID. Paste your IMDB profile URL or enter the ID directly.';
        hint.classList.add('err');
        result.style.display = 'none';
        return;
      }
      hint.textContent = '';
      hint.classList.remove('err');
      var url = BASE + '/imdb/' + encodeURIComponent(val) + '/manifest.json';
      document.getElementById('imdb-url-display').textContent = url;
      document.getElementById('imdb-stremio').href = 'stremio://' + url.replace(/^https?:\\/\\//, '');
      result.style.display = 'block';
      try { localStorage.setItem('imdb-userid', val); } catch(e) {}
      updateInstallAll();
    }

    function imdbCopy() {
      var url = document.getElementById('imdb-url-display').textContent;
      if (!url) return;
      navigator.clipboard.writeText(url).then(function() {
        var el = document.getElementById('imdb-copied');
        el.textContent = 'Copied!';
        setTimeout(function() { el.textContent = ''; }, 2000);
      });
    }

    // Restore IMDB user ID from localStorage
    (function() {
      try {
        var saved = localStorage.getItem('imdb-userid');
        var input = document.getElementById('imdb-userid');
        if (saved && input) {
          input.value = saved;
          input.dispatchEvent(new Event('input'));
        }
      } catch(e) {}
    })();

    // --- Install All (combined addon) ---
    function getServiceConfig() {
      var cfg = {};
      var alUrl = document.getElementById('al-url').textContent;
      if (alUrl) {
        // Extract token from URL: BASE/anilist/<token>/manifest.json
        var alMatch = alUrl.match(/\\/anilist\\/([^\\/]+)\\/manifest\\.json/);
        if (alMatch) cfg.anilist = decodeURIComponent(alMatch[1]);
      }
      var malToken = document.getElementById('mal-token');
      if (malToken && /^[a-f0-9]{64}$/.test(malToken.value)) {
        cfg.mal = malToken.value;
      }
      var imdbInput = document.getElementById('imdb-userid');
      if (imdbInput && imdbInput.value.trim() && /^(ur\\d{4,15}|p\\.[a-z0-9]{10,50})$/.test(imdbInput.value.trim())) {
        cfg.imdb = imdbInput.value.trim();
      }
      return cfg;
    }

    function buildCombinedUrl(cfg) {
      var keys = Object.keys(cfg);
      if (keys.length === 0) return null;
      // If only one service, use the direct URL
      if (keys.length === 1) {
        var svc = keys[0];
        return BASE + '/' + svc + '/' + encodeURIComponent(cfg[svc]) + '/manifest.json';
      }
      // Multiple services: base64url-encode the config
      var jsonStr = JSON.stringify(cfg);
      var b64 = btoa(jsonStr).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
      return BASE + '/combined/' + b64 + '/manifest.json';
    }

    function updateInstallAll() {
      var cfg = getServiceConfig();
      var keys = Object.keys(cfg);
      var section = document.getElementById('install-all-section');
      var btn = document.getElementById('install-all-btn');
      if (keys.length >= 1) {
        var url = buildCombinedUrl(cfg);
        btn.href = 'stremio://' + url.replace(/^https?:\\/\\//, '');
        section.style.display = 'block';
      } else {
        section.style.display = 'none';
      }
    }

    // Initial check
    updateInstallAll();
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

// Initiate MAL OAuth PKCE flow — no username needed, discovered after auth
app.get('/auth/mal/connect', (req, res) => {
  if (!config.malClientId || !config.malClientSecret) {
    return res.status(400).send('<h2>MAL OAuth not configured on this server.</h2><a href="/">Try again</a>');
  }

  const host = req.headers.host || ('localhost:' + config.port);
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const redirectUri = `${protocol}://${host}/auth/mal/callback`;

  // MAL uses PKCE with plain method (code_challenge = code_verifier)
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const sessionId = crypto.randomBytes(16).toString('hex');
  tokenManager.storePkceVerifier(sessionId, codeVerifier);

  res.redirect(
    MAL_OAUTH.AUTH_URL +
    '?response_type=code' +
    '&client_id=' + encodeURIComponent(config.malClientId) +
    '&redirect_uri=' + encodeURIComponent(redirectUri) +
    '&state=' + encodeURIComponent(sessionId) +
    '&code_challenge=' + codeVerifier +
    '&code_challenge_method=plain'
  );
});

// Exchange MAL auth code for access token, discover username, store tokens
app.get('/auth/mal/callback', async (req, res) => {
  const { code, error, state } = req.query;

  if (error) {
    return res.status(400).send(`<h2>Authentication failed: ${error}</h2><a href="/">Try again</a>`);
  }
  if (!code || !state) {
    return res.status(400).send('<h2>No authorization code received.</h2><a href="/">Try again</a>');
  }

  const codeVerifier = tokenManager.getPkceVerifier(state);
  if (!codeVerifier) {
    return res.status(400).send('<h2>Session expired. Please restart the authentication flow.</h2><a href="/">Try again</a>');
  }

  if (!config.malClientId || !config.malClientSecret) {
    return res.status(400).send('<h2>MAL OAuth not configured on this server.</h2><a href="/">Try again</a>');
  }

  const host = req.headers.host || ('localhost:' + config.port);
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const redirectUri = `${protocol}://${host}/auth/mal/callback`;

  try {
    const { data } = await axios.post(MAL_OAUTH.TOKEN_URL, new URLSearchParams({
      client_id: config.malClientId,
      client_secret: config.malClientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000
    });

    // Discover the authenticated user's MAL username
    const malService = require('./services/mal');
    const username = await malService.getAuthenticatedUsername(data.access_token);
    if (!username) {
      return res.status(400).send('<h2>Could not retrieve your MAL username.</h2><a href="/">Try again</a>');
    }

    tokenManager.storeTokens('mal', username, data);

    // Issue a random opaque token for use in the addon URL — never expose the username
    const opaqueToken = crypto.randomBytes(32).toString('hex');
    tokenManager.storeOpaqueToken(opaqueToken, username);

    // Redirect back to configure page with the opaque token in the hash
    res.redirect(`${protocol}://${host}/configure#mal_token=${opaqueToken}`);
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data, null, 2) : err.message;
    console.error('MAL OAuth callback error:', detail);
    res.status(400).send(`<h2>MAL authentication failed</h2><pre>${detail}</pre><p><a href="/">Try again</a></p>`);
  }
});

// Check if a MAL opaque token is still authenticated
app.get('/auth/mal/:token/status', (req, res) => {
  const { token } = req.params;
  if (!isValidMalToken(token)) return res.status(400).json({ error: 'Invalid token' });
  res.json({ authenticated: tokenManager.hasValidTokensByOpaqueToken(token) });
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

// --- Combined addon routes ---
// Config token is base64url-encoded JSON: {"anilist":"<token>","mal":"<username>","imdb":"<userid>"}
function parseCombinedConfig(configStr) {
  try {
    const json = Buffer.from(configStr, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    // Validate each service param
    for (const [svc, param] of Object.entries(parsed)) {
      if (!VALID_SERVICES.has(svc)) return null;
      if (!isValidServiceParam(svc, param)) return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function serviceForCatalogId(id) {
  if (id.startsWith('anilist.')) return 'anilist';
  if (id.startsWith('mal.')) return 'mal';
  if (id.startsWith('imdb.')) return 'imdb';
  return null;
}

app.get('/combined/:config/manifest.json', (req, res) => {
  const svcConfig = parseCombinedConfig(req.params.config);
  if (!svcConfig) return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid combined config.' });
  try {
    res.json(addonInterface.getCombinedManifest(svcConfig));
  } catch (error) {
    console.error('Combined manifest error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to load manifest' });
  }
});

app.get('/combined/:config/catalog/:type/:id/:extra?.json', async (req, res) => {
  const svcConfig = parseCombinedConfig(req.params.config);
  if (!svcConfig) return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid combined config.' });
  const { type, id, extra } = req.params;
  const service = serviceForCatalogId(id);
  if (!service || !svcConfig[service]) return res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Service not configured.' });
  try {
    const userParam = resolveServiceToken(service, svcConfig[service]);
    if (service === 'mal' && !userParam) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Invalid or expired MAL token.' });
    const catalog = await addonInterface.getCatalog(type, id, extra, userParam, service, config.malClientId);
    res.json(catalog);
  } catch (error) {
    console.error('Combined catalog error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: error.message || 'Failed to fetch catalog' });
  }
});

app.get('/combined/:config/meta/:type/:id.json', async (req, res) => {
  const svcConfig = parseCombinedConfig(req.params.config);
  if (!svcConfig) return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid combined config.' });
  const { type, id } = req.params;
  // Determine service from ID prefix
  let service = 'anilist';
  if (id.startsWith('mal:') || id.startsWith('kitsu:')) {
    service = svcConfig.mal ? 'mal' : 'anilist';
  } else if (id.startsWith('tt')) {
    service = svcConfig.imdb ? 'imdb' : 'anilist';
  }
  const token = svcConfig[service];
  if (!token) return res.json({ meta: null });
  try {
    const userParam = resolveServiceToken(service, token);
    if (service === 'mal' && !userParam) return res.json({ meta: null });
    const meta = await addonInterface.getMeta(type, id, userParam, service, config.malClientId);
    res.json(meta);
  } catch (error) {
    console.error('Combined meta error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: error.message || 'Failed to fetch meta' });
  }
});

app.get('/combined/:config/stream/:type/:id.json', async (req, res) => {
  const svcConfig = parseCombinedConfig(req.params.config);
  if (!svcConfig) return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid combined config.' });
  const { type, id } = req.params;
  // Determine service from ID prefix
  let service = 'anilist';
  if (id.startsWith('mal:')) {
    service = 'mal';
  }
  const token = svcConfig[service];
  if (!token) return res.json({ streams: [] });
  const videoInfo = {};
  if (req.query.season) videoInfo.season = parseInt(req.query.season, 10);
  if (req.query.episode) videoInfo.episode = parseInt(req.query.episode, 10);
  if (!videoInfo.episode && id.includes(':')) {
    const parts = id.split(':');
    if (parts.length >= 4) {
      const s = parseInt(parts[2], 10), e = parseInt(parts[3], 10);
      if (!isNaN(s) && s > 0) videoInfo.season = s;
      if (!isNaN(e) && e > 0) videoInfo.episode = e;
    } else if (parts.length === 3) {
      const e = parseInt(parts[2], 10);
      if (!isNaN(e) && e > 0) videoInfo.episode = e;
    }
  }
  try {
    const userParam = resolveServiceToken(service, token);
    if (service === 'mal' && !userParam) return res.json({ streams: [] });
    const stream = await addonInterface.getStream(type, id, videoInfo, userParam, service, config.malClientId);
    res.json(stream);
  } catch (error) {
    console.error('Combined stream error:', error.message);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: error.message || 'Failed to fetch stream' });
  }
});

app.get('/:service/:token/manifest.json', (req, res) => {
  const { service, token } = req.params;
  if (!VALID_SERVICES.has(service)) return res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Unknown service.' });
  if (!isValidServiceParam(service, token)) return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid identifier.' });
  if (service === 'mal' && !config.malClientId) return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'MAL not configured on this server (missing MAL_CLIENT_ID).' });
  if (service === 'mal' && !resolveServiceToken('mal', token)) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Invalid or expired MAL token.' });
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
  if (service === 'mal' && !config.malClientId) return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'MAL not configured on this server (missing MAL_CLIENT_ID).' });
  try {
    const userParam = resolveServiceToken(service, token);
    if (service === 'mal' && !userParam) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Invalid or expired MAL token.' });
    const catalog = await addonInterface.getCatalog(type, id, extra, userParam, service, config.malClientId);
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
  if (service === 'mal' && !config.malClientId) return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'MAL not configured on this server (missing MAL_CLIENT_ID).' });
  try {
    const userParam = resolveServiceToken(service, token);
    if (service === 'mal' && !userParam) return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Invalid or expired MAL token.' });
    const meta = await addonInterface.getMeta(type, id, userParam, service, config.malClientId);
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
  try {
    const videoInfo = {};

    // Check query params first (some clients pass season/episode there)
    if (req.query.season) videoInfo.season = parseInt(req.query.season, 10);
    if (req.query.episode) videoInfo.episode = parseInt(req.query.episode, 10);

    // If no episode in query params, extract from ID
    // Stremio series format: prefix:id:season:episode (4 parts)
    // Legacy format:         prefix:id:episode        (3 parts)
    if (!videoInfo.episode && id.includes(':')) {
      const parts = id.split(':');
      if (parts.length >= 4) {
        const potentialSeason = parseInt(parts[2], 10);
        const potentialEpisode = parseInt(parts[3], 10);
        if (!isNaN(potentialSeason) && potentialSeason > 0) {
          videoInfo.season = potentialSeason;
        }
        if (!isNaN(potentialEpisode) && potentialEpisode > 0) {
          videoInfo.episode = potentialEpisode;
        }
      } else if (parts.length === 3) {
        const potentialEpisode = parseInt(parts[2], 10);
        if (!isNaN(potentialEpisode) && potentialEpisode > 0) {
          videoInfo.episode = potentialEpisode;
        }
      }
    }

    if (!videoInfo.episode) {
      console.log(`No episode info found for stream request: ${id}`);
    }

    const userParam = resolveServiceToken(service, token);
    if (service === 'mal' && !userParam) return res.json({ streams: [] });
    const stream = await addonInterface.getStream(type, id, videoInfo, userParam, service, config.malClientId);
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
