import Link from 'next/link';
import Layout from '@/components/Layout';
import { ProductGrid } from '@/components/ProductCard';
import { breadcrumbLd, itemListLd, originOf } from '@/shared/seo';

import { ssr } from '@/server/ssr';
import type { CatalogProps } from '@/shared/types';

export const getServerSideProps = ssr('catalog');

export default function Catalog(props: CatalogProps) {
  const { filters: f, categories, items, total, page, pages } = props;
  const qs = (n: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: f.q, category: f.category, min: f.min || '', max: f.max || '', sort: f.sort === 'new' ? '' : f.sort, page: n > 1 ? n : '' })) if (v) p.set(k, String(v));
    const s = p.toString(); return `/products${s ? `?${s}` : ''}`;
  };
  const filtered = Boolean(f.q || f.category || f.min || f.max || f.sort !== 'new');
  const origin = originOf(props.site);
  return (
    <Layout {...props} metaTitle="Katalog Produk Digital Premium" desc={`Katalog ${props.site.name}: aplikasi premium dan akun instan dengan harga bersahabat. Stok dan harga diperbarui otomatis, bayar via QRIS atau saldo.`} noindex={filtered} follow={filtered} canonical={filtered || page <= 1 ? '/products' : `/products?page=${page}`} ld={[breadcrumbLd(origin, [['Beranda', '/'], ['Katalog', '/products']]), itemListLd(props.site, `Katalog ${props.site.name}`, items)]}>
      <div className="wrap sec">
        <h1>Katalog</h1>
        <p className="muted"><span className="count-chip">{total}</span> produk ditemukan</p>
        <form className="card filters" action="/products" method="get">
          <input className="input f-q" name="q" defaultValue={f.q} placeholder="Cari produk" maxLength={60} aria-label="Cari produk" />
          <select className="select f-c" name="category" defaultValue={f.category} aria-label="Kategori">
            <option value="">Semua kategori</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input className="input f-n" name="min" defaultValue={f.min || ''} inputMode="numeric" placeholder="Harga min" aria-label="Harga minimum" />
          <input className="input f-n" name="max" defaultValue={f.max || ''} inputMode="numeric" placeholder="Harga maks" aria-label="Harga maksimum" />
          <select className="select f-s" name="sort" defaultValue={f.sort} aria-label="Urutkan">
            <option value="new">Terbaru</option><option value="price_asc">Harga terendah</option><option value="price_desc">Harga tertinggi</option><option value="name">Nama A–Z</option>
          </select>
          <button className="btn btn-primary f-b" type="submit">Terapkan</button>
        </form>
        {items.length ? (
          <ProductGrid items={items} />
        ) : <div className="card empty-rich"><b>Tidak ada produk yang cocok</b><p>Ubah kata kunci atau filter, lalu coba lagi.</p><Link href="/products" className="btn btn-line">Reset filter</Link></div>}
        {pages > 1 && (
          <nav className="pager" aria-label="Halaman">
            {page > 1 && <Link className="btn btn-line btn-sm" href={qs(page - 1)}>Sebelumnya</Link>}
            <span className="btn btn-soft btn-sm">Halaman {page} / {pages}</span>
            {page < pages && <Link className="btn btn-line btn-sm" href={qs(page + 1)}>Berikutnya</Link>}
          </nav>
        )}
      </div>
    </Layout>
  );
}
