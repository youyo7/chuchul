const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const TEMP_DIR = path.resolve(process.env.TEMP_DIR || './temp');
const YTDLP_BIN = resolveBinaryPath(process.env.YTDLP_PATH, ['yt-dlp.exe', 'yt-dlp'], ['yt-dlp.yt-dlp']);
const FFMPEG_BIN = resolveBinaryPath(process.env.FFMPEG_PATH, ['ffmpeg.exe', 'ffmpeg'], ['yt-dlp.ffmpeg', 'gyan.ffmpeg', 'ffmpeg.ffmpeg', 'btbn.ffmpeg']);

function getVideoInfo(url) {
  return new Promise((resolve, reject) => {
    runYtDlp(['--dump-json', '--no-playlist', '--no-warnings', url], (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message || 'yt-dlp 실행에 실패했습니다.'));
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed);
      } catch {
        reject(new Error('영상 정보를 해석하지 못했습니다.'));
      }
    });
  });
}

function parseFormats(info) {
  const candidates = Array.isArray(info?.formats)
    ? info.formats
        .filter((format) => format && format.vcodec !== 'none' && Number.isFinite(format.height))
        .sort((a, b) => {
          const heightDiff = (b.height || 0) - (a.height || 0);
          if (heightDiff !== 0) {
            return heightDiff;
          }

          return (b.tbr || 0) - (a.tbr || 0);
        })
    : [];

  const uniqueByHeight = [];
  const seenHeights = new Set();

  for (const format of candidates) {
    if (seenHeights.has(format.height)) {
      continue;
    }

    seenHeights.add(format.height);
    uniqueByHeight.push(format);
  }

  const formats = [];
  const pickedHeights = new Set();
  const preferredHeights = [1080, 720, 480];

  if (uniqueByHeight.length) {
    const top = uniqueByHeight[0];
    formats.push(formatToOption(top, `최고화질 (${top.height}p)`));
    pickedHeights.add(top.height);
  }

  for (const height of preferredHeights) {
    const match = uniqueByHeight.find((format) => format.height === height && !pickedHeights.has(format.height));
    if (!match) {
      continue;
    }

    formats.push(formatToOption(match, `${height}p`));
    pickedHeights.add(match.height);
  }

  for (const format of uniqueByHeight) {
    if (formats.length >= 4) {
      break;
    }

    if (pickedHeights.has(format.height)) {
      continue;
    }

    formats.push(formatToOption(format, `${format.height}p`));
    pickedHeights.add(format.height);
  }

  formats.push({
    quality: 'MP3',
    height: 0,
    format_id: 'bestaudio',
    ext: 'mp3',
    filesize: '?MB',
  });

  return formats.slice(0, 5);
}

function downloadFile(url, formatId, ext, quality) {
  return new Promise((resolve, reject) => {
    const fileId = uuidv4();
    const outputTemplate = path.join(TEMP_DIR, `${fileId}.%(ext)s`);

    const args =
      formatId === 'bestaudio'
        ? [
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
          ]
        : [
            '-f',
            buildVideoSelector(formatId, quality),
            '--merge-output-format',
            ext === 'webm' ? 'webm' : 'mp4',
            '--no-playlist',
            '--no-warnings',
            '-o',
            outputTemplate,
            url,
          ];

    runYtDlp(args, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || stdout || '다운로드에 실패했습니다.'));
        return;
      }

      const files = safeListTempFiles(fileId);
      if (!files.length) {
        reject(new Error('다운로드 파일을 찾지 못했습니다.'));
        return;
      }

      const filename = files[0];
      resolve({
        fileId,
        filePath: path.join(TEMP_DIR, filename),
        filename,
      });
    });
  });
}

function buildVideoSelector(formatId, quality) {
  const height = Number.parseInt(String(quality || '').replace(/[^\d]/g, ''), 10);
  if (Number.isFinite(height) && height > 0) {
    return `bv*[height<=${height}][ext=mp4]+ba[ext=m4a]/bv*[height<=${height}]+ba/b[height<=${height}][ext=mp4]/b[height<=${height}]/best`;
  }

  return `${formatId}+bestaudio/${formatId}/best`;
}

