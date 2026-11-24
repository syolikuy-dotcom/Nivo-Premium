import type { IncomingMessage } from 'http';
import * as db from './db';
import * as log from './logger';

export const audit = (userId: number | null, action: string, req: IncomingMessage | null, meta?: unknown): Promise<unknown> => db.query(
  'INSERT INTO audit_log (user_id, action, ip, meta) VALUES (?,?,?,?)',
  [userId, action, String((req && req.ip) || '').slice(0, 45), meta ? JSON.stringify(meta).slice(0, 2000) : null],
).catch((e: Error) => { log.error('audit gagal ditulis', { action, user: userId, msg: e && e.message }); });
