import ytdl from 'ytdl-core';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DOWNLOADS_DIR = path.join(__dirname, '../../downloads');

// Auto-create downloads folder if missing
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  console.log('📁 Created downloads folder at:', DOWNLOADS_DIR);
}

// ── Fetch video metadata ─────────────────────────────────
async function getVideoInfo(url) {
  try {
    console.log(`🔍 Fetching info for: ${url}`);
    
    const info = await ytdl.getInfo(url);
    const videoDetails = info.videoDetails;
    
    return parseVideoInfo(videoDetails, info.formats);
  } catch (err) {
    console.error('ytdl-core error:', err.message);
    
    if (err.message.includes('Video unavailable')) throw new Error('VIDEO_UNAVAILABLE');
    if (err.message.includes('Private')) throw new Error('VIDEO_PRIVATE');
    if (err.message.includes('copyright')) throw new Error('VIDEO_COPYRIGHT');
    
    throw new Error('FETCH_FAILED');
  }
}

// ── Parse raw ytdl-core data into clean frontend-friendly object ──
function parseVideoInfo(videoDetails, formats) {
  const options = buildDownloadOptions(formats, videoDetails.lengthSeconds);

  return {
    id:          videoDetails.videoId,
    title:       videoDetails.title || 'Unknown Title',
    thumbnail:   videoDetails.thumbnail?.thumbnails?.[videoDetails.thumbnail.thumbnails.length - 1]?.url || '',
    duration:    parseInt(videoDetails.lengthSeconds) || 0,
    uploader:    videoDetails.author?.name || 'Unknown',
    viewCount:   parseInt(videoDetails.viewCount) || 0,
    likeCount:   0,
    description: (videoDetails.shortDescription || '').slice(0, 300),
    webpage_url: `https://www.youtube.com/watch?v=${videoDetails.videoId}`,
    options,
  };
}

// ── Build user-facing download options ───────────────────
function buildDownloadOptions(formats, duration) {
  const options = [];

  // Get unique video qualities from available formats
  const videoFormats = formats.filter(f => f.hasVideo && f.hasAudio && f.mimeType?.includes('mp4'));
  const audioFormats = formats.filter(f => f.hasAudio && !f.hasVideo && f.mimeType?.includes('audio'));

  // Remove duplicates and sort by quality
  const qualities = new Map();
  videoFormats.forEach(f => {
    const height = f.height || 360;
    if (!qualities.has(height) || (f.bitrate || 0) > (qualities.get(height).bitrate || 0)) {
      qualities.set(height, f);
    }
  });

  // Add video options (sorted high to low)
  Array.from(qualities.entries())
    .sort((a, b) => b[0] - a[0])
    .slice(0, 6)
    .forEach(([height, format]) => {
      options.push({
        id:       `video_${height}p`,
        label:    height >= 720 ? `${height}p HD` : `${height}p`,
        type:     'video',
        quality:  `${height}p`,
        format:   format.itag,
        ext:      'mp4',
        filesize: format.contentLength ? parseInt(format.contentLength) : estimateVideoSize(height, duration),
        icon:     height >= 720 ? '🎬' : '📹',
      });
    });

  // Add audio options (use best audio format)
  const bestAudio = audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
  if (bestAudio) {
    options.push({
      id:       'audio_mp3_128',
      label:    'MP3 — 128 kbps',
      type:     'audio',
      quality:  '128kbps',
      format:   bestAudio.itag,
      ext:      'mp3',
      filesize: estimateAudioSize(128, duration),
      icon:     '🎵',
    });

    options.push({
      id:       'audio_mp3_320',
      label:    'MP3 — 320 kbps',
      type:     'audio',
      quality:  '320kbps',
      format:   bestAudio.itag,
      ext:      'mp3',
      filesize: estimateAudioSize(320, duration),
      icon:     '🎵',
    });
  }

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
    try {
      console.log(`⬇  Starting download: ${outputPath}`);
      console.log(`   Format: ${format}`);

      // format should be an itag (number) from buildDownloadOptions
      const options = { quality: parseInt(format) || 'highest' };
      const stream = ytdl(url, options);
      const file = fs.createWriteStream(outputPath);

      stream.on('progress', (chunkLength, downloaded, total) => {
        const percent = (downloaded / total) * 100;
        onProgress?.(percent);
      });

      stream.on('error', (err) => {
        fs.unlink(outputPath, () => {});
        reject(new Error(`Download failed: ${err.message}`));
      });

      file.on('error', (err) => {
        fs.unlink(outputPath, () => {});
        reject(new Error(`File write failed: ${err.message}`));
      });

      stream.pipe(file);

      file.on('finish', () => {
        if (ext === 'mp3') {
          // Convert to MP3 using ffmpeg
          const mp3Path = outputPath.replace('.mp4', '.mp3');
          convertToMp3(outputPath, mp3Path)
            .then(() => {
              fs.unlink(outputPath, () => {}); // Remove original
              console.log(`✅ Download complete: ${mp3Path}`);
              resolve(mp3Path);
            })
            .catch((err) => {
              reject(new Error(`MP3 conversion failed: ${err.message}`));
            });
        } else {
          console.log(`✅ Download complete: ${outputPath}`);
          resolve(outputPath);
        }
      });
    } catch (err) {
      reject(new Error(`Download error: ${err.message}`));
    }
  });
}

// ── Convert audio to MP3 using ffmpeg ──────────────────────
function convertToMp3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegStatic, [
      '-i', inputPath,
      '-acodec', 'libmp3lame',
      '-b:a', '192k',
      '-y',
      outputPath
    ]);

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ Converted to MP3: ${outputPath}`);
        resolve(outputPath);
      } else {
        reject(new Error(`ffmpeg process exited with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(new Error(`Failed to start ffmpeg: ${err.message}`));
    });
  });
}

export { getVideoInfo, downloadToFile, DOWNLOADS_DIR };