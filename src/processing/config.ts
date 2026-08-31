export interface ProcessingConfig {
  enabled: boolean;
  endpoint: string;
  pollIntervalMs: number;
  timeoutMs: number;
}

const enabled = String(import.meta.env.VITE_QSS_REMOTE_PROCESSING || '').toLowerCase() === 'true';

export const processingConfig: ProcessingConfig = {
  enabled,
  endpoint: '/.netlify/functions/processing-job',
  pollIntervalMs: 1500,
  timeoutMs: 10 * 60 * 1000,
};

