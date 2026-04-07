import { video_basic_info, video_info, stream } from 'play-dl';
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
    
    const info = await video_basic_info(url);
    const video = info.video_details;
    
    // Get detailed info for formats
    const detailed = await video_info(url);
    const formats = detailed.format || [];
    
    return parseVideoInfo(video, formats);
  } catch (err) {
    console.error('❌ play-dl error:', err.message);
    
    if (err.message.includes('unavailable')) throw new Error('VIDEO_UNAVAILABLE');
    if (err.message.includes('Private')) throw new Error('VIDEO_PRIVATE');
    if (err.message.includes('copyright')) throw new Error('VIDEO_COPYRIGHT');
    
    throw new Error('FETCH_FAILED');
  }
}

// ── Parse play-dl data into clean frontend-friendly object ──
function parseVideoInfo(video, formats) {
  const options = buildDownloadOptions(formats, video.lengthSeconds);

  return {
    id:          video.id,
    title:       video.title || 'Unknown Title',
    thumbnail:   video.thumbnails?.[video.thumbnails.length - 1]?.url || '',
    duration:    parseInt(video.lengthSeconds) || 0,
    uploader:    video.channel?.name || 'Unknown',
    viewCount:   parseInt(video.viewCount) || 0,
    likeCount:   0,
    description: (video.description || '').slice(0, 300),
    webpage_url: `https://www.youtube.com/watch?v=${video.id}`,
    options,
  };
}

// ── Build user-facing download options ───────────────────
function buildDownloadOptions(formats, duration) {
  const options = [];

  // Handle both array of formats and play-dl's format structure
  const formatArray = Array.isArray(formats) ? formats : (formats?.list || []);

  if (formatArray.length > 0) {
    // Video options
    const videoFormats = formatArray.filter(f => f.hasVideo).slice(0, 6);
    videoFormats.forEach(f => {
      const height = f.qualityLabel?.match(/\d+/)?.[0] || '360';
      options.push({
        id:       `video_${height}p`,
        label:    parseInt(height) >= 720 ? `${height}p HD` : `${height}p`,
        type:     'video',
        quality:  `${height}p`,
        format:   f.itag,
        ext:      'mp4',
        filesize: f.contentLength ? parseInt(f.contentLength) : estimateVideoSize(parseInt(height), duration),
        icon:     parseInt(height) >= 720 ? '🎬' : '📹',
      });
    });

    // Audio options
    const audioFormats = formatArray.filter(f => f.hasAudio && !f.hasVideo);
    if (audioFormats.length > 0) {
      options.push({
        id:       'audio_mp3_128',
        label:    'MP3 — 128 kbps',
        type:     'audio',
        quality:  '128kbps',
        format:   audioFormats[0].itag,
        ext:      'mp3',
        filesize: estimateAudioSize(128, duration),
        icon:     '🎵',
      });

      options.push({
        id:       'audio_mp3_320',
        label:    'MP3 — 320 kbps',
        type:     'audio',
        quality:  '320kbps',
        format:   audioFormats[0].itag,
        ext:      'mp3',
        filesize: estimateAudioSize(320, duration),
        icon:     '🎵',
      });
    }
  } else {
    // Fallback if no formats available
    options.push(
      {
        id: 'video_720p',
        label: '720p HD',
        type: 'video',
        quality: '720p',
        format: 'auto',
        ext: 'mp4',
        filesize: estimateVideoSize(720, duration),
        icon: '🎬',
      },
      {
        id: 'audio_mp3_128',
        label: 'MP3 — 128 kbps',
        type: 'audio',
        quality: '128kbps',
        format: 'auto',
        ext: 'mp3',
        filesize: estimateAudioSize(128, duration),
        icon: '🎵',
      }
    );
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

      stream(url, { quality: parseInt(format) || 18 })
        .then(s => {
          const file = fs.createWriteStream(outputPath);
          
          let downloadedSize = 0;

          s.on('data', (chunk) => {
            downloadedSize += chunk.length;
          });

          s.on('error', (err) => {
            fs.unlink(outputPath, () => {});
            reject(new Error(`Stream error: ${err.message}`));
          });

          file.on('error', (err) => {
            fs.unlink(outputPath, () => {});
            reject(new Error(`File write failed: ${err.message}`));
          });

          s.pipe(file);

          file.on('finish', () => {
            if (ext === 'mp3') {
              const mp3Path = outputPath.replace('.mp4', '.mp3');
              convertToMp3(outputPath, mp3Path)
                .then(() => {
                  fs.unlink(outputPath, () => {});
                  console.log(`✅ Download complete: ${mp3Path}`);
                  resolve(mp3Path);
                })
                .catch((err) => reject(new Error(`MP3 conversion failed: ${err.message}`)));
            } else {
              console.log(`✅ Download complete: ${outputPath}`);
              resolve(outputPath);
            }
          });
        })
        .catch(err => reject(new Error(`Play-dl stream error: ${err.message}`)));
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