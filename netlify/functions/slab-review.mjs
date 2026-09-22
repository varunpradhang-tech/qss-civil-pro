const API_VERSION = '2026-09-01';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const FALLBACK_MODEL = 'gemini-3.5-flash-lite';

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

const sameOrigin = (event) => {
  const origin = event.headers?.origin;
  const requestHost = event.headers?.host || event.headers?.Host;
  const hosts = [process.env.URL, process.env.DEPLOY_PRIME_URL]
    .filter(Boolean)
    .map((url) => new URL(url).host);
  if (requestHost) hosts.push(requestHost);
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

const instruction = `Review this structural framing plan as a visual assistant only. Return polygon vertices normalized from 0 to 1000 within the tile, and set tile_index to 0 because this request contains one tile. Read the beam, wall and column faces as possible slab boundaries even when a layer name or a short face segment is missing. B, MB, and tower-prefixed B numbers identify beams, never slab panels. A beam number on a boundary is possible; a number clearly inside an alleged slab is contradictory. Focus on missing bays and incorrectly rectangular or split provisional CAD bays supplied in context. Trace the actual clear slab contour, including notches and re-entrant corners; do not replace an irregular outline with its bounding rectangle. Keep a perimeter chajja separate from adjacent room slabs and do not infer an unsupported free outer edge. If a bay needs an invented full side, return uncertain with evidence explaining that missing side. Identify voids and compare mirrored regions only as corroboration, never as sole proof. Do not merge through a beam, wall, column or expansion joint. These are proposals only: original CAD edges will be checked before quantities are calculated.`;

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
    const requestBody = JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0, thinkingConfig: { thinkingLevel: 'minimal' }, responseMimeType: 'application/json', responseSchema: reviewSchema } });
    const callModel = (model) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-QSS-API-Version': API_VERSION },
      body: requestBody,
      signal: AbortSignal.timeout(13000),
    });
    let model = MODEL;
    let response;
    try { response = await callModel(model); } catch { /* Retry once with the low-latency model. */ }
    if ((!response || [429, 503].includes(response.status)) && model !== FALLBACK_MODEL) {
      model = FALLBACK_MODEL;
      response = await callModel(model);
    }
    if (!response) return json(502, { error: 'Gemini request timed out' });
    const payload = await response.json();
    if (!response.ok) return json(response.status >= 500 ? 502 : response.status, { error: payload.error?.message || 'Gemini request failed' });
    const text = payload.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
    if (!text) return json(502, { error: 'Gemini returned no structured review' });
    let review;
    try { review = JSON.parse(text); } catch { return json(502, { error: 'Gemini returned invalid JSON' }); }
    return json(200, { model, review, authoritative: false });
  } catch (error) {
    return json(400, { error: error instanceof Error ? error.message : 'Invalid review request' });
  }
};
