const urlInput = document.getElementById('urlInput');
const extractBtn = document.getElementById('extractBtn');
const errorMsg = document.getElementById('errorMsg');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingText = document.getElementById('loadingText');

urlInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    handleExtract();
  }
});

extractBtn.addEventListener('click', handleExtract);

async function handleExtract() {
  const url = urlInput.value.trim();
  hideError();

  if (!url) {
    showError('영상 링크를 입력해주세요.');
    urlInput.focus();
    return;
  }

  setLoading(true, '영상 정보를 가져오는 중...');

  try {
    const response = await fetch('/api/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(window.chuchulAuth?.getRequestHeaders() || {}),
      },
      body: JSON.stringify({ url }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      window.chuchulAuth?.applyAccountState(data.account);
      throw new Error(data.error || '영상 정보를 가져오지 못했습니다.');
    }

    window.chuchulAuth?.applyAccountState(data.account);
    sessionStorage.setItem('vidData', JSON.stringify(data));
    window.location.href = '/result';
  } catch (error) {
    setLoading(false);
    showError(error.message || '요청 처리 중 오류가 발생했습니다.');
  }
}

function setLoading(active, message = '') {
  loadingOverlay.classList.toggle('active', active);
  loadingOverlay.setAttribute('aria-hidden', String(!active));
  extractBtn.disabled = active;
  urlInput.disabled = active;

  if (message) {
    loadingText.textContent = message;
  }
}

function showError(message) {
  errorMsg.textContent = message;
  errorMsg.classList.add('visible');
}

function hideError() {
  errorMsg.textContent = '';
  errorMsg.classList.remove('visible');
}
