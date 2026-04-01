(function attachChuchulAuth() {
  const TOKEN_KEY = 'chuchul_auth_token';
  const GUEST_KEY = 'chuchul_guest_id';
  const state = {
    guestId: ensureGuestId(),
    token: window.localStorage.getItem(TOKEN_KEY) || '',
    payload: null,
    googlePromise: null,
    googleInitialized: false,
  };

  const refs = {};

  window.chuchulAuth = {
    applyAccountState,
    getRequestHeaders,
    refreshAuth: fetchMe,
  };

  document.addEventListener('DOMContentLoaded', () => {
    cacheRefs();
    bindEvents();
    fetchMe();
  });

  function cacheRefs() {
    refs.quotaBadge = document.getElementById('quotaBadge');
    refs.authName = document.getElementById('authName');
    refs.authMeta = document.getElementById('authMeta');
    refs.authAvatar = document.getElementById('authAvatar');
    refs.googleAuthButton = document.getElementById('googleAuthButton');
    refs.logoutBtn = document.getElementById('logoutBtn');
  }

  function bindEvents() {
    refs.logoutBtn?.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: getRequestHeaders(),
        });
      } catch {}

      state.token = '';
      window.localStorage.removeItem(TOKEN_KEY);
      await fetchMe();
    });
  }

  function getRequestHeaders() {
    const headers = {
      'X-Guest-Id': state.guestId,
    };

    if (state.token) {
      headers.Authorization = `Bearer ${state.token}`;
    }

    return headers;
  }

  async function fetchMe() {
    try {
      const response = await fetch('/api/auth/me', {
        headers: getRequestHeaders(),
      });
      const data = await response.json();
      state.payload = data;
      render();
      return data;
    } catch {
      return null;
    }
  }

  function applyAccountState(account) {
    if (!account) {
      return;
    }

    state.payload = {
      ...(state.payload || {}),
      ...account,
      user: account.user ?? state.payload?.user ?? null,
      quota: account.quota || state.payload?.quota,
    };
    render();
  }

  function render() {
    const payload = state.payload;
    const quota = payload?.quota;
    const user = payload?.user;

    if (refs.quotaBadge && quota) {
      refs.quotaBadge.textContent = `${quota.planLabel} · 오늘 ${quota.remaining}회 남음`;
    }

    if (user) {
      if (refs.authName) {
        refs.authName.textContent = user.name || user.email;
      }

      if (refs.authMeta && quota) {
        refs.authMeta.textContent = `${user.planLabel} · 오늘 ${quota.used}/${quota.limit}회 사용`;
      }

      if (refs.authAvatar) {
        if (user.picture) {
          refs.authAvatar.src = user.picture;
          refs.authAvatar.hidden = false;
        } else {
          refs.authAvatar.hidden = true;
        }
      }

      if (refs.logoutBtn) {
        refs.logoutBtn.hidden = false;
      }

      if (refs.googleAuthButton) {
        refs.googleAuthButton.innerHTML = '';
      }

      return;
    }

    if (refs.authName) {
      refs.authName.textContent = '비로그인';
    }

    if (refs.authMeta) {
      refs.authMeta.textContent = '하루 2회 · Google 로그인 10회 · PRO 50회';
    }

    if (refs.authAvatar) {
      refs.authAvatar.hidden = true;
    }

    if (refs.logoutBtn) {
      refs.logoutBtn.hidden = true;
    }

    if (payload?.googleLoginEnabled) {
      renderGoogleButton(payload.googleClientId);
      return;
    }

    if (refs.googleAuthButton) {
      refs.googleAuthButton.innerHTML = '<span class="auth-placeholder">Google 로그인 설정 필요</span>';
    }
  }

  async function renderGoogleButton(clientId) {
    if (!refs.googleAuthButton || !clientId) {
      return;
    }

    const googleApi = await ensureGoogleScript();
    if (!googleApi) {
      refs.googleAuthButton.innerHTML = '<span class="auth-placeholder">Google 로그인 로드 실패</span>';
      return;
    }

    refs.googleAuthButton.innerHTML = '';

    if (!state.googleInitialized) {
      googleApi.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleCredential,
      });
      state.googleInitialized = true;
    }

    googleApi.accounts.id.renderButton(refs.googleAuthButton, {
      theme: 'outline',
      size: 'medium',
      shape: 'pill',
      text: 'signin_with',
      width: 210,
    });
  }

  async function handleGoogleCredential(response) {
    try {
      const loginResponse = await fetch('/api/auth/google', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Guest-Id': state.guestId,
        },
        body: JSON.stringify({ credential: response.credential }),
      });
      const data = await loginResponse.json();

      if (!loginResponse.ok) {
        throw new Error(data.error || 'Google 로그인에 실패했습니다.');
      }

      state.token = data.token;
      window.localStorage.setItem(TOKEN_KEY, data.token);
      applyAccountState({
        ...(state.payload || {}),
        user: data.user,
        quota: data.quota,
      });
    } catch (error) {
      window.alert(error.message || 'Google 로그인에 실패했습니다.');
    }
  }

  function ensureGoogleScript() {
    if (window.google?.accounts?.id) {
      return Promise.resolve(window.google);
    }

    if (state.googlePromise) {
      return state.googlePromise;
    }

    state.googlePromise = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(window.google);
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });

    return state.googlePromise;
  }

  function ensureGuestId() {
    let guestId = window.localStorage.getItem(GUEST_KEY);
    if (guestId) {
      return guestId;
    }

    if (window.crypto?.randomUUID) {
      guestId = window.crypto.randomUUID().replace(/-/g, '');
    } else {
      guestId = `${Date.now()}${Math.random().toString(16).slice(2)}`;
    }

    guestId = `guest_${guestId}`.slice(0, 60);
    window.localStorage.setItem(GUEST_KEY, guestId);
    return guestId;
  }
})();
