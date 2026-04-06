import 'dotenv/config.js';
import app from './src/app.js';
import connectDB from './src/services/db.js';

const PORT = process.env.PORT || 3000;

// Connect to MongoDB first, then start server
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log(`║  ✅ VidMate Backend running           ║`);
    console.log(`║  📡 http://localhost:${PORT}             ║`);
    console.log(`║  🍃 MongoDB connected                 ║`);
    console.log('╚══════════════════════════════════════╝');
    console.log('');
  });
});