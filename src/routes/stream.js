import express from 'express';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { downloadToFile, DOWNLOADS_DIR } from '../services/ytdlp.js';
import { createJob, updateJob, getJob, scheduleCleanup } from '../services/cache.js';
import Download from '../models/Download.js';
import History from '../models/History.js';

const router = express.Router();

// ── POST /api/stream/start ───────────────────────────────
router.post('/start', async (req, res) => {
  const { url, format, ext, filename, videoId, title, thumbnail,
          uploader, duration, quality, filesize, type } = req.body;

  if (!url || !format) {
    return res.status(400).json({ error: 'url and format are required' });
  }

  const jobId   = uuidv4();
  const safeExt = ['mp4', 'mp3', 'webm'].includes(ext) ? ext : 'mp4';
  const safeName = (filename || jobId)
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);

  const outputPath = path.join(DOWNLOADS_DIR, `${jobId}_${safeName}.${safeExt}`);

  // ── 1. Save job to MongoDB ────────────────────────────
  await Download.create({
    jobId,
    url,
    videoId,
    title,
    thumbnail,
    format,
    ext:     safeExt,
    quality,
    filesize,
    status:  'pending',
    progress: 0,
  });

  // ── 2. Also register in in-memory cache for fast polling ──
  createJob(jobId);
  res.json({ success: true, jobId });

  // ── 3. Background download ────────────────────────────
  downloadToFile(url, format, outputPath, safeExt, async (progress) => {
    const rounded = Math.round(progress);
    // Update in-memory (fast, for polling)
    updateJob(jobId, { status: 'downloading', progress: rounded });
    // Update MongoDB every 10% to reduce write load
    if (rounded % 10 === 0) {
      await Download.findOneAndUpdate(
        { jobId },
        { status: 'downloading', progress: rounded }
      );
    }
  })
    .then(async (filePath) => {
      // ── Success ─────────────────────────────────────
      updateJob(jobId, { status: 'done', progress: 100, filePath });
      scheduleCleanup(jobId, filePath);

      // Update download record
      await Download.findOneAndUpdate(
        { jobId },
        { status: 'done', progress: 100, filePath, completedAt: new Date() }
      );

      // Create history record
      await History.create({
        jobId, url, videoId, title, thumbnail,
        uploader, duration, quality,
        ext: safeExt, filesize, type,
      });

      console.log(`✅ Job ${jobId} saved to history`);
    })
    .catch(async (err) => {
      // ── Failure ─────────────────────────────────────
      console.error(`❌ Job ${jobId} failed:`, err.message);
      updateJob(jobId, { status: 'error', error: err.message });
      await Download.findOneAndUpdate(
        { jobId },
        { status: 'error', error: err.message }
      );
    });
});

// ── GET /api/stream/status/:jobId ────────────────────────
// Uses in-memory cache for speed (no DB read on every poll)
router.get('/status/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found or expired.' });
  res.json({
    id:       job.id,
    status:   job.status,
    progress: job.progress,
    error:    job.error || null,
  });
});

// ── GET /api/stream/file/:jobId ──────────────────────────
router.get('/file/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);

  if (!job)                                    return res.status(404).json({ error: 'Job not found or expired.' });
  if (job.status === 'pending' ||
      job.status === 'downloading')            return res.status(202).json({ error: 'File not ready yet.' });
  if (job.status === 'error')                  return res.status(500).json({ error: job.error });
  if (!job.filePath ||
      !fs.existsSync(job.filePath))            return res.status(410).json({ error: 'File expired or deleted.' });

  const stat     = fs.statSync(job.filePath);
  const ext      = path.extname(job.filePath).slice(1).toLowerCase();
  const mimeMap  = { mp4: 'video/mp4', mp3: 'audio/mpeg', webm: 'video/webm', m4a: 'audio/mp4' };
  const mimeType = mimeMap[ext] || 'application/octet-stream';
  const basename = path.basename(job.filePath);
  const range    = req.headers.range;

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end   = endStr ? parseInt(endStr, 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range':  `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges':  'bytes',
      'Content-Length': end - start + 1,
      'Content-Type':   mimeType,
    });
    fs.createReadStream(job.filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Type':        mimeType,
      'Content-Length':      stat.size,
      'Content-Disposition': `attachment; filename="${basename}"`,
      'Accept-Ranges':       'bytes',
    });
    fs.createReadStream(job.filePath).pipe(res);
  }
});

export default router;