import Link from 'next/link';
import Layout from '@/components/Layout';
import type { NextPageContext } from 'next';

export default function ErrorPage({ statusCode }: { statusCode: number }) {
  return (
    <Layout metaTitle="Terjadi kesalahan" desc="Terjadi kesalahan saat memuat halaman." noindex>
      <div className="wrap sec"><div className="card empty-rich"><b>{statusCode === 404 ? 'Halaman tidak ditemukan' : 'Terjadi kesalahan'}</b><p>Coba muat ulang halaman. Kalau masih berulang, hubungi admin.</p><Link href="/" className="btn btn-primary">Ke beranda</Link></div></div>
    </Layout>
  );
}
ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => ({ statusCode: res ? res.statusCode : err ? err.statusCode : 404 });
