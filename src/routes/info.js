import express from 'express';
import { getVideoInfo } from '../services/ytdlp.js';
import VideoCache from '../models/VideoCache.js';

const router = express.Router();

const YOUTUBE_REGEX =
  /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{11}/;

// POST /api/info
router.post('/', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string' || url.trim() === '') {
    return res.status(400).json({ error: 'url field is required' });
  }

  const cleanUrl = url.trim();

  if (!YOUTUBE_REGEX.test(cleanUrl)) {
    return res.status(400).json({
      error: 'Invalid YouTube URL. Paste a valid youtube.com or youtu.be link.',
    });
  }

  try {
    // ── 1. Check MongoDB cache first ──────────────────────
    const cached = await VideoCache.findOne({ url: cleanUrl });
    if (cached) {
      console.log('⚡ Cache hit for:', cleanUrl);
      return res.json({ success: true, data: cached.data, fromCache: true });
    }

    // ── 2. Not cached — fetch from yt-dlp ─────────────────
    console.log('🌐 Cache miss — fetching from yt-dlp');
    const info = await getVideoInfo(cleanUrl);

    // ── 3. Save to MongoDB cache ──────────────────────────
    await VideoCache.create({
      url:     cleanUrl,
      data:    info,
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h cache
    });
    console.log('✅ Saved to cache');

    res.json({ success: true, data: info, fromCache: false });
  } catch (err) {
    console.error('❌ Error in /api/info:', err.message);
    const errorMap = {
      VIDEO_UNAVAILABLE: { status: 404, message: 'This video is unavailable or has been removed.' },
      VIDEO_PRIVATE:     { status: 403, message: 'This video is private.' },
      VIDEO_COPYRIGHT:   { status: 451, message: 'This video is blocked due to copyright.' },
      INVALID_URL:       { status: 400, message: 'Not a valid YouTube URL.' },
      RATE_LIMITED:      { status: 429, message: 'YouTube is rate limiting this server. Please try again in a few minutes.' },
      FETCH_FAILED:      { status: 502, message: 'Could not fetch video info. Try again.' },
      PARSE_FAILED:      { status: 500, message: 'Failed to parse video data.' },
    };
    const key = err.message.toUpperCase().replace(/ /g, '_');
    const { status = 500, message = 'Internal server error' } = errorMap[key] || {};
    res.status(status).json({ error: message });
  }
});

export default router;