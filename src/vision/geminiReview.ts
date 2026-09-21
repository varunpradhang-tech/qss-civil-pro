export type GeminiReviewImage = { data: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' };

export type GeminiReview = {
  panels: Array<{
    id: string;
    type: 'rectangle' | 'irregular_slab' | 'cantilever_chajja' | 'void' | 'uncertain';
    polygon: number[][];
    beam_refs: string[];
    confidence: number;
    evidence: string[];
  }>;
  warnings: string[];
};

/** Returns visual proposals only; CAD validation remains authoritative. */
export async function requestGeminiSlabReview(images: GeminiReviewImage[], context = ''): Promise<GeminiReview> {
  const response = await fetch('/.netlify/functions/slab-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images, context }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Gemini slab review failed');
  return payload.review as GeminiReview;
}
