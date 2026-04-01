let vidData = null;
let selectedFormat = null;

const loadingOverlay = document.getElementById('loadingOverlay');
const loadingText = document.getElementById('loadingText');
const downloadBtn = document.getElementById('downloadBtn');
const fetchTranscriptBtn = document.getElementById('fetchTranscriptBtn');
const copyBtn = document.getElementById('copyBtn');
const txtBtn = document.getElementById('txtBtn');
const srtBtn = document.getElementById('srtBtn');
const transcriptNotice = document.getElementById('transcriptNotice');
const transcriptBody = document.getElementById('transcriptBody');
const transcriptSubtext = document.getElementById('transcriptSubtext');

window.addEventListener('DOMContentLoaded', () => {
  const raw = sessionStorage.getItem('vidData');
  if (!raw) {
    window.location.href = '/';
    return;
  }

  try {
    vidData = JSON.parse(raw);
  } catch {
    sessionStorage.removeItem('vidData');
    window.location.href = '/';
    return;
  }

  bindActions();
  renderPage(vidData);
});

function bindActions() {
  downloadBtn.addEventListener('click', handleDownload);
  fetchTranscriptBtn.addEventListener('click', handleTranscriptFetch);
  copyBtn.addEventListener('click', copyTranscript);
  txtBtn.addEventListener('click', () => downloadTranscript('txt'));
  srtBtn.addEventListener('click', () => downloadTranscript('srt'));
}

function renderPage(data) {
  document.title = `${data.title || '결과'} - chuchul`;
  document.getElementById('videoTitle').textContent = data.title || '제목 없음';
  document.getElementById('videoUploader').textContent = data.uploader || platformLabel(data.platform);
  document.getElementById('platformLabel').textContent = platformLabel(data.platform);
  document.getElementById('durationLabel').textContent = formatDuration(data.duration);
  document.getElementById('heroPlatform').textContent = platformLabel(data.platform);
  document.getElementById('heroDuration').textContent = formatDuration(data.duration) || '길이 정보 없음';

  renderPlayer(data);
  renderFormats(data.formats || []);
  renderTranscriptSection(data);

  window.chuchulAuth?.applyAccountState(data.account);
}

function renderPlayer(data) {
  const player = document.getElementById('videoPlayer');
  player.innerHTML = '';

  if (data.embedUrl) {
    const iframe = document.createElement('iframe');
    iframe.src = data.embedUrl;
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.title = data.title || 'video player';
    player.appendChild(iframe);
    return;
  }

  if (data.thumbnail) {
    const image = document.createElement('img');
    image.src = data.thumbnail;
    image.alt = data.title || 'thumbnail';
    player.appendChild(image);
    return;
  }

  const fallback = document.createElement('div');
  fallback.className = 'ad-block';
  fallback.style.height = '100%';
  fallback.textContent = '미리보기를 표시할 수 없습니다.';
  player.appendChild(fallback);
}

function renderFormats(formats) {
  const qualityList = document.getElementById('qualityList');
  qualityList.innerHTML = '';

  if (!formats.length) {
    const empty = document.createElement('div');
    empty.className = 'ad-block';
    empty.style.minHeight = '96px';
    empty.textContent = '다운로드 가능한 옵션을 찾지 못했습니다.';
    qualityList.appendChild(empty);
    downloadBtn.disabled = true;
    return;
  }

  formats.forEach((format, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `quality-option${index === 0 ? ' selected' : ''}`;

    const label = document.createElement('span');
    label.className = 'quality-label';
    label.textContent = format.quality;

    const size = document.createElement('span');
    size.className = 'quality-size';
    size.textContent = format.filesize || '?MB';

    button.append(label, size);
    button.addEventListener('click', () => selectQuality(index));
    qualityList.appendChild(button);
  });

  selectedFormat = formats[0];
  updateSelectedSummary();
}

function renderTranscriptSection(data) {
  const transcriptPolicy = data.transcriptPolicy || {};
  const hasTranscript = Boolean(data.transcript && data.transcript.trim());

  transcriptSubtext.textContent = transcriptPolicy.helperText || '필요할 때만 불러와서 비용을 절감합니다.';
  fetchTranscriptBtn.textContent = hasTranscript
    ? transcriptPolicy.mode === 'youtube'
      ? '자막 다시 불러오기'
      : '대본 다시 추출'
    : transcriptPolicy.buttonLabel || '대본 추출';

  fetchTranscriptBtn.disabled = false;

  if (hasTranscript) {
    transcriptBody.textContent = data.transcript;
    transcriptBody.classList.remove('empty');
    copyBtn.disabled = false;
    txtBtn.disabled = false;
    srtBtn.disabled = !(data.transcriptSrt && data.transcriptSrt.trim());
    document.getElementById('heroTranscript').textContent = data.transcriptCached ? '캐시로 준비됨' : '준비 완료';
  } else {
    transcriptBody.textContent = getTranscriptPlaceholder(data);
    transcriptBody.classList.add('empty');
    copyBtn.disabled = true;
    txtBtn.disabled = true;
    srtBtn.disabled = true;
    document.getElementById('heroTranscript').textContent = transcriptPolicy.available ? '클릭 후 추출' : '로그인 필요';
  }

  if (data.transcriptNotice) {
    transcriptNotice.hidden = false;
    transcriptNotice.textContent = data.transcriptNotice;
  } else {
    transcriptNotice.hidden = true;
    transcriptNotice.textContent = '';
  }
}

