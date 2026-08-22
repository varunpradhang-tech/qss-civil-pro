const API = 'https://api.cloudconvert.com/v2';
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const allowed = (event) => {
  const origin = event.headers?.origin;
  const hosts = [process.env.URL, process.env.DEPLOY_PRIME_URL].filter(Boolean).map((url) => new URL(url).host);
  return !origin || !hosts.length || hosts.includes(new URL(origin).host);
};
const auth = () => ({ Authorization: `Bearer ${process.env.CLOUDCONVERT_API_KEY}`, 'Content-Type': 'application/json' });

export const handler = async (event) => {
  if (!allowed(event)) return json(403, { error: 'Available only from this app' });
  if (!process.env.CLOUDCONVERT_API_KEY) return json(503, { error: 'DWG/PDF export is not configured' });
  try {
    if (event.httpMethod === 'POST') {
      const { filename = 'drawing.dwg' } = JSON.parse(event.body || '{}');
      const ext = String(filename).toLowerCase().endsWith('.dxf') ? 'dxf' : 'dwg';
      const res = await fetch(`${API}/jobs`, { method: 'POST', headers: auth(), body: JSON.stringify({ tasks: {
        'upload-cad': { operation: 'import/upload' },
        'convert-pdf': { operation: 'convert', input: 'upload-cad', input_format: ext, output_format: 'pdf', filename: 'qss-original-cad.pdf' },
        'export-pdf': { operation: 'export/url', input: 'convert-pdf' },
      } }) });
      const payload = await res.json();
      if (!res.ok) return json(res.status, { error: payload.message || 'Could not create conversion job' });
      const upload = payload.data.tasks.find((task) => task.operation === 'import/upload');
      return json(200, { id: payload.data.id, form: upload.result.form });
    }
    if (event.httpMethod === 'GET') {
      const id = new URLSearchParams(event.rawQuery || '').get('id');
      if (!id || !/^[A-Za-z0-9-]+$/.test(id)) return json(400, { error: 'Invalid job id' });
      const res = await fetch(`${API}/jobs/${id}`, { headers: auth() });
      const payload = await res.json();
      if (!res.ok) return json(res.status, { error: payload.message || 'Could not read conversion job' });
      const job = payload.data;
      const failed = job.tasks.find((task) => task.status === 'error');
      if (failed) return json(200, { status: 'error', error: failed.message || 'CAD conversion failed' });
      const exported = job.tasks.find((task) => task.operation === 'export/url');
      return json(200, { status: job.status, url: exported?.result?.files?.[0]?.url || null });
    }
    return json(405, { error: 'Method not allowed' });
  } catch (error) { return json(502, { error: error instanceof Error ? error.message : 'CAD-to-PDF conversion failed' }); }
};
