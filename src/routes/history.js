import express from 'express';
import History from '../models/History.js';
import Download from '../models/Download.js';

const router = express.Router();

// GET /api/history — get all history, newest first
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const page  = Math.max(parseInt(req.query.page)  || 1,  1);
    const skip  = (page - 1) * limit;

    const [items, total] = await Promise.all([
      History.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      History.countDocuments(),
    ]);

    res.json({
      success: true,
      data:    items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('Error fetching history:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// DELETE /api/history — clear all history
router.delete('/', async (req, res) => {
  try {
    await History.deleteMany({});
    res.json({ success: true, message: 'History cleared' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear history' });
  }
});

// DELETE /api/history/:id — delete one entry
router.delete('/:id', async (req, res) => {
  try {
    await History.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Entry deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

// GET /api/history/stats — fun stats for the app
router.get('/stats', async (req, res) => {
  try {
    const [total, byType, byQuality] = await Promise.all([
      History.countDocuments(),
      History.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }]),
      History.aggregate([{ $group: { _id: '$quality', count: { $sum: 1 } } }]),
    ]);

    res.json({ success: true, data: { total, byType, byQuality } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

export default router;