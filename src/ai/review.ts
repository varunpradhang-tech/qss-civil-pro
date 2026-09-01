import type { MemberRow } from '../takeoff/rules.js';
import { AI_REVIEW_SCHEMA_VERSION, type AiPanelProposal, type AiReviewRecord } from './contracts.js';

const finitePoint = (point: { x: number; y: number }): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

export function polygonAreaM2(points: { x: number; y: number }[]): number {
  if (points.length < 3) return 0;
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(twiceArea) / 2 / 1_000_000;
}

export function validateAiPanelProposal(proposal: AiPanelProposal): AiReviewRecord {
  const validationErrors: string[] = [];
  if (proposal.schemaVersion !== AI_REVIEW_SCHEMA_VERSION) validationErrors.push('Unsupported AI review schema.');
  if (!proposal.id.trim()) validationErrors.push('Proposal id is required.');
  if (proposal.boundary.length < 3 || proposal.boundary.some((point) => !finitePoint(point))) validationErrors.push('A finite boundary with at least three vertices is required.');
  if (!Number.isFinite(proposal.confidence) || proposal.confidence < 0 || proposal.confidence > 1) validationErrors.push('Confidence must be between 0 and 1.');
  if (!proposal.evidence.length) validationErrors.push('At least one evidence item is required.');
  if (proposal.evidence.some((item) => !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1)) validationErrors.push('Evidence confidence must be between 0 and 1.');
  if (proposal.thicknessMm != null && (!Number.isFinite(proposal.thicknessMm) || proposal.thicknessMm <= 0)) validationErrors.push('Slab thickness must be a positive number.');

  const deterministicAreaM2 = validationErrors.some((error) => error.startsWith('A finite boundary'))
    ? undefined
    : polygonAreaM2(proposal.boundary);
  if (deterministicAreaM2 != null && deterministicAreaM2 <= 0) validationErrors.push('Boundary area must be greater than zero.');

  return { proposal, decision: 'pending', validationErrors, deterministicAreaM2 };
}

function memberBoundary(member: MemberRow): { x: number; y: number }[] {
  if (member.cadPolygon && member.cadPolygon.length >= 3) return member.cadPolygon;
  if ([member.cadX0, member.cadY0, member.cadX1, member.cadY1].every((value) => Number.isFinite(value))) {
    const x0 = member.cadX0 as number;
    const y0 = member.cadY0 as number;
    const x1 = member.cadX1 as number;
    const y1 = member.cadY1 as number;
    return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  }
  return [];
}

/** Builds a read-only review queue from deterministic extraction results. */
export function buildRuleEngineReviewQueue(members: MemberRow[], sourceFile: string): AiReviewRecord[] {
  return members
    .filter((member) => member.needsReview)
    .map((member) => validateAiPanelProposal({
      schemaVersion: AI_REVIEW_SCHEMA_VERSION,
      id: `review-${member.id}`,
      memberId: member.id,
      shape: member.cadPolygon?.length === 3 ? 'triangle' : member.cadPolygon?.length ? 'polygon' : 'rectangle',
      boundary: memberBoundary(member),
      slabCode: member.member.match(/\(([^)]+)\)/)?.[1],
      thicknessMm: member.height > 0 ? member.height * 1000 : undefined,
      confidence: 0.5,
      evidence: [{
        kind: 'rule-engine',
        sourceFile,
        description: member.reviewReason || 'Deterministic extraction marked this member for review.',
        confidence: 0.5,
      }],
      warnings: member.reviewReason ? [member.reviewReason] : [],
    }));
}
