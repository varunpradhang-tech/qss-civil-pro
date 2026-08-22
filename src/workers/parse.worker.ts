// Parses DWG/DXF off the main thread. libredwg's WASM + the ~15s parse no longer block the UI.
import { parseDwg } from '../parsing/parse.js';

export interface ParseRequest { id: string; bytes: ArrayBuffer; fileName: string; wasmPath: string; }
export interface ParseResponse { id: string; ok: boolean; result?: unknown; error?: string; ms?: number; }

self.onmessage = async (e: MessageEvent<ParseRequest>) => {
  const { id, bytes, fileName, wasmPath } = e.data;
  const t0 = performance.now();
  try {
    const result = await parseDwg(new Uint8Array(bytes), fileName, { wasmPath });
    (self as unknown as Worker).postMessage({ id, ok: true, result, ms: Math.round(performance.now() - t0) } satisfies ParseResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: (err as Error).message } satisfies ParseResponse);
  }
};
