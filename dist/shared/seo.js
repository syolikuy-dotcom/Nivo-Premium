"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.breadcrumbLd = exports.faqLd = exports.jsonLd = exports.cleanPath = exports.absolute = exports.originOf = exports.clip = exports.BASE_KEYWORDS = exports.BRAND_ALIASES = exports.ROBOTS_NOINDEX = exports.ROBOTS_INDEX = void 0;
exports.organizationLd = organizationLd;
exports.websiteLd = websiteLd;
exports.productLd = productLd;
exports.itemListLd = itemListLd;
exports.ROBOTS_INDEX = 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1';
exports.ROBOTS_NOINDEX = 'noindex,nofollow';
exports.BRAND_ALIASES = ['Nivo Premium', 'NivoPremium', 'Nivo Premium Store'];
exports.BASE_KEYWORDS = 'nivo premium, nivopremium, toko produk digital, akun premium, aplikasi premium, akun instan, beli akun premium, alight motion premium, bayar QRIS';
const clip = (v, n) => {
    const t = String(v ?? '').replace(/\s+/g, ' ').trim();
    return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
};
exports.clip = clip;
const originOf = (site) => String(site.url || '').replace(/\/+$/, '');
exports.originOf = originOf;
const absolute = (origin, url) => {
    if (!url)
        return '';
    if (/^https?:\/\//i.test(url))
        return url;
    return origin ? `${origin}${url.startsWith('/') ? '' : '/'}${url}` : '';
};
exports.absolute = absolute;
const cleanPath = (asPath) => {
    const p = String(asPath || '/').split(/[?#]/)[0] || '/';
    return p.length > 1 ? p.replace(/\/+$/, '') : '/';
};
exports.cleanPath = cleanPath;
const jsonLd = (data) => JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
exports.jsonLd = jsonLd;
function organizationLd(site) {
    const origin = (0, exports.originOf)(site);
    const sameAs = [];
    if (/^[A-Za-z0-9._]{1,30}$/.test(site.ig || ''))
        sameAs.push(`https://instagram.com/${site.ig}`);
    const contact = [];
    if (/^\d{8,16}$/.test(site.wa || ''))
        contact.push({ '@type': 'ContactPoint', contactType: 'customer support', url: `https://wa.me/${site.wa}`, availableLanguage: ['id'] });
    if (/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(site.email || ''))
        contact.push({ '@type': 'ContactPoint', contactType: 'customer support', email: site.email, availableLanguage: ['id'] });
    return {
        '@context': 'https://schema.org', '@type': 'Organization', '@id': `${origin}/#organization`,
        name: site.name, alternateName: exports.BRAND_ALIASES, url: `${origin}/`,
        logo: { '@type': 'ImageObject', url: `${origin}/icon-512.png`, width: 512, height: 512 },
        ...(sameAs.length ? { sameAs } : {}), ...(contact.length ? { contactPoint: contact } : {}),
    };
}
function websiteLd(site) {
    const origin = (0, exports.originOf)(site);
    return {
        '@context': 'https://schema.org', '@type': 'WebSite', '@id': `${origin}/#website`,
        name: site.name, alternateName: exports.BRAND_ALIASES, url: `${origin}/`, inLanguage: 'id-ID',
        description: site.tagline, publisher: { '@id': `${origin}/#organization` },
        potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${origin}/products?q={search_term_string}` }, 'query-input': 'required name=search_term_string' },
    };
}
const faqLd = (items) => ({
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: items.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
});
exports.faqLd = faqLd;
const breadcrumbLd = (origin, trail) => ({
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: trail.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${origin}${path}` })),
});
exports.breadcrumbLd = breadcrumbLd;
function productLd(site, p) {
    const origin = (0, exports.originOf)(site);
    const url = `${origin}/products/${p.slug}`;
    const image = (0, exports.absolute)(origin, p.image) || `${origin}/icon-512.png`;
    return {
        '@context': 'https://schema.org', '@type': 'Product', '@id': `${url}#product`,
        name: p.name, description: (0, exports.clip)(p.description || `${p.name} di ${site.name}`, 500), image: [image], sku: p.slug, category: p.category,
        brand: { '@type': 'Brand', name: site.name },
        offers: {
            '@type': 'Offer', url, priceCurrency: 'IDR', price: String(p.price), itemCondition: 'https://schema.org/NewCondition',
            availability: p.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
            seller: { '@type': 'Organization', name: site.name, url: `${origin}/` },
        },
    };
}
function itemListLd(site, name, items) {
    const origin = (0, exports.originOf)(site);
    return {
        '@context': 'https://schema.org', '@type': 'CollectionPage', name, url: `${origin}/products`, inLanguage: 'id-ID',
        isPartOf: { '@id': `${origin}/#website` },
        mainEntity: {
            '@type': 'ItemList', numberOfItems: items.length,
            itemListElement: items.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${origin}/products/${p.slug}`, name: p.name })),
        },
    };
}
