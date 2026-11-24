import { useRef } from 'react';

let csrf = '';
export const setCsrf = (t?: string): void => { if (t) csrf = t; };

export class ApiError extends Error {
  status?: number; code?: string; network?: boolean;
}

export async function api<T = any>(path: string, { method = 'POST', body, signal }: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
      body: body === undefined ? undefined : JSON.stringify(body), signal,
    });
  } catch {
    const e = new ApiError('Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.'); e.network = true; throw e;
  }
  let json: any = null; try { json = await res.json(); } catch { /* abaikan: best-effort */ }
  if (!res.ok || !json || json.ok === false) {
    const e = new ApiError((json && json.error && json.error.message) || `Terjadi kesalahan (${res.status}).`);
    e.status = res.status; e.code = json && json.error && json.error.code; throw e;
  }
  return json.data as T;
}

/**
 * Kapan kunci idempotensi boleh diganti setelah permintaan uang gagal?
 * HANYA bila server pasti tidak menyimpan pesanan itu (galat 4xx terstruktur), atau baris gagal tersimpan dan kunci yang sama
 * akan ditolak lagi (payment_unavailable). Untuk galat jaringan atau 5xx (mis. 502/504/524 dari proxy saat server sebenarnya sudah
 * membuat pesanan) kunci HARUS dipertahankan: coba lagi dengan kunci sama mengembalikan pesanan yang sama, bukan menagih dua kali.
 */
export const shouldRenewKey = (e: unknown): boolean => {
  const x = e as Partial<ApiError> | null;
  if (!x || x.network) return false;
  if (x.code === 'payment_unavailable') return true;
  return typeof x.status === 'number' && x.status < 500;
};
export const newKey = (): string => { const b = new Uint8Array(18); crypto.getRandomValues(b); return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); };
export function useIdemKey(): { get: () => string; renew: () => void } {
  const ref = useRef<string | null>(null);
  if (ref.current === null) ref.current = typeof window === 'undefined' ? '' : newKey();
  return { get: () => (ref.current || (ref.current = newKey())), renew: () => { ref.current = newKey(); } };
}
export const safeNext = (n: unknown): string => (typeof n === 'string' && /^\/(?![/\\])[\w\-./?=&%#]*$/.test(n) ? n : '/dashboard');

export async function uploadImage(file: File): Promise<string> {
  const res = await fetch('/api/admin/upload', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type, 'x-csrf-token': csrf }, body: file });
  let j: any = null; try { j = await res.json(); } catch { /* abaikan: best-effort */ }
  if (!res.ok || !j || !j.ok) throw new Error((j && j.error && j.error.message) || 'Upload gagal.');
  return j.data.url as string;
}
