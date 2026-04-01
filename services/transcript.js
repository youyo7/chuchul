const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');

const { createFfmpegProcess, createYtDlpProcess } = require('./ytdlp');

const TEMP_DIR = path.resolve(process.env.TEMP_DIR || './temp');
const MAX_TRANSCRIBE_BYTES = 24.5 * 1024 * 1024;

async function getYoutubeTranscript(url) {
  const tmpId = uuidv4();
  const outputTemplate = path.join(TEMP_DIR, `${tmpId}.%(ext)s`);
  const preferredLanguages = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant', 'zh'];

  return new Promise((resolve) => {
    const args = [
      '--write-auto-sub',
      '--sub-lang',
      'ko,en,ja,zh-Hans,zh-Hant,zh',
      '--skip-download',
      '--sub-format',
      'vtt',
      '--no-playlist',
      '--no-warnings',
      '-o',
      outputTemplate,
      url,
    ];

    const proc = createYtDlpProcess(args, ['ignore', 'ignore', 'pipe']);

    proc.on('error', () => resolve(emptyTranscript()));

    proc.on('close', () => {
      try {
        const files = fs
          .readdirSync(TEMP_DIR)
          .filter((entry) => entry.startsWith(tmpId) && entry.endsWith('.vtt'))
          .sort((a, b) => languageRank(a, preferredLanguages) - languageRank(b, preferredLanguages));

        if (!files.length) {
          resolve(emptyTranscript());
          return;
        }

        const filePath = path.join(TEMP_DIR, files[0]);
        const vttContent = fs.readFileSync(filePath, 'utf8');

        cleanupPrefix(tmpId);
        resolve({
          text: parseVtt(vttContent),
          srt: convertVttToSrt(vttContent),
          limited: false,
          notice: '',
        });
      } catch {
        cleanupPrefix(tmpId);
        resolve(emptyTranscript());
      }
    });
  });
}

async function getWhisperTranscript(url, options = {}) {
  if (!process.env.OPENAI_API_KEY) {
    return emptyTranscript();
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const tmpId = uuidv4();
  const maxSeconds = Number.parseInt(options.maxSeconds, 10) || 0;
  const baseNotice = String(options.baseNotice || '').trim();

  try {
    const sourceAudioPath = await downloadAudio(url, tmpId);
    const preparedAudio = await prepareAudioForWhisper(sourceAudioPath, tmpId, { maxSeconds });
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(preparedAudio.audioPath),
      model: 'whisper-1',
      response_format: 'verbose_json',
    });

    return {
      text: typeof transcription.text === 'string' ? transcription.text.trim() : '',
      srt: buildSrtFromSegments(Array.isArray(transcription.segments) ? transcription.segments : []),
      limited: preparedAudio.limited || Boolean(baseNotice),
      notice: buildTranscriptNotice(preparedAudio, baseNotice),
    };
  } catch (error) {
    cleanupPrefix(tmpId);
    console.error('Whisper transcript error:', error.message);
    return emptyTranscript();
  }
}

function downloadAudio(url, tmpId) {
  return new Promise((resolve, reject) => {
    const outputTemplate = path.join(TEMP_DIR, `${tmpId}.%(ext)s`);
    const args = [
      '-f',
      'bestaudio',
      '-x',
      '--audio-format',
      'mp3',
      '--no-playlist',
      '--no-warnings',
      '-o',
      outputTemplate,
      url,
    ];

    const proc = createYtDlpProcess(args, ['ignore', 'ignore', 'pipe']);
    let failed = false;

    proc.on('error', (error) => {
      failed = true;
      reject(error);
    });

    proc.on('close', (code) => {
      if (failed) {
        return;
      }

      if (code !== 0) {
        reject(new Error('오디오 다운로드에 실패했습니다.'));
        return;
      }

      const file = findFirstFile(tmpId, '.mp3');
      if (!file) {
        reject(new Error('오디오 파일을 찾을 수 없습니다.'));
        return;
      }

      resolve(path.join(TEMP_DIR, file));
    });
  });
}

