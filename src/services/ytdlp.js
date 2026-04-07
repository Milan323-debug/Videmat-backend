import { execFile, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IS_WINDOWS   = process.platform === 'win32';
const PROJECT_ROOT = path.join(__dirname, '../../');
const BIN_DIR      = path.join(PROJECT_ROOT, 'bin');

// Use globally installed yt-dlp/ffmpeg first, fall back to local binaries on Render
const YTDLP_BIN  = process.env.YTDLP_PATH  || 'yt-dlp';
const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';

console.log('🖥️  Platform:', process.platform, '| IS_WINDOWS:', IS_WINDOWS);
console.log('📁 YTDLP_BIN:', YTDLP_BIN);
console.log('📁 FFMPEG_BIN:', FFMPEG_BIN);

const DOWNLOADS_DIR = path.join(PROJECT_ROOT, 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  console.log('📁 Created downloads folder at:', DOWNLOADS_DIR);
}

// ── Cookie Setup ─────────────────────────────────────────
let COOKIES_PATH = null;

function setupCookies() {
  // Option A — local file (for Windows dev machine)
  const localPath = path.join(PROJECT_ROOT, 'cookies', 'youtube.txt');
  if (fs.existsSync(localPath)) {
    COOKIES_PATH = localPath;
    console.log('🍪 Using local cookie file:', localPath);
    return;
  }

  // Option B — base64 env variable (Render)
  const b64 = process.env.YOUTUBE_COOKIES_B64;
  if (b64 && b64.trim() !== '') {
    try {
      const decoded = Buffer.from(b64.trim(), 'base64').toString('utf-8');

      // Write to a stable path inside the project (not /tmp which may get cleared)
      const cookieDir  = path.join(PROJECT_ROOT, 'cookies');
      const cookiePath = path.join(cookieDir, 'youtube.txt');

      if (!fs.existsSync(cookieDir)) {
        fs.mkdirSync(cookieDir, { recursive: true });
      }

      fs.writeFileSync(cookiePath, decoded, 'utf-8');

      // Verify the file was actually written and has content
      const written = fs.readFileSync(cookiePath, 'utf-8');
      if (written.length < 100) {
        console.warn('⚠️  Cookie file seems too small — may be invalid');
      }

      COOKIES_PATH = cookiePath;
      console.log('🍪 Cookie file written to:', cookiePath);
      console.log('🍪 Cookie file size:', written.length, 'bytes');
      console.log('🍪 First line:', written.split('\n')[0]);
    } catch (err) {
      console.error('❌ Failed to write cookie file:', err.message);
    }
    return;
  }

  console.warn('⚠️  No YouTube cookies found in env or local file!');
}

setupCookies();

// ── Common yt-dlp args ───────────────────────────────────
function commonArgs() {
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificate',
    '--ffmpeg-location', FFMPEG_BIN,
    '--user-agent',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    '--force-ipv4',
    // ⚠️  AGGRESSIVE RATE LIMITING CONFIG FOR RENDER
    '--sleep-requests', '5',           // Wait 5 seconds between requests
    '--min-sleep-interval', '2',       // Min 2 seconds between retries
    '--max-sleep-interval', '30',      // Max 30 seconds between retries
    '--socket-timeout', '30',          // 30s socket timeout
    '--retries', '5',                  // Retry up to 5 times
    '--fragment-retries', '5',
    '--skip-unavailable-fragments',
    '--prefer-free-formats',           // Lower res/size = faster, less rate limit
  ];

  if (COOKIES_PATH && fs.existsSync(COOKIES_PATH)) {
    args.push('--cookies', COOKIES_PATH);
    console.log('🍪 Passing cookies to yt-dlp from:', COOKIES_PATH);
  } else {
    console.warn('⚠️  Cookie file missing at runtime! Path was:', COOKIES_PATH);
  }

  return args;
}

// ── Retry logic with exponential backoff for rate limiting ──
async function retryWithBackoff(fn, maxRetries = 3, baseDelayMs = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!err.message?.includes('RATE_LIMITED')) throw err;
      
      if (attempt === maxRetries) {
        console.error(`❌ Rate limited after ${maxRetries} attempts`);
        throw err;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(`⏳ Rate limited — retrying in ${delayMs / 1000}s (attempt ${attempt}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

// ── Fetch video metadata ─────────────────────────────────
function getVideoInfo(url) {
  return retryWithBackoff(() => new Promise((resolve, reject) => {
    const args = [
      '--dump-json',
      ...commonArgs(),
      url,
    ];

    console.log(`🔍 Fetching info for: ${url}`);

    execFile(YTDLP_BIN, args, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('yt-dlp error:', stderr);
        console.error('yt-dlp error object:', err.message);
        console.error('yt-dlp command:', YTDLP_BIN);
        console.error('yt-dlp args:', args);

        if (stderr && stderr.includes('Video unavailable'))   return reject(new Error('VIDEO_UNAVAILABLE'));
        if (stderr && stderr.includes('Private video'))       return reject(new Error('VIDEO_PRIVATE'));
        if (stderr && stderr.includes('copyright'))           return reject(new Error('VIDEO_COPYRIGHT'));
        if (stderr && stderr.includes('not a valid URL'))     return reject(new Error('INVALID_URL'));
        if (stderr && stderr.includes('429'))                 return reject(new Error('RATE_LIMITED'));
        if (stderr && stderr.includes('Sign in to confirm')) return reject(new Error('RATE_LIMITED'));
        if (stderr && stderr.includes('rate limit'))          return reject(new Error('RATE_LIMITED'));
        if (stderr && stderr.includes('Please try again'))    return reject(new Error('RATE_LIMITED'));

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
  }));
}

// ── Download video/audio to file ────────────────────────
function downloadToFile(url, format, outputPath, ext, onProgress) {
  return retryWithBackoff(async () => {
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
      let errorMsg = '';

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
        errorMsg += msg;
        if (msg.includes('ERROR') || msg.includes('429')) {
          console.error('yt-dlp stderr:', msg.trim());
        }
      });

      proc.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ Download complete: ${path.basename(outputPath)}`);
          resolve(outputPath);
        } else {
          // Detect rate limiting
          if (errorMsg.includes('429') || errorMsg.includes('Please try again') || errorMsg.includes('rate limit')) {
            reject(new Error('RATE_LIMITED'));
          } else {
            reject(new Error(`yt-dlp exited with code ${code}`));
          }
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
  }, 2, 3000);  // Retry up to 2 times with 3 second base delay for downloads
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