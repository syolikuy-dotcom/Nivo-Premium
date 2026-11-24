import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import { AdminTabs } from '@/components/adminUi';
import { Alert } from '@/components/ui';
import type { Msg } from '@/components/ui';
import { api } from '@/shared/api-client';
import { rupiah, dateTime } from '@/shared/format';

import { ssr } from '@/server/ssr';
import type { AdminUsersProps, AdminUserRow } from '@/shared/types';

export const getServerSideProps = ssr('adminUsers');

interface Step { password: string; code: string }
const stepBody = (s: Step) => ({ password: s.password, ...(s.code.trim() ? { code: s.code.trim() } : {}) });

function Adjust({ u, done, step }: { u: AdminUserRow; done: () => void; step: Step }) {
  const [amount, setAmount] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async (e: FormEvent) => {
    e.preventDefault(); if (busy) return; const n = parseInt(amount, 10);
    if (!n) return setErr('Isi nominal (boleh negatif).');
    if (!step.password) return setErr('Isi password konfirmasi di kotak “Verifikasi admin” di atas tabel.');
    if (!window.confirm(`${n > 0 ? 'Tambah' : 'Kurangi'} saldo @${u.username} sebesar ${rupiah(Math.abs(n))}?`)) return;
    setBusy(true); setErr('');
    try { await api(`/api/admin/users/${u.id}/balance`, { body: { amount: n, note, ...stepBody(step) } }); setAmount(''); setNote(''); done(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <details className="sus"><summary className="btn btn-line btn-sm">Saldo</summary>
      <form onSubmit={go}>{err && <Alert>{err}</Alert>}
        <input className="input" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d-]/g, '').slice(0, 9))} placeholder="Nominal, mis. 5000 atau -5000" inputMode="numeric" required />
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan" maxLength={120} />
        <button className="btn btn-primary btn-sm" disabled={busy}>Terapkan</button></form></details>
  );
}

export default function AdminUsers(props: AdminUsersProps) {
  const { rows, q, user: me } = props; const router = useRouter(); const [m, setM] = useState<Msg | null>(null);
  const refresh = () => router.replace(router.asPath, undefined, { scroll: false });
  const [pw, setPw] = useState(''); const [code, setCode] = useState('');
  const step: Step = { password: pw, code };
  const act = async (url: string, body: unknown, text: string, needStep = false) => {
    if (needStep && !pw) return setM({ k: 'danger', t: 'Isi password konfirmasi di kotak “Verifikasi admin” di atas tabel.' });
    if (!window.confirm(text)) return; setM(null);
    try { await api(url, { body: needStep ? { ...(body as object), ...stepBody(step) } : body }); setCode(''); refresh(); } catch (e) { setM({ k: 'danger', t: e.message }); }
  };
  return (
    <Layout {...props} metaTitle="Admin · Pengguna" desc="Panel admin: kelola pengguna." noindex>
      <AdminTabs />
      {m && <Alert kind={m.k}>{m.t}</Alert>}
      <div className="card" style={{ marginBottom: 12, padding: 12 }}>
        <b>Verifikasi admin</b> <small className="muted">— dibutuhkan untuk mengubah saldo dan peran pengguna{me.twofa ? ' (password + kode 2FA)' : ' (password)'}.</small>
        <div className="tools" style={{ marginTop: 8 }}>
          <input className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value.slice(0, 128))} placeholder="Password kamu" />
          {me.twofa && <input className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.slice(0, 24))} placeholder="Kode 2FA / kode pemulihan" />}
        </div>
      </div>
      <form className="tools" action="/admin/users" method="get"><input className="input" name="q" defaultValue={q} placeholder="Cari username / email" maxLength={60} /><button className="btn btn-line">Cari</button></form>
      <div className="card"><div className="tw"><table className="t"><thead><tr><th>Pengguna</th><th>Saldo</th><th>Peran</th><th>Status</th><th>Login terakhir</th><th>Aksi</th></tr></thead><tbody>
        {rows.map((u) => (
          <tr key={u.id}><td><b>{u.name}</b><br /><small className="muted">@{u.username} · {u.email}</small></td><td>{rupiah(u.balance)}</td>
            <td><span className="badge b-mute">{u.role}</span></td><td><span className={`badge ${u.status === 'active' ? 'b-ok' : 'b-bad'}`}>{u.status === 'active' ? 'Aktif' : 'Nonaktif'}</span></td>
            <td>{u.last_login_at ? dateTime(u.last_login_at) : '-'}</td>
            <td><div className="grid-actions">{u.id !== me.id && <Adjust u={u} done={() => { setCode(''); refresh(); }} step={step} />}
              {u.id !== me.id && <>
                <button className="btn btn-line btn-sm" onClick={() => act(`/api/admin/users/${u.id}/status`, { status: u.status === 'active' ? 'disabled' : 'active' }, `${u.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'} @${u.username}?`)}>{u.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}</button>
                <button className="btn btn-line btn-sm" onClick={() => act(`/api/admin/users/${u.id}/role`, { role: u.role === 'admin' ? 'user' : 'admin' }, `Ubah peran @${u.username} menjadi ${u.role === 'admin' ? 'user' : 'admin'}?`, true)}>{u.role === 'admin' ? 'Jadikan user' : 'Jadikan admin'}</button></>}
            </div></td></tr>))}
      </tbody></table></div></div>
    </Layout>
  );
}