function runYtDlp(args, done) {
  const proc = createYtDlpProcess(args, ['ignore', 'pipe', 'pipe']);

  let stdout = '';
  let stderr = '';
  let settled = false;

  proc.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  proc.on('error', (error) => {
    if (settled) {
      return;
    }

    settled = true;
    done(error, stdout, stderr);
  });

  proc.on('close', (code) => {
    if (settled) {
      return;
    }

    settled = true;
    if (code === 0) {
      done(null, stdout, stderr);
      return;
    }

    done(new Error(`yt-dlp exited with code ${code}`), stdout, stderr);
  });
}

function createYtDlpProcess(args, stdio) {
  return spawn(YTDLP_BIN, args, {
    windowsHide: true,
    stdio,
    env: buildRuntimeEnv(),
  });
}

function createFfmpegProcess(args, stdio) {
  return spawn(FFMPEG_BIN, args, {
    windowsHide: true,
    stdio,
    env: buildRuntimeEnv(),
  });
}

function buildRuntimeEnv() {
  const env = { ...process.env };
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
  const currentPath = env[pathKey] || env.PATH || env.Path || '';
  const extraDirs = [
    path.dirname(YTDLP_BIN),
    path.dirname(FFMPEG_BIN),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links'),
  ].filter((dir) => dir && fs.existsSync(dir));

  const mergedPath = Array.from(new Set([currentPath, ...extraDirs].filter(Boolean))).join(path.delimiter);
  env.Path = mergedPath;
  env.PATH = mergedPath;
  return env;
}

function resolveBinaryPath(overridePath, executableNames, packagePrefixes) {
  if (overridePath && fs.existsSync(overridePath)) {
    return overridePath;
  }

  const inPath = findExecutableInPath(executableNames);
  if (inPath) {
    return inPath;
  }

  const linksDir = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links');
  const inLinks = executableNames
    .map((name) => path.join(linksDir, name))
    .find((candidate) => fs.existsSync(candidate));
  if (inLinks) {
    return inLinks;
  }

  const packagesDir = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  if (fs.existsSync(packagesDir)) {
    const packageDirs = fs
      .readdirSync(packagesDir)
      .filter((entry) => packagePrefixes.some((prefix) => entry.toLowerCase().startsWith(prefix)));

    for (const packageDir of packageDirs) {
      const found = findExecutableInDirectory(path.join(packagesDir, packageDir), executableNames, 4);
      if (found) {
        return found;
      }
    }
  }

  return executableNames[0];
}

function findExecutableInPath(executableNames) {
  const pathValue = process.env.Path || process.env.PATH || '';
  const directories = pathValue.split(path.delimiter).filter(Boolean);

  for (const directory of directories) {
    for (const executableName of executableNames) {
      const candidate = path.join(directory, executableName);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function findExecutableInDirectory(rootDir, executableNames, maxDepth, depth = 0) {
  if (!fs.existsSync(rootDir) || depth > maxDepth) {
    return null;
  }

  const directMatch = executableNames
    .map((name) => path.join(rootDir, name))
    .find((candidate) => fs.existsSync(candidate));
  if (directMatch) {
    return directMatch;
  }

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const found = findExecutableInDirectory(path.join(rootDir, entry.name), executableNames, maxDepth, depth + 1);
    if (found) {
      return found;
    }
  }

  return null;
}

function safeListTempFiles(prefix) {
  try {
    return fs
      .readdirSync(TEMP_DIR)
      .filter((entry) => entry.startsWith(prefix))
      .sort((a, b) => {
        const aStat = fs.statSync(path.join(TEMP_DIR, a));
        const bStat = fs.statSync(path.join(TEMP_DIR, b));
        return bStat.mtimeMs - aStat.mtimeMs;
      });
  } catch {
    return [];
  }
}

function formatToOption(format, label) {
  return {
    quality: label,
    height: format.height,
    format_id: String(format.format_id || label),
    ext: 'mp4',
    filesize: formatBytes(format.filesize || format.filesize_approx),
  };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '?MB';
  }

  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)}GB`;
  }

  if (mb < 1) {
    return `${Math.max(1, Math.round(mb * 1024))}KB`;
  }

  return `${Math.round(mb)}MB`;
}

module.exports = { getVideoInfo, parseFormats, downloadFile, createFfmpegProcess, createYtDlpProcess };
