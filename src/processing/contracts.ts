import type { NormalizedDwg } from '../domain/types.js';
import type { MemberRow } from '../takeoff/rules.js';

export const PROCESSING_API_VERSION = '2026-08-31' as const;

export type ProcessingJobStatus = 'created' | 'uploading' | 'queued' | 'processing' | 'completed' | 'failed';

export interface ProcessingFileMetadata {
  name: string;
  size: number;
  type: string;
}

export interface CreateProcessingJobRequest {
  apiVersion: typeof PROCESSING_API_VERSION;
  files: ProcessingFileMetadata[];
  options: {
    drawingType: 'structural' | 'architectural';
    workGroup: string;
    floor: string;
  };
}

export interface ProcessingUploadTarget {
  fileName: string;
  url: string;
  method: 'PUT' | 'POST';
  headers?: Record<string, string>;
}

export interface CreateProcessingJobResponse {
  apiVersion: typeof PROCESSING_API_VERSION;
  jobId: string;
  status: 'created';
  uploads: ProcessingUploadTarget[];
}

export interface ProcessingEvidence {
  sourceFile: string;
  sourceType: 'cad-entity' | 'schedule' | 'section' | 'drawing-note' | 'ai-reading';
  description: string;
  confidence: number;
  box?: { x0: number; y0: number; x1: number; y1: number };
}

export interface ProcessingJobResult {
  drawings: NormalizedDwg[];
  members: MemberRow[];
  evidence: Record<string, ProcessingEvidence[]>;
  warnings: string[];
  extractionVersion: number;
}

// AI may be added behind the processing service using the review-only contract
// in src/ai/contracts.ts. It must not return authoritative quantities.

export interface ProcessingJobResponse {
  apiVersion: typeof PROCESSING_API_VERSION;
  jobId: string;
  status: ProcessingJobStatus;
  progress: number;
  message?: string;
  result?: ProcessingJobResult;
  error?: string;
}

export function isCompletedProcessingJob(value: ProcessingJobResponse): value is ProcessingJobResponse & { status: 'completed'; result: ProcessingJobResult } {
  return value.apiVersion === PROCESSING_API_VERSION && value.status === 'completed' && !!value.result;
}
