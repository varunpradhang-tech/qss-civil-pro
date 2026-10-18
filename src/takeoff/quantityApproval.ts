import { RULES, type CapMode, type MemberRow } from './rules.js';

const ENGINEERING_KEYS: (keyof MemberRow)[] = [
  'length', 'breadth', 'height', 'capHeight', 'capExposedPerimeter',
  'slabThickness', 'slabThicknessSide1', 'slabThicknessSide2', 'innerSideCount',
  'sideLength', 'bottomJointDeduction', 'sideJointDeduction', 'columnCapDeduction',
  'supportWidths', 'dia', 'spacing', 'nos', 'openings', 'netArea',
  'cadX0', 'cadY0', 'cadX1', 'cadY1', 'cadPolygon', 'cadPolygonParts',
];

export function engineeringInputSignature(member: MemberRow): string {
  return JSON.stringify(ENGINEERING_KEYS.map((key) => [key, member[key] ?? null]));
}

export function isApprovedMember(member: MemberRow, quantityKey?: string): boolean {
  return member.quantityStatus === 'approved'
    && !!member.approvalSource
    && (!quantityKey || !member.approvedQuantityKey || member.approvedQuantityKey === quantityKey)
    && member.approvedInputSignature === engineeringInputSignature(member);
}

function hasMeasuredArea(member: MemberRow): boolean {
  return (member.netArea != null && member.netArea > 0)
    || (member.length > 0 && member.breadth > 0);
}

export function automaticApprovalFailure(member: MemberRow, workGroup: string): string | undefined {
  if (member.needsReview) return member.reviewReason || 'member requires review';
  if (!member.measurementSource) return 'measurement evidence source is missing';
  if (!(member.nos > 0)) return 'member count is missing';
  if (workGroup === 'slab') {
    if (!hasMeasuredArea(member)) return 'verified slab geometry is missing';
    if (!(member.height > 0)) return 'verified slab thickness is missing';
    return undefined;
  }
  if (workGroup === 'beam') {
    if (!(member.length > 0 && member.breadth > 0 && member.height > 0)) return 'verified beam dimensions are missing';
    if (!(member.sideLength > 0)) return 'verified beam side length is missing';
    return undefined;
  }
  return 'automatic approval is not supported for this member type';
}

export function applyAutomaticApproval(member: MemberRow, workGroup: string): MemberRow {
  const failure = automaticApprovalFailure(member, workGroup);
  if (failure) return { ...member, quantityStatus: 'provisional', approvalSource: undefined, approvedInputSignature: undefined };
  const approved = { ...member, quantityStatus: 'approved' as const, approvalSource: 'automatic-validation' as const };
  approved.approvedInputSignature = engineeringInputSignature(approved);
  return approved;
}

export function manualApprovalFailure(member: MemberRow, quantityKey: string): string | undefined {
  if (!(member.nos > 0)) return 'member count must be greater than zero';
  if (/^slab_/.test(quantityKey)) {
    if (!hasMeasuredArea(member)) return 'slab length and breadth or exact area are required';
    if (quantityKey === 'slab_concrete' && !(member.height > 0)) return 'slab thickness is required';
    return undefined;
  }
  if (/^beam_/.test(quantityKey)) {
    if (!(member.length > 0 && member.breadth > 0 && member.height > 0)) return 'beam length, width and depth are required';
    return undefined;
  }
  if (!(member.length > 0 && member.breadth > 0)) return 'required engineering dimensions are missing';
  return undefined;
}

export interface QuantitySummary {
  approvedTotal: number;
  provisionalTotal: number;
  approvedMembers: MemberRow[];
  provisionalMembers: MemberRow[];
}

export function summarizeQuantities(members: MemberRow[], quantityKey: string, capMode: CapMode): QuantitySummary {
  const rule = RULES[quantityKey];
  const approvedMembers = members.filter((member) => isApprovedMember(member, quantityKey));
  const provisionalMembers = members.filter((member) => !isApprovedMember(member, quantityKey));
  return {
    approvedTotal: approvedMembers.reduce((sum, member) => sum + rule.calculate(member, capMode), 0),
    provisionalTotal: provisionalMembers.reduce((sum, member) => sum + rule.calculate(member, capMode), 0),
    approvedMembers,
    provisionalMembers,
  };
}

export function approveMember(member: MemberRow, quantityKey: string): MemberRow {
  const failure = manualApprovalFailure(member, quantityKey);
  if (failure) return { ...member, quantityStatus: 'provisional', reviewReason: failure };
  const priorReason = member.reviewReason;
  const approved = {
    ...member,
    needsReview: false,
    reviewReason: undefined,
    quantityStatus: 'approved' as const,
    approvalSource: 'user-confirmation' as const,
    approvedQuantityKey: quantityKey,
    approvalNote: priorReason,
  };
  approved.approvedInputSignature = engineeringInputSignature(approved);
  return approved;
}

export function invalidateApproval(member: MemberRow, reason = 'engineering inputs changed after approval'): MemberRow {
  return {
    ...member,
    quantityStatus: 'provisional',
    approvalSource: undefined,
    approvedQuantityKey: undefined,
    approvedInputSignature: undefined,
    needsReview: true,
    reviewReason: reason,
  };
}
