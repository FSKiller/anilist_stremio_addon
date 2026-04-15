const express = require("express");
const axios = require("axios");
const addonInterface = require("./addon");

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  next();
});

// Serve addon manifest
app.get("/manifest.json", (req, res) => {
  res.json(addonInterface.manifest);
});

// Serve catalog
app.get("/catalog/:type/:id/:extra?.json", async (req, res) => {
  try {
    const { type, id, extra } = req.params;
    const catalog = await addonInterface.getCatalog(type, id, extra);
    res.json(catalog);
  } catch (error) {
    console.error("Catalog error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Serve meta
app.get("/meta/:type/:id.json", async (req, res) => {
  try {
    const { type, id } = req.params;
    const meta = await addonInterface.getMeta(type, id);
    res.json(meta);
  } catch (error) {
    console.error("Meta error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Stremio AniList Extension listening on port ${PORT}`);
  console.log(`Add to Stremio: http://localhost:${PORT}/manifest.json`);
});
