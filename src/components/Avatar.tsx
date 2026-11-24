export default function Avatar() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor" aria-hidden="true" focusable="false" style={{ display: 'block' }}>
      <circle cx="12" cy="9.2" r="4.3" />
      <path d="M3.2 24.5c0-5.3 3.9-8.6 8.8-8.6s8.8 3.3 8.8 8.6z" />
    </svg>
  );
}

export function UserIcon({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ display: 'block' }}>
      <circle cx="12" cy="8" r="3.9" />
      <path d="M4.6 20.4c.7-3.7 3.8-5.8 7.4-5.8s6.7 2.1 7.4 5.8" />
    </svg>
  );
}
