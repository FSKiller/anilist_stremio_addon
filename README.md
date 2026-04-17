# AniList Stremio Addon

A Stremio addon that automatically syncs your AniList "Currently Watching" anime to your Stremio library, providing seamless integration between your AniList account and Stremio.

## 📋 Table of Contents

- [Features](#-features)
- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Usage](#-usage)
- [Project Structure](#-project-structure)
- [Development](#-development)
- [Troubleshooting](#-troubleshooting)
- [API Documentation](#-api-documentation)
- [Contributing](#-contributing)
- [License](#-license)

## ✨ Features

- **Automatic Sync**: Fetches all anime from your AniList "Currently Watching" status
- **Rich Metadata**: Displays comprehensive anime information including:
  - High-quality poster images
  - Detailed descriptions
  - Genre tags
  - Ratings (converted from AniList scores)
  - Release year
  - Watch progress
- **Real-time Updates**: Catalog refreshes each time you open it in Stremio
- **Error Handling**: Robust error handling with helpful error messages
- **Easy Setup**: Simple configuration via environment variables

## 📦 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v14 or higher) - [Download here](https://nodejs.org/)
- **npm** (comes with Node.js)
- **AniList Account** - [Create one here](https://anilist.co/)
- **Stremio** - [Download here](https://www.stremio.com/)

### AniList Requirements

- Your AniList profile must be **publicly visible**
- You should have at least one anime in your "Currently Watching" list

## 🚀 Installation

### 1. Clone or Download the Repository

```bash
git clone <repository-url>
cd anilist-stremio-addon
```

### 2. Install Dependencies

```bash
npm install
```

This will install all required packages:
- `express` - Web server framework
- `axios` - HTTP client for API requests
- `dotenv` - Environment variable management

### 3. Configure Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Edit the `.env` file with your settings:

```env
# Your AniList username (required)
ANILIST_USERNAME=your_anilist_username

# Server port (optional, defaults to 3000)
PORT=3000

# Node environment (optional, defaults to development)
NODE_ENV=development
```

**Important**: Replace `your_anilist_username` with your actual AniList username.

### 4. Start the Server

For production:
```bash
npm start
```

For development (with auto-restart on file changes):
```bash
npm run dev
```

You should see output similar to:

```
============================================================
🚀 Stremio AniList Addon Server Started
============================================================
📡 Server listening on port 3000
👤 AniList user: your_username
🌍 Environment: development

📦 Installation URL:
   http://localhost:3000/manifest.json

📖 Instructions:
   1. Open Stremio
   2. Go to Settings → Addons
   3. Click "Install from URL"
   4. Paste the installation URL above
   5. Click "Install"
============================================================
```

### 5. Install in Stremio

1. Open **Stremio** application
2. Navigate to **Settings** → **Addons**
3. Click **"Install from URL"** (or the "+" button)
4. Enter: `http://localhost:3000/manifest.json`
5. Click **"Install"**

The addon should now appear in your installed addons list!

## ⚙️ Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANILIST_USERNAME` | Yes | - | Your AniList username (must be publicly visible) |
| `PORT` | No | `3000` | Port number for the server |
| `NODE_ENV` | No | `development` | Environment mode (`development` or `production`) |

### Configuration Files

The project uses a modular configuration system:

- **`config/constants.js`**: Application constants and default values
- **`config/env.js`**: Environment variable loading and validation

## 📖 Usage

### Viewing Your Anime

1. Open Stremio
2. Navigate to the **"Discover"** section
3. Look for **"AniList - Currently Watching"** catalog
4. Browse your currently watching anime

### Updating Your List

The addon fetches fresh data from AniList each time you open the catalog in Stremio. To see updates:

1. Update your anime list on AniList
2. Refresh the catalog in Stremio (close and reopen it)

### Watch Progress

Anime that you've started watching (progress > 0) will be marked as "watched" in Stremio.

## 📁 Project Structure

```
anilist-stremio-addon/
├── config/
│   ├── constants.js      # Application constants and configuration
│   └── env.js            # Environment variable validation
├── services/
│   └── anilist.js        # AniList API integration
├── addon.js              # Stremio addon interface
├── index.js              # Express server and routes
├── package.json          # Project dependencies
├── .env.example          # Example environment configuration
└── README.md             # This file
```

### Key Components

- **`index.js`**: Main server file that handles HTTP requests from Stremio
- **`addon.js`**: Defines the addon manifest and request handlers
- **`services/anilist.js`**: Handles all AniList API interactions
- **`config/constants.js`**: Centralized configuration constants
- **`config/env.js`**: Environment variable validation and loading

## 🛠️ Development

### Running in Development Mode

```bash
npm run dev
```

This uses `nodemon` to automatically restart the server when files change.

### Code Structure

The codebase follows these principles:

- **Modular Design**: Separated concerns (server, addon logic, API service)
- **Comprehensive Documentation**: JSDoc comments on all functions
- **Error Handling**: Robust error handling with helpful messages
- **Configuration Management**: Centralized constants and environment validation

### Adding New Features

1. **New Catalogs**: Add to `CATALOGS` in `config/constants.js`
2. **New API Calls**: Add functions to `services/anilist.js`
3. **New Routes**: Add to `index.js` following existing patterns

## 🔧 Troubleshooting

### Common Issues

#### "Missing required environment variable: ANILIST_USERNAME"

**Solution**: Create a `.env` file with your AniList username:
```env
ANILIST_USERNAME=your_username
```

#### "AniList user not found"

**Possible causes**:
- Username is misspelled
- AniList profile is set to private

**Solution**: 
1. Verify your username on [AniList.co](https://anilist.co/)
2. Ensure your profile is public in AniList settings

#### "No currently watching anime found"

**Possible causes**:
- You don't have any anime marked as "Currently Watching"
- Your list is private

**Solution**: 
1. Add anime to your "Currently Watching" list on AniList
2. Make sure your anime list is publicly visible

#### "Unable to connect to AniList API"

**Possible causes**:
- No internet connection
- AniList API is down
- Firewall blocking requests

**Solution**: 
1. Check your internet connection
2. Visit [AniList.co](https://anilist.co/) to verify the site is accessible
3. Check firewall settings

#### Addon not appearing in Stremio

**Solution**:
1. Ensure the server is running (check terminal output)
2. Verify the URL is correct: `http://localhost:3000/manifest.json`
3. Try restarting Stremio
4. Check if port 3000 is available (or change PORT in `.env`)

### Debug Mode

For detailed logging, ensure `NODE_ENV=development` in your `.env` file. This enables:
- Request logging
- Detailed error messages
- API call logging

### Getting Help

If you encounter issues:

1. Check the server console output for error messages
2. Verify your `.env` configuration
3. Ensure your AniList profile is public
4. Check the [Troubleshooting](#-troubleshooting) section above

## 📚 API Documentation

### Endpoints

#### GET /manifest.json

Returns the addon manifest.

**Response:**
```json
{
  "id": "community.anilist-stremio",
  "version": "1.0.0",
  "name": "AniList Sync",
  "description": "Syncs your AniList Currently Watching anime to Stremio library",
  "types": ["anime"],
  "catalogs": [...],
  "resources": ["catalog", "meta"]
}
```

#### GET /catalog/:type/:id.json

Returns catalog content.

**Parameters:**
- `type`: Content type (e.g., "anime")
- `id`: Catalog ID (e.g., "anilist.watching")

**Response:**
```json
{
  "metas": [
    {
      "id": "anilist:12345",
      "type": "anime",
      "name": "Attack on Titan",
      "poster": "https://...",
      "description": "...",
      "genres": ["Action", "Drama"],
      "imdbRating": "8.5",
      "year": 2013
    }
  ]
}
```

#### GET /meta/:type/:id.json

Returns detailed metadata for a specific item.

**Parameters:**
- `type`: Content type (e.g., "anime")
- `id`: Content ID (e.g., "anilist:12345")

**Response:**
```json
{
  "meta": {
    "id": "anilist:12345",
    "type": "anime",
    "name": "Attack on Titan",
    ...
  }
}
```

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Style

- Use JSDoc comments for all functions
- Follow existing code structure and patterns
- Add error handling for new features
- Update documentation for significant changes

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- [AniList](https://anilist.co/) for providing the GraphQL API
- [Stremio](https://www.stremio.com/) for the addon platform
- The open-source community for inspiration and tools

---

**Note**: This addon requires the server to be running while using it in Stremio. For persistent usage, consider deploying to a cloud service like Heroku, Railway, or DigitalOcean.
