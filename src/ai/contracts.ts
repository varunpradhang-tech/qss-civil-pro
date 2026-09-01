import type { Pt } from '../domain/types.js';

export const AI_REVIEW_SCHEMA_VERSION = '1.0' as const;

export type AiReviewDecision = 'pending' | 'accepted' | 'rejected';
export type AiPanelShape = 'rectangle' | 'triangle' | 'polygon';

export interface AiReviewEvidence {
  kind: 'boundary' | 'slab-mark' | 'schedule' | 'section' | 'dimension' | 'drawing-note' | 'rule-engine';
  sourceFile: string;
  description: string;
  confidence: number;
}

/**
 * An AI response may propose an interpretation, but it never supplies the final
 * measured quantity. Area is recalculated from `boundary` by deterministic code.
 */
export interface AiPanelProposal {
  schemaVersion: typeof AI_REVIEW_SCHEMA_VERSION;
  id: string;
  memberId?: string;
  shape: AiPanelShape;
  boundary: Pt[];
  slabCode?: string;
  thicknessMm?: number;
  confidence: number;
  evidence: AiReviewEvidence[];
  warnings: string[];
}

export interface AiReviewRecord {
  proposal: AiPanelProposal;
  decision: AiReviewDecision;
  validationErrors: string[];
  deterministicAreaM2?: number;
}

export interface AiPanelReviewRequest {
  schemaVersion: typeof AI_REVIEW_SCHEMA_VERSION;
  projectId: string;
  drawingFiles: string[];
  instruction: 'classify-and-propose-only';
  constraints: {
    quantitiesMustBeDeterministic: true;
    doNotModifyMembers: true;
    requireEvidence: true;
  };
}

export interface AiPanelReviewResponse {
  schemaVersion: typeof AI_REVIEW_SCHEMA_VERSION;
  proposals: AiPanelProposal[];
  warnings: string[];
}
