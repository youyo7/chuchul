const express = require('express');
const fs = require('fs');
const path = require('path');

const { downloadFile } = require('../services/ytdlp');

const router = express.Router();

router.post('/', async (req, res) => {
  const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  const formatId = typeof req.body?.formatId === 'string' ? req.body.formatId : '';
  const quality = typeof req.body?.quality === 'string' ? req.body.quality : '';
  const ext = typeof req.body?.ext === 'string' ? req.body.ext : '';
  const title = typeof req.body?.title === 'string' ? req.body.title : 'video';

  if (!rawUrl) {
    return res.status(400).json({ error: '다운로드할 링크 정보가 없습니다.' });
  }

  if (!formatId) {
    return res.status(400).json({ error: '다운로드 형식을 선택해주세요.' });
  }

  try {
    const { filePath, filename } = await downloadFile(rawUrl, formatId, ext, quality);
    const finalExt = path.extname(filename).replace('.', '') || ext || 'bin';
    const safeTitle = sanitizeFilename(title);
    const downloadName = `${safeTitle}.${finalExt}`;

    res.setHeader('Content-Type', getContentType(finalExt));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(downloadName)}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`
    );

    const stream = fs.createReadStream(filePath);
    let deleted = false;

    const cleanup = () => {
      if (deleted) {
        return;
      }

      deleted = true;
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        console.warn(`Failed to delete temp file ${filePath}: ${error.message}`);
      }
    };

    stream.on('error', () => {
      cleanup();
      if (!res.headersSent) {
        res.status(500).json({ error: '파일 전송 중 오류가 발생했습니다.' });
      } else {
        res.destroy();
      }
    });

    res.on('finish', cleanup);
    res.on('close', cleanup);

    stream.pipe(res);
  } catch (error) {
    console.error('Download route error:', error.message);
    return res.status(500).json({
      error: '다운로드를 준비하지 못했습니다. 잠시 후 다시 시도해주세요.',
    });
  }
});

function sanitizeFilename(input) {
  return (input || 'video')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'video';
}

function getContentType(ext) {
  const types = {
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    m4a: 'audio/mp4',
    webm: 'video/webm',
  };

  return types[ext.toLowerCase()] || 'application/octet-stream';
}

module.exports = router;
