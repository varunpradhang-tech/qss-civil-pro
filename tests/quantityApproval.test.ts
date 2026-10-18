import { describe, expect, it } from 'vitest';
import { emptyRow, type MemberRow } from '../src/takeoff/rules.js';
import {
  applyAutomaticApproval, approveMember, engineeringInputSignature,
  invalidateApproval, isApprovedMember, summarizeQuantities,
} from '../src/takeoff/quantityApproval.js';

function slab(over: Partial<MemberRow> = {}): MemberRow {
  return { ...emptyRow('s1'), member: 'P1 (S1)', length: 4, breadth: 3, height: 0.15,
    slabThickness: 0.15, measurementSource: 'drawing geometry', ...over };
}

describe('approved and provisional quantity policy', () => {
  it('does not treat needsReview=false as approval by itself', () => {
    const member = slab({ needsReview: false });
    expect(isApprovedMember(member)).toBe(false);
    expect(summarizeQuantities([member], 'slab_shuttering', 'excluded')).toMatchObject({
      approvedTotal: 0, provisionalTotal: 12,
    });
  });

  it('automatically approves only a complete extracted member with measurement evidence', () => {
    const approved = applyAutomaticApproval(slab(), 'slab');
    expect(isApprovedMember(approved)).toBe(true);
    expect(approved.approvalSource).toBe('automatic-validation');
    expect(summarizeQuantities([approved], 'slab_shuttering', 'excluded').approvedTotal).toBe(12);
    expect(isApprovedMember(applyAutomaticApproval(slab({ measurementSource: undefined }), 'slab'))).toBe(false);
  });

  it('supports explicit approval and invalidates it after an engineering input changes', () => {
    const approved = approveMember(slab({ needsReview: true, reviewReason: 'confirm dimensions' }), 'slab_shuttering');
    expect(isApprovedMember(approved)).toBe(true);
    expect(approved.approvalSource).toBe('user-confirmation');
    expect(approved.approvalNote).toBe('confirm dimensions');
    const edited = invalidateApproval({ ...approved, length: 5 });
    expect(isApprovedMember(edited)).toBe(false);
    expect(edited.reviewReason).toContain('engineering inputs changed');
  });

  it('rejects explicit approval when required engineering inputs are missing', () => {
    const result = approveMember(slab({ length: 0, breadth: 0, netArea: undefined }), 'slab_shuttering');
    expect(isApprovedMember(result)).toBe(false);
    expect(result.reviewReason).toContain('required');
  });

  it('rejects an approved flag whose engineering signature is stale', () => {
    const member = slab({ quantityStatus: 'approved', approvalSource: 'user-confirmation' });
    member.approvedInputSignature = engineeringInputSignature(member);
    expect(isApprovedMember(member)).toBe(true);
    member.length = 5;
    expect(isApprovedMember(member)).toBe(false);
  });

  it('does not reuse a manual approval for a different quantity rule', () => {
    const approved = approveMember(slab({ height: 0 }), 'slab_shuttering');
    expect(isApprovedMember(approved, 'slab_shuttering')).toBe(true);
    expect(isApprovedMember(approved, 'slab_concrete')).toBe(false);
    expect(summarizeQuantities([approved], 'slab_concrete', 'excluded').approvedTotal).toBe(0);
  });
});
