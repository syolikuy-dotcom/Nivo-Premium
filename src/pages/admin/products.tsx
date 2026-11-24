import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import { AdminTabs } from '@/components/adminUi';
import { Alert, Field } from '@/components/ui';
import type { Msg } from '@/components/ui';
import { api, uploadImage } from '@/shared/api-client';
import { rupiah } from '@/shared/format';

import { ssr } from '@/server/ssr';
import type { AdminProductsProps, AdminProductRow } from '@/shared/types';
import type { ChangeEvent } from 'react';

export const getServerSideProps = ssr('adminProducts');

type FieldEl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
function Row({ p }: { p: AdminProductRow }) {
  const [f, setF] = useState({ name: p.name, category: p.category, description: p.description || '', price: String(p.price), active: p.active, price_locked: p.price_locked, image_url: p.image_url || '' });
  const [busy, setBusy] = useState(false); const [m, setM] = useState<Msg | null>(null);
  const set = (k: keyof typeof f) => (e: ChangeEvent<FieldEl>) => setF((o) => ({ ...o, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));
  const save = async (e: FormEvent) => {
    e.preventDefault(); if (busy) return; setBusy(true); setM(null);
    try { await api(`/api/admin/products/${p.id}`, { body: { ...f, price: parseInt(f.price, 10) || 0 } }); setM({ k: 'success', t: 'Tersimpan.' }); }
    catch (x) { setM({ k: 'danger', t: x.message }); } finally { setBusy(false); }
  };
  const pick = async (e: ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (!file) return; try { const url = await uploadImage(file); setF((o) => ({ ...o, image_url: url })); } catch (x) { setM({ k: 'danger', t: x.message }); } };
  return (
    <details className="manage icard">
      <summary><b>{p.name}</b>&nbsp;<span className="muted">· {rupiah(p.price)} · stok {p.stock} · modal {rupiah(p.cost)}{p.active ? '' : ' · nonaktif'}</span></summary>
      <form className="inner" onSubmit={save}>
        {m && <Alert kind={m.k}>{m.t}</Alert>}
        <div className="fgrid">
          <Field id={`n${p.id}`} label="Nama"><input className="input" id={`n${p.id}`} value={f.name} onChange={set('name')} maxLength={160} required /></Field>
          <Field id={`c${p.id}`} label="Kategori"><input className="input" id={`c${p.id}`} value={f.category} onChange={set('category')} maxLength={60} required /></Field>
          <Field id={`p${p.id}`} label="Harga jual (Rp)"><input className="input" id={`p${p.id}`} inputMode="numeric" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value.replace(/\D/g, '') })} required /></Field>
        </div>
        <Field id={`d${p.id}`} label="Deskripsi"><textarea className="textarea prose" id={`d${p.id}`} value={f.description} onChange={set('description')} maxLength={2000} /></Field>
        <Field id={`i${p.id}`} label="Gambar (URL https dari cdn.premku.com atau upload)" hint="Upload PNG/JPG/WebP maks 2 MB."><input className="input" id={`i${p.id}`} value={f.image_url} onChange={set('image_url')} maxLength={500} /></Field>
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={pick} aria-label="Upload gambar" />
        <label className="chk"><input type="checkbox" checked={f.active} onChange={set('active')} />Aktif (tampil di toko)</label>
        <label className="chk"><input type="checkbox" checked={f.price_locked} onChange={set('price_locked')} />Kunci harga (tidak ikut hitung ulang markup)</label>
        <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
      </form>
    </details>
  );
}

export default function AdminProducts(props: AdminProductsProps) {
  const { rows, q } = props; const router = useRouter();
  const [busy, setBusy] = useState(''); const [m, setM] = useState<Msg | null>(null);
  const act = async (key: string, url: string, fmt: (o: any) => string) => {
    if (busy) return; setBusy(key); setM(null);
    try { const o = await api(url); setM({ k: 'success', t: fmt(o) }); router.replace(router.asPath, undefined, { scroll: false }); }
    catch (e) { setM({ k: 'danger', t: e.message }); } finally { setBusy(''); }
  };
  return (
    <Layout {...props} metaTitle="Admin · Produk" desc="Panel admin: kelola produk." noindex>
      <AdminTabs />
      {m && <Alert kind={m.k}>{m.t}</Alert>}
      <div className="tools">
        <form action="/admin/products" method="get" style={{ display: 'flex', gap: 8, flex: '1 1 260px', minWidth: 0 }}><input className="input" name="q" defaultValue={q} placeholder="Cari produk" maxLength={60} /><button className="btn btn-line">Cari</button></form>
        <button className="btn btn-primary" disabled={!!busy} onClick={() => act('s', '/api/admin/sync', (o) => `Sinkron selesai: ${o.count} produk.`)}>{busy === 's' ? 'Menyinkron…' : 'Sinkron dari Premku'}</button>
        <button className="btn btn-line" disabled={!!busy} onClick={() => window.confirm('Hitung ulang harga semua produk yang tidak dikunci?') && act('r', '/api/admin/reprice', (o) => `${o.updated} harga diperbarui.`)}>Hitung ulang harga</button>
      </div>
      {rows.length ? rows.map((p) => <Row key={p.id} p={p} />) : <div className="card empty">Belum ada produk. Klik “Sinkron dari Premku”.</div>}
    </Layout>
  );
}
