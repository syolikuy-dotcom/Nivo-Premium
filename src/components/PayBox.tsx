import Icon from './Icon';
import { CopyIcon } from './ui';
import { rupiah, dateTime } from '@/shared/format';

interface Props { qr: string | null; amountDue: number; uniqueCode: number | null; expiresAt: string | null; onCheck: () => void; onCancel: () => void; busy: boolean; cancelLabel: string }
export default function PayBox({ qr, amountDue, uniqueCode, expiresAt, onCheck, onCancel, busy, cancelLabel }: Props) {
  return (
    <div className="card paybox qr-wrap">
      <h2>Selesaikan pembayaran</h2>
      {qr ? <img className="qr" src={qr} alt="Kode QRIS untuk pembayaran" width="260" height="260" /> : null}
      <p className="muted">Bayar tepat sejumlah</p>
      <div className="amount-row"><div className="amount-big">{rupiah(amountDue)}</div><CopyIcon text={String(amountDue)} label="Salin nominal (angka saja)" /></div>
      <p className="hint">Sudah termasuk kode unik / biaya pembayaran <b>{rupiah(uniqueCode)}</b>.</p>
      <p className="hint">Batas waktu: <b>{dateTime(expiresAt)}</b>. Status diperiksa otomatis tiap beberapa detik, tidak perlu di-refresh.</p>
      <p><button className="btn btn-primary" onClick={onCheck} disabled={busy}><Icon n="refresh" size={16} />Cek Status Pembayaran</button></p>
      <p><button className="btn btn-bad btn-sm" onClick={onCancel} disabled={busy}>{cancelLabel}</button></p>
    </div>
  );
}
