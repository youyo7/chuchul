const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');

const {
  createSession,
  destroySession,
  getUsageCount,
  getUserBySessionToken,
  incrementUsage,
  upsertGoogleUser,
} = require('./store');

const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || '').trim();
const SESSION_TTL_DAYS = Number.parseInt(process.env.SESSION_TTL_DAYS, 10) || 30;
const LIMITS = {
  guest: 2,
  free: 10,
  pro: 50,
};
const DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const oauthClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

function getAuthPayload(req) {
  const context = getRequestContext(req);
  return {
    googleLoginEnabled: Boolean(GOOGLE_CLIENT_ID),
    googleClientId: GOOGLE_CLIENT_ID,
    user: context.type === 'user' ? getPublicUser(context.user) : null,
    quota: getQuotaSnapshot(context),
    limits: LIMITS,
  };
}

function getRequestContext(req) {
  const token = getBearerToken(req.headers.authorization);
  if (token) {
    const user = getUserBySessionToken(token);
    if (user) {
      const plan = resolvePlan(user.email, user.plan);
      return {
        type: 'user',
        token,
        user: { ...user, plan },
        subjectKey: `user:${user.id}`,
        plan,
      };
    }
  }

  const guestId = getGuestId(req);
  return {
    type: 'guest',
    guestId,
    subjectKey: `guest:${guestId}`,
    plan: 'guest',
  };
}

function getQuotaSnapshot(context) {
  const dateKey = getDateKey();
  const limit = LIMITS[context.plan] || LIMITS.guest;
  const used = getUsageCount(context.subjectKey, dateKey);
  return formatQuota(context.plan, dateKey, used, limit);
}

function consumeQuota(context) {
  const dateKey = getDateKey();
  const limit = LIMITS[context.plan] || LIMITS.guest;
  const used = getUsageCount(context.subjectKey, dateKey);

  if (used >= limit) {
    return {
      allowed: false,
      quota: formatQuota(context.plan, dateKey, used, limit),
    };
  }

  const updatedUsed = incrementUsage(context.subjectKey, dateKey);
  return {
    allowed: true,
    quota: formatQuota(context.plan, dateKey, updatedUsed, limit),
  };
}

async function signInWithGoogle(credential) {
  if (!oauthClient) {
    throw new Error('Google 로그인이 아직 설정되지 않았습니다.');
  }

  if (!credential) {
    throw new Error('Google 인증 정보가 없습니다.');
  }

  const ticket = await oauthClient.verifyIdToken({
    idToken: credential,
    audience: GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();

  if (!payload?.sub || !payload?.email) {
    throw new Error('Google 사용자 정보를 확인할 수 없습니다.');
  }

  if (!payload.email_verified) {
    throw new Error('이메일 인증이 완료된 Google 계정만 사용할 수 있습니다.');
  }

  const plan = resolvePlan(payload.email, 'free');
  const user = upsertGoogleUser(
    {
      googleSub: payload.sub,
      email: payload.email,
      name: payload.name || payload.email,
      picture: payload.picture || '',
    },
    plan
  );
  const token = createSession(user.id, SESSION_TTL_DAYS);
  const context = {
    type: 'user',
    token,
    user: { ...user, plan },
    subjectKey: `user:${user.id}`,
    plan,
  };

  return {
    token,
    user: getPublicUser(context.user),
    quota: getQuotaSnapshot(context),
  };
}

function logout(token) {
  destroySession(token);
}

function getLimitExceededMessage(quota) {
  if (quota.plan === 'guest') {
    return '비로그인은 하루 2회까지 가능합니다. Google 로그인하면 하루 5회, PRO는 하루 50회까지 사용할 수 있습니다.';
  }

  if (quota.plan === 'free') {
    return 'Google 로그인 사용자는 하루 10회까지 가능합니다. PRO로 업그레이드하면 하루 50회까지 사용할 수 있습니다.';
  }

  return '오늘 사용할 수 있는 추출 횟수를 모두 사용했습니다. 내일 다시 시도해주세요.';
}

function getGuestId(req) {
  const raw = sanitizeGuestId(req.headers['x-guest-id']);
  if (raw) {
    return raw;
  }

  return `ip-${hashValue(req.ip || req.socket?.remoteAddress || 'guest')}`;
}

function getBearerToken(header) {
  if (typeof header !== 'string') {
    return '';
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function resolvePlan(email, currentPlan) {
  const proEmails = new Set(
    String(process.env.PRO_GOOGLE_EMAILS || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );

  if (email && proEmails.has(String(email).toLowerCase())) {
    return 'pro';
  }

  return currentPlan === 'pro' ? 'pro' : 'free';
}

function getDateKey() {
  const parts = DATE_FORMATTER.formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

function formatQuota(plan, dateKey, used, limit) {
  return {
    plan,
    planLabel: plan === 'guest' ? '비로그인' : plan === 'pro' ? 'PRO' : 'Google 로그인',
    dateKey,
    used,
    limit,
    remaining: Math.max(limit - used, 0),
  };
}

function getPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture || '',
    plan: user.plan,
    planLabel: user.plan === 'pro' ? 'PRO' : 'Google 로그인',
  };
}

function sanitizeGuestId(value) {
  return String(value || '').trim().match(/^[a-zA-Z0-9_-]{8,120}$/)?.[0] || '';
}

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 18);
}

module.exports = {
  LIMITS,
  consumeQuota,
  getAuthPayload,
  getLimitExceededMessage,
  getRequestContext,
  logout,
  signInWithGoogle,
};
