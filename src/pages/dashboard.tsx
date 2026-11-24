import Link from 'next/link';
import Layout from '@/components/Layout';
import Icon from '@/components/Icon';
import { Badge } from '@/components/ui';
import { rupiah, dateLong, dateTime, rupiahLoose } from '@/shared/format';

import { ssr } from '@/server/ssr';
import type { DashboardProps } from '@/shared/types';

export const getServerSideProps = ssr('dashboard');
const N = (n: number) => new Intl.NumberFormat('id-ID').format(n);

export default function Dashboard(props: DashboardProps) {
  const { user, since, lastLogin, spent, ok, waiting, recent, stats } = props;
  return (
    <Layout {...props} metaTitle="Dashboard" desc="Ringkasan akun, saldo, dan pesanan terbaru kamu." noindex>
      <div className="banner">
        <div><h1>Halo, {user.name}</h1><p>Akun aktif sejak {dateLong(since)}. Saldo kamu <b>{rupiah(user.balance)}</b></p></div>
        <div className="acts" style={{ display: 'flex', gap: 8 }}>
          <Link href="/products" className="btn"><Icon n="bag" size={16} />Belanja</Link>
          <Link href="/deposit" className="btn btn-line">Deposit saldo</Link>
        </div>
      </div>
      <div className="g4">
        <div className="card stat"><div className="lab"><span className="chip c-green"><Icon n="wallet" /></span>Saldo</div><div className="v">{rupiahLoose(user.balance)}</div><div className="s"><Link href="/deposit" style={{ textDecoration: 'underline' }}>Deposit saldo</Link></div></div>
        <div className="card stat"><div className="lab"><span className="chip c-blue"><Icon n="bag" /></span>Pesanan sukses</div><div className="v">{ok}</div><div className="s">{waiting} menunggu bayar</div></div>
        <div className="card stat"><div className="lab"><span className="chip c-purple"><Icon n="receipt" /></span>Total belanja</div><div className="v">{rupiahLoose(spent)}</div></div>
        <div className="card stat"><div className="lab"><span className="chip c-orange"><Icon n="shield" /></span>Login terakhir</div><div className="v" style={{ fontSize: 17 }}>{lastLogin ? dateTime(lastLogin) : '-'}</div></div>
      </div>
      <div className="card">
        <div className="row between" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2>Pesanan terbaru</h2><Link href="/orders" className="btn btn-line btn-sm">Semua</Link></div>
        {recent.length ? recent.map((o) => (
          <Link href={`/orders/${o.orderNo}`} className="row-item" key={o.orderNo}>
            <div className="t">{o.product}<small>Akun instan × {o.qty} · {dateTime(o.createdAt)}</small></div>
            <div style={{ textAlign: 'right' }}><b>{rupiah(o.total)}</b><br /><Badge status={o.status} /></div>
          </Link>
        )) : <div className="empty">Belum ada pesanan. <Link href="/products">Mulai belanja</Link></div>}
      </div>
      <div className="card">
        <h2>Komunitas</h2>
        {[['Total pelanggan', N(stats.users)], ['Bergabung hari ini', N(stats.today)], ['Sedang online', N(stats.online)], ['Produk terjual', N(stats.sold)]].map(([l, v]) => (
          <div className="row-item" key={l}><span className="muted">{l}</span><b>{v}</b></div>
        ))}
      </div>
    </Layout>
  );
}
