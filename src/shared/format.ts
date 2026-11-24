const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const MONL = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const p2 = (n: number): string => String(n).padStart(2, '0');
const rupiah = (n: unknown): string => 'Rp\u00a0' + new Intl.NumberFormat('id-ID').format(Math.round(Number(n) || 0));
// Untuk kartu statistik sempit: boleh patah baris setelah "Rp" daripada memotong angka di tengah.
const rupiahLoose = (n: unknown): string => rupiah(n).replace('\u00a0', ' ');
function wib(v: unknown): Date | null { const d = new Date(v as string | number | Date); return Number.isNaN(d.getTime()) ? null : new Date(d.getTime() + 7 * 3600e3); }
function dateTime(v: unknown): string { const w = wib(v); return w ? `${w.getUTCDate()} ${MON[w.getUTCMonth()]} ${w.getUTCFullYear()}, ${p2(w.getUTCHours())}.${p2(w.getUTCMinutes())}` : '-'; }
function dateLong(v: unknown): string { const w = wib(v); return w ? `${w.getUTCDate()} ${MONL[w.getUTCMonth()]} ${w.getUTCFullYear()}` : '-'; }
const STATUS: Record<string, [string, string]> = {
  pending: ['Menunggu bayar', 'b-warn'], paid: ['Dibayar', 'b-info'], processing: ['Diproses', 'b-info'], success: ['Selesai', 'b-ok'],
  failed: ['Gagal', 'b-bad'], canceled: ['Dibatalkan', 'b-mute'], expired: ['Kedaluwarsa', 'b-mute'],
  pending_verify: ['Menunggu verifikasi', 'b-warn'], review: ['Dicek admin', 'b-warn'],
};
const statusMeta = (s: string): [string, string] => STATUS[s] || [String(s), 'b-mute'];
export { rupiah, rupiahLoose, dateTime, dateLong, statusMeta };
