require('dotenv').config();

const cors = require('cors');
const express = require('express');
const fs = require('fs');
const path = require('path');

const authRoute = require('./routes/auth');
const extractRoute = require('./routes/extract');
const downloadRoute = require('./routes/download');
const transcriptRoute = require('./routes/transcript');

const app = express();
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;
const TEMP_DIR = path.resolve(process.env.TEMP_DIR || './temp');
const FILE_TTL_MINUTES = Number.parseInt(process.env.FILE_TTL_MINUTES, 10) || 60;
const FILE_TTL_MS = FILE_TTL_MINUTES * 60 * 1000;

ensureTempDir();

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoute);
app.use('/api/extract', extractRoute);
app.use('/api/download', downloadRoute);
app.use('/api/transcript', transcriptRoute);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/result', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'result.html'));
});

app.use((req, res) => {
  res.status(404).json({ error: '요청하신 경로를 찾을 수 없습니다.' });
});

const cleanupTimer = setInterval(cleanupExpiredFiles, FILE_TTL_MS);
cleanupTimer.unref();

app.listen(PORT, () => {
  console.log(`chuchul server running at http://localhost:${PORT}`);
});

function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
}

function cleanupExpiredFiles() {
  ensureTempDir();

  try {
    const now = Date.now();
    const entries = fs.readdirSync(TEMP_DIR);

    for (const entry of entries) {
      const filePath = path.join(TEMP_DIR, entry);
      let stat;

      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }

      if (!stat.isFile()) {
        continue;
      }

      if (now - stat.mtimeMs > FILE_TTL_MS) {
        try {
          fs.unlinkSync(filePath);
        } catch (error) {
          console.warn(`Failed to remove expired file ${filePath}: ${error.message}`);
        }
      }
    }
  } catch (error) {
    console.warn(`Temp cleanup skipped: ${error.message}`);
  }
}
