import { useState } from 'react';
import type { FormEvent } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Layout from '@/components/Layout';
import { Alert, Field, PasswordInput } from '@/components/ui';
import AuthCard from '@/components/AuthCard';
import { api } from '@/shared/api-client';

import { ssr } from '@/server/ssr';
import type { ResetProps } from '@/shared/types';

export const getServerSideProps = ssr('reset');

export default function Reset(props: ResetProps) {
  const [pw, setPw] = useState(''); const [cf, setCf] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (busy) return;
    setBusy(true); setErr('');
    try { const out = await api('/api/auth/reset', { body: { token: props.token, password: pw, confirm: cf } }); window.location.assign(`${out.redirect}`); }
    catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Layout {...props} metaTitle="Password baru" desc="Buat password baru untuk akun kamu." noindex>
      <Head><meta name="referrer" content="no-referrer" /></Head>
      <AuthCard site={props.site} title="Buat password baru" sub="Setelah disimpan, semua perangkat akan keluar dan kamu perlu masuk lagi."
        alt={<Link href="/forgot-password">Minta tautan baru</Link>}>
        <form onSubmit={submit} noValidate>
          <Alert>{err}</Alert>
          <Field id="p" label="Password baru" hint="Minimal 8 karakter dengan huruf besar, huruf kecil, dan angka."><PasswordInput id="p" value={pw} onChange={setPw} autoComplete="new-password" /></Field>
          <Field id="c" label="Ulangi password baru"><PasswordInput id="c" value={cf} onChange={setCf} autoComplete="new-password" /></Field>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan password'}</button>
        </form>
      </AuthCard>
    </Layout>
  );
}
