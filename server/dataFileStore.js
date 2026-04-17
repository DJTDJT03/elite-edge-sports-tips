/**
 * Elite Edge Sports Tips — JSON File Store (Fallback)
 *
 * This is the original file-based storage layer. Used as fallback when
 * DATABASE_URL is not configured (local development without Postgres).
 *
 * In production, the database layer (db.js) is the primary store.
 */

const fs = require('fs');
const path = require('path');

const PERSISTENT_DIR = process.env.PERSISTENT_DATA_DIR || '/data';
const BUNDLED_DIR = path.join(__dirname, 'data');
const usePersistent = (() => {
  try {
    fs.mkdirSync(PERSISTENT_DIR, { recursive: true });
    fs.accessSync(PERSISTENT_DIR, fs.constants.W_OK);
    return true;
  } catch { return false; }
})();
const dataDir = usePersistent ? PERSISTENT_DIR : BUNDLED_DIR;

// On first run with persistent volume, copy bundled data into the volume
if (usePersistent) {
  try {
    const bundledFiles = fs.readdirSync(BUNDLED_DIR);
    bundledFiles.forEach(file => {
      const persistentPath = path.join(PERSISTENT_DIR, file);
      if (!fs.existsSync(persistentPath)) {
        fs.copyFileSync(path.join(BUNDLED_DIR, file), persistentPath);
        console.log('[FileStore] Seeded ' + file + ' into persistent volume');
      }
    });
  } catch (err) {
    console.error('[FileStore] Failed to seed persistent volume:', err.message);
  }
}

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
  } catch { return []; }
}

function writeJSON(file, data) {
  fs.writeFileSync(path.join(dataDir, file), JSON.stringify(data, null, 2));
}

module.exports = { readJSON, writeJSON, dataDir, BUNDLED_DIR };
