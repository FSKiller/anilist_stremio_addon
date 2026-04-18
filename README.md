# Anime Stremio Addon

A self-hosted Stremio addon that syncs your anime watch lists from **AniList**, **MyAnimeList**, and **IMDB** directly into Stremio, with automatic episode progress updates.

## 📋 Table of Contents

- [Features](#-features)
- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Usage](#-usage)
- [Project Structure](#-project-structure)
- [Development](#-development)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)

## ✨ Features

- **Multi-service support**: AniList, MyAnimeList, and IMDB in one addon
- **All watch statuses**: Currently Watching, On Hold, Plan to Watch, Dropped, Completed, Rewatching
- **Rich metadata**: Poster images, descriptions, genre tags, ratings, release year, watch progress
- **Automatic progress sync**: After watching an episode for 5+ minutes in Stremio, your progress is updated on AniList or MAL automatically
- **Single-button OAuth**: Connect AniList and MAL with one click — no username typing required
- **Combined addon**: Install all configured services as a single Stremio addon
- **Self-hosted**: Your credentials stay on your server

## 📦 Prerequisites

- **Node.js** v14 or higher — [nodejs.org](https://nodejs.org/)
- **Stremio** — [stremio.com](https://www.stremio.com/)
- At least one of: an AniList account, a MAL account, or an IMDB account

## 🚀 Installation

### Automated (Linux/LXC — recommended)

Clone the repository and run the installer as root:

```bash
git clone <repository-url>
cd anilist-stremio-addon
sudo bash install.sh
```

Options:

```
-p, --port PORT   Port to run on (default: 3000)
-u, --user USER   System user to run the service as (default: addon)
-d, --dir DIR     Install directory (default: /opt/anilist-stremio)
```

The installer will:
1. Install Node.js LTS if not present
2. Create a dedicated system user
3. Copy files and install dependencies
4. Write a `.env` file
5. Create and start a `systemd` service (`anilist-stremio`)

To update an existing installation:

```bash
sudo bash update.sh
```

### Manual

```bash
git clone <repository-url>
cd anilist-stremio-addon
npm install
cp .env.example .env   # edit as needed
npm start
```

## ⚙️ Configuration

All configuration is done via environment variables in `.env`.

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | HTTP port for the server |
| `NODE_ENV` | No | `development` | `development` or `production` |
| `ANILIST_CLIENT_ID` | No* | — | AniList OAuth Client ID |
| `ANILIST_CLIENT_SECRET` | No* | — | AniList OAuth Client Secret |
| `MAL_CLIENT_ID` | No* | — | MAL API Client ID (enables MAL service) |
| `MAL_CLIENT_SECRET` | No* | — | MAL OAuth Client Secret (enables progress sync) |

\* Required only if you want to use that service.

### Setting Up OAuth Apps

OAuth is needed to enable the login buttons on the configure page and automatic progress updates.

#### AniList

1. Go to [AniList Developer Settings](https://anilist.co/settings/developer) → **Add Client**
2. Set the redirect URI to: `http://your-server:PORT/auth/anilist/callback`
3. Copy the **Client ID** and **Client Secret** into `.env`:
   ```env
   ANILIST_CLIENT_ID=your_client_id
   ANILIST_CLIENT_SECRET=your_client_secret
   ```

#### MyAnimeList

1. Go to [MAL API Config](https://myanimelist.net/apiconfig) → **Create ID**
2. Set **App Type** to `web` and the redirect URI to: `http://your-server:PORT/auth/mal/callback`
3. Copy the **Client ID** and **Client Secret** into `.env`:
   ```env
   MAL_CLIENT_ID=your_client_id
   MAL_CLIENT_SECRET=your_client_secret
   ```

> **Note**: If you only set `MAL_CLIENT_ID` (without the secret), the MAL catalog is available but the login button and progress sync are disabled.

Restart the service after editing `.env`:
```bash
systemctl restart anilist-stremio
```

## 📖 Usage

### Setting Up Your Addon URL

1. Open the configure page: `http://your-server:PORT/`
2. For **AniList**: click **Login with AniList** → authorise → your addon URL is shown automatically
3. For **MyAnimeList**: click **Connect to MyAnimeList** → authorise → your addon URL is shown automatically
4. For **IMDB**: enter your IMDB User ID (e.g. `ur12345678`) found in your [IMDB profile URL](https://www.imdb.com/user/)
5. Copy the URL or click **Open in Stremio** to install directly

If you use more than one service, an **Install in Stremio** button appears at the bottom to install all of them as a single combined addon.

### Episode Progress Sync

Once authenticated, the addon tracks what you play in Stremio. After the same episode has been open for **5 minutes**, your progress is updated on AniList or MAL. No manual action needed.

### Watch Statuses Available

Each service exposes all statuses as separate catalogs in Stremio:

- Currently Watching
- On Hold
- Plan to Watch
- Dropped
- Completed
- Rewatching

## 📁 Project Structure

```
anime-stremio-addon/
├── addon.js              # Stremio protocol — manifest, catalog, meta, stream handlers
├── index.js              # Express server, routes, and OAuth flows
├── package.json
├── install.sh            # Automated Linux installer
├── update.sh             # Automated updater
├── config/
│   ├── constants.js      # Manifest definitions, API URLs, catalog config
│   ├── env.js            # Environment variable loading and validation
│   └── tokens.js         # OAuth token storage and watch-session tracking
├── data/
│   └── tokens.json       # Persisted OAuth tokens (gitignored)
└── services/
    ├── anilist.js        # AniList GraphQL API integration
    ├── imdb.js           # IMDB watchlist integration
    └── mal.js            # MyAnimeList REST API integration
```

## 🛠️ Development

```bash
npm run dev   # starts nodemon for auto-restart on file changes
```

Set `NODE_ENV=development` in `.env` to enable per-request logging.

### Adding a new catalog status

1. Add the status mapping in `addon.js` (`ANILIST_STATUS_MAP` / `MAL_STATUS_MAP`)
2. Add the catalog entry in `config/constants.js`

### Adding a new service

1. Create `services/<service>.js` following the existing pattern
2. Add the manifest in `config/constants.js`
3. Wire up routes and handler calls in `index.js` and `addon.js`

## 🔧 Troubleshooting

### The MAL or AniList login button does nothing

Ensure the matching `*_CLIENT_ID` and `*_CLIENT_SECRET` env vars are set and the service has been restarted. The button only appears when both are configured.

### Progress updates are not syncing

- Confirm you completed OAuth (the configure page should show "✅ Authenticated")
- Progress is only sent after the same episode has been open for 5 minutes
- Check logs: `journalctl -u anilist-stremio -f`

### Redirect URI mismatch error during OAuth

The redirect URI registered in your OAuth app must exactly match the server address:
- AniList: `http://your-server:PORT/auth/anilist/callback`
- MAL: `http://your-server:PORT/auth/mal/callback`

### Service won't start

```bash
journalctl -u anilist-stremio -n 50
```

Common causes: invalid `PORT` value in `.env`, missing `data/` directory write permission.

### Debug logging

```env
NODE_ENV=development
```

This prints every incoming request and API call to the journal.

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📄 License

MIT