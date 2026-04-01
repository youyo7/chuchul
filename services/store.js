const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const STATE_FILE = path.join(DATA_DIR, 'app-state.json');
const EMPTY_STATE = {
  users: {},
  googleIndex: {},
  sessions: {},
  usage: {},
  transcripts: {},
};

ensureStateFile();

function upsertGoogleUser(profile, plan = 'free') {
  const state = readState();
  const now = new Date().toISOString();

  let userId = state.googleIndex[profile.googleSub];
  let user = userId ? state.users[userId] : null;

  if (!user) {
    userId = crypto.randomUUID();
    user = {
      id: userId,
      googleSub: profile.googleSub,
      email: profile.email,
      name: profile.name,
      picture: profile.picture || '',
      plan,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    };

    state.users[userId] = user;
    state.googleIndex[profile.googleSub] = userId;
  } else {
    user.email = profile.email;
    user.name = profile.name;
    user.picture = profile.picture || '';
    user.plan = plan;
    user.updatedAt = now;
    user.lastLoginAt = now;
  }

  writeState(state);
  return { ...user };
}

function createSession(userId, ttlDays = 30) {
  const state = readState();
  const token = crypto.randomUUID();
  const now = Date.now();

  purgeExpiredSessions(state, now);
  state.sessions[token] = {
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlDays * 24 * 60 * 60 * 1000).toISOString(),
  };

  writeState(state);
  return token;
}

function getUserBySessionToken(token) {
  if (!token) {
    return null;
  }

  const state = readState();
  const now = Date.now();
  const purged = purgeExpiredSessions(state, now);
  const session = state.sessions[token];

  if (!session) {
    if (purged) {
      writeState(state);
    }
    return null;
  }

  const user = state.users[session.userId];
  if (!user) {
    delete state.sessions[token];
    writeState(state);
    return null;
  }

  if (purged) {
    writeState(state);
  }

  return { ...user };
}

function destroySession(token) {
  if (!token) {
    return;
  }

  const state = readState();
  if (state.sessions[token]) {
    delete state.sessions[token];
    writeState(state);
  }
}

function getUsageCount(subjectKey, dateKey) {
  const state = readState();
  return Number(state.usage[`${subjectKey}:${dateKey}`]?.count || 0);
}

function incrementUsage(subjectKey, dateKey) {
  const state = readState();
  const key = `${subjectKey}:${dateKey}`;
  const current = state.usage[key] || { count: 0 };
  current.count += 1;
  current.updatedAt = new Date().toISOString();
  state.usage[key] = current;
  writeState(state);
  return current.count;
}

function getTranscriptCache(cacheKey, ttlHours = 168) {
  if (!cacheKey) {
    return null;
  }

  const state = readState();
  const entry = state.transcripts[cacheKey];
  if (!entry) {
    return null;
  }

  const maxAgeMs = Math.max(Number(ttlHours) || 0, 0) * 60 * 60 * 1000;
  const updatedAt = new Date(entry.updatedAt || entry.createdAt || 0).getTime();

  if (maxAgeMs > 0 && (!updatedAt || Date.now() - updatedAt > maxAgeMs)) {
    delete state.transcripts[cacheKey];
    writeState(state);
    return null;
  }

  return {
    text: entry.text || '',
    srt: entry.srt || '',
    limited: Boolean(entry.limited),
    notice: entry.notice || '',
    cachedAt: entry.updatedAt || entry.createdAt || '',
  };
}

function setTranscriptCache(cacheKey, payload) {
  if (!cacheKey) {
    return;
  }

  const state = readState();
  const now = new Date().toISOString();

  state.transcripts[cacheKey] = {
    text: payload?.text || '',
    srt: payload?.srt || '',
    limited: Boolean(payload?.limited),
    notice: payload?.notice || '',
    createdAt: state.transcripts[cacheKey]?.createdAt || now,
    updatedAt: now,
  };

  writeState(state);
}

function ensureStateFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(EMPTY_STATE, null, 2), 'utf8');
  }
}

function readState() {
  ensureStateFile();

  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return {
      users: parsed.users || {},
      googleIndex: parsed.googleIndex || {},
      sessions: parsed.sessions || {},
      usage: parsed.usage || {},
      transcripts: parsed.transcripts || {},
    };
  } catch {
    return structuredClone(EMPTY_STATE);
  }
}

function writeState(state) {
  ensureStateFile();
  const tempFile = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tempFile, STATE_FILE);
}

function purgeExpiredSessions(state, now = Date.now()) {
  let changed = false;

  for (const [token, session] of Object.entries(state.sessions)) {
    if (!session?.expiresAt || new Date(session.expiresAt).getTime() <= now) {
      delete state.sessions[token];
      changed = true;
    }
  }

  return changed;
}

module.exports = {
  createSession,
  destroySession,
  getTranscriptCache,
  getUsageCount,
  getUserBySessionToken,
  incrementUsage,
  setTranscriptCache,
  upsertGoogleUser,
};
