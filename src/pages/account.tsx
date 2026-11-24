import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import { Alert, CopyButton, CopyIcon, Field, PasswordInput } from '@/components/ui';
import type { Msg } from '@/components/ui';
import GoogleButton from '@/components/GoogleButton';
import { api } from '@/shared/api-client';
import { googleAccountMessage } from '@/shared/google';
import { dateLong } from '@/shared/format';

import { ssr } from '@/server/ssr';
import type { AccountProps } from '@/shared/types';

export const getServerSideProps = ssr('account');

export default function Account(props: AccountProps) {
  const { user, joined, twofa, google } = props;
  const gm = googleAccountMessage(google.flash);
  const router = useRouter();
  const [name, setName] = useState(user.name); const [pm, setPm] = useState<Msg | null>(null); const [busy, setBusy] = useState('');
  const [f, setF] = useState({ current: '', password: '', confirm: '' }); const [wm, setWm] = useState<Msg | null>(null);
  const saveProfile = async (e: FormEvent) => {
    e.preventDefault(); if (busy) return; setBusy('p'); setPm(null);
    try { await api('/api/account/profile', { body: { name } }); setPm({ k: 'success', t: 'Profil disimpan.' }); router.replace(router.asPath, undefined, { scroll: false }); }
    catch (x) { setPm({ k: 'danger', t: x.message }); } finally { setBusy(''); }
  };
  const savePw = async (e: FormEvent) => {
    e.preventDefault(); if (busy) return; setBusy('w'); setWm(null);
    try { const o = await api('/api/account/password', { body: f }); setWm({ k: 'success', t: o.message }); setF({ current: '', password: '', confirm: '' }); }
    catch (x) { setWm({ k: 'danger', t: x.message }); } finally { setBusy(''); }
  };
  const [tf, setTf] = useState<{ secret: string; qr: string } | null>(null); const [tcode, setTcode] = useState(''); const [tpw, setTpw] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null); const [tm, setTm] = useState<Msg | null>(null); const [mode, setMode] = useState<'' | 'disable' | 'recovery'>('');
  const t2 = async (key: string, url: string, body: unknown, done: (o: any) => void) => {
    if (busy) return; setBusy(key); setTm(null);
    try { done(await api(url, { body })); } catch (x) { setTm({ k: 'danger', t: x.message }); } finally { setBusy(''); }
  };
  const startSetup = () => t2('t', '/api/account/2fa/setup', {}, (o) => { setTf(o); setCodes(null); });
  const confirmSetup = (e: FormEvent) => { e.preventDefault(); t2('t', '/api/account/2fa/enable', { code: tcode }, (o) => { setCodes(o.recoveryCodes); setTf(null); setTcode(''); router.replace(router.asPath, undefined, { scroll: false }); }); };
  const confirmSensitive = (e: FormEvent) => {
    e.preventDefault();
    t2('t', mode === 'disable' ? '/api/account/2fa/disable' : '/api/account/2fa/recovery', { password: tpw, code: tcode }, (o) => {
      setTpw(''); setTcode(''); setMode('');
      if (o.recoveryCodes) { setCodes(o.recoveryCodes); setTm({ k: 'success', t: 'Kode pemulihan baru dibuat. Kode lama tidak berlaku lagi.' }); }
      else { setTm({ k: 'success', t: '2FA dinonaktifkan.' }); }
      router.replace(router.asPath, undefined, { scroll: false });
    });
  };
  return (
    <Layout {...props} metaTitle="Akun saya" desc="Kelola profil, password, dan keamanan akun kamu." noindex>
      <div className="card">
        <h2>Profil</h2>
        <dl className="dl" style={{ marginBottom: 16 }}><dt>Username</dt><dd>@{user.username}</dd><dt>Email</dt><dd>{user.email}</dd><dt>Bergabung</dt><dd>{dateLong(joined)}</dd></dl>
        <form onSubmit={saveProfile}>
          {pm && <Alert kind={pm.k}>{pm.t}</Alert>}
          <Field id="nm" label="Nama"><input id="nm" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></Field>
          <button className="btn btn-primary" disabled={busy === 'p'}>Simpan profil</button>
        </form>
      </div>
      {(google.enabled || google.linked) && (
        <div className="card">
          <h2>Login dengan Google</h2>
          {gm && <Alert kind={gm.ok ? 'success' : 'danger'}>{gm.t}</Alert>}
          {google.linked
            ? <p className="muted">Akun Google sudah terhubung. Kamu bisa masuk dengan tombol “Masuk dengan Google”. Akun yang dibuat lewat Google belum punya password: gunakan “Lupa password” di halaman masuk bila ingin membuatnya.</p>
            : <><p className="muted">Hubungkan akun Google agar bisa masuk tanpa mengetik password.</p><GoogleButton label="Hubungkan Google" mode="link" /></>}
        </div>
      )}
      <div className="card">
        <h2>Ganti password</h2>
        <form onSubmit={savePw}>
          {wm && <Alert kind={wm.k}>{wm.t}</Alert>}
          <Field id="pc" label="Password lama"><PasswordInput id="pc" value={f.current} onChange={(v) => setF({ ...f, current: v })} autoComplete="current-password" /></Field>
          <Field id="pn" label="Password baru" hint="Minimal 8 karakter dengan huruf besar, huruf kecil, dan angka."><PasswordInput id="pn" value={f.password} onChange={(v) => setF({ ...f, password: v })} autoComplete="new-password" /></Field>
          <Field id="pr" label="Ulangi password baru"><PasswordInput id="pr" value={f.confirm} onChange={(v) => setF({ ...f, confirm: v })} autoComplete="new-password" /></Field>
          <button className="btn btn-primary" disabled={busy === 'w'}>Ganti password</button>
          <p className="hint">Setelah diganti, perangkat lain akan keluar otomatis.</p>
        </form>
      </div>
      {twofa.available && (
        <div className="card">
          <h2>Autentikasi dua langkah (2FA)</h2>
          {twofa.required && !twofa.enabled && <Alert kind="warning">Panel admin mewajibkan 2FA. Aktifkan di bawah untuk membuka menu Admin.</Alert>}
          {tm && <Alert kind={tm.k}>{tm.t}</Alert>}
          {codes && (
            <div className="alert alert-warning">
              <b>Simpan kode pemulihan ini sekarang.</b> Tiap kode hanya bisa dipakai sekali bila ponselmu hilang. Kode tidak akan ditampilkan lagi.
              <div className="rcodes">{codes.map((c) => <code key={c}>{c}</code>)}</div>
              <CopyButton text={codes.join('\n')} label="Salin semua kode" />
            </div>
          )}
          {!twofa.enabled && !tf && (<><p className="muted">Lindungi akun admin dengan kode 6 digit dari aplikasi autentikator (Google Authenticator, Authy, 1Password, dll).</p><button className="btn btn-primary" onClick={startSetup} disabled={busy === 't'}>Aktifkan 2FA</button></>)}
          {tf && (
            <form onSubmit={confirmSetup}>
              <p>1. Pindai kode QR dengan aplikasi autentikator, atau masukkan kunci manual.</p>
              <img className="qr2fa" src={tf.qr} alt="Kode QR untuk 2FA" width={200} height={200} />
              <p className="hint">Kunci manual: <span className="keybox">{tf.secret}</span> <CopyIcon text={tf.secret} label="Salin kunci manual" /></p>
              <Field id="tc" label="2. Masukkan 6 digit dari aplikasi"><input id="tc" className="input codein" value={tcode} onChange={(e) => setTcode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8} required /></Field>
              <button className="btn btn-primary" disabled={busy === 't' || tcode.trim().length < 6}>Aktifkan</button>
            </form>
          )}
          {twofa.enabled && !mode && (
            <>
              <p className="muted">2FA aktif. Kode pemulihan tersisa: <b>{twofa.recoveryLeft}</b>.</p>
              <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="btn btn-line btn-sm" onClick={() => setMode('recovery')}>Buat ulang kode pemulihan</button><button className="btn btn-bad btn-sm" onClick={() => setMode('disable')}>Nonaktifkan 2FA</button></p>
            </>
          )}
          {twofa.enabled && mode && (
            <form onSubmit={confirmSensitive}>
              <p className="muted">{mode === 'disable' ? 'Konfirmasi dengan password dan kode 2FA untuk menonaktifkan.' : 'Konfirmasi dengan password dan kode 2FA untuk membuat kode pemulihan baru.'}</p>
              <Field id="sp" label="Password"><PasswordInput id="sp" value={tpw} onChange={setTpw} autoComplete="current-password" /></Field>
              <Field id="sc" label="Kode 2FA atau kode pemulihan"><input id="sc" className="input" value={tcode} onChange={(e) => setTcode(e.target.value)} autoComplete="one-time-code" maxLength={24} required /></Field>
              <p style={{ display: 'flex', gap: 8 }}><button className={`btn ${mode === 'disable' ? 'btn-bad' : 'btn-primary'}`} disabled={busy === 't'}>{mode === 'disable' ? 'Nonaktifkan' : 'Buat kode baru'}</button><button type="button" className="btn btn-line" onClick={() => { setMode(''); setTpw(''); setTcode(''); }}>Batal</button></p>
            </form>
          )}
        </div>
      )}
    </Layout>
  );
}
