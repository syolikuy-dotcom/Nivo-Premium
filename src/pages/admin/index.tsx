import Layout from '@/components/Layout';
import Icon from '@/components/Icon';
import { AdminTabs } from '@/components/adminUi';
import { Alert, Badge } from '@/components/ui';
import type { Msg } from '@/components/ui';
import { useState } from 'react';
import { useRouter } from 'next/router';
import { api } from '@/shared/api-client';
import { rupiah, dateTime, rupiahLoose } from '@/shared/format';

import { ssr } from '@/server/ssr';
import type { AdminHomeProps } from '@/shared/types';

export const getServerSideProps = ssr('adminHome');
const SUP: Record<string, [string, string]> = { ok: ['Normal', 'ok'], degraded: ['Terbatas / lambat', 'warn'], down: ['Gangguan (down)', 'bad'], auth: ['Kunci/IP ditolak', 'bad'], unconfigured: ['Belum dikonfigurasi', 'warn'] };
const N = (n: number) => new Intl.NumberFormat('id-ID').format(n);

export default function AdminHome(props: AdminHomeProps) {
  const { revenue, ok, inflight, attn, amReview, stats, health } = props; const sup = health.supplier;
  const router = useRouter(); const [busy, setBusy] = useState(''); const [m, setM] = useState<Msg | null>(null);
  const act = async (key: string, url: string, okMsg: string) => {
    if (busy) return; setBusy(key); setM(null);
    try { await api(url); setM({ k: 'success', t: okMsg }); router.replace(router.asPath, undefined, { scroll: false }); }
    catch (e) { setM({ k: 'danger', t: e.message }); } finally { setBusy(''); }
  };
  return (
    <Layout {...props} metaTitle="Admin" desc="Panel admin: ringkasan sistem." noindex>
      <AdminTabs />
      {m && <Alert kind={m.k}>{m.t}</Alert>}
      <div className="g4">
        <div className="card stat"><div className="lab"><span className="chip c-green"><Icon n="wallet" /></span>Saldo Premku</div><div className="v">{sup.saldo != null ? rupiah(sup.saldo) : 'N/A'}</div><div className="s">{health.lowBalance ? `Menipis (batas ${rupiah(health.threshold)}): segera top up` : sup.saldo == null && sup.lastError ? `Gagal cek: ${sup.lastError}` : 'Pesanan di-refund bila saldo ini habis'}</div></div>
        <div className="card stat"><div className="lab"><span className="chip c-blue"><Icon n="receipt" /></span>Omzet (sukses)</div><div className="v">{rupiahLoose(revenue)}</div><div className="s">{N(ok)} pesanan</div></div>
        <div className="card stat"><div className="lab"><span className="chip c-orange"><Icon n="refresh" /></span>Sedang diproses</div><div className="v">{inflight}</div><div className="s">dibayar, belum terkirim</div></div>
        <div className="card stat"><div className="lab"><span className="chip c-purple"><Icon n="users" /></span>Pelanggan</div><div className="v">{N(stats.users)}</div><div className="s">{stats.online} online</div></div>
      </div>
      <div className="card">
        <div className="ch ctr"><h2>Kesehatan sistem</h2>
          <button className="btn btn-soft btn-sm" aria-label="Cek sekarang" title="Cek sekarang" disabled={!!busy} onClick={() => act('health', '/api/admin/health', 'Status diperbarui.')}><Icon n="refresh" size={15} /><span className="btn-txt">Cek sekarang</span></button></div>
        <div className="hl">
          <div className="hi"><div className="hk">Premku (terdeteksi)</div><div className="hv"><span className={`dot ${SUP[sup.state][1]}`} />{SUP[sup.state][0]}</div><div className="hs">{sup.state === 'ok' ? (sup.lastOkAt ? `Terakhir sehat ${dateTime(sup.lastOkAt)}` : 'Belum ada panggilan') : `${sup.lastError || '-'} · ${sup.failures} gagal berturut${sup.breakerOpen ? ' · panggilan ditahan sementara' : ''}`}</div></div>
          <div className="hi"><div className="hk">Pesanan macet (&gt; {health.stuck.minutes} mnt)</div><div className="hv"><span className={`dot ${health.stuck.total ? 'bad' : 'ok'}`} />{health.stuck.total}</div><div className="hs">{health.stuck.total ? health.stuck.rows.slice(0, 3).map((r) => r.no).join(', ') : 'Tidak ada'}</div></div>
          <div className="hi"><div className="hk">Worker</div><div className="hv"><span className={`dot ${health.worker.stale ? 'bad' : 'ok'}`} />{health.worker.stale ? 'Macet' : 'Berjalan'}</div><div className="hs">{health.worker.lastTickAt ? `Detak ${dateTime(health.worker.lastTickAt)}` : '-'}</div></div>
          <div className="hi"><div className="hk">Email alert</div><div className="hv"><span className={`dot ${health.smtp && health.alertRecipients ? 'ok' : 'warn'}`} />{health.smtp ? `${health.alertRecipients} penerima` : 'SMTP belum diisi'}</div><div className="hs">{health.alerts.filter((a) => a.state === 'firing').map((a) => a.key).join(', ') || 'Tidak ada alert aktif'}</div></div>
          <div className="hi"><div className="hk">2FA admin</div><div className="hv"><span className={`dot ${health.admins.with2fa === health.admins.total ? 'ok' : 'warn'}`} />{health.admins.with2fa}/{health.admins.total}</div><div className="hs">{health.admins.with2fa === health.admins.total ? 'Semua admin aktif 2FA' : 'Aktifkan di Akun saya'}</div></div>
        </div>
      </div>
      <div className="card">
        <h2>Perlu perhatian</h2>
        {attn.length ? <div className="tw"><table className="t"><thead><tr><th>Pesanan</th><th>Pembeli</th><th>Total</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
          {attn.map((o) => (
            <tr key={o.order_no}><td>{o.order_no}<br /><small className="muted">{o.product_name} · {dateTime(o.created_at)}</small>{o.fail_reason ? <><br /><small className="pre">{o.fail_reason}</small></> : null}</td>
              <td>@{o.username}</td><td>{rupiah(o.total)}</td><td><Badge status={o.status} /></td>
              <td><div className="grid-actions">{['paid', 'processing'].includes(o.status) && <>
                <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => act(o.order_no, `/api/admin/orders/${o.order_no}/retry`, 'Dicoba kirim ulang.')}>Coba lagi</button>
                <button className="btn btn-bad btn-sm" disabled={!!busy} onClick={() => window.confirm(`Refund ${o.order_no} ke saldo pembeli? Pastikan supplier belum mengirim akun.`) && act(`r${o.order_no}`, `/api/admin/orders/${o.order_no}/refund`, 'Di-refund ke saldo.')}>Refund</button></>}</div></td></tr>))}
        </tbody></table></div> : <div className="empty">Tidak ada pesanan yang tertahan.</div>}
      </div>
      <div className="card">
        <h2>Order AM dicek admin</h2>
        {amReview.length ? <div className="tw"><table className="t"><thead><tr><th>Pesanan</th><th>Pembeli</th><th>Total</th><th>Aksi</th></tr></thead><tbody>
          {amReview.map((o) => (<tr key={o.order_no}><td>{o.order_no}<br /><small className="muted">{o.kind} {o.email || ''} · {dateTime(o.created_at)}</small></td><td>@{o.username}</td><td>{rupiah(o.total)}</td>
            <td><button className="btn btn-bad btn-sm" disabled={!!busy} onClick={() => window.confirm(`Refund ${o.order_no}? Cek dulu di dashboard Premku.`) && act(o.order_no, `/api/admin/am/${o.order_no}/refund`, 'Di-refund ke saldo.')}>Refund</button></td></tr>))}
        </tbody></table></div> : <div className="empty">Tidak ada.</div>}
      </div>
    </Layout>
  );
}
