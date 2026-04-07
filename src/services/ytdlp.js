import { execFile, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IS_WINDOWS    = process.platform === 'win32';
const PROJECT_ROOT  = path.join(__dirname, '../../');
const BIN_DIR       = path.join(PROJECT_ROOT, 'bin');

// On Windows use yt-dlp.exe from PATH
// On Linux (Render) use the binary we downloaded into ./bin/
const YTDLP_BIN  = process.env.YTDLP_PATH  || (IS_WINDOWS ? 'yt-dlp.exe'  : path.join(BIN_DIR, 'yt-dlp'));
const FFMPEG_BIN = process.env.FFMPEG_PATH || (IS_WINDOWS ? 'ffmpeg'       : path.join(BIN_DIR, 'ffmpeg'));
const DOWNLOADS_DIR = path.join(__dirname, '../../downloads');

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  console.log('📁 Created downloads folder at:', DOWNLOADS_DIR);
}

// ── Cookie setup ─────────────────────────────────────────
// Writes cookies from env variable to a temp file so yt-dlp can use them
let COOKIES_PATH = null;

function setupCookies() {
  // Option A: cookie file already exists on disk (local dev)
  const localCookies = path.join(__dirname, '../../cookies/youtube.txt');
  if (fs.existsSync(localCookies)) {
    COOKIES_PATH = localCookies;
    console.log('🍪 Using local cookies file');
    return;
  }

  // Option B: cookies stored as base64 env variable (Render/Railway)
  const b64 = process.env.YOUTUBE_COOKIES_B64;
  if (b64) {
    try {
      const decoded  = Buffer.from(b64, 'base64').toString('utf-8');
      const tempPath = path.join(os.tmpdir(), 'yt_cookies.txt');
      fs.writeFileSync(tempPath, decoded, 'utf-8');
      COOKIES_PATH = tempPath;
      console.log('🍪 Cookies loaded from environment variable');
    } catch (err) {
      console.warn('⚠️  Failed to decode cookies from env:', err.message);
    }
    return;
  }

  console.warn('⚠️  No YouTube cookies found. Requests may be rate-limited by YouTube.');
}

setupCookies();

// ── Helper: build common yt-dlp args ─────────────────────
function commonArgs() {
  const poToken   = process.env.YOUTUBE_PO_TOKEN || '';
  const visitorId = process.env.YOUTUBE_VISITOR_ID || '';

  const args = [
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificate',
    '--ffmpeg-location', FFMPEG_BIN,
    // Spoof a real Chrome browser
    '--user-agent',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // Add delays to avoid bot detection
    '--sleep-requests', '2',
    '--sleep-interval', '2',
    // Use IPv4 only (IPv6 is more often flagged)
    '--force-ipv4',
  ];

  // Add PO token and visitor data to extractor args
  if (poToken && visitorId) {
    args.push('--extractor-args', `youtube:po_token=${poToken};visitor_data=${visitorId}`);
  } else if (poToken) {
    args.push('--extractor-args', `youtube:po_token=${poToken}`);
  } else if (visitorId) {
    args.push('--extractor-args', `youtube:visitor_data=${visitorId}`);
  }

  // Add cookies if available
  if (COOKIES_PATH) {
    args.push('--cookies', COOKIES_PATH);
  }

  return args;
}

// ── Fetch video metadata ─────────────────────────────────
function getVideoInfo(url) {
  return new Promise((resolve, reject) => {
    const args = [
      '--dump-json',
      ...commonArgs(),
      url,
    ];

    console.log(`🔍 Fetching info for: ${url}`);

    execFile(YTDLP_BIN, args, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('yt-dlp error:', stderr);

        if (stderr.includes('Video unavailable'))   return reject(new Error('VIDEO_UNAVAILABLE'));
        if (stderr.includes('Private video'))       return reject(new Error('VIDEO_PRIVATE'));
        if (stderr.includes('copyright'))           return reject(new Error('VIDEO_COPYRIGHT'));
        if (stderr.includes('not a valid URL'))     return reject(new Error('INVALID_URL'));
        if (stderr.includes('429'))                 return reject(new Error('RATE_LIMITED'));
        if (stderr.includes('Sign in to confirm')) return reject(new Error('RATE_LIMITED'));

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

// ── Download video/audio to file ────────────────────────
function downloadToFile(url, format, outputPath, ext, onProgress) {
  return new Promise((resolve, reject) => {
    const isAudio = ext === 'mp3';

    const args = [
      '--format', format,
      ...commonArgs(),
      '--newline',
      '--output', outputPath,
    ];

    if (isAudio) {
      args.push(
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
      );
    } else {
      args.push('--merge-output-format', 'mp4');
    }

    args.push(url);

    console.log(`⬇  Starting download: ${path.basename(outputPath)}`);

    const proc = spawn(YTDLP_BIN, args, { shell: IS_WINDOWS });
    let lastProgress = -1;

    proc.stdout.on('data', (data) => {
      const line = data.toString();
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
      if (msg.includes('ERROR') || msg.includes('429')) {
        console.error('yt-dlp stderr:', msg.trim());
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ Download complete: ${path.basename(outputPath)}`);
        resolve(outputPath);
      } else {
        reject(new Error(`yt-dlp exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(`yt-dlp binary not found. Tried: "${YTDLP_BIN}"`));
      } else {
        reject(err);
      }
    });
  });
}

// ── Parse yt-dlp JSON ────────────────────────────────────
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

function buildDownloadOptions(formats, duration) {
  const options  = [];
  const heights  = [1080, 720, 480, 360, 240, 144];

  for (const height of heights) {
    options.push({
      id:       `video_${height}p`,
      label:    height >= 720 ? `${height}p HD` : `${height}p`,
      type:     'video',
      quality:  `${height}p`,
      format:   `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${height}][ext=mp4]/best[height<=${height}]`,
      ext:      'mp4',
      filesize: estimateVideoSize(height, duration),
      icon:     height >= 720 ? '🎬' : '📹',
    });
  }

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

function estimateVideoSize(height, duration) {
  const kbps = { 1080: 4000, 720: 2500, 480: 1200, 360: 700, 240: 400, 144: 200 };
  return Math.round(((kbps[height] || 500) * 1000 / 8) * duration);
}

function estimateAudioSize(kbps, duration) {
  return Math.round((kbps * 1000 / 8) * duration);
}

export { getVideoInfo, downloadToFile, DOWNLOADS_DIR };