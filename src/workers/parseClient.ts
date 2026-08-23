// Main-thread client for the parse worker: promise-per-file over a single worker.
import type { NormalizedDwg } from '../domain/types.js';
import type { ParseRequest, ParseResponse } from './parse.worker.js';

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
