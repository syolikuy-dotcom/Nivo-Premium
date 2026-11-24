'use strict';
// Supplier Premku palsu untuk uji integrasi. Bisa disuruh gagal lewat /ctl.
const http = require('http');

function createMock({ secret = 'whsec_test' } = {}) {
  const st = {
    calls: [], invoices: new Map(), orders: new Map(), seq: 1000,
    stock: new Map([[1, 100], [2, 3]]),
    products: [
      { id: 1, name: 'Alight Motion Premium', price: 1000, stock: 100, status: 'available', description: 'AM' },
      { id: 2, name: 'Canva Pro', price: 2500, stock: 3, status: 'available', description: 'Canva' },
    ],
    fail: { order: null, pay: null, pay_status: null }, // null | 'timeout500' | 'definitive' | 'empty' | 'drop'
    failCount: { order: 0, pay: 0, pay_status: 0 },
    orderDelayMs: 0,
  };
  const send = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) }); res.end(b); };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      let body = {}; try { body = JSON.parse(raw || '{}'); } catch { /* noop */ }
      const path = req.url.replace(/^\/api\//, '').split('?')[0];
      if (path.startsWith('ctl/')) {
        const [, cmd, a, b] = path.split('/');
        if (cmd === 'paid') { const inv = st.invoices.get(a); if (inv) inv.status = 'paid'; return send(res, 200, { ok: !!inv }); }
        if (cmd === 'fail') { st.fail[a] = b === 'off' ? null : b; st.failCount[a] = 0; return send(res, 200, { ok: true }); }
        if (cmd === 'delay') { st.orderDelayMs = Number(a) || 0; return send(res, 200, { ok: true }); }
        if (cmd === 'stats') return send(res, 200, { calls: st.calls.length, orderCalls: st.calls.filter((c) => c.path === 'order').length, orders: st.orders.size, byRef: [...st.orders.keys()] });
        if (cmd === 'reset') { st.calls.length = 0; st.invoices.clear(); st.orders.clear(); st.fail = { order: null, pay: null, pay_status: null }; return send(res, 200, { ok: true }); }
        return send(res, 404, {});
      }
      st.calls.push({ path, body });
      const f = st.fail[path];
      if (f) {
        st.failCount[path] += 1;
        if (f === 'timeout500') return send(res, 500, { success: false, message: 'upstream error' });
        if (f === 'definitive') return send(res, 200, { success: false, message: 'Produk tidak tersedia' });
        if (f === 'empty') return send(res, 200, { success: true, data: {} });
        if (f === 'drop') { req.socket.destroy(); return undefined; }
      }
      switch (path) {
        case 'profile': return send(res, 200, { success: true, data: { username: 'mock', saldo: 5000000 } });
        case 'products': return send(res, 200, { success: true, products: st.products.map((p) => ({ ...p, stock: st.stock.get(p.id) ?? p.stock })) });
        case 'stock': return send(res, 200, { success: true, stock: st.stock.get(Number(body.product_id)) ?? 0 });
        case 'order': {
          if (st.orderDelayMs) await new Promise((r) => setTimeout(r, st.orderDelayMs));
          const ref = String(body.ref_id);
          if (!st.orders.has(ref)) {
            const q = Number(body.qty) || 1;
            st.stock.set(Number(body.product_id), Math.max(0, (st.stock.get(Number(body.product_id)) ?? 0) - q));
            st.orders.set(ref, { invoice: `INV${++st.seq}`, accounts: Array.from({ length: q }, (_, i) => ({ username: `user${st.seq}_${i}@mail.test`, password: `Pw${st.seq}${i}x` })) });
          }
          const o = st.orders.get(ref);
          return send(res, 200, { success: true, data: { invoice: o.invoice, status: 'success', accounts: o.accounts, balance_after: 4999000 } });
        }
        case 'status': return send(res, 200, { success: true, status: 'success', data: { accounts: [] } });
        case 'pay': {
          const amount = Number(body.amount); const kode = 100 + (st.seq % 800); const inv = `PAY${++st.seq}`;
          st.invoices.set(inv, { status: 'pending', amount });
          return send(res, 200, { success: true, data: { invoice: inv, qr_raw: `00020101021226${inv}`, kode_unik: kode, total_bayar: amount + kode } });
        }
        case 'pay_status': { const i = st.invoices.get(String(body.invoice)); return send(res, 200, { success: true, data: { status: i ? i.status : 'expired' } }); }
        case 'cancel_pay': { const i = st.invoices.get(String(body.invoice)); if (i && i.status === 'pending') i.status = 'canceled'; return send(res, 200, { success: true, data: {} }); }
        case 'am': {
          if (body.action === 'buy_single') return send(res, 200, { success: true, invoice: `AMI${++st.seq}` });
          if (body.action === 'buy_bulk') return send(res, 200, { success: true, invoice: `AMB${++st.seq}`, data: Array.from({ length: Number(body.qty) }, (_, i) => ({ email: `am${i}@x.test`, link: `https://alight.link/x${i}` })) });
          return send(res, 200, { success: true, data: {} });
        }
        default: return send(res, 404, { success: false, message: 'unknown' });
      }
    });
  });
  return { server, st, secret };
}
module.exports = { createMock };
if (require.main === module) { const { server } = createMock(); server.listen(4010, '127.0.0.1', () => console.log('mock premku :4010')); }
