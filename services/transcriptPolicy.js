const FREE_TRANSCRIPT_MAX_SECONDS = Number.parseInt(process.env.FREE_TRANSCRIPT_MAX_SECONDS, 10) || 300;
const PRO_TRANSCRIPT_MAX_SECONDS = Number.parseInt(process.env.PRO_TRANSCRIPT_MAX_SECONDS, 10) || 1800;
const TRANSCRIPT_CACHE_TTL_HOURS = Number.parseInt(process.env.TRANSCRIPT_CACHE_TTL_HOURS, 10) || 168;

function getTranscriptPolicy(platform, plan) {
  if (platform === 'youtube') {
    return {
      mode: 'youtube',
      available: true,
      requiresLogin: false,
      maxSeconds: 0,
      cacheScope: 'youtube',
      buttonLabel: '자막 불러오기',
      helperText: 'YouTube 자막은 필요할 때만 불러옵니다.',
      notice: '',
    };
  }

  if (plan === 'guest') {
    return {
      mode: 'ai',
      available: false,
      requiresLogin: true,
      maxSeconds: 0,
      cacheScope: 'guest-locked',
      buttonLabel: 'Google 로그인 후 대본 추출',
      helperText: '비YouTube 대본은 Google 로그인 후 사용할 수 있습니다.',
      notice: '비YouTube 대본은 비용 절감을 위해 로그인 사용자부터 제공합니다.',
    };
  }

  if (plan === 'pro') {
    return {
      mode: 'ai',
      available: true,
      requiresLogin: false,
      maxSeconds: PRO_TRANSCRIPT_MAX_SECONDS,
      cacheScope: `pro-${PRO_TRANSCRIPT_MAX_SECONDS}`,
      buttonLabel: 'AI 대본 추출',
      helperText: `PRO 사용자는 비YouTube 대본을 최대 ${formatSecondsLabel(PRO_TRANSCRIPT_MAX_SECONDS)}까지 추출할 수 있습니다.`,
      notice:
        PRO_TRANSCRIPT_MAX_SECONDS > 0
          ? `PRO는 비YouTube 대본을 최대 ${formatSecondsLabel(PRO_TRANSCRIPT_MAX_SECONDS)}까지 제공합니다. 더 긴 영상은 앞부분까지만 제공됩니다.`
          : '',
    };
  }

  return {
    mode: 'ai',
    available: true,
    requiresLogin: false,
    maxSeconds: FREE_TRANSCRIPT_MAX_SECONDS,
    cacheScope: `free-${FREE_TRANSCRIPT_MAX_SECONDS}`,
    buttonLabel: 'AI 대본 추출',
    helperText: `Google 로그인 사용자는 비YouTube 대본을 최대 ${formatSecondsLabel(FREE_TRANSCRIPT_MAX_SECONDS)}까지 추출할 수 있습니다.`,
    notice: `Google 로그인 사용자는 비YouTube 대본을 최대 ${formatSecondsLabel(FREE_TRANSCRIPT_MAX_SECONDS)}까지 제공합니다. 더 긴 영상은 앞부분까지만 제공됩니다.`,
  };
}

function formatSecondsLabel(seconds) {
  const safeSeconds = Math.max(Number(seconds) || 0, 0);
  const minutes = Math.floor(safeSeconds / 60);

  if (minutes < 60) {
    return `${minutes}분`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}시간 ${remainingMinutes}분` : `${hours}시간`;
}

module.exports = {
  FREE_TRANSCRIPT_MAX_SECONDS,
  PRO_TRANSCRIPT_MAX_SECONDS,
  TRANSCRIPT_CACHE_TTL_HOURS,
  formatSecondsLabel,
  getTranscriptPolicy,
};
