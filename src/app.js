import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import infoRouter from './routes/info.js';
import streamRouter from './routes/stream.js';
import historyRouter from './routes/history.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (_, res) =>
  res.json({ status: 'ok', platform: process.platform, time: new Date().toISOString() })
);

app.get('/', (_, res) =>
  res.json({
    name: 'VidMate Backend',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      info: 'POST /api/info',
      stream: 'POST /api/stream/start',
      jobs: 'GET /api/stream/jobs/:jobId',
      history: 'GET /api/history'
    }
  })
);

app.use('/api/info',    infoRouter);
app.use('/api/stream',  streamRouter);
app.use('/api/history', historyRouter);  // ← NEW

// Temporary debug route — remove after fixing
app.get('/debug/cookies', (req, res) => {
  const cookiePath = path.join(__dirname, '../cookies/youtube.txt');
  const b64Env     = process.env.YOUTUBE_COOKIES_B64;

  const info = {
    cookieFileExists:  fs.existsSync(cookiePath),
    cookieFileSize:    fs.existsSync(cookiePath)
                         ? fs.readFileSync(cookiePath, 'utf-8').length
                         : 0,
    b64EnvSet:         !!b64Env,
    b64EnvLength:      b64Env ? b64Env.length : 0,
    platform:          process.platform,
    ytdlpPath:         process.env.YTDLP_PATH,
    ffmpegPath:        process.env.FFMPEG_PATH,
  };

  res.json(info);
});

app.use((req, res) => res.status(404).json({ error: `Route ${req.method} ${req.path} not found` }));
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;