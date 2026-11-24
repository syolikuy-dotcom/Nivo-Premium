import { useState } from 'react';
import type { FormEvent } from 'react';
import Layout from '@/components/Layout';
import { AdminTabs } from '@/components/adminUi';
import { Alert, Field } from '@/components/ui';
import type { Msg } from '@/components/ui';
import { api, uploadImage } from '@/shared/api-client';

import { ssr } from '@/server/ssr';
import type { AdminSettingsProps } from '@/shared/types';
import type { ChangeEvent } from 'react';

export const getServerSideProps = ssr('adminSettings');

export default function AdminSettings(props: AdminSettingsProps) {
  const s = props.s;
  const [f, setF] = useState({ site_name: s.site_name, tagline: s.tagline, logo_url: s.logo_url, notice: s.notice, wa_number: s.wa_number, contact_email: s.contact_email, instagram: s.instagram || '',
    markup_pct: String(s.markup_pct), markup_flat: String(s.markup_flat), am_price: String(s.am_price), min_deposit: String(s.min_deposit), max_deposit: String(s.max_deposit),
    low_balance_threshold: String(s.low_balance_threshold), stuck_minutes: String(s.stuck_minutes), alert_email: s.alert_email });
  const [busy, setBusy] = useState(false); const [m, setM] = useState<Msg | null>(null);
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((o) => ({ ...o, [k]: e.target.value }));
  const save = async (e: FormEvent) => {
    e.preventDefault(); if (busy) return; setBusy(true); setM(null);
    try {
      await api('/api/admin/settings', { body: { ...f, markup_pct: Number(f.markup_pct) || 0, markup_flat: parseInt(f.markup_flat, 10) || 0, am_price: parseInt(f.am_price, 10) || 0, min_deposit: parseInt(f.min_deposit, 10) || 0, max_deposit: parseInt(f.max_deposit, 10) || 0, low_balance_threshold: parseInt(f.low_balance_threshold, 10) || 0, stuck_minutes: parseInt(f.stuck_minutes, 10) || 0 } });
      setM({ k: 'success', t: 'Pengaturan disimpan. Klik “Hitung ulang harga” di menu Produk bila markup berubah.' });
    } catch (x) { setM({ k: 'danger', t: x.message }); } finally { setBusy(false); }
  };
  const pickLogo = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const url = await uploadImage(file);
      setF((o) => ({ ...o, logo_url: url }));
    } catch (x) { setM({ k: 'danger', t: x.message }); }
  };
  return (
    <Layout {...props} metaTitle="Admin · Pengaturan" desc="Panel admin: pengaturan toko." noindex>
      <AdminTabs />
      <form onSubmit={save}>
        {m && <Alert kind={m.k}>{m.t}</Alert>}
        <div className="card"><h2>Tampilan toko</h2>
          <Field id="sn" label="Nama toko"><input id="sn" className="input" value={f.site_name} onChange={set('site_name')} maxLength={40} required /></Field>
          <Field id="tg" label="Tagline"><input id="tg" className="input" value={f.tagline} onChange={set('tagline')} maxLength={120} /></Field>
          <Field id="nt" label="Banner pengumuman" hint="Kosongkan untuk menyembunyikan."><input id="nt" className="input" value={f.notice} onChange={set('notice')} maxLength={200} /></Field>
          <Field id="lg" label="Logo (URL atau upload)"><input id="lg" className="input" value={f.logo_url} onChange={set('logo_url')} maxLength={500} /></Field>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={pickLogo} aria-label="Upload logo" />
        </div>
        <div className="card"><h2>Kontak</h2>
          <Field id="wa" label="WhatsApp" hint="Angka saja dengan kode negara, contoh 62812xxxxxxx."><input id="wa" className="input" value={f.wa_number} onChange={(e) => setF({ ...f, wa_number: e.target.value.replace(/\D/g, '') })} maxLength={16} /></Field>
          <Field id="ig" label="Instagram" hint="Username saja tanpa @, contoh nivo.store."><input id="ig" className="input" value={f.instagram} onChange={(e) => setF({ ...f, instagram: e.target.value.replace(/[^A-Za-z0-9._]/g, '') })} maxLength={30} /></Field>
          <Field id="ce" label="Email kontak"><input id="ce" type="email" className="input" value={f.contact_email} onChange={set('contact_email')} maxLength={190} /></Field>
        </div>
        <div className="card"><h2>Harga & saldo</h2>
          <div className="fgrid">
            <Field id="mp" label="Markup (%)" hint="Ditambahkan ke harga modal Premku."><input id="mp" className="input" inputMode="decimal" value={f.markup_pct} onChange={set('markup_pct')} /></Field>
            <Field id="mf" label="Markup tetap (Rp)"><input id="mf" className="input" inputMode="numeric" value={f.markup_flat} onChange={(e) => setF({ ...f, markup_flat: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field id="ap" label="Harga Akun AM (Rp)"><input id="ap" className="input" inputMode="numeric" value={f.am_price} onChange={(e) => setF({ ...f, am_price: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field id="dn" label="Deposit minimal (Rp)"><input id="dn" className="input" inputMode="numeric" value={f.min_deposit} onChange={(e) => setF({ ...f, min_deposit: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field id="dx" label="Deposit maksimal (Rp)"><input id="dx" className="input" inputMode="numeric" value={f.max_deposit} onChange={(e) => setF({ ...f, max_deposit: e.target.value.replace(/\D/g, '') })} /></Field>
          </div>
        </div>
        <div className="card"><h2>Notifikasi & monitoring</h2>
          <div className="fgrid">
            <Field id="lb" label="Alert saldo Premku di bawah (Rp)" hint="0 = alert saldo dimatikan."><input id="lb" className="input" inputMode="numeric" value={f.low_balance_threshold} onChange={(e) => setF({ ...f, low_balance_threshold: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field id="sm" label="Pesanan macet setelah (menit)" hint="Dibayar tetapi belum terkirim lebih lama dari ini. 5 – 1440."><input id="sm" className="input" inputMode="numeric" value={f.stuck_minutes} onChange={(e) => setF({ ...f, stuck_minutes: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field id="ae" label="Email penerima alert" hint="Kosong = semua admin aktif. Butuh SMTP di .env."><input id="ae" type="email" className="input" value={f.alert_email} onChange={set('alert_email')} maxLength={190} /></Field>
          </div>
        </div>
        <p><button className="btn btn-primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan pengaturan'}</button></p>
      </form>
    </Layout>
  );
}
