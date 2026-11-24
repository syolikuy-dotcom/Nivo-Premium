import { useEffect, useState } from 'react';
import Link from 'next/link';
import Layout from '@/components/Layout';
import PayBox from '@/components/PayBox';
import { AccountList, Alert, Badge, CopyIcon } from '@/components/ui';
import { api } from '@/shared/api-client';
import usePoll from '@/shared/usePoll';
import { rupiah, dateTime } from '@/shared/format';

import { ssr } from '@/server/ssr';
import type { OrderProps } from '@/shared/types';

export const getServerSideProps = ssr('order');
const LIVE = ['pending', 'paid', 'processing'];

export default function OrderPage(props: OrderProps) {
  const [o, setO] = useState(props.order);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  usePoll(LIVE.includes(o.status), `/api/orders/${o.orderNo}`, setO, props.order);
  const check = async () => { setBusy(true); setErr(''); try { setO(await api(`/api/orders/${o.orderNo}?force=1`, { method: 'GET' })); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const cancel = async () => {
    if (!window.confirm('Batalkan pesanan ini?')) return;
    setBusy(true); setErr('');
    try { setO(await api(`/api/orders/${o.orderNo}/cancel`)); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const dl = `/api/orders/${o.orderNo}/download`;
  useEffect(() => {
    if (o.status !== 'success' || !o.accounts || !o.completedAt) return;
    if (Date.now() - new Date(o.completedAt).getTime() > 15 * 60e3) return;
    const key = `nivo_dl_${o.orderNo}`;
    try { if (localStorage.getItem(key) === '1') return; localStorage.setItem(key, '1'); } catch { /* abaikan: best-effort */ }
    const a = document.createElement('a'); a.href = dl; a.download = ''; document.body.appendChild(a); a.click(); a.remove();
  }, [o.status, o.accounts, o.completedAt, o.orderNo, dl]);
  return (
    <Layout {...props} metaTitle="Status transaksi" desc="Status pesanan dan akun yang sudah kamu beli." noindex>
      {o.status === 'pending' && <Alert kind="success">Pesanan dibuat. Selesaikan pembayaran sebelum batas waktu.</Alert>}
      <div className="idrow"><h1>{o.orderNo}</h1><CopyIcon text={o.orderNo} label="Salin nomor pesanan" /></div>
      <p className="muted">{dateTime(o.createdAt)}</p>
      <p><Badge status={o.status} /></p>
      <Alert kind="danger">{err}</Alert>
      {o.status === 'pending' && o.qr && <PayBox qr={o.qr} amountDue={o.amountDue} uniqueCode={o.uniqueCode} expiresAt={o.expiresAt} onCheck={check} onCancel={cancel} busy={busy} cancelLabel="Batalkan pesanan" />}
      {o.note && <Alert kind={o.status === 'failed' ? 'warning' : 'info'}>{o.note}</Alert>}
      {o.status === 'success' && o.accounts && (
        <div className="card">
          <h2>Akun kamu</h2>
          <AccountList accounts={o.accounts} />
          <p className="hint">Berkas .txt sudah diunduh otomatis saat pembayaran berhasil. Akunmu juga bisa dibuka lagi di halaman ini kapan saja.</p>
        </div>
      )}
      <div className="card">
        <h2>Rincian</h2>
        <div className="row-item"><div className="t">{o.product}<small>Akun instan × {o.qty}</small></div><span>{rupiah(o.unitPrice * o.qty)}</span></div>
        <div className="sum total"><span>Total</span><span>{rupiah(o.total)}</span></div>
        <div className="sum"><span className="muted">Metode</span><span>{o.method === 'qris' ? 'QRIS / gateway' : 'Saldo akun'}</span></div>
      </div>
      <p><Link href="/orders" className="btn btn-line btn-sm">Semua pesanan</Link></p>
    </Layout>
  );
}
