import type { Executor } from '../core/db';
import { AppError } from '../core/errors';

export interface LedgerEntry { userId: number; amount: number; type: string; refType: string; refId: string | number; note?: string | null }
async function apply(t: Executor, { userId, amount, type, refType, refId, note }: LedgerEntry): Promise<{ applied: boolean; balance: number }> {
  const u = await t.one('SELECT balance FROM users WHERE id = ? FOR UPDATE', [userId]);
  if (!u) throw new AppError(404, 'user_not_found', 'Pengguna tidak ditemukan.');
  const after = Number(u.balance) + amount;
  if (after < 0) throw new AppError(402, 'insufficient_balance', 'Saldo tidak cukup. Deposit dulu.');
  try {
    await t.query('INSERT INTO ledger (user_id, type, amount, balance_after, ref_type, ref_id, note) VALUES (?,?,?,?,?,?,?)',
      [userId, type, amount, after, refType, String(refId), note ? String(note).slice(0, 160) : null]);
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') return { applied: false, balance: Number(u.balance) };
    throw e;
  }
  await t.query('UPDATE users SET balance = ? WHERE id = ?', [after, userId]);
  return { applied: true, balance: after };
}
export { apply };
