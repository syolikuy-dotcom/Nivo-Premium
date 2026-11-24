import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import { Alert, Qty } from '@/components/ui';
import { api, useIdemKey, shouldRenewKey } from '@/shared/api-client';
import { rupiah } from '@/shared/format';

import { ssr } from '@/server/ssr';
import type { CheckoutProps } from '@/shared/types';

export const getServerSideProps = ssr('checkout');

export default function Checkout(props: CheckoutProps) {
  const { product: p, user } = props;
  const router = useRouter();
  const key = useIdemKey();
  const [qty, setQty] = useState(props.qty);
  const [method, setMethod] = useState('qris');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const total = p.price * qty;
  const short = user.balance < total;

  const pay = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const out = await api('/api/orders', { body: { productId: p.id, qty, method, idemKey: key.get() } });
      router.push(out.redirect);
    } catch (e) {
      if (shouldRenewKey(e)) key.renew();
      setErr(e.message); setBusy(false);
    }
  };
  return (
    <Layout {...props} metaTitle="Checkout" desc="Selesaikan pembayaran pesanan kamu." noindex>
      <div className="wrap sec">
        <h1>Checkout</h1>
        <div className="card">
          <h2>Ringkasan pesanan</h2>
          <div className="row-item">
            <div className="t">{p.name}<small>Akun instan · {rupiah(p.price)}</small></div>
            <Qty value={qty} max={Math.max(1, Math.min(50, p.stock))} onChange={setQty} />
          </div>
          <div className="sum"><span>Subtotal</span><span>{rupiah(total)}</span></div>
          <div className="sum total"><span>Total</span><span>{rupiah(total)}</span></div>
          <p className="hint">Ubah jumlah lalu klik tombol bayar. Total akhir dihitung ulang di server.</p>
        </div>
        <div className="card">
          <h2>Metode pembayaran</h2>
          <label className="vopt"><input type="radio" name="m" checked={method === 'qris'} onChange={() => setMethod('qris')} />
            <span><b>QRIS / transfer via gateway</b><br /><small className="muted">Bayar lewat e-wallet atau m-banking, dicek otomatis</small></span></label>
          <label className={`vopt${short ? ' off' : ''}`}><input type="radio" name="m" disabled={short} checked={method === 'balance'} onChange={() => setMethod('balance')} />
            <span><b>Saldo akun</b><br /><small className="muted">Saldo kamu: {rupiah(user.balance)}{short ? ' (kurang, deposit dulu)' : ''}</small></span></label>
          {short && <p className="hint"><Link href="/deposit">Deposit saldo</Link></p>}
        </div>
        <p className="terms" style={{ margin: '14px 0' }}>Dengan membayar, kamu menyetujui syarat penggunaan produk ini.</p>
        <Alert>{err}</Alert>
        <button className="btn btn-primary btn-block btn-lg" onClick={pay} disabled={busy}>{busy ? 'Memproses…' : `Bayar ${rupiah(total)}`}</button>
      </div>
    </Layout>
  );
}
