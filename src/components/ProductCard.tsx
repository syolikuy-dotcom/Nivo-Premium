import Link from 'next/link';
import { ProductImg } from './ui';
import { rupiah } from '@/shared/format';
import { cn } from '@/shared/cn';
import type { ProductPub } from '@/shared/types';

export function ProductCard({ p }: { p: ProductPub }) {
  return (
    <Link href={`/products/${p.slug}`} className="pcard group">
      <div className="pcard-media">
        <ProductImg src={p.image} name={p.name} logoFit />
      </div>
      <div className="pbody">
        <span className="cat">{p.category}</span>
        <span className="nm">{p.name}</span>
        <div className="pr">
          <b>{rupiah(p.price)}</b>
          <span className={cn('pcard-stock', p.available ? 'ok' : 'out')}>{p.available ? `Stok ${p.stock}` : 'Habis'}</span>
        </div>
      </div>
    </Link>
  );
}

export function ProductGrid({ items }: { items: ProductPub[] }) {
  return <div className="pgrid">{items.map((p) => <ProductCard key={p.id} p={p} />)}</div>;
}
