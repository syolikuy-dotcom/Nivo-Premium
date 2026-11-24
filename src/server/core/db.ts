import * as mysql from 'mysql2/promise';
import type { Pool, PoolConnection } from 'mysql2/promise';
import { config } from './config';
import { once } from './singleton';

export type Row = Record<string, any>;
export interface Write { affectedRows: number; insertId: number }
export interface Executor {
  query<T = any>(sql: string, params?: unknown[]): Promise<T>;
  one<T = Row>(sql: string, params?: unknown[]): Promise<T | null>;
}

export const pool: Pool = once('db.pool', () => {
  const p = mysql.createPool({
    host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password, database: config.db.database,
    waitForConnections: true, connectionLimit: config.db.pool, queueLimit: 200,
    charset: 'utf8mb4', timezone: 'Z', supportBigNumbers: true, bigNumberStrings: false,
    connectTimeout: 10000, enableKeepAlive: true, keepAliveInitialDelay: 10000, multipleStatements: false,
    ssl: config.db.ssl ? { rejectUnauthorized: config.db.sslVerify, minVersion: 'TLSv1.2', ...(config.db.sslCa ? { ca: config.db.sslCa } : {}) } : undefined,
  });
  (p as any).pool.on('connection', (c: PoolConnection) => { c.query("SET time_zone='+00:00'"); });
  return p;
});

const wrap = (conn: Pool | PoolConnection): Executor => ({
  async query<T = any>(sql: string, params?: unknown[]): Promise<T> { const [r] = await conn.query(sql, params as any); return r as T; },
  async one<T = Row>(sql: string, params?: unknown[]): Promise<T | null> { const [r] = await conn.query(sql, params as any); return Array.isArray(r) ? ((r[0] as T) || null) : null; },
});

const base = wrap(pool);
export const query = base.query;
export const one = base.one;

const TX_ATTEMPTS = 5;
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Jalankan `fn` dalam satu transaksi. Deadlock (ER_LOCK_DEADLOCK) dicoba ulang dengan jeda acak, jadi `fn` harus aman diulang. */
export async function tx<T>(fn: (t: Executor) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const out = await fn(wrap(conn));
      await conn.commit();
      return out;
    } catch (e) {
      try { await conn.rollback(); } catch { /* abaikan: best-effort */ }
      if (e && (e as any).code === 'ER_LOCK_DEADLOCK' && attempt < TX_ATTEMPTS) { await pause(5 * attempt + Math.random() * 25 * attempt); continue; }
      throw e;
    } finally { conn.release(); }
  }
}
