import { describe, expect, it } from 'vitest';
import { AI_REVIEW_SCHEMA_VERSION, type AiPanelProposal } from '../src/ai/contracts.js';
import { polygonAreaM2, validateAiPanelProposal } from '../src/ai/review.js';

describe('AI slab review safety contract', () => {
  it('calculates proposal area deterministically instead of trusting an AI quantity', () => {
    expect(polygonAreaM2([{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }])).toBe(12);
  });

  it('rejects proposals without evidence or a usable boundary', () => {
    const proposal: AiPanelProposal = {
      schemaVersion: AI_REVIEW_SCHEMA_VERSION,
      id: 'candidate-1', shape: 'polygon', boundary: [], confidence: 1.2, evidence: [], warnings: [],
    };
    const result = validateAiPanelProposal(proposal);
    expect(result.decision).toBe('pending');
    expect(result.validationErrors.length).toBeGreaterThanOrEqual(3);
    expect(result.deterministicAreaM2).toBeUndefined();
  });

  it('adds every separate chajja outline without billing the bounding rectangle', () => {
    const boundary = [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1000 }, { x: 0, y: 1000 }];
    const other = [{ x: 5000, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 1000 }, { x: 5000, y: 1000 }];
    const record = validateAiPanelProposal({ schemaVersion: AI_REVIEW_SCHEMA_VERSION,
      id: 'chajja', shape: 'polygon', boundary, boundaryParts: [boundary, other],
      confidence: 0.5, evidence: [{ kind: 'rule-engine', sourceFile: 'plan.dwg', description: 'Two outlines', confidence: 0.5 }],
      warnings: [] });
    expect(record.validationErrors).toEqual([]);
    expect(record.deterministicAreaM2).toBe(3);
  });
});
