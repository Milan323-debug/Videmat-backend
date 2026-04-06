import mongoose from 'mongoose';

// Clean history record shown to the user in the app
// Created only when a download successfully completes
const historySchema = new mongoose.Schema(
  {
    jobId:     { type: String, required: true, index: true },
    url:       { type: String, required: true },
    videoId:   String,
    title:     { type: String, default: 'Unknown Title' },
    thumbnail: String,
    uploader:  String,
    duration:  Number,
    quality:   String,
    ext:       String,
    filesize:  Number,
    type: {
      type: String,
      enum: ['video', 'audio'],
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model('History', historySchema);