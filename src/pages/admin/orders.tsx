import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import { AdminTabs } from '@/components/adminUi';
import { Alert, Badge } from '@/components/ui';
import type { Msg } from '@/components/ui';
import { api } from '@/shared/api-client';
import { rupiah, dateTime } from '@/shared/format';

import { ssr } from '@/server/ssr';
import type { AdminOrdersProps } from '@/shared/types';

export const getServerSideProps = ssr('adminOrders');
const ST = ['', 'pending', 'paid', 'processing', 'success', 'failed', 'canceled', 'expired'];

export default function AdminOrders(props: AdminOrdersProps) {
  const { rows, status } = props; const router = useRouter(); const [m, setM] = useState<Msg | null>(null); const [busy, setBusy] = useState('');
  const act = async (no: string, what: 'retry' | 'refund', text: string) => {
    if (busy || !window.confirm(text)) return; setBusy(no); setM(null);
    try { await api(`/api/admin/orders/${no}/${what}`); router.replace(router.asPath, undefined, { scroll: false }); } catch (e) { setM({ k: 'danger', t: e.message }); } finally { setBusy(''); }
  };
  return (
    <Layout {...props} metaTitle="Admin · Pesanan" desc="Panel admin: kelola pesanan." noindex>
      <AdminTabs />
      {m && <Alert kind={m.k}>{m.t}</Alert>}
      <div className="tabs">{ST.map((s) => <Link key={s || 'all'} href={s ? `/admin/orders?status=${s}` : '/admin/orders'} className={status === s ? 'on' : ''}>{s || 'Semua'}</Link>)}</div>
      <div className="card"><div className="tw"><table className="t"><thead><tr><th>Pesanan</th><th>Pembeli</th><th>Total</th><th>Metode</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
        {rows.map((o) => (
          <tr key={o.order_no}><td>{o.order_no}<br /><small className="muted">{o.product_name} × {o.qty} · {dateTime(o.created_at)}</small>{o.fail_reason ? <><br /><small className="pre">{o.fail_reason}</small></> : null}</td>
            <td>@{o.username}</td><td>{rupiah(o.total)}</td><td>{o.pay_method}</td><td><Badge status={o.status} />{o.refunded ? <><br /><small className="muted">refund</small></> : null}</td>
            <td><div className="grid-actions">{['paid', 'processing'].includes(o.status) && <>
              <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => act(o.order_no, 'retry', 'Coba kirim ulang pesanan ini?')}>Coba lagi</button>
              <button className="btn btn-bad btn-sm" disabled={!!busy} onClick={() => act(o.order_no, 'refund', 'Refund ke saldo pembeli? Pastikan supplier belum mengirim akun.')}>Refund</button></>}</div></td></tr>))}
      </tbody></table></div>{!rows.length && <div className="empty">Tidak ada pesanan.</div>}</div>
    </Layout>
  );
}
