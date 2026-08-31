import { describe, expect, it } from 'vitest';
import { PROCESSING_API_VERSION, isCompletedProcessingJob, type ProcessingJobResponse } from '../src/processing/contracts.js';

describe('remote processing contract', () => {
  it('accepts only a completed versioned job with a result', () => {
    const pending: ProcessingJobResponse = { apiVersion: PROCESSING_API_VERSION, jobId: 'job-12345678', status: 'processing', progress: 50 };
    expect(isCompletedProcessingJob(pending)).toBe(false);
    expect(isCompletedProcessingJob({ ...pending, status: 'completed' })).toBe(false);
  });
});

