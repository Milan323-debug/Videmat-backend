import mongoose from 'mongoose';

// Tracks every download job — mirrors the in-memory cache
// but persisted so you can query history, stats, etc.
const downloadSchema = new mongoose.Schema(
  {
    jobId: {
      type:     String,
      required: true,
      unique:   true,
      index:    true,
    },
    url: {
      type:     String,
      required: true,
    },
    videoId: String,
    title:   String,
    thumbnail: String,
    format:  String,
    ext: {
      type:    String,
      enum:    ['mp4', 'mp3', 'webm', 'm4a'],
      default: 'mp4',
    },
    quality:  String,   // e.g. "720p", "128kbps"
    filesize: Number,   // estimated bytes
    filePath: String,   // local server path (temp)
    status: {
      type:    String,
      enum:    ['pending', 'downloading', 'done', 'error'],
      default: 'pending',
      index:   true,
    },
    progress: {
      type:    Number,
      default: 0,
      min:     0,
      max:     100,
    },
    error: {
      type:    String,
      default: null,
    },
    completedAt: Date,
  },
  {
    timestamps: true, // adds createdAt and updatedAt automatically
  }
);

export default mongoose.model('Download', downloadSchema);