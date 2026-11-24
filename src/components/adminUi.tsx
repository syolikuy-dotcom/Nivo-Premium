import Link from 'next/link';
import { useRouter } from 'next/router';

const TABS: [string, string][] = [['/admin', 'Ringkasan'], ['/admin/products', 'Produk'], ['/admin/orders', 'Pesanan'], ['/admin/users', 'Pengguna'], ['/admin/settings', 'Pengaturan']];
export const AdminTabs = (): JSX.Element => {
  const { pathname } = useRouter();
  return <nav className="tabs" aria-label="Admin">{TABS.map(([h, l]) => <Link key={h} href={h} className={pathname === h ? 'on' : ''}>{l}</Link>)}</nav>;
};
