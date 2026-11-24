import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { api } from '@/shared/api-client';
import { UserIcon } from './Avatar';

const SHOW_MS = 4200;
const EVERY_MS = 16000;
const FIRST_MS = 4000;

interface Recent { who: string; product: string; at: string }
const ago = (iso: string): string => {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} menit lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  return `${Math.floor(s / 86400)} hari lalu`;
};

function Fit({ max, min, className, dep, children }: { max: number; min: number; className?: string; dep: unknown; children?: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return undefined;
    const fit = () => { let size = max; el.style.fontSize = `${size}px`; while (el.scrollWidth > el.clientWidth + 0.5 && size > min) { size -= 0.5; el.style.fontSize = `${size}px`; } };
    fit();
    let dead = false;
    if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => { if (!dead) fit(); }).catch(() => {});
    return () => { dead = true; };
  }, [max, min, dep]);
  return <span ref={ref} className={`block overflow-hidden text-ellipsis whitespace-nowrap ${className || ''}`} style={{ fontSize: max }}>{children}</span>;
}

export default function Toast() {
  const reduce = useReducedMotion();
  const [item, setItem] = useState<(Recent & { k: number }) | null>(null);
  const idx = useRef(0);
  const { data } = useQuery({ queryKey: ['recent'], queryFn: ({ signal }) => api<{ items: Recent[] }>('/api/recent', { method: 'GET', signal }), staleTime: 5 * 60_000, refetchOnWindowFocus: false, refetchOnReconnect: false, retry: false });
  const itemsRef = useRef<Recent[]>([]);
  itemsRef.current = (data && data.items) || [];
  const ready = itemsRef.current.length > 0;

  useEffect(() => {
    if (!ready) return undefined;
    let dead = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const later = (fn: () => void, ms: number) => { timer = setTimeout(fn, ms); };
    const cycle = () => {
      if (dead) return;
      const list = itemsRef.current;
      if (document.hidden || !list.length) { later(cycle, 2000); return; }
      setItem({ ...list[idx.current++ % list.length], k: idx.current });
      later(() => { setItem(null); later(cycle, EVERY_MS - SHOW_MS); }, SHOW_MS);
    };
    later(cycle, FIRST_MS);
    return () => { dead = true; if (timer) clearTimeout(timer); setItem(null); };
  }, [ready]);

  const enter = reduce ? { opacity: 0 } : { opacity: 0, y: 14 };
  const shown = reduce ? { opacity: 1 } : { opacity: 1, y: 0 };
  const leave = reduce ? { opacity: 0 } : { opacity: 0, y: 8 };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[35] flex justify-start px-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] sm:px-6 sm:pb-[calc(20px+env(safe-area-inset-bottom,0px))]" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        {item && (
          <motion.div
            key={item.k} role="status" layout={false}
            initial={enter} animate={shown} exit={leave}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            style={{ willChange: 'transform, opacity', backfaceVisibility: 'hidden' }}
            className="flex w-auto min-w-[236px] max-w-[min(340px,calc(100vw-24px))] items-center gap-2.5 rounded-[18px] border border-[#e3e9f6] bg-white/95 py-1.5 pl-1.5 pr-4 shadow-[0_10px_30px_-14px_rgba(37,99,235,.35)]"
          >
            <span aria-hidden="true" className="relative grid h-10 w-10 flex-none place-items-center rounded-full bg-[#eef1f6]">
              <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-gradient-to-br from-[#3b82f6] to-[#1d4ed8] text-white"><UserIcon size={17} /></span>
              <span aria-hidden="true" className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full bg-[#22c55e] ring-2 ring-white" />
            </span>
            <span className="min-w-0 flex-1">
              <Fit max={10} min={9} dep={item.k} className="font-bold uppercase leading-[1.25] tracking-[.07em] text-[#64708d]">{item.who} <span aria-hidden="true">•</span> {ago(item.at)}</Fit>
              <Fit max={12.5} min={10.5} dep={item.k} className="font-medium leading-[1.35] text-ink-2">Membeli <b className="font-extrabold text-ink">{item.product}</b></Fit>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
