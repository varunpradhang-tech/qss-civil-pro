// Shared numeric helpers. round3 kills float artifacts (0.1+0.2) on any value that reaches a
// quantity, coordinate, or export — used across parsing, extraction, rules, and exports.
export const round3 = (n: number): number => Math.round(n * 1000) / 1000;
