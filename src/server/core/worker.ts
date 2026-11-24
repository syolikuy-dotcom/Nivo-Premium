import * as db from './db';
import * as log from './logger';
import * as orders from '../shop/orders';
import * as deposits from '../shop/deposits';
import * as am from '../shop/am';
import * as notify from '../shop/notify';
import * as monitor from '../shop/monitor';
import * as heartbeat from './heartbeat';

let timer: NodeJS.Timeout | undefined; let janitor: NodeJS.Timeout | undefined; let watcher: NodeJS.Timeout | undefined; let busy = false; let busySince = 0;
const HUNG_MS = 5 * 60e3;
const SWEEPS: [string, () => Promise<void>][] = [['orders', orders.sweep], ['deposits', deposits.sweep], ['am', am.sweep], ['notify', notify.sweep]];
async function tick() {
  if (busy) {
    if (Date.now() - busySince < HUNG_MS) return;
    log.error('worker: tick sebelumnya macet >5 menit, dilanjutkan paksa', { menit: Math.round((Date.now() - busySince) / 60e3) });
  }
  busy = true; busySince = Date.now(); const mine = busySince; heartbeat.beat();
  // Tiap sweep dipisah: satu yang gagal (mis. kueri DB error) tidak boleh membuat sweep lain (deposit, AM, email) ikut dilewati.
  for (const [name, fn] of SWEEPS) {
    try { await fn(); } catch (e) { log.error('worker error', { sweep: name, msg: e.message }); }
  }
  if (busySince === mine) busy = false;
  heartbeat.beat();
}
async function cleanup() {
  try {
    const now = new Date();
    await db.query('DELETE FROM sessions WHERE expires_at < ?', [now]);
    await db.query('DELETE FROM password_resets WHERE expires_at < ?', [new Date(now.getTime() - 864e5)]);
    await db.query('DELETE FROM webhook_events WHERE created_at < ?', [new Date(now.getTime() - 30 * 864e5)]);
    await db.query("DELETE FROM audit_log WHERE created_at < ? AND action IN ('login_failed','twofa_failed')", [new Date(now.getTime() - 90 * 864e5)]);
  } catch (e) { log.error('cleanup error', { msg: e.message }); }
}
function start() {
  heartbeat.markStarted();
  timer = setInterval(tick, 10000); janitor = setInterval(cleanup, 3600e3); watcher = setInterval(() => { monitor.check(); }, 60e3);
  timer.unref(); janitor.unref(); watcher.unref();
  setTimeout(tick, 3000).unref(); setTimeout(cleanup, 5000).unref(); setTimeout(() => { monitor.check(); }, 20e3).unref();
}
function stop() { clearInterval(timer); clearInterval(janitor); clearInterval(watcher); }
export { start, stop };
