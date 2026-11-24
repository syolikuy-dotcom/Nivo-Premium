export class AppError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.name = 'AppError'; this.status = status; this.code = code; }
}
export const isDup = (e: any, key?: string): boolean => Boolean(e && e.code === 'ER_DUP_ENTRY' && (!key || String(e.sqlMessage || '').includes(key)));
