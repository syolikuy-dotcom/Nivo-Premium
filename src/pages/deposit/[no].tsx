import { useState } from 'react';
import Link from 'next/link';
import Layout from '@/components/Layout';
import PayBox from '@/components/PayBox';
import { Alert, Badge, CopyIcon } from '@/components/ui';
import { api } from '@/shared/api-client';
import usePoll from '@/shared/usePoll';
import { rupiah, dateTime } from '@/shared/format';

import { ssr } from '@/server/ssr';
import type { DepositViewProps } from '@/shared/types';

export const getServerSideProps = ssr('depositView');

export default function DepositView(props: DepositViewProps) {
  const [d, setD] = useState(props.deposit);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  usePoll(d.status === 'pending', `/api/deposits/${d.depositNo}`, setD, props.deposit);
  const check = async () => { setBusy(true); setErr(''); try { setD(await api(`/api/deposits/${d.depositNo}?force=1`, { method: 'GET' })); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const cancel = async () => {
    if (!window.confirm('Batalkan deposit ini?')) return;
    setBusy(true); setErr('');
    try { setD(await api(`/api/deposits/${d.depositNo}/cancel`)); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Layout {...props} metaTitle="Status deposit" desc="Status pembayaran deposit saldo kamu." noindex>
      <div className="idrow"><h1>{d.depositNo}</h1><CopyIcon text={d.depositNo} label="Salin nomor deposit" /></div>
      <p className="muted">{dateTime(d.createdAt)} · Deposit {rupiah(d.amount)}</p>
      <p><Badge status={d.status === 'paid' ? 'success' : d.status} /></p>
      <Alert>{err}</Alert>
      {d.status === 'pending' && d.qr && <PayBox qr={d.qr} amountDue={d.amountDue} uniqueCode={d.uniqueCode} expiresAt={d.expiresAt} onCheck={check} onCancel={cancel} busy={busy} cancelLabel="Batalkan deposit" />}
      {d.status === 'paid' && <Alert kind="success">Pembayaran diterima. Saldo kamu bertambah {rupiah(d.amount)}.</Alert>}
      {['expired', 'canceled', 'failed'].includes(d.status) && <Alert kind="warning">Deposit ini sudah tidak aktif. Buat deposit baru kalau masih ingin mengisi saldo.</Alert>}
      <p><Link href="/deposit" className="btn btn-line btn-sm">Kembali ke deposit</Link></p>
    </Layout>
  );
}
