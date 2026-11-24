import * as db from '../core/db';
import * as mailer from '../auth/mailer';
import * as settings from '../core/settings';
import * as log from '../core/logger';

const MAX_TRIES = 3;
type Result = 'sent' | 'skipped' | 'failed' | 'noop';

async function sendOrderConfirmation(orderId: number): Promise<Result> {
  if (!mailer.smtpEnabled()) return 'skipped';
  const claimed = await db.query("UPDATE orders SET notified_at = ? WHERE id = ? AND status = 'success' AND notified_at IS NULL AND notify_tries < ?", [new Date(), orderId, MAX_TRIES]);
  if (claimed.affectedRows !== 1) return 'noop';
  let no = String(orderId);
  try {
    const o = await db.one('SELECT o.order_no, o.product_name, o.qty, o.total, o.pay_method, o.completed_at, u.email, u.name FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?', [orderId]);
    if (!o) return 'noop';
    no = o.order_no;
    const s = await settings.get();
    const sent = await mailer.sendOrderConfirmation({ to: o.email, name: o.name, siteName: s.site_name, orderNo: o.order_no, product: o.product_name, qty: o.qty, total: Number(o.total), method: o.pay_method, completedAt: o.completed_at });
    if (!sent) throw new Error('SMTP tidak aktif');
    return 'sent';
  } catch (e) {
    await db.query('UPDATE orders SET notified_at = NULL, notify_tries = notify_tries + 1 WHERE id = ?', [orderId]).catch(() => {});
    log.warn('email konfirmasi pesanan gagal', { order: no, msg: e.message });
    return 'failed';
  }
}

function queue(orderId: number): void {
  if (!mailer.smtpEnabled()) return;
  setImmediate(() => { sendOrderConfirmation(orderId).catch((e) => log.error('notify error', { msg: e.message })); });
}

async function sweep(): Promise<void> {
  if (!mailer.smtpEnabled()) return;
  const rows = await db.query(
    "SELECT id FROM orders WHERE status = 'success' AND notified_at IS NULL AND notify_tries < ? AND completed_at > ? AND (notify_tries = 0 OR updated_at < ?) ORDER BY id LIMIT 20",
    [MAX_TRIES, new Date(Date.now() - 2 * 3600e3), new Date(Date.now() - 120e3)]);
  for (const r of rows) await sendOrderConfirmation(r.id);
}

export { sendOrderConfirmation, queue, sweep, MAX_TRIES };