async function handleTranscriptFetch() {
  if (!vidData?.originalUrl) {
    return;
  }

  fetchTranscriptBtn.disabled = true;
  setLoading(true, vidData.platform === 'youtube' ? '자막을 불러오는 중...' : 'AI 대본을 추출하는 중...');

  try {
    const response = await fetch('/api/transcript', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(window.chuchulAuth?.getRequestHeaders() || {}),
      },
      body: JSON.stringify({
        url: vidData.originalUrl,
      }),
    });

    const data = await response.json().catch(() => ({}));
    window.chuchulAuth?.applyAccountState(data.account);

    if (!response.ok) {
      throw new Error(data.error || '대본 추출에 실패했습니다.');
    }

    vidData = {
      ...vidData,
      transcript: data.transcript || '',
      transcriptSrt: data.transcriptSrt || '',
      transcriptLimited: Boolean(data.transcriptLimited),
      transcriptNotice: data.transcriptNotice || '',
      transcriptCached: Boolean(data.transcriptCached),
      transcriptPolicy: data.transcriptPolicy || vidData.transcriptPolicy || {},
      account: data.account || vidData.account,
    };

    sessionStorage.setItem('vidData', JSON.stringify(vidData));
    renderTranscriptSection(vidData);
  } catch (error) {
    transcriptNotice.hidden = false;
    transcriptNotice.textContent = error.message || '대본 추출 중 오류가 발생했습니다.';
  } finally {
    setLoading(false);
    fetchTranscriptBtn.disabled = false;
  }
}

function selectQuality(index) {
  selectedFormat = vidData.formats[index];
  document.querySelectorAll('.quality-option').forEach((option, optionIndex) => {
    option.classList.toggle('selected', optionIndex === index);
  });
  updateSelectedSummary();
}

function updateSelectedSummary() {
  const qualityEl = document.getElementById('selectedQuality');
  const sizeEl = document.getElementById('selectedSize');

  if (!qualityEl || !sizeEl || !selectedFormat) {
    return;
  }

  qualityEl.textContent = selectedFormat.quality;
  sizeEl.textContent =
    selectedFormat.filesize && selectedFormat.filesize !== '?MB'
      ? `${selectedFormat.filesize} 예상`
      : '용량은 원본 상태에 따라 달라질 수 있습니다.';
  downloadBtn.textContent = `${selectedFormat.quality} 다운로드`;
}

async function handleDownload() {
  if (!selectedFormat || !vidData) {
    return;
  }

  setLoading(true, `${selectedFormat.quality} 파일을 준비하는 중...`);

  try {
    const response = await fetch('/api/download', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(window.chuchulAuth?.getRequestHeaders() || {}),
      },
      body: JSON.stringify({
        url: vidData.originalUrl,
        formatId: selectedFormat.format_id,
        quality: selectedFormat.quality,
        ext: selectedFormat.ext,
        title: vidData.title,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || '다운로드에 실패했습니다.');
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = `${sanitizeFilename(vidData.title || 'video')}.${selectedFormat.ext}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (error) {
    window.alert(error.message || '다운로드 중 오류가 발생했습니다.');
  } finally {
    setLoading(false);
  }
}

function copyTranscript() {
  const text = vidData?.transcript || '';
  if (!text.trim()) {
    return;
  }

  navigator.clipboard.writeText(text).then(() => {
    copyBtn.textContent = '복사됨';
    copyBtn.classList.add('copied');

    window.setTimeout(() => {
      copyBtn.textContent = '전체 복사';
      copyBtn.classList.remove('copied');
    }, 1800);
  });
}

function downloadTranscript(type) {
  if (!vidData) {
    return;
  }

  const content = type === 'srt' ? vidData.transcriptSrt || '' : vidData.transcript || '';
  if (!content.trim()) {
    window.alert(type === 'srt' ? '저장할 SRT 데이터가 없습니다.' : '저장할 대본이 없습니다.');
    return;
  }

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = `${sanitizeFilename(vidData.title || 'transcript')}.${type}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

function setLoading(active, message = '') {
  loadingOverlay.classList.toggle('active', active);
  loadingOverlay.setAttribute('aria-hidden', String(!active));
  downloadBtn.disabled = active;

  if (message) {
    loadingText.textContent = message;
  }
}

function getTranscriptPlaceholder(data) {
  const transcriptPolicy = data.transcriptPolicy || {};

  if (!transcriptPolicy.available) {
    return transcriptPolicy.helperText || 'Google 로그인 후 대본 추출을 사용할 수 있습니다.';
  }

  return transcriptPolicy.mode === 'youtube'
    ? '자막 불러오기 버튼을 누르면 YouTube 자막을 가져옵니다.'
    : 'AI 대본 추출 버튼을 누르면 필요한 범위만 분석합니다.';
}

function platformLabel(platform) {
  const labels = {
    youtube: 'YouTube',
    tiktok: 'TikTok',
    instagram: 'Instagram',
    douyin: 'Douyin',
    xiaohongshu: 'Xiaohongshu',
    twitter: 'X / Twitter',
    facebook: 'Facebook',
    bilibili: 'Bilibili',
  };

  return labels[platform] || 'Video';
}

function formatDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) {
    return '';
  }

  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = Math.floor(value % 60);

  if (hours > 0) {
    return [hours, minutes, secs].map((part) => String(part).padStart(2, '0')).join(':');
  }

  return [minutes, secs].map((part) => String(part).padStart(2, '0')).join(':');
}

function sanitizeFilename(value) {
  return (
    String(value || 'file')
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'file'
  );
}
