const API_VERSION = '2026-09-01';
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

const sameOrigin = (event) => {
  const origin = event.headers?.origin;
  const hosts = [process.env.URL, process.env.DEPLOY_PRIME_URL]
    .filter(Boolean)
    .map((url) => new URL(url).host);
  return !origin || !hosts.length || hosts.includes(new URL(origin).host);
};

const reviewSchema = {
  type: 'object',
  properties: {
    panels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          tile_index: { type: 'number' },
          type: { type: 'string', enum: ['rectangle', 'irregular_slab', 'cantilever_chajja', 'void', 'uncertain'] },
          polygon: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
          beam_refs: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'tile_index', 'type', 'polygon', 'beam_refs', 'confidence', 'evidence'],
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['panels', 'warnings'],
};

const instruction = `Review this structural framing plan as a visual assistant only. Return polygon vertices normalized from 0 to 1000 within the tile, and set tile_index to the supplied tile number. Read beam numbers and use beam faces as boundaries. Include irregular panels as polygons, keep cantilever chajjas separate unless the drawing clearly shows one continuous panel, identify voids, and compare mirrored regions when visible. Do not infer hidden boundaries, do not cross a beam, and do not merge expansion joints. These are proposals only: a CAD validator will snap and reject geometry before quantities are calculated.`;

export const handler = async (event) => {
  if (!sameOrigin(event)) return json(403, { error: 'Available only from this app' });
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!process.env.GEMINI_API_KEY) return json(503, { error: 'Gemini review is not configured' });

  try {
    const input = JSON.parse(event.body || '{}');
    const images = Array.isArray(input.images) ? input.images : [];
    if (!images.length || images.length > 12) return json(400, { error: 'Provide between 1 and 12 images' });
    const parts = [{ text: `${instruction}\nAdditional drawing context: ${String(input.context || '').slice(0, 8000)}` }];
    for (let index = 0; index < images.length; index++) {
      const image = images[index];
      if (!image || typeof image.data !== 'string' || !/^image\/(png|jpeg|webp)$/.test(image.mimeType || '')) {
        return json(400, { error: 'Each image must contain base64 data and PNG, JPEG, or WEBP mimeType' });
      }
      if (image.data.length > 15_000_000) return json(413, { error: 'Image is too large' });
      parts.push({ text: `Tile ${index}` });
      parts.push({ inline_data: { mime_type: image.mimeType, data: image.data.replace(/^data:[^;]+;base64,/, '') } });
    }
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-QSS-API-Version': API_VERSION },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: reviewSchema } }),
    });
    const payload = await response.json();
    if (!response.ok) return json(response.status >= 500 ? 502 : response.status, { error: payload.error?.message || 'Gemini request failed' });
    const text = payload.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
    if (!text) return json(502, { error: 'Gemini returned no structured review' });
    let review;
    try { review = JSON.parse(text); } catch { return json(502, { error: 'Gemini returned invalid JSON' }); }
    return json(200, { model: MODEL, review, authoritative: false });
  } catch (error) {
    return json(400, { error: error instanceof Error ? error.message : 'Invalid review request' });
  }
};
