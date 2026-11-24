const EDITABLE = 'input,textarea,select,[contenteditable=""],[contenteditable="true"],[data-allow-copy]';
const elOf = (t: EventTarget | null): Element | null => (t instanceof Element ? t : t instanceof Node ? t.parentElement : null);
const editable = (t: EventTarget | null): boolean => { const el = elOf(t); return !!el && !!el.closest(EDITABLE); };

const DEVTOOLS_CODES = ['KeyI', 'KeyJ', 'KeyC', 'KeyK', 'KeyU'];
export function isBlockedKey(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): boolean {
  if (e.key === 'F12') return true;
  if (!(e.ctrlKey || e.metaKey)) return false;
  if ((e.shiftKey || e.altKey) && DEVTOOLS_CODES.includes(e.code)) return true;
  return !e.shiftKey && !e.altKey && (e.code === 'KeyU' || e.code === 'KeyS');
}

export function installGuard(): () => void {
  if (process.env.NODE_ENV !== 'production' || typeof document === 'undefined') return () => undefined;
  const root = document.documentElement;
  const stop = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
  const onKey = (e: KeyboardEvent) => { if (isBlockedKey(e)) stop(e); };
  const onMenu = (e: Event) => { if (!editable(e.target)) stop(e); };
  const onCopy = (e: Event) => { if (!editable(e.target)) stop(e); };
  const onDrag = (e: Event) => { if (!editable(e.target)) stop(e); };
  const onSelect = (e: Event) => { if (!editable(e.target)) stop(e); };
  root.classList.add('nocopy');
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('contextmenu', onMenu, true);
  document.addEventListener('copy', onCopy, true);
  document.addEventListener('cut', onCopy, true);
  document.addEventListener('dragstart', onDrag, true);
  document.addEventListener('selectstart', onSelect, true);
  return () => {
    root.classList.remove('nocopy');
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('contextmenu', onMenu, true);
    document.removeEventListener('copy', onCopy, true);
    document.removeEventListener('cut', onCopy, true);
    document.removeEventListener('dragstart', onDrag, true);
    document.removeEventListener('selectstart', onSelect, true);
  };
}
