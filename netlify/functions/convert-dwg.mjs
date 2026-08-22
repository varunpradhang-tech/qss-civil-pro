const CLOUDCONVERT_URL = 'https://sync.api.cloudconvert.com/v2/jobs';
const MAX_DXF_BYTES = 8 * 1024 * 1024;

const response = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return response(405, { error: 'POST required' }, { Allow: 'POST' });
  const origin = event.headers?.origin;
  const allowedHosts = [process.env.URL, process.env.DEPLOY_PRIME_URL].filter(Boolean).map((url) => new URL(url).host);
  if (origin && allowedHosts.length && !allowedHosts.includes(new URL(origin).host)) return response(403, { error: 'DWG conversion is only available from this app' });
  const apiKey = process.env.CLOUDCONVERT_API_KEY;
  if (!apiKey) return response(503, { error: 'DWG export is not configured. Add CLOUDCONVERT_API_KEY in Netlify environment variables.' });

  let input;
  try { input = JSON.parse(event.body || '{}'); } catch { return response(400, { error: 'Invalid request body' }); }
  const dxf = typeof input.dxf === 'string' ? input.dxf : '';
  const safeBase = String(input.filename || 'qss-slab-panel-reference').replace(/[^A-Za-z0-9._-]/g, '-').replace(/\.dxf$/i, '').slice(0, 100);
  if (!dxf.includes('SECTION') || !dxf.includes('ENTITIES')) return response(400, { error: 'A valid reference DXF is required' });
  if (Buffer.byteLength(dxf, 'utf8') > MAX_DXF_BYTES) return response(413, { error: 'Reference drawing is too large for online DWG conversion' });

  try {
    const jobResponse = await fetch(CLOUDCONVERT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tasks: {
          'import-reference': { operation: 'import/base64', file: Buffer.from(dxf, 'utf8').toString('base64'), filename: `${safeBase}.dxf` },
          'convert-to-dwg': { operation: 'convert', input: 'import-reference', input_format: 'dxf', output_format: 'dwg', filename: `${safeBase}.dwg` },
          'export-dwg': { operation: 'export/url', input: 'convert-to-dwg' },
        },
      }),
    });
    const job = await jobResponse.json();
    if (!jobResponse.ok || job?.data?.status === 'error') {
      const failed = job?.data?.tasks?.find?.((task) => task.status === 'error');
      return response(jobResponse.status || 502, { error: failed?.message || job?.message || 'CloudConvert could not create the DWG' });
    }
    const exportTask = job?.data?.tasks?.find?.((task) => task.operation === 'export/url');
    const file = exportTask?.result?.files?.[0];
    if (!file?.url) return response(502, { error: 'CloudConvert returned no DWG download' });

    const dwgResponse = await fetch(file.url);
    if (!dwgResponse.ok) return response(502, { error: 'Converted DWG could not be downloaded' });
    const dwg = Buffer.from(await dwgResponse.arrayBuffer());
    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'Content-Type': 'application/acad',
        'Content-Disposition': `attachment; filename="${safeBase}.dwg"`,
        'Cache-Control': 'no-store',
      },
      body: dwg.toString('base64'),
    };
  } catch (error) {
    return response(502, { error: error instanceof Error ? error.message : 'DWG conversion failed' });
  }
};
