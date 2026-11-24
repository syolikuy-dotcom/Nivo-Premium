import { useState } from 'react';
import type { ReactNode } from 'react';
import Icon from './Icon';
import { statusMeta } from '@/shared/format';
import { cn } from '@/shared/cn';
import type { Account } from '@/shared/types';

export type AlertKind = 'danger' | 'success' | 'warning' | 'info';
export interface Msg { k: AlertKind; t: string }

export const Alert = ({ kind = 'danger', className, children }: { kind?: AlertKind; className?: string; children?: ReactNode }) => (children ? <div className={cn('alert', `alert-${kind}`, className)} role={kind === 'danger' ? 'alert' : 'status'}>{children}</div> : null);
export const Badge = ({ status, className }: { status: string; className?: string }) => { const [t, c] = statusMeta(status); return <span className={cn('badge', c, className)}>{t}</span>; };

export function PasswordInput({ id, value, onChange, autoComplete, required = true }: { id: string; value: string; onChange: (v: string) => void; autoComplete?: string; required?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw">
      <input className="input" id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required={required} maxLength={128} />
      <button type="button" className="pw-eye" onClick={() => setShow(!show)} aria-label={show ? 'Sembunyikan password' : 'Tampilkan password'}><Icon n={show ? 'eyeOff' : 'eye'} size={18} /></button>
    </div>
  );
}
export function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children?: ReactNode }) {
  return <div className="field"><label htmlFor={id}>{label}</label>{children}{hint ? <div className="hint">{hint}</div> : null}</div>;
}
export function Qty({ value, min = 1, max = 50, onChange }: { value: number; min?: number; max?: number; onChange: (n: number) => void }) {
  const set = (n: number) => onChange(Math.max(min, Math.min(max, n || min)));
  return (
    <div className="qty">
      <button type="button" onClick={() => set(value - 1)} aria-label="Kurangi">−</button>
      <input value={value} inputMode="numeric" aria-label="Jumlah" onChange={(e) => set(parseInt(e.target.value.replace(/\D/g, ''), 10))} />
      <button type="button" onClick={() => set(value + 1)} aria-label="Tambah">+</button>
    </div>
  );
}
function useCopy(text: string) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch {
      const t = document.createElement('textarea'); t.value = text; t.setAttribute('data-allow-copy', ''); t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch { /* abaikan: best-effort */ } document.body.removeChild(t);
    }
    setDone(true); setTimeout(() => setDone(false), 1500);
  };
  return [done, copy] as const;
}
export function CopyButton({ text, label = 'Salin' }: { text: string; label?: string }) {
  const [done, copy] = useCopy(text);
  return <button type="button" className="btn btn-soft btn-sm" onClick={copy}><Icon n={done ? 'check' : 'copy'} size={15} />{done ? 'Tersalin' : label}</button>;
}
export function CopyIcon({ text, label = 'Salin' }: { text: string; label?: string }) {
  const [done, copy] = useCopy(text);
  return <button type="button" className={cn('copy-ic', done && 'done')} onClick={copy} aria-label={done ? 'Tersalin' : label} title={done ? 'Tersalin' : label}><Icon n={done ? 'check' : 'copy'} size={16} /></button>;
}
export function ProductImg({ src, name, logoFit, className }: { src?: string | null; name?: string; logoFit?: boolean; className?: string }) {
  const [broken, setBroken] = useState(false);
  const show = src && !broken;
  return (
    <div className={cn('pimg', logoFit && 'logo-fit', className)}>
      {show ? <img src={src} alt={name} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : (name || '?').slice(0, 1).toUpperCase()}
    </div>
  );
}
export function AccountList({ accounts }: { accounts: Account[] }) {
  return <>{accounts.map((a, i) => (
    <div className="acct" key={i}>
      <div className="acct-no">Akun {i + 1}</div>
      {[['Username / email', a.username], ['Password', a.password]].map(([l, v]) => (
        <div className="acct-row" key={l}><span className="acct-l">{l}</span><code>{v}</code><CopyButton text={v} /></div>
      ))}
    </div>
  ))}</>;
}
