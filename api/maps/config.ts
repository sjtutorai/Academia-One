import type { IncomingMessage, ServerResponse } from 'node:http';

type VercelRes = ServerResponse & {
  status?: (code: number) => VercelRes;
  json?: (body: unknown) => void;
};

function sendJson(res: VercelRes, statusCode: number, payload: unknown) {
  if (typeof res.status === 'function') {
    const nextRes = res.status(statusCode);
    if (typeof nextRes.json === 'function') {
      nextRes.json(payload);
      return;
    }
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export default function handler(req: IncomingMessage, res: VercelRes) {
  if (req.method && req.method !== 'GET') {
    sendJson(res, 405, { error: { status: 'METHOD_NOT_ALLOWED', message: 'Only GET is supported.' } });
    return;
  }
  const apiKey = (process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '').trim();
  sendJson(res, 200, { apiKey, configured: Boolean(apiKey) });
}
