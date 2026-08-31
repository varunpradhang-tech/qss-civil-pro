const API_VERSION = '2026-08-31';
const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

const configured = () => !!(process.env.QSS_PROCESSOR_URL && process.env.QSS_PROCESSOR_TOKEN);
const processorUrl = (event) => {
  const base = String(process.env.QSS_PROCESSOR_URL || '').replace(/\/$/, '');
  const id = event.queryStringParameters?.id;
  if (id && !/^[A-Za-z0-9-]{8,100}$/.test(id)) throw new Error('Invalid job id');
  if (event.queryStringParameters?.health === '1') return `${base}/v1/health`;
  if (!id) return `${base}/v1/jobs`;
  return `${base}/v1/jobs/${id}${event.queryStringParameters?.start === '1' ? '/start' : ''}`;
};

const sameOrigin = (event) => {
  const origin = event.headers?.origin;
  const hosts = [process.env.URL, process.env.DEPLOY_PRIME_URL].filter(Boolean).map((url) => new URL(url).host);
  return !origin || !hosts.length || hosts.includes(new URL(origin).host);
};

export const handler = async (event) => {
  if (!sameOrigin(event)) return json(403, { error: 'Available only from this app' });
  if (event.queryStringParameters?.health === '1' && !configured()) return json(200, { configured: false, apiVersion: API_VERSION });
  if (!configured()) return json(503, { error: 'Remote drawing processing is not configured', configured: false, apiVersion: API_VERSION });
  if (!['GET', 'POST'].includes(event.httpMethod)) return json(405, { error: 'Method not allowed' });
  try {
    const response = await fetch(processorUrl(event), {
      method: event.httpMethod,
      headers: { Authorization: `Bearer ${process.env.QSS_PROCESSOR_TOKEN}`, 'Content-Type': 'application/json', 'X-QSS-API-Version': API_VERSION },
      body: event.httpMethod === 'POST' ? event.body || '{}' : undefined,
    });
    const body = await response.text();
    return { statusCode: response.status, headers: { 'Content-Type': response.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' }, body };
  } catch (error) {
    return json(502, { error: error instanceof Error ? error.message : 'Processing service unavailable' });
  }
};

