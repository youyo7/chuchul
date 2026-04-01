const express = require('express');

const { consumeQuota, getAuthPayload, getLimitExceededMessage, getRequestContext } = require('../services/auth');
const { detectPlatform, getYoutubeId, isLikelyHttpUrl } = require('../services/platform');
const { getTranscriptPolicy } = require('../services/transcriptPolicy');
const { getVideoInfo, parseFormats } = require('../services/ytdlp');

const router = express.Router();

router.post('/', async (req, res) => {
  const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  const authContext = getRequestContext(req);

  if (!rawUrl) {
    return res.status(400).json({ error: '영상 링크를 입력해주세요.' });
  }

  if (!isLikelyHttpUrl(rawUrl)) {
    return res.status(400).json({ error: '올바른 링크 형식인지 다시 확인해주세요.' });
  }

  const platform = detectPlatform(rawUrl);
  if (platform === 'unknown') {
    return res.status(400).json({ error: '현재 지원하지 않는 플랫폼입니다.' });
  }

  const quotaCheck = consumeQuota(authContext);
  if (!quotaCheck.allowed) {
    return res.status(429).json({
      error: getLimitExceededMessage(quotaCheck.quota),
      account: {
        ...getAuthPayload(req),
        quota: quotaCheck.quota,
      },
    });
  }

  try {
    const info = await getVideoInfo(rawUrl);
    const formats = parseFormats(info);
    const youtubeId = platform === 'youtube' ? getYoutubeId(rawUrl) : null;
    const transcriptPolicy = getTranscriptPolicy(platform, authContext.plan);

    return res.json({
      platform,
      title: info.title || '제목 없음',
      thumbnail: info.thumbnail || '',
      duration: Number.isFinite(info.duration) ? info.duration : 0,
      uploader: info.uploader || '',
      formats,
      transcript: '',
      transcriptSrt: '',
      transcriptLimited: false,
      transcriptNotice: '',
      transcriptPolicy,
      embedUrl: youtubeId ? `https://www.youtube.com/embed/${youtubeId}` : null,
      originalUrl: rawUrl,
      account: {
        ...getAuthPayload(req),
        quota: quotaCheck.quota,
      },
    });
  } catch (error) {
    console.error('Extract route error:', error.message);
    return res.status(500).json({
      error: '영상 정보를 가져오지 못했습니다. 링크가 공개 상태인지 다시 확인해주세요.',
    });
  }
});

module.exports = router;
