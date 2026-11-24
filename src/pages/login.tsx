import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import Layout from '@/components/Layout';
import AuthCard from '@/components/AuthCard';
import { Alert, Field, PasswordInput } from '@/components/ui';
import Turnstile from '@/components/Turnstile';
import type { TurnstileHandle } from '@/components/Turnstile';
import GoogleButton, { OrDivider } from '@/components/GoogleButton';
import { api, safeNext } from '@/shared/api-client';
import { googleLoginMessage } from '@/shared/google';

import { ssr } from '@/server/ssr';
import type { LoginProps } from '@/shared/types';

export const getServerSideProps = ssr('login');

export default function Login(props: LoginProps) {
  const [id, setId] = useState(''); const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(googleLoginMessage(props.gerr));
  const [challenge, setChallenge] = useState(''); const [code, setCode] = useState('');
  const [cf, setCf] = useState(''); const cfRef = useRef<TurnstileHandle>(null); const needCf = Boolean(props.site.turnstile);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (busy) return;
    if (needCf && !cf) { setErr('Selesaikan verifikasi keamanan terlebih dahulu.'); return; }
    setBusy(true); setErr('');
    try {
      const out = await api('/api/auth/login', { body: { identifier: id, password: pw, captcha: needCf ? cf : undefined } });
      if (out.twofa) { setChallenge(out.challenge); setBusy(false); return; }
      window.location.assign(props.next ? safeNext(props.next) : out.redirect);
    } catch (x) { setErr(x.message); setBusy(false); if (cfRef.current) cfRef.current.reset(); }
  };
  const submit2fa = async (e: FormEvent) => {
    e.preventDefault(); if (busy) return; setBusy(true); setErr('');
    try {
      const out = await api('/api/auth/2fa', { body: { challenge, code } });
      window.location.assign(props.next ? safeNext(props.next) : out.redirect);
    } catch (x) {
      setBusy(false); setCode('');
      if (x.code === 'challenge_expired' || x.code === 'locked') { setChallenge(''); setPw(''); }
      setErr(x.message);
    }
  };
  if (challenge) return (
    <Layout {...props} metaTitle="Verifikasi 2FA" desc="Verifikasi dua langkah untuk masuk." noindex>
      <AuthCard site={props.site} title="Verifikasi dua langkah" sub="Masukkan 6 digit dari aplikasi autentikator, atau salah satu kode pemulihan.">
        <form onSubmit={submit2fa} noValidate>
          <Alert>{err}</Alert>
          <Field id="otp" label="Kode"><input id="otp" className="input codein" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={24} required autoFocus /></Field>
          <button className="btn btn-primary" disabled={busy || code.trim().length < 6}>{busy ? 'Memeriksa…' : 'Verifikasi'}</button>
          <p className="hint"><a href="/login" onClick={(e) => { e.preventDefault(); setChallenge(''); setPw(''); setCode(''); setErr(''); }}>Kembali</a></p>
        </form>
      </AuthCard>
    </Layout>
  );
  return (
    <Layout {...props} metaTitle="Masuk" desc="Masuk ke akun kamu." noindex>
      <AuthCard site={props.site} title="Masuk ke akunmu" sub="Gunakan username atau email yang kamu daftarkan."
        alt={<>Belum punya akun? <Link href="/register">Daftar gratis</Link></>}>
        <form onSubmit={submit} noValidate>
          <Alert>{err}</Alert>
          <Field id="id" label="Username atau email"><input id="id" className="input" value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" required maxLength={190} autoFocus /></Field>
          <Field id="pw" label="Password" hint={<Link href="/forgot-password">Lupa password?</Link>}><PasswordInput id="pw" value={pw} onChange={setPw} autoComplete="current-password" /></Field>
          {needCf && <Turnstile ref={cfRef} siteKey={props.site.turnstile} action="login" onToken={setCf} onError={setErr} />}
          <button className="btn btn-primary" disabled={busy || (needCf && !cf)}>{busy ? 'Memproses…' : 'Masuk'}</button>
        </form>
        {props.site.google && (<><OrDivider /><GoogleButton label="Masuk dengan Google" next={props.next ? safeNext(props.next) : ''} /></>)}
      </AuthCard>
    </Layout>
  );
}
