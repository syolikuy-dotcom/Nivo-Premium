import Link from 'next/link';
import Layout from '@/components/Layout';
import type { BaseProps } from '@/shared/types';

export default function NotFound(props: Partial<BaseProps>) {
  return (
    <Layout {...props} metaTitle="Halaman tidak ditemukan" desc="Halaman yang kamu cari tidak ditemukan." noindex>
      <div className="wrap sec"><div className="card empty-rich"><b>Halaman tidak ditemukan</b><p>Alamat yang kamu buka tidak ada atau sudah dipindahkan.</p><Link href="/" className="btn btn-primary">Ke beranda</Link></div></div>
    </Layout>
  );
}
