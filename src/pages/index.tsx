import Link from 'next/link';
import Layout from '@/components/Layout';
import Icon from '@/components/Icon';
import { ProductGrid } from '@/components/ProductCard';
import { faqLd, organizationLd, websiteLd } from '@/shared/seo';

import { ssr } from '@/server/ssr';
import type { HomeProps } from '@/shared/types';
import type { IconName } from '@/components/Icon';

const STEPS: [IconName, string, string][] = [
  ['layers', 'Pilih produk', 'Cari di katalog lalu tentukan jumlahnya.'],
  ['wallet', 'Bayar', 'Scan QRIS atau pakai saldo akunmu.'],
  ['bolt', 'Terima akun', 'Akun muncul otomatis begitu pembayaran terkonfirmasi.'],
];

export const getServerSideProps = ssr('home');

const FAQ = [
  ['Berapa lama produk dikirim?', 'Produk akun instan dikirim otomatis begitu pembayaran terkonfirmasi, biasanya dalam hitungan detik. Hasilnya muncul di halaman pesanan dan tersimpan di menu Pesanan saya.'],
  ['Bagaimana cara membayar?', 'Pilih QRIS lalu scan lewat e-wallet atau m-banking, atau pakai saldo akun yang kamu isi lewat menu Deposit. Status pembayaran dicek otomatis, tidak perlu refresh.'],
  ['Bagaimana kalau pesanan gagal?', 'Kalau pesanan tidak bisa diproses, dana otomatis dikembalikan ke saldo akunmu. Kamu bisa memakainya untuk membeli produk lain.'],
  ['Apakah ada garansi?', 'Garansi mengikuti keterangan di halaman tiap produk. Baca deskripsinya sebelum membeli.'],
];

export default function Home(props: HomeProps) {
  const { site, stats, popular, user } = props;
  const cards: [IconName, string, string, number, string][] = [
    ['bag', 'c-green', 'Produk terjual', stats.sold, 'dari semua pesanan sukses'],
    ['receipt', 'c-blue', 'Transaksi sukses', stats.trx, 'selesai dan terkirim'],
    ['users', 'c-purple', 'Pelanggan', stats.users, `+${stats.today} hari ini`],
    ['pulse', 'c-orange', 'Sedang online', stats.online, 'dalam 5 menit terakhir'],
  ];
  return (
    <Layout {...props} metaTitle={`${site.name} – ${site.tagline}`} desc={`${site.name} adalah toko produk digital premium: aplikasi premium, akun instan, dan tools kreator dengan harga bersahabat. Bayar via QRIS atau saldo, akun langsung terkirim otomatis.`} canonical="/" ld={[organizationLd(site), websiteLd(site), faqLd(FAQ as [string, string][])]}>
      <div className="wrap">
        <section className="hero">
          <div className="hero-card">
            <span className="eyebrow"><Icon n="bolt" />Akun premium instan</span>
            <h1>{site.name}: <em>{site.tagline}</em></h1>
            <p>Aplikasi premium, akun instan, dan tools kreator dengan harga bersahabat. Pembayaran QRIS dicek otomatis.</p>
            <form className="searchbar" action="/products" method="get" role="search">
              <Icon n="search" size={18} />
              <input name="q" placeholder="Cari produk, misalnya Spotify" maxLength={60} aria-label="Cari produk" />
            </form>
            <div className="hero-points"><span><Icon n="shield" />Aman &amp; terpercaya</span><span><Icon n="bolt" />Terkirim otomatis</span><span><Icon n="clock" />24/7 online</span></div>
            {!user && (
              <div className="hero-cta">
                <Link href="/register" className="btn">Daftar gratis</Link>
                <Link href="/login" className="btn btn-line">Masuk</Link>
              </div>
            )}
          </div>
          {site.notice ? <div className="notice">{site.notice}</div> : null}
        </section>

        <div className="strip">
          {cards.map(([ic, c, l, v, s]) => (
            <div className="card stat" key={l}>
              <div className="lab"><span className={`chip ${c}`}><Icon n={ic} /></span>{l}</div>
              <div className="v">{new Intl.NumberFormat('id-ID').format(v)}</div>
              <div className="s">{s}</div>
            </div>
          ))}
        </div>

        <section className="sec">
          <div className="sec-head"><span className="eyebrow">Pilihan favorit</span><h2>Produk populer</h2><p className="sub">Stok dan harga diperbarui otomatis.</p></div>
          {popular.length ? (
            <ProductGrid items={popular} />
          ) : <div className="card empty">Produk belum tersedia. Silakan cek lagi nanti.</div>}
          <p style={{ marginTop: 16 }}><Link href="/products" className="btn btn-line">Lihat semua produk</Link></p>
        </section>

        <section className="sec">
          <div className="sec-head"><span className="eyebrow">Cara belanja</span><h2>Hanya 3 langkah mudah</h2><p className="sub">Belanja produk digital jadi lebih simpel dari yang kamu bayangkan.</p></div>
          <ol className="steps">
            {STEPS.map(([ic, t, d]) => <li key={t}><span className="chip c-blue"><Icon n={ic} /></span><h3>{t}</h3><p className="muted">{d}</p></li>)}
          </ol>
        </section>

        <section className="sec faq">
          <div className="sec-head"><span className="eyebrow">Bantuan</span><h2>Pertanyaan umum</h2></div>
          {FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
        </section>

        {!user && (
          <section className="sec">
            <div className="cta-band">
              <h2>Siap belanja sekarang?</h2>
              <p>Gabung gratis dan rasakan kemudahan beli akun premium yang cepat, aman, dan mudah.</p>
              <Link href="/register" className="btn btn-lg">Daftar gratis <Icon n="arrow" size={18} /></Link>
            </div>
          </section>
        )}
      </div>
    </Layout>
  );
}
