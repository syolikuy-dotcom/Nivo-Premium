import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import { ProductImg, Qty } from '@/components/ui';
import { rupiah } from '@/shared/format';
import { breadcrumbLd, clip, originOf, productLd } from '@/shared/seo';

import { ssr } from '@/server/ssr';
import type { ProductProps } from '@/shared/types';

export const getServerSideProps = ssr('product');

export default function ProductPage(props: ProductProps) {
  const { product: p } = props;
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const buy = () => router.push(`/checkout?p=${encodeURIComponent(p.slug)}&qty=${qty}`);
  return (
    <Layout {...props} metaTitle={`Beli ${p.name}`} desc={clip(`Beli ${p.name} di ${props.site.name} hanya ${rupiah(p.price)}. ${p.description || 'Akun instan dikirim otomatis setelah pembayaran.'}`, 160)} keywords={`${p.name.toLowerCase()}, beli ${p.name.toLowerCase()}, ${p.category.toLowerCase()}, nivo premium, akun premium`} canonical={`/products/${p.slug}`} ogType="product" ogImage={p.image} ld={[productLd(props.site, p), breadcrumbLd(originOf(props.site), [['Beranda', '/'], ['Katalog', '/products'], [p.name, `/products/${p.slug}`]])]}>
      <div className="wrap sec">
        <p className="muted"><Link href="/products">Katalog</Link> / {p.name}</p>
        <div className="pd">
          <ProductImg src={p.image} name={p.name} logoFit />
          <div>
            <div className="card">
              <span className="badge b-mute">{p.category}</span>
              <h1>{p.name}</h1>
              <p className="lbl">Pilih varian</p>
              <label className="vopt">
                <input type="radio" name="variant" defaultChecked readOnly />
                <span style={{ flex: '1 1 150px', minWidth: 0 }}><b>Akun instan</b><br /><small className="muted">Dikirim otomatis setelah pembayaran · Stok {p.stock}</small></span>
                <b>{rupiah(p.price)}</b>
              </label>
              <div className="row between" style={{ margin: '14px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="lbl" style={{ margin: 0 }}>Jumlah</span>
                <Qty value={qty} max={Math.max(1, Math.min(50, p.stock))} onChange={setQty} />
              </div>
              <button className="btn btn-primary btn-block btn-lg" onClick={buy} disabled={!p.available}>{p.available ? 'Beli sekarang' : 'Stok habis'}</button>
            </div>
            <div className="card">
              <h2>Deskripsi</h2>
              <p className="pre">{p.description || 'Belum ada deskripsi untuk produk ini.'}</p>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
