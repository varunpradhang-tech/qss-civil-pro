import {
  PROCESSING_API_VERSION,
  isCompletedProcessingJob,
  type CreateProcessingJobRequest,
  type CreateProcessingJobResponse,
  type ProcessingJobResult,
  type ProcessingJobResponse,
} from './contracts.js';
import { processingConfig } from './config.js';

async function jsonOrError<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || `Processing service returned ${response.status}`);
  return payload;
}

export async function remoteProcessingAvailable(signal?: AbortSignal): Promise<boolean> {
  if (!processingConfig.enabled) return false;
  try {
    const response = await fetch(`${processingConfig.endpoint}?health=1`, { signal, cache: 'no-store' });
    const payload = await jsonOrError<{ configured: boolean; apiVersion: string }>(response);
    return payload.configured && payload.apiVersion === PROCESSING_API_VERSION;
  } catch { return false; }
}

export async function processDrawingsRemotely(files: File[], options: CreateProcessingJobRequest['options'], signal?: AbortSignal): Promise<ProcessingJobResult> {
  const request: CreateProcessingJobRequest = {
    apiVersion: PROCESSING_API_VERSION,
    files: files.map((file) => ({ name: file.name, size: file.size, type: file.type || 'application/octet-stream' })),
    options,
  };
  const created = await jsonOrError<CreateProcessingJobResponse>(await fetch(processingConfig.endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal,
  }));
  if (created.apiVersion !== PROCESSING_API_VERSION || created.uploads.length !== files.length) throw new Error('Processing service returned an incompatible upload contract');

  await Promise.all(files.map(async (file) => {
    const target = created.uploads.find((upload) => upload.fileName === file.name);
    if (!target) throw new Error(`No secure upload target was returned for ${file.name}`);
    const upload = await fetch(target.url, { method: target.method, headers: target.headers, body: file, signal });
    if (!upload.ok) throw new Error(`Upload failed for ${file.name}`);
  }));
  await jsonOrError(await fetch(`${processingConfig.endpoint}?id=${encodeURIComponent(created.jobId)}&start=1`, { method: 'POST', signal }));

  const started = Date.now();
  while (Date.now() - started < processingConfig.timeoutMs) {
    if (signal?.aborted) throw new DOMException('Processing cancelled', 'AbortError');
    const job = await jsonOrError<ProcessingJobResponse>(await fetch(`${processingConfig.endpoint}?id=${encodeURIComponent(created.jobId)}`, { signal, cache: 'no-store' }));
    if (isCompletedProcessingJob(job)) return job.result;
    if (job.status === 'failed') throw new Error(job.error || 'Drawing processing failed');
    await new Promise((resolve) => setTimeout(resolve, processingConfig.pollIntervalMs));
  }
  throw new Error('Drawing processing timed out');
}

