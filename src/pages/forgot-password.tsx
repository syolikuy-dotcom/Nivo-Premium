import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import Layout from '@/components/Layout';
import { Alert, Field } from '@/components/ui';
import AuthCard from '@/components/AuthCard';
import Turnstile from '@/components/Turnstile';
import type { TurnstileHandle } from '@/components/Turnstile';
import { api } from '@/shared/api-client';

import { ssr } from '@/server/ssr';
import type { ForgotProps } from '@/shared/types';

export const getServerSideProps = ssr('forgot');

export default function Forgot(props: ForgotProps) {
  const [email, setEmail] = useState(''); const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(''); const [done, setDone] = useState('');
  const [cf, setCf] = useState(''); const cfRef = useRef<TurnstileHandle>(null); const needCf = Boolean(props.site.turnstile);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (busy) return;
    if (needCf && !cf) { setErr('Selesaikan verifikasi keamanan terlebih dahulu.'); return; }
    setBusy(true); setErr('');
    try { const out = await api('/api/auth/forgot', { body: { email, captcha: needCf ? cf : undefined } }); setDone(out.message); }
    catch (x) { setErr(x.message); if (cfRef.current) cfRef.current.reset(); } finally { setBusy(false); }
  };
  return (
    <Layout {...props} metaTitle="Lupa password" desc="Minta tautan untuk membuat password baru." noindex>
      <AuthCard site={props.site} title="Lupa password" sub="Masukkan email akunmu. Kami kirim tautan untuk membuat password baru."
        alt={<Link href="/login">Kembali ke halaman masuk</Link>}>
        {done ? <Alert kind="success">{done}</Alert> : (
          <form onSubmit={submit} noValidate>
            <Alert>{err}</Alert>
            <Field id="e" label="Email"><input id="e" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required maxLength={190} autoFocus /></Field>
            {needCf && <Turnstile ref={cfRef} siteKey={props.site.turnstile} action="forgot" onToken={setCf} onError={setErr} />}
            <button className="btn btn-primary" disabled={busy || (needCf && !cf)}>{busy ? 'Mengirim…' : 'Kirim tautan reset'}</button>
          </form>
        )}
      </AuthCard>
    </Layout>
  );
}
