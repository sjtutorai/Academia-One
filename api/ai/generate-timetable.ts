import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  AiTimetableHttpError,
  generateAiTimetable,
  type AiTimetableRequestPayload,
} from '../../server/aiTimetable.js';

type VercelReq = IncomingMessage & {
  body?: unknown;
};

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

async function readJsonBody(req: VercelReq): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object') {
    return req.body as Record<string, unknown>;
  }
  if (typeof req.body === 'string' && req.body.trim()) {
    return JSON.parse(req.body) as Record<string, unknown>;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

export default async function handler(req: VercelReq, res: VercelRes) {
  if (req.method && req.method !== 'POST') {
    sendJson(res, 405, { error: { status: 'METHOD_NOT_ALLOWED', message: 'Only POST is supported.' } });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const result = await generateAiTimetable(body as unknown as AiTimetableRequestPayload);
    sendJson(res, 200, result);
  } catch (err) {
    if (err instanceof AiTimetableHttpError) {
      sendJson(res, err.statusCode, {
        error: { status: err.errorStatus, message: err.message },
      });
      return;
    }
    sendJson(res, 500, {
      error: {
        status: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Unable to generate AI timetable.',
      },
    });
  }
}
