import { useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import { Alert, Badge, Field } from '@/components/ui';
import { api, useIdemKey, shouldRenewKey } from '@/shared/api-client';
import { rupiah, dateTime } from '@/shared/format';

import { ssr } from '@/server/ssr';
import type { DepositProps } from '@/shared/types';

export const getServerSideProps = ssr('deposit');
const QUICK = [10000, 25000, 50000, 100000, 250000];

export default function Deposit(props: DepositProps) {
  const { list, limits, user } = props;
  const router = useRouter(); const key = useIdemKey();
  const [amount, setAmount] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (busy) return;
    setBusy(true); setErr('');
    try { const o = await api('/api/deposits', { body: { amount: parseInt(amount, 10) || 0, idemKey: key.get() } }); router.push(o.redirect); }
    catch (x) { if (shouldRenewKey(x)) key.renew(); setErr(x.message); setBusy(false); }
  };
  return (
    <Layout {...props} metaTitle="Deposit saldo" desc="Isi saldo akun lewat QRIS." noindex>
      <div className="dep-wrap">
        <h1>Deposit saldo</h1>
        <p className="muted">Saldo kamu saat ini <b>{rupiah(user.balance)}</b>. Bayar lewat QRIS, saldo bertambah otomatis.</p>
        <form className="card" onSubmit={submit}>
          <Alert>{err}</Alert>
          <Field id="amt" label="Nominal deposit" hint={`Minimal ${rupiah(limits.min)}, maksimal ${rupiah(limits.max)}.`}>
            <input id="amt" className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="Contoh 50000" required />
          </Field>
          <div className="chips">{QUICK.filter((n) => n >= limits.min && n <= limits.max).map((n) => <button type="button" key={n} className={String(n) === amount ? 'on' : ''} onClick={() => setAmount(String(n))}>{rupiah(n)}</button>)}</div>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Membuat QRIS…' : 'Buat QRIS'}</button>
        </form>
        <div className="card">
          <h2>Riwayat deposit</h2>
          {list.length ? (
            <>
            <div className="tw hide-sm"><table className="t"><thead><tr><th>No.</th><th>Nominal</th><th>Status</th><th>Tanggal</th></tr></thead>
              <tbody>{list.map((d) => <tr key={d.depositNo}><td><Link href={`/deposit/${d.depositNo}`} className="lnk">{d.depositNo}</Link></td><td className="nowrap">{rupiah(d.amount)}</td><td><Badge status={d.status === 'paid' ? 'success' : d.status} /></td><td className="nowrap">{dateTime(d.createdAt)}</td></tr>)}</tbody></table></div>
            <ul className="olist show-sm">{list.map((d) => (
              <li key={d.depositNo}>
                <Link href={`/deposit/${d.depositNo}`} className="oitem">
                  <div className="oi-top"><b className="oi-name">{rupiah(d.amount)}</b><Badge status={d.status === 'paid' ? 'success' : d.status} /></div>
                  <div className="oi-meta">{dateTime(d.createdAt)}</div>
                  <div className="oi-bot"><span className="oi-no">{d.depositNo}</span></div>
                </Link>
              </li>))}</ul>
          </>
          ) : <div className="empty">Belum ada deposit.</div>}
        </div>
      </div>
    </Layout>
  );
}
