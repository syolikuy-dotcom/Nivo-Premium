import type { ProductPub, SiteInfo } from './types';

export const ROBOTS_INDEX = 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1';
export const ROBOTS_NOINDEX = 'noindex,nofollow';
export const BRAND_ALIASES = ['Nivo Premium', 'NivoPremium', 'Nivo Premium Store'];
export const BASE_KEYWORDS = 'nivo premium, nivopremium, toko produk digital, akun premium, aplikasi premium, akun instan, beli akun premium, alight motion premium, bayar QRIS';

export type Json = Record<string, unknown>;

export const clip = (v: unknown, n: number): string => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
};

export const originOf = (site: SiteInfo): string => String(site.url || '').replace(/\/+$/, '');

export const absolute = (origin: string, url: string | null | undefined): string => {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return origin ? `${origin}${url.startsWith('/') ? '' : '/'}${url}` : '';
};

export const cleanPath = (asPath: string): string => {
  const p = String(asPath || '/').split(/[?#]/)[0] || '/';
  return p.length > 1 ? p.replace(/\/+$/, '') : '/';
};

export const jsonLd = (data: Json | Json[]): string => JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export function organizationLd(site: SiteInfo): Json {
  const origin = originOf(site);
  const sameAs: string[] = [];
  if (/^[A-Za-z0-9._]{1,30}$/.test(site.ig || '')) sameAs.push(`https://instagram.com/${site.ig}`);
  const contact: Json[] = [];
  if (/^\d{8,16}$/.test(site.wa || '')) contact.push({ '@type': 'ContactPoint', contactType: 'customer support', url: `https://wa.me/${site.wa}`, availableLanguage: ['id'] });
  if (/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(site.email || '')) contact.push({ '@type': 'ContactPoint', contactType: 'customer support', email: site.email, availableLanguage: ['id'] });
  return {
    '@context': 'https://schema.org', '@type': 'Organization', '@id': `${origin}/#organization`,
    name: site.name, alternateName: BRAND_ALIASES, url: `${origin}/`,
    logo: { '@type': 'ImageObject', url: `${origin}/icon-512.png`, width: 512, height: 512 },
    ...(sameAs.length ? { sameAs } : {}), ...(contact.length ? { contactPoint: contact } : {}),
  };
}

export function websiteLd(site: SiteInfo): Json {
  const origin = originOf(site);
  return {
    '@context': 'https://schema.org', '@type': 'WebSite', '@id': `${origin}/#website`,
    name: site.name, alternateName: BRAND_ALIASES, url: `${origin}/`, inLanguage: 'id-ID',
    description: site.tagline, publisher: { '@id': `${origin}/#organization` },
    potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${origin}/products?q={search_term_string}` }, 'query-input': 'required name=search_term_string' },
  };
}

export const faqLd = (items: [string, string][]): Json => ({
  '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: items.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
});

export const breadcrumbLd = (origin: string, trail: [string, string][]): Json => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: trail.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${origin}${path}` })),
});

export function productLd(site: SiteInfo, p: ProductPub): Json {
  const origin = originOf(site);
  const url = `${origin}/products/${p.slug}`;
  const image = absolute(origin, p.image) || `${origin}/icon-512.png`;
  return {
    '@context': 'https://schema.org', '@type': 'Product', '@id': `${url}#product`,
    name: p.name, description: clip(p.description || `${p.name} di ${site.name}`, 500), image: [image], sku: p.slug, category: p.category,
    brand: { '@type': 'Brand', name: site.name },
    offers: {
      '@type': 'Offer', url, priceCurrency: 'IDR', price: String(p.price), itemCondition: 'https://schema.org/NewCondition',
      availability: p.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      seller: { '@type': 'Organization', name: site.name, url: `${origin}/` },
    },
  };
}

export function itemListLd(site: SiteInfo, name: string, items: ProductPub[]): Json {
  const origin = originOf(site);
  return {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name, url: `${origin}/products`, inLanguage: 'id-ID',
    isPartOf: { '@id': `${origin}/#website` },
    mainEntity: {
      '@type': 'ItemList', numberOfItems: items.length,
      itemListElement: items.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${origin}/products/${p.slug}`, name: p.name })),
    },
  };
}
