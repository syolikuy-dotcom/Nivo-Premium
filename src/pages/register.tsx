import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import Layout from '@/components/Layout';
import { Alert, Field, PasswordInput } from '@/components/ui';
import AuthCard from '@/components/AuthCard';
import Turnstile from '@/components/Turnstile';
import type { TurnstileHandle } from '@/components/Turnstile';
import GoogleButton, { OrDivider } from '@/components/GoogleButton';
import { api } from '@/shared/api-client';

import { ssr } from '@/server/ssr';
import type { RegisterProps } from '@/shared/types';

export const getServerSideProps = ssr('register');

export default function Register(props: RegisterProps) {
  const [f, setF] = useState({ name: '', username: '', email: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [cf, setCf] = useState(''); const cfRef = useRef<TurnstileHandle>(null); const needCf = Boolean(props.site.turnstile);
  const set = (k: keyof typeof f) => (v: string) => setF((o) => ({ ...o, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (busy) return;
    if (needCf && !cf) { setErr('Selesaikan verifikasi keamanan terlebih dahulu.'); return; }
    setBusy(true); setErr('');
    try { const out = await api('/api/auth/register', { body: { ...f, captcha: needCf ? cf : undefined } }); window.location.assign(out.redirect); }
    catch (x) { setErr(x.message); setBusy(false); if (cfRef.current) cfRef.current.reset(); }
  };
  return (
    <Layout {...props} metaTitle="Daftar" desc="Buat akun baru, gratis dan langsung aktif." noindex>
      <AuthCard site={props.site} title="Buat akun baru" sub="Gratis dan langsung aktif. Setelah daftar kamu langsung masuk."
        alt={<>Sudah punya akun? <Link href="/login">Masuk</Link></>}>
        <form onSubmit={submit} noValidate>
          <Alert>{err}</Alert>
          <Field id="n" label="Nama lengkap"><input id="n" className="input" value={f.name} onChange={(e) => set('name')(e.target.value)} autoComplete="name" required maxLength={80} /></Field>
          <Field id="u" label="Username" hint="3–20 karakter: huruf, angka, atau garis bawah."><input id="u" className="input" value={f.username} onChange={(e) => set('username')(e.target.value)} autoComplete="username" required maxLength={20} /></Field>
          <Field id="e" label="Email" hint="Dipakai untuk memulihkan password."><input id="e" type="email" className="input" value={f.email} onChange={(e) => set('email')(e.target.value)} autoComplete="email" required maxLength={190} /></Field>
          <Field id="p" label="Password" hint="Minimal 8 karakter dengan huruf besar, huruf kecil, dan angka."><PasswordInput id="p" value={f.password} onChange={set('password')} autoComplete="new-password" /></Field>
          <Field id="c" label="Ulangi password"><PasswordInput id="c" value={f.confirm} onChange={set('confirm')} autoComplete="new-password" /></Field>
          {props.site.google && (<><OrDivider /><GoogleButton label="Daftar dengan Google" /></>)}
          {needCf && <Turnstile ref={cfRef} siteKey={props.site.turnstile} action="register" onToken={setCf} onError={setErr} />}
          <button className="btn btn-primary" disabled={busy || (needCf && !cf)}>{busy ? 'Memproses…' : 'Buat akun'}</button>
        </form>
      </AuthCard>
    </Layout>
  );
}
