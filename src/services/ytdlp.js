import { execFile, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Windows / Linux binary detection ────────────────────
const IS_WINDOWS    = process.platform === 'win32';
const YTDLP_BIN     = process.env.YTDLP_PATH || (IS_WINDOWS ? 'yt-dlp.exe' : 'yt-dlp');
const DOWNLOADS_DIR = path.join(__dirname, '../../downloads');

// Auto-create downloads folder if missing
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  console.log('📁 Created downloads folder at:', DOWNLOADS_DIR);
}

// ── Fetch video metadata ─────────────────────────────────
function getVideoInfo(url) {
  return new Promise((resolve, reject) => {
    const args = [
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificate',
      url,
    ];

    console.log(`🔍 Fetching info for: ${url}`);

    execFile(YTDLP_BIN, args, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('yt-dlp error:', stderr);

        if (stderr.includes('Video unavailable'))  return reject(new Error('VIDEO_UNAVAILABLE'));
        if (stderr.includes('Private video'))      return reject(new Error('VIDEO_PRIVATE'));
        if (stderr.includes('copyright'))          return reject(new Error('VIDEO_COPYRIGHT'));
        if (stderr.includes('not a valid URL'))    return reject(new Error('INVALID_URL'));
        if (stderr.includes('Unable to extract')) return reject(new Error('FETCH_FAILED'));

        return reject(new Error('FETCH_FAILED'));
      }

      try {
        const data = JSON.parse(stdout.trim());
        resolve(parseVideoInfo(data));
      } catch (parseErr) {
        console.error('JSON parse error:', parseErr.message);
        reject(new Error('PARSE_FAILED'));
      }
    });
  });
}

// ── Parse raw yt-dlp JSON into clean frontend-friendly object ──
function parseVideoInfo(raw) {
  const options = buildDownloadOptions(raw.formats || [], raw.duration || 0);

  return {
    id:          raw.id,
    title:       raw.title        || 'Unknown Title',
    thumbnail:   raw.thumbnail    || '',
    duration:    raw.duration     || 0,
    uploader:    raw.uploader     || 'Unknown',
    viewCount:   raw.view_count   || 0,
    likeCount:   raw.like_count   || 0,
    description: (raw.description || '').slice(0, 300),
    webpage_url: raw.webpage_url  || '',
    options,
  };
}

// ── Build user-facing download options ───────────────────
function buildDownloadOptions(formats, duration) {
  const options = [];

  // Target video qualities (high → low)
  const heights = [1080, 720, 480, 360, 240, 144];

  for (const height of heights) {
    options.push({
      id:       `video_${height}p`,
      label:    height >= 720 ? `${height}p HD` : `${height}p`,
      type:     'video',
      quality:  `${height}p`,
      // yt-dlp format selector: best mp4 at this height, fallback to any
      format:   `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${height}][ext=mp4]/best[height<=${height}]`,
      ext:      'mp4',
      filesize: estimateVideoSize(height, duration),
      icon:     height >= 720 ? '🎬' : '📹',
    });
  }

  // Audio options
  options.push({
    id:       'audio_mp3_128',
    label:    'MP3 — 128 kbps',
    type:     'audio',
    quality:  '128kbps',
    format:   'bestaudio/best',
    ext:      'mp3',
    filesize: estimateAudioSize(128, duration),
    icon:     '🎵',
  });

  options.push({
    id:       'audio_mp3_320',
    label:    'MP3 — 320 kbps',
    type:     'audio',
    quality:  '320kbps',
    format:   'bestaudio/best',
    ext:      'mp3',
    filesize: estimateAudioSize(320, duration),
    icon:     '🎵',
  });

  return options;
}

// ── Rough file size estimators ───────────────────────────
function estimateVideoSize(height, duration) {
  const kbps = { 1080: 4000, 720: 2500, 480: 1200, 360: 700, 240: 400, 144: 200 };
  return Math.round(((kbps[height] || 500) * 1000 / 8) * duration);
}

function estimateAudioSize(kbps, duration) {
  return Math.round((kbps * 1000 / 8) * duration);
}

// ── Download video/audio to a file path, reporting progress ──
function downloadToFile(url, format, outputPath, ext, onProgress) {
  return new Promise((resolve, reject) => {
    const isAudio = ext === 'mp3';

    const args = [
      '--format',      format,
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificate',
      '--newline',                    // one progress line at a time
      '--output',      outputPath,
    ];

    if (isAudio) {
      // Extract and convert to MP3
      args.push(
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', '0',       // best quality
      );
    } else {
      args.push('--merge-output-format', 'mp4');
    }

    args.push(url);

    console.log(`⬇  Starting download: ${outputPath}`);
    console.log(`   Binary: ${YTDLP_BIN}`);
    console.log(`   Format: ${format}`);

    const proc = spawn(YTDLP_BIN, args, {
      // On Windows, shell:true helps find binaries in PATH
      shell: IS_WINDOWS,
    });

    let lastProgress = -1;

    proc.stdout.on('data', (data) => {
      const line = data.toString();

      // Parse lines like: [download]  45.3% of 23.45MiB at 2.34MiB/s ETA 00:07
      const match = line.match(/(\d+\.?\d*)%/);
      if (match) {
        const pct = parseFloat(match[1]);
        if (pct !== lastProgress) {
          lastProgress = pct;
          onProgress?.(pct);
        }
      }
    });

    proc.stderr.on('data', (data) => {
      const msg = data.toString();
      // Only log actual errors, not warnings
      if (msg.includes('ERROR') || msg.includes('error')) {
        console.error('yt-dlp stderr:', msg.trim());
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ Download complete: ${outputPath}`);
        resolve(outputPath);
      } else {
        reject(new Error(`yt-dlp process exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      console.error('Failed to start yt-dlp process:', err.message);
      // Give a helpful message if binary not found
      if (err.code === 'ENOENT') {
        reject(new Error(
          `yt-dlp binary not found. Make sure yt-dlp is installed and in your PATH.\n` +
          `Tried: "${YTDLP_BIN}"\n` +
          `Run "yt-dlp --version" in your terminal to verify.`
        ));
      } else {
        reject(err);
      }
    });
  });
}

export { getVideoInfo, downloadToFile, DOWNLOADS_DIR };