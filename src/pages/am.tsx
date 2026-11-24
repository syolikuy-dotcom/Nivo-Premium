import { useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import Icon from '@/components/Icon';
import { Alert, Badge, CopyButton, Field, Qty } from '@/components/ui';
import type { Msg } from '@/components/ui';
import { api, useIdemKey, shouldRenewKey } from '@/shared/api-client';
import { rupiah, dateTime } from '@/shared/format';

import { ssr } from '@/server/ssr';
import type { AmProps, AmResult, AmView } from '@/shared/types';
import type { IconName } from '@/components/Icon';

export const getServerSideProps = ssr('am');

type Tab = AmProps['tab'];
const TABS: [Tab, IconName, string][] = [['single', 'mail', 'Eceran'], ['bulk', 'layers', 'Bulk Gen'], ['history', 'list', 'Riwayat']];
function ResultList({ rows }: { rows: AmResult[] }) {
  const text = rows.map((r) => `${r.email} | ${r.link}`).join('\n');
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0' }}><b>{rows.length} akun</b><CopyButton text={text} label="Salin semua" /></div>
      {rows.map((r, i) => (
        <div className="acct" key={i}>
          <div className="acct-no">Akun {i + 1}</div>
          <div className="acct-row"><span className="acct-l">Email</span><code>{r.email}</code><CopyButton text={r.email} /></div>
          <div className="acct-row"><span className="acct-l">Link</span><code>{r.link}</code><CopyButton text={r.link} /></div>
        </div>
      ))}
    </>
  );
}

