// Main-thread client for the parse worker: promise-per-file over a single worker.
import type { NormalizedDwg } from '../domain/types.js';
import type { ParseRequest, ParseResponse } from './parse.worker.js';
import { processingConfig } from '../processing/config.js';
import { processDrawingsRemotely, remoteProcessingAvailable } from '../processing/client.js';

let worker: Worker | null = null;
const pending = new Map<string, { resolve: (v: NormalizedDwg) => void; reject: (e: Error) => void }>();
let seq = 0;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<ParseResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result as NormalizedDwg);
      else p.reject(new Error(e.data.error || 'parse failed'));
    };
  }
  return worker;
}

export function parseInWorker(bytes: ArrayBuffer, fileName: string, wasmPath = '/wasm'): Promise<NormalizedDwg> {
  const w = getWorker();
  const id = `p${++seq}`;
  // Transfer a copy. Transferring `bytes` itself detaches the caller's buffer,
  // leaving a zero-byte "original" when it is later uploaded for CAD/PDF export.
  const workerBytes = bytes.slice(0);
  return new Promise<NormalizedDwg>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, bytes: workerBytes, fileName, wasmPath } satisfies ParseRequest, [workerBytes]);
  });
}

export interface ParseDrawingsResult {
  drawings: NormalizedDwg[];
  mode: 'remote' | 'local';
  warning?: string;
}

/** Remote processing is opt-in and failure-safe. Until the external processor
 * is configured and healthy, this executes the unchanged local CAD parser. */
export async function parseDrawingsWithFallback(files: File[], options: {
  drawingType: 'structural' | 'architectural'; workGroup: string; floor: string;
}, onStatus?: (message: string) => void): Promise<ParseDrawingsResult> {
  if (processingConfig.enabled && await remoteProcessingAvailable()) {
    try {
      onStatus?.('Securely uploading drawings to the QSS processing service…');
      const result = await processDrawingsRemotely(files, options);
      if (!result.drawings.length) throw new Error('The processing service returned no parsed drawings');
      return { drawings: result.drawings, mode: 'remote', warning: result.warnings.join(' · ') || undefined };
    } catch (error) {
      onStatus?.(`Remote processing unavailable; using the verified local parser. ${(error as Error).message}`);
    }
  }
  const drawings: NormalizedDwg[] = [];
  for (const file of files) {
    onStatus?.(`Parsing ${file.name} locally…`);
    drawings.push(await parseInWorker(await file.arrayBuffer(), file.name, '/wasm'));
  }
  return { drawings, mode: 'local' };
}
