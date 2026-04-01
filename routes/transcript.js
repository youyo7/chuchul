const crypto = require('crypto');
const express = require('express');

const { getAuthPayload, getRequestContext } = require('../services/auth');
const { detectPlatform, isLikelyHttpUrl } = require('../services/platform');
const { getTranscriptCache, setTranscriptCache } = require('../services/store');
const { getWhisperTranscript, getYoutubeTranscript } = require('../services/transcript');
const { TRANSCRIPT_CACHE_TTL_HOURS, getTranscriptPolicy } = require('../services/transcriptPolicy');

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

  const policy = getTranscriptPolicy(platform, authContext.plan);
  if (!policy.available) {
    return res.status(403).json({
      error: policy.helperText,
      account: getAuthPayload(req),
      transcriptPolicy: policy,
    });
  }

  if (policy.mode === 'ai' && !String(process.env.OPENAI_API_KEY || '').trim()) {
    return res.status(503).json({
      error: 'OpenAI API 키를 설정하면 비YouTube 대본 추출을 사용할 수 있습니다.',
      account: getAuthPayload(req),
      transcriptPolicy: policy,
    });
  }

  try {
    const cacheKey = createTranscriptCacheKey(rawUrl, platform, policy.cacheScope);
    const cachedTranscript = getTranscriptCache(cacheKey, TRANSCRIPT_CACHE_TTL_HOURS);

    if (cachedTranscript) {
      return res.json({
        transcript: cachedTranscript.text,
        transcriptSrt: cachedTranscript.srt,
        transcriptLimited: Boolean(cachedTranscript.limited),
        transcriptNotice: cachedTranscript.notice,
        transcriptCached: true,
        transcriptPolicy: policy,
        account: getAuthPayload(req),
      });
    }

    const transcriptResult =
      policy.mode === 'youtube'
        ? await getYoutubeTranscript(rawUrl)
        : await getWhisperTranscript(rawUrl, {
            maxSeconds: policy.maxSeconds,
            baseNotice: policy.notice,
          });

    setTranscriptCache(cacheKey, transcriptResult);

    return res.json({
      transcript: transcriptResult.text || '',
      transcriptSrt: transcriptResult.srt || '',
      transcriptLimited: Boolean(transcriptResult.limited),
      transcriptNotice: transcriptResult.notice || '',
      transcriptCached: false,
      transcriptPolicy: policy,
      account: getAuthPayload(req),
    });
  } catch (error) {
    console.error('Transcript route error:', error.message);
    return res.status(500).json({
      error: '대본을 가져오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      account: getAuthPayload(req),
      transcriptPolicy: policy,
    });
  }
});

function createTranscriptCacheKey(url, platform, scope) {
  return crypto.createHash('sha1').update(`${platform}|${scope}|${url}`).digest('hex');
}

module.exports = router;
