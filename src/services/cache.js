// In-memory job store — tracks download progress per jobId
import fs from 'fs';

const jobs = new Map();

/**
 * Create a new download job
 */
function createJob(id) {
  const job = {
    id,
    status:   'pending',   // pending | downloading | done | error
    progress: 0,
    filePath: null,
    error:    null,
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  return job;
}

/**
 * Update fields on an existing job
 */
function updateJob(id, updates) {
  const job = jobs.get(id);
  if (job) Object.assign(job, updates);
  return job;
}

/**
 * Get a job by ID
 */
function getJob(id) {
  return jobs.get(id) || null;
}

/**
 * Delete job + temp file after 1 hour automatically
 */
function scheduleCleanup(id, filePath) {
  setTimeout(() => {
    jobs.delete(id);
    if (filePath) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (e) {
        console.warn('Cleanup failed for', filePath, e.message);
      }
    }
  }, 60 * 60 * 1000); // 1 hour
}

export { createJob, updateJob, getJob, scheduleCleanup };