import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import infoRouter from './routes/info.js';
import streamRouter from './routes/stream.js';
import historyRouter from './routes/history.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (_, res) =>
  res.json({ status: 'ok', platform: process.platform, time: new Date().toISOString() })
);

app.use('/api/info',    infoRouter);
app.use('/api/stream',  streamRouter);
app.use('/api/history', historyRouter);  // ← NEW

app.use((req, res) => res.status(404).json({ error: `Route ${req.method} ${req.path} not found` }));
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;