function prepareAudioForWhisper(inputPath, tmpId, options = {}) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(TEMP_DIR, `${tmpId}-whisper.mp3`);
    const maxSeconds = Number.parseInt(options.maxSeconds, 10) || 0;
    const args = ['-y', '-i', inputPath, '-vn'];

    if (maxSeconds > 0) {
      args.push('-t', String(maxSeconds));
    }

    args.push(
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      '32k',
      '-fs',
      String(Math.floor(MAX_TRANSCRIBE_BYTES)),
      outputPath
    );

    const proc = createFfmpegProcess(args, ['ignore', 'ignore', 'pipe']);
    let failed = false;

    proc.on('error', (error) => {
      failed = true;
      reject(error);
    });

    proc.on('close', (code) => {
      if (failed) {
        return;
      }

      if (code !== 0) {
        reject(new Error('대본용 오디오를 준비하지 못했습니다.'));
        return;
      }

      if (!fs.existsSync(outputPath)) {
        reject(new Error('대본용 오디오 파일을 찾을 수 없습니다.'));
        return;
      }

      const stats = fs.statSync(outputPath);
      resolve({
        audioPath: outputPath,
        limitedBySize: stats.size >= MAX_TRANSCRIBE_BYTES - 65536,
        limitedByTime: maxSeconds > 0,
        limited: maxSeconds > 0 || stats.size >= MAX_TRANSCRIBE_BYTES - 65536,
      });
    });
  });
}

function buildTranscriptNotice(preparedAudio, baseNotice) {
  const notices = [];

  if (baseNotice) {
    notices.push(baseNotice);
  }

  if (preparedAudio?.limitedBySize) {
    notices.push('OpenAI 업로드 제한 때문에 25MB 이하 범위까지만 대본을 제공합니다.');
  }

  return notices.join(' ');
}

function parseVtt(vttContent) {
  const lines = String(vttContent || '').split(/\r?\n/);
  const textLines = [];
  const seen = new Set();

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (!trimmed) continue;
    if (trimmed.startsWith('WEBVTT')) continue;
    if (trimmed.startsWith('Kind:')) continue;
    if (trimmed.startsWith('Language:')) continue;
    if (/-->/.test(trimmed)) continue;
    if (/^\d+$/.test(trimmed)) continue;

    const clean = stripCueText(trimmed);
    if (!clean || seen.has(clean)) {
      continue;
    }

    seen.add(clean);
    textLines.push(clean);
  }

  return textLines.join(' ');
}

function convertVttToSrt(vttContent) {
  const lines = String(vttContent || '').split(/\r?\n/);
  const result = [];
  let cueIndex = 1;
  let cueBuffer = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('WEBVTT') || trimmed.startsWith('Kind:') || trimmed.startsWith('Language:')) {
      if (cueBuffer.length) {
        pushCue(cueBuffer);
        cueBuffer = [];
      }
      continue;
    }

    cueBuffer.push(trimmed);
  }

  if (cueBuffer.length) {
    pushCue(cueBuffer);
  }

  return result.join('\n\n');

  function pushCue(parts) {
    const timeLineIndex = parts.findIndex((part) => /-->/.test(part));
    if (timeLineIndex === -1) {
      return;
    }

    const timeLine = parts[timeLineIndex].replace(/\./g, ',');
    const textLines = parts
      .slice(timeLineIndex + 1)
      .map(stripCueText)
      .filter(Boolean);

    if (!textLines.length) {
      return;
    }

    result.push(`${cueIndex}\n${timeLine}\n${textLines.join('\n')}`);
    cueIndex += 1;
  }
}

function buildSrtFromSegments(segments) {
  if (!segments.length) {
    return '';
  }

  return segments
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.text)
    .map((segment, index) => {
      const start = formatSrtTime(segment.start);
      const end = formatSrtTime(segment.end);
      const text = String(segment.text).trim();
      return `${index + 1}\n${start} --> ${end}\n${text}`;
    })
    .join('\n\n');
}

function formatSrtTime(seconds) {
  const totalMilliseconds = Math.max(0, Math.floor(Number(seconds) * 1000));
  const hours = Math.floor(totalMilliseconds / 3600000);
  const minutes = Math.floor((totalMilliseconds % 3600000) / 60000);
  const secs = Math.floor((totalMilliseconds % 60000) / 1000);
  const milliseconds = totalMilliseconds % 1000;

  return [hours, minutes, secs]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
    .concat(',', String(milliseconds).padStart(3, '0'));
}

function stripCueText(line) {
  return String(line || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function languageRank(filename, preferredLanguages) {
  const match = filename.match(/\.([a-zA-Z-]+)\.vtt$/);
  const language = match ? match[1] : '';
  const rank = preferredLanguages.indexOf(language);
  return rank === -1 ? preferredLanguages.length : rank;
}

function findFirstFile(prefix, extension) {
  try {
    return fs.readdirSync(TEMP_DIR).find((entry) => entry.startsWith(prefix) && entry.endsWith(extension)) || null;
  } catch {
    return null;
  }
}

function cleanupPrefix(prefix) {
  try {
    const files = fs.readdirSync(TEMP_DIR).filter((entry) => entry.startsWith(prefix));
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(TEMP_DIR, file));
      } catch {}
    }
  } catch {}
}

function emptyTranscript() {
  return { text: '', srt: '', limited: false, notice: '' };
}

module.exports = { getYoutubeTranscript, getWhisperTranscript };
