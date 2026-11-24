import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Icon from './Icon';
import { UserIcon } from './Avatar';
import type { IconName } from './Icon';
import { api } from '@/shared/api-client';
import { rupiah } from '@/shared/format';
import { cn } from '@/shared/cn';
import { BASE_KEYWORDS, ROBOTS_INDEX, ROBOTS_NOINDEX, absolute, clip, cleanPath, jsonLd, originOf } from '@/shared/seo';
import type { Json } from '@/shared/seo';
import type { SessionUser, Shell, SiteInfo } from '@/shared/types';

interface NavItem { href: string; label: string; icon: IconName }
export interface LayoutProps {
  shell?: Shell; title?: string; metaTitle?: string; desc?: string; noindex?: boolean;
  keywords?: string; canonical?: string; ogType?: 'website' | 'product'; ogImage?: string | null; ld?: Json | Json[]; follow?: boolean;
  user?: SessionUser | null; site?: SiteInfo; admin?: boolean; children?: ReactNode;
}

const FALLBACK: SiteInfo = { name: 'Nivo Premium', logo: '/icon.webp', tagline: '', notice: '', wa: '', email: '', ig: '', turnstile: '', url: '', google: false };
const BASE: NavItem[] = [{ href: '/', label: 'Beranda', icon: 'home' }, { href: '/products', label: 'Katalog', icon: 'grid' }, { href: '/am', label: 'Order Akun AM', icon: 'cart' }];
const MEMBER: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'grid' }, { href: '/products', label: 'Belanja', icon: 'layers' }, { href: '/am', label: 'Order Akun AM', icon: 'cart' },
  { href: '/orders', label: 'Pesanan saya', icon: 'bag' }, { href: '/deposit', label: 'Deposit saldo', icon: 'wallet' }, { href: '/account', label: 'Akun saya', icon: 'user' },
];
const MEMBER_MORE: NavItem[] = [{ href: '/', label: 'Lihat toko', icon: 'home' }];
const ADMIN: NavItem[] = [{ href: '/admin', label: 'Ringkasan', icon: 'shield' }, { href: '/admin/products', label: 'Produk', icon: 'box' }, { href: '/admin/orders', label: 'Pesanan', icon: 'receipt' }, { href: '/admin/users', label: 'Pengguna', icon: 'users' }, { href: '/admin/settings', label: 'Pengaturan', icon: 'settings' }];

const Logo = ({ site, cls = '' }: { site: SiteInfo; cls?: string }) => <span className={`logo ${cls}`}>{site.logo ? <img src={site.logo} alt="" /> : site.name.slice(0, 1)}</span>;

const Brand = ({ site }: { site: SiteInfo }) => <Link href="/" className="brand"><Logo site={site} /><span className="brand-txt"><b>{site.name}</b><small>{site.tagline || 'Produk digital premium'}</small></span></Link>;

function Footer({ site }: { site: SiteInfo }) {
  const wa = /^\d{8,16}$/.test(site.wa || '') ? `https://wa.me/${site.wa}` : null;
  const mail = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(site.email || '') ? `mailto:${site.email}` : null;
  const ig = /^[A-Za-z0-9._]{1,30}$/.test(site.ig || '') ? `https://instagram.com/${site.ig}` : null;
  const links: { href: string | null; label: string; icon: IconName; ext?: boolean }[] = [
    { href: wa, label: 'WhatsApp', icon: 'whatsapp', ext: true },
    { href: mail, label: 'Gmail', icon: 'gmail' },
    { href: ig, label: 'Instagram', icon: 'instagram', ext: true },
  ];
  return (
    <footer className="foot">
      <div className="wrap foot-in">
        <Link href="/" className="foot-brand"><Logo site={site} /><span>{site.name}</span></Link>
        <div className="foot-links">
          {links.map((l) => (l.href
            ? <a key={l.label} className="foot-ic" href={l.href} aria-label={l.label} title={l.label} {...(l.ext ? { target: '_blank', rel: 'noopener noreferrer' } : {})}><Icon n={l.icon} size={22} /></a>
            : <span key={l.label} className="foot-ic off" role="img" aria-label={`${l.label} belum diatur`} title={`${l.label} belum diatur`}><Icon n={l.icon} size={22} /></span>))}
        </div>
        <span className="foot-copy">© {new Date().getFullYear()} {site.name}. Semua hak dilindungi.</span>
      </div>
    </footer>
  );
}

