function detectPlatform(url) {
  const normalized = String(url || '').toLowerCase();

  if (/youtube\.com|youtu\.be/.test(normalized)) return 'youtube';
  if (/tiktok\.com/.test(normalized)) return 'tiktok';
  if (/instagram\.com/.test(normalized)) return 'instagram';
  if (/douyin\.com/.test(normalized)) return 'douyin';
  if (/xiaohongshu\.com|xhslink\.com/.test(normalized)) return 'xiaohongshu';
  if (/(^|\/)(twitter\.com|x\.com)/.test(normalized) || /twitter\.com|x\.com/.test(normalized)) return 'twitter';
  if (/facebook\.com|fb\.watch/.test(normalized)) return 'facebook';
  if (/bilibili\.com/.test(normalized)) return 'bilibili';
  return 'unknown';
}

function getYoutubeId(url) {
  try {
    const parsed = new URL(url);

    if (parsed.hostname.includes('youtu.be')) {
      const candidate = parsed.pathname.split('/').filter(Boolean)[0];
      return isYoutubeId(candidate) ? candidate : null;
    }

    const v = parsed.searchParams.get('v');
    if (isYoutubeId(v)) {
      return v;
    }

    const parts = parsed.pathname.split('/').filter(Boolean);
    const embedIdx = parts.findIndex((part) => ['embed', 'shorts', 'live'].includes(part));
    if (embedIdx !== -1 && isYoutubeId(parts[embedIdx + 1])) {
      return parts[embedIdx + 1];
    }
  } catch {
    return null;
  }

  return null;
}

function isLikelyHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isYoutubeId(value) {
  return /^[a-zA-Z0-9_-]{11}$/.test(value || '');
}

module.exports = { detectPlatform, getYoutubeId, isLikelyHttpUrl };
