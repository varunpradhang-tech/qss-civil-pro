import { describe, expect, it } from 'vitest';

describe('parse worker source-buffer retention', () => {
  it('documents that CAD export requires a non-detached original buffer', () => {
    const original = new Uint8Array([1, 2, 3, 4]).buffer;
    const workerCopy = original.slice(0);
    expect(workerCopy).not.toBe(original);
    expect(original.byteLength).toBe(4);
    expect(new Uint8Array(workerCopy)).toEqual(new Uint8Array(original));
  });
});