export default function Layout({ shell = 'store', title, metaTitle, desc, noindex, keywords, canonical, ogType = 'website', ogImage, ld, follow, user, site: siteIn, children }: LayoutProps) {
  const site = siteIn || FALLBACK;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const isApp = shell === 'app' && user;

  useEffect(() => { document.body.classList.toggle('nav-open', open); return () => document.body.classList.remove('nav-open'); }, [open]);
  const closeBtn = useRef<HTMLButtonElement>(null); const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) { opener.current = document.activeElement as HTMLElement | null; closeBtn.current?.focus(); }
    else if (opener.current) { opener.current.focus(); opener.current = null; }
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const box = document.querySelector<HTMLElement>('.drawer');
      if (!box) return;
      const f = Array.from(box.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
      if (!f.length) return;
      const first = f[0]; const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => document.removeEventListener('keydown', trap);
  }, [open]);
  useEffect(() => {
    const close = () => setOpen(false);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    router.events.on('routeChangeStart', close); window.addEventListener('keydown', esc);
    return () => { router.events.off('routeChangeStart', close); window.removeEventListener('keydown', esc); };
  }, [router.events]);

  const logout = async () => {
    if (busy) return; setBusy(true);
    try { await api('/api/auth/logout'); } catch { /* sesi tetap dibersihkan lewat redirect di bawah */ }
    window.location.assign('/');
  };
  const on = (href: string): boolean => (href === '/' ? router.pathname === '/' : href === '/admin' ? router.pathname === '/admin' : router.pathname === href || router.pathname.startsWith(`${href}/`));
  const origin = originOf(site);
  const path = canonical || cleanPath(router.asPath);
  const url = origin ? `${origin}${path}` : '';
  const indexable = !noindex && shell !== 'app';
  const branded = Boolean(metaTitle && metaTitle.toLowerCase().includes(site.name.toLowerCase()));
  const full = branded ? String(metaTitle) : `${metaTitle || title || site.tagline || 'Beranda'} · ${site.name}`;
  const description = clip(desc || `${site.name}: ${site.tagline}`, 160);
  const image = absolute(origin, ogImage) || (origin ? `${origin}/icon-512.png` : '/icon-512.png');
  const robots = indexable ? ROBOTS_INDEX : follow ? 'noindex,follow' : ROBOTS_NOINDEX;
  const lds = ld ? ([] as Json[]).concat(ld) : [];
  const navLink = (l: NavItem) => <Link key={l.href} href={l.href} className={cn('nl', on(l.href) && 'on')}><Icon n={l.icon} />{l.label}</Link>;

  const drawer = (
    <>
      <div className="drawer-bg" aria-hidden="true" onClick={() => setOpen(false)} />
      <aside className="drawer" aria-label="Menu utama" {...(open ? { role: 'dialog', 'aria-modal': true } : {})}>
        <div className="head">
          <Brand site={site} />
          <button ref={closeBtn} className="icon-btn close" onClick={() => setOpen(false)} aria-label="Tutup menu"><Icon n="x" /></button>
        </div>
        <nav>
          {user
            ? <><div className="nsep first">Menu pelanggan</div>{MEMBER.map(navLink)}<div className="nsep">Lainnya</div>{MEMBER_MORE.map(navLink)}</>
            : BASE.map(navLink)}
          {user && user.role === 'admin' && <><div className="nsep">Admin</div>{ADMIN.map(navLink)}</>}
        </nav>
        <div className="who">
          {user ? (
            <>
              <b>{user.name}</b><span>@{user.username}</span>
              <button className="btn btn-line btn-sm" onClick={logout} disabled={busy}><Icon n="logout" size={16} />Keluar</button>
            </>
          ) : (
            <div className="stack"><Link href="/register" className="btn btn-primary btn-block">Daftar gratis</Link><Link href="/login" className="btn btn-line btn-block">Masuk</Link></div>
          )}
        </div>
      </aside>
    </>
  );

  return (
    <>
      <Head>
        <title>{full}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="description" content={description} />
        <meta name="keywords" content={keywords || `${BASE_KEYWORDS}, ${site.name.toLowerCase()}`} />
        <meta name="robots" content={robots} />
        <meta name="googlebot" content={robots} />
        <meta name="author" content={site.name} />
        <meta name="publisher" content={site.name} />
        <meta name="copyright" content={site.name} />
        <meta name="application-name" content={site.name} />
        <meta name="apple-mobile-web-app-title" content={site.name} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="format-detection" content="telephone=no" />
        <meta name="theme-color" content="#1d4ed8" />
        <meta name="msapplication-TileColor" content="#1d4ed8" />
        <meta name="language" content="id" />
        <meta httpEquiv="content-language" content="id" />
        <meta name="geo.region" content="ID" />
        <meta name="geo.placename" content="Indonesia" />
        <meta name="rating" content="general" />
        {url ? <link rel="canonical" href={url} /> : null}
        {indexable && url ? <link rel="alternate" hrefLang="id" href={url} /> : null}
        {indexable && url ? <link rel="alternate" hrefLang="x-default" href={url} /> : null}
        <meta property="og:site_name" content={site.name} />
        <meta property="og:title" content={full} />
        <meta property="og:description" content={description} />
        <meta property="og:type" content={ogType === 'product' ? 'product' : 'website'} />
        <meta property="og:locale" content="id_ID" />
        {url ? <meta property="og:url" content={url} /> : null}
        <meta property="og:image" content={image} />
        <meta property="og:image:alt" content={`${site.name} logo`} />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={full} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content={image} />
        <meta name="twitter:image:alt" content={`${site.name} logo`} />
        <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png" />
        <link rel="icon" type="image/webp" href="/icon.webp" />
        <link rel="shortcut icon" href="/icon-192.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.webmanifest" />
        {lds.length ? <script key="ld-json" type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(lds.length === 1 ? lds[0] : lds) }} /> : null}
      </Head>
      <a className="skip" href="#main">Lewati ke konten utama</a>
      {drawer}
      {isApp ? (
        <div className="appmain">
          <div className="appbar">
            <button className="icon-btn" data-nav-toggle onClick={() => setOpen(true)} aria-label="Buka menu"><Icon n="menu" size={26} /></button>
            <h2>{title}</h2>
            <Link href="/deposit" className="bal">{rupiah(user.balance)}</Link>
            <Link href="/account" className="avatar" aria-label="Akun saya"><UserIcon /></Link>
          </div>
          <main id="main" tabIndex={-1} className="page">{children}</main>
          <Footer site={site} />
        </div>
      ) : (
        <>
          <header className="top">
            <div className="wrap top-in">
              <Brand site={site} />
              <nav className="top-nav">{BASE.map((l) => <Link key={l.href} href={l.href} className={cn(on(l.href) && 'on')}>{l.label}</Link>)}</nav>
              <div className="top-act">
                {user ? <><Link href="/dashboard" className="btn btn-line btn-sm">Dashboard</Link><button className="btn btn-primary btn-sm" onClick={logout} disabled={busy}>Keluar</button></>
                  : <><Link href="/login" className="btn btn-line btn-sm">Masuk</Link><Link href="/register" className="btn btn-primary btn-sm">Daftar gratis</Link></>}
              </div>
              <button className="icon-btn burger" onClick={() => setOpen(true)} aria-label="Buka menu"><Icon n="menu" size={26} /></button>
            </div>
          </header>
          <main id="main" tabIndex={-1}>{children}</main>
          <Footer site={site} />
        </>
      )}
    </>
  );
}
