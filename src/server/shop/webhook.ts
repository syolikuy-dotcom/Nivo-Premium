import * as crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import * as sec from '../auth/security';
import * as db from '../core/db';
import { config } from '../core/config';
import * as premku from './premku';
import * as orders from './orders';
import * as log from '../core/logger';
import { audit } from '../core/audit';
import { isDup } from '../core/errors';
import { sendJson } from '../http/http';

export async function webhook(req: IncomingMessage, res: ServerResponse) {
  try {
    if (!config.premku.apiSecret) return sendJson(res, 503, { ok: false });
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const given = String(req.headers['x-premku-signature'] || '');
    const want = crypto.createHmac('sha256', config.premku.apiSecret).update(raw).digest('hex');
    if (!given || !sec.safeEqual(given, want)) return sendJson(res, 403, { ok: false });

    let body; try { body = JSON.parse(raw.toString('utf8')); } catch { return sendJson(res, 400, { ok: false }); }
    const d = body && body.data;
    if (!body || body.event !== 'order.success' || !d || typeof d.ref_id !== 'string') return sendJson(res, 200, { received: true, ignored: true });

    const key = sec.sha256(`${body.event}|${d.invoice}|${d.ref_id}`);
    try { await db.query('INSERT INTO webhook_events (dedupe_key, event, ref_id) VALUES (?,?,?)', [key, body.event, d.ref_id.slice(0, 64)]); }
    catch (e) { if (isDup(e)) return sendJson(res, 200, { received: true, duplicate: true }); throw e; }

    const work = (async () => {
      try {
        const result = await orders.applyWebhookSuccess({ refId: d.ref_id, invoice: d.invoice, qty: Number(d.qty), accounts: premku.extractAccounts(body) });
        if (result === 'conflict' || result === 'mismatch') await audit(null, `webhook_${result}`, req, { ref: d.ref_id, invoice: d.invoice });
        log.info('webhook diproses', { ref: d.ref_id, result });
      } catch (e) {
        await db.query('DELETE FROM webhook_events WHERE dedupe_key = ?', [key]).catch((x) => log.error('hapus penanda webhook gagal', { msg: x.message }));
        throw e;
      }
    })();
    let timer: NodeJS.Timeout | undefined;
    const first = await Promise.race([
      work.then(() => 'done' as const, (e) => { log.error('webhook error', { msg: e.message }); return 'error' as const; }),
      new Promise<'slow'>((r) => { timer = setTimeout(() => r('slow'), 3000); }),
    ]);
    if (timer) clearTimeout(timer);
    if (first === 'error') return sendJson(res, 500, { ok: false });
    if (first === 'slow') { work.catch(() => {}); return sendJson(res, 200, { received: true, queued: true }); }
    return sendJson(res, 200, { received: true });
  } catch (e) {
    log.error('webhook error', { msg: e.message });
    return sendJson(res, 500, { ok: false });
  }
}
