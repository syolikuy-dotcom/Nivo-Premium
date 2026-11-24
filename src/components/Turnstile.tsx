import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

interface TurnstileApi { render(el: HTMLElement, o: Record<string, unknown>): string; reset(id: string): void; remove(id: string): void }
declare global { interface Window { turnstile?: TurnstileApi } }
export interface TurnstileHandle { reset(): void }
interface Props { siteKey: string; action: string; onToken: (t: string) => void; onError?: (m: string) => void }

const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loader: Promise<TurnstileApi> | null = null;
const load = (): Promise<TurnstileApi> => {
  if (typeof window === 'undefined') return Promise.reject(new Error('ssr'));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loader) {
    loader = new Promise<TurnstileApi>((res, rej) => {
      const s = document.createElement('script');
      s.src = SRC; s.async = true; s.defer = true;
      s.onload = () => res(window.turnstile as TurnstileApi);
      s.onerror = () => { loader = null; rej(new Error('Verifikasi keamanan gagal dimuat.')); };
      document.head.appendChild(s);
    });
  }
  return loader;
};

const Turnstile = forwardRef<TurnstileHandle, Props>(function Turnstile({ siteKey, onToken, onError, action }: Props, ref) {
  const box = useRef<HTMLDivElement>(null); const id = useRef<string | null>(null);
  useImperativeHandle(ref, () => ({ reset() { onToken(''); try { if (id.current !== null && window.turnstile) window.turnstile.reset(id.current); } catch { /* abaikan: best-effort */ } } }), [onToken]);
  useEffect(() => {
    let dead = false;
    load().then((t) => {
      if (dead || !box.current || id.current !== null) return;
      id.current = t.render(box.current, {
        sitekey: siteKey, action, theme: 'light', language: 'id', appearance: 'always',
        callback: (tok: string) => onToken(tok),
        'expired-callback': () => onToken(''),
        'timeout-callback': () => onToken(''),
        'error-callback': () => { onToken(''); if (onError) onError('Verifikasi keamanan bermasalah. Muat ulang halaman lalu coba lagi.'); },
      });
    }).catch((e: Error) => { if (onError) onError(e.message); });
    return () => { dead = true; try { if (id.current !== null && window.turnstile) window.turnstile.remove(id.current); } catch { /* abaikan: best-effort */ } id.current = null; };
  }, [siteKey]);
  return <div className="cf-box" ref={box} />;
});
export default Turnstile;
