import mongoose from 'mongoose';

// Stores fetched video info so the same URL
// doesn't hit yt-dlp again within 30 minutes
const videoCacheSchema = new mongoose.Schema({
  url: {
    type:     String,
    required: true,
    unique:   true,
    index:    true,
  },
  videoId: {
    type: String,
    required: true,
  },
  data: {
    type: mongoose.Schema.Types.Mixed, // stores the full parsed video info object
    required: true,
  },
  cachedAt: {
    type:    Date,
    default: Date.now,
    // Auto-delete documents after 30 minutes
    expires: 1800,
  },
});

export default mongoose.model('VideoCache', videoCacheSchema);