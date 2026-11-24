import type { IncomingMessage, ServerResponse } from 'http';
import { ZodError } from 'zod';
import { AppError } from '../core/errors';
import * as log from '../core/logger';

const JSON_TYPE = /^application\/json\s*(;|$)/i;

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) { try { res.end(); } catch { /* abaikan: best-effort */ } return; }
  const data = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(data));
  res.end(data);
}
export const ok = (res: ServerResponse, data: unknown = {}, status = 200): void => sendJson(res, status, { ok: true, data });

export function toHttpError(err: any): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) return new AppError(400, 'invalid_input', err.issues[0]?.message || 'Input tidak valid.');
  log.error('unhandled', { msg: err && err.message, stack: err && err.stack });
  return new AppError(500, 'server_error', 'Terjadi kesalahan di server. Coba lagi sebentar lagi.');
}
export function sendError(res: ServerResponse, err: unknown): void {
  const e = toHttpError(err);
  sendJson(res, e.status, { ok: false, error: { code: e.code, message: e.message } });
}
export const ip = (req: IncomingMessage): string => String(req.ip || '').slice(0, 45);

export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) return reject(new AppError(413, 'too_large', 'Data terlalu besar.'));
    const chunks: Buffer[] = []; let size = 0; let done = false;
    const finish = (fn: (v: any) => void, v: unknown) => { if (done) return; done = true; req.off('data', onData); req.off('end', onEnd); req.off('error', onErr); req.off('close', onClose); fn(v); };
    const onData = (c: Buffer) => { size += c.length; if (size > limit) return finish(reject, new AppError(413, 'too_large', 'Data terlalu besar.')); chunks.push(c); return undefined; };
    const onEnd = () => finish(resolve, Buffer.concat(chunks, size));
    const onErr = (e: Error) => finish(reject, e);
    const onClose = () => { if (!req.complete) finish(reject, new AppError(400, 'aborted', 'Permintaan terputus.')); };
    req.on('data', onData); req.on('end', onEnd); req.on('error', onErr); req.on('close', onClose);
    return undefined;
  });
}

export async function readJson(req: IncomingMessage, limit: number): Promise<Record<string, any>> {
  if (!JSON_TYPE.test(String(req.headers['content-type'] || ''))) return {};
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  let v: unknown;
  try { v = JSON.parse(buf.toString('utf8')); } catch { throw new AppError(400, 'bad_json', 'Format permintaan tidak valid.'); }
  if (v === null || typeof v !== 'object') throw new AppError(400, 'bad_json', 'Format permintaan tidak valid.');
  return v as Record<string, any>;
}
