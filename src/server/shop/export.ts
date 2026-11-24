import { dateTime } from '../../shared/format';
import type { Account } from '../../shared/types';

const flat = (v: unknown, n = 400): string => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, n);
const RULE = '-'.repeat(44);

export interface TxtInput { siteName: string; orderNo: string; product: string; qty: number; completedAt: unknown; accounts: Account[] }

export function buildAccountsTxt(i: TxtInput): string {
  const L: string[] = [
    flat(i.siteName, 80), RULE,
    `No. pesanan : ${flat(i.orderNo, 24)}`, `Produk      : ${flat(i.product, 160)}`, `Jumlah      : ${i.qty}`, `Selesai     : ${dateTime(i.completedAt)} WIB`, RULE, '',
  ];
  i.accounts.forEach((a, n) => { L.push(`Akun ${n + 1}`, `  Username : ${flat(a.username)}`, `  Password : ${flat(a.password)}`, ''); });
  L.push(RULE, 'Simpan berkas ini baik-baik dan jangan bagikan ke siapa pun.', 'Kamu juga bisa membuka data ini lagi dari halaman pesanan setelah masuk.');
  return `${L.join('\r\n')}\r\n`;
}
export const accountsFilename = (orderNo: string): string => `${orderNo}.txt`;