function Pending({ o, refresh }: { o: AmView; refresh: () => void }) {
  const [link, setLink] = useState(''); const [busy, setBusy] = useState(''); const [m, setM] = useState<Msg | null>(null);
  const run = async (what: 'verify' | 'cancel') => {
    if (busy) return; if (what === 'cancel' && !window.confirm('Batalkan pesanan ini? Saldo dikembalikan.')) return;
    setBusy(what); setM(null);
    try { await api(`/api/am/${o.orderNo}/${what}`, { body: what === 'verify' ? { link } : {} }); refresh(); }
    catch (e) { setM({ k: 'danger', t: e.message }); setBusy(''); }
  };
  return (
    <div className="am-pend">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b className="pre">{o.email}</b><Badge status={o.status} /></div>
      <p className="hint">{o.orderNo} · {dateTime(o.createdAt)}</p>
      {m && <Alert kind={m.k}>{m.t}</Alert>}
      <input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://alight.link/..." maxLength={600} aria-label="Link verifikasi" />
      <div className="grid-actions" style={{ marginTop: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={() => run('verify')} disabled={!!busy || !link}>{busy === 'verify' ? 'Memverifikasi…' : 'Verifikasi'}</button>
        <button className="btn btn-bad btn-sm" onClick={() => run('cancel')} disabled={!!busy}>Batalkan</button>
      </div>
    </div>
  );
}

export default function AM(props: AmProps) {
  const { user, price, pending, history } = props;
  const router = useRouter(); const k1 = useIdemKey(); const k2 = useIdemKey();
  const [tab, setTab] = useState<Tab>(props.tab);
  const [email, setEmail] = useState(''); const [qty, setQty] = useState(5);
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState<Msg | null>(null); const [bulk, setBulk] = useState<AmResult[] | null>(null);
  const refresh = () => router.replace(router.asPath, undefined, { scroll: false });
  const short = (n: number) => user.balance < n;

  const single = async (e: FormEvent) => {
    e.preventDefault(); if (busy) return; setBusy('s'); setMsg(null);
    try {
      const o = await api<AmView>('/api/am/single', { body: { email, idemKey: k1.get() } });
      k1.renew();
      if (o.status === 'pending_verify') { setMsg({ k: 'success', t: `Link premium dikirim ke ${o.email}. Buka email, salin link lengkapnya, lalu verifikasi di bawah.` }); setEmail(''); }
      else if (o.status === 'failed') setMsg({ k: 'warning', t: 'Pesanan gagal diproses. Saldo sudah dikembalikan.' });
      else setMsg({ k: 'warning', t: 'Pesanan sedang dicek admin. Saldo kamu aman.' });
      refresh();
    } catch (x) { if (shouldRenewKey(x)) k1.renew(); setMsg({ k: 'danger', t: x.message }); } finally { setBusy(''); }
  };
  const doBulk = async (e: FormEvent) => {
    e.preventDefault(); if (busy) return; setBusy('b'); setMsg(null); setBulk(null);
    try {
      const o = await api<AmView>('/api/am/bulk', { body: { qty, idemKey: k2.get() } }); k2.renew();
      if (o.status === 'success') setBulk(o.results || []);
      else if (o.status === 'failed') setMsg({ k: 'warning', t: 'Pesanan gagal diproses. Saldo sudah dikembalikan.' });
      else setMsg({ k: 'info', t: 'Pesanan sedang diproses. Hasilnya muncul di tab Riwayat.' });
      refresh();
    } catch (x) { if (shouldRenewKey(x)) k2.renew(); setMsg({ k: 'danger', t: x.message }); } finally { setBusy(''); }
  };
  const pick = (t: Tab) => { setTab(t); setMsg(null); };

  return (
    <Layout {...props} metaTitle="Order Akun AM" desc="Generate akun Alight Motion Premium otomatis." noindex>
      <h1>Order Akun AM</h1>
      <p className="muted">Generate akun Alight Motion Premium otomatis. Saldo dikembalikan otomatis kalau gagal.</p>
      <div className="seg" role="tablist">
        {TABS.map(([t, ic, l]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => pick(t)}><Icon n={ic} size={16} />{l}</button>
        ))}
      </div>
      {msg && <Alert kind={msg.k}>{msg.t}</Alert>}

      {tab === 'single' && (
        <>
          <form className="card" onSubmit={single}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2>Eceran</h2><span className="badge b-mute">{rupiah(price)}</span></div>
            <p className="muted">Kirim link premium ke email milik kamu, lalu verifikasi dengan link dari email.</p>
            <Field id="em" label="Alamat email"><input id="em" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="kamu@gmail.com" maxLength={190} required /></Field>
            <button className="btn btn-primary btn-block" disabled={busy === 's' || short(price)}><Icon n="mail" size={16} />{busy === 's' ? 'Memproses…' : 'Kirim link premium'}</button>
            <p className="hint">Saldo kamu <b>{rupiah(user.balance)}</b> · <Link href="/deposit">Deposit</Link></p>
          </form>
          {pending.length > 0 && <div className="card"><h2>Menunggu verifikasi</h2>{pending.map((o) => <Pending key={o.orderNo} o={o} refresh={refresh} />)}</div>}
          <div className="card">
            <h2>Cara pakai</h2>
            <ol className="pre" style={{ paddingLeft: 20, lineHeight: 1.7 }}>
              <li>Masukkan email, link premium dikirim ke email itu.</li>
              <li>Buka email, salin link lengkapnya (https://alight.link/...).</li>
              <li>Tempel link di kolom verifikasi, lalu klik Verifikasi.</li>
              <li>Belum diverifikasi? Pesanan bisa dibatalkan dan saldo kembali.</li>
            </ol>
          </div>
        </>
      )}

      {tab === 'bulk' && (
        <form className="card" onSubmit={doBulk}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2>Bulk Gen</h2><span className="badge b-mute">{rupiah(price)} / akun</span></div>
          <p className="muted">Buat beberapa akun sekaligus (1–200). Hasil langsung tampil dan tersimpan di Riwayat.</p>
          <Field id="q" label="Jumlah akun"><Qty value={qty} min={1} max={200} onChange={setQty} /></Field>
          <div className="sum total"><span>Total</span><span>{rupiah(price * qty)}</span></div>
          <button className="btn btn-primary btn-block" disabled={busy === 'b' || short(price * qty)}>{busy === 'b' ? 'Memproses…' : `Generate ${qty} akun`}</button>
          {short(price * qty) && <p className="hint">Saldo kurang. <Link href="/deposit">Deposit dulu</Link>.</p>}
          {bulk && <ResultList rows={bulk} />}
        </form>
      )}

      {tab === 'history' && (
        <div className="card">
          <h2>Riwayat</h2>
          {history.length ? history.map((h) => (
            <div className="am-pend" key={h.orderNo}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b>{h.kind === 'single' ? `Eceran · ${h.email}` : `Bulk × ${h.qty}`}</b><Badge status={h.status} /></div>
              <p className="hint">{h.orderNo} · {rupiah(h.total)} · {dateTime(h.createdAt)}{h.refunded ? ' · saldo dikembalikan' : ''}</p>
              {h.results && h.results.length > 0 && <details className="manage"><summary>Lihat hasil<Icon n="chevron" size={16} /></summary><div className="inner"><ResultList rows={h.results} /></div></details>}
            </div>
          )) : <div className="empty">Belum ada riwayat.</div>}
        </div>
      )}
    </Layout>
  );
}
