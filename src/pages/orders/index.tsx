import Link from 'next/link';
import Layout from '@/components/Layout';
import Icon from '@/components/Icon';
import { Badge } from '@/components/ui';
import { rupiah, dateTime, dateLong, statusMeta } from '@/shared/format';

import { ssr } from '@/server/ssr';
import type { OrdersProps, OrderListItem } from '@/shared/types';

export const getServerSideProps = ssr('orders');
const TABS = ['', 'success', 'pending', 'processing', 'failed', 'canceled', 'expired'];

const href = (f: { status: string; q: string }, page = 1) => {
  const p = new URLSearchParams();
  if (f.status) p.set('status', f.status);
  if (f.q) p.set('q', f.q);
  if (page > 1) p.set('page', String(page));
  const qs = p.toString();
  return qs ? `/orders?${qs}` : '/orders';
};
const groupByDay = (list: OrderListItem[]): [string, OrderListItem[]][] => {
  const m = new Map<string, OrderListItem[]>();
  for (const o of list) { const k = dateLong(o.createdAt); m.set(k, [...(m.get(k) || []), o]); }
  return [...m.entries()];
};

export default function Orders(props: OrdersProps) {
  const { list, filters, total, pages, counts } = props;
  const groups = groupByDay(list);
  const filtered = Boolean(filters.status || filters.q);
  return (
    <Layout {...props} metaTitle="Pesanan saya" desc="Riwayat dan status semua pesanan kamu." noindex>
      <h1>Pesanan saya</h1>
      <p className="muted">{counts.all || 0} transaksi{filtered ? ` · ${total} cocok dengan filter` : ''}.</p>
      <nav className="tabs" aria-label="Filter status">
        {TABS.map((s) => (
          <Link key={s || 'all'} href={href({ status: s, q: filters.q })} className={filters.status === s ? 'on' : ''}>
            {s ? statusMeta(s)[0] : 'Semua'}{(s ? counts[s] : counts.all) ? ` (${s ? counts[s] : counts.all})` : ''}
          </Link>))}
      </nav>
      <form className="osearch" method="get" action="/orders" role="search">
        {filters.status && <input type="hidden" name="status" value={filters.status} />}
        <input className="input" name="q" defaultValue={filters.q} placeholder="Cari no. pesanan atau produk" maxLength={60} aria-label="Cari pesanan" />
        <button className="btn btn-soft"><Icon n="search" size={16} />Cari</button>
        {filtered && <Link href="/orders" className="btn btn-line">Reset</Link>}
      </form>
      {list.length ? groups.map(([day, items]) => (
        <div className="card ogroup" key={day}>
          <h2 className="oday">{day}</h2>
          <ul className="olist">{items.map((o) => (
            <li key={o.orderNo} className="orow">
              <Link href={`/orders/${o.orderNo}`} className="oitem">
                <div className="oi-top"><b className="oi-name">{o.product}</b><Badge status={o.status} /></div>
                <div className="oi-meta">Akun instan × {o.qty} · {dateTime(o.createdAt)}</div>
                <div className="oi-bot"><span className="oi-no">{o.orderNo}</span><b>{rupiah(o.total)}</b></div>
              </Link>
            </li>))}
          </ul>
        </div>
      )) : (
        <div className="card"><div className="empty-rich">
          <b>{filtered ? 'Tidak ada pesanan yang cocok' : 'Belum ada pesanan'}</b>
          <p>{filtered ? 'Ubah filter atau kata kunci pencarian.' : 'Pesanan yang kamu buat akan muncul di sini.'}</p>
          <Link href={filtered ? '/orders' : '/products'} className="btn btn-primary">{filtered ? 'Tampilkan semua' : 'Lihat katalog'}</Link>
        </div></div>
      )}
      {pages > 1 && (
        <nav className="pager" aria-label="Halaman">
          {filters.page > 1 ? <Link className="btn btn-line btn-sm" href={href(filters, filters.page - 1)}>← Sebelumnya</Link> : <span />}
          <span className="muted">Halaman {filters.page} dari {pages}</span>
          {filters.page < pages ? <Link className="btn btn-line btn-sm" href={href(filters, filters.page + 1)}>Berikutnya →</Link> : <span />}
        </nav>
      )}
    </Layout>
  );
}
